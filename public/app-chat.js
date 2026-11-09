/* =============================================================================
   EMPYREAN INTERNATIONAL — DIRECT MESSAGES / CHAT
   app-chat.js  |  Step 0.12a  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Complete messaging system extracted from app-fixes.js.  Covers:

     • createMessageElement(text, isSent, isFile, fileUrl, fileType, messageId)
     • renderContactList()        — contact list with unread badges, last preview
     • openChat(userId)           — open thread, load history, Firestore listener
     • Message form submit        — localStorage + Firestore dual persistence
     • Mobile back button         — responsive contact ↔ chat panel switching
     • Contact search filter      — live filter by name
     • Firestore real-time sync   — incoming message listener per conversation
     • Media attachments          — image / video / audio / file send

   LOAD ORDER
   ──────────
   Must come AFTER: firebase-init, app-state, app-helpers, app-notifications,
   app-auth.

   DEPENDS ON
   ──────────
   • window.EmpState / window.userState / window.mockUsers
   • window.isGuest / window._firebaseLoaded / window.fbDb
   • window._timeAgo          (app-helpers.js)
   • window.formatWhatsAppText (app-helpers.js)
   • window.showNotification   (app-helpers.js)
   • window.pushNotification   (app-notifications.js)
   • window.uploadToCloudinary (app-dom.js — for media attachments)

   PUBLIC API
   ──────────
   window.createMessageElement(text, isSent, isFile?, fileUrl?, fileType?, msgId?)
   window.renderContactList()
   window.openChat(userId)

   SECTION MAP
   ───────────
   §1  createMessageElement — message bubble builder
   §2  renderContactList    — contact list with badges + search
   §3  openChat             — conversation view, history load, Firestore listener
   §4  Message send handler — submit form, localStorage, Firestore write
   §5  Media attachment     — file input + Cloudinary upload
   §6  Firestore real-time  — incoming message onSnapshot per thread
   §7  Event delegation     — contact click, mobile back, message input
   §8  Bootstrap

   ============================================================================= */

(function empyreanChatModule() {
    'use strict';

    if (window._empyreanChatLoaded) {
        console.warn('[EmpChat] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanChatLoaded = true;

    /* ── State accessors ── */
    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState  || window.userState || {}; }
    function _mu()      { return (_S().mockUsers) || window.mockUsers || {}; }
    function _isGuest() { var s = _S(); return s.isGuest != null ? s.isGuest : !!window.isGuest; }

    /** Active Firestore message listener handle (unsubscribe fn) */
    var _activeMsgListener = null;

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* =========================================================================
       §0  CHAT ACCESS + END-TO-END ENCRYPTION  (added 2026-10-30)
       -------------------------------------------------------------------------
       §0a  WHO MAY CHAT (revised 2026-10-30).  Chat is open, like other social apps:
              1. Follower chats  — anyone can message someone they follow; it shows in
                 the recipient's chat log.
              2. Non-follower chats — anyone can message anyone, followed or not. Once a
                 message exists the conversation shows in BOTH chat logs (and unread ones
                 from people you do not follow also appear under "Message requests").
              3. Marketplace — sellers receive inquiries from anyone (separate
                 marketplace_messages threads; never gated by this rule).
              4. Groups — listed for members only (groups.members), handled in
                 app-patch-v13.js / app-patch-v20.js; not gated by this rule.
            The rule still lives in ONE function, window._empCanChat(uid) — every list /
            picker / opener asks it, so tightening it later is a one-line edit. The chat
            LIST is built from people you follow + everyone you have a 1:1 conversation
            with (see _refreshPeers). Nothing is ever deleted by this rule.
       §0b  ENCRYPTION.  Text messages are sealed on the sender's device and opened
            on the recipient's device; Firestore only ever stores ciphertext.
              • Each device makes an ECDH P-256 key pair once. The private key is a
                NON-EXTRACTABLE CryptoKey kept in IndexedDB — it never leaves the
                device and is never uploaded. The public key is published in
                users/{uid}.e2eeDevices[kid] (public keys are not secret).
              • Per message: a random AES-256-GCM key encrypts the text; that key is
                wrapped separately for every device of the recipient AND of the
                sender (ephemeral-static ECDH → HKDF-SHA256 → AES-GCM). This is what
                lets all of your own devices read your own history, like WhatsApp.
              • The envelope is stored in the existing `text` field as
                "e2ee1:<base64url json>" (plus e2ee:true), so retry queues, the
                chat-list preview, etc. keep working unchanged.
            Honest limits: attachments (photos/video/voice) are still uploaded to
            Cloudinary as before — only message text and captions are end-to-end
            encrypted. A message sent to someone whose app has not yet published a
            key is sent un-encrypted (E2EE_ALLOW_PLAINTEXT_FALLBACK) so chats never
            break during rollout; set it to false to refuse instead.
       ========================================================================= */

    /* ── §0a  access rule ── */
    var _fol = { set: {}, loaded: false, ts: 0, p: null };

    function _idList(f) {
        if (!f) return [];
        if (f instanceof Set) return Array.from(f);
        return Array.isArray(f) ? f : [];
    }
    function _myIds() {
        var ids = [], us = _us();
        if (us && us.id) ids.push(us.id);
        var a = window.fbAuth && window.fbAuth.currentUser;
        if (a && !a.isAnonymous && a.uid && ids.indexOf(a.uid) === -1) ids.push(a.uid);
        return ids;
    }
    function _myDocId() {
        var a = window.fbAuth && window.fbAuth.currentUser;
        return (a && !a.isAnonymous && a.uid) || _us().id || '';
    }
    function _iFollow(uid) {
        var f = _us().followedUserIds;
        if (f instanceof Set) return f.has(uid);
        return Array.isArray(f) && f.indexOf(uid) !== -1;
    }
    function _theyFollowMe(uid) {
        if (_fol.set[uid]) return true;
        if (_fol.loaded) return false; /* the follower query is authoritative once it has run */
        var u = _mu()[uid], theirs = _idList(u && u.followedUserIds), mine = _myIds();
        for (var i = 0; i < mine.length; i++) { if (theirs.indexOf(mine[i]) !== -1) return true; }
        return false;
    }

    /* The one rule: anyone may chat with anyone except themselves (see §0a). */
    window._empCanChat = function (uid) {
        if (!uid || _myIds().indexOf(uid) !== -1) return false;
        return true; /* open chat — see §0a. Self is the only exclusion. */
    };

    /* Who follows me? One query on followedUserIds — the same one app-fix-final.js
       already uses for the follower count. Their user docs are merged into
       mockUsers so their rows can render. Re-renders the list only if it changed. */
    function _refreshFollowers(force) {
        if (_isGuest() || !window.fbDb || !window._firebaseLoaded) return Promise.resolve();
        var ids = _myIds();
        if (!ids.length) return Promise.resolve();
        if (_fol.p) return _fol.p;
        if (!force && _fol.loaded && Date.now() - _fol.ts < 60000) return Promise.resolve();
        var q = window.fbDb.collection('users');
        q = ids.length > 1 ? q.where('followedUserIds', 'array-contains-any', ids) : q.where('followedUserIds', 'array-contains', ids[0]);
        _fol.p = q.limit(5000).get().then(function (snap) {
            var next = {}, mu = _mu();
            snap.forEach(function (doc) {
                next[doc.id] = true;
                if (!mu[doc.id]) { var d = doc.data() || {}; d.id = d.id || doc.id; try { mu[doc.id] = d; } catch (e) {} }
            });
            var a = Object.keys(next).sort().join(','), b = Object.keys(_fol.set).sort().join(',');
            var changed = !_fol.loaded || a !== b;
            _fol.set = next; _fol.loaded = true; _fol.ts = Date.now(); _fol.p = null;
            if (changed) { try { renderContactList(); } catch (e) {} }
        }).catch(function () { _fol.p = null; });
        return _fol.p;
    }
    window._empRefreshChatAccess = _refreshFollowers;

    /* ── Conversation partners (2026-10-30) ──
       Everyone I have exchanged a 1:1 message with, in EITHER direction, so a chat a
       non-follower starts shows up in the recipient's log (and mine, once I reply).
       Two single-field equality queries (no composite index needed). Re-renders the
       list only if the set changed. Fails soft: on error the list just falls back to
       followed people + local threads + unread senders. */
    var _peers = { set: {}, loaded: false, ts: 0, p: null };
    function _refreshPeers(force) {
        if (_isGuest() || !window.fbDb || !window._firebaseLoaded) return Promise.resolve();
        var ids = _myIds();
        if (!ids.length) return Promise.resolve();
        if (_peers.p) return _peers.p;
        if (!force && _peers.loaded && Date.now() - _peers.ts < 60000) return Promise.resolve();
        var col = window.fbDb.collection('messages'), jobs = [];
        function pull(field, other, id) {
            return col.where(field, '==', id).limit(400).get().then(function (snap) {
                var out = [];
                snap.forEach(function (d) {
                    var m = d.data() || {};
                    if (m.deleted === true || !m[other] || ids.indexOf(m[other]) !== -1) return;
                    out.push(m[other]);
                });
                return out;
            }).catch(function () { return null; });
        }
        ids.forEach(function (id) { jobs.push(pull('receiverId', 'senderId', id)); jobs.push(pull('senderId', 'receiverId', id)); });
        _peers.p = Promise.all(jobs).then(function (res) {
            _peers.p = null;
            if (res.every(function (r) { return r === null; })) return; /* every query failed — keep what we had */
            var next = {};
            res.forEach(function (r) { (r || []).forEach(function (u) { next[u] = true; }); });
            var changed = !_peers.loaded || Object.keys(next).sort().join(',') !== Object.keys(_peers.set).sort().join(',');
            _peers.set = next; _peers.loaded = true; _peers.ts = Date.now();
            if (changed) { try { renderContactList(); } catch (e) {} }
        }).catch(function () { _peers.p = null; });
        return _peers.p;
    }
    window._empRefreshChatPeers = _refreshPeers;

    /* Fetch user docs for chat partners we have no profile for yet (e.g. a stranger who
       just messaged us), merge them into mockUsers, then redraw once. Each id is tried
       once only, so a deleted account can never cause a render loop. */
    var _uTried = {};
    function _loadMissingUsers(ids) {
        if (_isGuest() || !window.fbDb || !window._firebaseLoaded) return;
        var mu = _mu();
        var todo = ids.filter(function (id) { return id && !mu[id] && !_uTried[id]; }).slice(0, 40);
        if (!todo.length) return;
        todo.forEach(function (id) { _uTried[id] = true; });
        Promise.all(todo.map(function (id) {
            return window.fbDb.collection('users').doc(id).get().then(function (doc) {
                if (!doc.exists) return false;
                var d = doc.data() || {}; d.id = d.id || doc.id;
                try { mu[doc.id] = d; } catch (e) {}
                return true;
            }).catch(function () { return false; });
        })).then(function (r) {
            if (r.some(Boolean)) { try { renderContactList(); } catch (e) {} }
        });
    }

    /* Called when someone tries to open a chat the local cache says is not allowed.
       Cached follower data can be a little stale, so ask the server once before
       refusing: if they really do follow you back, carry on and open it. */
    window._empGateChat = function (uid, name, proceed) {
        function say(m) { if (typeof window.showNotification === 'function') window.showNotification(m, 'info'); }
        var u = _mu()[uid] || {};
        var nm = name || u.fullName || u.username || 'this person';
        if (!_iFollow(uid)) { say('Follow ' + nm + ' to chat. Messaging opens once you follow each other.'); return; }
        if (!window.fbDb || !window._firebaseLoaded) { say('Could not check chat access — check your connection.'); return; }
        window.fbDb.collection('users').doc(uid).get().then(function (doc) {
            var d = doc.exists ? (doc.data() || {}) : {}, theirs = _idList(d.followedUserIds);
            var ok = _myIds().some(function (id) { return theirs.indexOf(id) !== -1; });
            if (ok) {
                _fol.set[uid] = true;
                if (!_mu()[uid]) { d.id = d.id || uid; try { _mu()[uid] = d; } catch (e) {} }
                proceed();
            } else {
                say(nm + ' has not followed you back yet. You can chat as soon as they do.');
            }
        }).catch(function () { say('Could not check chat access — check your connection.'); });
    };

    /* ── §0b  end-to-end encryption ── */
    var E2EE_PREFIX = 'e2ee1:';
    var E2EE_ALLOW_PLAINTEXT_FALLBACK = true;
    var E2EE_LOCKED_TEXT = '\uD83D\uDD12 Message can\u2019t be read on this device';
    var _e2 = { dev: null, devP: null, pubAt: {}, peer: {}, plain: {} };

    function _e2Ok() { return !!(window.crypto && window.crypto.subtle && window.indexedDB && typeof TextEncoder !== 'undefined'); }

    function _b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
    function _unb64(s) { var bin = atob(s), o = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
    function _b64u(s) { return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function _unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return s; }
    function _rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }

    function _idb() {
        return new Promise(function (res, rej) {
            var r = indexedDB.open('empyrean-e2ee', 1);
            r.onupgradeneeded = function () { r.result.createObjectStore('keys'); };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
        });
    }
    function _idbGet(k) {
        return _idb().then(function (db) {
            return new Promise(function (res, rej) {
                var rq = db.transaction('keys', 'readonly').objectStore('keys').get(k);
                rq.onsuccess = function () { res(rq.result); };
                rq.onerror = function () { rej(rq.error); };
            });
        });
    }
    function _idbPut(k, v) {
        return _idb().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction('keys', 'readwrite');
                tx.objectStore('keys').put(v, k);
                tx.oncomplete = function () { res(); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }

    /* This device's key pair for the signed-in account (created once, kept per account). */
    function _ensureDevice() {
        var me = _myDocId();
        if (!me) return Promise.reject(new Error('no-account'));
        if (_e2.dev && _e2.dev.owner === me) return Promise.resolve(_e2.dev);
        if (_e2.devP && _e2.devP.owner === me) return _e2.devP.p;
        var p = (async function () {
            var rec = await _idbGet(me);
            if (!rec || !rec.priv || !rec.pub) {
                var kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
                var jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
                var raw = await crypto.subtle.exportKey('raw', kp.publicKey);
                var h = await crypto.subtle.digest('SHA-256', raw);
                rec = { kid: 'k' + _b64u(_b64(h)).slice(0, 10), priv: kp.privateKey, pub: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
                await _idbPut(me, rec);
            }
            rec.owner = me;
            _e2.dev = rec;
            return rec;
        })();
        _e2.devP = { owner: me, p: p };
        p.catch(function () { _e2.devP = null; });
        return p;
    }

    /* Publish this device's PUBLIC key (re-checked now and then, in case the
       profile document was ever rewritten without it). */
    function _publishDevice() {
        if (!_e2Ok() || !window.fbDb || !window._firebaseLoaded) return Promise.resolve(false);
        var me = _myDocId();
        if (!me) return Promise.resolve(false);
        return _ensureDevice().then(function (d) {
            var ck = me + ':' + d.kid;
            if (_e2.pubAt[ck] && Date.now() - _e2.pubAt[ck] < 600000) return true;
            var ref = window.fbDb.collection('users').doc(me);
            return ref.get().then(function (doc) {
                var cur = doc.exists && (doc.data() || {}).e2eeDevices;
                if (cur && cur[d.kid]) { _e2.pubAt[ck] = Date.now(); return true; }
                var upd = { e2eeDevices: {} };
                upd.e2eeDevices[d.kid] = { jwk: d.pub, ts: Date.now() };
                return ref.set(upd, { merge: true }).then(function () { _e2.pubAt[ck] = Date.now(); return true; });
            });
        }).catch(function (e) { console.warn('[E2EE] could not publish device key:', e && (e.code || e.message)); return false; });
    }

    /* Public keys of a user's devices (newest 6). Cached briefly; an empty result is
       re-checked sooner so a peer who has just opened the app is picked up quickly. */
    function _getDevices(uid) {
        var c = _e2.peer[uid];
        if (c && Date.now() - c.t < (c.devs.length ? 300000 : 20000)) return Promise.resolve(c.devs);
        return window.fbDb.collection('users').doc(uid).get().then(function (doc) {
            var m = (doc.exists && (doc.data() || {}).e2eeDevices) || {};
            var devs = Object.keys(m).map(function (k) { return { kid: k, jwk: m[k] && m[k].jwk, ts: (m[k] && m[k].ts) || 0 }; })
                .filter(function (d) { return d.jwk && d.jwk.x && d.jwk.y; })
                .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 6);
            _e2.peer[uid] = { t: Date.now(), devs: devs };
            return devs;
        });
    }

    async function _wrapKey(priv, pub, saltRaw) {
        var bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
        var base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: saltRaw, info: new TextEncoder().encode('empyrean-e2ee-v1') },
            base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    /* → envelope string, or null when it cannot be encrypted (e.g. peer has no key yet) */
    async function _encrypt(plain, peerId) {
        if (!_e2Ok() || !window.fbDb || !peerId) return null;
        var mine = await _ensureDevice();
        await _publishDevice();
        var peerDevs = await _getDevices(peerId);
        if (!peerDevs.length) return null;
        var myDevs = [];
        try { myDevs = await _getDevices(_myDocId()); } catch (e) {}
        var targets = {};
        peerDevs.concat(myDevs).forEach(function (d) { targets[d.kid] = d; });
        targets[mine.kid] = { kid: mine.kid, jwk: mine.pub };

        var K = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
        var iv = _rand(12);
        var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, K, new TextEncoder().encode(String(plain)));
        var rawK = await crypto.subtle.exportKey('raw', K);
        var eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        var ephRaw = await crypto.subtle.exportKey('raw', eph.publicKey);
        var wraps = {};
        for (var kid in targets) {
            if (!Object.prototype.hasOwnProperty.call(targets, kid)) continue;
            try {
                var pub = await crypto.subtle.importKey('jwk', targets[kid].jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
                var wk = await _wrapKey(eph.privateKey, pub, ephRaw);
                var wiv = _rand(12);
                var wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wiv }, wk, rawK);
                wraps[kid] = _b64(wiv) + '.' + _b64(wrapped);
            } catch (e) { /* a malformed device key must not block the others */ }
        }
        if (!Object.keys(wraps).length) return null;
        var env = JSON.stringify({ i: _b64(iv), c: _b64(ct), e: _b64(ephRaw), w: wraps });
        return E2EE_PREFIX + _b64u(_b64(new TextEncoder().encode(env)));
    }

    /* → plaintext, or null when this device cannot open it */
    async function _decrypt(str) {
        if (typeof str !== 'string' || str.indexOf(E2EE_PREFIX) !== 0) return str;
        if (Object.prototype.hasOwnProperty.call(_e2.plain, str)) return _e2.plain[str];
        if (!_e2Ok()) return null;
        try {
            var dev = await _ensureDevice();
            var env = JSON.parse(new TextDecoder().decode(_unb64(_unb64u(str.slice(E2EE_PREFIX.length)))));
            var wrap = env.w && env.w[dev.kid];
            if (!wrap) return null;
            var parts = wrap.split('.');
            var ephRaw = _unb64(env.e);
            var ephPub = await crypto.subtle.importKey('raw', ephRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
            var wk = await _wrapKey(dev.priv, ephPub, ephRaw);
            var rawK = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(parts[0]) }, wk, _unb64(parts[1]));
            var K = await crypto.subtle.importKey('raw', rawK, 'AES-GCM', false, ['decrypt']);
            var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(env.i) }, K, _unb64(env.c));
            var out = new TextDecoder().decode(pt);
            _e2.plain[str] = out;
            return out;
        } catch (e) { return null; }
    }

    function _isEnv(s) { return typeof s === 'string' && s.indexOf(E2EE_PREFIX) === 0; }
    function _readText(s) {
        if (!_isEnv(s)) return Promise.resolve(s);
        return _decrypt(s).then(function (t) { return t == null ? E2EE_LOCKED_TEXT : t; });
    }

    /* Seals p.text and p.replyTo.text of an outgoing message document in place.
       Media-only messages have nothing to seal. */
    function _sealPayload(p, peerId) {
        if (!p || p.e2ee) return Promise.resolve(p);
        var needText = !!p.text, needReply = !!(p.replyTo && p.replyTo.text);
        if (!needText && !needReply) return Promise.resolve(p);
        function fallback() { return E2EE_ALLOW_PLAINTEXT_FALLBACK ? p : Promise.reject(new Error('e2ee-unavailable')); }
        if (!_e2Ok()) return Promise.resolve().then(fallback);
        return Promise.all([
            needText ? _encrypt(p.text, peerId) : null,
            needReply ? _encrypt(p.replyTo.text, peerId) : null
        ]).then(function (r) {
            if ((needText && !r[0]) || (needReply && !r[1])) return fallback();
            if (needText) p.text = r[0];
            if (needReply) p.replyTo = Object.assign({}, p.replyTo, { text: r[1] });
            p.e2ee = true;
            return p;
        }, function () { return fallback(); });
    }

    function _decryptMessage(data) {
        if (!data) return Promise.resolve(data);
        var jobs = [];
        if (_isEnv(data.text)) jobs.push(_readText(data.text).then(function (t) { data.text = t; }));
        if (data.replyTo && _isEnv(data.replyTo.text)) jobs.push(_readText(data.replyTo.text).then(function (t) { data.replyTo = Object.assign({}, data.replyTo, { text: t }); }));
        return jobs.length ? Promise.all(jobs).then(function () { return data; }) : Promise.resolve(data);
    }

    window._empE2EE = {
        supported: _e2Ok,
        isEnvelope: _isEnv,
        init: function () { return _publishDevice(); },
        encrypt: function (t, peerId) { return _encrypt(t, peerId).catch(function () { return null; }); },
        decrypt: _decrypt,
        readText: _readText,
        sealPayload: _sealPayload,
        decryptMessage: _decryptMessage,
        peerReady: function (uid) {
            if (!_e2Ok() || !window.fbDb || !uid) return Promise.resolve(false);
            return _getDevices(uid).then(function (d) { return d.length > 0; }).catch(function () { return false; });
        }
    };

    /* Make sure this device has a key and has published it as soon as the user is signed in. */
    function _e2Boot() { if (!_isGuest() && _us().id && _e2Ok()) _publishDevice(); }
    document.addEventListener('empyrean-user-ready', function () { setTimeout(_e2Boot, 1200); });
    window.addEventListener('load', function () { setTimeout(_e2Boot, 3500); });


    /* ── Premium chat header + message-background styling (injected once) ── */
    function _ensureChatPremiumStyle() {
        if (document.getElementById('_chat-premium-style')) return;
        var s = document.createElement('style');
        s.id = '_chat-premium-style';
        s.textContent = [
            '#chat-header-info.chat-header-premium{',
            '  background:linear-gradient(135deg,#0B1437 0%,#1B2B8B 100%);',
            '  padding:12px 16px;box-shadow:0 2px 14px rgba(10,14,39,0.18);',
            '  position:relative;z-index:2;',
            '}',
            '.chat-header-premium .chp-avatar{',
            '  width:42px;height:42px;border-radius:50%;overflow:hidden;flex-shrink:0;',
            '  border:2px solid rgba(245,197,24,0.55);box-shadow:0 2px 8px rgba(0,0,0,0.35);',
            '}',
            '.chat-header-premium .chp-avatar img{width:100%;height:100%;object-fit:cover;display:block;}',
            '.chat-header-premium .chp-name{',
            '  display:block;color:#F5F7FF;font-weight:700;font-size:0.96rem;letter-spacing:0.1px;',
            '}',
            '.chat-header-premium .chp-sub{font-size:0.76rem;color:rgba(232,240,255,0.68);}',
            '.chat-header-premium #chat-back-btn{color:#F5F7FF !important;}',
            '#chat-messages-container.chat-bg-premium{',
            '  background:',
            '    radial-gradient(circle at 15% 0%, rgba(27,43,139,0.05) 0%, transparent 45%),',
            '    radial-gradient(circle at 85% 100%, rgba(245,197,24,0.05) 0%, transparent 45%),',
            '    linear-gradient(180deg,#F6F7FB 0%,#EEF0F7 100%);',
            '}'
        ].join('');
        document.head.appendChild(s);
    }


    /* =========================================================================
       §1  createMessageElement
       Builds a single message bubble div for the chat view.
       Supports plain text, images, videos, audio, and generic files.
       ========================================================================= */

    function createMessageElement(text, isSent, isFile, fileUrl, fileType, messageId) {
        isFile    = isFile    || false;
        fileUrl   = fileUrl   || '';
        fileType  = fileType  || '';
        messageId = messageId || ('msg-' + Date.now());

        var el = document.createElement('div');
        el.className        = 'message ' + (isSent ? 'sent' : 'received');
        el.dataset.messageId = messageId;
        el.style.cssText    =
            'max-width:72%;padding:10px 14px;'
            + 'border-radius:' + (isSent ? '18px 18px 4px 18px' : '18px 18px 18px 4px') + ';'
            + 'background:' + (isSent ? 'var(--secondary,#1B2B8B)' : 'white') + ';'
            + 'color:' + (isSent ? 'white' : 'var(--primary)') + ';'
            + 'font-size:0.88rem;line-height:1.45;'
            + 'align-self:' + (isSent ? 'flex-end' : 'flex-start') + ';'
            + 'box-shadow:0 1px 4px rgba(10,14,39,0.08);word-break:break-word;margin-bottom:4px;';

        var contentHTML;
        if (isFile && fileUrl) {
            if (fileType.startsWith('image/')) {
                contentHTML = (text ? '<p>' + _esc(text) + '</p>' : '')
                    + '<img src="' + _esc(fileUrl) + '" class="message-media" alt="Sent image" '
                    + 'style="max-width:100%;border-radius:8px;margin-top:6px;display:block;">';
            } else if (fileType.startsWith('video/')) {
                contentHTML = (text ? '<p>' + _esc(text) + '</p>' : '')
                    + '<video src="' + _esc(fileUrl) + '" class="message-media" controls '
                    + 'style="max-width:100%;border-radius:8px;margin-top:6px;display:block;"></video>';
            } else if (fileType.startsWith('audio/')) {
                contentHTML = (text ? '<p>' + _esc(text) + '</p>' : '')
                    + '<audio src="' + _esc(fileUrl) + '" class="message-media" controls '
                    + 'style="width:100%;margin-top:6px;"></audio>';
            } else {
                contentHTML = '<p><i class="fas fa-file-alt"></i> '
                    + 'Sent a file: <a href="' + _esc(fileUrl) + '" target="_blank" '
                    + 'rel="noopener" style="color:inherit;text-decoration:underline;">'
                    + _esc(text || 'Download') + '</a></p>';
            }
        } else {
            contentHTML = typeof window.formatWhatsAppText === 'function'
                ? window.formatWhatsAppText(text)
                : '<p>' + _esc(text) + '</p>';
        }

        el.innerHTML = contentHTML;
        return el;
    }
    window.createMessageElement = createMessageElement;


    /* =========================================================================
       FEATURE (this session — "enable message viewers count indicator in
       the message chat icon"): syncs #nav-messages-badge (the red circle
       app-nav.js's _buildMobileBottomNav() now renders on the Messages
       icon — see that file's own comment at the same spot) with the total
       unread count computed below. Same show/hide-at-zero, "9+" cap
       pattern app-notifications.js's own updateBadge() already uses for
       the bell icon, so both badges behave identically. Safe to call even
       before the bottom nav has been built yet (no-ops if the element
       isn't there — renderContactList() itself is called on
       empyrean-init-done/empyrean-user-ready, the same events app-nav.js
       already uses to build it, so in practice it's always present by
       the time this runs). */
    function _updateMessagesNavBadge(totalUnread) {
        var badge = document.getElementById('nav-messages-badge');
        if (!badge) return;
        if (totalUnread > 0) {
            badge.style.display = 'flex';
            badge.textContent   = totalUnread > 9 ? '9+' : String(totalUnread);
        } else {
            badge.style.display = 'none';
        }
    }
    window._empUpdateMessagesNavBadge = _updateMessagesNavBadge;

    /* =========================================================================
       CHAT LIST UPGRADE (step 1): readable dates, preview icons, ticks,
       unread filter chip, one Help menu. Added as helpers here so every
       place that paints a row's time/preview (this file, and
       app-patch-v36.js's _v36ApplyToRow) uses the same format.
       ========================================================================= */
    var _CHAT_SVG = {
        mic:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
        photo: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-7 7"/></svg>',
        video: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
        file:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
        tick1: '<svg width="16" height="12" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-label="Sent"><path d="M5 13l5 5L22 6"/></svg>',
        tick2: '<svg width="18" height="12" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-label="Read"><path d="M2 13l5 5L17 6M11 17l1 1L25 6"/></svg>'
    };

    /* Time today -> "09:42", then "Yesterday", weekday name for the rest of
       the week, then "5 Oct" (adds the year only for a different year). */
    function _chatListTime(ts) {
        if (ts == null || ts === '') return '';
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '';
        var now = new Date();
        var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var startMsg   = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        var days = Math.round((startToday - startMsg) / 86400000);
        if (days <= 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        if (days === 1) return 'Yesterday';
        if (days < 7)  return d.toLocaleDateString('en-GB', { weekday: 'short' });
        var opts = { day: 'numeric', month: 'short' };
        if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString('en-GB', opts);
    }
    window._chatListTime = _chatListTime;

    /* Chat-list order (newest first, pinned on top) is a CSS `order` on every row
       (1:1, group, broadcast share one flex column). It used to be applied only by
       a periodic pass in app-patch-v20.js, so any row rebuilt in between (1:1 rows
       are re-created on every render) came back with order 0 and sank BELOW all
       groups until the next pass. Rows now get their position the moment they are
       created or their timestamp changes, via this one shared helper. */
    /* Sort key = the time the row actually DISPLAYS. A row's data-last-ts can drift
       from its visible label (rebuilt rows, hoisted rows, late previews), which is
       how a chat labelled 09:11 ended up under groups labelled 08:32. The label is
       the user's ground truth, so it wins whenever it disagrees with the stored ts. */
    function _labelToMs(txt) {
        txt = String(txt || '').trim();
        if (!txt) return 0;
        var now = new Date(), day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), m;
        if ((m = /^(\d{1,2}):(\d{2})/.exec(txt))) return day0 + (+m[1]) * 3600000 + (+m[2]) * 60000;
        if (/^yesterday$/i.test(txt)) return day0 - 86400000 + 12 * 3600000;
        var wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(txt.slice(0, 3).toLowerCase());
        if (wd !== -1 && /^[A-Za-z]{3,9}$/.test(txt)) {
            var back = (now.getDay() - wd + 7) % 7 || 7;
            return day0 - back * 86400000 + 12 * 3600000;
        }
        var d = new Date(/\d{4}/.test(txt) ? txt : txt + ' ' + now.getFullYear());
        return isNaN(d.getTime()) ? 0 : d.getTime() + 12 * 3600000;
    }
    window._empRowSortKey = function (el) {
        var ts = Number(el.dataset.lastTs) || 0;
        var lab = el.querySelector('.contact-last-time, .v14-group-time');
        if (!lab && el.lastElementChild) lab = el.lastElementChild.querySelector('span');
        var txt = lab ? (lab.textContent || '').trim() : '';
        if (!txt) return ts;
        if (ts && _chatListTime(new Date(ts)) === txt) return ts;   /* stored ts agrees with the label */
        return _labelToMs(txt) || ts;
    };
    window._empApplyRowOrder = function (el) {
        if (!el || !el.dataset) return;
        var o = (el.dataset.pinned === '1') ? -2000000000 : -Math.floor(window._empRowSortKey(el) / 1000);
        var os = String(o === 0 ? 0 : o);
        if (el.style.order !== os) el.style.order = os;
    };

    /* Icon + short label for a message that carries an attachment. */
    function _previewKind(msg) {
        if (!msg || !msg.fileUrl) return null;
        var t = String(msg.fileType || '').toLowerCase();
        if (t.indexOf('audio') === 0) return { icon: _CHAT_SVG.mic,   label: 'Voice note' };
        if (t.indexOf('image') === 0) return { icon: _CHAT_SVG.photo, label: 'Photo' };
        if (t.indexOf('video') === 0) return { icon: _CHAT_SVG.video, label: 'Video' };
        return { icon: _CHAT_SVG.file, label: msg.text || 'Attachment' };
    }

    /* Sent tick for MY last message (grey single tick). The real read
       state (blue double tick) is applied by _syncLastMessagePreview once
       Firestore reports the recipient has read it. */
    function _tickHTML(msg, myId) {
        if (!msg || msg.from !== myId) return '';
        return '<span class="contact-last-tick" style="display:inline-flex;flex-shrink:0;color:#8A92A8;">' + _CHAT_SVG.tick1 + '</span>';
    }

    /* Filter chips: All | Unread | Groups | Favourites (+ "requests" view
       opened from the Message requests row). Uses a class, never inline
       display, so it can't fight app-patch-v20.js's per-tab hiding or the
       search box's own show/hide. */
    var _chatChip = 'all';
    /* read-only view of the active chip, so app-patch-v20.js can show
       groups + broadcasts mixed into the list on "All" (unified WhatsApp-
       style list) without owning this file's private state */
    window._empChatChip = function () { return _chatChip; };
    var _favKey = 'emp_chat_favs';
    function _getFavs() { try { return JSON.parse(localStorage.getItem(_favKey) || '[]') || []; } catch (e) { return []; } }
    /* read-only favourite check shared with app-patch-v20.js so the Favourites chip can filter groups
       too (groups are stored in the same list under the key 'g:<groupId>') */
    window._empIsFav = function (id) { return _getFavs().indexOf(id) !== -1; };

    /* "Delete chat" from the list: the messages are deleted by window._ocDeleteChat (app-patch-openchat.js);
       this only hides the now-empty row until there is new activity, and wipes the local copy of the thread. */
    var _hideKey = 'emp_chat_hidden';
    function _getHidden() { try { return JSON.parse(localStorage.getItem(_hideKey) || '{}') || {}; } catch (e) { return {}; } }
    function _setHidden(h) { try { localStorage.setItem(_hideKey, JSON.stringify(h)); } catch (e) {} }
    window._empHideChat = function (uid) {
        var h = _getHidden(); h[uid] = Date.now(); _setHidden(h);
        try {
            var ms = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}');
            delete ms[uid];
            localStorage.setItem('empyrean_msgs', JSON.stringify(ms));
        } catch (e) {}
        renderContactList();
    };
    window._empUnhideChat = function (uid) {
        var h = _getHidden();
        if (!h[uid]) return;
        delete h[uid]; _setHidden(h);
        renderContactList();
    };

    /* Real unread counts for 1:1 chats. The row's count used to come only from localStorage['empyrean_msgs'],
       which is only filled when you SEND or have already OPENED that exact thread on this device, so a chat
       where the other person messaged first never had unread > 0 and the Unread chip had nothing to show.
       This listens to the same Firestore docs the chat window marks read:true when you open the thread. */
    var _unreadUnsub = null, _unreadFor = null, _unreadDocs = [], _unreadT = null, _unreadFailAt = 0, _unreadSig = null;
    function _ensureUnreadListener() {
        var me = _us().id;
        if (!me || !window.fbDb || !window._firebaseLoaded || !(window.fbAuth && window.fbAuth.currentUser)) return;
        if (_unreadFor === me) return;
        if (Date.now() - _unreadFailAt < 30000) return;
        /* only while the Messages list is actually on screen — renderContactList also runs in the background at
           startup, and this must not add network load while the rest of the app is still loading */
        var _ci = document.getElementById('contacts-inner');
        if (!_ci || _ci.offsetParent === null) return;
        if (_unreadUnsub) { try { _unreadUnsub(); } catch (e) {} _unreadUnsub = null; }
        _unreadFor = me;
        try {
            _unreadUnsub = window.fbDb.collection('messages')
                .where('receiverId', '==', me).where('read', '==', false).limit(200)
                .onSnapshot(function (snap) {
                    var by = {}; _unreadDocs = [];
                    snap.forEach(function (d) {
                        var m = d.data() || {};
                        if (m.deleted === true || !m.senderId || m.senderId === me) return;
                        by[m.senderId] = (by[m.senderId] || 0) + 1;
                        _unreadDocs.push(d.ref);
                    });
                    /* STABILITY: Firestore delivers a cached snapshot and then a server one, and re-fires on any change.
                       Only rebuild the list when the per-person counts actually differ from what is already shown. */
                    var _sig = JSON.stringify(by);
                    var _changed = !window._empUnreadReady || _sig !== _unreadSig;
                    _unreadSig = _sig;
                    window._empUnreadByPeer = by;
                    window._empUnreadReady = true;
                    if (!_changed) return;
                    clearTimeout(_unreadT);
                    _unreadT = setTimeout(renderContactList, 400);
                }, function (err) {
                    _unreadFor = null; _unreadFailAt = Date.now(); window._empUnreadReady = false; _unreadSig = null;
                    console.warn('[EmpChat] unread listener failed — falling back to local counts:', err && (err.code || err.message));
                });
        } catch (e) { _unreadFor = null; _unreadFailAt = Date.now(); }
    }
    function _activeTab() { try { return localStorage.getItem('emp_msgs_active_tab') || 'chats'; } catch (e) { return 'chats'; } }
    function _clickTab(key) {
        var t = document.querySelector('#v20-chat-tabs .v20-chat-tab[data-tab="' + key + '"]');
        if (t) t.click();
    }
    function _applyChatChipFilter() {
        var container = document.getElementById('contacts-inner');
        if (!container) return;
        var unreadRows = 0;
        container.querySelectorAll('.contact-item').forEach(function (row) {
            var un = Number(row.dataset.unread || 0) > 0;
            if (un && row.dataset.chatHidden !== '1') unreadRows++;
            var hide = (_chatChip === 'unread' && !un)
                    || (_chatChip === 'favs' && row.dataset.fav !== '1')
                    || (_chatChip === 'requests' && row.dataset.request !== '1')
                    || row.dataset.chatHidden === '1';
            row.classList.toggle('emp-chip-hide', hide);
        });
        var cnt = document.getElementById('chat-chip-unread-count');
        if (cnt) { cnt.textContent = unreadRows ? String(unreadRows) : ''; cnt.style.display = unreadRows ? 'inline-block' : 'none'; }
        var tab = _activeTab();
        document.querySelectorAll('#chat-filter-chips .chat-chip').forEach(function (b) {
            var f = b.dataset.filter;
            var tabChip = (f === 'groups' || f === 'broadcasts' || f === 'marketplace' || f === 'calls');
            b.classList.toggle('active', tabChip ? tab === f : (tab === 'chats' && f === _chatChip));
        });
        var rr = document.getElementById('chat-requests-row');
        if (rr) rr.classList.toggle('active', _chatChip === 'requests');
        /* re-run the unified-list filter (groups/broadcasts mixed into "All") right away */
        if (typeof window._v20ApplyFilter === 'function') window._v20ApplyFilter();
    }

    function _markAllRead() {
        try {
            var ms = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}');
            var me = _us().id;
            Object.keys(ms).forEach(function (uid) {
                (ms[uid] || []).forEach(function (m) { if (m.from !== me) m.read = true; });
            });
            localStorage.setItem('empyrean_msgs', JSON.stringify(ms));
        } catch (e) {}
        try {
            var _refs = _unreadDocs.slice(0);
            for (var _i = 0; _i < _refs.length; _i += 450) {
                var _b = window.fbDb.batch();
                _refs.slice(_i, _i + 450).forEach(function (r) { _b.update(r, { read: true }); });
                _b.commit().catch(function () {});
            }
        } catch (e) {}
        renderContactList();
        if (typeof window.showNotification === 'function') window.showNotification('All chats marked as read.', 'success');
    }

    /* "Message requests" row: unread messages from people you do not
       follow. Tapping it shows only those chats (they stay in the main
       list too — nothing is hidden or blocked). */
    function _ensureRequestsRow(container, count) {
        var rr = document.getElementById('chat-requests-row');
        if (!count) { if (rr) rr.remove(); if (_chatChip === 'requests') _chatChip = 'all'; return; }
        if (!rr) {
            rr = document.createElement('div');
            rr.id = 'chat-requests-row';
            rr.style.cssText = 'display:flex;align-items:center;gap:12px;padding:0 16px;height:48px;background:#F5F1E8;cursor:pointer;font-size:0.88rem;font-weight:600;color:#3A3220;';
            rr.innerHTML = '<span style="width:34px;height:34px;border-radius:50%;background:#C9A66B;display:flex;align-items:center;justify-content:center;color:#0A0E27;"><i class="far fa-envelope"></i></span>'
                + '<span>Message requests</span><small id="chat-requests-count" style="margin-left:auto;font-weight:500;color:#5B5340;font-size:0.75rem;"></small>';
            container.insertBefore(rr, container.firstChild);
        } else if (rr.parentNode !== container) {
            container.insertBefore(rr, container.firstChild);
        }
        var c = document.getElementById('chat-requests-count');
        if (c) c.textContent = count + ' new';
    }

    /* "New chat" sheet: every user, searchable; tap one to open the chat. */
    /* UPGRADE: anonymous accounts (no display name, or a placeholder such as
       "User"/"Unknown") are hidden from the chat list AND the New chat people
       search, so the person only ever sees real, named users. */
    function _isAnonUser(u) {
        var nm = String((u && (u.fullName || u.username)) || '').trim();
        return !nm || /^(user|unknown|anonymous|anon|u)$/i.test(nm);
    }

    function _openNewChatSheet() {
        if (document.getElementById('chat-newchat-sheet')) return;
        var us = _us(), extras = {};
        function allUsers() {
            var map = {};
            function add(u) { if (u && u.id && u.id !== us.id && !_isAnonUser(u) && window._empCanChat(u.id)) map[u.id] = u; }
            Object.values(_mu()).forEach(add);
            var ru = window.registeredUsers || {};
            (Array.isArray(ru) ? ru : Object.values(ru)).forEach(add);
            Object.keys(extras).forEach(function (k) { add(extras[k]); });
            return Object.values(map).sort(function (a, b) {
                return String(a.fullName || a.username || '').toLowerCase().localeCompare(String(b.fullName || b.username || '').toLowerCase());
            });
        }
        var ov = document.createElement('div');
        ov.id = 'chat-newchat-sheet';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,39,0.5);display:flex;align-items:flex-end;justify-content:center;';
        ov.innerHTML =
            '<div style="background:#fff;width:100%;max-width:520px;height:82vh;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -10px 40px rgba(10,14,39,0.25);">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px 20px;">'
            + '<div><div style="font-size:1.1rem;font-weight:700;color:#0A0E27;">New chat</div><div id="nc-count" style="font-size:0.75rem;color:#5B6270;margin-top:2px;"></div></div>'
            + '<button type="button" id="nc-close" aria-label="Close" style="width:40px;height:40px;border:0;border-radius:50%;background:#EEF0F6;color:#2A3050;font-size:1rem;cursor:pointer;"><i class="fas fa-times"></i></button></div>'
            + '<div style="padding:4px 16px 10px;"><div style="position:relative;"><i class="fas fa-search" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#5B6270;font-size:0.85rem;"></i>'
            + '<input id="nc-search" type="text" placeholder="Search people" autocomplete="off" style="width:100%;height:42px;box-sizing:border-box;padding:0 14px 0 38px;background:#EEF0F6;border:1.5px solid transparent;border-radius:21px;font-size:0.95rem;outline:none;"></div></div>'
            + '<div id="nc-list" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:20px;"></div></div>';
        document.body.appendChild(ov);

        var listEl = ov.querySelector('#nc-list'), countEl = ov.querySelector('#nc-count'), inp = ov.querySelector('#nc-search');
        function render() {
            var q = (inp.value || '').toLowerCase().trim();
            var users = allUsers().filter(function (u) {
                return !q || String(u.fullName || '').toLowerCase().indexOf(q) !== -1 || String(u.username || '').toLowerCase().indexOf(q) !== -1;
            });
            countEl.textContent = users.length + (users.length === 1 ? ' person' : ' people');
            if (!users.length) {
                listEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#5B6270;font-size:0.9rem;line-height:1.5;">' + (q ? 'No one found.' : 'Search anyone on Empyrean by name or @username.') + '</div>';
                return;
            }
            listEl.innerHTML = users.map(function (u) {
                var fb = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || u.username || 'U') + '&background=1B2B8B&color=fff&size=96';
                var av = u.avatar || u.profilePhoto || fb;
                return '<div class="nc-row" data-uid="' + _esc(u.id) + '" style="display:flex;align-items:center;gap:14px;padding:10px 20px;cursor:pointer;">'
                    + '<img src="' + _esc(av) + '" data-fb="' + _esc(fb) + '" onerror="this.onerror=null;this.src=this.dataset.fb;" style="width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                    + '<div style="min-width:0;"><div style="font-size:0.95rem;font-weight:600;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(u.fullName || u.username || 'User')
                    + (u.hasBlueBadge ? ' <svg width="14" height="14" viewBox="0 0 24 24" style="vertical-align:-2px;"><circle cx="12" cy="12" r="11" fill="#1B2B8B"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '')
                    + '</div>' + (u.username ? '<div style="font-size:0.78rem;color:#5B6270;">@' + _esc(u.username) + '</div>' : '') + '</div></div>';
            }).join('');
        }
        render();
        inp.addEventListener('input', render);
        function close() { ov.remove(); }
        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.closest('#nc-close')) { close(); return; }
            var row = e.target.closest('.nc-row');
            if (row) { var uid = row.dataset.uid; close(); if (typeof window.openChat === 'function') window.openChat(uid); }
        });

        /* PEOPLE SEARCH (2026-10-30): chat is open, so the picker lists everyone, not just
           mutual follows. Load a first page of users up front, then — as the person types —
           also ask the server by username / name prefix so people beyond that first page
           can still be found. Results merge into `extras`, which allUsers() already reads. */
        function _mergeSnap(snap) {
            var mu = _mu();
            snap.forEach(function (doc) {
                var d = doc.data() || {}; d.id = d.id || doc.id;
                extras[doc.id] = d;
                if (!mu[doc.id]) { try { mu[doc.id] = d; } catch (e) {} }
            });
        }
        if (!_isGuest() && window.fbDb && window._firebaseLoaded) {
            window.fbDb.collection('users').limit(500).get()
                .then(function (snap) { _mergeSnap(snap); if (document.getElementById('chat-newchat-sheet')) render(); })
                .catch(function () {});
            var _srchT = null;
            inp.addEventListener('input', function () {
                clearTimeout(_srchT);
                var raw = (inp.value || '').trim().replace(/^@/, '');
                if (raw.length < 2) return;
                _srchT = setTimeout(function () {
                    var users = window.fbDb.collection('users');
                    var cap = raw.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
                    var variants = [['username', raw.toLowerCase()], ['fullNameLower', raw.toLowerCase()], ['fullName', raw], ['fullName', cap], ['fullName', raw.toLowerCase()], ['fullName', raw.toUpperCase()]];
                    var seen = {};
                    Promise.all(variants.filter(function (v) { var k = v[0] + v[1]; if (seen[k]) return false; seen[k] = 1; return true; }).map(function (v) {
                        return users.where(v[0], '>=', v[1]).where(v[0], '<=', v[1] + '\uf8ff').limit(30).get().catch(function () { return null; });
                    })).then(function (snaps) {
                        snaps.forEach(function (sn) { if (sn) _mergeSnap(sn); });
                        if (document.getElementById('chat-newchat-sheet')) render();
                    });
                }, 300);
            });
        }
    }

    function _ensureComposeFab() {
        var list = document.getElementById('contact-list-container');
        if (!list || document.getElementById('chat-compose-wrap')) return;
        var w = document.createElement('div');
        w.id = 'chat-compose-wrap';
        w.style.cssText = 'position:relative;height:0;overflow:visible;z-index:40;pointer-events:none;';
        /* FIX: the button used to be position:absolute inside a sticky wrapper, so on
           a long list (or when the list scrolled under the bottom nav) it ended up
           hidden behind the nav. It is now fixed to the viewport, lifted above the
           measured bottom-nav height, and recoloured navy. */
        w.innerHTML = '<button type="button" id="chat-compose-fab" aria-label="New chat" title="New chat" style="position:fixed;right:16px;bottom:var(--emp-fab-bottom,84px);width:58px;height:58px;border-radius:18px;border:0;background:linear-gradient(135deg,#2A3BB0 0%,#1B2B8B 100%);color:#fff;font-size:1.35rem;box-shadow:0 8px 20px rgba(27,43,139,0.45);cursor:pointer;pointer-events:auto;display:flex;align-items:center;justify-content:center;z-index:40;">' + _SVG_PENCIL + '</button>';
        function _placeFab() {
            var nav = document.querySelector('.bottom-nav');
            var h = nav ? nav.getBoundingClientRect().height : 0;
            var safe = 0; /* nav height already includes the safe-area padding */
            if (h > 0) document.documentElement.style.setProperty('--emp-fab-bottom', Math.round(Math.max(0, h - safe) + 16) + 'px');
        }
        _placeFab();
        window.addEventListener('resize', _placeFab);
        window.addEventListener('orientationchange', function () { setTimeout(_placeFab, 300); });
        setTimeout(_placeFab, 800);
        list.appendChild(w);
    }


    /* ── Pin / mute (per device, same localStorage pattern as Favourites) ── */
    var _pinKey = 'emp_chat_pins', _muteKey = 'emp_chat_mutes';
    function _getPins()  { try { return JSON.parse(localStorage.getItem(_pinKey)  || '[]') || []; } catch (e) { return []; } }
    function _getMutes() { try { return JSON.parse(localStorage.getItem(_muteKey) || '[]') || []; } catch (e) { return []; } }
    function _togglePin(uid) {
        var pins = _getPins(), i = pins.indexOf(uid);
        if (i === -1) {
            if (pins.length >= 3) { if (typeof window.showNotification === 'function') window.showNotification('You can pin up to 3 chats.', 'warning'); return; }
            pins.push(uid);
        } else pins.splice(i, 1);
        try { localStorage.setItem(_pinKey, JSON.stringify(pins)); } catch (e) {}
        renderContactList();
    }
    function _toggleMute(uid) {
        var m = _getMutes(), i = m.indexOf(uid);
        if (i === -1) m.push(uid); else m.splice(i, 1);
        try { localStorage.setItem(_muteKey, JSON.stringify(m)); } catch (e) {}
        renderContactList();
        if (typeof window.showNotification === 'function') window.showNotification(i === -1 ? 'Chat muted.' : 'Chat unmuted.', 'info');
    }
    window._empIsChatMuted = function (uid) { return _getMutes().indexOf(uid) !== -1; };

    var _SVG_PIN   = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#8A92A8" aria-label="Pinned"><path d="M16 3l5 5-2 1-3.5 3.5.5 4-1.5 1.5-3.5-3.5L6 20l-1-1 4.5-5.5L6 10l1.5-1.5 4 .5L15 5z"/></svg>';
    var _SVG_MUTE  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A92A8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Muted"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>';
    var _SVG_CLOCK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    var _SVG_PENCIL = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

    /* ── Row status line: "typing…" and "Waiting for network, will retry" ──
       typing  : peer's chats/{chatId}.typing.<theirId> changes (written by
                 app-patch-openchat.js while they type; read in app-patch-v36.js's
                 existing chats snapshot listener). Expires 5s after the last ping.
       pending : app-patch-openchat.js queues a message it could not send and
                 records it in localStorage 'emp_chat_pending'; it retries when
                 the connection returns and clears the record. */
    var _typingState = {}, _typingSeen = {}, _typingTimers = {};
    function _pendingFor(uid) {
        try { var p = JSON.parse(localStorage.getItem('emp_chat_pending') || '{}'); return !!(p[uid] && p[uid].length); } catch (e) { return false; }
    }
    function _empRowStatusLine(rowEl, uid) {
        if (!rowEl) return;
        var textEl = rowEl.querySelector('.contact-last-msg');
        if (!textEl) return;
        var typing = !!_typingState[uid];
        var pending = !typing && _pendingFor(uid);
        var shown = rowEl.dataset.statusLine || '';
        var tick = rowEl.querySelector('.contact-last-tick');
        var ico = rowEl.querySelector('.contact-last-icon');
        var old = rowEl.querySelector('.contact-status-ico');
        if (!typing && !pending) {
            if (shown) {
                textEl.textContent = rowEl.dataset.origText || textEl.textContent;
                textEl.classList.remove('emp-status-typing', 'emp-status-pending');
                if (tick) tick.style.display = 'inline-flex';
                if (ico) ico.style.display = 'inline-flex';
                if (old) old.remove();
                delete rowEl.dataset.statusLine;
            }
            return;
        }
        var label = typing ? 'typing\u2026' : 'Waiting for network, will retry';
        if (textEl.textContent !== label) rowEl.dataset.origText = textEl.textContent;
        textEl.textContent = label;
        textEl.classList.toggle('emp-status-typing', typing);
        textEl.classList.toggle('emp-status-pending', !typing);
        if (tick) tick.style.display = 'none';
        if (ico) ico.style.display = 'none';
        if (pending && !old) {
            var c = document.createElement('span');
            c.className = 'contact-status-ico';
            c.innerHTML = _SVG_CLOCK;
            textEl.parentNode.insertBefore(c, textEl);
        } else if (typing && old) { old.remove(); }
        rowEl.dataset.statusLine = typing ? 'typing' : 'pending';
    }
    function _refreshRowStatus(uid) {
        _empRowStatusLine(document.querySelector('#contacts-inner .contact-item[data-user-id="' + uid + '"]'), uid);
    }
    window._empRowStatusLine = _empRowStatusLine;
    window._empRefreshRowStatus = _refreshRowStatus;
    /* Called from app-patch-v36.js's chats snapshot with the peer's latest
       typing value (0/undefined = not typing). The first value seen per
       contact is only a baseline, so a stale value never shows "typing…". */
    window._empNoteTyping = function (uid, val) {
        var first = !(uid in _typingSeen);
        var prev = _typingSeen[uid];
        _typingSeen[uid] = val || 0;
        if (first) return;
        clearTimeout(_typingTimers[uid]);
        if (val && val !== prev) {
            _typingState[uid] = true;
            _typingTimers[uid] = setTimeout(function () { _typingState[uid] = false; _refreshRowStatus(uid); }, 5000);
        } else if (!val) {
            _typingState[uid] = false;
        } else {
            return;
        }
        _refreshRowStatus(uid);
    };
    window.addEventListener('online', function () { setTimeout(function () { try { document.querySelectorAll('#contacts-inner .contact-item[data-user-id]').forEach(function (r) { _empRowStatusLine(r, r.dataset.userId); }); } catch (e) {} }, 1500); });

    /* Long-press menu for a chat row: Pin, Mute, Favourite. */
    function _openRowMenu(uid) {
        var old = document.getElementById('emp-row-menu'); if (old) old.remove();
        var u = _mu()[uid] || {};
        var pinned = _getPins().indexOf(uid) !== -1, muted = _getMutes().indexOf(uid) !== -1, fav = _getFavs().indexOf(uid) !== -1;
        var ov = document.createElement('div');
        ov.id = 'emp-row-menu';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,39,0.45);display:flex;align-items:flex-end;justify-content:center;';
        var btn = 'display:block;width:100%;text-align:left;padding:16px 22px;border:0;border-top:1px solid #F0F2F7;background:#fff;font-size:0.95rem;color:#0A0E27;cursor:pointer;';
        ov.innerHTML = '<div style="background:#fff;width:100%;max-width:520px;border-radius:22px 22px 0 0;overflow:hidden;">'
            + '<div style="padding:16px 22px 12px;font-weight:700;color:#0A0E27;">' + _esc(u.fullName || u.username || 'Chat') + '</div>'
            + '<button type="button" data-act="pin" style="' + btn + '">' + (pinned ? 'Unpin chat' : 'Pin chat') + '</button>'
            + '<button type="button" data-act="mute" style="' + btn + '">' + (muted ? 'Unmute notifications' : 'Mute notifications') + '</button>'
            + '<button type="button" data-act="fav" style="' + btn + '">' + (fav ? 'Remove from Favourites' : 'Add to Favourites') + '</button>'
            + '<button type="button" data-act="del" style="' + btn + 'color:#E53935;">Delete chat</button>'
            + '<button type="button" data-act="close" style="' + btn + 'color:#5B6270;">Cancel</button></div>';
        ov.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-act]');
            if (!b && e.target !== ov) return;
            ov.remove();
            if (!b) return;
            if (b.dataset.act === 'pin') _togglePin(uid);
            else if (b.dataset.act === 'mute') _toggleMute(uid);
            else if (b.dataset.act === 'fav') _toggleFav(uid);
            else if (b.dataset.act === 'del') {
                if (typeof window._ocDeleteChat === 'function') window._ocDeleteChat(uid, function () { window._empHideChat(uid); });
                else if (typeof window.showNotification === 'function') window.showNotification('Delete chat is not available yet — try again in a moment.', 'warning');
            }
        });
        document.body.appendChild(ov);
    }

    /* Long-press menu for a GROUP row: Favourite, Exit group, Delete group (creator only).
       The exit/delete logic itself lives with the group code (app-patch-v13.js). */
    function _openGroupRowMenu(gid) {
        var old = document.getElementById('emp-row-menu'); if (old) old.remove();
        var row = document.querySelector('.v14-group-item[data-group-id="' + gid + '"]');
        var gname = row ? ((row.querySelector('.v14-group-name') || {}).textContent || 'Group') : 'Group';
        var favKey = 'g:' + gid, fav = _getFavs().indexOf(favKey) !== -1;
        var isOwner = typeof window._empIsGroupOwner === 'function' && window._empIsGroupOwner(gid);
        var ov = document.createElement('div');
        ov.id = 'emp-row-menu';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,39,0.45);display:flex;align-items:flex-end;justify-content:center;';
        var btn = 'display:block;width:100%;text-align:left;padding:16px 22px;border:0;border-top:1px solid #F0F2F7;background:#fff;font-size:0.95rem;color:#0A0E27;cursor:pointer;';
        ov.innerHTML = '<div style="background:#fff;width:100%;max-width:520px;border-radius:22px 22px 0 0;overflow:hidden;">'
            + '<div style="padding:16px 22px 12px;font-weight:700;color:#0A0E27;">' + _esc(gname) + '</div>'
            + '<button type="button" data-act="fav" style="' + btn + '">' + (fav ? 'Remove from Favourites' : 'Add to Favourites') + '</button>'
            + '<button type="button" data-act="exit" style="' + btn + 'color:#E53935;">Exit group</button>'
            + (isOwner ? '<button type="button" data-act="delgroup" style="' + btn + 'color:#E53935;">Delete group</button>' : '')
            + '<button type="button" data-act="close" style="' + btn + 'color:#5B6270;">Cancel</button></div>';
        ov.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-act]');
            if (!b && e.target !== ov) return;
            ov.remove();
            if (!b) return;
            if (b.dataset.act === 'fav') _toggleFav(favKey);
            else if (b.dataset.act === 'exit' && typeof window._empExitGroup === 'function') window._empExitGroup(gid);
            else if (b.dataset.act === 'delgroup' && typeof window._empDeleteGroup === 'function') window._empDeleteGroup(gid);
        });
        document.body.appendChild(ov);
    }

    /* Long-press a chat row: opens Pin / Mute / Favourite menu. */
    var _lpTimer = null, _lpFired = false;
    function _toggleFav(uid) {
        var favs = _getFavs(), i = favs.indexOf(uid);
        if (i === -1) favs.push(uid); else favs.splice(i, 1);
        try { localStorage.setItem(_favKey, JSON.stringify(favs)); } catch (e) {}
        renderContactList();
        if (typeof window.showNotification === 'function') window.showNotification(i === -1 ? 'Added to Favourites.' : 'Removed from Favourites.', 'info');
    }
    function _lpStart(e) {
        var grow = e.target.closest && e.target.closest('#contacts-inner .v14-group-item[data-group-id]');
        var row = grow || (e.target.closest && e.target.closest('#contacts-inner .contact-item[data-user-id]'));
        if (!row) return;
        _lpFired = false;
        clearTimeout(_lpTimer);
        _lpTimer = setTimeout(function () { _lpFired = true; if (grow) _openGroupRowMenu(grow.dataset.groupId); else _openRowMenu(row.dataset.userId); }, 600);
    }
    function _lpCancel() { clearTimeout(_lpTimer); }
    document.addEventListener('touchstart', _lpStart, { passive: true });
    document.addEventListener('mousedown', _lpStart);
    ['touchend', 'touchmove', 'touchcancel', 'mouseup', 'mouseleave'].forEach(function (ev) { document.addEventListener(ev, _lpCancel, { passive: true }); });
    document.addEventListener('click', function (e) {
        if (_lpFired) { _lpFired = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
    document.addEventListener('contextmenu', function (e) {
        if (e.target.closest && e.target.closest('#contacts-inner .contact-item[data-user-id], #contacts-inner .v14-group-item[data-group-id]')) e.preventDefault();
    });

    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t.closest) return;

        var chip = t.closest('#chat-filter-chips .chat-chip');
        if (chip) {
            var f = chip.dataset.filter || 'all';
            if (f === 'groups' || f === 'broadcasts' || f === 'marketplace' || f === 'calls') { _clickTab(f); }
            else { if (_activeTab() !== 'chats') _clickTab('chats'); _chatChip = f; }
            setTimeout(_applyChatChipFilter, 0);
            return;
        }
        if (t.closest('#v20-chat-tabs .v20-chat-tab')) { setTimeout(_applyChatChipFilter, 0); }

        if (t.closest('#chat-requests-row')) {
            _chatChip = (_chatChip === 'requests') ? 'all' : 'requests';
            if (_activeTab() !== 'chats') _clickTab('chats');
            setTimeout(_applyChatChipFilter, 0);
            return;
        }
        if (t.closest('#chat-compose-fab')) { _openNewChatSheet(); return; }

        /* ⋮ menu beside the search box: Help, Report, Mark all read, Refresh.
           (Help/Report forward to the two floating buttons, which are
           hidden while Messages is open so they stop covering the list.) */
        var moreMenu = document.getElementById('chat-more-menu');
        if (t.closest('#chat-more-btn')) { if (moreMenu) moreMenu.style.display = (moreMenu.style.display === 'block') ? 'none' : 'block'; return; }
        var mi = t.closest('#chat-more-menu [data-more]');
        if (mi) {
            if (moreMenu) moreMenu.style.display = 'none';
            var act = mi.dataset.more;
            if (act === 'help' || act === 'report') {
                var fab = document.getElementById(act === 'report' ? 'submit-complaint-fab' : 'emp-help-fab');
                if (fab) fab.click();
            } else if (act === 'readall') { _markAllRead(); }
            else { renderContactList(); }
            return;
        }
        if (t.closest('#chat-empty-new')) { _openNewChatSheet(); return; }
        if (moreMenu && moreMenu.style.display === 'block') moreMenu.style.display = 'none';
    });


    /* =========================================================================
       §2  renderContactList
       Builds the contact list from followedUserIds + mockUsers.
       Shows unread badge, last message preview, and timestamp.
       ========================================================================= */

    function renderContactList() {
        if (_isGuest()) return;

        var container = document.getElementById('contacts-inner')
            || document.getElementById('contact-list-container');
        if (!container) return;

        /* FIX (Chat List Specification): this used to be
           `container.innerHTML = '';`, which wipes EVERY child of
           #contacts-inner — including #v14-groups-section (rendered by
           app-patch-v14.js) and #v20-broadcasts-section / the per-tab
           empty-state divs (rendered by app-patch-v20.js), since all
           three files share this one container. Worse, this function is
           called directly (unwrapped) from several places in this same
           file — the incoming/outgoing message handlers and the init /
           user-ready bootstrap below — which bypass app-patch-v14.js's
           window.renderContactList wrapper, so the groups section was
           frequently destroyed without ever being rebuilt, leaving the
           Groups/Broadcasts tabs to fall back to showing whatever plain
           .contact-item rows were still sitting in the shared container.
           This function only OWNS the 1:1 `.contact-item` rows (and its
           own "No contacts yet" placeholder), so it should only ever
           remove those — leaving any sections other files render into
           the same container untouched. */
        Array.prototype.slice.call(container.children).forEach(function (child) {
            if (child.classList && (child.classList.contains('contact-item') || child.id === '_chat-empty-state')) {
                child.remove();
            }
        });

        var us      = _us();
        _ensureUnreadListener();
        var mu      = _mu();
        /* LIST SOURCES (see §0a): people I follow + everyone I have a 1:1 conversation
           with (either direction) + anyone with unread messages for me. A stranger who
           messages me therefore appears here, and under "Message requests". */
        _refreshPeers(false);
        var allUids = new Set(_idList(us.followedUserIds));
        Object.keys(_peers.set).forEach(function (id) { allUids.add(id); });
        Object.keys(window._empUnreadByPeer || {}).forEach(function (id) { allUids.add(id); });

        /* Load localStorage message threads */
        var msgStore = {};
        try { msgStore = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}'); } catch (e) {}
        Object.keys(msgStore).forEach(function (id) { if (id) allUids.add(id); }); /* threads already on this device */
        _loadMissingUsers(Array.from(allUids));

        var followedSet = {};
        (us.followedUserIds instanceof Set ? Array.from(us.followedUserIds) : (Array.isArray(us.followedUserIds) ? us.followedUserIds : [])).forEach(function (id) { followedSet[id] = true; });
        var favList = _getFavs();
        var requestCount = 0;
        var count = 0;
        var totalUnread = 0; // FEATURE (this session): drives #nav-messages-badge, see _updateMessagesNavBadge below
        var pinList = _getPins(), muteList = _getMutes();
        Array.from(allUids).sort(function (a, b) { return (pinList.indexOf(b) !== -1 ? 1 : 0) - (pinList.indexOf(a) !== -1 ? 1 : 0); }).forEach(function (uid) {
            var u = mu[uid];
            if (!u || u.id === us.id) return;
            if (!window._empCanChat(uid)) return; /* open chat today (§0a); kept so the rule stays one edit */
            /* UPGRADE: hide anonymous accounts (no display name, or a placeholder
               like "User"/"Unknown") from the Messages list — they showed up as
               nameless "U" rows. Skipped before count++/unread so they don't
               affect the empty state or the nav badge. */
            if (_isAnonUser({ fullName: u.fullName })) return;
            count++;

            var thread    = msgStore[uid] || [];
            var lastMsg   = thread.length ? thread[thread.length - 1] : null;
            var lastText  = lastMsg
                ? (lastMsg.text.length > 38 ? lastMsg.text.slice(0, 38) + '…' : lastMsg.text)
                : 'Tap to start a conversation';
            var unreadCnt = window._empUnreadReady
                ? (Number(window._empUnreadByPeer && window._empUnreadByPeer[uid]) || 0)
                : thread.filter(function (m) { return m.from !== us.id && !m.read; }).length;
            var isMute = muteList.indexOf(uid) !== -1, isPin = pinList.indexOf(uid) !== -1;
            if (!isMute) totalUnread += unreadCnt; // muted chats don't count toward the nav badge
            var timeStr   = lastMsg ? _chatListTime(lastMsg.ts) : '';
            var pk        = _previewKind(lastMsg);
            if (pk) lastText = pk.label.length > 38 ? pk.label.slice(0, 38) + '…' : pk.label;

            var fallbackAv = 'https://ui-avatars.com/api/?name='
                + encodeURIComponent(u.fullName || 'U') + '&background=1B2B8B&color=fff&size=96';
            var avatar = u.avatar || fallbackAv;

            var el = document.createElement('div');
            el.className = 'contact-item';
            el.dataset.userId = uid;
            /* newest-first ordering across chats/groups/broadcasts (see v20 _applyFilter) */
            el.dataset.lastTs = String(lastMsg && lastMsg.ts ? (new Date(lastMsg.ts).getTime() || 0) : 0);
            el.style.cssText =
                'display:flex;align-items:center;gap:12px;padding:12px 16px;min-height:72px;box-sizing:border-box;'
                + 'border-bottom:1px solid rgba(10,14,39,0.05);cursor:pointer;transition:background 0.15s;';

            el.dataset.unread = String(unreadCnt);
            if (unreadCnt > 0 && !isMute) el.style.background = '#F7FAFF'; /* UPGRADE: subtle tint on rows with unread messages */
            var isFav = favList.indexOf(uid) !== -1;
            var isReq = unreadCnt > 0 && !followedSet[uid];
            if (isFav) el.dataset.fav = '1';
            var _hidAt = _getHidden()[uid];
            if (_hidAt && unreadCnt === 0 && !(lastMsg && new Date(lastMsg.ts).getTime() > _hidAt)) el.dataset.chatHidden = '1';
            if (isPin) el.dataset.pinned = '1';
            if (isReq) { el.dataset.request = '1'; requestCount++; }
            el.innerHTML =
                '<div style="position:relative;flex-shrink:0;">'
                + '<img src="' + _esc(avatar) + '" data-fb="' + _esc(fallbackAv) + '" class="contact-avatar-img" data-full-avatar="' + _esc(avatar) + '"'
                + ' style="width:52px;height:52px;border-radius:50%;object-fit:cover;'
                + 'border:2px solid rgba(27,43,139,0.12);"'
                + ' onerror="this.onerror=null;this.src=this.dataset.fb;">'
                + '<div class="online-dot" style="position:absolute;bottom:2px;right:2px;width:10px;'
                + 'height:10px;border-radius:50%;background:#9CA3AF;border:2px solid white;"></div>'
                + '</div>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="display:flex;align-items:center;margin-bottom:2px;">'
                + '<strong style="font-size:0.98rem;color:var(--primary);white-space:nowrap;'
                + 'overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 40px);font-weight:' + (unreadCnt > 0 ? '800' : '600') + ';">' + _esc(u.fullName || '') + '</strong>'
                + (u.hasBlueBadge ? '<svg width="15" height="15" viewBox="0 0 24 24" style="flex-shrink:0;margin-left:5px;" aria-label="Verified"><circle cx="12" cy="12" r="11" fill="#1B2B8B"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '')
                + (isFav ? '<i class="fas fa-star" style="flex-shrink:0;margin-left:5px;color:#C9A66B;font-size:0.7rem;" aria-label="Favourite"></i>' : '')
                + '</div>'
                + '<div class="contact-preview-line" style="display:flex;align-items:center;gap:5px;min-width:0;color:'
                + (unreadCnt > 0 ? '#0A0E27' : 'var(--text-muted)') + ';">'
                + _tickHTML(lastMsg, us.id)
                + (pk ? '<span class="contact-last-icon" style="display:inline-flex;flex-shrink:0;color:' + (unreadCnt > 0 ? '#2E93E0' : 'var(--text-muted)') + ';">' + pk.icon + '</span>' : '')
                + '<p class="contact-last-msg" style="font-size:0.84rem;color:inherit;'
                + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;min-width:0;'
                + 'font-weight:' + (unreadCnt > 0 ? '600' : '400') + ';">'
                + _esc(lastText) + '</p>'
                + '</div>'
                + '</div>'
                + '<div class="contact-meta" style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;margin-left:6px;min-width:44px;">'
                + '<span class="contact-last-time" style="font-size:0.7rem;color:' + (unreadCnt > 0 ? '#2E93E0' : 'var(--text-muted)') + ';'
                + 'font-weight:' + (unreadCnt > 0 ? '700' : '400') + ';' + (timeStr ? '' : 'display:none;') + '">' + _esc(timeStr) + '</span>'
                + '<div class="contact-flags">'
                + (isPin ? _SVG_PIN : '')
                + (isMute ? _SVG_MUTE : '')
                + (unreadCnt > 0
                    ? '<span class="contact-unread-badge" style="background:' + (isMute ? '#9CA3AF' : '#2E93E0') + ';color:#fff;font-size:0.68rem;font-weight:700;'
                    + 'min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;'
                    + 'padding:0 6px;box-sizing:border-box;">' + (unreadCnt > 99 ? '99+' : unreadCnt) + '</span>'
                    : '')
                + '</div>'
                + '</div>';

            container.appendChild(el);
            window._empApplyRowOrder(el);
            _empRowStatusLine(el, uid);
            /* FIX ("Tap to start a conversation" showing for threads that
               DO have messages): this row's preview above came exclusively
               from localStorage['empyrean_msgs'], which this device only
               ever populates by (a) sending a message yourself, or (b) having
               personally opened that exact chat thread before (openChat's
               Firestore listener is what writes incoming messages into
               localStorage — see §6 below). A thread where the OTHER person
               messaged first, and you've never opened that specific chat on
               this device/session, has nothing in localStorage at all, so it
               falls back to the placeholder forever even though real
               messages exist in Firestore. Fetch the true last message for
               every row directly from Firestore and patch the row once it
               resolves — same fetch-then-patch pattern used for viewer
               profile resolution elsewhere in this app. */
            _syncLastMessagePreview(uid, el, us, lastMsg);
        });

        if (count === 0) {
            /* Same fix as above: append our own scoped empty-state div
               (tagged so the removal loop above can find and clear it on
               the next render) instead of overwriting the whole shared
               container with `container.innerHTML = ...`. */
            var emptyEl = document.createElement('div');
            emptyEl.id = '_chat-empty-state';
            emptyEl.style.cssText = 'text-align:center;padding:48px 20px;color:var(--text-muted);';
            emptyEl.innerHTML =
                '<i class="fas fa-comments" style="font-size:2.4rem;display:block;margin-bottom:14px;color:#5BC0F8;"></i>'
                + '<p style="font-size:0.95rem;line-height:1.5;margin:0 0 16px;">No conversations yet.</p>'
                + '<button type="button" id="chat-empty-new" style="border:0;border-radius:22px;padding:11px 22px;background:#5BC0F8;color:#0A2A5E;font-weight:700;font-size:0.9rem;cursor:pointer;"><i class="fas fa-plus" style="margin-right:8px;"></i>Start a chat</button>';
            container.appendChild(emptyEl);
        }

        _updateMessagesNavBadge(totalUnread);
        _ensureRequestsRow(container, requestCount);
        _ensureComposeFab();
        _applyChatChipFilter();

        /* Live search filter */
        var searchInput = document.getElementById('contacts-search');
        if (searchInput) {
            if (searchInput._chatFilter) searchInput.removeEventListener('input', searchInput._chatFilter);
            searchInput._chatFilter = function () {
                /* FIX (Chat List Specification): this used to unconditionally
                   set `.contact-item` visibility on every 'input' event,
                   with no awareness of app-patch-v20.js's Chats/Groups/
                   Broadcasts tabs. Since an empty query makes `!q` true,
                   even a stray/empty input event would force EVERY 1:1
                   contact row back to display:'' — silently undoing
                   v20's display:none for the Groups/Broadcasts tabs and
                   making plain contacts bleed into those columns. This
                   filter only makes sense for the Chats tab (Groups and
                   Broadcasts have their own separate row sets), so it now
                   no-ops unless Chats is the active tab. Reads the same
                   localStorage key app-patch-v20.js uses, and defaults to
                   'chats' if v20 hasn't loaded — matching v20's own
                   default and the original single-list behavior. */
                var activeTab = 'chats';
                try { activeTab = localStorage.getItem('emp_msgs_active_tab') || 'chats'; } catch (e) {}
                if (activeTab !== 'chats') { _removePeopleBlock(); return; }

                var q = searchInput.value.toLowerCase().trim();
                container.querySelectorAll('.contact-item').forEach(function (item) {
                    var name = ((item.querySelector('strong') || {}).textContent || '').toLowerCase();
                    item.style.display = (!q || name.includes(q)) ? '' : 'none';
                });
                /* SEARCH EVERYONE (2026-10-30): chat is open, so a query also lists people
                   who are not in the chat list yet (see _showPeopleResults). */
                _showPeopleResults(q, container);
            };
            searchInput.addEventListener('input', searchInput._chatFilter);
            var searchBtn = searchInput.parentElement
                && searchInput.parentElement.querySelector('button');
            if (searchBtn) {
                searchBtn.onclick = function (e) {
                    e.preventDefault();
                    searchInput._chatFilter();
                    searchInput.focus();
                };
            }
        }
    }
    window.renderContactList = renderContactList;

    /* ── SEARCH EVERYONE (2026-10-30) ──
       The list-header search used to filter only the chats already listed. It now also
       shows a "People on Empyrean" block under the matching chats: every user who is not
       already a visible chat row. Sources: users already in memory (mockUsers /
       registeredUsers), one first page of the users collection, and — as you type —
       server prefix searches by username / name so people beyond that page are found.
       Tapping a person opens the chat. The block is its own element (no .contact-item
       class), so unread counts, tabs, chips and app-patch-v20.js never treat it as a
       chat row; rendering is skipped when nothing changed, so v20's mutation observer
       re-calling the filter cannot loop. Message text is not searched (it is encrypted). */
    var _ppl = { cache: {}, queried: {}, pageLoaded: false, t: null, sig: '' };

    function _removePeopleBlock() {
        var b = document.getElementById('emp-people-results');
        if (b) b.remove();
        _ppl.sig = '';
    }

    function _mergePeopleSnap(snap) {
        var mu = _mu();
        snap.forEach(function (doc) {
            var d = doc.data() || {}; d.id = d.id || doc.id;
            _ppl.cache[doc.id] = d;
            if (!mu[doc.id]) { try { mu[doc.id] = d; } catch (e) {} }
        });
    }

    function _localPeople(q, listed) {
        var me = _us(), map = {};
        function add(u) { if (u && u.id && u.id !== me.id && !listed[u.id] && !_isAnonUser(u) && window._empCanChat(u.id)) map[u.id] = u; }
        Object.values(_mu()).forEach(add);
        var ru = window.registeredUsers || {};
        (Array.isArray(ru) ? ru : Object.values(ru)).forEach(add);
        Object.keys(_ppl.cache).forEach(function (k) { add(_ppl.cache[k]); });
        return Object.values(map).filter(function (u) {
            return String(u.fullName || '').toLowerCase().indexOf(q) !== -1 || String(u.username || '').toLowerCase().indexOf(q) !== -1;
        }).sort(function (a, b) {
            return String(a.fullName || a.username || '').toLowerCase().localeCompare(String(b.fullName || b.username || '').toLowerCase());
        }).slice(0, 25);
    }

    function _showPeopleResults(rawQ, container) {
        var q = String(rawQ || '').replace(/^@/, '').trim();
        if (!q || _chatChip !== 'all' || _isGuest()) { _removePeopleBlock(); return; }

        /* chats already on screen are not repeated (a deleted/hidden chat row does not count) */
        var listed = {};
        container.querySelectorAll('.contact-item[data-user-id]').forEach(function (r) {
            if (r.dataset.chatHidden !== '1') listed[r.dataset.userId] = 1;
        });
        var users = _localPeople(q, listed);
        var sig = q + '|' + users.map(function (u) { return u.id; }).join(',');
        var block = document.getElementById('emp-people-results');
        if (!(block && block.parentNode === container && sig === _ppl.sig)) {
            _ppl.sig = sig;
            if (!users.length) { if (block) block.remove(); }
            else {
                if (!block) {
                    block = document.createElement('div');
                    block.id = 'emp-people-results';
                    block.addEventListener('click', function (e) {
                        var row = e.target.closest ? e.target.closest('.emp-people-row') : null;
                        if (row && row.dataset.uid && typeof window.openChat === 'function') window.openChat(row.dataset.uid);
                    });
                }
                block.innerHTML = '<div style="padding:14px 16px 6px;font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5B6270;">People on Empyrean</div>'
                    + users.map(function (u) {
                        var fb = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || u.username || 'U') + '&background=1B2B8B&color=fff&size=96';
                        var av = u.avatar || u.profilePhoto || fb;
                        return '<div class="emp-people-row" data-uid="' + _esc(u.id) + '" style="display:flex;align-items:center;gap:12px;padding:10px 16px;min-height:60px;box-sizing:border-box;border-bottom:1px solid rgba(10,14,39,0.05);cursor:pointer;">'
                            + '<img src="' + _esc(av) + '" data-fb="' + _esc(fb) + '" onerror="this.onerror=null;this.src=this.dataset.fb;" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                            + '<div style="min-width:0;"><div style="font-size:0.95rem;font-weight:600;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(u.fullName || u.username || 'User') + '</div>'
                            + (u.username ? '<div style="font-size:0.78rem;color:#5B6270;">@' + _esc(u.username) + '</div>' : '') + '</div></div>';
                    }).join('');
                if (block.parentNode !== container) container.appendChild(block);
            }
        }

        /* fetch more people from the server (once per distinct query), then redraw */
        var uc = window.fbDb && window._firebaseLoaded;
        if (!uc) return;
        if (!_ppl.pageLoaded) {
            _ppl.pageLoaded = true;
            window.fbDb.collection('users').limit(500).get()
                .then(function (snap) { _mergePeopleSnap(snap); _redrawPeople(); }).catch(function () {});
        }
        if (q.length >= 2 && !_ppl.queried[q.toLowerCase()]) {
            clearTimeout(_ppl.t);
            _ppl.t = setTimeout(function () {
                _ppl.queried[q.toLowerCase()] = true;
                var users = window.fbDb.collection('users');
                var cap = q.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
                var variants = [['username', q.toLowerCase()], ['fullNameLower', q.toLowerCase()], ['fullName', q], ['fullName', cap], ['fullName', q.toLowerCase()], ['fullName', q.toUpperCase()]], seen = {};
                Promise.all(variants.filter(function (v) { var k = v[0] + v[1]; if (seen[k]) return false; seen[k] = 1; return true; }).map(function (v) {
                    return users.where(v[0], '>=', v[1]).where(v[0], '<=', v[1] + '\uf8ff').limit(30).get().catch(function () { return null; });
                })).then(function (snaps) {
                    snaps.forEach(function (sn) { if (sn) _mergePeopleSnap(sn); });
                    _redrawPeople();
                });
            }, 300);
        }
    }


    /* ── NAME SEARCH INDEX (2026-10-30) ──
       Firestore prefix queries are case-sensitive and user docs only stored fullName as
       typed. Each person's client now keeps users/{uid}.fullNameLower (lower-cased name)
       in step with fullName, so people search matches any capitalisation ("mcd" finds
       "McDonald"). Self-healing, so it needs no edits at the many places fullName is
       written: it runs after login, shortly after load, and after the profile form is
       saved. Existing users who never come back are covered by the admin route
       POST /api/admin/backfill-name-index in server.js. The older name-variant queries
       stay as a fallback for docs that do not have the field yet. */
    var _nameIdxDone = '';
    function _healNameIndex() {
        if (_isGuest() || !window.fbDb || !window._firebaseLoaded) return;
        var uid = _myDocId(), nm = String(_us().fullName || '').trim();
        if (!uid || !nm) return;
        var low = nm.toLowerCase(), key = uid + '|' + low;
        if (_nameIdxDone === key) return;
        window.fbDb.collection('users').doc(uid).set({ fullNameLower: low }, { merge: true })
            .then(function () { _nameIdxDone = key; }).catch(function () {});
    }
    document.addEventListener('empyrean-user-ready', function () { setTimeout(_healNameIndex, 2000); });
    window.addEventListener('load', function () { setTimeout(_healNameIndex, 4000); });
    document.addEventListener('submit', function (e) {
        if (e.target && e.target.id === 'profile-info-form') setTimeout(_healNameIndex, 2500);
    }, true);

    /* redraw using the search box's CURRENT text (the query may have changed while a fetch was in flight) */
    function _redrawPeople() {
        var si = document.getElementById('contacts-search'), c = document.getElementById('contacts-inner');
        if (!si || !c) return;
        var tab = 'chats'; try { tab = localStorage.getItem('emp_msgs_active_tab') || 'chats'; } catch (e) {}
        if (tab !== 'chats') return;
        _showPeopleResults(si.value.toLowerCase().trim(), c);
    }

    /* Per-row fetch of the real last message for a contact, so the list
       never permanently shows "Tap to start a conversation" for a thread
       that actually has messages the other person sent first. */
    function _syncLastMessagePreview(uid, rowEl, us, localLastMsg) {
        if (!window.fbDb || !window._firebaseLoaded || !us.id) return;
        var tid = [us.id, uid].sort().join('_');
        window.fbDb.collection('messages').doc(tid).collection('msgs')
            .orderBy('ts', 'desc').limit(1).get().then(function (snap) {
                if (!snap || snap.empty) return;
                var msg = snap.docs[0].data();
                if (!msg) return;

                /* Tick for my own last message reflects the REAL read flag
                   (written by the recipient opening the chat), even when
                   the local copy is already as new as this one. */
                if (msg.from === us.id) {
                    var tk = rowEl.querySelector('.contact-last-tick');
                    var isRead = msg.read === true;
                    if (tk) {
                        tk.style.color = isRead ? '#1B6FD1' : '#8A92A8';
                        tk.innerHTML = isRead ? _CHAT_SVG.tick2 : _CHAT_SVG.tick1;
                    }
                }

                /* Skip if what's already on screen (from localStorage) is
                   the same message or newer — avoids a flash/downgrade. */
                if (localLastMsg) {
                    var localTs = new Date(localLastMsg.ts).getTime();
                    var remoteTs = new Date(msg.ts).getTime();
                    if (isFinite(localTs) && isFinite(remoteTs) && localTs >= remoteTs) return;
                }

                var pkr = _previewKind(msg);
                var preview = pkr ? pkr.label : (msg.text || '');
                if (preview.length > 38) preview = preview.slice(0, 38) + '…';

                var textEl = rowEl.querySelector('.contact-last-msg');
                var timeEl = rowEl.querySelector('.contact-last-time');
                if (textEl) textEl.textContent = preview;
                if (pkr && textEl && !rowEl.querySelector('.contact-last-icon')) {
                    var ic = document.createElement('span');
                    ic.className = 'contact-last-icon';
                    ic.style.cssText = 'display:inline-flex;flex-shrink:0;';
                    ic.innerHTML = pkr.icon;
                    textEl.parentNode.insertBefore(ic, textEl);
                }
                if (timeEl) {
                    timeEl.style.display = '';
                    timeEl.textContent = _chatListTime(msg.ts);
                }
                rowEl.dataset.lastTs = String(new Date(msg.ts).getTime() || 0);
                if (window._empApplyRowOrder) window._empApplyRowOrder(rowEl);

                _empRowStatusLine(rowEl, uid);

                /* Cache into localStorage so the next render (and openChat's
                   thread view) paints correctly without waiting on this
                   fetch again. */
                try {
                    var ms = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}');
                    var thr = ms[uid] || [];
                    var exists = thr.some(function (m) {
                        return m.text === msg.text && m.from === msg.from
                            && Math.abs(new Date(m.ts).getTime() - new Date(msg.ts).getTime()) < 5000;
                    });
                    if (!exists) {
                        thr.push({
                            from: msg.from, text: msg.text || '', ts: msg.ts,
                            read: msg.from === us.id, fileUrl: msg.fileUrl || '', fileType: msg.fileType || ''
                        });
                        thr.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
                        ms[uid] = thr;
                        localStorage.setItem('empyrean_msgs', JSON.stringify(ms));
                    }
                } catch (e) {}
            }).catch(function () {});
    }


    /* =========================================================================
       §3  openChat
       Opens the conversation view for a user. Loads localStorage history,
       starts a Firestore real-time listener for the thread.
       ========================================================================= */

    function openChat(userId) {
        if (_isGuest()) {
            /* UPGRADE: guests must sign up before they can message anyone. */
            if (typeof window._empRedirectGuestToSignup === 'function') window._empRedirectGuestToSignup('send messages');
            else if (typeof window.openAuthModal === 'function') window.openAuthModal('signup');
            return;
        }

        var mu   = _mu();
        var us   = _us();
        var user = mu[userId];
        if (!user) { console.warn('[Chat] User not found:', userId); return; }

        /* ── Highlight active contact ── */
        document.querySelectorAll('.contact-item').forEach(function (c) {
            c.classList.remove('active');
            c.style.background = '';
        });
        var activeItem = document.querySelector('.contact-item[data-user-id="' + userId + '"]');
        if (activeItem) {
            activeItem.classList.add('active');
            activeItem.style.background = 'rgba(27,43,139,0.05)';
        }

        /* ── Show chat panel, hide placeholder ── */
        var chatView    = document.getElementById('chat-view-container');
        var placeholder = document.getElementById('chat-placeholder');
        var contactList = document.querySelector('.contact-list');
        if (chatView) {
            chatView.style.display = 'flex';
            chatView.classList.add('active');
            if (window.innerWidth <= 700) {
                chatView.classList.add('mobile-active');
                if (contactList) contactList.style.display = 'none';
            }
        }
        if (placeholder) placeholder.style.display = 'none';

        /* ── Chat header ── */
        var chatHeader = document.getElementById('chat-header-info');
        if (chatHeader) {
            _ensureChatPremiumStyle();
            chatHeader.classList.add('chat-header-premium');
            var userAv  = (user.avatar || '').replace(/'/g, '%27');
            var userFb  = 'https://ui-avatars.com/api/?name='
                + encodeURIComponent(user.fullName || 'U') + '&background=1B2B8B&color=fff';
            var backBtn = window.innerWidth <= 700
                ? '<button id="chat-back-btn" style="background:none;border:none;font-size:1.1rem;'
                + 'cursor:pointer;padding:4px 8px 4px 0;">'
                + '<i class="fas fa-arrow-left"></i></button>'
                : '';

            chatHeader.innerHTML =
                '<div style="display:flex;align-items:center;gap:11px;flex:1;">'
                + backBtn
                + '<div class="chp-avatar">'
                + '<img src="' + _esc(userAv) + '" alt="' + _esc(user.fullName || '') + '" '
                + 'onerror="this.onerror=null;this.src=\'' + userFb + '\'"></div>'
                + '<div><strong class="chp-name">' + _esc(user.fullName || '') + '</strong>'
                + '<span class="chp-sub">@' + _esc(user.username || '') + '</span>'
                + '</div></div>';

            /* Mobile back button handler */
            var backBtnEl = document.getElementById('chat-back-btn');
            if (backBtnEl) {
                backBtnEl.onclick = function () {
                    if (chatView) { chatView.style.display = 'none'; chatView.classList.remove('active', 'mobile-active'); }
                    if (contactList) contactList.style.display = '';
                    if (placeholder) placeholder.style.display = '';
                    document.querySelectorAll('.contact-item').forEach(function (c) {
                        c.classList.remove('active'); c.style.background = '';
                    });
                    /* Detach Firestore listener */
                    if (_activeMsgListener) {
                        try { _activeMsgListener(); } catch (e) {}
                        _activeMsgListener = null;
                    }
                };
            }
        }

        /* ── Render existing thread from localStorage ── */
        var msgsContainer = document.getElementById('chat-messages-container');
        if (!msgsContainer) return;
        msgsContainer.dataset.activeChat = userId;
        msgsContainer.classList.add('chat-bg-premium');
        msgsContainer.style.cssText =
            'display:flex;flex-direction:column;gap:8px;padding:16px;overflow-y:auto;flex:1;';
        msgsContainer.innerHTML = '';

        var msgStore = {};
        try { msgStore = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}'); } catch (e) {}
        var thread = msgStore[userId] || [];

        if (thread.length === 0) {
            msgsContainer.innerHTML =
                '<div id="chat-empty-hint" style="text-align:center;padding:48px 20px;color:var(--text-muted);">'
                + '<i class="fas fa-comments" style="font-size:2.2rem;display:block;margin-bottom:14px;opacity:0.3;"></i>'
                + '<p style="font-size:0.88rem;">No messages yet. Say hello! 👋</p></div>';
        } else {
            thread.forEach(function (msg) {
                var isSent = msg.from === us.id;
                if (msg.fileUrl) {
                    msgsContainer.appendChild(
                        createMessageElement(msg.text || '', isSent, true, msg.fileUrl, msg.fileType || '', msg.id)
                    );
                } else {
                    /* FIX ("make https/www/YouTube/WhatsApp links clickable
                       in the feed"): this used to build its own plain
                       `bubble.textContent = msg.text` bubble here instead of
                       going through createMessageElement() — the ONE place
                       that already calls window.formatWhatsAppText() to turn
                       a raw https://, www., youtube.com/youtu.be, or
                       wa.me/whatsapp.com URL into a real, tappable <a
                       href="..." target="_blank"> (which is what lets the OS
                       hand a wa.me link straight to the WhatsApp app, a
                       youtube.com link to the YouTube app, etc. — the browser
                       decides that from the href itself; this code only
                       needs to make sure the href actually exists as a real
                       link instead of being flattened into inert text).
                       Reusing createMessageElement(..., false) instead of
                       re-implementing a second, plainer bubble here means
                       every chat message renders identically regardless of
                       which of the two load paths (history vs. live) put it
                       on screen. */
                    msgsContainer.appendChild(createMessageElement(msg.text || '', isSent, false));
                }
                /* Mark as read */
                if (!isSent) msg.read = true;
            });
            /* Persist read status */
            if (thread.some(function (m) { return !m.read && m.from !== us.id; })) {
                try {
                    var ms2 = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}');
                    if (ms2[userId]) ms2[userId].forEach(function (m) { if (m.from !== us.id) m.read = true; });
                    localStorage.setItem('empyrean_msgs', JSON.stringify(ms2));
                } catch (e) {}
            }
        }
        msgsContainer.scrollTop = msgsContainer.scrollHeight;

        /* ── Start Firestore real-time listener for this thread ── */
        _attachFirestoreListener(userId, msgsContainer);
    }
    window.openChat = openChat;


    /* =========================================================================
       §4  MESSAGE SEND HANDLER
       Wired on first openChat call via form submit event on #message-form.
       Writes to localStorage immediately, then fires Firestore in background.
       ========================================================================= */

    var _formWired = false;

    function _wireMessageForm() {
        if (_formWired) return;
        var form  = document.getElementById('message-form');
        var input = document.getElementById('message-text-input');
        if (!form) return;
        _formWired = true;

        form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            var text  = input ? input.value.trim() : '';
            var msgsC = document.getElementById('chat-messages-container');
            if (!text || !msgsC) return;
            var auid  = msgsC.dataset.activeChat;
            if (!auid) return;
            var us    = _us();

            /* Clear empty-state hint */
            var hint = document.getElementById('chat-empty-hint');
            if (hint) hint.remove();

            /* Render sent bubble immediately */
            var bubble = document.createElement('div');
            bubble.style.cssText =
                'max-width:72%;padding:10px 14px;border-radius:18px 18px 4px 18px;'
                + 'background:var(--secondary,#1B2B8B);color:white;font-size:0.88rem;'
                + 'line-height:1.45;align-self:flex-end;box-shadow:0 1px 4px rgba(10,14,39,0.08);'
                + 'word-break:break-word;margin-bottom:4px;';
            bubble.textContent = text;
            msgsC.appendChild(bubble);
            msgsC.scrollTop = msgsC.scrollHeight;
            if (input) input.value = '';

            /* Persist to localStorage */
            try {
                var ms = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}');
                if (!ms[auid]) ms[auid] = [];
                ms[auid].push({ from: us.id, text: text, ts: Date.now(), read: true });
                localStorage.setItem('empyrean_msgs', JSON.stringify(ms));
            } catch (e) {}

            /* Persist to Firestore (background) */
            try {
                if (window.fbDb && window._firebaseLoaded && us.id) {
                    var tid = [us.id, auid].sort().join('_');
                    window.fbDb.collection('messages').doc(tid).collection('msgs').add({
                        from:     us.id,
                        to:       auid,
                        text:     text,
                        ts:       new Date().toISOString(),
                        fileUrl:  '',
                        fileType: '',
                        read:     false
                    }).catch(function () {});
                }
            } catch (e) {}

            /* Refresh contact list to update last message */
            setTimeout(renderContactList, 300);
        });
    }


    /* =========================================================================
       §5  MEDIA ATTACHMENT
       Handles file selection and Cloudinary upload for in-chat media.
       ========================================================================= */

    document.addEventListener('change', function (e) {
        var fileInput = e.target;
        if (!fileInput || fileInput.id !== 'chat-media-input') return;
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;

        var msgsC = document.getElementById('chat-messages-container');
        var us    = _us();
        var auid  = msgsC && msgsC.dataset.activeChat;
        if (!msgsC || !auid) return;

        /* Show uploading indicator */
        var hint = document.createElement('div');
        hint.style.cssText = 'align-self:flex-end;font-size:0.8rem;color:var(--text-muted);padding:6px 10px;';
        hint.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Uploading…';
        msgsC.appendChild(hint);
        msgsC.scrollTop = msgsC.scrollHeight;

        /* Upload to Cloudinary */
        var doUpload = typeof window.uploadToCloudinary === 'function'
            ? window.uploadToCloudinary(file, null)
            : Promise.reject(new Error('uploadToCloudinary not available'));

        doUpload.then(function (url) {
            hint.remove();
            if (!url) return;
            /* Render media bubble */
            var msgEl = createMessageElement(file.name, true, true, url, file.type, 'msg-' + Date.now());
            msgsC.appendChild(msgEl);
            msgsC.scrollTop = msgsC.scrollHeight;

            /* Persist */
            try {
                var ms = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}');
                if (!ms[auid]) ms[auid] = [];
                ms[auid].push({ from: us.id, text: file.name, ts: Date.now(), read: true, fileUrl: url, fileType: file.type });
                localStorage.setItem('empyrean_msgs', JSON.stringify(ms));
            } catch (e) {}

            try {
                if (window.fbDb && window._firebaseLoaded && us.id) {
                    var tid = [us.id, auid].sort().join('_');
                    window.fbDb.collection('messages').doc(tid).collection('msgs').add({
                        from: us.id, to: auid, text: file.name,
                        fileUrl: url, fileType: file.type,
                        ts: new Date().toISOString(), read: false
                    }).catch(function () {});
                }
            } catch (e) {}
        }).catch(function () {
            hint.textContent = 'Upload failed.';
            setTimeout(function () { hint.remove(); }, 2000);
        });

        fileInput.value = '';
    });


    /* =========================================================================
       §6  FIRESTORE REAL-TIME INCOMING MESSAGE LISTENER
       ========================================================================= */

    function _attachFirestoreListener(recipientId, msgsContainer) {
        /* Detach any existing listener */
        if (_activeMsgListener) {
            try { _activeMsgListener(); } catch (e) {}
            _activeMsgListener = null;
        }
        if (!window.fbDb || !window._firebaseLoaded) return;

        var us  = _us();
        var uid = us.id;
        if (!uid) return;

        var tid = [uid, recipientId].sort().join('_');

        _activeMsgListener = window.fbDb
            .collection('messages').doc(tid).collection('msgs')
            .orderBy('ts', 'asc').limit(100)
            .onSnapshot(function (snap) {
                if (!snap) return;
                snap.docChanges().forEach(function (change) {
                    if (change.type !== 'added') return;
                    var msg = change.doc.data();
                    if (!msg || msg.from === uid) return; /* skip own messages already rendered */

                    /* Check if already in localStorage */
                    var ms = {};
                    try { ms = JSON.parse(localStorage.getItem('empyrean_msgs') || '{}'); } catch (e) {}
                    var thr = ms[recipientId] || [];
                    if (thr.some(function (m) { return m.text === msg.text && m.from === msg.from
                        && Math.abs(new Date(m.ts).getTime() - new Date(msg.ts).getTime()) < 5000; })) return;

                    /* Persist to localStorage */
                    thr.push({ from: msg.from, text: msg.text || '', ts: msg.ts, read: false,
                        fileUrl: msg.fileUrl || '', fileType: msg.fileType || '' });
                    ms[recipientId] = thr;
                    try { localStorage.setItem('empyrean_msgs', JSON.stringify(ms)); } catch (e) {}

                    /* Only add bubble if this chat is still the active one */
                    if (msgsContainer.dataset.activeChat !== recipientId) {
                        if (typeof window.pushNotification === 'function' && _getMutes().indexOf(recipientId) === -1) {
                            var mu  = _mu();
                            var sender = (mu[msg.from] || {}).fullName || 'Message';
                            window.pushNotification('💬 ' + sender + ': ' + (msg.text || '').slice(0, 40), 'info');
                        }
                        renderContactList();
                        return;
                    }

                    /* Render received bubble */
                    var hint2 = document.getElementById('chat-empty-hint');
                    if (hint2) hint2.remove();

                    if (msg.fileUrl) {
                        msgsContainer.appendChild(
                            createMessageElement(msg.text || '', false, true, msg.fileUrl, msg.fileType || '')
                        );
                    } else {
                        // Same fix as the history-load path above — see that
                        // comment for why this now goes through
                        // createMessageElement() instead of a plain-text bubble.
                        msgsContainer.appendChild(createMessageElement(msg.text || '', false, false));
                    }
                    msgsContainer.scrollTop = msgsContainer.scrollHeight;
                    renderContactList();
                });
            }, function (err) {
                console.warn('[Chat] Firestore listener error:', err && err.message);
                _activeMsgListener = null;
            });
    }


    /* =========================================================================
       FEATURE — inbox avatar tap -> bottom-sheet bio preview
       Shows the tapped person's picture + a short bio/info snippet,
       sliding up from the bottom (not full-screen, not a chat
       navigation). "View full profile" underneath deep-links to the
       exact same "Contact info" screen the ⋮ menu's own "View contact"
       already opens (app-patch-openchat.js's _openProfileModal, exposed
       as window._ocOpenFullProfile) — one implementation of that full
       screen, not a second copy.
       ========================================================================= */
    function _openAvatarPreviewSheet(uid, avatarUrl, opts) {
        opts = opts || {};
        var full = !!opts.full; /* chat-bubble avatar taps: full-screen picture + bio */
        var existing = document.getElementById('emp-avatar-preview-sheet');
        if (existing) existing.remove();
        var existingBackdrop = document.getElementById('emp-avatar-preview-backdrop');
        if (existingBackdrop) existingBackdrop.remove();

        var u = uid ? (_mu()[uid] || {}) : {};
        var name = u.fullName || u.username || opts.name || 'User';

        var backdrop = document.createElement('div');
        backdrop.id = 'emp-avatar-preview-backdrop';
        backdrop.style.cssText =
            'position:fixed;inset:0;z-index:9999990;background:rgba(10,14,39,0.55);' +
            'opacity:0;transition:opacity 0.2s ease;';
        document.body.appendChild(backdrop);

        var sheet = document.createElement('div');
        sheet.id = 'emp-avatar-preview-sheet';
        sheet.style.cssText =
            'position:fixed;left:0;right:0;bottom:0;z-index:9999991;background:#fff;' +
            'border-radius:20px 20px 0 0;box-shadow:0 -8px 30px rgba(10,14,39,0.25);' +
            'padding:10px 20px 26px;max-height:78vh;overflow-y:auto;' +
            'transform:translateY(100%);transition:transform 0.25s cubic-bezier(.2,.9,.3,1);';
        if (full) sheet.style.cssText =
            'position:fixed;inset:0;z-index:9999991;background:#fff;border-radius:0;' +
            'padding:0 0 calc(24px + env(safe-area-inset-bottom,0px));overflow-y:auto;-webkit-overflow-scrolling:touch;' +
            'transform:translateY(100%);transition:transform 0.25s cubic-bezier(.2,.9,.3,1);';
        sheet.innerHTML = (full ? '<div style="position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:14px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;background:#fff;border-bottom:1px solid #EEF1F5;"><button id="eap-back" aria-label="Back" style="width:40px;height:40px;border:0;border-radius:50%;background:#F3F4F6;color:#111827;font-size:1.05rem;cursor:pointer;"><i class="fas fa-arrow-left"></i></button><div style="font-size:1.05rem;font-weight:700;color:#111B21;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(name) + '</div></div>' : '') +
            (full ? '' : '<div style="width:38px;height:4px;border-radius:3px;background:#E5E7EB;margin:0 auto 16px;"></div>') +
            '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;' + (full ? 'padding:20px 20px 0;' : '') + '">' +
              '<img src="' + _esc(avatarUrl || u.avatar || '') + '" style="' + (full ? 'width:min(88vw,420px);height:min(88vw,420px);border-radius:18px;' : 'width:104px;height:104px;border-radius:50%;') + 'object-fit:cover;box-shadow:0 6px 18px rgba(10,14,39,0.18);background:#EEF1F5;">' +
              '<div id="eap-name" style="font-size:' + (full ? '1.3rem' : '1.08rem') + ';font-weight:800;color:#111827;margin-top:14px;">' + _esc(name) + '</div>' +
              '<div id="eap-username" style="font-size:0.84rem;color:#9CA3AF;margin-top:2px;">' + (u.username ? '@' + _esc(u.username) : '') + '</div>' +
              '<div id="eap-bio" style="font-size:' + (full ? '1rem' : '0.88rem') + ';color:#4B5563;margin-top:14px;line-height:1.5;max-width:' + (full ? '440px' : '340px') + ';"></div>' +
              '<div id="eap-extra" style="width:100%;margin-top:10px;text-align:left;"></div>' +
            '</div>' +
            '<div style="display:flex;gap:10px;margin-top:22px;' + (full ? 'padding:0 20px;' : '') + '">' +
              (uid ? '<button id="eap-full-profile" style="flex:1;padding:13px;border:1.5px solid #1B2B8B;border-radius:12px;background:#fff;color:#1B2B8B;font-weight:700;font-size:0.88rem;cursor:pointer;">View full profile</button>' : '') +
              '<button id="eap-close" style="flex:1;padding:13px;border:none;border-radius:12px;background:#F3F4F6;color:#374151;font-weight:700;font-size:0.88rem;cursor:pointer;">Close</button>' +
            '</div>';
        document.body.appendChild(sheet);

        function _close() {
            sheet.style.transform = 'translateY(100%)';
            backdrop.style.opacity = '0';
            setTimeout(function () { sheet.remove(); backdrop.remove(); }, 220);
        }
        backdrop.addEventListener('click', _close);
        sheet.querySelector('#eap-close').addEventListener('click', _close);
        var _bk = sheet.querySelector('#eap-back'); if (_bk) _bk.addEventListener('click', _close);
        var fullBtn = sheet.querySelector('#eap-full-profile');
        if (fullBtn) fullBtn.addEventListener('click', function () {
            _close();
            if (typeof window._ocOpenFullProfile === 'function') {
                window._ocOpenFullProfile(uid, name, avatarUrl || u.avatar || '');
            }
        });

        requestAnimationFrame(function () {
            backdrop.style.opacity = '1';
            sheet.style.transform = 'translateY(0)';
        });

        /* Fill in bio/profession/location once fetched — same fields
           app-patch-openchat.js's own full profile screen reads, kept to
           a short list here since this is a PREVIEW, not the full page. */
        if (uid && window.fbDb && window._firebaseLoaded) {
            window.fbDb.collection('users').doc(uid).get().then(function (doc) {
                if (!doc.exists || !document.getElementById('eap-bio')) return;
                var d = doc.data() || {};
                var bioEl = document.getElementById('eap-bio');
                if (bioEl) bioEl.textContent = d.bio || '';
                var unEl = document.getElementById('eap-username');
                if (unEl && d.username) unEl.textContent = '@' + d.username;
                var extraEl = document.getElementById('eap-extra');
                if (extraEl) {
                    var rows = '';
                    if (d.profession) rows += '<div style="font-size:0.82rem;color:#6B7280;padding:6px 0;border-top:1px solid #F3F4F6;"><strong style="color:#374151;">Profession:</strong> ' + _esc(d.profession) + '</div>';
                    if (d.location) rows += '<div style="font-size:0.82rem;color:#6B7280;padding:6px 0;border-top:1px solid #F3F4F6;"><strong style="color:#374151;">Location:</strong> ' + _esc(d.location) + '</div>';
                    extraEl.innerHTML = rows;
                }
            }).catch(function () { /* preview stays with whatever cached info it already had */ });
        }
    }
    /* EXPOSED (2026-08-11): app-reel.js's own avatar tap (grid card +
       fullscreen viewer) now reuses this exact picture+bio bottom sheet
       instead of a second, separately built preview — "open a preview
       modal like it's done in the message section" per that session's
       request — rather than duplicating this sheet a third time. Safe to
       call from anywhere: it always looks the tapped uid up fresh via
       _mu()/Firestore, same as it does for its own inbox-avatar callers
       above, so no shared state needs to exist between the two files. */
    window._openAvatarPreviewSheet = _openAvatarPreviewSheet;

    /* =========================================================================
       §7  EVENT DELEGATION
       ========================================================================= */

    document.addEventListener('click', function (e) {
        /* FEATURE: tap the small avatar in the contact list → full-screen
           picture, same viewer app-patch-openchat.js already uses for the
           open-chat header avatar (exposed as window._ocOpenLightbox so
           there's only ever one implementation). Checked BEFORE the
           .contact-item handler below and stops propagation, so tapping
           the picture never also opens the chat underneath it. */
        var avatarImg = e.target.closest('.contact-avatar-img');
        if (avatarImg) {
            e.preventDefault();
            e.stopPropagation();
            /* FIX (spec: "clicking the inbox avatar shouldn't open the
               chat, and the blurred full-screen expansion should be a
               bottom-sheet bio preview instead, like View contact"):
               this used to always open the full-screen blurred lightbox
               (window._ocOpenLightbox) with no bio/info of any kind.
               Replaced with a bottom sheet showing the picture plus a
               short bio, with a way through to the full "View contact"
               screen for anyone who wants more — the lightbox function
               itself is untouched and still used elsewhere (message
               bubbles, etc.), only THIS tap target was repointed. */
            var contactEl = avatarImg.closest('.contact-item');
            var uid = contactEl && contactEl.dataset.userId;
            _openAvatarPreviewSheet(uid, avatarImg.dataset.fullAvatar || avatarImg.src);
            return;
        }

        /* Contact item click → open chat */
        var contactItem = e.target.closest('.contact-item');
        if (contactItem && contactItem.dataset.userId) {
            e.preventDefault();
            e.stopPropagation();
            /* FIX (exit button landing on broken "Messages" screen +
               composer/mic/emoji missing from chat): app-patch-openchat.js
               loads after this file and installs its own capture-phase
               .contact-item click listener that calls window.openChat(uid)
               — the current, real WhatsApp-style implementation (dynamic
               header/body/composer, proper close handling). This file's
               own click listener used to call its LOCAL openChat(userId)
               directly (the old implementation below, which pre-dates that
               rewrite and never builds a composer at all), so both ran on
               every single tap, racing to rebuild #chat-view-container at
               the same time. Whichever one finished last "won" that tap,
               which is why the bug was intermittent: sometimes the old
               header/no-composer view was left on top, sometimes the exit
               button wired by the old code's close handler ran instead of
               the new one. Deferring to window.openChat here (rather than
               the local function) means both listeners now always agree on
               the one real implementation, whatever it currently is —
               removing the race without deleting or disabling anything. */
            if (typeof window.openChat === 'function') {
                window.openChat(contactItem.dataset.userId);
            } else {
                openChat(contactItem.dataset.userId);
            }
            _wireMessageForm();
            return;
        }

        /* Chat media attach button */
        if (e.target.closest('#chat-attach-btn, .chat-attach-btn')) {
            e.preventDefault();
            var fi = document.getElementById('chat-media-input');
            if (!fi) {
                fi = document.createElement('input');
                fi.type   = 'file';
                fi.id     = 'chat-media-input';
                fi.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx';
                fi.style.display = 'none';
                document.body.appendChild(fi);
            }
            fi.click();
        }
    });

    /* Wire message form on empyrean-init-done (DOM is guaranteed ready) */
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(_wireMessageForm, 400);
    });


    /* =========================================================================
       FIX ("No conversations yet. Follow users to message them." showing
       even though chats exist — on the Chats tab AND on the Marketplace
       tab, where the empty-state sat right above the real Lexus RX350 /
       Toyota Highlander rows). Those per-tab placeholders are painted into
       the shared #contacts-inner container by other modules, and nothing
       ever removed them once a real row was rendered beside them. This
       reconciler is tab-agnostic: it finds any "No conversations yet…"
       placeholder inside #contacts-inner and hides it whenever a visible
       chat row / section exists next to it; if the list later empties it
       is un-hidden again, so the genuine empty state still appears when
       there truly are no chats. It only ever touches placeholders it
       hid itself, never real rows or other modules' sections.
       ========================================================================= */
    var _emptyRe = /^no conversations yet/i;
    var _reconcileTimer = null;
    function _reconcileEmptyStates() {
        var container = document.getElementById('contacts-inner');
        if (!container) return;

        var empties = [];
        container.querySelectorAll('div').forEach(function (d) {
            if (d.querySelector('.contact-item')) return;
            var t = (d.textContent || '').replace(/\s+/g, ' ').trim();
            if (!_emptyRe.test(t) || t.length > 160) return;
            var childMatch = false;
            d.querySelectorAll('div').forEach(function (c) {
                if (_emptyRe.test((c.textContent || '').replace(/\s+/g, ' ').trim())) childMatch = true;
            });
            if (!childMatch) empties.push(d);
        });
        if (!empties.length) return;

        function isEmptyNode(n) { return empties.some(function (e) { return e === n || e.contains(n) || n.contains(e); }); }
        function hasRealContent() {
            for (var i = 0; i < empties.length; i++) {
                var node = empties[i];
                while (node && node !== container.parentNode) {
                    var par = node.parentNode;
                    if (!par) break;
                    for (var k = 0; k < par.children.length; k++) {
                        var sib = par.children[k];
                        if (sib === node || isEmptyNode(sib)) continue;
                        if (sib.id === 'chat-requests-row' || sib.id === 'chat-compose-fab') continue;
                        var cs = window.getComputedStyle(sib);
                        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                        if (cs.position === 'fixed' || cs.position === 'absolute') continue;
                        if (sib.offsetHeight < 30) continue;
                        if (sib.classList.contains('emp-chip-hide')) continue;
                        if (sib.classList.contains('contact-item') || sib.querySelector('.contact-item')
                            || (sib.textContent || '').trim().length > 0 || sib.querySelector('img')) return true;
                    }
                    if (node === container) break;
                    node = par;
                }
            }
            return false;
        }

        var real = hasRealContent();
        empties.forEach(function (e) {
            if (real) {
                if (e.dataset.empAutoHid !== '1') { e.dataset.empAutoHid = '1'; e.dataset.empPrevDisplay = e.style.display || ''; e.style.display = 'none'; }
            } else if (e.dataset.empAutoHid === '1') {
                e.style.display = e.dataset.empPrevDisplay || '';
                delete e.dataset.empAutoHid; delete e.dataset.empPrevDisplay;
            }
        });
    }
    function _scheduleReconcile() {
        clearTimeout(_reconcileTimer);
        _reconcileTimer = setTimeout(_reconcileEmptyStates, 80);
    }
    window._empReconcileChatEmptyStates = _reconcileEmptyStates;
    (function _watchChatList() {
        var tries = 0;
        (function attach() {
            var c = document.getElementById('contacts-inner');
            if (!c) { if (tries++ < 40) setTimeout(attach, 500); return; }
            if (c._empEmptyWatch) return;
            c._empEmptyWatch = true;
            try {
                new MutationObserver(_scheduleReconcile).observe(c, {
                    childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class']
                });
            } catch (e) {}
            _scheduleReconcile();
        })();
    })();
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('#chat-filter-chips, #v20-chat-tabs')) {
            setTimeout(_reconcileEmptyStates, 50); setTimeout(_reconcileEmptyStates, 400);
        }
    });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_reconcileEmptyStates, 900); });
    document.addEventListener('empyrean-user-ready', function () { setTimeout(_reconcileEmptyStates, 900); });

    /* =========================================================================
       §8  BOOTSTRAP
       ========================================================================= */

    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () {
            if (!_isGuest()) {
                renderContactList();
                _wireMessageForm();
            }
        }, 500);
    });

    document.addEventListener('empyrean-user-ready', function () {
        setTimeout(function () {
            if (!_isGuest()) renderContactList();
        }, 600);
    });

    console.log('[EmpChat] ✅ Chat module ready. (contact-list-fix build 2026-07-09b: scoped container clear + tab-aware search filter; 2026-08-11: _openAvatarPreviewSheet exposed on window for reuse by app-reel.js)');

})();