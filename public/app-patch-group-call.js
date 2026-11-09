/* =============================================================================
   EMPYREAN INTERNATIONAL — app-patch-group-call.js
   Load order: AFTER app-patch-v13.js (needs window.openGroupChat's header
   buttons/banner already wired to call window._empGroupCallStart, which
   this file defines) and AFTER app-patch-openchat.js (not a hard runtime
   dependency, just keeps load order consistent with the rest of the
   messaging feature area).

   WHAT THIS FILE DOES
   Real group video/voice calling for a group chat — genuinely working
   WebRTC media between every participant, not a UI stub. One call can be
   active per group at a time; anyone in the group can start or join it.

   WHY A NEW FILE INSTEAD OF EDITING app-patch-openchat.js's CALL CODE
   app-patch-openchat.js's entire RTC module (_rtc state, _createPC,
   _startCallModal, etc.) is built around exactly ONE remote peer — one
   RTCPeerConnection, one offer, one answer, one pair of candidate
   subcollections. A group call needs an independent RTCPeerConnection
   PER OTHER PARTICIPANT (mesh topology) plus presence tracking for
   people joining/leaving mid-call, which is a different shape of state
   machine, not a parameter tweak on the 1:1 one. Reusing the naming
   conventions and Firestore signaling pattern (offer/answer doc +
   candidate subcollections, same ICE_SERVERS) keeps it consistent with
   the rest of the app without forcing an unrelated rewrite of working
   1:1 calling code.

   TOPOLOGY: full mesh. Every participant holds one RTCPeerConnection per
   OTHER participant. Fine for small groups (this app's group chats cap
   at a handful of members per the New Group picker in app-patch-v13.js);
   would need an SFU to scale to large rooms, which is a separate,
   larger infrastructure decision, not something to silently swap in
   here. Hard-capped at MAX_CALL_PARTICIPANTS (10) below — the grid is
   designed to hold that many tiles, and mesh WebRTC gets expensive fast
   past that, so joining (and adding people mid-call) is refused once full.

   MID-CALL FEATURES
   - Add people: the header "add" button reads groups/{groupId}.members,
     offers everyone not already on the call, and — since there's no
     invite/ring collection for group calls — posts a system message into
     the group's own message thread ("X added Y to the call") using the
     EXISTING groups/{groupId}/messages rule. Anyone with the group chat
     open already sees the live "call in progress" banner
     (app-patch-v13.js's _wireGroupCallEntry), so the system message is
     the notification; no new Firestore collection/rule needed for this.
   - Voice → video switch: escalates the whole call's `type` to 'video'
     (group_calls/{groupId}.type), turns on the switcher's own camera, and
     renegotiates every existing RTCPeerConnection by adding the video
     track and creating a FRESH signals/{from_to_r<ts>} doc per peer —
     a new doc id rather than overwriting the original offer/answer doc,
     because _watchIncomingSignals only reacts to 'added' doc-changes
     (matching how it already ignores 'modified' on the original
     offer/answer exchange). Other participants' cameras stay off until
     they individually tap the camera button that appears once the call
     becomes 'video' — the switch only guarantees video is NOW POSSIBLE
     for the call, not that everyone's camera turns on.

   DATA MODEL (new — needs matching Firestore rules, see NOTE at bottom)
     group_calls/{groupId}                    { status:'active'|'ended',
                                                  type:'video'|'voice',
                                                  startedBy, startedAt,
                                                  activeCount }
     group_calls/{groupId}/peers/{uid}         { name, avatar, joinedAt,
                                                  muted, camOff }
     group_calls/{groupId}/signals/{from_to}   { from, to, offer:{type,sdp},
                                                  answer:{type,sdp}, createdAt }
     group_calls/{groupId}/signals/{from_to}/candidates/{auto}
                                                { candidate, sdpMid,
                                                  sdpMLineIndex, from }

   IDENTITY: every doc here is keyed by the REAL Firebase Auth uid
   (fbAuth.currentUser.uid), not userState.id — the same deliberate
   choice app-patch-openchat.js's 1:1 calls collection already makes
   (see its _syncUidIfNeeded/_startCallModal), specifically so this
   feature area sidesteps the userState.id-vs-auth.uid mismatch this
   codebase otherwise works around everywhere else. If there's no live
   auth session, this refuses to start/join rather than writing under
   a stale/wrong id.
   ============================================================================= */

(function empyreanGroupCall() {
    'use strict';

    if (window._empGroupCallLoaded) {
        console.warn('[GroupCall] Already loaded — skipping duplicate.');
        return;
    }
    window._empGroupCallLoaded = true;

    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _us()   { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _authUid() {
        try { return (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || null; }
        catch (e) { return null; }
    }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
        });
    }
    /* FIX (regression: "group call button clicks silently do nothing"):
       this used to fall straight to console.log() whenever
       window.showNotification wasn't ready to fire — which is exactly
       what app-patch-openchat.js's own _notify already documented and
       fixed for the 1:1 call code (window.showNotification only
       registers itself onto window the first time something ELSE in
       app-fixes.js happens to call it, and even once registered it
       silently no-ops if #reward-notification isn't in the DOM). Every
       one of window._empGroupCallStart's early-return guards below (no
       internet, please sign in again, already on another call, not
       supported) depends on this function to tell the person WHY nothing
       happened — a console-only fallback means those guards fire
       perfectly correctly but LOOK, from the tapping person's side,
       exactly like "clicking just blinks with no response." Now verifies
       the real toast can actually render before trusting it, and always
       falls back to a real on-screen toast otherwise — same fix, same
       guaranteed outcome as openchat.js's own _notify. */
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function' && document.getElementById('reward-notification')) {
            try { window.showNotification(msg, type || 'info'); return; } catch (e) {}
        }
        console.log('[GroupCall]', msg);
        _gcFallbackToast(msg, type);
    }

    function _gcFallbackToast(msg, type) {
        var el = document.getElementById('gc-fallback-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gc-fallback-toast';
            el.style.cssText = [
                'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);',
                'z-index:1000001;max-width:86vw;padding:10px 18px;border-radius:24px;',
                'font-size:0.85rem;color:#fff;text-align:center;line-height:1.3;',
                'box-shadow:0 6px 20px rgba(0,0,0,0.3);transition:opacity 0.25s;',
                'pointer-events:none;opacity:0;'
            ].join('');
            document.body.appendChild(el);
        }
        var colors = { success: '#25D366', warning: '#F5A623', error: '#E53935', info: '#1B2B8B' };
        el.style.background = colors[type] || colors.info;
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(function () { el.style.opacity = '0'; }, 2600);
    }

    /* Hard cap for both joining and mid-call "add people" — matches the
       10-tile grid layout in _injectCSS below. Full mesh means every
       additional participant adds N-1 new RTCPeerConnections across the
       call, so this is a real technical ceiling, not just a UI nicety. */
    var MAX_CALL_PARTICIPANTS = 10;

    /* FIX (2026-07-29 — group calls "connect then bounce back", deployed-
       only): this constant was still pointing at Metered's PUBLIC,
       unauthenticated example TURN credential (turn:openrelay.metered.ca,
       username/credential 'openrelayproject') — the exact same shared,
       unquota'd relay documented (and already replaced) in
       app-patch-openchat.js's own ICE_SERVERS comment. That public demo
       credential is copy-pasted into countless unrelated projects with no
       per-account quota, so it gets overloaded/rate-limited unpredictably
       — signaling (offer/answer/candidates via Firestore) succeeds, but
       the actual media relay a NAT'd real-world caller depends on doesn't,
       which is the "tries to connect, then bounces back" symptom. Never
       reproduces on localhost/same-network testing because two peers on
       the same machine/LAN find a direct host candidate and never need
       TURN at all — only real, separately-networked deployed users hit
       this. Synced here to the SAME private Metered.ca account allocation
       (own username/credential, own quota, not shared with anyone else)
       app-patch-openchat.js already uses for 1:1 calls. Still duplicated
       rather than reused across files — plain constant inside another
       file's closure, not something exported — so if this ever needs to
       change again, update BOTH files' ICE_SERVERS. */
    var ICE_SERVERS = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun.relay.metered.ca:80' },
            {
                urls: [
                    'turn:global.relay.metered.ca:80',
                    'turn:global.relay.metered.ca:80?transport=tcp',
                    'turn:global.relay.metered.ca:443',
                    'turns:global.relay.metered.ca:443?transport=tcp'
                ],
                username: '219523a651b62349bb024b66',
                credential: 'PER2BJsqnQUVCqcr'
            }
        ]
    };

    /* =========================================================================
       STATE — one active call at a time for this client (matches "one call
       per group at a time" in the data model above).
       ========================================================================= */
    var _gc = {
        active:       false,
        groupId:      null,
        callId:       null,   /* == groupId; kept as its own field for clarity at call sites */
        type:         null,   /* 'video' | 'voice' */
        myUid:        null,
        myName:       null,
        myAvatar:     null,
        localStream:  null,
        muted:        false,
        camOff:       false,
        myVideoOn:    false,   /* FIX (2026-08-01 — "voice<->video switch gets
           stuck after the first flip"): local "is MY camera currently
           contributing to this call" flag, separate from _gc.type (the
           SHARED call type, which must never get downgraded just because I
           turned my own camera off — see _switchToVoice's own comment on
           why group_calls/{id}.type is deliberately never written back to
           'voice'). _switchToVideo/_switchToVoice used to both guard on
           _gc.type alone, so after the first video escalation _gc.type
           stayed 'video' forever — _switchToVideo's `if (_gc.type ===
           'video') return;` guard then silently no-op'd on every later tap,
           and once _switchToVoice ran once (setting camOff=true) its own
           `if (_gc.type !== 'video' || _gc.camOff) return;` guard no-op'd
           too. No error either way — it just looked stuck. Now both
           guards read/write this dedicated flag instead. */
        /* FIX (2026-08-01 — "mute icon button in the guest box screen" /
           host-mute never worked): hostUid used to be read by _tileMarkup
           and _hostToggleRemoteMute but never assigned anywhere in this
           file, so the per-tile "mute for everyone" button never rendered
           for anyone, ever. Set in _joinCall from group_calls/{id}.startedBy
           (or my own uid if I'm the one starting the call). */
        hostUid:      null,
        peers:        {},     /* uid -> { pc, tileEl, name, avatar, muted, camOff, candUnsub, audioBoosted, sigId } */
        unsubPeers:   null,
        unsubSignals: null,
        unsubCallDoc: null,
        unsubSelfPeer: null,   /* listens for a host-applied forceMuteAt on MY OWN peers/{uid} doc — see _watchSelfForceMute */
        _lastForceMuteAt: null,
        callStartTs:      null,  /* ms epoch — drives the header duration timer */
        durationInterval: null,
        dialInterval:     null,   /* set while I'm the only one in the call, waiting for someone to pick up */

        /* FEATURE (2026-08-01) — call recording, mirroring the 1:1 call's
           recorder in app-patch-openchat.js (_startRecording/_stopRecording
           there) but mixing N remote peers instead of one. See §9 below. */
        recording:        false,
        recorder:         null,   /* active MediaRecorder, if recording */
        recordChunks:     [],     /* collected Blob parts while recording */
        recordAudioCtx:   null,   /* AudioContext mixing local + every remote peer's audio */
        recordCanvasTimer:null,   /* rAF/interval id compositing the tile grid to canvas (video calls only) */
        recordingBy:      null,   /* uid of whoever is currently recording (mine or a peer's), for the header note */

        /* FEATURE (2026-08-01) — minimize-to-pill. True while the call
           overlay is collapsed to the floating pill so the person can use
           the rest of the app without hanging up. See §4b below. */
        minimized:        false
    };

    function _sigId(from, to) { return from + '_' + to; }

    function _groupCallRef(groupId) { return window.fbDb.collection('group_calls').doc(groupId); }
    function _peersRef(groupId)     { return _groupCallRef(groupId).collection('peers'); }
    function _signalsRef(groupId)   { return _groupCallRef(groupId).collection('signals'); }

    /* =========================================================================
       §0 — AUDIO CUES (dial tone while waiting, join chime, remote-volume
       boost). Generated with Web Audio oscillators rather than shipped mp3
       assets — no new files/CDN dependency, and it means the exact same
       code path works for both the outgoing "ringing…" tone and the
       "someone joined" chime, just with different frequencies/timing.
       ========================================================================= */
    var _gcAudioCtx = null;
    function _getAudioCtx() {
        if (!_gcAudioCtx) {
            try { _gcAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { return null; }
        }
        if (_gcAudioCtx.state === 'suspended') { _gcAudioCtx.resume().catch(function () {}); }
        return _gcAudioCtx;
    }

    /* Plays one or more sine tones simultaneously (a two-tone ringback
       burst is two entries in freqs) for durationMs, at gainVal volume
       (0-1). Fire-and-forget — the oscillator stops and gets garbage
       collected on its own. */
    function _playTone(freqs, durationMs, gainVal) {
        var ctx = _getAudioCtx();
        if (!ctx) return;
        var gain = ctx.createGain();
        gain.gain.value = gainVal || 0.15;
        gain.connect(ctx.destination);
        freqs.forEach(function (f) {
            var osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = f;
            osc.connect(gain);
            osc.start();
            osc.stop(ctx.currentTime + durationMs / 1000);
        });
    }

    /* "Ringing…" — standard US ringback cadence (2s tone, 4s silence),
       repeated for as long as I'm the only one in the call. Stopped the
       moment a peer's presence doc appears (_watchPeers 'added') or I
       leave, whichever comes first — never left running once someone has
       actually picked up. */
    function _startDialTone() {
        _stopDialTone();
        _playTone([440, 480], 2000, 0.12);
        _gc.dialInterval = setInterval(function () { _playTone([440, 480], 2000, 0.12); }, 6000);
    }
    function _stopDialTone() {
        if (_gc.dialInterval) { clearInterval(_gc.dialInterval); _gc.dialInterval = null; }
    }

    /* Short two-note chime played locally whenever a new participant's
       tile lands in the grid — both for the person who was waiting
       (doubles as "call connected") and for everyone else already on the
       call when someone new joins mid-call. */
    function _playJoinChime() {
        _playTone([587.33], 150, 0.18);
        setTimeout(function () { _playTone([880], 180, 0.18); }, 160);
    }

    /* Remote audio was coming out quiet on some devices because it only
       ever played at the <video> element's own volume (max 1.0, and some
       mobile browsers/output routes attenuate that further). Routing the
       remote MediaStream through a Web Audio GainNode lets it be boosted
       PAST 1.0 — the <video> element itself is then muted (video frames
       still render normally; muted only silences its own audio path) so
       the stream isn't heard twice. Guarded by entry.audioBoosted so a
       renegotiation re-firing ontrack on the same peer doesn't wire up a
       second graph. */
    function _boostRemoteAudio(entry, stream) {
        if (entry.audioBoosted) return;
        var ctx = _getAudioCtx();
        if (!ctx) return;
        try {
            var src = ctx.createMediaStreamSource(stream);
            var gainNode = ctx.createGain();
            gainNode.gain.value = 1.6; /* ~+4dB over unity */
            src.connect(gainNode);
            gainNode.connect(ctx.destination);
            entry.audioBoosted = true;
        } catch (e) { /* e.g. stream with no audio tracks yet — fine, ontrack fires again once it does */ }
    }

    /* =========================================================================
       §1 — PEER CONNECTION HELPERS (shared by both "I'm offering to an
       existing peer" and "I'm answering a peer who just offered to me" —
       the only difference between those two paths is who calls
       createOffer vs createAnswer; everything else is identical, so it
       lives here once instead of twice.)
       ========================================================================= */
    function _closePeer(uid) {
        var p = _gc.peers[uid];
        if (!p) return;
        if (p.candUnsub) { try { p.candUnsub(); } catch (e) {} }
        if (p.pc) { try { p.pc.close(); } catch (e) {} }
        if (p.tileEl && p.tileEl.parentNode) p.tileEl.parentNode.removeChild(p.tileEl);
        delete _gc.peers[uid];
    }

    function _closeAllPeers() {
        Object.keys(_gc.peers).forEach(_closePeer);
    }

    /* FIX (2026-08-01 — "can't hear each other, including the initiator"):
       onicecandidate used to recompute sigId as _sigId(myUid, remoteUid)
       ("myUid_remoteUid") on EVERY peer connection, offerer or answerer.
       That's only correct for the offering side — the doc id is always
       "{fromUid}_{toUid}" of whoever sent the ORIGINAL offer (see _sigId's
       own doc comment). When I'm the ANSWERING side (_answerFrom), the
       real shared doc is "{remoteUid}_{myUid}", not "{myUid}_{remoteUid}"
       — so every answerer's own trickled ICE candidates were being
       written into a doc nobody ever created or listened to, a silent
       black hole. The offerer's SDP answer still arrived fine (that part
       correctly used the real sigId passed into _answerFrom), so the
       connection would often reach a signaling state that LOOKED
       connected while one direction's candidates never trickled in —
       exactly the asymmetric "nobody can hear the other side" symptom.
       Now the correct sigId is passed in once at connection-creation time
       (by whichever caller actually knows it) and reused verbatim by
       onicecandidate for the life of that peer connection, instead of
       being re-derived from an assumption that's only true half the time. */
    function _createPeerConnection(remoteUid, remoteName, remoteAvatar, sigId) {
        var pc = new RTCPeerConnection(ICE_SERVERS);
        var entry = _gc.peers[remoteUid] = {
            pc: pc, tileEl: null, name: remoteName || 'Member', avatar: remoteAvatar || '',
            muted: false, camOff: false, candUnsub: null, sigId: sigId
        };
        _renderTile(remoteUid, entry);

        pc.onicecandidate = function (e) {
            if (!e.candidate || !_fbOk() || !_gc.active) return;
            var sigId = entry.sigId;
            if (!sigId) return; /* shouldn't happen — every caller now passes one */
            try {
                _signalsRef(_gc.groupId).doc(sigId).collection('candidates').add({
                    candidate:     e.candidate.candidate,
                    sdpMid:        e.candidate.sdpMid,
                    sdpMLineIndex: e.candidate.sdpMLineIndex,
                    from:          _gc.myUid
                }).catch(function () {});
            } catch (ex) {}
        };

        pc.ontrack = function (e) {
            var stream = e.streams && e.streams[0];
            if (!stream) { stream = new MediaStream(); stream.addTrack(e.track); }
            var mediaEl = entry.tileEl && entry.tileEl.querySelector('video,audio');
            if (mediaEl) {
                mediaEl.srcObject = stream;
                mediaEl.volume = 1.0;
                mediaEl.muted = true; /* audio plays via the boosted Web Audio graph below, not this element */
                mediaEl.play().catch(function () {});
            }
            _boostRemoteAudio(entry, stream);
        };

        pc.onconnectionstatechange = function () {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                /* Don't tear the whole call down for one bad peer link —
                   only that one participant's tile goes stale. They'll
                   reappear if they reconnect and re-offer, and their tile
                   is cleaned up properly the moment their peers/{uid}
                   presence doc is removed (see _watchPeers below). */
                console.warn('[GroupCall] connection to ' + remoteUid + ' ' + pc.connectionState);
            }
        };

        if (_gc.localStream) {
            _gc.localStream.getTracks().forEach(function (t) { pc.addTrack(t, _gc.localStream); });
        }

        return { pc: pc, entry: entry };
    }

    /* I already know about remoteUid (they were in the call when I joined,
       or I just watched their peers/{uid} doc appear) — I offer to them. */
    function _offerTo(remoteUid, remoteName, remoteAvatar) {
        if (_gc.peers[remoteUid]) return; /* already connected/connecting */
        var sigId = _sigId(_gc.myUid, remoteUid);
        var made = _createPeerConnection(remoteUid, remoteName, remoteAvatar, sigId);
        var pc = made.pc;

        pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () {
                return _signalsRef(_gc.groupId).doc(sigId).set({
                    from: _gc.myUid, to: remoteUid,
                    offer: { type: offer.type, sdp: offer.sdp },
                    createdAt: new Date().toISOString()
                });
            });
        }).then(function () {
            /* Listen for their answer on this same doc */
            var unsub = _signalsRef(_gc.groupId).doc(sigId).onSnapshot(function (snap) {
                if (!snap.exists) return;
                var d = snap.data();
                if (d.answer && pc.currentRemoteDescription == null) {
                    pc.setRemoteDescription(new RTCSessionDescription(d.answer)).catch(function () {});
                }
            }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
            var p = _gc.peers[remoteUid];
            if (p) p.answerUnsub = unsub;
            /* Their candidates arrive tagged from:remoteUid in this same doc's subcollection */
            var candUnsub = _signalsRef(_gc.groupId).doc(sigId).collection('candidates')
                .onSnapshot(function (snap) {
                    snap.docChanges().forEach(function (ch) {
                        if (ch.type !== 'added') return;
                        var d = ch.doc.data();
                        if (d.from !== remoteUid) return;
                        pc.addIceCandidate(new RTCIceCandidate({
                            candidate: d.candidate, sdpMid: d.sdpMid, sdpMLineIndex: d.sdpMLineIndex
                        })).catch(function () {});
                    });
                }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
            if (p) p.candUnsub = candUnsub;
        }).catch(function (err) {
            console.warn('[GroupCall] offer to ' + remoteUid + ' failed:', err.message);
        });
    }

    /* remoteUid offered to ME — I answer. */
    function _answerFrom(remoteUid, sigId, offer, remoteName, remoteAvatar) {
        if (_gc.peers[remoteUid]) return;
        var made = _createPeerConnection(remoteUid, remoteName, remoteAvatar, sigId);
        var pc = made.pc;

        pc.setRemoteDescription(new RTCSessionDescription(offer))
            .then(function () { return pc.createAnswer(); })
            .then(function (answer) {
                return pc.setLocalDescription(answer).then(function () {
                    return _signalsRef(_gc.groupId).doc(sigId).update({
                        answer: { type: answer.type, sdp: answer.sdp }
                    });
                });
            }).then(function () {
                var candUnsub = _signalsRef(_gc.groupId).doc(sigId).collection('candidates')
                    .onSnapshot(function (snap) {
                        snap.docChanges().forEach(function (ch) {
                            if (ch.type !== 'added') return;
                            var d = ch.doc.data();
                            if (d.from !== remoteUid) return;
                            pc.addIceCandidate(new RTCIceCandidate({
                                candidate: d.candidate, sdpMid: d.sdpMid, sdpMLineIndex: d.sdpMLineIndex
                            })).catch(function () {});
                        });
                    }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
                var p = _gc.peers[remoteUid];
                if (p) p.candUnsub = candUnsub;
            }).catch(function (err) {
                console.warn('[GroupCall] answer to ' + remoteUid + ' failed:', err.message);
            });
    }

    /* =========================================================================
       §2 — PRESENCE: who's in the call right now
       ========================================================================= */
    function _watchPeers() {
        _gc.unsubPeers = _peersRef(_gc.groupId).onSnapshot(function (snap) {
            snap.docChanges().forEach(function (ch) {
                var uid = ch.doc.id;
                if (uid === _gc.myUid) return; /* my own presence doc, not a peer of myself */
                var d = ch.doc.data();
                if (ch.type === 'added') {
                    /* FIX (2026-08-01 — Issue #4: "people from the previous
                       call automatically display on screen"): the comment
                       this replaces assumed 'added' could only ever mean a
                       genuinely new joiner here, because the initial join
                       sweep already handles everyone present at join time
                       via a one-time .get(). That's wrong — Firestore's
                       onSnapshot ALWAYS redelivers every currently-matching
                       document as an 'added' change on the very first
                       callback after the listener attaches, regardless of
                       whether the one-time .get() sweep moments earlier
                       already saw (and correctly skipped, if stale) that
                       same doc. So every stale peer doc from a previous
                       call generation was being re-offered a SECOND time
                       right here, bypassing the join sweep's callStartedAt
                       cutoff entirely — that's exactly why a previous
                       call's participants kept reappearing. Apply the same
                       cutoff here so a stale doc can never slip through
                       this path either. Also skip re-offering a peer we
                       already have a live connection for (defensive, in
                       case this listener's first callback and the join
                       sweep both attempt the same real, current peer). */
                    if (_gc.peers[uid]) return;
                    var cutoffNow = _gc.callStartedAt ? new Date(_gc.callStartedAt).getTime() : 0;
                    var joinedMsNow = d.joinedAt ? new Date(d.joinedAt).getTime() : 0;
                    if (cutoffNow && joinedMsNow && joinedMsNow < cutoffNow) {
                        console.warn('[GroupCall] ignoring stale peer doc via peers listener:', uid);
                        return;
                    }
                    _stopDialTone();
                    _playJoinChime();
                    _offerTo(uid, d.name, d.avatar);
                } else if (ch.type === 'modified') {
                    var p = _gc.peers[uid];
                    if (p) { p.muted = !!d.muted; p.camOff = !!d.camOff; _updateTileBadges(uid); }
                } else if (ch.type === 'removed') {
                    _closePeer(uid);
                }
            });
            _updateHeadcount();
        }, function (err) { console.warn('[GroupCall] peers listener error:', err.message); });
    }

    /* =========================================================================
       §3 — INCOMING SIGNALS: offers addressed to me from peers who joined
       after me (the ones _offerTo already covers only handles peers who
       were already present at MY join time — the reverse direction, where
       a later joiner offers to ME, is handled here).
       ========================================================================= */
    function _watchIncomingSignals() {
        _gc.unsubSignals = _signalsRef(_gc.groupId).where('to', '==', _gc.myUid)
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (ch) {
                    if (ch.type !== 'added') return;
                    var d = ch.doc.data();
                    if (!d.offer) return;
                    /* An offer from someone I ALREADY have a peer connection
                       with is a renegotiation (e.g. they just switched the
                       call to video and added their camera track), not a
                       brand-new peer — reuse the existing RTCPeerConnection
                       instead of _answerFrom's "already connected, skip"
                       fresh-peer path. */
                    if (_gc.peers[d.from]) {
                        _answerRenegotiation(d.from, ch.doc.id, d.offer);
                        return;
                    }
                    var pd = _peersRef(_gc.groupId).doc(d.from);
                    pd.get().then(function (peerSnap) {
                        var pdata = peerSnap.exists ? peerSnap.data() : {};
                        _answerFrom(d.from, ch.doc.id, d.offer, pdata.name, pdata.avatar);
                    }).catch(function () {
                        _answerFrom(d.from, ch.doc.id, d.offer, 'Member', '');
                    });
                });
            }, function (err) { console.warn('[GroupCall] signals listener error:', err.message); });
    }

    /* Answers a renegotiation offer on an EXISTING peer connection (see
       _watchIncomingSignals above). Mirrors _answerFrom's shape but never
       creates a new RTCPeerConnection or tile — the tile/pc from the
       original connection stay exactly as they are; only the SDP exchange
       and this one offer/answer doc's own candidate subcollection differ. */
    function _answerRenegotiation(remoteUid, sigId, offer) {
        var entry = _gc.peers[remoteUid];
        if (!entry || !entry.pc) return;
        var pc = entry.pc;
        pc.setRemoteDescription(new RTCSessionDescription(offer))
            .then(function () { return pc.createAnswer(); })
            .then(function (answer) {
                return pc.setLocalDescription(answer).then(function () {
                    return _signalsRef(_gc.groupId).doc(sigId).update({
                        answer: { type: answer.type, sdp: answer.sdp }
                    });
                });
            }).then(function () {
                _signalsRef(_gc.groupId).doc(sigId).collection('candidates')
                    .onSnapshot(function (candSnap) {
                        candSnap.docChanges().forEach(function (ch2) {
                            if (ch2.type !== 'added') return;
                            var dd = ch2.doc.data();
                            if (dd.from !== remoteUid) return;
                            pc.addIceCandidate(new RTCIceCandidate({
                                candidate: dd.candidate, sdpMid: dd.sdpMid, sdpMLineIndex: dd.sdpMLineIndex
                            })).catch(function () {});
                        });
                    }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
                /* Their video track arrives via the existing pc.ontrack
                   handler (same MediaStream, now carrying a video track
                   too) — just flip the tile from avatar to video now that
                   the renegotiation succeeded. */
                entry.camOff = false;
                _updateTileBadges(remoteUid);
            }).catch(function (err) {
                console.warn('[GroupCall] renegotiation answer to ' + remoteUid + ' failed:', err.message);
            });
    }

    /* Offering side of a renegotiation (see _switchToVideo below) — a NEW
       signals doc per attempt (id suffixed with a timestamp) rather than
       reusing/overwriting the original offer/answer doc, specifically so
       the peer's _watchIncomingSignals listener sees it as a fresh 'added'
       doc-change (it deliberately ignores 'modified' on that collection).
       _sigParticipant() on the receiving end still resolves correctly
       since it only reads the first two underscore-separated segments of
       the doc id. */
    function _renegotiateWithPeer(remoteUid) {
        var entry = _gc.peers[remoteUid];
        if (!entry || !entry.pc) return;
        var pc = entry.pc;

        /* FIX (2026-08-01 — "switch to video never worked" / repeated
           "SDP is modified in a non-acceptable way" errors): this used to
           call createOffer() unconditionally. createOffer()/
           setLocalDescription() are only valid to run back-to-back when
           the connection is 'stable' — if a PREVIOUS renegotiation to
           this same peer is still mid-flight (signalingState is
           'have-local-offer', waiting on their answer), starting a
           SECOND one here generates an offer against a connection whose
           negotiation state has already moved on, and Chrome rejects the
           setLocalDescription() call with exactly this error. That's
           precisely what an unguarded _switchToVideo (see its own fix
           note) could trigger: an impatient re-tap while the first
           attempt's getUserMedia+addTrack+renegotiate was still running
           fired a second, colliding negotiation on this same pc. Now:
           only actually stable connections proceed; a genuinely
           overlapping call here just no-ops with a console note instead
           of corrupting the negotiation both attempts needed. */
        if (pc.signalingState !== 'stable') {
            console.warn('[GroupCall] skipping renegotiation with ' + remoteUid + ' — connection not stable yet (state: ' + pc.signalingState + ')');
            return;
        }

        var sigId = _sigId(_gc.myUid, remoteUid) + '_r' + Date.now();

        pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () {
                return _signalsRef(_gc.groupId).doc(sigId).set({
                    from: _gc.myUid, to: remoteUid,
                    offer: { type: offer.type, sdp: offer.sdp },
                    createdAt: new Date().toISOString()
                });
            });
        }).then(function () {
            _signalsRef(_gc.groupId).doc(sigId).onSnapshot(function (docSnap) {
                if (!docSnap.exists) return;
                var d = docSnap.data();
                if (d.answer && pc.signalingState === 'have-local-offer') {
                    pc.setRemoteDescription(new RTCSessionDescription(d.answer)).catch(function () {});
                }
            }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
            _signalsRef(_gc.groupId).doc(sigId).collection('candidates')
                .onSnapshot(function (candSnap) {
                    candSnap.docChanges().forEach(function (ch) {
                        if (ch.type !== 'added') return;
                        var d = ch.doc.data();
                        if (d.from !== remoteUid) return;
                        pc.addIceCandidate(new RTCIceCandidate({
                            candidate: d.candidate, sdpMid: d.sdpMid, sdpMLineIndex: d.sdpMLineIndex
                        })).catch(function () {});
                    });
                }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
        }).catch(function (err) {
            console.warn('[GroupCall] renegotiate offer to ' + remoteUid + ' failed:', err.message);
        });
    }

    /* =========================================================================
       §4 — UI: full-screen call overlay, grid of participant tiles
       ========================================================================= */
    function _injectCSS() {
        if (document.getElementById('_gc_css')) return;
        var s = document.createElement('style');
        s.id = '_gc_css';
        s.textContent = [
            '#gc-view{position:fixed;inset:0;z-index:9999995;background:#0A0E27;display:flex;flex-direction:column;}',
            '#gc-header{display:flex;align-items:center;gap:10px;padding:12px 16px;color:#fff;flex-shrink:0;}',
            '#gc-header-title{flex:1;font-weight:700;font-size:0.95rem;}',
            '#gc-header-sub{font-size:0.72rem;color:rgba(255,255,255,0.65);}',
            '#gc-header-duration{font-size:0.72rem;color:rgba(255,255,255,0.65);font-variant-numeric:tabular-nums;flex-shrink:0;}',
            /* auto-fill instead of a fixed 2 columns: stays 2-up on a
               narrow phone (each tile clamped to a 130px minimum) but
               naturally grows to 3-4 columns on wider screens as tiles
               are added, all the way up to MAX_CALL_PARTICIPANTS (10). */
            '#gc-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;padding:14px;align-content:start;}',
            '.gc-tile{position:relative;aspect-ratio:1/1;border-radius:16px;background:#1B2B8B;overflow:hidden;display:flex;align-items:center;justify-content:center;}',
            '.gc-tile video{width:100%;height:100%;object-fit:cover;}',
            '.gc-tile.gc-self video{transform:scaleX(-1);}',
            '.gc-tile-avatar{width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.35);}',
            '.gc-tile-name{position:absolute;left:8px;bottom:8px;font-size:0.72rem;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.8);font-weight:600;}',
            '.gc-tile-muted{position:absolute;right:8px;bottom:8px;width:22px;height:22px;border-radius:50%;background:rgba(225,29,72,0.92);display:flex;align-items:center;justify-content:center;}',
            '.gc-host-mute-btn{position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:50%;border:none;background:rgba(0,0,0,0.55);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;}',
            '.gc-host-mute-btn.active{background:rgba(225,29,72,0.92);}',
            '#gc-controls{display:flex;align-items:center;justify-content:center;gap:16px;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));flex-shrink:0;}',
            '.gc-ctrl-btn{width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.14);color:#fff;transition:background 0.15s;}',
            '.gc-ctrl-btn.active{background:rgba(225,29,72,0.92);}',
            '.gc-ctrl-btn.gc-leave{background:#E53935;width:60px;height:60px;}',
            /* FEATURE (2026-08-01) — recording indicator, isolated class/
               keyframe names (gc- prefix) so this can't collide with the
               1:1 call's own oc-rec-indicator/oc-rec-pulse in
               app-patch-openchat.js even though both are on screen in
               different contexts. */
            '#gc-rec-indicator{display:none;align-items:center;gap:6px;font-size:0.72rem;color:#ff5252;font-weight:700;flex-shrink:0;margin-right:4px;}',
            '#gc-rec-indicator .gc-rec-dot{width:8px;height:8px;border-radius:50%;background:#ff5252;animation:gc-rec-pulse 1s infinite;}',
            '@keyframes gc-rec-pulse{0%,100%{opacity:1}50%{opacity:0.25}}',
            /* FEATURE (2026-08-01) — minimize-to-pill, WhatsApp-style: lets
               the call keep running (media/tracks untouched, nothing torn
               down) while the person navigates the rest of the app.
               #gc-minimize-btn sits in the header next to the title;
               #gc-view.gc-minimized collapses the same overlay element
               (never destroyed/rebuilt) down to a small draggable-free
               corner pill that only shows the essentials (live dot, title,
               duration) and forwards a tap anywhere on it back to
               _restoreCall — see the wiring in _buildCallView. */
            '#gc-minimize-btn{width:34px;height:34px;border-radius:50%;border:none;background:rgba(255,255,255,0.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;margin-right:2px;transition:background 0.15s;}',
            '#gc-minimize-btn:active{background:rgba(255,255,255,0.24);}',
            '#gc-view.gc-minimized{width:136px;height:78px;inset:auto;bottom:calc(88px + env(safe-area-inset-bottom,0px));right:14px;border-radius:20px;box-shadow:0 10px 32px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.09);cursor:pointer;transition:box-shadow 0.15s;}',
            '#gc-view.gc-minimized:active{box-shadow:0 4px 16px rgba(0,0,0,0.5);}',
            '#gc-view.gc-minimized #gc-grid,#gc-view.gc-minimized #gc-controls,#gc-view.gc-minimized #gc-rec-indicator,#gc-view.gc-minimized #gc-minimize-btn{display:none !important;}',
            '#gc-view.gc-minimized #gc-header{height:100%;padding:0 14px;}',
            '#gc-view.gc-minimized #gc-header-sub{display:none;}',
            '#gc-view.gc-minimized #gc-header-title{font-size:0.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;}',
            '#gc-view.gc-minimized #gc-header-title::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#25D366;margin-right:6px;flex-shrink:0;animation:gc-rec-pulse 1.6s infinite;}',
            '#gc-view.gc-minimized #gc-header-duration{font-size:0.8rem;font-weight:700;}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function _premiumMicSvg(muted) {
        return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor"/>' +
            '<path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
            '<line x1="12" y1="18" x2="12" y2="20.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
            '<line x1="8.2" y1="21" x2="15.8" y2="21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
            (muted ? '<line x1="3.5" y1="20.5" x2="20.5" y2="3.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>' : '') +
            '</svg>';
    }
    function _cameraSvg(off) {
        return '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>' +
            (off ? '<line x1="2" y1="21" x2="21" y2="2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '') +
            '</svg>';
    }
    function _flipSvg() {
        return '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M9 12c0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3-3 1.34-3 3zm-4.5 0A7.5 7.5 0 0 1 12 4.5c2.04 0 3.88.82 5.22 2.14L15 9h6V3l-2.14 2.14A9.48 9.48 0 0 0 12 3C7.03 3 3.01 7.01 3 12H4.5zm13.5 0A7.5 7.5 0 0 1 12 19.5a7.44 7.44 0 0 1-5.22-2.14L9 15H3v6l2.14-2.14A9.48 9.48 0 0 0 12 21c4.97 0 8.99-4.01 9-9H19.5z"/></svg>';
    }
    /* FEATURE (2026-08-01) — minimize icon: a classic chevron folding
       inward, the same visual language WhatsApp/Messenger use for
       "collapse this call" (distinct from a plain down-arrow, which reads
       as "scroll" rather than "minimize"). Kept as its own outline glyph
       rather than reusing an existing icon so it can't be confused with
       any other control in this row. */
    function _minimizeSvg() {
        return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M15 4.5h4.5V9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M19.5 4.5 13.5 10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
            '<path d="M9 19.5H4.5V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M4.5 19.5 10.5 13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
            '</svg>';
    }
    /* FEATURE (2026-08-01 — Issue #5): video→voice switch-back icon,
       matching the one added to app-patch-openchat.js's 1:1 call for the
       same feature. Deliberately distinct from _flipSvg above, which is
       the unrelated front/back camera flip and is left untouched. */
    function _voiceOnlySvg() {
        return '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
    }
    function _addPersonSvg() {
        return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="9" cy="8" r="3.4" stroke="currentColor" stroke-width="1.8"/>' +
            '<path d="M2.5 19c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
            '<line x1="18.5" y1="7.5" x2="18.5" y2="14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
            '<line x1="15" y1="11" x2="22" y2="11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
        '</svg>';
    }
    function _hangupSvg() {
        return '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.29.42-.29.69 0 .28.11.53.29.71l2.2 2.2c.18.18.43.29.71.29.27 0 .5-.1.68-.28.79-.74 1.69-1.35 2.67-1.84.33-.16.56-.5.56-.9v-3.1c1.45-.47 3-.72 4.6-.72s3.15.25 4.6.72v3.1c0 .4.23.74.56.9.98.49 1.88 1.1 2.67 1.84.18.18.42.28.68.28.28 0 .53-.11.71-.29l2.2-2.2c.18-.18.29-.43.29-.71 0-.27-.11-.51-.29-.69-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>';
    }
    /* FEATURE (2026-08-01) — record button icon, matching the plain filled-
       circle "REC" glyph already used for this same feature in the 1:1
       call controls (app-patch-openchat.js's SVG.recDot), so both call
       surfaces read as the same feature. */
    function _recSvg() {
        return '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8"/></svg>';
    }

    /* =========================================================================
       §5 — LOCAL MEDIA
       ========================================================================= */
    function _getLocalMedia(type) {
        var constraints = { audio: true, video: type === 'video' ? { facingMode: 'user' } : false };
        return navigator.mediaDevices.getUserMedia(constraints);
    }

    /* =========================================================================
       §6 — TILE RENDERING (self tile + remote tiles share the same markup
       shape so _updateTileBadges/ontrack can treat them identically)
       ========================================================================= */
    /* FEATURE (2026-08-01 — host mute control): the host (whoever's
       group_calls/{groupId}.startedBy uid I captured at join time, see
       _joinCall) gets an extra small mic-slash button on every OTHER
       participant's tile. Never shown on my own tile (isSelf) or to
       non-hosts. Clicking it writes forceMuteAt/forceMuteBy onto that
       peer's OWN peers/{uid} doc — it can't reach into their browser and
       flip a track directly, so each participant's own client (see the
       self-peer listener wired in _joinCall) is what actually disables
       its local mic the moment that field changes; this button only
       triggers that. */
    function _tileMarkup(uid, name, avatar, muted, showVideo, isSelf) {
        var hostBtn = (!isSelf && _gc.hostUid && _gc.myUid === _gc.hostUid)
            ? '<button class="gc-host-mute-btn' + (muted ? ' active' : '') + '" data-host-mute-uid="' + _esc(uid) + '" title="' + (muted ? 'Unmute' : 'Mute') + ' for everyone">' + _premiumMicSvg(true) + '</button>'
            : '';
        return '<video autoplay playsinline' + (isSelf ? ' muted' : '') + ' style="' + (showVideo ? '' : 'display:none;') + '"></video>' +
            '<img class="gc-tile-avatar" style="' + (showVideo ? 'display:none;' : '') + '" src="' +
                _esc(avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff')) + '">' +
            '<span class="gc-tile-name">' + _esc(name) + (isSelf ? ' (You)' : '') + '</span>' +
            '<span class="gc-tile-muted" style="' + (muted ? '' : 'display:none;') + '">' + _premiumMicSvg(true) + '</span>' +
            hostBtn;
    }

    /* Host tap on a remote tile's mic-slash button. Toggles: if they're
       already muted (per the LAST peers doc state I have), this unmutes by
       just clearing forceMuteAt so their own client-side gate reopens —
       actual re-enabling of their track still happens on THEIR device via
       the same self-peer listener, same as a normal self-unmute; the host
       can't force someone's mic back on without them being in the room to
       apply it, same physical constraint as muting. */
    function _hostToggleRemoteMute(uid, currentlyMuted) {
        /* FIX (2026-08-01 — "host mute button, clicking does nothing"):
           this used to bail out with a bare `return` and zero feedback
           whenever _gc.myUid !== _gc.hostUid — which is exactly what a
           genuine tap from the real host LOOKS like from the tapping
           person's side if _gc.myUid was captured (at _joinCall time,
           from _authUid()) before Firebase's anonymous/real auth session
           had actually resolved, leaving it null/stale while the button
           itself still rendered off _gc.hostUid. Re-reading the LIVE auth
           uid here (fresh, not the join-time snapshot) closes that race;
           the function now also always tells the tapping person WHY
           nothing happened instead of silently no-op'ing, so a real
           permission gap (not a host) is visibly reported instead of
           looking identical to "the button is broken". */
        var liveUid = _authUid() || _gc.myUid;
        if (!_gc.groupId) return; // not in an active call — nothing to click on in practice
        if (!_gc.hostUid || liveUid !== _gc.hostUid) {
            console.warn('[GroupCall] host mute tap ignored — liveUid=' + liveUid + ' hostUid=' + _gc.hostUid);
            _notify('Only the person who started this call can mute others.', 'info');
            return;
        }
        var update = currentlyMuted
            ? { forceMuteAt: null, forceMuteBy: null }
            : { forceMuteAt: new Date().toISOString(), forceMuteBy: liveUid };
        _peersRef(_gc.groupId).doc(uid).update(update).then(function () {
            _notify(currentlyMuted ? 'Unmuted for that participant.' : 'Muted for everyone.', 'success');
        }).catch(function (err) {
            console.error('[GroupCall] host mute toggle failed:', err && (err.code || err.message));
            _notify('Could not ' + (currentlyMuted ? 'unmute' : 'mute') + ' that participant — ' +
                (err && err.code === 'permission-denied' ? 'the group_calls/peers security rule may need deploying.' : (err.message || '')), 'error');
        });
    }

    /* Called by _createPeerConnection right after it builds a peer's entry —
       entry.tileEl is null at that point; this fills it in and hands back
       nothing (entry is mutated in place, matching how ontrack/_updateTileBadges
       already expect to find entry.tileEl afterwards). */
    function _renderTile(uid, entry) {
        var grid = document.getElementById('gc-grid');
        if (!grid) return;
        var tile = document.createElement('div');
        tile.className = 'gc-tile';
        tile.setAttribute('data-uid', uid);
        var showVideo = _gc.type === 'video' && !entry.camOff;
        tile.innerHTML = _tileMarkup(uid, entry.name, entry.avatar, entry.muted, showVideo, false);
        grid.appendChild(tile);
        entry.tileEl = tile;
        _wireHostMuteBtn(tile, uid);
    }

    function _wireHostMuteBtn(tile, uid) {
        var btn = tile.querySelector('.gc-host-mute-btn');
        if (!btn) return;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var entry = _gc.peers[uid];
            _hostToggleRemoteMute(uid, !!(entry && entry.muted));
        });
    }

    /* FIX (2026-08-01 — the other half of the host-mute button never
       working): _hostToggleRemoteMute only ever WROTE forceMuteAt onto the
       target's own peers/{uid} doc — nothing in this file ever listened
       for that field changing on MY OWN doc, so a host tapping "mute for
       everyone" wrote the field successfully but the targeted person's mic
       never actually turned off; only the host's optimistic local button
       state looked like anything happened. This is that missing listener:
       on my own peers/{myUid} doc, a forceMuteAt that's newer than the
       last one I've already applied means the host just muted me — flip
       my own track off exactly like tapping the self-mute button, so
       everyone (including the host) sees it reflected consistently via
       the normal muted:true write _toggleMute already does. This never
       auto-UNMUTES on a cleared forceMuteAt — matching this feature's own
       physical-constraint note above, the host can't force someone's mic
       back on for them; clearing the flag only re-enables the person's
       own mute button, it doesn't touch their track. */
    function _watchSelfForceMute(groupId) {
        if (_gc.unsubSelfPeer) { try { _gc.unsubSelfPeer(); } catch (e) {} }
        _gc._lastForceMuteAt = null;
        _gc.unsubSelfPeer = _peersRef(groupId).doc(_gc.myUid).onSnapshot(function (doc) {
            if (!doc.exists) return;
            var d = doc.data();
            var at = d.forceMuteAt || null;
            if (at && at !== _gc._lastForceMuteAt && !_gc.muted) {
                _gc._lastForceMuteAt = at;
                _toggleMute(); /* forces mic off + writes muted:true, same path as the self mute button */
                _notify('You were muted by the host', 'info');
            } else if (at) {
                _gc._lastForceMuteAt = at;
            }
        }, function (err) { console.warn('[GroupCall] self peer listener error:', err.message); });
    }

    function _renderSelfTile() {
        var grid = document.getElementById('gc-grid');
        if (!grid) return;
        var existing = grid.querySelector('.gc-tile.gc-self');
        if (existing) existing.parentNode.removeChild(existing);
        var tile = document.createElement('div');
        tile.className = 'gc-tile gc-self';
        tile.setAttribute('data-uid', _gc.myUid);
        var showVideo = _gc.type === 'video' && !_gc.camOff;
        tile.innerHTML = _tileMarkup(_gc.myUid, _gc.myName, _gc.myAvatar, false, showVideo, true);
        grid.appendChild(tile);
        var videoEl = tile.querySelector('video');
        if (videoEl && _gc.localStream) { videoEl.srcObject = _gc.localStream; videoEl.play().catch(function () {}); }
    }

    function _updateTileBadges(uid) {
        var entry = _gc.peers[uid];
        if (!entry || !entry.tileEl) return;
        var mutedEl = entry.tileEl.querySelector('.gc-tile-muted');
        if (mutedEl) mutedEl.style.display = entry.muted ? 'flex' : 'none';
        var showVideo = _gc.type === 'video' && !entry.camOff;
        var videoEl = entry.tileEl.querySelector('video');
        var avatarEl = entry.tileEl.querySelector('.gc-tile-avatar');
        if (videoEl) videoEl.style.display = showVideo ? '' : 'none';
        if (avatarEl) avatarEl.style.display = showVideo ? 'none' : '';
    }

    /* Header count — written to both the local header text and the shared
       group_calls/{groupId}.activeCount field (any group member can update
       that field per firebase-rules.js's broad group_calls update rule,
       documented there as exactly this "mute-count bookkeeping" case), so
       the "N in call" banner in app-patch-v13.js's group chat header stays
       in sync without needing a transaction. */
    function _updateHeadcount() {
        var count = Object.keys(_gc.peers).length + 1;
        var sub = document.getElementById('gc-header-sub');
        if (sub) sub.textContent = count + (count === 1 ? ' in call' : ' in call');
        if (_gc.groupId) {
            _groupCallRef(_gc.groupId).update({ activeCount: count }).catch(function () {});
        }
    }

    /* Call duration — based on the shared group_calls/{groupId}.startedAt
       (fetched once in _joinCall), not local join time, so everyone in
       the call sees the same elapsed time regardless of when THEY joined. */
    function _fmtDuration(ms) {
        var totalSec = Math.max(0, Math.floor(ms / 1000));
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        function pad(n) { return n < 10 ? '0' + n : '' + n; }
        return (h > 0 ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
    }
    function _updateDurationDisplay() {
        var el = document.getElementById('gc-header-duration');
        if (!el || !_gc.callStartTs) return;
        el.textContent = _fmtDuration(Date.now() - _gc.callStartTs);
    }
    function _startDurationTimer(startedAtIso) {
        var ts = startedAtIso ? new Date(startedAtIso).getTime() : NaN;
        _gc.callStartTs = isNaN(ts) ? Date.now() : ts;
        _updateDurationDisplay();
        if (_gc.durationInterval) clearInterval(_gc.durationInterval);
        _gc.durationInterval = setInterval(_updateDurationDisplay, 1000);
    }
    function _stopDurationTimer() {
        if (_gc.durationInterval) { clearInterval(_gc.durationInterval); _gc.durationInterval = null; }
        _gc.callStartTs = null;
    }

    /* =========================================================================
       §7 — CALL OVERLAY UI (header, tile grid, controls)
       ========================================================================= */
    function _buildCallView() {
        var existing = document.getElementById('gc-view');
        if (existing) existing.parentNode.removeChild(existing);

        var view = document.createElement('div');
        view.id = 'gc-view';
        view.innerHTML =
            '<div id="gc-header">' +
              /* FEATURE (2026-08-01) — minimize-to-pill: lets the person
                 back out to the rest of the app (any section, any nav
                 path) without leaving the call — see _minimizeCall and the
                 gc-minimized CSS above. Placed first in the header, same
                 corner WhatsApp/Messenger use for this control. */
              '<button id="gc-minimize-btn" class="gc-ctrl-btn" title="Minimize call">' + _minimizeSvg() + '</button>' +
              '<div style="flex:1;min-width:0;">' +
                '<div id="gc-header-title">' + _esc(_gc.type === 'video' ? 'Video call' : 'Voice call') + '</div>' +
                '<div id="gc-header-sub">1 in call</div>' +
              '</div>' +
              '<div id="gc-rec-indicator"><span class="gc-rec-dot"></span><span id="gc-rec-indicator-label">Recording</span></div>' +
              '<div id="gc-header-duration">00:00</div>' +
            '</div>' +
            '<div id="gc-grid"></div>' +
            '<div id="gc-controls">' +
              '<button id="gc-mute-btn" class="gc-ctrl-btn" title="Mute">' + _premiumMicSvg(false) + '</button>' +
              (_gc.type === 'video'
                ? '<button id="gc-cam-btn" class="gc-ctrl-btn" title="Camera">' + _cameraSvg(false) + '</button>' +
                  '<button id="gc-flip-btn" class="gc-ctrl-btn" title="Flip camera">' + _flipSvg() + '</button>' +
                  /* FIX (2026-08-01 — Issue #5, group calls): no way back
                     from video to voice existed at all — only the mirror
                     button below (voice→video) did. */
                  '<button id="gc-switch-voice-btn" class="gc-ctrl-btn" title="Switch to voice">' + _voiceOnlySvg() + '</button>'
                : '<button id="gc-switch-video-btn" class="gc-ctrl-btn" title="Switch to video">' + _cameraSvg(false) + '</button>') +
              /* FEATURE (2026-08-01) — group call recording, requested
                 alongside the 1:1 recording feature. Kept in the controls
                 row for BOTH voice and video (unlike cam/flip, which are
                 video-only) since audio-only recording is still useful. */
              '<button id="gc-rec-btn" class="gc-ctrl-btn" title="Record">' + _recSvg() + '</button>' +
              '<button id="gc-add-btn" class="gc-ctrl-btn" title="Add people">' + _addPersonSvg() + '</button>' +
              '<button id="gc-leave-btn" class="gc-ctrl-btn gc-leave" title="Leave">' + _hangupSvg() + '</button>' +
            '</div>';
        document.body.appendChild(view);

        view.querySelector('#gc-mute-btn').addEventListener('click', _toggleMute);
        var camBtn = view.querySelector('#gc-cam-btn');
        if (camBtn) camBtn.addEventListener('click', _toggleCam);
        var flipBtn = view.querySelector('#gc-flip-btn');
        if (flipBtn) flipBtn.addEventListener('click', _flipCamera);
        var switchBtn = view.querySelector('#gc-switch-video-btn');
        if (switchBtn) switchBtn.addEventListener('click', _switchToVideo);
        var switchVoiceBtn = view.querySelector('#gc-switch-voice-btn');
        if (switchVoiceBtn) switchVoiceBtn.addEventListener('click', _switchToVoice);
        view.querySelector('#gc-rec-btn').addEventListener('click', _toggleGroupRecording);
        view.querySelector('#gc-add-btn').addEventListener('click', _openAddToCallPicker);
        view.querySelector('#gc-leave-btn').addEventListener('click', function () { _leaveCall(false); });

        /* FEATURE (2026-08-01) — minimize-to-pill wiring. The tap-anywhere-
           to-restore listener lives on the view itself (not just the
           button) and is gated on the gc-minimized class so it never
           interferes with normal full-screen taps on the header/grid/
           controls. */
        view.querySelector('#gc-minimize-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            _minimizeCall();
        });
        view.addEventListener('click', function () {
            if (view.classList.contains('gc-minimized')) _restoreCall();
        });
    }

    function _minimizeCall() {
        var view = document.getElementById('gc-view');
        if (!view) return;
        view.classList.add('gc-minimized');
        _gc.minimized = true;
    }

    function _restoreCall() {
        var view = document.getElementById('gc-view');
        if (!view) return;
        view.classList.remove('gc-minimized');
        _gc.minimized = false;
    }

    /* Inserts the camera-toggle button once the call becomes 'video' —
       either because I just switched it (_switchToVideo) or because
       someone else did and my call-doc listener picked it up
       (_onCallBecameVideo). No-ops if it's already there. */
    function _ensureCamButton() {
        var controls = document.getElementById('gc-controls');
        var leaveBtn = document.getElementById('gc-leave-btn');
        if (!controls || !leaveBtn) return;
        if (!document.getElementById('gc-cam-btn')) {
            var btn = document.createElement('button');
            btn.id = 'gc-cam-btn';
            btn.className = 'gc-ctrl-btn';
            btn.title = 'Camera';
            btn.innerHTML = _cameraSvg(_gc.camOff);
            btn.addEventListener('click', _toggleCam);
            controls.insertBefore(btn, leaveBtn);
        }
        /* FIX (2026-08-01): group calls that START as voice and later
           escalate to video never got a flip button at all — only the
           on/off camera toggle above was added here. */
        if (!document.getElementById('gc-flip-btn')) {
            var flipBtn = document.createElement('button');
            flipBtn.id = 'gc-flip-btn';
            flipBtn.className = 'gc-ctrl-btn';
            flipBtn.title = 'Flip camera';
            flipBtn.innerHTML = _flipSvg();
            flipBtn.addEventListener('click', _flipCamera);
            var camBtnEl = document.getElementById('gc-cam-btn');
            controls.insertBefore(flipBtn, camBtnEl ? camBtnEl.nextSibling : leaveBtn);
        }
        /* FIX (2026-08-01 — Issue #5): same gap as the flip button just
           above — a call that escalates to video mid-call never got a way
           back to voice either. */
        if (!document.getElementById('gc-switch-voice-btn')) {
            var switchVoiceBtn = document.createElement('button');
            switchVoiceBtn.id = 'gc-switch-voice-btn';
            switchVoiceBtn.className = 'gc-ctrl-btn';
            switchVoiceBtn.title = 'Switch to voice';
            switchVoiceBtn.innerHTML = _voiceOnlySvg();
            switchVoiceBtn.addEventListener('click', _switchToVoice);
            var flipBtnEl = document.getElementById('gc-flip-btn');
            controls.insertBefore(switchVoiceBtn, flipBtnEl ? flipBtnEl.nextSibling : leaveBtn);
        }
    }

    function _removeSwitchVideoButton() {
        var btn = document.getElementById('gc-switch-video-btn');
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    }

    /* FEATURE (2026-08-01 — Issue #5): removes the video-mode controls
       (camera toggle, flip, switch-to-voice) when a call drops back to
       voice — mirrors _removeSwitchVideoButton's role in the opposite
       direction. */
    function _removeVideoModeButtons() {
        ['gc-cam-btn', 'gc-flip-btn', 'gc-switch-voice-btn'].forEach(function (id) {
            var btn = document.getElementById(id);
            if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        });
    }

    /* Re-adds the voice-mode "Switch to video" button, for a call that's
       just dropped back to voice — mirrors _ensureCamButton's role in the
       opposite direction. */
    function _ensureSwitchVideoButton() {
        var controls = document.getElementById('gc-controls');
        var leaveBtn = document.getElementById('gc-leave-btn');
        if (!controls || !leaveBtn) return;
        if (document.getElementById('gc-switch-video-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'gc-switch-video-btn';
        btn.className = 'gc-ctrl-btn';
        btn.title = 'Switch to video';
        btn.innerHTML = _cameraSvg(false);
        btn.addEventListener('click', _switchToVideo);
        var addBtn = document.getElementById('gc-add-btn');
        controls.insertBefore(btn, addBtn || leaveBtn);
    }

    function _teardownCallUI() {
        var view = document.getElementById('gc-view');
        if (view && view.parentNode) view.parentNode.removeChild(view);
    }

    function _toggleMute() {
        _gc.muted = !_gc.muted;
        if (_gc.localStream) {
            _gc.localStream.getAudioTracks().forEach(function (t) { t.enabled = !_gc.muted; });
        }
        var btn = document.getElementById('gc-mute-btn');
        if (btn) { btn.classList.toggle('active', _gc.muted); btn.innerHTML = _premiumMicSvg(_gc.muted); }
        if (_gc.groupId && _gc.myUid) {
            _peersRef(_gc.groupId).doc(_gc.myUid).update({ muted: _gc.muted }).catch(function () {});
        }
    }

    /* FEATURE (2026-08-01 — "camera flip not working in group chats"):
       group calls never had a front/back lens flip at all — only the
       on/off camera toggle (_toggleCam) existed, which just enables/
       disables the SAME track, it never requests the other-facing camera.
       Unlike the 1:1 call (one RTCPeerConnection, one video sender), a
       group call is a full mesh — the new track has to be pushed onto
       EVERY peer connection's video sender via replaceTrack, not just
       one, or only some participants would see the flipped feed.
       Mirrors app-patch-openchat.js's _wireCamFlip retry-after-stop
       pattern (many Android camera pipelines only expose one active
       video track at a time, so the OLD track is stopped before the new
       one is requested if the first attempt fails). */
    var _gcFacingMode = 'user';
    /* FIX (2026-08-01 — "camera switch doesn't work or respond on time"):
       two compounding problems, both now fixed:
       1) This used to request the new-facing camera BEFORE releasing the
          current one, on every tap. Most Android camera pipelines only
          expose the hardware to one active getUserMedia video track at a
          time, so that first request reliably failed and only the retry
          (after stopping the old track) succeeded — a guaranteed extra
          failed round trip on every single flip, which is what read as
          "doesn't respond on time". Now the old video track is stopped
          up front, so the common case succeeds on the FIRST request; the
          retry below stays only as a safety net for the rare device
          where that still isn't enough.
       2) There was no guard against a second tap while a flip was still
          in flight — and since step 1 made every flip take a visible
          moment, a re-tap (very likely from someone who assumed the
          first tap "didn't work") fired a second overlapping
          getUserMedia/replaceTrack chain against the same _gc.localStream,
          which is exactly the kind of race that made the button feel
          broken. _gcFlipInFlight now makes a second tap a no-op until the
          first flip settles, and the button itself dims/disables for
          that same short window so the tap actually LOOKS handled. */
    var _gcFlipInFlight = false;
    var _gcFlipWatchdog = null;
    function _flipCamera() {
        if (!_gc.active || _gc.type !== 'video' || !_gc.localStream) return;
        if (_gcFlipInFlight) return;
        _gcFlipInFlight = true;

        var flipBtn = document.getElementById('gc-flip-btn');
        if (flipBtn) { flipBtn.disabled = true; flipBtn.style.opacity = '0.45'; }

        var nextMode = (_gcFacingMode === 'user') ? 'environment' : 'user';
        var constraints = { video: { facingMode: nextMode }, audio: false };

        _gc.localStream.getVideoTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });

        function acquire(isRetry) {
            return navigator.mediaDevices.getUserMedia(constraints).catch(function (err) {
                if (isRetry) throw err;
                return acquire(true);
            });
        }

        function _flipSettled() {
            if (_gcFlipWatchdog) { clearTimeout(_gcFlipWatchdog); _gcFlipWatchdog = null; }
            _gcFlipInFlight = false;
            if (flipBtn) { flipBtn.disabled = false; flipBtn.style.opacity = ''; }
        }

        /* FIX (2026-08-01 — "clicking the second time doesn't respond"):
           the in-flight guard above is only safe if something ALWAYS
           calls _flipSettled(). getUserMedia() on some devices/browser
           builds neither resolves nor rejects for the 'environment'
           facingMode when no back camera is exposed to the page (instead
           of throwing OverconstrainedError as spec'd) — it just hangs.
           Without this watchdog that left the button permanently disabled
           after exactly one tap, which matches "works once, then dead" —
           the button wasn't ignoring the second tap, it genuinely
           couldn't receive one anymore. This guarantees the control is
           always tappable again within 7s no matter what the underlying
           promise does. */
        _gcFlipWatchdog = setTimeout(function () {
            if (!_gcFlipInFlight) return;
            console.warn('[GroupCall] camera switch timed out waiting on getUserMedia — re-enabling flip button.');
            _notify('Camera switch is taking too long — try again.', 'warning');
            _flipSettled();
        }, 7000);

        acquire(false).then(function (newStream) {
            var newTrack = newStream.getVideoTracks()[0];
            if (!newTrack) throw new Error('No camera track');
            _gcFacingMode = nextMode;

            /* Push the new track onto every peer connection's video sender */
            Object.keys(_gc.peers).forEach(function (uid) {
                var entry = _gc.peers[uid];
                if (!entry || !entry.pc) return;
                var sender = entry.pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
                if (sender) sender.replaceTrack(newTrack).catch(function (err) {
                    console.warn('[GroupCall] replaceTrack failed for ' + uid + ':', err && err.message);
                });
            });

            /* Old tracks were already stopped above (freed before the new
               request); just drop them from localStream and add the new
               one, so a peer connection created AFTER this flip (someone
               added mid-call) picks up the correct-facing camera via the
               normal _gc.localStream.getTracks() path in
               _createPeerConnection. */
            _gc.localStream.getVideoTracks().forEach(function (t) { _gc.localStream.removeTrack(t); });
            _gc.localStream.addTrack(newTrack);

            /* Update the self tile preview */
            var selfTile = document.querySelector('.gc-tile.gc-self video');
            if (selfTile) { selfTile.srcObject = _gc.localStream; selfTile.play().catch(function () {}); }
            _flipSettled();
        }).catch(function (err) {
            console.warn('[GroupCall] camera flip failed:', err && (err.name || err.message));
            _notify('Could not switch camera' + (err && err.name ? ' (' + err.name + ')' : '') + '.', 'warning');
            _flipSettled();
        });
    }

    function _toggleCam() {
        _gc.camOff = !_gc.camOff;
        if (_gc.localStream) {
            _gc.localStream.getVideoTracks().forEach(function (t) { t.enabled = !_gc.camOff; });
        }
        var btn = document.getElementById('gc-cam-btn');
        if (btn) { btn.classList.toggle('active', _gc.camOff); btn.innerHTML = _cameraSvg(_gc.camOff); }
        var selfTile = document.querySelector('.gc-tile.gc-self');
        if (selfTile) {
            var v = selfTile.querySelector('video'), a = selfTile.querySelector('.gc-tile-avatar');
            var showVideo = !_gc.camOff;
            if (v) v.style.display = showVideo ? '' : 'none';
            if (a) a.style.display = showVideo ? 'none' : '';
        }
        if (_gc.groupId && _gc.myUid) {
            _peersRef(_gc.groupId).doc(_gc.myUid).update({ camOff: _gc.camOff }).catch(function () {});
        }
    }

    /* =========================================================================
       §8 — JOIN / START / LEAVE (the actual entry point
       app-patch-v13.js's _wireGroupCallEntry() calls)
       ========================================================================= */

    /* Creates the root call doc only when nothing active already exists —
       when joining an in-progress call this is skipped entirely so we never
       clobber the real startedBy/startedAt/type with our own. Firestore
       treats a .set() on an existing doc as an UPDATE for rules purposes
       (not a create), so restarting an ended call this way is still covered
       by the broad group_calls update rule even though startedBy changes. */
    function _ensureCallDoc(groupId, type, alreadyActive) {
        if (alreadyActive) return Promise.resolve();
        /* FIX (2026-08-01 — "group calls aren't in the chat log"): starting
           a call previously left NO trace in the group's own message
           thread — only the "X added Y to the call" mid-call message
           existed. Someone opening the chat after a call already ended
           would see no record it ever happened. Mirrors the exact same
           system-message pattern _openAddToCallPicker already uses below,
           reusing the same groups/{groupId}/messages create rule — no new
           collection or rule needed. Posted best-effort (not chained onto
           the call itself) so a failure here never blocks starting the
           actual call. */
        window.fbDb.collection('groups').doc(groupId).collection('messages').add({
            senderId: _gc.myUid,
            senderName: _gc.myName || 'Someone',
            text: (_gc.myName || 'Someone') + ' started a ' + (type === 'video' ? 'video' : 'voice') + ' call',
            system: true,
            createdAt: new Date().toISOString()
        }).catch(function (err) { console.warn('[GroupCall] could not post call-start system message:', err && err.message); });

        return _groupCallRef(groupId).set({
            status: 'active',
            type: type,
            startedBy: _gc.myUid,
            startedByName: _gc.myName || 'Someone',
            startedAt: new Date().toISOString(),
            activeCount: 1
        });
    }

    function _joinCall(groupId, type, alreadyActive) {
        var us = _us();
        _gc.active      = true;
        _gc.groupId     = groupId;
        _gc.callId      = groupId;
        _gc.type        = type;
        _gc.myUid       = _authUid();
        _gc.myName      = us.fullName || us.username || 'You';
        _gc.myAvatar    = us.avatar || us.photoURL || '';
        _gc.muted       = false;
        _gc.camOff      = type !== 'video';
        _gc.peers       = {};
        /* FIX (2026-08-01 — regression: "ReferenceError: _callStartedAt is
           not defined" crashing _watchPeers and, with it, every OTHER
           Firestore listener sharing the SDK's watch stream, including the
           group chat message listener — this is what actually broke chat
           delivery in this same session, not the security rules):
           _callStartedAt was declared with `var` inside THIS function's own
           body, which makes it local to _joinCall — completely invisible to
           _watchPeers, a sibling function that also needs it for the same
           stale-peer cutoff. Moved onto _gc (the one object every function
           in this file already shares and that _leaveCall already resets
           per call) instead of a function-local var. */
        _gc.callStartedAt = null;

        /* Check the participant cap BEFORE touching media/UI at all — a
           single .get() whose result is then reused for the join sweep
           further down, rather than a second read. */
        _peersRef(groupId).get().then(function (existingPeersSnap) {
            if (existingPeersSnap.size >= MAX_CALL_PARTICIPANTS) {
                _notify('This call is full (' + MAX_CALL_PARTICIPANTS + '/' + MAX_CALL_PARTICIPANTS + ')', 'warning');
                _gc.active = false;
                return null;
            }

            _injectCSS();
            _buildCallView();

            return _getLocalMedia(type).then(function (stream) {
                _gc.localStream = stream;
                _renderSelfTile();
                return _ensureCallDoc(groupId, type, alreadyActive);
            }).then(function () {
                return _groupCallRef(groupId).get();
            }).then(function (callSnap) {
                _startDurationTimer(callSnap.exists ? callSnap.data().startedAt : null);
                /* FIX (2026-08-01 — host-mute button never appeared): hostUid
                   was never assigned anywhere, so _tileMarkup's `_gc.myUid ===
                   _gc.hostUid` check could never pass for anyone, ever. The
                   call doc's own startedBy field is exactly the value that
                   comment always intended to use — read it here (falling back
                   to my own uid for the person actually starting/restarting
                   the call, since _ensureCallDoc's .set() above may not have
                   been reflected in this same .get() on a slow connection). */
                _gc.hostUid = (callSnap.exists && callSnap.data().startedBy) || _gc.myUid;
                /* FIX (2026-08-01 — Issue #4 defense-in-depth): captured here
                   (this .then()'s callSnap param isn't visible in the next
                   one) for the stale-peer filter below. */
                _gc.callStartedAt = callSnap.exists ? callSnap.data().startedAt : null;
                return _peersRef(groupId).doc(_gc.myUid).set({
                    name: _gc.myName, avatar: _gc.myAvatar,
                    joinedAt: new Date().toISOString(), muted: false, camOff: _gc.camOff,
                    forceMuteAt: null, forceMuteBy: null
                });
            }).then(function () {
                /* FIX (2026-08-01 — Issue #4, defense-in-depth): the
                   primary fix is the peers/signals sweep now added to
                   _leaveCall above; this is a second, independent guard in
                   case that cleanup ever didn't run (offline at the moment
                   the previous call ended, a permission hiccup, etc.). Any
                   peer doc whose joinedAt predates THIS call's startedAt
                   (captured just above) is left over from a previous call
                   generation in this same group, not a real current
                   participant, and must never be auto-offered a connection. */
                var cutoff = _gc.callStartedAt ? new Date(_gc.callStartedAt).getTime() : 0;
                existingPeersSnap.forEach(function (doc) {
                    if (doc.id === _gc.myUid) return;
                    var d = doc.data();
                    var joinedMs = d.joinedAt ? new Date(d.joinedAt).getTime() : 0;
                    if (cutoff && joinedMs && joinedMs < cutoff) {
                        console.warn('[GroupCall] skipping stale peer doc from a previous call:', doc.id);
                        return;
                    }
                    _offerTo(doc.id, d.name, d.avatar);
                });
                /* Nobody else here yet — I'm the one who just placed the
                   call (or reopened an empty room). Ring until someone
                   answers; _watchPeers stops it the moment a peer joins. */
                if (existingPeersSnap.size === 0) _startDialTone();
                _watchPeers();
                _watchIncomingSignals();
                _watchSelfForceMute(groupId);
                _gc.unsubCallDoc = _groupCallRef(groupId).onSnapshot(function (snap) {
                    if (!snap.exists || snap.data().status !== 'active') { _leaveCall(true); return; }
                    var d = snap.data();
                    if (d.type === 'video' && _gc.type !== 'video') {
                        _gc.type = 'video';
                        _onCallBecameVideo();
                    }
                    _gc.recordingBy = d.recordingBy || null;
                    _applyRemoteRecordingState(_gc.recordingBy);
                }, function (err) { console.warn('[GroupCall] call-doc listener error:', err.message); });
                _updateHeadcount();
            });
        }).catch(function (err) {
            console.warn('[GroupCall] join failed:', err.message);
            _notify('Could not join the call — ' + (err.message || ''), 'error');
            _teardownCallUI();
            _gc.active = false;
        });
    }

    /* Called when the call's `type` flips to 'video' out from under us —
       either someone else tapped "switch to video", or we just did it
       ourselves (_switchToVideo calls this too). Only reveals the option
       to turn a camera on; does not turn anyone else's camera on. */
    function _onCallBecameVideo() {
        var title = document.getElementById('gc-header-title');
        if (title) title.textContent = 'Video call';
        _removeSwitchVideoButton();
        _ensureCamButton();
    }

    /* FEATURE (2026-08-01 — Issue #5, group calls): the missing reverse
       direction of _switchToVideo below. Deliberately per-person only,
       same as _toggleCam/_switchToVideo already are in this file (see
       their own comments: "does not touch anyone else's camera") — this
       does NOT write group_calls/{groupId}.type back to 'voice', since
       other participants may still be sharing video; it only stops MY OWN
       video, frees my camera hardware, and collapses MY OWN controls back
       to the voice-call layout. Safe to tap again later — clicking
       "Switch to video" (gc-switch-video-btn, re-added below) re-adds a
       fresh camera track exactly like starting from a voice call. */
    var _gcSwitchToVoiceInFlight = false;
    function _switchToVoice() {
        if (!_gc.myVideoOn || _gc.camOff) return; /* nothing to switch off */
        /* FIX (2026-08-01 — "switching back and forth eventually gets
           stuck"): same debounce class as _switchToVideo — without this,
           a rapid re-tap while the removeTrack/renegotiate below was
           still settling could start a second, colliding pass. */
        if (_gcSwitchToVoiceInFlight) return;
        _gcSwitchToVoiceInFlight = true;

        if (_gc.localStream) {
            _gc.localStream.getVideoTracks().forEach(function (t) {
                try { t.stop(); } catch (e) {}
                try { _gc.localStream.removeTrack(t); } catch (e) {}
            });
        }
        /* FIX (2026-08-01 — root cause of "switching back and forth
           eventually gets stuck"): this removed the video sender from
           each peer connection locally but NEVER renegotiated — unlike
           _switchToVideo, which always calls _renegotiateWithPeer after
           its own addTrack. removeTrack() marks the connection as
           needing renegotiation internally, but nothing here ever acted
           on that, so the remote side's peer connection (and its
           understanding of the m-line's direction) never actually
           learned the video track was gone; only OUR local sender/track
           bookkeeping updated. The two sides' negotiation state then
           silently drifted apart. The NEXT switch-to-video call would
           createOffer() against a connection whose actual remote-synced
           state didn't match what either side assumed anymore — which is
           exactly the kind of mismatch _renegotiateWithPeer's own
           stable-state guard (see above) was added to catch, and after
           enough back-and-forth toggles it started refusing to
           renegotiate at all rather than risk corrupting the SDP further
           — read from the tapping person's side as "stuck". Now every
           peer whose sender was actually removed gets a real
           renegotiation, exactly mirroring _switchToVideo, so both
           directions stay in sync no matter how many times this is
           toggled. */
        Object.keys(_gc.peers).forEach(function (uid) {
            var entry = _gc.peers[uid];
            if (!entry || !entry.pc) return;
            var sender = entry.pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
            if (sender) {
                try { entry.pc.removeTrack(sender); } catch (e) {}
                _renegotiateWithPeer(uid);
            }
        });
        _gc.camOff = true;
        _gc.myVideoOn = false;
        _gcSwitchToVoiceInFlight = false;

        var selfTile = document.querySelector('.gc-tile.gc-self');
        if (selfTile) {
            var v = selfTile.querySelector('video'), a = selfTile.querySelector('.gc-tile-avatar');
            if (v) v.style.display = 'none';
            if (a) a.style.display = '';
        }

        _removeVideoModeButtons();
        _ensureSwitchVideoButton();

        if (_gc.groupId && _gc.myUid) {
            _peersRef(_gc.groupId).doc(_gc.myUid).update({ camOff: true }).catch(function () {});
        }
        _notify('Switched to voice — your camera is off.', 'info');
    }

    /* Escalates a voice call to video: turns my own camera on, adds the
       track to every existing peer connection, and renegotiates each one
       (see _renegotiateWithPeer above). Does not touch anyone else's
       camera — see MID-CALL FEATURES note at the top of this file. */
    /* FIX (2026-08-01 — "switch to video never worked, switch to voice
       always did"): _switchToVoice is fully synchronous (just stops
       tracks) so there was never a window for a re-tap to matter.
       _switchToVideo has an async gap — getUserMedia() — and its guard
       (`if (_gc.type === 'video') return;`) only checks _gc.type, which
       isn't set to 'video' until AFTER that gap. So every tap before the
       first one finished sailed straight through the guard and started
       its OWN getUserMedia + addTrack + _renegotiateWithPeer cycle
       against the SAME RTCPeerConnection — a second negotiation
       colliding with the first one still in flight, which is what threw
       the repeated "SDP is modified in a non-acceptable way" errors and,
       from the tapping person's side, looked like the button simply
       never worked. Fixed the same way as the flip-camera button:
       _gcSwitchToVideoInFlight makes every tap after the first a no-op
       until this one settles, the button dims/disables so the tap
       visibly registers, and a watchdog guarantees it can't get stuck
       disabled if getUserMedia ever hangs instead of resolving/
       rejecting. _renegotiateWithPeer's own stable-state guard (see
       above) is the second, independent layer against the same
       collision. */
    var _gcSwitchToVideoInFlight = false;
    function _switchToVideo() {
        if (_gc.myVideoOn) return;
        if (_gcSwitchToVideoInFlight) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            _notify('Camera not supported on this device/browser', 'error');
            return;
        }
        _gcSwitchToVideoInFlight = true;
        var switchBtn = document.getElementById('gc-switch-video-btn');
        if (switchBtn) { switchBtn.disabled = true; switchBtn.style.opacity = '0.45'; }

        var watchdog = setTimeout(function () {
            if (!_gcSwitchToVideoInFlight) return;
            console.warn('[GroupCall] switch-to-video timed out waiting on getUserMedia — re-enabling button.');
            _notify('Switching to video is taking too long — try again.', 'warning');
            _gcSwitchToVideoInFlight = false;
            if (switchBtn) { switchBtn.disabled = false; switchBtn.style.opacity = ''; }
        }, 7000);

        function _settled() {
            clearTimeout(watchdog);
            _gcSwitchToVideoInFlight = false;
            /* switchBtn itself gets removed from the DOM by
               _onCallBecameVideo()/_removeSwitchVideoButton() on success —
               only need to restore it here for the failure path. */
            var btn = document.getElementById('gc-switch-video-btn');
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        }

        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }).then(function (camStream) {
            var track = camStream.getVideoTracks()[0];
            if (!track) throw new Error('No camera track');
            if (_gc.localStream) _gc.localStream.addTrack(track);
            _gc.type = 'video';
            _gc.camOff = false;
            _gc.myVideoOn = true;

            Object.keys(_gc.peers).forEach(function (uid) {
                var entry = _gc.peers[uid];
                if (entry && entry.pc) {
                    entry.pc.addTrack(track, _gc.localStream);
                    _renegotiateWithPeer(uid);
                }
            });

            _renderSelfTile();
            _onCallBecameVideo();
            _settled();

            if (_gc.groupId) {
                _groupCallRef(_gc.groupId).update({ type: 'video' }).catch(function () {});
                _peersRef(_gc.groupId).doc(_gc.myUid).update({ camOff: false }).catch(function () {});
            }
        }).catch(function (err) {
            console.warn('[GroupCall] switch-to-video failed:', err && (err.name || err.message));
            _notify('Could not access camera — ' + (err.message || ''), 'error');
            _settled();
        });
    }

    /* =========================================================================
       §9 — ADD PEOPLE MID-CALL
       No dedicated invite/ring collection exists for group calls (unlike
       1:1 calls' /users/{userId}/incomingCalls) — this instead posts a
       system message into the group's own message thread, reusing the
       EXISTING groups/{groupId}/messages create rule as-is. Anyone with
       the group chat open already sees the live "call in progress" banner
       (app-patch-v13.js), so that banner plus this message together serve
       as the invite; no new Firestore collection or rule needed.
       ========================================================================= */
    function _openAddToCallPicker() {
        if (!_gc.active || !_gc.groupId || !_fbOk()) return;
        var groupId = _gc.groupId;

        window.fbDb.collection('groups').doc(groupId).get().then(function (gSnap) {
            if (!gSnap.exists) { _notify('Could not load group members', 'error'); return; }
            var g = gSnap.data();
            var mu = window.mockUsers || {};
            var already = {};
            Object.keys(_gc.peers).forEach(function (uid) { already[uid] = true; });
            already[_gc.myUid] = true;

            var candidates = (g.members || [])
                .filter(function (uid) { return uid && !already[uid]; })
                .map(function (uid) {
                    var u = mu[uid] || {};
                    return { id: uid, name: u.fullName || u.username || 'Member', avatar: u.avatar || u.photoURL || '' };
                });

            var slotsLeft = MAX_CALL_PARTICIPANTS - (Object.keys(_gc.peers).length + 1);

            var panel = document.createElement('div');
            panel.style.cssText = 'position:fixed;inset:0;z-index:10000010;background:#fff;display:flex;flex-direction:column;';
            panel.innerHTML =
                '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;flex-shrink:0;">' +
                  '<button id="gc-add-back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button>' +
                  '<span style="font-weight:700;">Add to call</span>' +
                '</div>' +
                '<div id="gc-add-list" style="flex:1;overflow-y:auto;"></div>' +
                '<div style="padding:14px 16px;border-top:1px solid #eee;flex-shrink:0;">' +
                  '<button id="gc-add-confirm" disabled style="width:100%;padding:13px;border:none;border-radius:10px;background:#9AA0A6;color:#fff;font-weight:700;font-size:0.92rem;">Add</button>' +
                '</div>';
            document.body.appendChild(panel);
            panel.querySelector('#gc-add-back').addEventListener('click', function () { panel.remove(); });

            var list = panel.querySelector('#gc-add-list');
            if (!candidates.length) {
                list.innerHTML = '<div style="text-align:center;color:#999;padding:30px 20px;">Everyone in this group is already in the call.</div>';
            } else if (slotsLeft <= 0) {
                list.innerHTML = '<div style="text-align:center;color:#999;padding:30px 20px;">This call is full (' + MAX_CALL_PARTICIPANTS + '/' + MAX_CALL_PARTICIPANTS + ').</div>';
            }

            var selected = {};
            if (candidates.length && slotsLeft > 0) {
                candidates.forEach(function (c) {
                    var row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;border-bottom:1px solid #f5f5f5;';
                    row.innerHTML =
                        '<img src="' + _esc(c.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name) + '&background=1B2B8B&color=fff')) + '" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;">' +
                        '<span style="flex:1;font-size:0.9rem;">' + _esc(c.name) + '</span>' +
                        '<span class="gc-add-check" style="width:22px;height:22px;border-radius:50%;border:2px solid #d0d0d0;flex-shrink:0;"></span>';
                    row.addEventListener('click', function () {
                        var check = row.querySelector('.gc-add-check');
                        if (selected[c.id]) {
                            delete selected[c.id];
                            check.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid #d0d0d0;flex-shrink:0;';
                        } else {
                            if (Object.keys(selected).length >= slotsLeft) {
                                _notify('Call is limited to ' + MAX_CALL_PARTICIPANTS + ' participants', 'warning');
                                return;
                            }
                            selected[c.id] = c;
                            check.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#1B2B8B;border:2px solid #1B2B8B;flex-shrink:0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;';
                            check.textContent = '✓';
                        }
                        var n = Object.keys(selected).length;
                        var btn = panel.querySelector('#gc-add-confirm');
                        btn.disabled = n === 0;
                        btn.style.background = n === 0 ? '#9AA0A6' : '#1B2B8B';
                    });
                    list.appendChild(row);
                });
            }

            panel.querySelector('#gc-add-confirm').addEventListener('click', function () {
                var picks = Object.keys(selected);
                if (!picks.length) return;
                var myName = _gc.myName || 'Someone';
                var names = picks.map(function (id) { return selected[id].name; }).join(', ');
                window.fbDb.collection('groups').doc(groupId).collection('messages').add({
                    senderId: _gc.myUid,
                    senderName: myName,
                    text: myName + ' added ' + names + ' to the ' + (_gc.type === 'video' ? 'video' : 'voice') + ' call',
                    system: true,
                    createdAt: new Date().toISOString()
                }).then(function () {
                    _notify('Added ' + names + ' to the call', 'success');
                }).catch(function (err) {
                    _notify('Could not notify ' + names + ' — ' + (err.message || ''), 'error');
                });
                panel.remove();
            });
        }).catch(function (err) {
            _notify('Could not load group members — ' + (err.message || ''), 'error');
        });
    }

    /* remote===true means the call ended out from under us (root doc went
       missing or status flipped away from 'active') — skip re-writing our
       own peers doc / recomputing activeCount in that case since the call
       is already gone for everyone, not just us. */
    /* FIX (2026-08-01 — "End doesn't end the call for everyone"): this used
       to only mark group_calls/{groupId}.status:'ended' once the LEAVING
       person happened to be the last peer left — anyone else who tapped
       the same hangup button while other participants were still on the
       call just quietly removed their own peer doc and decremented
       activeCount, leaving the call doc (and therefore the "call in
       progress" banner + everyone else's call screen) fully alive. That's
       "Leave" behavior, not "End" — the button only ever has one label/icon
       (hangup) and no separate "end for everyone" action, so per the
       reported expectation it should always end the call for every
       participant, not just remove the tapper. Now every non-remote leave
       (i.e. an actual tap on the hangup button, not a reaction to someone
       ELSE having already ended it) unconditionally sets status:'ended' —
       every other participant's own _gc.unsubCallDoc listener (set up by
       their own _joinCall) picks that up and runs their own _leaveCall(true)
       to clean up on their side. The write's failure is also now surfaced
       instead of silently swallowed — a permission-denied here means the
       call doc genuinely never ends for anyone, which is exactly the "stuck
       call in progress" bug and needs to be visible, not hidden. */
    /* =========================================================================
       §9 — CALL RECORDING (2026-08-01, new feature — group calls had none
       at all; the 1:1 call in app-patch-openchat.js already has this).
       Mirrors that file's _startRecording/_stopRecording approach — mix
       every audio source through the Web Audio API into one track, and
       for video calls also composite every visible tile onto a hidden
       canvas — but generalized from exactly two parties to however many
       are in _gc.peers right now.

       Deliberately NOT gated to the host only: any participant can start
       or stop it, same "anyone can record" model group-call products
       typically use, since Firestore rules here have no reliable way to
       verify a special "host" identity (see isGroupAdmin's own comment in
       firebase-rules.js on this app's id-space mismatch). What IS added
       for transparency: group_calls/{groupId}.recordingBy is written
       while a recording is active (cleared when it stops), and every
       OTHER participant's existing call-doc listener (in _joinCall) shows
       the "Recording" header note the instant that field is set — nobody
       is recorded without everyone in the call being able to see it's
       happening. No new Firestore rule is needed: group_calls/{groupId}
       already allows `update` for any authenticated call member.
       ========================================================================= */
    function _toggleGroupRecording() {
        if (_gc.recording) { _stopGroupRecording(); return; }
        _startGroupRecording();
    }

    function _startGroupRecording() {
        if (_gc.recording) return false;
        if (!window.MediaRecorder) { _notify('Recording is not supported on this browser.', 'warning'); return false; }
        if (!_gc.localStream) { _notify('Call audio not ready yet — try again in a second.', 'warning'); return false; }

        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            var actx = new AC();
            _gc.recordAudioCtx = actx;
            var dest = actx.createMediaStreamDestination();

            /* My own mic. */
            if (_gc.localStream.getAudioTracks().length) {
                actx.createMediaStreamSource(new MediaStream(_gc.localStream.getAudioTracks())).connect(dest);
            }

            /* Every remote peer's audio — read straight off their tile's
               <video>/<audio> element srcObject (set by pc.ontrack above),
               same source the on-screen audio itself already plays from,
               so the recording mixes exactly what's audible right now,
               including anyone who joins mid-recording (their tile just
               isn't in this loop until the NEXT start — matches the 1:1
               call's own "start captures who's on the call right now"
               behavior; not re-run automatically on every join to avoid
               tearing down and rebuilding the audio graph mid-recording). */
            Object.keys(_gc.peers).forEach(function (uid) {
                var entry = _gc.peers[uid];
                var mediaEl = entry && entry.tileEl && entry.tileEl.querySelector('video,audio');
                var stream = mediaEl && mediaEl.srcObject;
                if (stream && stream.getAudioTracks && stream.getAudioTracks().length) {
                    try { actx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(dest); }
                    catch (eSrc) { /* a peer whose stream is still settling — skip, not fatal */ }
                }
            });

            var outTracks = dest.stream.getAudioTracks().slice();
            var mimeType = 'audio/webm;codecs=opus';
            var isVideo = _gc.type === 'video';

            if (isVideo) {
                /* Composite the SAME grid that's on screen — self tile +
                   every remote tile currently rendered — onto one canvas,
                   simple auto-fit grid layout matching #gc-grid's own
                   auto-fill visual density instead of a fixed 2-up. */
                var canvas = document.createElement('canvas');
                canvas.width = 960; canvas.height = 540;
                var ctx2d = canvas.getContext('2d');

                _gc.recordCanvasTimer = setInterval(function () {
                    try {
                        ctx2d.fillStyle = '#0A0E27';
                        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
                        var tiles = Array.prototype.slice.call(document.querySelectorAll('#gc-grid .gc-tile'));
                        if (!tiles.length) return;
                        var cols = Math.ceil(Math.sqrt(tiles.length));
                        var rows = Math.ceil(tiles.length / cols);
                        var cw = canvas.width / cols, ch = canvas.height / rows;
                        tiles.forEach(function (tile, i) {
                            var vEl = tile.querySelector('video');
                            var x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
                            if (vEl && vEl.readyState >= 2 && vEl.style.display !== 'none') {
                                ctx2d.drawImage(vEl, x, y, cw, ch);
                            } else {
                                var aEl = tile.querySelector('.gc-tile-avatar');
                                ctx2d.fillStyle = '#1B2B8B';
                                ctx2d.fillRect(x, y, cw, ch);
                                if (aEl && aEl.complete) {
                                    var s = Math.min(cw, ch) * 0.4;
                                    try { ctx2d.drawImage(aEl, x + cw / 2 - s / 2, y + ch / 2 - s / 2, s, s); } catch (eDraw) {}
                                }
                            }
                        });
                    } catch (drawErr) { /* a mid-frame read failure shouldn't kill the recording */ }
                }, 1000 / 25);

                var canvasStream = canvas.captureStream(25);
                outTracks = canvasStream.getVideoTracks().concat(dest.stream.getAudioTracks());
                mimeType = 'video/webm;codecs=vp8,opus';
            }

            var combined = new MediaStream(outTracks);
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = isVideo ? 'video/webm' : 'audio/webm';

            var recorder = new MediaRecorder(combined, { mimeType: mimeType });
            _gc.recordChunks = [];
            recorder.ondataavailable = function (e) { if (e.data && e.data.size) _gc.recordChunks.push(e.data); };
            recorder.onstop = function () {
                var blob = new Blob(_gc.recordChunks, { type: mimeType });
                var url  = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'empyrean-group-call-' + Date.now() + '.webm';
                document.body.appendChild(a);
                a.click();
                setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
                _notify('Recording saved to downloads.', 'success');
            };

            recorder.start(1000);
            _gc.recorder  = recorder;
            _gc.recording = true;

            var recBtn = document.getElementById('gc-rec-btn');
            if (recBtn) recBtn.classList.add('active');
            var ind = document.getElementById('gc-rec-indicator');
            if (ind) ind.style.display = 'flex';
            _notify('Recording started — everyone in the call can see the recording indicator.', 'info');

            if (_gc.groupId) {
                _groupCallRef(_gc.groupId).update({ recordingBy: _gc.myUid }).catch(function () {});
            }
            return true;
        } catch (err) {
            _notify('Could not start recording: ' + (err && err.message || err), 'warning');
            _teardownGroupRecording();
            return false;
        }
    }

    function _teardownGroupRecording() {
        if (_gc.recordCanvasTimer) { clearInterval(_gc.recordCanvasTimer); _gc.recordCanvasTimer = null; }
        if (_gc.recordAudioCtx) { try { _gc.recordAudioCtx.close(); } catch (e) {} _gc.recordAudioCtx = null; }
        _gc.recorder  = null;
        _gc.recording = false;
        var recBtn = document.getElementById('gc-rec-btn');
        if (recBtn) recBtn.classList.remove('active');
        var ind = document.getElementById('gc-rec-indicator');
        if (ind) ind.style.display = 'none';
    }

    function _stopGroupRecording() {
        if (!_gc.recording) return;
        try {
            if (_gc.recorder && _gc.recorder.state !== 'inactive') _gc.recorder.stop();
        } catch (e) {}
        _teardownGroupRecording();
        if (_gc.groupId) {
            _groupCallRef(_gc.groupId).update({ recordingBy: null }).catch(function () {});
        }
    }

    /* Shows/hides the "Recording" header note for participants who are
       NOT the one recording — wired from _joinCall's existing call-doc
       onSnapshot listener alongside its video-type check, so this needs
       no separate listener/read. Only touches the indicator for anyone
       whose own _gc.recording is false; the person actually recording
       already controls their own indicator in _startGroupRecording. */
    function _applyRemoteRecordingState(recordingByUid) {
        if (_gc.recording) return; /* my own indicator already reflects my own recording */
        var ind = document.getElementById('gc-rec-indicator');
        var label = document.getElementById('gc-rec-indicator-label');
        if (!ind) return;
        if (recordingByUid && recordingByUid !== _gc.myUid) {
            if (label) label.textContent = 'Recording';
            ind.style.display = 'flex';
        } else {
            ind.style.display = 'none';
        }
    }

    function _leaveCall(remote) {
        if (!_gc.active) return;
        var groupId = _gc.groupId, uid = _gc.myUid;

        if (_gc.recording) _stopGroupRecording();
        _closeAllPeers();
        _stopDialTone();
        _stopDurationTimer();
        if (_gc.unsubPeers)   { try { _gc.unsubPeers(); }   catch (e) {} }
        if (_gc.unsubSignals) { try { _gc.unsubSignals(); } catch (e) {} }
        if (_gc.unsubCallDoc) { try { _gc.unsubCallDoc(); } catch (e) {} }
        if (_gc.unsubSelfPeer) { try { _gc.unsubSelfPeer(); } catch (e) {} }
        if (_gc.localStream) {
            _gc.localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        }
        _teardownCallUI();

        if (!remote && groupId && uid) {
            _peersRef(groupId).doc(uid).delete().catch(function () {});
            _groupCallRef(groupId).update({ status: 'ended', activeCount: 0 }).catch(function (err) {
                console.error('[GroupCall] could not end the call for everyone:', err && (err.code || err.message));
                _notify('Could not end the call for everyone — ' + (err && err.code === 'permission-denied'
                    ? 'the group_calls security rule may need deploying.'
                    : (err.message || 'please check your connection.')), 'error');
            });
            /* FIX (2026-08-01 — Issue #4: "people from the previous call
               automatically display on screen"): sweep leftover peers/{uid}
               and signals/{id} docs so _joinCall's own existingPeersSnap
               read (see below) doesn't find them on the NEXT call and
               auto-offer them as if they were live participants.

               FIX (2026-08-01 — follow-up: "stale peers/signals cleanup
               failed: permission-denied", every time, non-fatal but
               100% reproducible): this used to .get() the WHOLE
               peers/signals collection and batch-delete every doc in it —
               not just this user's own. The security rules correctly only
               ever allow a participant to delete THEIR OWN peers/{uid}
               doc (request.auth.uid == uid) and, now, their own
               signals/{sigId} docs (request.auth.uid is one of the two
               ids in the doc's id/from/to) — deleting someone else's
               presence/signal doc just because you happened to be the one
               leaving isn't something any participant should be allowed
               to do (that would let any member wipe another active
               participant's live signaling docs mid-call). Scoped to only
               this user's own docs below — since EVERY participant runs
               this same cleanup on their own leave (see the #gc-leave-btn
               listener above, not host-only), stale docs still get swept
               collectively, just each by their own owner, which is both
               what the rules actually allow and the more correct model. */
            _signalsRef(groupId).where('from', '==', uid).get().then(function (snap) {
                if (snap.empty) return;
                var batch = window.fbDb.batch();
                snap.forEach(function (doc) { batch.delete(doc.ref); });
                return batch.commit();
            }).catch(function (err) {
                console.warn('[GroupCall] stale signals cleanup (from) failed (non-fatal):', err && (err.code || err.message));
            });
            _signalsRef(groupId).where('to', '==', uid).get().then(function (snap) {
                if (snap.empty) return;
                var batch = window.fbDb.batch();
                snap.forEach(function (doc) { batch.delete(doc.ref); });
                return batch.commit();
            }).catch(function (err) {
                console.warn('[GroupCall] stale signals cleanup (to) failed (non-fatal):', err && (err.code || err.message));
            });
        }

        _gc.active = false; _gc.groupId = null; _gc.callId = null; _gc.type = null; _gc.myVideoOn = false;
        _gc.myUid = null; _gc.myName = null; _gc.myAvatar = null;
        _gc.localStream = null; _gc.muted = false; _gc.camOff = false; _gc.peers = {};
        _gc.unsubPeers = null; _gc.unsubSignals = null; _gc.unsubCallDoc = null;
        _gc.unsubSelfPeer = null; _gc.hostUid = null; _gc._lastForceMuteAt = null;
        _gc.recordingBy = null;
    }

    /* Entry point wired from app-patch-v13.js's _wireGroupCallEntry()
       (video/voice header buttons + the "call in progress" banner). If
       there's no live auth session this refuses to start/join rather than
       writing under a stale/wrong id (see file header note). Already being
       in THIS group's call is a no-op tap; being in a DIFFERENT group's
       call refuses so we never run two calls' media/signaling at once. */
    window._empGroupCallStart = function (groupId, type) {
        /* DIAGNOSTIC (regression: "group call clicks do nothing"): logs
           unconditionally, on every tap, before any guard runs — so a
           reproduction shows definitively whether the click is even
           reaching this function at all (vs. being swallowed earlier by
           something outside this file, e.g. an overlapping element or a
           listener upstream in app-patch-v13.js's header wiring). */
        console.log('[GroupCall] _empGroupCallStart called', { groupId: groupId, type: type });
        try {
            if (!_fbOk()) {
                /* FIX (2026-09-02 — same "doesn't connect until refresh"
                   report, one step earlier — see the matching fix on the
                   _authUid() check just below): window._firebaseLoaded can
                   still be false in the first second or two after a cold
                   page load while firebase-init.js's async init is still in
                   flight. Retry briefly instead of failing on "No internet
                   connection", which is misleading here — the device may be
                   fine, Firebase is just still starting up. Same
                   bounded-retry counter/cap as the auth-uid check below. */
                _gc._callAuthRetries = (_gc._callAuthRetries || 0) + 1;
                if (_gc._callAuthRetries <= 12) {
                    setTimeout(function () { window._empGroupCallStart(groupId, type); }, 500);
                    return;
                }
                _gc._callAuthRetries = 0;
                console.warn('[GroupCall] blocked: Firebase not ready');
                _notify('No internet connection', 'warning');
                return;
            }
            if (!_authUid()) {
                /* FIX (2026-09-02 — "group calls don't connect on first tap,
                   only after a refresh or a full log-out/log-in", matching
                   the same report for 1:1 calls — see the equivalent fix in
                   app-patch-openchat.js's _startCallModal): Firebase Auth's
                   session restore is asynchronous and can still be in
                   flight the instant a group-chat call button is tapped
                   right after a cold page load — fbAuth.currentUser is
                   genuinely null for a brief window, not because nobody's
                   signed in, but because that restore hasn't resolved yet.
                   This used to block immediately with "Please sign in again
                   to start a call," which only "fixed" itself because a
                   refresh (or a fresh login) gave that same restore more
                   time to finish — not because anything was actually wrong
                   with the session. Retry briefly first — up to ~6s
                   (12 x 500ms) — by re-entering this same function, instead
                   of failing on what is usually just a premature check.
                   Only shows the sign-in message if a live session genuinely
                   never turns up in that window. */
                _gc._callAuthRetries = (_gc._callAuthRetries || 0) + 1;
                if (_gc._callAuthRetries <= 12) {
                    setTimeout(function () { window._empGroupCallStart(groupId, type); }, 500);
                    return;
                }
                _gc._callAuthRetries = 0;
                console.warn('[GroupCall] blocked: no live auth uid');
                _notify('Please sign in again to start a call', 'warning');
                return;
            }
            _gc._callAuthRetries = 0;
            if (_gc.active) {
                if (_gc.groupId === groupId) return; /* already in this call */
                console.warn('[GroupCall] blocked: already active on a different call', _gc.groupId);
                _notify('Leave your current call before joining another', 'warning');
                return;
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.warn('[GroupCall] blocked: getUserMedia unsupported');
                _notify('Calling is not supported on this device/browser', 'error');
                return;
            }
            _groupCallRef(groupId).get().then(function (snap) {
                var isActive = snap.exists && snap.data().status === 'active';
                var callType = isActive ? (snap.data().type || 'voice') : (type || 'voice');
                _joinCall(groupId, callType, isActive);
            }).catch(function (err) {
                console.error('[GroupCall] group_calls doc read failed:', err && (err.code || err.message));
                _notify('Could not reach the call — ' + (err.message || ''), 'error');
            });
        } catch (err) {
            /* FIX (regression): any synchronous throw here used to be an
               opaque, uncaught "Script error." with no useful info and
               zero visible feedback — the button would just blink. Now
               it's logged with a clear tag/stack AND surfaced to the
               person instead of failing silently. */
            console.error('[GroupCall] _empGroupCallStart threw synchronously:', err && (err.stack || err.message || err));
            _notify('Could not start the call — please try again.', 'error');
        }
    };

    /* =========================================================================
       §10 — INCOMING-CALL RINGING (NEW, 2026-08-01)
       Previously undocumented gap, confirmed by this file's own §9 comment:
       "No dedicated invite/ring collection exists for group calls... Anyone
       WITH THE GROUP CHAT OPEN already sees the banner" — i.e. anyone who
       does NOT already have that specific chat open got no notification at
       all. This adds real ringing for anyone with the app open ANYWHERE
       (not just background push, which is a separate server-side piece —
       see chat notes). Watches every group I'm a member of for its
       group_calls/{groupId} doc going active, and if it's MY call I didn't
       start and I'm not already busy, rings + shows a Join banner.
       ========================================================================= */
    var _iw = {
        groupsUnsub: null,
        callUnsubs: {},   /* groupId -> unsub */
        groupMeta: {},    /* groupId -> {name, avatar} */
        rungFor: {},      /* groupId -> startedAt already rung, so re-renders of the
                              same still-active call doc don't ring twice */
        ringIntervals: {} /* groupId -> setInterval handle for the repeating ring tone */
    };

    function _stopRingFor(groupId) {
        if (_iw.ringIntervals[groupId]) { clearInterval(_iw.ringIntervals[groupId]); delete _iw.ringIntervals[groupId]; }
        var el = document.getElementById('gc-incoming-' + groupId);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function _showIncomingCallBanner(groupId, meta, type, startedByName) {
        _stopRingFor(groupId); /* replace any stale banner for this same group */

        var idx = Object.keys(_iw.ringIntervals).length; /* stack multiple simultaneous calls */
        var box = document.createElement('div');
        box.id = 'gc-incoming-' + groupId;
        box.style.cssText = [
            'position:fixed;left:50%;transform:translateX(-50%);',
            'top:' + (14 + idx * 78) + 'px;z-index:1000005;',
            'background:#1a1a2e;color:#fff;border-radius:16px;padding:12px 14px;',
            'display:flex;align-items:center;gap:12px;min-width:280px;max-width:92vw;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.45);'
        ].join('');
        box.innerHTML =
            '<img src="' + _esc(meta.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(meta.name || 'Group') + '&background=1B2B8B&color=fff')) + '" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-weight:700;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(meta.name || 'Group') + '</div>' +
              '<div style="font-size:0.76rem;color:#c8c8d8;">' + _esc(startedByName || 'Someone') + ' started a ' + (type === 'video' ? 'video' : 'voice') + ' call</div>' +
            '</div>' +
            '<button class="gc-incoming-dismiss" style="background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:20px;padding:8px 12px;font-size:0.76rem;flex-shrink:0;">Dismiss</button>' +
            '<button class="gc-incoming-join" style="background:#25D366;color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:0.76rem;font-weight:700;flex-shrink:0;">Join</button>';
        document.body.appendChild(box);

        box.querySelector('.gc-incoming-dismiss').addEventListener('click', function () { _stopRingFor(groupId); });
        box.querySelector('.gc-incoming-join').addEventListener('click', function () {
            _stopRingFor(groupId);
            window._empGroupCallStart(groupId, type);
        });

        /* Phone-ring-style two-tone cadence, distinct from the outgoing
           dial tone's [440,480] so the two are never confused. */
        _playTone([480, 620], 1200, 0.14);
        _iw.ringIntervals[groupId] = setInterval(function () { _playTone([480, 620], 1200, 0.14); }, 3500);
        /* Stop ringing on its own after 25s if nobody acts — matches a
           typical unanswered-call timeout instead of ringing forever. */
        setTimeout(function () { _stopRingFor(groupId); }, 25000);
    }

    function _watchGroupCallForRing(groupId) {
        if (_iw.callUnsubs[groupId]) return; /* already watching */
        _iw.callUnsubs[groupId] = _groupCallRef(groupId).onSnapshot(function (snap) {
            if (!snap.exists || snap.data().status !== 'active') { _stopRingFor(groupId); return; }
            var d = snap.data();
            var myUid = _authUid();
            if (!myUid || d.startedBy === myUid) return;      /* don't ring myself */
            if (_gc.active) return;                            /* already on a call — don't interrupt */
            if (_iw.rungFor[groupId] === d.startedAt) return;   /* already rang for this exact call */
            /* Freshness guard: only ring for a call that started recently —
               otherwise reattaching this listener (app reopened, tab
               refocused) would ring for a call that's been running for an
               hour. */
            var startedMs = d.startedAt ? new Date(d.startedAt).getTime() : 0;
            if (!startedMs || (Date.now() - startedMs) > 30000) return;

            _iw.rungFor[groupId] = d.startedAt;
            var meta = _iw.groupMeta[groupId] || {};
            _showIncomingCallBanner(groupId, meta, d.type, d.startedByName);
        }, function (err) { console.warn('[GroupCall] ring watcher error for', groupId, err.message); });
    }

    function _initIncomingCallWatcher(attempt) {
        attempt = attempt || 0;
        /* FIX (2026-08-01 — "group calls don't ring on the recipient's
           end"): this used to query groups.where('members','array-
           contains', _authUid()) — the LIVE, per-session (often
           anonymous) Firebase Auth uid. But groups/{id}.members is
           populated with each person's PERSISTENT app user id
           (_us().id) — see app-patch-v13.js's group-creation handler,
           and the IDENTICAL query in app-patch-calls-log.js, which
           already correctly uses the persistent id. Those two id
           spaces essentially never match on this app's per-session/
           anonymous auth model (the same mismatch documented
           extensively in firebase-rules.js), so this listener was
           subscribing to a query that matched zero of the person's
           actual groups — silently, with no error, since an empty
           result set isn't a permission failure. No group's call-doc
           listener was ever attached, so nobody's device could ever
           show the incoming-call banner or play the ring tone,
           regardless of anything else in this file. Still requires a
           live auth session to actually read Firestore (_fbOk() +
           _authUid() below), just no longer uses that uid as the
           membership key itself. */
        var myId = _us().id || _authUid() || '';
        if (!_fbOk() || !myId || !_authUid()) {
            if (attempt >= 20) { console.warn('[GroupCall] incoming-call watcher gave up waiting for auth/Firebase'); return; }
            setTimeout(function () { _initIncomingCallWatcher(attempt + 1); }, 500);
            return;
        }
        _iw.groupsUnsub = window.fbDb.collection('groups').where('members', 'array-contains', myId)
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (ch) {
                    var gid = ch.doc.id;
                    if (ch.type === 'removed') {
                        if (_iw.callUnsubs[gid]) { try { _iw.callUnsubs[gid](); } catch (e) {} delete _iw.callUnsubs[gid]; }
                        delete _iw.groupMeta[gid];
                        _stopRingFor(gid);
                        return;
                    }
                    var d = ch.doc.data();
                    _iw.groupMeta[gid] = { name: d.name || 'Group', avatar: d.avatar || '' };
                    _watchGroupCallForRing(gid);
                });
            }, function (err) { console.warn('[GroupCall] groups-membership watcher error:', err.message); });
    }
    _initIncomingCallWatcher();

    // FIX (2026-08-13 — "[GroupCall] groups-membership watcher error:
    // Missing or insufficient permissions" appearing AFTER the listener
    // had already attached successfully once): _initIncomingCallWatcher's
    // own guard (_fbOk() + _authUid()) is correct at the moment it first
    // subscribes, but the subscription itself is never re-created after
    // that. If this device's live Firebase Auth uid later changes — the
    // anonymous-session-to-real-login transition this codebase's own
    // patch history (app-patch-v12.js/v26.js/v31.js) documents extensively
    // — the groups/{groupId} array-contains query stays bound to the OLD
    // uid's now-superseded auth context, and the next reconnect Firestore
    // does under the hood permission-denies it. Tearing the listener down
    // and re-running _initIncomingCallWatcher() whenever the uid actually
    // changes (not on every auth event — anonymous sign-in firing once at
    // boot shouldn't cause a pointless resubscribe) keeps the
    // subscription's auth context in sync with whichever uid is live.
    (function _rewatchOnAuthChange() {
        var _lastUid = _authUid();
        function _armWatcher() {
            if (!window.fbAuth || typeof window.fbAuth.onAuthStateChanged !== 'function' || _rewatchOnAuthChange._armed) return;
            _rewatchOnAuthChange._armed = true;
            window.fbAuth.onAuthStateChanged(function (fbUser) {
                var uid = fbUser && fbUser.uid;
                if (uid === _lastUid) return; // no real change — ignore
                _lastUid = uid;
                if (!uid) return; // signed out — nothing to resubscribe with
                if (_iw.groupsUnsub) { try { _iw.groupsUnsub(); } catch (e) {} _iw.groupsUnsub = null; }
                _initIncomingCallWatcher();
            });
        }
        _armWatcher();
        // fbAuth is a pre-init stub until Firebase actually loads (see
        // firebase-init.js) — re-arm once the real SDK replaces it.
        window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_armWatcher, 50); });
    })();

    console.log('[GroupCall] ✅ Group video/voice call ready.');
})();