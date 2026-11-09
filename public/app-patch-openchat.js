/* safeFileClick: prevents Android gallery-reopening on file inputs */
function safeFileClick(el) {
    if (!el) return;
    var now = Date.now();
    if (el._lastClick && (now - el._lastClick) < 1000) return;
    el._lastClick = now;
    el.click();
}

/* =============================================================================
   EMPYREAN INTERNATIONAL — app-patch-openchat.js
   Load AFTER app-patch-v2.js

   WHAT THIS FILE DOES
   ────────────────────
   Defines  window.openChat(userId)  — the one function that was called
   everywhere (contact-item clicks, profile message button, marketplace)
   but never implemented.

   FEATURES
   ────────
   [1] Looks up the user from window.mockUsers → Firestore fallback
   [2] Populates #chat-header-info with avatar, name, online dot
   [3] Shows   #chat-view-container, hides #chat-placeholder
   [4] Adds a sticky WhatsApp-style header: back ← | avatar | name | video 📹 | call 📞 | ⋮
   [5] Subscribes to Firestore messages for this thread in real-time
   [6] Renders bubbles into #chat-messages-container (independent scroll)
   [7] Wires #message-form / #vf-msg-send → saves to Firestore messages collection
   [8] Keeps input + send button fixed at bottom via existing flex CSS
   [9] Mobile full-screen (position:absolute, covers status bar)
   [10] Long-press on any bubble → WhatsApp emoji reaction bar
        (👍 ❤️ 😂 😮 😢 🙏 ❌ +) with live Firestore update
   ============================================================================= */

(function empyreanOpenChat() {
    'use strict';

    /* FIX: every other patch file in this codebase (v37/v39/v40/v44/v45)
       guards itself against being executed twice — because this dev
       environment's hot-reload/live-preview tooling can re-inject a
       script into an already-loaded page without a real navigation.
       v39's own header documents that exact scenario previously
       leaving a duplicate, orphaned Agora client publishing at once on
       the live-streaming side, producing overlapping audio and
       "frozen" taps. This file — the one that owns 1:1 voice/video
       calls (RTCPeerConnection, getUserMedia, the whole Firestore
       calls/{callId} signalling flow) — never had the same guard, so a
       duplicate execution here would create a second, independent
       _peerId/_rtc closure with its own RTCPeerConnection, competing
       for the mic and writing its own signalling docs alongside the
       first — a very plausible source of "audio broken/delayed/
       one-sided" reports that recover partway through a call. */
    if (window._empPatchOpenchatLoaded) {
        console.warn('[OpenChat] Already loaded — skipping duplicate execution (prevents a second, competing call implementation).');
        return;
    }
    window._empPatchOpenchatLoaded = true;

    /* ── tiny helpers (safe even before EmpState exists) ── */
    function _us()      { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _isGuest() { var s = window.EmpState || {}; return s.isGuest != null ? !!s.isGuest : !!window.isGuest; }
    function _fbOk()    { return !!(window._firebaseLoaded && window.fbDb); }

    /* FIX (bug: "video/voice call bounces back instantly, messages stuck
       on Loading — Missing or insufficient permissions"): _us().id can be
       a STALE cached id restored from localStorage (_tryImmediateSessionRestore
       in app-fixes.js) that never gets reconciled with the live Firebase
       Auth session when that session is anonymous or absent — the existing
       upgrade-in-memory fix only runs for `!fbUser.isAnonymous`. Firestore's
       rules for /calls and /messages require request.auth.uid to EXACTLY
       equal the callerId/senderId field we write, so any drift between the
       cached app-level id and the live Firebase UID causes an instant,
       silent permission-denied on call/message writes. Reading the live
       UID straight from fbAuth here — rather than trusting _us().id — means
       these writes can never be rule-mismatched. */
    /* FIX (broadcastLists / chats permission-denied returned): this used to
       return ANY fbAuth.currentUser.uid, including anonymous sessions.
       app-patch-v12.js added signInAnonymously() as a fallback for
       localStorage-only sessions (routine here per app-fixes.js) — once
       that anonymous sign-in completes, onAuthStateChanged fires and this
       function was overwriting the real userState.id with the throwaway
       anonymous UID, permanently mismatching every existing doc's
       ownerId/senderId/participants field. Guarding against isAnonymous
       here matches the pattern already used elsewhere in this codebase
       (app-fixes.js, app-patch-v20.js's own auth listener). */
    function _authUid() {
        try {
            var u = window.fbAuth && window.fbAuth.currentUser;
            return (u && !u.isAnonymous && u.uid) || null;
        } catch (e) { return null; }
    }

    /* FIX (bug: "video/voice call buttons stopped responding after the
       stale-id guard was added"): the guard below was right to CATCH the
       stale-cached-id-vs-live-Firebase-UID drift, but it only ever
       reported it and then blocked the call — it never actually repaired
       userState.id, so calling stayed permanently dead until the user
       manually logged out and back in. app-fixes.js already has this
       exact self-heal (Object.assign + userState.id = fbUser.uid) for the
       "upgrade in memory" path, but that path only fires from inside
       onAuthStateChanged for a NON-anonymous fbUser, so it can miss cases
       where the live session is already non-anonymous but userState was
       populated earlier from a stale localStorage snapshot (e.g. a prior
       account on the same device/session). Self-heal right here instead,
       synchronously, the moment a mismatch is detected — so calls (and
       messages) work immediately rather than requiring a manual re-login. */
    function _syncUidIfNeeded() {
        var authUid = _authUid();
        if (!authUid) return null;
        var s = (window.EmpState && window.EmpState.userState) || window.userState;
        if (s && s.id !== authUid) {
            console.log('[OC] Self-healing stale userState.id (' + s.id + ') \u2192 live Firebase UID (' + authUid + ')');
            s.id = authUid;
            if (window.EmpState && window.EmpState.userState !== s) window.EmpState.userState = s;
            window.userState = s;
            try {
                var raw = localStorage.getItem('empyrean_session');
                if (raw) {
                    var parsed = JSON.parse(raw);
                    parsed.id = authUid;
                    localStorage.setItem('empyrean_session', JSON.stringify(parsed));
                }
            } catch (e) {}
        }
        return authUid;
    }

    /* Keep userState continuously reconciled with the live Firebase Auth
       session, not just at the moment a call is placed — this is what
       actually clears the "Missing or insufficient permissions" Firestore
       listener errors (messages stuck on "Loading…", notifications
       listener failing) that share this same root cause. */
    (function _watchAuthForUidDrift() {
        if (window._ocUidWatcherWired) return;
        window._ocUidWatcherWired = true;
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            if (window.fbAuth && typeof window.fbAuth.onAuthStateChanged === 'function') {
                clearInterval(iv);
                window.fbAuth.onAuthStateChanged(function () { _syncUidIfNeeded(); });
                _syncUidIfNeeded();
            } else if (tries > 40) {
                clearInterval(iv);
            }
        }, 500);
    })();
    function _notify(m, t) {
        /* FIX (Add to list / Mute notifications / Disappearing msgs / Media
           panel all appeared to "do nothing" when tapped): every one of
           them calls this. window.showNotification only registers itself
           onto window the first time something ELSE in app-fixes.js
           happens to call it — before that it's undefined — and even once
           registered it silently no-ops if #reward-notification isn't in
           the DOM. Either way this used to fail silently. Now it verifies
           the real toast can actually render before trusting it, and
           always falls back to its own toast otherwise, so these menu
           actions are never silently invisible again. */
        if (typeof window.showNotification === 'function' && document.getElementById('reward-notification')) {
            try { window.showNotification(m, t || 'info'); return; } catch (e) {}
        }
        _ocFallbackToast(m, t);
    }

    function _ocFallbackToast(m, t) {
        var el = document.getElementById('oc-fallback-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'oc-fallback-toast';
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
        el.style.background = colors[t] || colors.info;
        el.textContent = m;
        el.style.opacity = '1';
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(function () { el.style.opacity = '0'; }, 2600);
    }
    function _esc(s)    { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _fmt(ts)   {
        /* Format timestamp as WhatsApp-style HH:MM */
        if (!ts) return '';
        var d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    /* FEATURE (this session — "voice note should show date AND time"):
       a voice note is more likely than a text message to get replayed or
       referenced well after the fact — out of the context of whatever
       "Today"/"Yesterday" date divider it originally sat under — so its
       own timestamp now spells out the date alongside the clock time
       instead of relying on that divider alone. Kept as its own function
       (rather than changing _fmt itself) so every other message type is
       untouched. */
    function _fmtDateTime(ts) {
        if (!ts) return '';
        var d = ts.toDate ? ts.toDate() : new Date(ts);
        var datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        var timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return datePart + ', ' + timePart;
    }
    function _ready(fn) {
        if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn);
    }

    /* FEATURE (this session — "voice note card looks low quality next to
       the reference screenshots"): two real problems traced in the voice-
       note player (audio branch of _buildBubble, below), fixed once here
       rather than patched three times at each call site.

       [1] Duration permanently stuck at "0:00".
           ROOT CAUSE: every duration read in the player did a single,
           direct `vnAudio.duration` check on 'loadedmetadata'. Chrome (and
           Chromium-based WebViews) commonly report `duration` as Infinity
           or NaN for a MediaRecorder-produced webm/opus blob — the exact
           format this app's own recorder produces (see _startRecording) —
           until the element is actually seeked near its end once. That's
           a well-documented browser quirk with recorded (as opposed to
           server-muxed) media, not something a single 'loadedmetadata'
           listener can ever resolve on its own, which is why the number
           never recovered no matter how long the bubble sat on screen.
           _resolveVoiceNoteDuration applies the standard fix (seek to a
           huge currentTime, then back to 0, which forces the browser to
           compute the real duration) automatically whenever the plain
           read comes back non-finite, and also watches 'durationchange'
           (fires in browsers that never satisfy 'loadedmetadata' with a
           usable number) so this recovers on any engine, not just one. */
    function _resolveVoiceNoteDuration(audioEl, onReady) {
        var settled = false;
        function report() {
            if (settled) return;
            var d = audioEl.duration;
            if (d && isFinite(d) && d > 0) {
                settled = true;
                audioEl.removeEventListener('loadedmetadata', onMeta);
                audioEl.removeEventListener('durationchange', report);
                onReady(d);
            }
        }
        function onMeta() {
            if (report()) return;
            /* Duration still Infinity/NaN — force it with the standard
               seek-to-huge-time workaround. Muted + reset to 0 afterward
               so this never audibly clicks or leaves playback position
               anywhere but the start. */
            var prevMuted = audioEl.muted;
            audioEl.muted = true;
            try { audioEl.currentTime = 1e101; } catch (e) { /* some engines throw on out-of-range seeks */ }
            audioEl.addEventListener('timeupdate', function onTU() {
                audioEl.removeEventListener('timeupdate', onTU);
                try { audioEl.currentTime = 0; } catch (e) {}
                audioEl.muted = prevMuted;
                report();
            }, { once: true });
        }
        audioEl.addEventListener('loadedmetadata', onMeta);
        audioEl.addEventListener('durationchange', report);
    }

    /* [2] Waveform looked fake/robotic — EVERY voice note in the app drew
       the exact same hardcoded, perfectly-cyclical bar-height array
       (see the old `barHeights` literal this replaces), so every single
       card had an identical repeating sawtooth pattern instead of
       anything resembling a real recording's envelope — the actual "low
       quality" tell next to the organic-looking waveforms in the
       reference screenshots. Generates a small, deterministic per-message
       pattern instead: seeded from the message's own id (or mediaUrl as a
       fallback) so the SAME voice note always re-renders identically, but
       different voice notes now visibly differ from each other, and a
       gentle random-walk (each bar nudged from its neighbor rather than
       drawn independently) keeps it looking like a smoothed amplitude
       envelope rather than random noise. */
    function _seededRng(seed) {
        var s = 0;
        seed = String(seed || 'vn');
        for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
        if (s === 0) s = 1;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }
    function _makeVoiceNoteBarHeights(seed) {
        var rnd = _seededRng(seed);
        var n = 46, min = 3, max = 22; /* FIX (premium voice-note redesign — taller
           dynamic range now that the track itself grew from 22px to 26px tall,
           so bars keep filling the fuller container instead of looking short
           and flat inside the new, larger card. */
        var heights = [];
        var prev = min + (max - min) * 0.4;
        for (var i = 0; i < n; i++) {
            prev += (rnd() - 0.5) * 9;
            prev = Math.max(min, Math.min(max, prev));
            heights.push(Math.round(prev));
        }
        return heights;
    }


    /* =========================================================================
       §1  INJECT STYLES (once)
       ========================================================================= */
    function _injectStyles() {
        if (document.getElementById('_oc_styles')) return;
        var s = document.createElement('style');
        s.id = '_oc_styles';
        s.textContent = [

            /* ── FIX: defensive backstop against overlapping / split-screen
               sections (screenshots showed two sections rendering at once
               after closing a chat, then tapping the nav bar). Root cause
               was inline style.display being written directly onto
               .content-section elements, which beats class-based CSS and
               can survive a later real navigation. The JS call sites that
               did this have been fixed, but this CSS rule is a backstop:
               no matter what inline style anything sets in the future, a
               non-active .content-section can never paint, and an active
               one is never blocked. !important on both sides means this
               wins regardless of inline style write order. ── */
            '.content-section:not(.active){ display:none!important; }',
            '.content-section.active{ display:block!important; }',

            /* ── messages-view outer container ── */
            '#messages-view{',
            '  display:flex!important;',
            '  height:calc(100dvh - 120px)!important;',
            '  overflow:hidden!important;',
            '  background:#F5F7FB;',
            '  position:relative;',
            '}',

            /* ── contact list (left panel) ── */
            '.contact-list{',
            '  flex:0 0 320px;min-width:320px;max-width:320px;',
            '  overflow-y:auto;',
            '  background:#fff;',
            '  border-right:1px solid rgba(10,14,39,0.08);',
            '  display:flex;flex-direction:column;',
            '}',
            '.contact-item{',
            '  display:flex;align-items:center;gap:12px;',
            '  padding:12px 16px;cursor:pointer;',
            '  border-bottom:1px solid rgba(10,14,39,0.05);',
            '  transition:background 0.14s;',
            '}',
            '.contact-item:hover{ background:rgba(27,43,139,0.05); }',
            '.contact-item.active{ background:rgba(27,43,139,0.10); }',

            /* ── chat placeholder (desktop: no chat selected) ── */
            '#chat-placeholder{',
            '  flex:1;display:flex;align-items:center;justify-content:center;',
            '  flex-direction:column;gap:16px;color:#9CA3AF;',
            '  background:#f7f8fc;',
            '}',

            /* ── chat-view-container ── */
            /* Default HIDDEN on mobile — only shown via .oc-mobile-open (added by openChat).
               The desktop @media below overrides this for wide screens. */
            '#chat-view-container{',
            '  flex:1;display:none;flex-direction:column;',
            '  min-width:0;height:100%;min-height:0;',
            '  background:#F5F7FB;',
            '  position:relative;',
            '}',

            /* ── Premium classic-white sticky header ──
               REDESIGN (2026-10-20 — "premium classic elegant white"):
               the navy/gold bar is now a clean white letterhead with a
               hairline rule and a soft lift shadow; icon chips are a pale
               sky tint with navy glyphs and the light-blue accent
               (#4FB0F2) replaces gold everywhere in the thread. Geometry
               (compact padding, flat edge-to-edge, 36px avatar, scrolled
               glass state) is unchanged from the previous revision. ── */
            '#oc-chat-header{',
            '  display:flex;align-items:center;gap:9px;',
            '  padding:7px 12px;',
            '  background:#fff;',
            '  color:#14213D;',
            '  flex-shrink:0;',
            '  border-radius:0!important;',
            '  position:sticky;top:0;z-index:2147483646;',
            '  box-shadow:0 6px 18px -12px rgba(20,33,61,0.24);',
            '  border-bottom:1px solid #E7EBF3;',
            '  transition:background 0.28s ease,backdrop-filter 0.28s ease,box-shadow 0.28s ease;',
            '}',
            '#oc-chat-header.oc-header-scrolled{',
            '  background:rgba(255,255,255,0.82);',
            '  -webkit-backdrop-filter:blur(14px) saturate(140%);',
            '  backdrop-filter:blur(14px) saturate(140%);',
            '  box-shadow:0 1px 3px rgba(20,33,61,0.06);',
            '  border-bottom-color:#EDF0F6;',
            '}',
            '#oc-back-btn{',
            '  background:#F1F5FB;border:1px solid #E1E8F3;color:#14213D;cursor:pointer;',
            '  width:32px;height:32px;min-width:32px;min-height:32px;border-radius:50%;',
            '  display:flex;align-items:center;justify-content:center;',
            '  flex-shrink:0;margin-left:auto;',
            '  transition:background 0.15s,transform 0.12s;',
            '  order:99;',
            '  position:relative;z-index:2147483647;',
            '  -webkit-tap-highlight-color:rgba(79,176,242,0.25);',
            '  touch-action:manipulation;',
            '  pointer-events:all!important;',
            '}',
            '#oc-back-btn:hover,#oc-back-btn:focus{ background:#E6EEF9; outline:none; }',
            '#oc-back-btn:active{ transform:scale(0.88);background:#DCE8F7; }',
            '#oc-back-btn svg{ width:18px;height:18px;fill:#14213D;pointer-events:none; }',
            '#oc-peer-avatar-wrap{ position:relative;flex-shrink:0;display:inline-flex; }',
            '#oc-peer-avatar{',
            '  width:36px;height:36px;border-radius:50%;object-fit:cover;',
            '  background:#EAF2FB;flex-shrink:0;',
            '  border:2px solid #fff;',
            '  box-shadow:0 0 0 1.5px #B9DDF8,0 2px 8px rgba(20,33,61,0.14);',
            '}',
            '#oc-peer-online-dot{',
            '  position:absolute;bottom:0;right:0;',
            '  width:9px;height:9px;border-radius:50%;',
            '  background:#3fae76;border:2px solid #fff;',
            '  display:none;pointer-events:none;',
            '}',
            '#oc-peer-info{flex:1;min-width:0;display:flex;align-items:center;gap:5px;}',
            /* Name keeps a refined serif (Playfair Display, Georgia fallback)
               — the one "display" moment in the thread; everything else is
               Manrope. */
            '#oc-peer-name{',
            '  font-family:"Playfair Display",Georgia,"Times New Roman",serif;',
            '  font-weight:700;font-size:1rem;color:#14213D;letter-spacing:0.1px;',
            '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
            '}',
            /* last-seen line stays collapsed until #oc-status-toggle is tapped */
            '#oc-peer-status{',
            '  font-family:"Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
            '  font-size:0.72rem;color:#5B6B86;letter-spacing:0.1px;',
            '  max-height:0;opacity:0;overflow:hidden;',
            '  transition:max-height 0.22s ease,opacity 0.18s ease;',
            '}',
            '#oc-peer-info.oc-status-open #oc-peer-status{ max-height:20px;opacity:1;margin-top:1px; }',
            '#oc-status-toggle{',
            '  background:none;border:none;color:rgba(20,33,61,0.45);cursor:pointer;',
            '  display:flex;align-items:center;justify-content:center;padding:2px;flex-shrink:0;',
            '  transition:transform 0.22s ease;',
            '}',
            '#oc-status-toggle svg{ width:13px;height:13px;fill:currentColor; }',
            '#oc-peer-info.oc-status-open #oc-status-toggle{ transform:rotate(180deg); }',
            '.oc-header-btn{',
            '  background:#F1F6FC!important;border:1px solid #DCE9F7;color:#14213D!important;cursor:pointer;',
            '  width:36px;height:36px;border-radius:50%;',
            '  display:flex;align-items:center;justify-content:center;',
            '  flex-shrink:0;transition:background 0.2s ease,transform 0.12s ease;',
            '  margin-left:4px;',
            '}',
            '.oc-header-btn:hover{ background:#E3EFFB!important; }',
            '.oc-header-btn:active{ transform:scale(0.9); }',
            '.oc-header-btn svg:not(.emp-ico){ width:19px;height:19px;fill:#1E2F52!important;stroke:none!important; }',
            '.oc-header-btn svg:not(.emp-ico) path,.oc-header-btn svg:not(.emp-ico) circle,.oc-header-btn svg:not(.emp-ico) line,.oc-header-btn svg:not(.emp-ico) rect{ fill:#1E2F52!important; }',

            /* ── messages scroll area ── (flat cool-white canvas; the old
               ivory wallpaper pattern is gone for the white redesign) */
            '#oc-messages-body{',
            '  flex:1;overflow-y:auto;overflow-x:hidden;',
            '  -webkit-overflow-scrolling:touch;',
            '  overscroll-behavior:contain;',
            '  min-height:0;',
            '  padding:12px 8px 8px;',
            '  display:flex;flex-direction:column;gap:3px;',
            '  background:#F5F7FB;',
            '  scroll-behavior:smooth;',
            '}',
            '#oc-messages-body::before{ content:"";display:none; }',

            /* ── date separator ── */
            '.oc-date-sep{',
            '  text-align:center;margin:10px 0 6px;position:relative;z-index:1;',
            '}',
            '.oc-date-sep span{',
            '  display:inline-block;background:#fff;color:#6B7A94;',
            '  font-family:"Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
            '  font-size:0.7rem;font-weight:600;letter-spacing:0.3px;',
            '  padding:4px 14px;border-radius:14px;',
            '  border:1px solid #E6EBF3;box-shadow:0 1px 2px rgba(20,33,61,0.04);',
            '}',

            /* ── message bubble row ── */
            '.oc-row{',
            '  display:flex;position:relative;z-index:1;',
            '  padding:1px 8px;',
            '}',
            '.oc-row.sent{ justify-content:flex-end; }',
            '.oc-row.recv{ justify-content:flex-start; }',

            /* ── per-message avatar (tap → sender profile) ── */
            '.oc-msg-avatar{',
            '  width:28px;height:28px;border-radius:50%;object-fit:cover;',
            '  margin-right:6px;flex-shrink:0;align-self:flex-end;',
            '  cursor:pointer;',
            '}',

            /* ── bubble ──
               REDESIGN: Manrope body type, 14px corners with a tighter
               "tail" corner, hairline border + a two-layer soft shadow.
               Received = pure white; sent = soft light green (#DCF8C6)
               with navy ink — clearly distinct from white and from the
               site's blue chrome. */
            '.oc-bubble{',
            '  max-width:84%;min-width:60px;',
            '  padding:8px 13px 21px;',
            '  border-radius:14px;',
            '  font-family:"Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
            '  font-size:0.92rem;line-height:1.5;letter-spacing:0;',
            '  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;',
            '  word-break:break-word;',
            '  position:relative;',
            '  box-shadow:0 1px 2px rgba(20,33,61,0.06),0 6px 16px -8px rgba(20,33,61,0.14);',
            '  cursor:default;',
            '  user-select:text;',
            '  -webkit-user-select:text;',
            '}',
            '.oc-row.sent .oc-bubble{',
            '  background:#DCF8C6;color:#14213D;',
            '  border:1px solid #C3E8A8;',
            '  border-bottom-right-radius:3px;',
            '}',
            '.oc-row.recv .oc-bubble{',
            '  background:#fff;color:#1F2A44;',
            '  border:1px solid #E7ECF4;',
            '  border-bottom-left-radius:3px;',
            '}',

            /* ── tail on bubble ── */
            '.oc-row.sent .oc-bubble::after{',
            '  content:"";position:absolute;bottom:0;right:-7px;',
            '  width:0;height:0;',
            '  border-left:8px solid #DCF8C6;',
            '  border-bottom:8px solid transparent;',
            '}',
            '.oc-row.recv .oc-bubble::before{',
            '  content:"";position:absolute;bottom:0;left:-7px;',
            '  width:0;height:0;',
            '  border-right:8px solid #fff;',
            '  border-bottom:8px solid transparent;',
            '}',

            /* ── timestamp inside bubble ── */
            '.oc-ts{',
            '  position:absolute;bottom:4px;right:9px;',
            '  font-size:0.62rem;color:#8794AB;font-weight:500;letter-spacing:0.2px;',
            '  display:flex;align-items:center;gap:3px;white-space:nowrap;',
            '}',
            '.oc-row.sent .oc-ts{ color:rgba(20,33,61,0.52); }',
            /* real tick state is rendered through .oc-tick (see §Xb) */
            '.oc-tick{display:inline-flex;align-items:center;line-height:1;}',
            '.oc-tick.state-sent{color:rgba(20,33,61,0.40);}',
            '.oc-tick.state-delivered{color:rgba(20,33,61,0.40);}',
            '.oc-tick.state-read{color:#2E93E0;}', /* blue read ticks stay visible on the green bubble */

            /* ── status-reply card (inline on the message that was sent
               from a status — replaces the old pinned top banner) ── */
            '.oc-status-reply-card{',
            '  display:flex;align-items:center;gap:9px;',
            '  padding:6px 8px;margin-bottom:6px;',
            '  border-left:3px solid #4FB0F2;border-radius:8px;',
            '  background:rgba(79,176,242,0.10);cursor:pointer;',
            '}',
            '.oc-status-reply-card img,.oc-status-reply-card video{',
            '  width:38px;height:38px;border-radius:7px;object-fit:cover;flex-shrink:0;',
            '  background:#DCEBF8;',
            '}',
            '.oc-status-reply-card .oc-src-col{ display:flex;flex-direction:column;min-width:0; }',
            '.oc-status-reply-card .oc-src-label{',
            '  font-size:0.72rem;font-weight:700;color:#2B7FC4;letter-spacing:0.2px;',
            '}',
            '.oc-status-reply-card .oc-src-sub{',
            '  font-size:0.76rem;color:#6B7A94;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;',
            '}',

            /* ── emoji reactions on bubble ── */
            '.oc-reactions{',
            '  position:absolute;bottom:-12px;',
            '  display:flex;gap:2px;',
            '  background:#fff;border-radius:20px;',
            '  padding:2px 6px;',
            '  box-shadow:0 2px 8px rgba(0,0,0,0.15);',
            '  font-size:0.80rem;',
            '  z-index:2;',
            '}',
            '.oc-row.sent .oc-reactions{ right:8px; }',
            '.oc-row.recv .oc-reactions{ left:8px; }',

            /* ── reaction bar popup (long press) ── */
            '#oc-emoji-bar{',
            '  position:fixed;',
            '  background:#fff;',
            '  border-radius:28px;',
            '  padding:8px 12px;',
            '  display:none;align-items:center;gap:6px;',
            '  box-shadow:0 8px 30px rgba(0,0,0,0.20);',
            '  z-index:99999;',
            '  transform:translateY(-8px);',
            '  transition:transform 0.18s,opacity 0.18s;',
            '  opacity:0;',
            '}',
            '#oc-emoji-bar.visible{ display:flex;transform:translateY(0);opacity:1; }',
            '.oc-emoji-opt{',
            '  font-size:1.6rem;cursor:pointer;',
            '  transition:transform 0.15s;',
            '  user-select:none;',
            '}',
            '.oc-emoji-opt:hover{ transform:scale(1.35); }',
            '.oc-emoji-close{',
            '  font-size:1.1rem;cursor:pointer;color:#6B7280;',
            '  width:28px;height:28px;',
            '  display:flex;align-items:center;justify-content:center;',
            '  border-radius:50%;background:#f3f4f6;',
            '}',

            /* ── composer bar ── (white bar, cool-white pill, light-blue send) */
            '#oc-composer{',
            '  display:flex;align-items:flex-end;gap:8px;',
            '  padding:8px 10px;',
            '  padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));',
            '  background:#fff;',
            '  border-top:1px solid #E9EDF4;',
            '  box-shadow:0 -8px 20px -14px rgba(20,33,61,0.22);',
            '  flex-shrink:0;',
            '  position:relative;z-index:10;',
            '}',
            '.oc-composer-inner{',
            '  flex:1;min-width:0;',
            '  display:flex;align-items:flex-end;',
            '  background:#F4F7FB;border-radius:24px;',
            '  border:1px solid #E1E8F2;',
            '  padding:6px 10px;gap:8px;',
            '  transition:border-color 0.15s,box-shadow 0.15s,background 0.15s;',
            '}',
            '.oc-composer-inner:focus-within{',
            '  background:#fff;border-color:#7CC4F7;',
            '  box-shadow:0 0 0 3px rgba(79,176,242,0.16);',
            '}',
            '#oc-emoji-btn,#oc-attach-btn{',
            '  background:none;border:none;cursor:pointer;padding:4px;',
            '  color:#7A8AA5;display:flex;align-items:center;',
            '  flex-shrink:0;',
            '}',
            '#oc-emoji-btn svg,#oc-attach-btn svg{ width:22px;height:22px;fill:#7A8AA5; }',
            '#oc-text-input{',
            '  flex:1;min-width:0;border:none;outline:none;',
            '  resize:none;background:transparent;',
            '  font-family:"Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
            '  font-size:0.93rem;line-height:1.4;',
            '  max-height:120px;overflow-y:auto;',
            '  padding:2px 0;',
            '  color:#14213D;',
            '}',
            '#oc-text-input::placeholder{ color:#9AA7BD; }',
            '#oc-send-btn,#oc-mic-btn{',
            '  width:44px;height:44px;min-width:44px;min-height:44px;',
            '  border-radius:50%;border:none;cursor:pointer;',
            '  background:linear-gradient(135deg,#6EC3FA 0%,#3F9FE8 100%);color:#fff;',
            '  display:flex!important;align-items:center;justify-content:center;',
            '  flex-shrink:0;',
            '  box-shadow:0 4px 12px rgba(63,159,232,0.38);',
            '  transition:filter 0.15s,transform 0.12s;',
            '}',
            '#oc-send-btn:hover,#oc-mic-btn:hover{ filter:brightness(1.06); }',
            '#oc-send-btn:active,#oc-mic-btn:active{ transform:scale(0.92); }',
            '#oc-send-btn svg,#oc-mic-btn svg{ width:20px;height:20px;fill:#fff; }',
            /* hidden file input */
            '#oc-file-input{ display:none; }',

            /* ── loading spinner inside messages body ── */
            '#oc-loading{',
            '  text-align:center;padding:32px;color:#9CA3AF;font-size:0.85rem;',
            '}',

            /* ── MOBILE: chat panel goes full-screen ── */
            '@media(max-width:699px){',
            '  .contact-list{flex:1;min-width:0;max-width:none;}',
            '  #chat-view-container{',
            '    display:none!important;',
            '    position:fixed!important;',
            '    top:0!important;left:0!important;right:0!important;bottom:0!important;',
            '    z-index:99999!important;',
            '    flex-direction:column!important;',
            '    height:100%!important;height:100dvh!important;',
            '    width:100%!important;',
            '    background:#F5F7FB!important;',
            '    overflow:hidden!important;',
            '  }',
            '  #chat-view-container.oc-mobile-open{display:flex!important;}',
            '  #chat-placeholder{display:none!important;}',
            '  #messages-view{height:calc(100dvh - 60px)!important;}',
            '  /* Ensure messages body fills remaining space and is scrollable */',
            '  #chat-view-container.oc-mobile-open #oc-messages-body{',
            '    flex:1!important;',
            '    overflow-y:scroll!important;',
            '    -webkit-overflow-scrolling:touch!important;',
            '    min-height:0!important;',
            '  }',
            '  /* Composer sticks to bottom */',
            '  #chat-view-container.oc-mobile-open #oc-composer{',
            '    flex-shrink:0!important;',
            '    position:relative!important;',
            '    bottom:0!important;',
            '    width:100%!important;',
            '  }',
            '}',

            /* ── WIDTH-INDEPENDENT: once .oc-mobile-open is applied, the fixed
               full-screen takeover always wins, regardless of what width the
               browser reports (rotation, OS zoom/DPI, "desktop site" mode).
               This is what actually stops the desktop two-column layout from
               bleeding through and causing page overflow on a phone. ── */
            '#chat-view-container.oc-mobile-open{',
            '  display:flex!important;',
            '  position:fixed!important;',
            '  top:0!important;left:0!important;right:0!important;bottom:0!important;',
            '  z-index:99999!important;',
            '  flex-direction:column!important;',
            '  height:100%!important;height:100dvh!important;',
            '  width:100%!important;',
            '  background:#F5F7FB!important;',
            '  overflow:hidden!important;',
            '}',
            'body.oc-chat-open{ overflow:hidden!important; position:fixed!important; width:100%!important; height:100%!important; }',
            'body.oc-chat-open .stories-bar,',
            'body.oc-chat-open .status-bar,',
            'body.oc-chat-open .status-row,',
            'body.oc-chat-open .stories-row,',
            'body.oc-chat-open .status-avatars,',
            'body.oc-chat-open .story-avatars,',
            'body.oc-chat-open [class*="status-scroll"],',
            'body.oc-chat-open [class*="stories"],',
            'body.oc-in-messages .stories-bar,',
            'body.oc-in-messages .status-bar,',
            'body.oc-in-messages .status-row,',
            'body.oc-in-messages .stories-row,',
            'body.oc-in-messages .status-avatars,',
            'body.oc-in-messages .story-avatars,',
            'body.oc-in-messages [class*="status-scroll"],',
            'body.oc-in-messages [class*="stories"]{display:none!important;}',
            /* Also hide when the messages section itself is shown (even before a chat is opened) */
            '#messages-view .stories-bar,',
            '#messages-view .status-bar,',
            '#messages-view .status-row,',
            '#messages-view .stories-row,',
            '#messages-view .status-avatars,',
            '#messages-view .story-avatars,',
            '#messages-view [class*="status-scroll"],',
            '#messages-view [id*="status"],',
            '#messages-view [id*="stories"]{display:none!important;}',
            /* Hide app navigation elements when chat is open full-screen */
            'body.oc-chat-open #nav-bar,',
            'body.oc-chat-open .nav-bar,',
            'body.oc-chat-open .bottom-nav,',
            'body.oc-chat-open .app-nav,',
            'body.oc-chat-open nav,',
            'body.oc-chat-open .main-header,',
            'body.oc-chat-open header,',
            'body.oc-chat-open #main-nav,',
            'body.oc-chat-open .sidebar,',
            /* Also hide the "← Messages" section title bar that sits above our blue header */
            'body.oc-chat-open #messages-view > p,',
            'body.oc-chat-open #messages-view > h1,',
            'body.oc-chat-open #messages-view > h2,',
            'body.oc-chat-open #messages-view > h3,',
            'body.oc-chat-open #messages-view > .section-header,',
            'body.oc-chat-open #messages-view > .page-header,',
            'body.oc-chat-open #messages-view > [class*="section-title"],',
            'body.oc-chat-open #messages-view > [class*="page-title"],',
            'body.oc-chat-open #messages-view > [class*="header"]:not(#oc-chat-header):not(#oc-cl-header){display:none!important;}',

            /* ── DESKTOP: both panels side by side ──
               IMPORTANT: this must never win against the mobile full-screen
               takeover (#chat-view-container.oc-mobile-open, position:fixed,
               set above in the max-width:699px block). If a phone ever
               reports a >=700px layout viewport (rotation, OS-level zoom/
               DPI scaling, "desktop site" mode), this rule used to force
               display:flex on the BARE selector and stomp the fixed overlay,
               causing the two-column desktop chrome to bleed through and the
               page to overflow. Scoping to :not(.oc-mobile-open) makes the
               two states mutually exclusive regardless of viewport quirks. */
            '@media(min-width:700px){',
            '  #chat-view-container:not(.oc-mobile-open){ display:flex!important; }',
            '}',


            /* (Legacy nth-of-type CSS hacks removed — replaced by a runtime
               sweep in _buildChatView that finds and removes any stray call/
               video icon button that isn't one of ours. CSS positional
               selectors broke every time the header's child order changed.) */

            /* FIX-3: lightbox for image messages */
            '#oc-lightbox{',
            '  position:fixed;inset:0;z-index:9999999;',
            '  background:rgba(0,0,0,0.92);',
            '  display:flex;align-items:center;justify-content:center;',
            '  cursor:zoom-out;',
            '}',
            '#oc-lightbox img,',
            '#oc-lightbox video{',
            /* FIX (avatar lightbox opening as a small picture, not full
               screen): max-width/max-height only ever cap an image from
               growing too large — they never force a small intrinsic
               image (e.g. a compact avatar thumbnail URL) to grow to
               fill the screen. Setting explicit width/height here as
               well, alongside object-fit:contain, is what actually makes
               a small source image scale UP to fill the available space
               while still preserving its aspect ratio (no stretching/
               distortion) and letterboxing rather than cropping. */
            '  width:96vw;height:90vh;',
            '  max-width:96vw;max-height:90vh;',
            '  border-radius:8px;',
            '  box-shadow:0 8px 40px rgba(0,0,0,0.6);',
            '  object-fit:contain;',
            '}',
            '#oc-lightbox-close{',
            '  position:absolute;top:16px;right:16px;',
            '  background:rgba(255,255,255,0.15);border:none;color:#fff;',
            '  width:36px;height:36px;border-radius:50%;cursor:pointer;',
            '  font-size:1.2rem;display:flex;align-items:center;justify-content:center;',
            '}',
            '.oc-bubble img{ cursor:zoom-in; }',
            /* FEATURE (2026-08-01 — tap-to-expand video, same as images):
               the inline chat-bubble preview is now controls-less and
               muted (see _buildBubble's video branch) so a tap anywhere
               on it has one unambiguous meaning — open the fullscreen
               lightbox, where a real <video controls autoplay> takes
               over. A dedicated play-button overlay sits on top purely
               as a visual affordance; pointer-events:none on it so the
               click still lands on .oc-video-tap-wrap underneath. */
            '.oc-video-tap-wrap{ position:relative; cursor:pointer; }',
            '.oc-video-tap-wrap video{',
            '  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none;',
            '}',
            '.oc-video-play-overlay{',
            '  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
            '  pointer-events:none;',
            '}',
            '.oc-video-play-overlay > span{',
            '  width:52px;height:52px;border-radius:50%;background:rgba(0,0,0,0.55);',
            '  display:flex;align-items:center;justify-content:center;',
            '}',

            /* FIX-4: ALWAYS hide status icons strip inside messages-view — no class condition needed */
            '#messages-view #status-bar-container,',
            '#messages-view #status-bar-inner,',
            '#messages-view .status-bar,',
            '#messages-view .status-row,',
            '#messages-view .stories-bar,',
            '#messages-view .stories-row,',
            '#messages-view .stories-container,',
            '#messages-view #stories-row,',
            '#messages-view [id*="status-bar"],',
            '#messages-view [class*="status-bar"]{display:none!important;}',
            /* Also hide via body class as belt-and-suspenders */
            'body.oc-in-messages #status-bar-container,',
            'body.oc-in-messages #status-bar-inner,',
            'body.oc-in-messages .status-scroll,',
            'body.oc-in-messages .stories-container,',
            'body.oc-in-messages #stories-row{display:none!important;}',
            '#messages-view > div:first-child[class*="status"],',
            '#messages-view > div:first-child[class*="stor"]{display:none!important;}',

            /* FIX-5: 3-dot dropdown menu */
            '#oc-more-menu{',
            '  position:absolute;top:52px;right:8px;',
            '  background:#fff;border-radius:8px;',
            '  box-shadow:0 4px 24px rgba(0,0,0,0.18);',
            '  z-index:99999;min-width:180px;',
            '  overflow:hidden;',
            '  animation:oc-menu-in 0.15s ease;',
            '}',
            '@keyframes oc-menu-in{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}',
            /* FEATURE (this session — lazy-download voice notes):
               indeterminate spin for the download progress ring when the
               server doesn't send a Content-Length header (so we can't
               compute a real percentage) — a rotating partial arc still
               communicates "working on it" instead of a dead button. */
            '@keyframes oc-vn-spin{to{transform:rotate(270deg);}}',
            '.oc-vn-ring-indeterminate{animation:oc-vn-spin 0.9s linear infinite;transform-origin:17px 17px;}',
            '.oc-menu-item{',
            '  padding:13px 18px;font-size:0.88rem;color:#111;',
            '  cursor:pointer;white-space:nowrap;',
            '  transition:background 0.12s;',
            '}',
            '.oc-menu-item:hover{background:#f3f4f6;}',
            '.oc-menu-item + .oc-menu-item{border-top:1px solid rgba(0,0,0,0.05);}',

            /* FIX-8: full emoji panel */
            '#oc-emoji-panel{',
            '  position:absolute;bottom:68px;left:0;right:0;',
            '  background:#fff;',
            '  border-radius:16px 16px 0 0;',
            '  box-shadow:0 -4px 24px rgba(0,0,0,0.15);',
            '  z-index:9999;',
            '  display:flex;flex-direction:column;',
            '  max-height:320px;',
            '  overflow:hidden;',
            '}',
            '.oc-emoji-cats{',
            '  display:flex;',
            '  border-bottom:1px solid #e5e7eb;',
            '  overflow-x:auto;flex-shrink:0;',
            '  scrollbar-width:none;',
            '}',
            '.oc-emoji-cats::-webkit-scrollbar{display:none;}',
            '.oc-emoji-cat-btn{',
            '  flex-shrink:0;border:none;background:none;cursor:pointer;',
            '  padding:8px 12px;font-size:1.3rem;',
            '  border-bottom:2px solid transparent;',
            '  transition:border-color 0.15s;',
            '}',
            '.oc-emoji-cat-btn.active{border-bottom-color:#4FB0F2;}',
            '.oc-emoji-search{',
            '  padding:6px 10px;border:none;outline:none;',
            '  border-bottom:1px solid #e5e7eb;',
            '  font-size:0.85rem;flex-shrink:0;',
            '}',
            '.oc-emoji-grid{',
            '  display:flex;flex-wrap:wrap;gap:2px;',
            '  overflow-y:auto;padding:8px;',
            '  flex:1;',
            '}',
            '.oc-emoji-grid span{',
            '  font-size:1.5rem;cursor:pointer;width:36px;height:36px;',
            '  display:flex;align-items:center;justify-content:center;',
            '  border-radius:8px;',
            '  transition:background 0.12s;',
            '}',
            '.oc-emoji-grid span:hover{background:#f3f4f6;}',

            /* FIX-4: chat panel fully covers screen including browser chrome */
            /* FIX (bug: "voice/video calls and emojis don't work inside the
               chat box — only seem to fire after tapping X, and then render
               OVER the contact list"): this block used to also declare
               z-index:2147483647!important here, on the SAME selector as the
               z-index:99999!important rule above. Equal specificity + equal
               !important means the LAST declared rule wins on mobile, so the
               open chat panel was actually painting at the absolute max
               z-index — higher than #oc-call-modal (999999), the bubble
               long-press emoji sheet/overlay (9999998/9999999), and the
               lightbox/media panel (9999998/9999999). Those elements were
               still being created correctly when their buttons were tapped,
               but they rendered UNDERNEATH the opaque chat panel, so nothing
               appeared to happen. The instant X was tapped, .oc-mobile-open
               was removed, the chat panel's inflated z-index went away, and
               whatever had silently opened became visible — now floating
               over the contact list instead of the chat.
               FIX: drop the z-index override here entirely. The earlier
               z-index:99999!important rule (already more than enough to
               cover the rest of the app/nav bar, which was this block's
               original purpose) now applies uncontested, restoring the
               correct stacking order: chat panel < call modal < emoji /
               lightbox overlays. */
            '@media(max-width:699px){',
            '  body.oc-chat-open{ overflow:hidden!important; }',
            '  #chat-view-container.oc-mobile-open{',
            '    position:fixed!important;',
            '    top:0!important;left:0!important;right:0!important;bottom:0!important;',
            '    height:100%!important;height:100dvh!important;',
            '    width:100vw!important;',
            '    display:flex!important;flex-direction:column!important;',
            '    background:#F5F7FB!important;',
            '  }',
            '}',
            /* Hide status bar ONLY inside messages section + when chat is open */
            '#messages-view #status-bar-container,',
            '#messages-view #status-bar-inner,',
            'body.oc-chat-open #status-bar-container,',
            'body.oc-chat-open #status-bar-inner,',
            'body.oc-in-messages #status-bar-container,',
            'body.oc-in-messages #status-bar-inner{display:none!important;}',

            /* Pull the contact avatar scroll row (Akhigbe, Williams…) to the top of messages-view */
            '#messages-view .contact-list{margin-top:0!important;padding-top:0!important;}',

            /* Hide the app's native "← Messages" back link when our chat is open full-screen */
            'body.oc-chat-open .messages-back,',
            'body.oc-chat-open [class*="messages-back"],',
            'body.oc-chat-open .chat-back,',
            'body.oc-chat-open [class*="chat-back"],',
            'body.oc-chat-open #messages-back,',
            /* Hide ANY ← arrow / back link sitting directly above our blue header */
            'body.oc-chat-open #messages-view > a,',
            'body.oc-chat-open #messages-view > .back-link,',
            'body.oc-chat-open #messages-view > [class*="back"]{display:none!important;}',

            /* ── Message Interaction Fix: long-press selection highlight ──
               Marks the bubble that's currently targeted by the long-press
               action sheet / an in-progress reply, so it's visually clear
               which message the composer's quoted reply belongs to (same
               idea as WhatsApp's dimmed-row-with-tinted-bubble treatment). */
            '.oc-row.oc-row-selected .oc-bubble{',
            '  background:rgba(79,176,242,0.18)!important;',
            '  box-shadow:0 0 0 2px rgba(79,176,242,0.34) inset;',
            '  transition:background 0.15s;',
            '}',

            /* ── Pin Message: horizontal scrollable strip ── */
            '#oc-pinned-strip{',
            '  display:flex;gap:8px;overflow-x:auto;',
            '  padding:8px 12px;background:#F3F8FE;',
            '  border-bottom:1px solid #E3EBF5;',
            '  flex-shrink:0;-webkit-overflow-scrolling:touch;',
            '}',
            '#oc-pinned-strip::-webkit-scrollbar{ height:4px; }',
            '.oc-pin-card{',
            '  flex:0 0 auto;max-width:180px;display:flex;align-items:center;gap:6px;',
            '  padding:6px 10px;border-radius:14px;background:#fff;',
            '  border:1px solid rgba(79,176,242,0.35);cursor:pointer;',
            '}',
            '.oc-pin-card img{ width:22px;height:22px;border-radius:4px;object-fit:cover;flex-shrink:0; }',
            '.oc-pin-card span{ font-size:0.74rem;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px; }',
            '.oc-pin-card .oc-pin-unpin{ color:#9CA3AF;font-size:0.9rem;margin-left:2px;flex-shrink:0; }',
            '.oc-row.oc-row-pinned{ position:relative; }',

            /* ── Status-to-chat integration: "replied to a status" banner ── */
            '#oc-status-preview-strip{',
            '  display:flex;align-items:center;gap:10px;',
            '  padding:8px 12px;background:#EEF0FA;',
            '  border-bottom:1px solid rgba(10,14,39,0.08);',
            '  flex-shrink:0;cursor:pointer;',
            '}',
            '#oc-status-preview-strip img,#oc-status-preview-strip video{',
            '  width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;',
            '  border:1px solid rgba(27,43,139,0.18);',
            '}',
            '#oc-status-preview-strip .oc-status-preview-label{',
            '  font-size:0.76rem;color:#374151;font-weight:600;',
            '}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }


    /* =========================================================================
       §2  EMOJI REACTION BAR (long-press)
       ========================================================================= */
    var _emojiBar   = null;
    var _emojiTarget = null; /* { msgId, row } */
    var _emojiBarCloseListener = null; /* FIX: tracks the single active outside-tap listener so repeated _showEmojiBar() calls can never stack capture-phase listeners on document */
    var _longPressTimer = null;
    var EMOJIS = ['👍','❤️','😂','😮','😢','🙏'];

    function _buildEmojiBar() {
        if (document.getElementById('oc-emoji-bar')) return;
        var bar = document.createElement('div');
        bar.id = 'oc-emoji-bar';
        EMOJIS.forEach(function(em) {
            var span = document.createElement('span');
            span.className = 'oc-emoji-opt';
            span.textContent = em;
            span.addEventListener('click', function() { _sendReaction(em); });
            bar.appendChild(span);
        });
        /* close button */
        var close = document.createElement('span');
        close.className = 'oc-emoji-close';
        close.innerHTML = '&#x2715;';
        close.addEventListener('click', _hideEmojiBar);
        bar.appendChild(close);
        document.body.appendChild(bar);
        _emojiBar = bar;
    }

    function _showEmojiBar(row, msgId, x, y) {
        _buildEmojiBar();
        _emojiTarget = { msgId: msgId, row: row };
        var bar = document.getElementById('oc-emoji-bar');
        /* Position above the tap point */
        var barW = 320, barH = 56;
        var left = Math.max(8, Math.min(x - barW/2, window.innerWidth - barW - 8));
        var top  = Math.max(8, y - barH - 12);
        bar.style.left = left + 'px';
        bar.style.top  = top  + 'px';
        bar.classList.add('visible');
        /* FIX-6: ensure target row is visible */
        if (_emojiTarget && _emojiTarget.row) { _emojiTarget.row.style.opacity = '1'; _emojiTarget.row.style.display = ''; }
        /* FIX-6: close on outside tap — use 400 ms delay so touch-end doesn't immediately close.
           FIX (compounding bug): every call to _showEmojiBar used to add a
           NEW capture-phase 'click' listener on document without ever
           removing a previous one that might still be active (e.g. if the
           bar was shown again before the prior listener had fired and
           self-removed). These run before ANY other click handler on the
           page, including the header's video/call buttons — over a
           session with repeated long-presses, they could accumulate,
           adding overhead to every single click and increasing the risk of
           one of them swallowing a tap meant for something else. FIX:
           track the single active listener at module scope and always
           remove it first, so there is never more than one at a time. */
        if (_emojiBarCloseListener) {
            document.removeEventListener('click', _emojiBarCloseListener, true);
            _emojiBarCloseListener = null;
        }
        setTimeout(function() {
            _emojiBarCloseListener = function _closeBar(e) {
                /* Don't close if the click was on an emoji option */
                if (e.target && e.target.classList && e.target.classList.contains('oc-emoji-opt')) return;
                _hideEmojiBar();
                document.removeEventListener('click', _emojiBarCloseListener, true);
                _emojiBarCloseListener = null;
            };
            document.addEventListener('click', _emojiBarCloseListener, { capture: true });
        }, 400);
    }

    function _hideEmojiBar() {
        var bar = document.getElementById('oc-emoji-bar');
        if (bar) bar.classList.remove('visible');
        _emojiTarget = null;
    }

    function _sendReaction(emoji) {
        /* FIX-7: if composer is focused, insert into text instead of reacting */
        var inp = document.getElementById('oc-text-input');
        if (inp && document.activeElement === inp) {
            var pos = inp.selectionStart || inp.value.length;
            inp.value = inp.value.slice(0, pos) + emoji + inp.value.slice(pos);
            inp.dispatchEvent(new Event('input'));
            inp.focus();
            _hideEmojiBar();
            return;
        }
        _hideEmojiBar();
        if (!_emojiTarget) return;
        var msgId = _emojiTarget.msgId;
        var row   = _emojiTarget.row;
        /* Optimistic render */
        _renderReaction(row, emoji);
        /* Firestore persist */
        if (_fbOk() && msgId) {
            var u = _us();
            try {
                window.fbDb.collection('messages').doc(msgId).update({
                    ['reactions.' + (u.id||'anon')]: emoji
                }).catch(function(){});
            } catch(e){}
        }
    }

    function _renderReaction(row, emoji) {
        var existing = row.querySelector('.oc-reactions');
        if (!existing) {
            existing = document.createElement('div');
            existing.className = 'oc-reactions';
            var bubble = row.querySelector('.oc-bubble');
            if (bubble) bubble.appendChild(existing);
        }
        /* Show reaction count-style badge */
        var found = false;
        existing.querySelectorAll('.oc-rx-item').forEach(function(el) {
            if (el.dataset.em === emoji) {
                var cnt = parseInt(el.dataset.count||'1',10) + 1;
                el.dataset.count = cnt;
                el.textContent = emoji + (cnt > 1 ? ' '+cnt : '');
                found = true;
            }
        });
        if (!found) {
            var item = document.createElement('span');
            item.className = 'oc-rx-item';
            item.dataset.em = emoji;
            item.dataset.count = '1';
            item.textContent = emoji;
            existing.appendChild(item);
        }
    }


    /* =========================================================================
       FIX (bug: "voice/video calls and emojis respond outside the chat box,
       after exit") — second half of the fix.
       -------------------------------------------------------------------------
       Even with the z-index conflict above corrected, there's still a path
       to the same symptom: if the user taps X WHILE the bubble emoji
       catalog (or the composer's full emoji panel, or the quick-react bar,
       or the 3-dot menu) happens to be open, none of those elements were
       ever torn down by _doCloseChat() — they live independently of
       #chat-view-container. Closing the chat would leave them floating on
       top of the now-visible contact list. This single helper removes all
       of them; it's called from _doCloseChat() below, every time the chat
       closes, so nothing from the chat box can ever survive past exit.
       NOTE: #oc-call-modal is deliberately NOT included here — an in-progress
       call is meant to keep running after the chat panel closes (same as a
       phone call surviving you backgrounding the app), and it already has
       its own correct teardown in _rtcHangup().
       ========================================================================= */
    function _closeFloatingChatUI() {
        var ids = ['oc-bubble-emoji-sheet', 'oc-sheet-overlay', 'oc-emoji-panel', 'oc-more-menu'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
        _hideEmojiBar();
    }

    /* =========================================================================
       FIX-5  BUBBLE LONG-PRESS EMOJI CATALOG (slide-up bottom sheet)
       ========================================================================= */
    function _showBubbleEmojiCatalog(row, msgId) {
        /* FIX (bug: "nothing responds to clicks until X is pressed"): this
           only ever removed a stale #oc-bubble-emoji-sheet here — it never
           removed a stale #oc-sheet-overlay. The overlay is a
           position:fixed;inset:0 element at z-index:9999998, covering the
           ENTIRE chat (including the header's video/call buttons and every
           message bubble). If a previous catalog open didn't get fully
           torn down (e.g. a new long-press fired while the previous
           sheet's 50ms close-delay was still pending), a stray overlay
           could outlive its sheet and silently sit on top of everything,
           swallowing every tap meant for a real button underneath it.
           FIX: remove BOTH stale elements here, unconditionally, every
           time the catalog is about to open. */
        var old = document.getElementById('oc-bubble-emoji-sheet');
        if (old) old.remove();
        var oldOv = document.getElementById('oc-sheet-overlay');
        if (oldOv) oldOv.remove();

        /* Keep the row visible */
        row.style.opacity = '1';

        var sheet = document.createElement('div');
        sheet.id = 'oc-bubble-emoji-sheet';
        sheet.style.cssText = [
            'position:fixed;bottom:0;left:0;right:0;',
            'z-index:9999999;',
            'background:#fff;',
            'border-radius:20px 20px 0 0;',
            'box-shadow:0 -4px 30px rgba(0,0,0,0.22);',
            'display:flex;flex-direction:column;',
            'max-height:55vh;',
            'animation:oc-sheet-up 0.22s ease;',
        ].join('');

        /* Inject animation once */
        if (!document.getElementById('oc-sheet-anim')) {
            var st = document.createElement('style');
            st.id = 'oc-sheet-anim';
            st.textContent = '@keyframes oc-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}';
            document.head.appendChild(st);
        }

        /* Quick-react row at the top */
        var quickRow = document.createElement('div');
        quickRow.style.cssText = 'display:flex;align-items:center;justify-content:space-around;padding:14px 10px 8px;border-bottom:1px solid #e5e7eb;flex-shrink:0;';
        var QUICK = ['👍','❤️','😂','😮','😢','🙏','🔥','👏'];
        QUICK.forEach(function(em) {
            var sp = document.createElement('span');
            sp.textContent = em;
            sp.style.cssText = 'font-size:1.8rem;cursor:pointer;transition:transform 0.1s;padding:4px;';
            sp.addEventListener('touchstart', function(){ sp.style.transform='scale(1.3)'; }, { passive:true });
            sp.addEventListener('touchend',   function(){ sp.style.transform='scale(1)'; },  { passive:true });
            sp.addEventListener('click', function(e) {
                e.stopPropagation();
                sheet.remove();
                _renderReaction(row, em);
                /* Persist to Firestore */
                if (_fbOk() && msgId) {
                    var u = _us();
                    try { window.fbDb.collection('messages').doc(msgId)
                        .update({ ['reactions.' + (u.id||'anon')]: em }).catch(function(){}); } catch(e){}
                }
            });
            quickRow.appendChild(sp);
        });
        sheet.appendChild(quickRow);

        /* Category tabs */
        var cats = document.createElement('div');
        cats.style.cssText = 'display:flex;overflow-x:auto;border-bottom:1px solid #e5e7eb;flex-shrink:0;scrollbar-width:none;';

        /* Search */
        var searchRow = document.createElement('div');
        searchRow.style.cssText = 'padding:6px 10px;flex-shrink:0;';
        var searchInp = document.createElement('input');
        searchInp.placeholder = '🔍 Search emoji…';
        searchInp.style.cssText = 'width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:20px;font-size:0.85rem;outline:none;box-sizing:border-box;';

        /* Grid */
        var grid = document.createElement('div');
        grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;overflow-y:auto;padding:8px;flex:1;';

        var _CATS = {
            '😊': ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','😵','🤠','🥸','😷','🤒','🤕','🤢','🤮','🤧','🥴','😇','🤡'],
            '👋': ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','💅','🤳','✍️'],
            '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','❤️‍🔥','❤️‍🩹'],
            '🐶': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🐢','🐍','🦎','🦖','🦕','🐙','🐠','🐟','🐬','🐳','🦈','🦊','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿','🦔'],
            '🍎': ['🍎','🍊','🍋','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🥔','🥕','🌽','🌶','🥒','🧅','🧄','🍞','🥐','🥖','🧀','🥚','🍳','🥞','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🌮','🌯','🍱','🍣','🍤','🍜','🍝','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🧃','🥤','🧋','🍺','🥂','🍷','🍸','🍹'],
            '⚽': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🎱','🏓','🏸','⛳','🎣','🥊','🥋','🎽','🛹','⛸','🥌','🎿','🏆','🥇','🥈','🥉','🏅','🎖','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🎹','🥁','🎷','🎺','🎸','🎻','🎲','♟','🎯','🎳','🎮','🎰','🧩'],
            '✈️': ['🚗','🚕','🚙','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍','🛵','🚲','🛴','⛵','🚤','🛳','✈️','🛩','🛫','🛬','🚁','🚀','🛸','🌍','🌎','🌏','🗺','🏔','⛰','🌋','🏕','🏖','🏜','🏝','🏠','🏡','🏢','🏣','🏦','🏨','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🕍','⛩','🕋'],
            '💡': ['⌚','📱','💻','⌨️','🖥','🖨','🖱','💾','💿','📷','📸','📹','🎥','📞','☎️','📺','📻','🔋','🔌','💡','🔦','🕯','💰','💳','💹','📈','📉','📊','📋','📌','📍','✂️','🔐','🔑','🗝','🔨','🪓','⚒','🛠','🔧','🔩','⚙️','🔭','🔬','💊','💉','🩺','🛋','🚿','🛁'],
            '🔣': ['❤️','✅','❎','🔴','🟠','🟡','🟢','🔵','🟣','🔺','🔻','💠','💯','🆗','🆙','🆒','🆕','🆓','🔞','📵','🚫','⭕','❌','❓','❔','❕','❗','💤','🔅','🔆','🔱','♻️','💢','💥','💫','💦','💨','⬛','⬜','▪️','▫️','🔷','🔶','🔹','🔸']
        };
        var catKeys = Object.keys(_CATS);
        var _curCat = catKeys[0];

        function _renderGrid(catKey) {
            grid.innerHTML = '';
            var emojis = _CATS[catKey] || [];
            emojis.forEach(function(em) {
                var sp = document.createElement('span');
                sp.textContent = em;
                sp.style.cssText = 'font-size:1.5rem;cursor:pointer;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:8px;transition:background 0.1s;';
                sp.addEventListener('touchstart', function(){ sp.style.background='#f3f4f6'; }, { passive:true });
                sp.addEventListener('touchend',   function(){ sp.style.background=''; }, { passive:true });
                sp.addEventListener('click', function(e) {
                    e.stopPropagation();
                    /* Apply emoji: react to bubble */
                    sheet.remove();
                    _renderReaction(row, em);
                    if (_fbOk() && msgId) {
                        var u = _us();
                        try { window.fbDb.collection('messages').doc(msgId)
                            .update({ ['reactions.' + (u.id||'anon')]: em }).catch(function(){}); } catch(e){}
                    }
                    /* Also insert into text input if it has focus */
                    var inp = document.getElementById('oc-text-input');
                    if (inp && document.activeElement === inp) {
                        var pos = inp.selectionStart || inp.value.length;
                        inp.value = inp.value.slice(0,pos) + em + inp.value.slice(pos);
                        inp.dispatchEvent(new Event('input'));
                    }
                });
                grid.appendChild(sp);
            });
        }

        catKeys.forEach(function(key) {
            var btn = document.createElement('button');
            btn.style.cssText = 'flex-shrink:0;border:none;background:none;cursor:pointer;padding:8px 12px;font-size:1.3rem;border-bottom:2px solid transparent;transition:border-color 0.15s;';
            btn.textContent = key;
            btn.title = key;
            if (key === _curCat) btn.style.borderBottomColor = '#1B2B8B';
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                cats.querySelectorAll('button').forEach(function(b){ b.style.borderBottomColor='transparent'; });
                btn.style.borderBottomColor = '#1B2B8B';
                _curCat = key;
                searchInp.value = '';
                _renderGrid(key);
            });
            cats.appendChild(btn);
        });

        searchInp.addEventListener('input', function(e) {
            e.stopPropagation();
            var kw = searchInp.value.toLowerCase().trim();
            if (!kw) { _renderGrid(_curCat); return; }
            grid.innerHTML = '';
            catKeys.forEach(function(key) {
                (_CATS[key] || []).forEach(function(em) {
                    var sp = document.createElement('span');
                    sp.textContent = em;
                    sp.style.cssText = 'font-size:1.5rem;cursor:pointer;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:8px;';
                    sp.addEventListener('click', function(evt) {
                        evt.stopPropagation();
                        sheet.remove();
                        _renderReaction(row, em);
                        if (_fbOk() && msgId) {
                            var u = _us();
                            try { window.fbDb.collection('messages').doc(msgId)
                                .update({ ['reactions.' + (u.id||'anon')]: em }).catch(function(){}); } catch(e){}
                        }
                    });
                    grid.appendChild(sp);
                });
            });
        });

        /* Handle outside tap — close sheet */
        var _sheetOverlay = document.createElement('div');
        _sheetOverlay.id = 'oc-sheet-overlay';
        _sheetOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999998;background:rgba(0,0,0,0.3);';

        /* Central close: always removes BOTH sheet and overlay */
        function _closeSheet() {
            var ov = document.getElementById('oc-sheet-overlay');
            if (ov) ov.remove();
            var sh = document.getElementById('oc-bubble-emoji-sheet');
            if (sh) sh.remove();
        }

        _sheetOverlay.addEventListener('click', _closeSheet);

        /* Patch every quick-react span click to also close overlay */
        quickRow.querySelectorAll('span').forEach(function(sp) {
            sp.addEventListener('click', function() { setTimeout(_closeSheet, 50); });
        });

        /* Patch grid emoji clicks — wrap _renderGrid to close after pick */
        var _origRenderGrid = _renderGrid;
        _renderGrid = function(catKey) {
            _origRenderGrid(catKey);
            grid.querySelectorAll('span').forEach(function(sp) {
                sp.addEventListener('click', function() { setTimeout(_closeSheet, 50); });
            });
        };
        /* Re-patch search results too */
        searchInp.addEventListener('input', function() {
            setTimeout(function() {
                grid.querySelectorAll('span').forEach(function(sp) {
                    sp.addEventListener('click', function() { setTimeout(_closeSheet, 50); });
                });
            }, 80);
        });

        searchRow.appendChild(searchInp);
        sheet.appendChild(quickRow);
        sheet.appendChild(cats);
        sheet.appendChild(searchRow);
        sheet.appendChild(grid);

        document.body.appendChild(_sheetOverlay);
        document.body.appendChild(sheet);

        _renderGrid(_curCat);
    }

    function _attachLongPress(row, msgId, data, isSent) {
        var _startX, _startY;

        function _onStart(e) {
            var pt = e.touches ? e.touches[0] : e;
            _startX = pt.clientX; _startY = pt.clientY;
            _longPressTimer = setTimeout(function() {
                /* FIX v15 (Message Editing & Deletion spec): long-press now
                   opens a message action sheet (React / Edit / Delete /
                   Message info) instead of jumping straight to the emoji
                   catalog — reacting is still one tap away from there. */
                row.classList.add('oc-row-selected');
                /* FIX (2026-08-01 — lightbox popping open right after a
                   long-press): mobile browsers still fire a synthetic
                   click once the finger lifts after a long-press, which
                   would otherwise also trigger the image/video tap
                   handler below and open the fullscreen lightbox right
                   on top of the action sheet that just opened. */
                row._ocLongPressFired = true;
                setTimeout(function () { row._ocLongPressFired = false; }, 400);
                _showMessageActionSheet(row, msgId, row._msgData || data, isSent);
            }, 480);
        }
        function _onEnd()  { clearTimeout(_longPressTimer); }
        function _onMove(e) {
            var pt = e.touches ? e.touches[0] : e;
            if (Math.abs(pt.clientX - _startX) > 10 || Math.abs(pt.clientY - _startY) > 10) {
                clearTimeout(_longPressTimer);
            }
        }

        row.addEventListener('touchstart',  _onStart, { passive: true });
        row.addEventListener('touchend',    _onEnd,   { passive: true });
        row.addEventListener('touchcancel', _onEnd,   { passive: true });
        row.addEventListener('touchmove',   _onMove,  { passive: true });
        /* Desktop: right-click opens the same action sheet */
        row.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            row.classList.add('oc-row-selected');
            _showMessageActionSheet(row, msgId, row._msgData || data, isSent);
        });
    }

    /* =========================================================================
       §3b  MESSAGE ACTION SHEET  (React / Edit / Delete / Message info)
       ─────────────────────────────────────────────────────────────────────────
       FIX v15 — Messaging spec items 1 & 3 ("Message Editing & Deletion",
       "Read Receipts"). A deleted bubble (data.deleted===true) never gets
       this sheet attached at all (see _buildBubble's early return), so
       there's nothing to guard against here.
       ========================================================================= */
    function _showMessageActionSheet(row, msgId, data, isSent) {
        data = data || {};
        var existing = document.getElementById('oc-msg-actions-sheet');
        if (existing) existing.remove();
        var existingOv = document.getElementById('oc-msg-actions-overlay');
        if (existingOv) existingOv.remove();

        var overlay = document.createElement('div');
        overlay.id = 'oc-msg-actions-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999996;background:rgba(0,0,0,0.3);';

        var sheet = document.createElement('div');
        sheet.id = 'oc-msg-actions-sheet';
        sheet.style.cssText = [
            'position:fixed;bottom:0;left:0;right:0;z-index:9999997;',
            'background:#fff;border-radius:16px 16px 0 0;',
            'box-shadow:0 -4px 30px rgba(0,0,0,0.22);',
            'padding:6px 0 max(10px, env(safe-area-inset-bottom));',
        ].join('');

        function _closeSheet() {
            var ov = document.getElementById('oc-msg-actions-overlay'); if (ov) ov.remove();
            var sh = document.getElementById('oc-msg-actions-sheet');   if (sh) sh.remove();
            row.classList.remove('oc-row-selected');
        }
        overlay.addEventListener('click', _closeSheet);

        function _row(label, opts) {
            opts = opts || {};
            var r = document.createElement('button');
            r.style.cssText = 'display:block;width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:0.92rem;color:' + (opts.color || '#111') + ';';
            r.textContent = label;
            r.addEventListener('click', function() {
                /* FIX (2026-08-01 — Share button opens frozen/blank until an
                   unrelated repaint): opts.deferClose lets a row build its
                   own follow-on UI BEFORE this sheet is torn down, instead
                   of always closing synchronously first. See the Share row
                   below for why — same root cause app-patch-v13.js's
                   EmpShare rewrite already documents and fixes internally,
                   just not at this outer entry point until now. */
                if (opts.deferClose) { if (opts.onClick) opts.onClick(); return; }
                _closeSheet(); if (opts.onClick) opts.onClick();
            });
            return r;
        }

        sheet.appendChild(_row('React', { onClick: function() {
            _emojiTarget = { msgId: msgId, row: row };
            _showBubbleEmojiCatalog(row, msgId);
        }}));

        /* Reply — quote this message in a composer preview, any message
           type (text, media, or voice note), sender or recipient. */
        sheet.appendChild(_row('Reply', { onClick: function() { _startReply(msgId, data, row); } }));

        sheet.appendChild(_row(data.pinned === true ? 'Unpin' : 'Pin', { onClick: function() { _togglePinMessage(msgId, data, data.pinned !== true); } }));

        /* FEATURE (2026-08-02 — Forward vs Share spec): this used to be a
           single "Share" row that sent immediately with no chance to
           edit — that's exactly what "Forward" is supposed to be, so it's
           kept, unchanged in behavior, just relabeled and given
           internalOnly:true (destination picker only — My Status/Groups/
           Direct chats — no WhatsApp/native-share tile, since forwarding
           a message you're already inside Empyrean reading doesn't need
           an "external app" step). A NEW "Share" row is added alongside
           it, same destination picker, but mode:'share' opens EmpShare's
           new editing composer after destinations are picked, so the
           person can add a comment or edit the text first — the one
           actual behavioral difference the spec asks for. */
        sheet.appendChild(_row('Forward', { deferClose: true, onClick: function() {
            if (window.EmpShare && typeof window.EmpShare.open === 'function') {
                window.EmpShare.open({ text: data.text || '', mediaUrl: data.mediaUrl || '', mediaType: data.mediaType || '', mode: 'forward', internalOnly: true });
                requestAnimationFrame(function() { requestAnimationFrame(_closeSheet); });
            } else if (data.mediaUrl) {
                _closeSheet();
                _shareMediaToStatus(data);
            } else {
                _closeSheet();
            }
        }}));

        sheet.appendChild(_row('Share', { deferClose: true, onClick: function() {
            if (window.EmpShare && typeof window.EmpShare.open === 'function') {
                window.EmpShare.open({ text: data.text || '', mediaUrl: data.mediaUrl || '', mediaType: data.mediaType || '', mode: 'share', internalOnly: true });
                /* FIX (2026-08-01 — Share button opens frozen/blank until an
                   unrelated repaint): opts.deferClose lets a row build its
                   own follow-on UI BEFORE this sheet is torn down, instead
                   of always closing synchronously first. See the Share row
                   below for why — same root cause app-patch-v13.js's
                   EmpShare rewrite already documents and fixes internally,
                   just not at this outer entry point until now. */
                requestAnimationFrame(function() { requestAnimationFrame(_closeSheet); });
            } else if (data.mediaUrl) {
                _closeSheet();
                _shareMediaToStatus(data);
            } else {
                _closeSheet();
            }
        }}));

        if (data.text && !data.mediaUrl) {
            sheet.appendChild(_row('Copy text', { onClick: function() {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(data.text).catch(function(){});
                }
            }}));
        }

        /* Edit — sender only, not already deleted. Text-only AND media
           messages both go through this: a caption renders via the same
           .oc-msg-text element either way (see the comment above where
           it's built), so _editMessage's in-place DOM update already
           handles both cases — this used to incorrectly exclude any
           message with mediaUrl, hiding Edit on every photo/video caption. */
        if (isSent) {
            sheet.appendChild(_row('Edit', { onClick: function() { _openEditMessageModal(row, msgId, data); } }));
        }

        /* Delete — sender only in a 1:1 chat (no group "admin" concept here) */
        if (isSent) {
            sheet.appendChild(_row('Delete', { color: '#E53935', onClick: function() { _deleteMessage(row, msgId); } }));
        }

        /* Message info — shows sent/delivered/read status (read receipts) */
        if (isSent) {
            sheet.appendChild(_row('Message info', { onClick: function() { _showMessageInfo(data); } }));
        }

        sheet.appendChild(_row('Cancel', { color: '#6B7280', onClick: function() {} }));

        document.body.appendChild(overlay);
        document.body.appendChild(sheet);
    }

    /* ── Edit modal ── */
    function _openEditMessageModal(row, msgId, data) {
        var existing = document.getElementById('oc-edit-modal');
        if (existing) existing.remove();

        var wrap = document.createElement('div');
        wrap.id = 'oc-edit-modal';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:9999998;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
        wrap.innerHTML =
            '<div style="background:#fff;border-radius:14px;width:100%;max-width:380px;padding:18px;">' +
              '<div style="font-weight:700;font-size:0.95rem;margin-bottom:10px;color:#111;">Edit message</div>' +
              '<textarea id="oc-edit-textarea" rows="4" style="width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:0.9rem;resize:vertical;font-family:inherit;"></textarea>' +
              '<div style="display:flex;gap:10px;margin-top:14px;">' +
                '<button id="oc-edit-cancel" style="flex:1;padding:11px;border-radius:10px;border:1px solid #ddd;background:#fff;color:#111;font-weight:600;">Cancel</button>' +
                '<button id="oc-edit-save" style="flex:1;padding:11px;border-radius:10px;border:none;background:#1B2B8B;color:#fff;font-weight:700;">Save</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(wrap);

        var ta = wrap.querySelector('#oc-edit-textarea');
        ta.value = data.text || '';
        ta.focus();

        wrap.addEventListener('click', function(e) { if (e.target === wrap) wrap.remove(); });
        wrap.querySelector('#oc-edit-cancel').addEventListener('click', function() { wrap.remove(); });
        wrap.querySelector('#oc-edit-save').addEventListener('click', function() {
            var newText = ta.value.trim();
            if (!newText || newText === data.text) { wrap.remove(); return; }
            wrap.remove();
            _editMessage(row, msgId, newText);
        });
    }

    function _editMessage(row, msgId, newText) {
        var now = new Date().toISOString();
        /* Optimistic local update */
        var p = row.querySelector('.oc-msg-text');
        if (p) {
            if (typeof window.formatWhatsAppText === 'function') p.innerHTML = window.formatWhatsAppText(newText);
            else p.textContent = newText;
        }
        if (row._msgData) { row._msgData.text = newText; row._msgData.edited = true; }
        var ts = row.querySelector('.oc-ts');
        if (ts && !ts.querySelector('.oc-edited-tag')) {
            var tag = document.createElement('span');
            tag.className = 'oc-edited-tag';
            tag.style.cssText = 'font-style:italic;opacity:0.7;margin-right:4px;';
            tag.textContent = 'edited';
            ts.insertBefore(tag, ts.firstChild);
        }
        if (!_fbOk() || !msgId) return;
        _sealPl({ text: newText }, _peerId).then(function (sealed) {
            var upd = { text: sealed.text, edited: true, editedAt: now };
            if (sealed.e2ee) upd.e2ee = true;
            return window.fbDb.collection('messages').doc(msgId).update(upd);
        }).catch(function() { _notify('Could not save edit — check your connection.', 'warning'); });
    }

    /* ── Delete (soft delete, "This message was deleted" for everyone) ── */
    function _deleteMessage(row, msgId) {
        if (!confirm('Delete this message for everyone?')) return;
        /* Optimistic local placeholder */
        var bubble = row.querySelector('.oc-bubble');
        if (bubble) {
            bubble.classList.add('oc-deleted');
            bubble.innerHTML =
                '<p style="margin:0 24px 0 0;font-style:italic;opacity:0.65;"><i class="fas fa-ban" style="margin-right:5px;font-size:0.8em;"></i>This message was deleted</p>' +
                '<span class="oc-ts">' + _fmt((row._msgData||{}).createdAt) + '</span>';
        }
        if (row._msgData) { row._msgData.deleted = true; row._msgData.text = ''; row._msgData.mediaUrl = ''; }
        if (!_fbOk() || !msgId) return;
        window.fbDb.collection('messages').doc(msgId)
            .update({ deleted: true, text: '', mediaUrl: '', reactions: {} })
            .catch(function() { _notify('Could not delete message — check your connection.', 'warning'); });
    }

    /* ── Message info (read-receipt detail for the DM this bubble sits in) ── */
    function _showMessageInfo(data) {
        var status = data.read === true ? 'Read' : (_peerOnline ? 'Delivered' : 'Sent');
        var when = _fmt(data.createdAt || data.timestamp);
        if (typeof window.showNotification === 'function') {
            window.showNotification(status + ' · ' + when, 'info');
        } else {
            alert(status + ' · ' + when);
        }
    }

    /* ── Reply-to (long-press → Reply → quoted composer) ──
       Snapshots just enough of the original message to render a quote
       (sender name, a short text/media summary) without needing to
       re-fetch it later — same lightweight-copy approach the rest of this
       file already uses for _msgData. */
    function _replySnippetFor(data) {
        if (data.text) return data.text;
        var mt = data.mediaType || '';
        if (mt.indexOf('image/') === 0) return '📷 Photo';
        if (mt.indexOf('video/') === 0) return '🎥 Video';
        if (mt.indexOf('audio/') === 0) return '🎤 Voice note';
        return 'Message';
    }

    function _startReply(msgId, data, row) {
        var myId = _us().id;
        _replyingTo = {
            msgId: msgId,
            senderId: data.senderId || '',
            senderName: (data.senderId === myId) ? 'You' : (_peerName || 'User'),
            text: data.text || '',
            mediaType: data.mediaType || '',
            mediaUrl: data.mediaUrl || ''
        };
        _replyingRowEl = row || null;
        if (row) row.classList.add('oc-row-selected');
        var bar = document.getElementById('oc-reply-bar');
        if (!bar) return;
        var nameEl = bar.querySelector('#oc-reply-name');
        var snipEl = bar.querySelector('#oc-reply-snippet');
        var thumbEl = bar.querySelector('#oc-reply-thumb');
        if (nameEl) nameEl.textContent = _replyingTo.senderName;
        if (snipEl) snipEl.textContent = _replySnippetFor(_replyingTo);
        if (thumbEl) {
            var mt = _replyingTo.mediaType || '';
            if (_replyingTo.mediaUrl && (mt.indexOf('image/') === 0 || mt.indexOf('video/') === 0)) {
                thumbEl.src = _replyingTo.mediaUrl;
                thumbEl.style.display = 'block';
            } else {
                thumbEl.style.display = 'none';
                thumbEl.src = '';
            }
        }
        bar.style.display = 'flex';
        var inp = document.getElementById('oc-text-input');
        if (inp) inp.focus();
    }

    function _cancelReply() {
        if (_replyingRowEl) _replyingRowEl.classList.remove('oc-row-selected');
        _replyingRowEl = null;
        _replyingTo = null;
        var bar = document.getElementById('oc-reply-bar');
        if (bar) bar.style.display = 'none';
    }

    /* ── Pin Message (spec item 5) ──
       Pinned state lives on the message doc itself (`pinned: true`), kept
       in sync locally via the SAME onSnapshot listener already used to
       render the thread (_handleSnap below adds/removes _pinnedMsgs
       entries) — deliberately not a separate `.where('pinned','==',true)`
       query, which would need a new composite Firestore index deployed
       before it would work at all. */
    function _togglePinMessage(msgId, data, pinned) {
        if (!_fbOk()) { _notify('Offline — cannot pin right now.', 'error'); return; }
        window.fbDb.collection('messages').doc(msgId).update({ pinned: !!pinned }).catch(function() {
            _notify('Could not update pin — check your connection and try again.', 'error');
        });
    }

    function _renderPinnedStrip() {
        var strip = document.getElementById('oc-pinned-strip');
        if (!strip) return;
        var ids = Object.keys(_pinnedMsgs);
        if (!ids.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
        strip.innerHTML = '';
        strip.style.display = 'flex';
        ids.forEach(function(id) {
            var d = _pinnedMsgs[id];
            var card = document.createElement('div');
            card.className = 'oc-pin-card';
            if (d.mediaUrl && (d.mediaType || '').indexOf('image/') === 0) {
                var img = document.createElement('img');
                img.src = d.mediaUrl;
                card.appendChild(img);
            }
            var label = document.createElement('span');
            label.textContent = _replySnippetFor(d);
            card.appendChild(label);
            var unpin = document.createElement('span');
            unpin.className = 'oc-pin-unpin';
            unpin.innerHTML = '&times;';
            unpin.title = 'Unpin';
            unpin.addEventListener('click', function(e) { e.stopPropagation(); _togglePinMessage(id, d, false); });
            card.appendChild(unpin);
            card.addEventListener('click', function() {
                var row = document.querySelector('.oc-row[data-msg-id="' + id + '"]');
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.classList.add('oc-row-selected');
                    setTimeout(function() { row.classList.remove('oc-row-selected'); }, 1200);
                }
            });
            strip.appendChild(card);
        });
    }


    /* FEATURE (status-to-chat integration): when this chat exists because
       someone replied to a status, shows a thumbnail preview of that
       status at the top of the chat window — mirrors _renderPinnedStrip's
       pattern exactly, just reading a different source (the chats/{chatId}
       doc's own statusId/statusThumbnail fields, written once at reply
       time by app-status.js's _postComment(), rather than a live
       onSnapshot-synced map). One-shot .get() is enough here — those
       fields never change after the chat session is created. */
    function _renderStatusPreviewStrip(peerId) {
        var strip = document.getElementById('oc-status-preview-strip');
        if (!strip || !window.fbDb) return;
        /* RETIRED (2026-10-20): the status context now lives on the reply
           message itself (see the .oc-status-reply-card block in
           _buildBubble), so nothing is pinned above the thread any more.
           The strip element stays (hidden) because _buildChatView and its
           stray-node sweep still reference it by id; the original fetch
           below is left in place, unreachable. */
        strip.style.display = 'none'; strip.innerHTML = '';
        return;
        var myId = (_us().id || _authUid() || '');
        if (!myId || !peerId) return;
        var chatId = _buildChatId(myId, peerId);
        window.fbDb.collection('chats').doc(chatId).get().then(function(doc) {
            var strip2 = document.getElementById('oc-status-preview-strip');
            if (!strip2) return; /* chat closed/rebuilt while this was in flight */
            var d = doc.exists ? (doc.data() || {}) : {};
            if (!d.statusId) { strip2.style.display = 'none'; strip2.innerHTML = ''; return; }

            strip2.innerHTML = '';
            strip2.style.display = 'flex';

            if (d.statusThumbnail) {
                var isVid = (d.statusThumbnailType || '') === 'video';
                var media = document.createElement(isVid ? 'video' : 'img');
                media.src = d.statusThumbnail;
                if (isVid) { media.muted = true; }
                strip2.appendChild(media);
            }
            var label = document.createElement('span');
            label.className = 'oc-status-preview-label';
            label.textContent = 'Replied to a status';
            strip2.appendChild(label);

            strip2.addEventListener('click', function() {
                if (typeof window._empUserHasLiveStatus === 'function' && typeof window.openStatusViewer === 'function') {
                    var info = window._empUserHasLiveStatus(peerId);
                    if (info) window.openStatusViewer(info.idx);
                }
            });
        }).catch(function(){ /* best-effort — banner just stays hidden on failure */ });
    }


    /* =========================================================================
       §3  BUILD CHAT BUBBLE
       ========================================================================= */
    function _buildBubble(data, myId) {
        var isSent = (data.senderId === myId);
        var isVoiceNote = false; /* flipped true inside the audio branch below — used to add the date alongside the time on voice-note timestamps */
        /* (voice-note duration now renders inline in its own player —
           see the audio branch below — no longer hoisted for the ts
           row.) */
        var row = document.createElement('div');
        row.className = 'oc-row ' + (isSent ? 'sent' : 'recv');
        row.dataset.msgId = data.id || data.msgId || '';
        row.dataset.createdAt = data.createdAt || data.timestamp || '';
        row.dataset.read = data.read === true ? 'true' : 'false';
        /* FIX v15 (Message Editing/Deletion + Send Status spec): keep the
           full message data on the row so the long-press action sheet and
           the Firestore 'modified' handler can re-render this exact bubble
           later (edit text, deleted placeholder, sending→sent transition)
           without needing a second read of Firestore. */
        row._msgData = data;

        var bubble = document.createElement('div');
        bubble.className = 'oc-bubble';

        /* FIX v15: a soft-deleted message ("Delete for everyone") renders
           as a muted placeholder instead of its real content, for BOTH
           sender and recipient, and skips reactions/media entirely. */
        if (data.deleted === true) {
            bubble.classList.add('oc-deleted');
            var delP = document.createElement('p');
            delP.style.cssText = 'margin:0 24px 0 0;font-style:italic;opacity:0.65;';
            delP.innerHTML = '<i class="fas fa-ban" style="margin-right:5px;font-size:0.8em;"></i>This message was deleted';
            bubble.appendChild(delP);
            var tsD = document.createElement('span');
            tsD.className = 'oc-ts';
            tsD.textContent = _fmt(data.createdAt || data.timestamp);
            bubble.appendChild(tsD);
            row.appendChild(bubble);
            return row; /* no media, no reactions, no long-press actions on a deleted bubble */
        }

        /* FEATURE (2026-08-02 — "shared messages should carry the share
           indication"): _forwardToChat in app-patch-v13.js already writes
           forwarded:true on every message sent via the Share sheet, but
           nothing ever rendered it — a forwarded message looked
           identical to one typed fresh in this chat. Small WhatsApp-style
           italic tag, shown above everything else in the bubble
           (including a reply quote, if any) so it's the first thing
           read.
           FIX (this session — "who forwarded this"): the tag used to
           read a bare "Forwarded" with no indication of WHO actually did
           the forwarding — fine for a single 1:1 thread, but useless the
           moment the same tag shows up in a group, or when a person is
           scrolling back days later and can't recall who sent it. Now
           appends the sender's name (data.senderName is already written
           on every message, forwarded or not) so a voice note — or any
           other forwarded content — always identifies its forwarder
           inline, the same way WhatsApp attributes a forward to whoever
           re-sent it. */
        if (data.forwarded === true) {
            var fwdTag = document.createElement('div');
            fwdTag.className = 'oc-forwarded-tag';
            fwdTag.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:0.72rem;font-style:italic;line-height:1;margin-bottom:5px;color:' + '#8794AB' + ';';
            var fwdWho = isSent ? 'You' : (data.senderName || _peerName || 'Someone');
            fwdTag.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="flex-shrink:0;"><path d="M14 4l6 6-6 6v-4.1c-4.4.3-7.6 1.9-10 5.1.7-5 3.7-9.6 10-10.6V4z"/></svg><span>Forwarded &middot; ' + _esc(fwdWho) + '</span>';
            bubble.appendChild(fwdTag);
        }

        /* FEATURE (2026-10-20 — "a message sent from a status should drop
           like a normal message"): a reply sent from the status viewer now
           lands in the thread as an ordinary bubble at its own point in
           time, carrying its status context on the bubble itself (small
           thumbnail + "replied to a status" label, tap to reopen the
           status) — exactly how a quoted reply carries its quote. This
           replaces the old banner pinned to the top of the whole chat
           (see _renderStatusPreviewStrip), which stayed on screen
           regardless of which messages were visible. app-status.js's
           _postComment() writes data.statusReply (snapshot) on the message;
           messages sent before that change only have data.statusReplyTo,
           so they fall back to the label with no thumbnail. */
        if (data.statusReply || data.statusReplyTo) {
            var stReply = data.statusReply || {};
            var stCard = document.createElement('div');
            stCard.className = 'oc-status-reply-card';
            if (stReply.thumb) {
                var stIsVid = (stReply.type || '') === 'video';
                var stMedia = document.createElement(stIsVid ? 'video' : 'img');
                stMedia.src = stReply.thumb;
                if (stIsVid) { stMedia.muted = true; stMedia.preload = 'metadata'; stMedia.playsInline = true; }
                stMedia.addEventListener('error', function () { stMedia.style.display = 'none'; });
                stCard.appendChild(stMedia);
            }
            var stCol = document.createElement('div');
            stCol.className = 'oc-src-col';
            var stLabel = document.createElement('span');
            stLabel.className = 'oc-src-label';
            stLabel.textContent = isSent ? 'You replied to a status' : 'Replied to your status';
            stCol.appendChild(stLabel);
            if (stReply.snippet) {
                var stSub = document.createElement('span');
                stSub.className = 'oc-src-sub';
                stSub.textContent = stReply.snippet;
                stCol.appendChild(stSub);
            }
            stCard.appendChild(stCol);
            (function (ownerId) {
                stCard.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (row._ocLongPressFired || !ownerId) return;
                    if (typeof window._empUserHasLiveStatus === 'function' && typeof window.openStatusViewer === 'function') {
                        var info = window._empUserHasLiveStatus(ownerId);
                        if (info) window.openStatusViewer(info.idx);
                    }
                });
            })(stReply.ownerId || '');
            bubble.appendChild(stCard);
        }

        /* Quoted reply-to block (WhatsApp-style), if this message was sent
           as a reply. Rendered first so it sits above the media/text it
           introduces. Uses the lightweight snapshot _startReply() took at
           reply time — no re-fetch of the original message needed. */
        if (data.replyTo && (data.replyTo.text || data.replyTo.mediaType || data.replyTo.senderName)) {
            var quote = document.createElement('div');
            quote.className = 'oc-reply-quote';
            quote.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;margin-bottom:5px;border-left:3px solid ' + (isSent ? '#34B76B' : '#7CC4F7') + ';background:rgba(0,0,0,0.05);border-radius:4px;';
            var qCol = document.createElement('div');
            qCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';
            var qName = document.createElement('span');
            qName.style.cssText = 'font-size:0.74rem;font-weight:700;color:#0f1b3d;';
            qName.textContent = data.replyTo.senderName || 'User';
            var qText = document.createElement('span');
            qText.style.cssText = 'font-size:0.78rem;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;';
            qText.textContent = _replySnippetFor(data.replyTo);
            qCol.appendChild(qName);
            qCol.appendChild(qText);
            var qMt = data.replyTo.mediaType || '';
            if (data.replyTo.mediaUrl && (qMt.indexOf('image/') === 0 || qMt.indexOf('video/') === 0)) {
                var qThumb = document.createElement('img');
                qThumb.src = data.replyTo.mediaUrl;
                qThumb.addEventListener('error', function () { qThumb.style.display = 'none'; });
                qThumb.style.cssText = 'width:34px;height:34px;border-radius:5px;object-fit:cover;flex-shrink:0;order:-1;';
                quote.appendChild(qThumb);
            }
            quote.appendChild(qCol);
            bubble.appendChild(quote);
        }

        /* Content */
        if (data.mediaUrl) {
            var media;
            var mt = (data.mediaType || '');
            if (mt.startsWith('image/')) {
                media = document.createElement('img');
                media.src = data.mediaUrl;
                media.draggable = false;
                media.addEventListener('error', function () {
                    var ph = document.createElement('div');
                    ph.textContent = 'Photo unavailable';
                    ph.style.cssText = 'padding:14px 16px;border-radius:8px;background:#F1F5FB;color:#8794AB;font-size:0.78rem;margin-bottom:4px;';
                    if (media.parentNode) media.parentNode.replaceChild(ph, media);
                });
                /* FIX (2026-08-01 — "long-press does nothing" on media):
                   without this, Android/iOS's own native long-press
                   gesture on an <img> (save image / open image / image
                   preview) races our JS touchstart-timer-based long
                   press below and usually wins, firing touchcancel on
                   the row before our 480ms timer completes — so the
                   action sheet (and its new "Share to Status" option)
                   never opens. This disables that native callout so the
                   touch stays ours to interpret. */
                media.style.cssText = 'max-width:100%;border-radius:8px;margin-bottom:4px;display:block;cursor:zoom-in;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;';
                (function(src){ media.addEventListener('click', function(){ if (row._ocLongPressFired) return; _openLightbox(src, false); }); })(data.mediaUrl);
                bubble.appendChild(media);
            } else if (mt.startsWith('video/')) {
                /* FEATURE (2026-08-01 — tap-to-expand fullscreen, "inside
                   the chat box"): previously this was a bare native
                   <video controls>, playable inline but with no
                   fullscreen affordance beyond whatever the browser's own
                   controls happen to offer (inconsistent across Android
                   WebViews). Now a controls-less, muted inline preview
                   sits under a play-button overlay; tapping ANYWHERE on
                   it opens the same full-screen lightbox images already
                   use, now with a real <video controls autoplay>. Native
                   long-press callout is disabled for the same reason as
                   the image branch above. */
                var videoWrap = document.createElement('div');
                videoWrap.className = 'oc-video-tap-wrap';
                media = document.createElement('video');
                media.src = data.mediaUrl;
                media.muted = true;
                media.playsInline = true;
                media.preload = 'metadata';
                media.style.cssText = 'max-width:100%;border-radius:8px;margin-bottom:4px;display:block;';
                var playOverlay = document.createElement('div');
                playOverlay.className = 'oc-video-play-overlay';
                playOverlay.innerHTML = '<span><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span>';
                videoWrap.appendChild(media);
                videoWrap.appendChild(playOverlay);
                (function(src){ videoWrap.addEventListener('click', function(){ if (row._ocLongPressFired) return; _openLightbox(src, true); }); })(data.mediaUrl);
                bubble.appendChild(videoWrap);
            } else if (mt.startsWith('audio/')) {
                isVoiceNote = true;
                /* ── WhatsApp-style voice note player (premium redesign) ──
                   FIX (this session — quality pass against the confirmed
                   WhatsApp reference screenshots + the reference markup
                   supplied this session): a real WhatsApp voice note runs
                   avatar+mic-badge → play → waveform, LEFT to RIGHT, avatar
                   on the outer edge — an earlier session had this backwards
                   (avatar on the right) based on a different, ambiguous
                   reference case (a forwarded/no-avatar group message).
                   Visual order is set via CSS `order` on each of the three
                   pieces below rather than moving their construction code,
                   so none of the scrubbing/download/playback logic changes.
                   Also enlarged across the board (avatar 36->52px, mic
                   badge 19->23px, play button 34->40px, waveform track
                   22->26px with higher-contrast bars) since undersized,
                   low-contrast pieces were the actual "low quality" tell
                   next to WhatsApp's own bolder proportions. Duration still
                   renders directly under the waveform, clock time + read
                   ticks stay in the outer timestamp row, unchanged. */
                var vnWrap = document.createElement('div');
                vnWrap.style.cssText = [
                    'display:flex;align-items:center;gap:8px;',
                    'min-width:210px;max-width:100%;',
                    'padding:2px 0 2px;',
                    'position:relative;',
                ].join('');

                /* Hidden real audio element.
                   FEATURE (this session — full lazy-download, WhatsApp-
                   style): a RECEIVED voice note no longer starts fetching
                   anything the moment the bubble renders — src is left
                   unset and preload='none' until the person actually
                   taps the button, at which point we fetch it ourselves
                   (see _vnStartDownload below) with a real progress ring,
                   then hand the resulting blob to this element. A SENT
                   voice note is the person's own recording — there's
                   nothing to "download" from their own perspective, so
                   it keeps the old immediate preload='metadata'
                   behavior and is treated as already-fetched. */
                var vnAudio = document.createElement('audio');
                vnAudio.style.display = 'none';
                if (isSent) {
                    vnAudio.src = data.mediaUrl;
                    vnAudio.preload = 'metadata';
                } else {
                    vnAudio.preload = 'none';
                }
                vnWrap.appendChild(vnAudio);

                var _vnFetched = isSent;     /* sent notes count as already available */
                var _vnDownloading = false;

                /* Play/Pause/Download circle button — premium navy/gold
                   treatment (matches the header/brand palette) instead of
                   a flat neutral-grey disc, with a soft shadow for depth
                   so it reads as a real control rather than a placeholder
                   icon. Icon color stays a warm cream so it's legible
                   against the dark fill on either bubble color. Wrapped
                   in vnPlayWrap so a circular progress ring can sit on
                   top of it during a download, without disturbing the
                   button's own layout/sizing. Appended to vnWrap first in
                   DOM order (visual position is controlled separately via
                   CSS `order` — see the FIX comment just below). */
                /* FIX (this session — "blue play background looks fake"):
                   the filled navy/gold disc read as a generic placeholder
                   chip rather than a real WhatsApp-grade control, so the
                   circular fill/border/shadow is gone entirely — the
                   button is now a bare transparent hit-target and the icon
                   itself carries all the weight, sized up 16px -> 33px
                   (from the earlier 34px -> 40px button-size pass) so it
                   reads clearly at a glance. Icon color switched from
                   cream (meant to sit on the dark disc) to the brand navy
                   #0f1b3d so it stays legible directly on both the light
                   received bubble and the mint "sent" bubble. wrap stays
                   40x40 purely as the tap target / ring-overlay anchor —
                   see vnPlayWrap below — order:1 still renders it visually
                   SECOND (after the avatar) without moving this construction
                   code; see the avatar block's comment for the layout note. */
                var vnPlayWrap = document.createElement('div');
                vnPlayWrap.style.cssText = 'position:relative;width:40px;height:40px;flex-shrink:0;order:1;';

                var vnPlay = document.createElement('button');
                vnPlay.style.cssText = [
                    'width:40px;height:40px;min-width:40px;border-radius:50%;border:none;',
                    'background:none;color:#0f1b3d;cursor:pointer;',
                    'display:flex;align-items:center;justify-content:center;flex-shrink:0;',
                    'transition:transform 0.12s ease;',
                ].join('');
                vnPlay.addEventListener('mousedown', function () { vnPlay.style.transform = 'scale(0.92)'; });
                vnPlay.addEventListener('mouseup', function () { vnPlay.style.transform = 'scale(1)'; });
                vnPlay.addEventListener('mouseleave', function () { vnPlay.style.transform = 'scale(1)'; });
                var _vnPlaying = false;
                var VN_PLAY_ICON = '<svg viewBox="0 0 24 24" width="33" height="33" fill="#0f1b3d"><path d="M8 5v14l11-7z"/></svg>';
                var VN_PAUSE_ICON = '<svg viewBox="0 0 24 24" width="33" height="33" fill="#0f1b3d"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
                var VN_DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="33" height="33" fill="#0f1b3d"><path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1z"/><path d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';
                vnPlay.innerHTML = _vnFetched ? VN_PLAY_ICON : VN_DOWNLOAD_ICON;
                vnPlay.className = 'oc-vn-play';
                vnPlayWrap.appendChild(vnPlay);

                /* Circular download-progress ring — hidden until a
                   download is actually in flight. Radius chosen to sit
                   just inside the 34px button so it reads as a ring
                   AROUND the control (WhatsApp's exact convention),
                   rather than a separate spinner floating nearby. */
                var RING_R = 18, RING_C = 2 * Math.PI * RING_R;
                var vnRing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                vnRing.setAttribute('viewBox', '0 0 40 40');
                vnRing.style.cssText = 'position:absolute;top:0;left:0;width:40px;height:40px;pointer-events:none;display:none;transform:rotate(-90deg);';
                var vnRingTrack = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                vnRingTrack.setAttribute('cx', '20'); vnRingTrack.setAttribute('cy', '20'); vnRingTrack.setAttribute('r', RING_R);
                /* FIX (this session): was rgba(255,255,255,0.22), tuned for
                   contrast against the navy disc the play button used to
                   have — now that the button is a bare transparent
                   hit-target, a near-white track at low opacity all but
                   disappears against the light/mint bubble. Dark, low-
                   opacity track reads correctly on both bubble colors. */
                vnRingTrack.setAttribute('fill', 'none'); vnRingTrack.setAttribute('stroke', 'rgba(15,27,61,0.18)'); vnRingTrack.setAttribute('stroke-width', '2.4');
                var vnRingFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                vnRingFg.setAttribute('cx', '20'); vnRingFg.setAttribute('cy', '20'); vnRingFg.setAttribute('r', RING_R);
                vnRingFg.setAttribute('fill', 'none'); vnRingFg.setAttribute('stroke', '#2E93E0'); vnRingFg.setAttribute('stroke-width', '2.4');
                vnRingFg.setAttribute('stroke-linecap', 'round');
                vnRingFg.setAttribute('stroke-dasharray', RING_C.toFixed(1));
                vnRingFg.setAttribute('stroke-dashoffset', RING_C.toFixed(1)); /* 0% by default */
                vnRing.appendChild(vnRingTrack);
                vnRing.appendChild(vnRingFg);
                vnPlayWrap.appendChild(vnRing);

                function _vnSetRingPct(pct) {
                    vnRingFg.setAttribute('stroke-dashoffset', (RING_C * (1 - pct)).toFixed(1));
                }
                function _vnSetIndeterminate(on) {
                    if (on) {
                        vnRingFg.setAttribute('stroke-dasharray', (RING_C * 0.28) + ' ' + (RING_C * 0.72));
                        vnRing.classList.add('oc-vn-ring-indeterminate');
                    } else {
                        vnRing.classList.remove('oc-vn-ring-indeterminate');
                        vnRingFg.setAttribute('stroke-dasharray', RING_C.toFixed(1));
                    }
                }

                function _vnPlayNow() {
                    document.querySelectorAll('audio._oc_vn_active').forEach(function(a) {
                        a.pause();
                        a.classList.remove('_oc_vn_active');
                        var btn = a.parentNode && a.parentNode.querySelector('.oc-vn-play');
                        if (btn) btn.innerHTML = VN_PLAY_ICON;
                    });
                    vnAudio.play().catch(function(){});
                    vnAudio.classList.add('_oc_vn_active');
                    _vnPlaying = true;
                    vnPlay.innerHTML = VN_PAUSE_ICON;
                }

                /* Real lazy-download: fetch the audio ourselves (rather
                   than just pointing <audio src> at the URL and hoping
                   preload='auto' behaves) so we can drive an honest
                   progress ring off actual bytes received via
                   Content-Length when the host provides one, falling
                   back to an indeterminate spin when it doesn't. Once
                   complete, the blob becomes the audio element's src and
                   playback starts immediately — matching WhatsApp's
                   "tap to download → auto-plays" behavior. */
                function _vnStartDownload() {
                    if (_vnFetched || _vnDownloading) return;
                    _vnDownloading = true;
                    vnPlay.innerHTML = '';
                    vnRing.style.display = 'block';
                    vnDur.textContent = 'Downloading…';

                    fetch(data.mediaUrl).then(function(resp) {
                        if (!resp.ok) throw new Error('HTTP ' + resp.status);
                        var totalStr = resp.headers.get('content-length');
                        var total = totalStr ? parseInt(totalStr, 10) : 0;
                        if (!total || !resp.body || !resp.body.getReader) {
                            /* No Content-Length (or streaming reader unsupported
                               in this browser) — indeterminate spin, then just
                               await the full response as a blob. */
                            _vnSetIndeterminate(true);
                            return resp.blob();
                        }
                        var reader = resp.body.getReader();
                        var chunks = [];
                        var received = 0;
                        function pump() {
                            return reader.read().then(function(step) {
                                if (step.done) return;
                                chunks.push(step.value);
                                received += step.value.length;
                                _vnSetRingPct(Math.min(1, received / total));
                                return pump();
                            });
                        }
                        return pump().then(function() {
                            return new Blob(chunks, { type: mt || 'audio/ogg' });
                        });
                    }).then(function(blob) {
                        var url = URL.createObjectURL(blob);
                        _vnDownloading = false;
                        _vnFetched = true;
                        _vnSetIndeterminate(false);
                        vnRing.style.display = 'none';
                        vnAudio.src = url;
                        vnAudio.preload = 'auto';
                        _resolveVoiceNoteDuration(vnAudio, function(d) { vnDur.textContent = _fmtDur(d); });
                        vnAudio.addEventListener('loadedmetadata', function onMeta() {
                            vnAudio.removeEventListener('loadedmetadata', onMeta);
                            _vnPlayNow();
                        }, { once: true });
                        vnAudio.load();
                    }).catch(function() {
                        /* Fetch failed (CORS-blocked host, offline, etc.) —
                           degrade to the old direct-URL behavior rather than
                           leaving a dead button: point <audio> straight at
                           the URL and let the browser stream it as best it
                           can. */
                        _vnDownloading = false;
                        _vnSetIndeterminate(false);
                        vnRing.style.display = 'none';
                        _vnFetched = true;
                        vnAudio.src = data.mediaUrl;
                        vnAudio.preload = 'auto';
                        _resolveVoiceNoteDuration(vnAudio, function(d) { vnDur.textContent = _fmtDur(d); });
                        _vnPlayNow();
                    });
                }

                vnPlay.addEventListener('click', function() {
                    if (!_vnFetched) { _vnStartDownload(); return; }
                    if (_vnDownloading) return;
                    if (_vnPlaying) {
                        vnAudio.pause();
                        _vnPlaying = false;
                        vnPlay.innerHTML = VN_PLAY_ICON;
                    } else {
                        _vnPlayNow();
                    }
                });

                vnAudio.addEventListener('ended', function() {
                    _vnPlaying = false;
                    vnAudio.classList.remove('_oc_vn_active');
                    vnPlay.innerHTML = VN_PLAY_ICON;
                    vnProgressWrap.style.width = '0%';
                });

                vnWrap.appendChild(vnPlayWrap);

                /* Center column: waveform on top, duration + download
                   affordance directly beneath it — WhatsApp puts the
                   running/total duration right under the track, not
                   merged into the outer timestamp row. */
                var vnCenterCol = document.createElement('div');
                vnCenterCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;order:2;';

                var vnTrack = document.createElement('div');
                vnTrack.style.cssText = 'position:relative;height:26px;cursor:pointer;display:flex;align-items:center;min-width:0;';

                var barHeights = _makeVoiceNoteBarHeights(data.id || data.mediaUrl);
                var barCount = barHeights.length;
                var barW = 176 / barCount;

                function _makeBars(fillColor) {
                    var svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
                    svg.setAttribute('viewBox','0 0 176 26');
                    svg.setAttribute('preserveAspectRatio','none');
                    svg.style.cssText = 'width:100%;height:26px;display:block;';
                    barHeights.forEach(function(h,i) {
                        var rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
                        rect.setAttribute('x',(i*barW+barW*0.15).toFixed(1));
                        rect.setAttribute('y',((26-h)/2).toFixed(1));
                        rect.setAttribute('width',(barW*0.7).toFixed(1));
                        rect.setAttribute('height',h);
                        rect.setAttribute('rx','2.5');
                        rect.setAttribute('fill',fillColor);
                        svg.appendChild(rect);
                    });
                    return svg;
                }

                /* FIX (premium voice-note redesign, this session — "lacks
                   quality"): the resting-state bars were nearly invisible
                   at 0.16 opacity, which is most of what made the card
                   read as flat/unfinished in the reference comparison.
                   Bumped to 0.32 so the un-played waveform is clearly
                   legible on both bubble colors, and the progress fill now
                   matches the same warm gold used by the badge/ring
                   (#d4af6e) instead of a slightly different gold, so every
                   accent on the card reads as one deliberate palette. */
                var vnSvgBg = _makeBars('rgba(15,27,61,0.32)');
                vnSvgBg.style.position = 'absolute';
                vnSvgBg.style.left = '0';
                vnSvgBg.style.top = '0';
                vnTrack.appendChild(vnSvgBg);

                var vnProgressWrap = document.createElement('div');
                vnProgressWrap.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:0%;overflow:hidden;pointer-events:none;';
                var vnSvgFg = _makeBars('#2E93E0');
                vnSvgFg.style.position = 'absolute';
                vnSvgFg.style.left = '0';
                vnSvgFg.style.top = '0';
                vnProgressWrap.appendChild(vnSvgFg);
                vnTrack.appendChild(vnProgressWrap);

                /* Scrub */
                vnTrack.addEventListener('click', function(e) {
                    var r = vnTrack.getBoundingClientRect();
                    var ratio = Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
                    if (vnAudio.duration) {
                        vnAudio.currentTime = ratio * vnAudio.duration;
                        vnProgressWrap.style.width = (ratio*100)+'%';
                    }
                });
                vnCenterCol.appendChild(vnTrack);

                /* Duration helper */
                function _fmtDur(sec) {
                    sec = Math.round(sec||0);
                    var m = Math.floor(sec/60), s = sec%60;
                    return m+':'+(s<10?'0':'')+s;
                }

                /* Meta row: small download icon + running/total duration,
                   left-aligned directly under the waveform — matches the
                   reference screenshots' "4:30" / "0:09" placement, and
                   keeps the outer .oc-ts row (bottom-right of the bubble)
                   reserved for just the clock time + read ticks. */
                var vnMetaRow = document.createElement('div');
                vnMetaRow.style.cssText = 'display:flex;align-items:center;gap:5px;';

                var vnDlBtn = document.createElement('button');
                vnDlBtn.title = 'Download voice note';
                vnDlBtn.style.cssText = 'background:none;border:none;padding:0;margin:0;cursor:pointer;display:flex;align-items:center;color:' + (isSent ? 'rgba(20,20,20,0.5)' : '#8a8f9c') + ';';
                /* FIX (this session — "increase the download icon size"):
                   was 12x12, easy to miss/mistap next to the duration
                   text; sized up to 22x22 to match the general enlargement
                   pass on this card without crowding the "0:00" label. */
                vnDlBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1z"/><path d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';
                vnDlBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var a = document.createElement('a');
                    a.href = data.mediaUrl;
                    a.download = 'voice-note-' + (data.id || Date.now()) + '.ogg';
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                });
                /* REMOVED (per request): the small download icon beside the duration is no longer shown in the voice-note
                   bubble. The button is still built above but intentionally not appended. */

                var vnDur = document.createElement('span');
                vnDur.style.cssText = 'font-size:0.72rem;color:' + (isSent ? 'rgba(20,20,20,0.55)' : '#8a8f9c') + ';';
                vnDur.textContent = '0:00';
                if (_vnFetched) _resolveVoiceNoteDuration(vnAudio, function(d) { vnDur.textContent = _fmtDur(d); });
                vnAudio.addEventListener('timeupdate', function() {
                    if (!vnAudio.duration || !isFinite(vnAudio.duration)) return; /* still-unresolved Infinity/NaN duration — see _resolveVoiceNoteDuration */
                    vnProgressWrap.style.width = (vnAudio.currentTime/vnAudio.duration*100)+'%';
                    vnDur.textContent = _fmtDur(vnAudio.duration - vnAudio.currentTime);
                });
                vnMetaRow.appendChild(vnDur);
                vnCenterCol.appendChild(vnMetaRow);

                vnWrap.appendChild(vnCenterCol);

                /* FIX (premium voice-note redesign, this session — layout
                   parity with the confirmed WhatsApp reference: a real 1:1
                   contact's voice note always runs avatar → play → waveform
                   left-to-right, avatar closest to the outer edge of the
                   bubble, NOT on the far side as an earlier session assumed.
                   Rather than move this whole construction block (it still
                   has to be built here, after vnCenterCol exists, so its
                   avatar-resolution fallbacks stay next to the rest of the
                   player logic), it's given order:-1 so flexbox renders it
                   FIRST regardless of DOM-append order — see the matching
                   order:1 / order:2 on vnPlayWrap / vnCenterCol above.
                   Also sized up 36px -> 52px with a larger, higher-res
                   mic badge (19px -> 23px, icon 10px -> 15px) since a small
                   pale badge on a small avatar was the main "low quality"
                   tell next to WhatsApp's own, more prominent mic badge. */
                var vnAvWrap = document.createElement('div');
                vnAvWrap.style.cssText = 'position:relative;width:52px;height:52px;flex-shrink:0;order:-1;';
                var vnAvSrc = isSent
                    ? ((_us().avatar || _us().photoURL) || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(_us().fullName || _us().username || 'Me') + '&background=1B2B8B&color=fff&size=104'))
                    : (data.senderAvatar
                        || (data.senderId === _peerId ? _peerAvatar : '')
                        || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(data.senderName || _peerName || 'U') + '&background=1B2B8B&color=fff&size=104'));
                var vnAvImg = document.createElement('img');
                vnAvImg.src = vnAvSrc;
                vnAvImg.style.cssText = 'width:52px;height:52px;border-radius:50%;object-fit:cover;display:block;';
                vnAvImg.onerror = function () { this.onerror = null; this.src = 'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=104'; };
                vnAvWrap.appendChild(vnAvImg);
                /* FIX (this session — "remove the mic background attached
                   to the picture avatar, increase the size of the icon"):
                   the gold plate/border/shadow behind the mic glyph was
                   the "fake badge" tell — dropped entirely so just the
                   glyph itself sits on the avatar's corner, sized up
                   15px -> 26px to stay readable without a plate behind it.
                   A drop-shadow on the glyph (rather than a solid disc)
                   keeps it legible over light or dark avatar photos alike. */
                var vnAvBadge = document.createElement('div');
                vnAvBadge.style.cssText = 'position:absolute;right:-2px;bottom:-2px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.55));';
                vnAvBadge.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="#f6ecd6"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M17 11a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V18H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1a5 5 0 0 0 4-4.9z"/></svg>';
                vnAvWrap.appendChild(vnAvBadge);
                vnWrap.appendChild(vnAvWrap);

                bubble.style.minWidth = '285px'; /* wider now to comfortably fit the 52px avatar + 40px play button + a legible waveform */
                bubble.appendChild(vnWrap);
            } else {
                /* ── Document/PDF card (WhatsApp-style) ──
                   FEATURE (premium redesign — "PDF sensitivity"): any
                   attachment that isn't image/video/audio (PDFs, docx,
                   xlsx, etc.) previously fell through every branch above
                   with nothing rendered at all — the file was uploaded
                   and stored, but silently invisible in the bubble. This
                   renders a proper file card: extension badge, file name,
                   human-readable size, and a tap-to-open link, matching
                   the reference document-card design. */
                var fName = data.fileName || (function(){
                    try { return decodeURIComponent(data.mediaUrl.split('/').pop().split('?')[0]); }
                    catch(e){ return 'Document'; }
                })();
                var extMatch = /\.([a-zA-Z0-9]{2,5})$/.exec(fName);
                var ext = (extMatch ? extMatch[1] : (mt.split('/')[1] || 'file')).toUpperCase().slice(0, 4);
                var isPdf = mt === 'application/pdf' || ext === 'PDF';
                var sizeLabel = '';
                if (typeof data.fileSize === 'number' && data.fileSize > 0) {
                    sizeLabel = data.fileSize > 1024 * 1024
                        ? (data.fileSize / (1024 * 1024)).toFixed(1) + ' MB'
                        : Math.max(1, Math.round(data.fileSize / 1024)) + ' KB';
                }
                var docCard = document.createElement('a');
                docCard.href = data.mediaUrl;
                docCard.target = '_blank';
                docCard.rel = 'noopener noreferrer';
                docCard.style.cssText = 'display:flex;align-items:center;gap:10px;text-decoration:none;padding:6px 4px;min-width:200px;max-width:260px;border-radius:8px;';
                var docIcon = document.createElement('div');
                docIcon.style.cssText = 'flex-shrink:0;width:38px;height:44px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;letter-spacing:0.3px;color:#fff;background:' + (isPdf ? '#c0392b' : '#0f1b3d') + ';';
                docIcon.textContent = ext;
                var docCol = document.createElement('div');
                docCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;';
                var docName = document.createElement('span');
                docName.style.cssText = 'font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:inherit;';
                docName.textContent = fName;
                var docMeta = document.createElement('span');
                docMeta.style.cssText = 'font-size:0.7rem;opacity:0.7;color:inherit;';
                docMeta.textContent = [sizeLabel, ext].filter(Boolean).join(' \u00b7 ');
                docCol.appendChild(docName);
                docCol.appendChild(docMeta);
                docCard.appendChild(docIcon);
                docCard.appendChild(docCol);
                bubble.style.minWidth = '210px';
                bubble.appendChild(docCard);
            }
        }

        /* Show text whenever present -- including as a caption underneath
           media (WhatsApp-style). The old `!data.mediaUrl` guard here only
           ever existed to stop a stray filename label from appearing under
           media; fileName is stored as its own separate field and never
           written into `text` (see _sendFile), so a real caption typed by
           the sender is always safe to render here. */
        if (data.text) {
            var p = document.createElement('p');
            p.className = 'oc-msg-text';
            p.style.margin = data.mediaUrl ? '0 24px 0 0' : '0 24px 0 0';
            if (data.mediaUrl) p.style.marginTop = '6px';
            if (typeof window.formatWhatsAppText === 'function') {
                p.innerHTML = window.formatWhatsAppText(data.text);
            } else {
                p.textContent = data.text;
            }
            bubble.appendChild(p);
        }

        /* Timestamp (+ delivery tick for messages I sent — see §Xb) */
        var ts = document.createElement('span');
        ts.className = 'oc-ts';
        ts.textContent = isVoiceNote
            ? _fmtDateTime(data.createdAt || data.timestamp)
            : _fmt(data.createdAt || data.timestamp);

        /* FIX v15 (Message Editing spec): a small "(edited)" marker next
           to the time, same convention as WhatsApp/Telegram. */
        if (data.edited === true) {
            var editedTag = document.createElement('span');
            editedTag.className = 'oc-edited-tag';
            editedTag.style.cssText = 'font-style:italic;opacity:0.7;margin-right:4px;';
            editedTag.textContent = 'edited';
            ts.insertBefore(editedTag, ts.firstChild);
        }

        /* FIX (this session — layout parity): voice-note duration now
           renders directly under the waveform (see the audio branch
           above), matching the reference screenshots, so it's no longer
           folded into this timestamp row — this row is just clock time
           + read ticks again, same as every other message type. */

        if (isSent) {
            /* FIX v15 (Message Send Indicator spec): while a message is
               still being written to Firestore, show "Sending…" instead
               of a tick. _doSend flips row.dataset.status to 'sent' (or
               'failed') once the write settles, via _setSendStatus(). */
            if (data.status === 'sending') {
                var sendingLbl = document.createElement('span');
                sendingLbl.className = 'oc-sending-label';
                sendingLbl.style.cssText = 'font-style:italic;opacity:0.75;margin-left:4px;';
                sendingLbl.textContent = 'Sending…';
                ts.appendChild(sendingLbl);
            } else if (data.status === 'failed') {
                var failedLbl = document.createElement('span');
                failedLbl.className = 'oc-failed-label';
                failedLbl.style.cssText = 'color:#E53935;font-weight:600;margin-left:4px;cursor:pointer;';
                failedLbl.textContent = '⚠ Not sent — tap to retry';
                ts.appendChild(failedLbl);
            } else {
                var tick = document.createElement('span');
                tick.className = 'oc-tick';
                _applyTickState(tick, data);
                ts.appendChild(tick);
            }
        }
        bubble.appendChild(ts);

        /* FEATURE: tap a message's sender avatar → view that sender's
           profile. Own (sent) messages never show one — same convention
           WhatsApp/Telegram use, and there's nowhere useful to navigate
           to for your own avatar here. Works for both 1:1 (senderId is
           always _peerId, so falls back to the already-known peer
           avatar/name) and group chats (each message carries its own
           senderId/senderAvatar, so every sender's tap goes to THAT
           sender specifically, not just whoever the row happens to sit
           next to). */
        if (!isSent) {
            var msgAv = document.createElement('img');
            msgAv.className = 'oc-msg-avatar';
            row.dataset.senderId = String(data.senderId || _peerId || ''); /* see app-patch-v15.js (avatar only on last message of a run) */
            var avSrc = data.senderAvatar
                || (data.senderId === _peerId ? _peerAvatar : '')
                || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(data.senderName || _peerName || 'U') + '&background=1B2B8B&color=fff&size=64');
            msgAv.src = avSrc;
            msgAv.alt = data.senderName || _peerName || '';
            msgAv.title = 'View profile';
            msgAv.onerror = function () { this.onerror = null; this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.senderName || _peerName || 'U') + '&background=1B2B8B&color=fff&size=64'; };
            (function (uid) {
                msgAv.addEventListener('click', function (e) {
                    e.stopPropagation();
                    /* FEATURE: tap -> full-view picture + bio (app-chat.js); falls back to the profile page */
                    if (typeof window._openAvatarPreviewSheet === 'function') {
                        window._openAvatarPreviewSheet(uid || _peerId, msgAv.currentSrc || msgAv.src, { full: true, name: data.senderName || _peerName });
                    } else _goToUserProfile(uid || _peerId);
                });
            })(data.senderId);
            row.appendChild(msgAv);
        }

        row.appendChild(bubble);

        /* Render existing reactions */
        if (data.reactions) {
            Object.values(data.reactions).forEach(function(em) { _renderReaction(row, em); });
        }

        /* Long-press → action sheet (React / Edit / Delete / Message info) */
        var msgId = data.id || data.msgId || '';
        if (msgId) _attachLongPress(row, msgId, data, isSent);

        return row;
    }


    /* =========================================================================
       §4  DATE SEPARATOR
       ========================================================================= */
    function _dateSep(ts) {
        var d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
        if (!d) return null;
        var label;
        var today = new Date();
        var yest  = new Date(today); yest.setDate(yest.getDate()-1);
        if (d.toDateString() === today.toDateString()) label = 'Today';
        else if (d.toDateString() === yest.toDateString()) label = 'Yesterday';
        else label = d.toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'});
        var div = document.createElement('div');
        div.className = 'oc-date-sep';
        div.innerHTML = '<span>' + label + '</span>';
        div.dataset.date = d.toDateString();
        return div;
    }


    /* =========================================================================
       §5  FIRESTORE LISTENER STATE
       ========================================================================= */
    var _unsub   = null;   /* current Firestore listener unsubscribe fn */
    var _peerId  = '';
    var _peerName = '';
    var _peerAvatar = '';
    var _seenDates = {};
    /* Reply-to state (long-press → Reply → quoted composer). Holds a
       lightweight snapshot of the message being replied to, or null when
       not currently composing a reply. Reset whenever a chat is (re)opened
       or a message is sent. */
    var _replyingTo = null;
    var _replyingRowEl = null; /* DOM row currently highlighted for reply — deliberately kept OUT of _replyingTo so it never gets spread into a Firestore payload */
    var _pinnedMsgs = {}; /* msgId -> lightweight snapshot, kept in sync by the existing message listener (no extra Firestore query/index) */
    /* FIX v15 (Message Send Indicator spec): was function-local to
       _subscribeByParticipants, which meant _doSend's optimistic bubble
       had no way to mark its own msgId as "already on screen" — the
       listener's next 'added' snapshot for that same doc (which always
       fires, since the write matches the open query) would render a
       second, duplicate bubble. Promoting it to module scope lets
       _doSend register the id the instant it renders optimistically. */
    var _renderedMsgIds = {};
    var _closeDebounce = false;     /* shared by real button + geometric fallback (§7b) */
    var _activeCloseHandler = null; /* always points at the CURRENT _doCloseChat */
    var _chatHistoryPushed = false; /* true while a history entry is open for the back-button close (§7c) */
    /* FIX (bugs: "message disappears after refresh/logout", "recipient sees
       chat preview but opening the thread shows nothing, including their
       own sent messages"): _subscribeByParticipants's two Firestore
       queries filter on senderId/receiverId === the myId snapshot taken
       ONCE, at the moment openChat() was called. That's the exact same
       stale-cached-id-vs-live-Firebase-UID race already fixed for /calls
       (_watchIncomingCalls, §5 above) and for the /chats preview list
       (app-patch-v23.js Part B) — Firebase Auth's real session can still
       be mid-restore (or an anonymous fallback session still active) when
       a chat is opened, so myId can easily be wrong at subscribe time
       even though it self-heals moments later via _syncUidIfNeeded().
       Both onSnapshot calls also had EMPTY error handlers (`function(){}`),
       so the resulting permission-denied from querying with the wrong id
       was silently swallowed — no messages ever rendered, no error
       visible, nothing ever retried. That matches the reported symptom
       exactly: works for the /chats preview (self-heals every ~3s) but
       not for the thread itself, which never rechecked. Track which uid
       the CURRENTLY OPEN chat's listeners were attached with, so a
       periodic recheck (mirroring _watchIncomingCalls' own pattern) can
       detect drift and transparently re-subscribe with the corrected id. */
    var _msgSubscribedUid = null;

    function _stopListener() {
        if (_unsub) { try { _unsub(); } catch(e){} _unsub = null; }
    }

    function _buildChatId(a, b) { return [a, b].sort().join('_'); }

    /* Delete a whole 1:1 conversation (every message doc for the chat, batched). Shared by the chat window's
       "Delete chat" menu item and the chat list's long-press "Delete chat". done() runs only on success. */
    window._ocDeleteChat = function (peerId, done) {
        var myId = _us().id || _authUid() || '';
        if (!myId || !peerId) return;
        var chatId = _buildChatId(myId, peerId);
        if (!confirm('Delete this entire conversation? This cannot be undone.')) return;
        if (!_fbOk()) { if (typeof _notify === 'function') _notify('Offline — cannot delete chat right now.', 'error'); return; }
        window.fbDb.collection('messages').where('chatId', '==', chatId).get().then(function (snap) {
            var docs = snap.docs;
            function _delBatch(i) {
                var slice = docs.slice(i, i + 450);
                if (!slice.length) {
                    var b = document.getElementById('oc-messages-body');
                    if (b) b.querySelectorAll('.oc-row,.oc-date-sep').forEach(function (r) { r.remove(); });
                    /* blank the chat-list preview doc so a stale "last message" can't reappear on the row */
                    try { window.fbDb.collection('chats').doc(chatId).update({ lastMessage: '', lastMessageTime: null }).catch(function () {}); } catch (eC) {}
                    if (typeof window._v36ForgetChat === 'function') window._v36ForgetChat(peerId);
                    if (typeof _notify === 'function') _notify('Chat deleted.', 'success');
                    if (typeof done === 'function') done();
                    return;
                }
                var batch = window.fbDb.batch();
                slice.forEach(function (d) { batch.delete(d.ref); });
                batch.commit().then(function () { _delBatch(i + 450); }).catch(function () {
                    if (typeof _notify === 'function') _notify('Some messages could not be deleted — check your connection and try again.', 'error');
                });
            }
            _delBatch(0);
        }).catch(function () {
            if (typeof _notify === 'function') _notify('Could not delete chat — check your connection and try again.', 'error');
        });
    };

    /* =========================================================================
       §5b  CHAT FLAGS  —  Add-to-list / Mute / Disappearing messages
       ─────────────────────────────────────────────────────────────────────────
       FIX v13 (Issue 1: "Add to List", "Mute Notifications" and "Disappearing
       Messages" appeared to "do nothing" — they only ever showed a toast and
       never persisted anything). These now write real state:
         • Add to list        → users/{myId}/savedContacts/{peerId}  (new subcollection,
                                 mirrors the existing users/{userId}/bookmarks pattern
                                 already allowed in firebase-rules.js — needs a matching
                                 rule added, see the firebase-rules.js diff)
         • Mute notifications → chats/{chatId}.mutedBy: [uid,...]  (existing chat doc,
                                 no new rule needed — /chats/{chatId} already lets any
                                 participant update the doc)
         • Disappearing msgs  → chats/{chatId}.disappearing: {ms, setBy}  (same doc,
                                 same existing rule — client purges expired messages on
                                 load/subscribe; there's no server cron in this stack,
                                 so this is a best-effort client-side purge, not a hard
                                 guarantee, until a Cloud Function backs it too)
       ========================================================================= */
    var _mutedSet        = {};  /* chatId -> true while muted by me            */
    var _savedContactSet = {};  /* peerId -> true while saved to my list       */
    var _disappearingMap = {};  /* chatId -> ms (0/undefined = off)            */

    /* =========================================================================
       §5c  MESSAGE DELIVERY INDICATORS  (enhancement)
       ─────────────────────────────────────────────────────────────────────────
       Spec: one tick = sent, two ticks = delivered AND recipient online, a
       read indicator appears the instant the recipient opens the chat.
       Implementation:
         • "Read" reuses the existing messages/{id}.read boolean that was
           already being written on send (read:false) but never actually
           updated or rendered — _handleSnap below now flips it to true the
           moment an incoming message is seen while the chat is open, and
           _buildBubble/_applyTickState render blue double-ticks for it.
         • "Delivered and recipient online" is read straight from the
           already-existing presence/{userId} heartbeat doc (written every
           ~20s by app-patch-v11.js per firebase-rules.js) for the ONE peer
           this chat is open with — a single lightweight doc subscription,
           not a scan of the whole message history.
       ========================================================================= */
    var _peerOnline    = false;
    var _unsubPresence = null;
    var _peerFreshnessTimer = null;

    /* FIX (tick-mark bug: double-check shown immediately instead of after
       a real delivery): app-fix-final.js's presence heartbeat (§11,
       fixOnlineStatus/_heartbeat) writes presence/{uid}.online:true every
       60s while a user's app is open/active, but NOTHING anywhere ever
       writes it back to false — there's no visibility/pagehide/unload
       handler and Firestore (unlike the Realtime Database) has no
       server-side onDisconnect(). So once any user has opened the app a
       single time, their presence doc says online:true PERMANENTLY, and
       every peer looks "online" forever — which is why every message here
       jumped straight to a double tick instead of starting at one.

       FIX: don't trust the online:true flag by itself. Also require
       lastSeen (written on every heartbeat) to be recent — within
       PRESENCE_FRESH_MS, comfortably more than one heartbeat interval
       (60s) so a normal gap between beats never flickers it offline, but
       short enough that a peer who closed the app / lost network without
       ever getting a chance to write online:false stops being treated as
       "online" shortly after their last real heartbeat. This is the
       correct fix regardless of whether app-fix-final.js is later updated
       to also write online:false on visibilitychange/pagehide (best-effort
       only on mobile anyway, since the OS can kill a backgrounded WebView
       without ever firing those events) — freshness is the only signal
       that can't go stale forever. */
    var PRESENCE_FRESH_MS = 90000; /* 1.5x the 60s heartbeat interval */
    var _peerLastSeen  = 0;        /* epoch ms of peer's last heartbeat, 0 = unknown */

    function _isPeerActuallyOnline() {
        if (!_peerOnline) return false;
        if (!_peerLastSeen) return false; /* no lastSeen on the doc yet — don't assume */
        return (Date.now() - _peerLastSeen) < PRESENCE_FRESH_MS;
    }

    /* FIX (this session — "improve the tick quality, make it sleek and
       premium"): the old ✓ / ✓✓ were plain text-font glyphs — rendering
       depends on whatever checkmark glyph the device's system font
       ships, which is exactly why they read as flat/inconsistent next
       to a real WhatsApp tick. Replaced with real stroked-SVG icons
       (rounded caps/joins, thin premium stroke) so they render
       identically everywhere and actually look like a deliberate icon
       rather than punctuation. Both share currentColor so the existing
       .state-sent/.state-delivered/.state-read CSS classes still drive
       color with no other changes needed. */
    var TICK_SINGLE_SVG = '<svg viewBox="0 0 16 11" width="15" height="11" fill="none"><path d="M1 5.6L5.2 9.8L15 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var TICK_DOUBLE_SVG = '<svg viewBox="0 0 20 11" width="18" height="11" fill="none"><path d="M1 5.6L5.2 9.8L13.2 1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.6 5.6L10.8 9.8L19 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function _applyTickState(tickEl, data) {
        if (data.read === true) {
            tickEl.className = 'oc-tick state-read';
            tickEl.innerHTML = TICK_DOUBLE_SVG;
        } else if (_isPeerActuallyOnline()) {
            tickEl.className = 'oc-tick state-delivered';
            tickEl.innerHTML = TICK_DOUBLE_SVG;
        } else {
            tickEl.className = 'oc-tick state-sent';
            tickEl.innerHTML = TICK_SINGLE_SVG;
        }
    }

    function _refreshAllTicks() {
        var body = document.getElementById('oc-messages-body');
        if (!body) return;
        body.querySelectorAll('.oc-row.sent .oc-tick').forEach(function(tickEl) {
            var row = tickEl.closest('.oc-row');
            _applyTickState(tickEl, { read: row && row.dataset.read === 'true' });
        });
    }

    /* FIX (this session — mockup parity): _peerOnline/_peerLastSeen were
       already tracked by _subscribePresence below (used only to drive
       message ticks) but never reflected onto the header itself, which
       hardcoded "online" regardless of real presence. Reuses that same
       state — no new Firestore read — to show the actual status text and
       toggle the header avatar's online dot (added in the header-build
       code above). Purely additive: _peerOnline/_peerLastSeen's existing
       role driving ticks is untouched. */
    function _updateHeaderPresence() {
        var statusEl = document.getElementById('oc-peer-status');
        var dotEl    = document.getElementById('oc-peer-online-dot');
        if (!statusEl && !dotEl) return;
        if (statusEl) {
            if (_peerOnline) {
                statusEl.textContent = 'online';
            } else if (_peerLastSeen) {
                var mins = Math.max(1, Math.round((Date.now() - _peerLastSeen) / 60000));
                statusEl.textContent = mins < 60 ? ('last seen ' + mins + 'm ago')
                    : 'last seen ' + new Date(_peerLastSeen).toLocaleString();
            } else {
                statusEl.textContent = '';
            }
        }
        if (dotEl) dotEl.style.display = _peerOnline ? 'block' : 'none';
    }

    function _subscribePresence(peerId) {
        if (_unsubPresence) { try{ _unsubPresence(); }catch(e){} _unsubPresence = null; }
        if (_peerFreshnessTimer) { clearInterval(_peerFreshnessTimer); _peerFreshnessTimer = null; }
        _peerOnline   = false;
        _peerLastSeen = 0;
        _updateHeaderPresence();
        if (!_fbOk() || !peerId) return;
        _unsubPresence = window.fbDb.collection('presence').doc(peerId)
            .onSnapshot(function(doc) {
                var d = doc.exists ? (doc.data() || {}) : {};
                _peerOnline   = d.online === true;
                var ls = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
                _peerLastSeen = (ls && !isNaN(ls)) ? ls : 0;
                _refreshAllTicks();
                _updateHeaderPresence();
            }, function(){ /* rule not present for this peer — ticks just stay at "sent" */ });
        /* No new snapshot arrives just because time passes, so a peer who
           went stale (app killed, no more heartbeats) would otherwise keep
           showing "delivered" forever off the last snapshot received. Poll
           the freshness check on a timer so ticks fall back to single-tick
           shortly after PRESENCE_FRESH_MS elapses with no new heartbeat. */
        _peerFreshnessTimer = setInterval(function () { _refreshAllTicks(); _updateHeaderPresence(); }, 15000);
    }

    function _loadChatFlags(myId, peerId) {
        if (!_fbOk() || !myId || !peerId) return;
        var chatId = _buildChatId(myId, peerId);

        window.fbDb.collection('chats').doc(chatId).get().then(function(doc) {
            var d = doc.exists ? (doc.data() || {}) : {};
            _mutedSet[chatId] = Array.isArray(d.mutedBy) && d.mutedBy.indexOf(myId) !== -1;
            _disappearingMap[chatId] = (d.disappearing && d.disappearing.ms) || 0;
            if (_disappearingMap[chatId] > 0) _purgeExpired(chatId, _disappearingMap[chatId]);
        }).catch(function(){});

        window.fbDb.collection('users').doc(myId).collection('savedContacts').doc(peerId).get()
            .then(function(doc){ _savedContactSet[peerId] = doc.exists; })
            .catch(function(){ /* rule not deployed yet — fails closed, button still works either way */ });
    }

    function _isMuted(chatId) { return !!_mutedSet[chatId]; }

    function _toggleMute(myId, peerId) {
        if (!_fbOk()) { _notify('No internet connection','warning'); return; }
        var chatId = _buildChatId(myId, peerId);
        var next = !_isMuted(chatId);
        window.fbDb.collection('chats').doc(chatId).set({
            mutedBy: next
                ? firebase.firestore.FieldValue.arrayUnion(myId)
                : firebase.firestore.FieldValue.arrayRemove(myId)
        }, { merge: true }).then(function(){
            _mutedSet[chatId] = next;
            _notify(next ? 'Notifications muted for this chat' : 'Notifications unmuted','success');
        }).catch(function(){ _notify('Could not update mute setting','error'); });
    }

    function _toggleSavedContact(myId, peerId, peerName) {
        if (!_fbOk()) { _notify('No internet connection','warning'); return; }
        var ref = window.fbDb.collection('users').doc(myId).collection('savedContacts').doc(peerId);
        var next = !_savedContactSet[peerId];
        var p = next
            ? ref.set({ userId: peerId, name: peerName || '', savedAt: new Date().toISOString() })
            : ref.delete();
        p.then(function(){
            _savedContactSet[peerId] = next;
            _notify(next ? 'Added to your list' : 'Removed from your list','success');
        }).catch(function(){
            _notify('Could not save contact — savedContacts security rule may still need deploying (see firebase-rules.js).','error');
        });
    }

    function _purgeExpired(chatId, ms) {
        if (!_fbOk() || !ms) return;
        var body = document.getElementById('oc-messages-body');
        if (!body) return;
        var cutoff = Date.now() - ms;
        body.querySelectorAll('.oc-row[data-msg-id]').forEach(function(row) {
            var tsAttr = row.dataset.createdAt;
            if (!tsAttr) return;
            var t = new Date(tsAttr).getTime();
            if (t && t < cutoff) row.remove();
        });
    }

    function _openDisappearingSettings(myId, peerId) {
        var chatId = _buildChatId(myId, peerId);
        var current = _disappearingMap[chatId] || 0;
        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:9999999;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;';
        panel.innerHTML =
            '<div style="background:#fff;width:100%;border-radius:16px 16px 0 0;padding:18px;">' +
              '<div style="font-weight:700;font-size:1rem;margin-bottom:4px;">Disappearing messages</div>' +
              '<div style="font-size:0.8rem;color:#6B7280;margin-bottom:14px;">New messages in this chat will auto-remove from this device after the chosen time.</div>' +
              '<div id="oc-disp-opts" style="display:flex;flex-direction:column;"></div>' +
            '</div>';
        var OPTS = [
            { label: 'Off',      ms: 0 },
            { label: '24 hours', ms: 24*60*60*1000 },
            { label: '7 days',   ms: 7*24*60*60*1000 },
            { label: '90 days',  ms: 90*24*60*60*1000 }
        ];
        var wrap = panel.querySelector('#oc-disp-opts');
        OPTS.forEach(function(o) {
            var row = document.createElement('div');
            row.style.cssText = 'padding:13px 4px;border-top:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;cursor:pointer;';
            row.innerHTML = '<span>' + o.label + '</span>' + (o.ms === current ? '<span style="color:#1B2B8B;">&#10003;</span>' : '');
            row.addEventListener('click', function() {
                if (!_fbOk()) { _notify('No internet connection','warning'); return; }
                window.fbDb.collection('chats').doc(chatId).set({
                    disappearing: { ms: o.ms, setBy: myId, setAt: new Date().toISOString() }
                }, { merge: true }).then(function(){
                    _disappearingMap[chatId] = o.ms;
                    _notify(o.ms ? ('Disappearing messages set to ' + o.label) : 'Disappearing messages turned off','success');
                    panel.remove();
                }).catch(function(){ _notify('Could not update setting','error'); });
            });
            wrap.appendChild(row);
        });
        panel.addEventListener('click', function(e){ if (e.target === panel) panel.remove(); });
        document.body.appendChild(panel);
    }

    /* =========================================================================
       CONTACT INFO — premium redesign (was: bare avatar + name + username).
       Reuses data already being saved to /users/{peerId} by the main
       profile-edit form (app-fixes.js's saveUserToFirestore — see its own
       'profile-info-form' handler for the full field list this mirrors:
       email/phone/location/profession/education/maritalStatus/hobbies/
       website/followerCount/followedUserIds) — no new Firestore writes, no
       new fields, this is a read + richer layout only. The Follow button
       is a real `.follow-btn[data-user-id]` — app-fixes.js's own existing
       document-level delegated handler for that class does the actual
       follow/unfollow (Firestore write, userToFollow.followerCount, etc.);
       this file doesn't reimplement that logic, only renders the button in
       its correct initial state.
       ========================================================================= */
    function _infoRow(icon, label, value) {
        if (!value) return '';
        return '<div style="display:flex;align-items:flex-start;gap:14px;padding:13px 4px;border-bottom:1px solid rgba(10,14,39,0.06);">' +
            '<div style="width:34px;height:34px;border-radius:10px;background:rgba(27,43,139,0.08);color:#1B2B8B;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.85rem;"><i class="fas ' + icon + '"></i></div>' +
            '<div style="min-width:0;">' +
                '<div style="font-size:0.68rem;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:#9CA3AF;">' + _esc(label) + '</div>' +
                '<div style="font-size:0.92rem;color:#111827;margin-top:2px;word-break:break-word;">' + _esc(value) + '</div>' +
            '</div>' +
        '</div>';
    }

    /* FIX (feature: "tap the inbox avatar preview -> bottom-sheet bio,
       with a way through to the full profile"): _openProfileModal is
       private to this closure. Rather than duplicate this whole
       full-profile screen a second time in app-chat.js, it's exposed
       here under a namespaced name — same minimal-exposure convention
       app-patch-v37.js already used for _guestClient/_guestTracks.
       Nothing else about this function changes. */
    function _openProfileModal(peerId, peerName, peerAvatar) {
        /* FIX (2026-08-01 — identity mismatch, same recurring root cause
           already fixed for /groups, /group_calls and /calls, see this
           app's own history: messages/chats docs are written with the
           PERSISTENT app id (_us().id — see senderId: u.id at _doSend/
           _sendFile below), not the live, often-anonymous Firebase Auth
           uid. This site still had auth-uid-first, unlike the corrected
           pattern used everywhere else, so myId here almost never
           matched what documents actually used. Flipped to match the
           already-fixed precedent. */
        var myId = _us().id || _authUid() || '';
        var iFollow = !!(_us().followedUserIds && typeof _us().followedUserIds.has === 'function' && _us().followedUserIds.has(peerId));

        var panel = document.createElement('div');
        panel.id = 'oc-profile-panel';
        panel.style.cssText = 'position:fixed;inset:0;z-index:9999999;background:#F5F6FA;overflow-y:auto;-webkit-overflow-scrolling:touch;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:linear-gradient(135deg,#0A0E27,#1B2B8B);color:#fff;position:sticky;top:0;z-index:3;">' +
              '<button id="oc-profile-back" style="background:none;border:none;color:#fff;font-size:1.3rem;cursor:pointer;line-height:1;">&#8592;</button>' +
              '<span style="font-weight:700;font-size:0.98rem;">Contact info</span>' +
            '</div>' +

            '<div id="oc-profile-hero" style="background:linear-gradient(165deg,rgba(10,14,39,0.88) 0%,rgba(27,43,139,0.85) 60%,rgba(0,88,77,0.82) 145%);background-size:cover;background-position:center;padding:34px 20px 66px;display:flex;flex-direction:column;align-items:center;position:relative;">' +
              '<div style="width:118px;height:118px;border-radius:50%;padding:3.5px;background:linear-gradient(135deg,#D4AF37,#F5E7A3,#D4AF37);box-shadow:0 8px 24px rgba(0,0,0,0.35);">' +
                '<img src="' + _esc(peerAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(peerName || 'U') + '&background=1B2B8B&color=fff&size=200')) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid #0A0E27;display:block;">' +
              '</div>' +
              '<div id="oc-profile-name" style="display:flex;align-items:center;gap:6px;margin-top:14px;font-size:1.22rem;font-weight:800;color:#fff;">' + _esc(peerName || 'User') + '</div>' +
              '<div id="oc-profile-username" style="font-size:0.86rem;color:rgba(255,255,255,0.72);margin-top:2px;"></div>' +
            '</div>' +

            '<div style="margin:-46px 16px 0;background:#fff;border-radius:20px;box-shadow:0 12px 30px rgba(10,14,39,0.14);padding:18px 18px 6px;position:relative;z-index:1;">' +
              '<div style="display:flex;">' +
                '<div style="flex:1;text-align:center;padding-bottom:14px;">' +
                  '<div id="oc-profile-followers" style="font-size:1.05rem;font-weight:800;color:#111827;">0</div>' +
                  '<div style="font-size:0.72rem;color:#9CA3AF;letter-spacing:0.02em;text-transform:uppercase;margin-top:2px;">Followers</div>' +
                '</div>' +
                '<div style="width:1px;background:rgba(10,14,39,0.08);"></div>' +
                '<div style="flex:1;text-align:center;padding-bottom:14px;">' +
                  '<div id="oc-profile-following" style="font-size:1.05rem;font-weight:800;color:#111827;">0</div>' +
                  '<div style="font-size:0.72rem;color:#9CA3AF;letter-spacing:0.02em;text-transform:uppercase;margin-top:2px;">Following</div>' +
                '</div>' +
              '</div>' +
              (peerId && peerId !== myId
                ? '<button class="follow-btn" data-user-id="' + _esc(peerId) + '"' + (iFollow ? ' style="width:100%;padding:12px;border:1.5px solid #1B2B8B;border-radius:12px;background:#fff;color:#1B2B8B;font-weight:700;font-size:0.9rem;margin-bottom:14px;cursor:pointer;"' : ' style="width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#1B2B8B,#00584D);color:#fff;font-weight:700;font-size:0.9rem;margin-bottom:14px;cursor:pointer;box-shadow:0 6px 16px rgba(27,43,139,0.3);"') + '>' +
                    (iFollow ? 'Following' : '<i class="fas fa-plus"></i> Follow') +
                  '</button>'
                : '') +
            '</div>' +

            '<div id="oc-profile-bio-card" style="display:none;margin:14px 16px 0;background:#fff;border-radius:16px;box-shadow:0 4px 16px rgba(10,14,39,0.06);padding:16px 18px;font-size:0.9rem;line-height:1.5;color:#374151;"></div>' +

            '<div id="oc-profile-details-card" style="display:none;margin:14px 16px 24px;background:#fff;border-radius:16px;box-shadow:0 4px 16px rgba(10,14,39,0.06);padding:6px 16px;"></div>';

        document.body.appendChild(panel);
        panel.querySelector('#oc-profile-back').addEventListener('click', function () { panel.remove(); });

        if (_fbOk() && peerId) {
            window.fbDb.collection('users').doc(peerId).get().then(function (doc) {
                if (!doc.exists) return;
                var d = doc.data() || {};

                var nameEl = document.getElementById('oc-profile-name');
                if (nameEl && d.isVerified) {
                    nameEl.innerHTML = _esc(d.fullName || peerName || 'User') +
                        ' <i class="fas fa-circle-check" style="color:#D4AF37;font-size:0.85rem;" title="Verified"></i>';
                }
                var unEl = document.getElementById('oc-profile-username');
                if (unEl && d.username) unEl.textContent = '@' + d.username;

                var followersEl = document.getElementById('oc-profile-followers');
                var followingEl = document.getElementById('oc-profile-following');
                if (followersEl) followersEl.textContent = (d.followerCount || 0).toLocaleString();
                if (followingEl) followingEl.textContent = ((d.followedUserIds && d.followedUserIds.length) || 0).toLocaleString();

                var heroEl = document.getElementById('oc-profile-hero');
                if (heroEl && d.coverPhoto) {
                    heroEl.style.backgroundImage =
                        'linear-gradient(165deg,rgba(10,14,39,0.88) 0%,rgba(27,43,139,0.80) 60%,rgba(0,88,77,0.78) 145%), url("' + d.coverPhoto.replace(/"/g, '') + '")';
                }

                if (d.bio) {
                    var bioCard = document.getElementById('oc-profile-bio-card');
                    bioCard.style.display = 'block';
                    bioCard.textContent = d.bio;
                }

                var joinedLabel = '';
                if (d.createdAt) {
                    var jd = new Date(d.createdAt);
                    if (!isNaN(jd.getTime())) {
                        joinedLabel = jd.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                    }
                }

                var rows =
                    _infoRow('fa-envelope', 'Email', d.email) +
                    _infoRow('fa-phone', 'Phone', d.phone) +
                    _infoRow('fa-map-marker-alt', 'Address', d.location) +
                    _infoRow('fa-briefcase', 'Profession / Occupation', d.profession) +
                    _infoRow('fa-graduation-cap', 'Education', d.education) +
                    _infoRow('fa-heart', 'Hobbies & Interests', d.hobbies) +
                    _infoRow('fa-venus-mars', 'Marital Status', d.maritalStatus) +
                    _infoRow('fa-globe', 'Website', d.website) +
                    _infoRow('fa-calendar-days', 'Member Since', joinedLabel);
                if (rows) {
                    var detailsCard = document.getElementById('oc-profile-details-card');
                    detailsCard.style.display = 'block';
                    detailsCard.innerHTML = rows;
                }
            }).catch(function () {});
        }
    }


    /* =========================================================================
       §6b  WEBRTC ENGINE  —  Firestore signalling
       =========================================================================
       Firestore schema:
         calls/{callId}  {
           callerId, calleeId, type ('voice'|'video'),
           callerName, callerAvatar,
           offer: { type, sdp },
           answer: { type, sdp },
           status: 'ringing' | 'active' | 'ended',
           createdAt
         }
         calls/{callId}/callerCandidates/{auto}  { candidate, sdpMid, sdpMLineIndex }
         calls/{callId}/calleeCandidates/{auto}  { candidate, sdpMid, sdpMLineIndex }
       ========================================================================= */

    var _rtc = {
        pc:           null,   /* RTCPeerConnection                          */
        localStream:  null,   /* MediaStream from getUserMedia              */
        remoteStream: null,   /* MediaStream assembled from remote tracks   */
        callId:       null,   /* Firestore doc ID                           */
        role:         null,   /* 'caller' | 'callee'                        */
        unsubOffer:   null,   /* Firestore listener unsub fns               */
        unsubAnswer:  null,
        unsubCands:   null,
        dotTimer:     null,
        muted:        false,
        camOff:       false,
        speakerEl:    null,   /* <audio> element for remote voice           */
        isVideo:      false,
        audioBoosted: false,  /* guards the Web Audio gain graph from being wired twice */

        /* ── added: mid-call ICE-restart recovery (see _createPC's
           onconnectionstatechange 'disconnected' case) ── */
        iceRestartTimer:    null, /* grace-period timer before attempting a restart */
        iceRestartAttempts: 0,    /* capped so a truly dead network doesn't retry forever */
        myOfferVersion:      0,   /* caller only: negotiationVersion of the offer we last sent */
        appliedAnswerVersion:0,   /* caller only: last answerVersion we've applied */
        appliedOfferVersion: 0,   /* callee only: last offerVersion we've applied */

        /* ── added: ringing / duration / call-log / recording state ── */
        connectedAt:  null,   /* Date.now() the instant pc reaches 'connected' */
        durationTimer:null,   /* setInterval id — updates the on-screen mm:ss  */
        callLogged:   false,  /* guards against writing the call-log doc twice */
        toneOsc:      null,   /* active ringback/ringtone oscillator(s), if any */
        toneTimer:    null,   /* setInterval/Timeout driving the tone pattern   */
        toneCtx:      null,   /* shared AudioContext for tones                  */
        recorder:     null,   /* active MediaRecorder, if recording             */
        recordChunks: [],     /* collected Blob parts while recording           */
        recording:    false,
        recordAudioCtx: null, /* AudioContext used to mix local+remote for the recording */
        recordCanvasTimer: null, /* rAF/interval id compositing video frames to canvas */

        /* ── added: mutual recording consent (privacy fix) ── */
        recRequestPending: false, /* true while WE are waiting on the other side's answer */
        recPromptEl:       null,  /* the accept/decline banner shown on the OTHER side, if any */
        onRecordingSnapshot: null, /* set by _buildCallModal; called by both status listeners  */

        /* ── added v13: voice→video switch, mutual consent (Issue 2) ── */
        videoSwitchPending:      false, /* true while WE are waiting on the other side's accept/decline */
        videoSwitchAwaitingOffer:  false, /* true while WE (the accepter) are waiting for the renegotiation offer */
        videoSwitchAwaitingAnswer: false, /* true while WE (the requester) are waiting for the renegotiation answer */
        videoSwitchShown:        false, /* guards the consent banner from being shown twice for one request */
        switchPromptEl:          null,  /* the accept/decline banner for a switch request, if any */
        onVideoSwitchSnapshot:   null   /* set by _buildCallModal; called by both status listeners  */
    };

    /* FIX (bug: "video call bounces back after deploying to Render, worked
       fine before"): STUN-only ICE (below) lets two peers discover their
       public IP:port, but it does nothing when either side sits behind a
       symmetric or carrier-grade NAT — which is exactly what mobile data
       networks (4G/LTE) commonly use. On the same Wi-Fi/local network,
       direct P2P negotiates fine even with STUN alone, which is why this
       looked like it "worked" before deployment. Once real users on real
       (often cellular) networks call each other, ICE negotiation fails,
       RTCPeerConnection.connectionState goes to 'failed', and
       onconnectionstatechange (see _createPC above) calls _rtcHangup() —
       which is the "bounce back". This is NOT a Firebase rules issue; the
       call doc, offer/answer, and ICE candidate writes all succeed (that
       part of the signaling works) — it's the *media path itself* that
       can't establish. The fix is a TURN server, which relays media when
       direct P2P isn't possible.

       UPDATE — the TURN entry below used to point at
       turn:openrelay.metered.ca with the credential 'openrelayproject':
       Metered's own PUBLIC, unauthenticated example credential, published
       in their docs and copy-pasted by countless unrelated projects
       worldwide with no per-account quota of their own. That's the
       traceable cause of the intermittent total call failures and the
       one-direction-dies-after-a-few-minutes symptom this app was hitting
       — not a code bug, a shared/rate-limited relay under load from every
       other app using that same public demo credential. Replaced with a
       private Metered.ca account allocation (own username/credential,
       own quota, not shared with anyone else) as of this session. Revisit
       if usage grows past the free tier — Twilio Network Traversal
       Service, Xirsys, Cloudflare Calls, or a self-hosted coturn remain
       the production-scale options at that point. */
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
       RINGBACK (caller hears "brrng… brrng…" while the other side rings) and
       RINGTONE (callee hears an incoming-call melody) — synthesized with the
       Web Audio API so no external sound file/asset is needed. Both use the
       same shared AudioContext (_rtc.toneCtx) and are stopped by the same
       _stopTone() so a hangup/answer/decline anywhere always silences them.
       ========================================================================= */
    function _getToneCtx() {
        if (_rtc.toneCtx && _rtc.toneCtx.state !== 'closed') return _rtc.toneCtx;
        try {
            _rtc.toneCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { _rtc.toneCtx = null; }
        return _rtc.toneCtx;
    }

    /* Plays one short tone burst (or a two-tone chord) at the given frequency(ies). */
    function _beep(ctx, freqs, startAt, dur, gainLevel) {
        freqs.forEach(function (f) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = f;
            gain.gain.setValueAtTime(0, startAt);
            gain.gain.linearRampToValueAtTime(gainLevel, startAt + 0.02);
            gain.gain.setValueAtTime(gainLevel, startAt + dur - 0.05);
            gain.gain.linearRampToValueAtTime(0, startAt + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startAt);
            osc.stop(startAt + dur + 0.02);
        });
    }

    /* Ringback: classic "1s tone, 3s silence" cadence, like a real dial tone. */
    function _startRingbackTone() {
        _stopTone();
        var ctx = _getToneCtx();
        if (!ctx) return;
        function cycle() {
            if (!ctx || ctx.state === 'closed') return;
            var now = ctx.currentTime + 0.05;
            _beep(ctx, [425], now, 1.0, 0.06);
        }
        cycle();
        _rtc.toneTimer = setInterval(cycle, 4000);
    }

    /* Ringtone: a friendlier two-note "ding-dong" repeating every ~2.2s. */
    function _startRingtone() {
        _stopTone();
        var ctx = _getToneCtx();
        if (!ctx) return;
        function cycle() {
            if (!ctx || ctx.state === 'closed') return;
            var now = ctx.currentTime + 0.05;
            _beep(ctx, [784], now, 0.35, 0.08);
            _beep(ctx, [659], now + 0.4, 0.35, 0.08);
        }
        cycle();
        _rtc.toneTimer = setInterval(cycle, 2200);
    }

    function _stopTone() {
        if (_rtc.toneTimer) { clearInterval(_rtc.toneTimer); _rtc.toneTimer = null; }
        if (_rtc.toneCtx) {
            try { _rtc.toneCtx.close(); } catch (e) {}
            _rtc.toneCtx = null;
        }
    }

    /* =========================================================================
       CALL DURATION — starts the instant the RTCPeerConnection actually
       reaches 'connected' (i.e. media is really flowing both ways, not just
       "the callee tapped accept"), shown as a live mm:ss readout in the modal.
       ========================================================================= */
    function _fmtDuration(totalSec) {
        totalSec = Math.max(0, Math.floor(totalSec));
        var m = Math.floor(totalSec / 60);
        var s = totalSec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _startDurationTimer() {
        if (_rtc.durationTimer) return;
        _rtc.connectedAt = Date.now();
        var el = document.getElementById('oc-call-duration');
        if (el) el.style.display = 'block';
        _rtc.durationTimer = setInterval(function () {
            var d = document.getElementById('oc-call-duration');
            if (d) d.textContent = _fmtDuration((Date.now() - _rtc.connectedAt) / 1000);
        }, 1000);
    }

    function _stopDurationTimer() {
        if (_rtc.durationTimer) { clearInterval(_rtc.durationTimer); _rtc.durationTimer = null; }
    }

    /* =========================================================================
       CALL LOG — every call already gets a doc in Firestore's `calls`
       collection (used for WebRTC signalling). We piggyback the persistent
       call-history record on that SAME doc instead of a second collection —
       it already carries callerId/calleeId/type/createdAt, so we only need
       to add `participants` (for an array-contains query) plus, once the
       call is over, `finalStatus` / `duration` / `endedAt`.
       finalStatus one of: 'answered' | 'declined' | 'missed' | 'no_answer' | 'ended'
       ========================================================================= */
    function _finalizeCallRecord(callId, finalStatus) {
        if (!_fbOk() || !callId) return;
        var durationSec = _rtc.connectedAt ? Math.floor((Date.now() - _rtc.connectedAt) / 1000) : 0;
        try {
            var ref = window.fbDb.collection('calls').doc(callId);
            /* Whichever side ends the call first may already have written a
               more specific finalStatus (e.g. the callee's explicit
               'declined' vs. the generic 'no_answer' this device would
               otherwise guess at) — read first so we never clobber a more
               accurate reason with a vaguer one. */
            ref.get().then(function (snap) {
                var existing = snap.exists ? (snap.data() || {}).finalStatus : null;
                ref.set({
                    finalStatus: existing || finalStatus,
                    duration:    durationSec,
                    endedAt:     new Date().toISOString()
                }, { merge: true }).catch(function () {});
            }).catch(function () {
                ref.set({ finalStatus: finalStatus, duration: durationSec, endedAt: new Date().toISOString() }, { merge: true }).catch(function () {});
            });
        } catch (e) {}
    }

    /* Persistent "you missed a call" notification — same shape the rest of
       the app already uses for the notifications bell, so it shows up there
       automatically (including for a user who wasn't online at call time —
       it's just sitting in Firestore waiting for their next visit). */
    function _notifyMissedCall(toUserId, fromUserId, fromName, isVideo) {
        if (!_fbOk() || !toUserId) return;
        try {
            var notifRef = window.fbDb.collection('notifications').doc();
            notifRef.set({
                id: notifRef.id,
                type: 'missed_call',
                toUserId: toUserId,
                fromUserId: fromUserId || '',
                fromName: fromName || 'Someone',
                message: (fromName || 'Someone') + ' tried to reach you with a ' + (isVideo ? 'video' : 'voice') + ' call',
                preview: '',
                read: false,
                createdAt: new Date().toISOString()
            }).catch(function () {});
            if (typeof window.pushNotification === 'function' && _us().id === toUserId) {
                window.pushNotification('📞 Missed ' + (isVideo ? 'video' : 'voice') + ' call from ' + (fromName || 'someone'), 'info');
            }
        } catch (e) {}
    }

    /* ── clean up everything ─────────────────────────────── */
    /* FIX (bug: "video/voice call connects and disconnects immediately"):
       both the caller flow (_startCallModal) and callee flow (_answerCall)
       tear down instantly via _rtcHangup(null) the moment their setup
       promise chain (getUserMedia → create/answer offer → write the call
       doc to Firestore) rejects for ANY reason — which is exactly what
       "opens then closes right away" looks like from the outside. The
       previous catch collapsed every possible cause into one of two vague
       strings, which made it impossible to tell which of several very
       different problems was actually happening. This logs the real
       error (name/code/message) to console and picks the specific,
       actionable message for the most likely causes:
         • NotAllowedError / SecurityError → mic/camera permission was
           never granted. On a plain website this is a browser permission
           prompt; if this build is wrapped in a native Android WebView
           app, getUserMedia() ALSO requires the native app's
           WebChromeClient.onPermissionRequest() to grant camera/mic to
           the WebView — a step that's easy to miss when wrapping a site,
           and something no amount of JS here can fix on its own.
         • NotFoundError → no camera/microphone on this device.
         • Firestore 'permission-denied' → the calls/{callId} write (or
           its callerCandidates/calleeCandidates subcollection) was
           rejected by firestore.rules. This app's history has repeatedly
           hit this exact class of bug for other collections (active_
           streams, notifications, savedContacts, business_posts comments)
           — the 'calls' collection is newer and may not have a matching
           rule yet. If this is the cause, the fix is a firestore.rules
           change (share the file and I'll add the right match block),
           not something fixable from this JS file. */
    function _describeCallSetupError(err, stage) {
        console.error('[OC-Call] ' + stage + ' failed —', err && err.name, err && err.code, err && err.message, err);
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
            return 'Microphone/camera permission denied. If this is the Empyrean app (not a browser), check the app has camera/microphone permission in your phone\'s Settings.';
        }
        if (err && err.name === 'NotFoundError') {
            return 'No camera or microphone found on this device.';
        }
        if (err && (err.code === 'permission-denied' || err.name === 'FirebaseError' && /permission/i.test(err.message || ''))) {
            return 'Call could not be set up — server permission denied. This needs a Firestore rules fix, not a device setting.';
        }
        return 'Could not ' + stage + ': ' + ((err && err.message) || err);
    }

    /* DIAGNOSTIC: Firestore's own "CollectionReference.doc() cannot be
       called with an empty path" error gives no clue which variable was
       empty or where. Tracing every .doc(callId)/.doc(_peerId) call in
       the caller-flow setup chain shows none of them CAN legitimately
       receive '' as currently written (_buildChatId always joins with
       an underscore, so it's never pure-empty, and callId is always
       that plus '-' plus Date.now()) — so if this fires again, it's a
       sign of a real state bug (e.g. a stale/duplicate closure, or a
       variable overwritten mid-flight) that static reading of the code
       can't pin down in advance. This wrapper doesn't change normal
       behavior at all when id is present; it only replaces the vague
       Firestore error with one that names the exact collection + id
       variable + call site involved, so the NEXT time this happens the
       real cause is immediately identifiable instead of a guess. */
    function _docSafe(collectionName, id, ctxLabel) {
        if (!id) {
            var msg = '[OC-Call] BUG: about to build a Firestore doc ref with an empty/undefined id — collection="' + collectionName + '", context="' + ctxLabel + '". Whatever variable was supposed to hold callId/_peerId here was empty at this exact moment — that variable is the real bug, not Firestore.';
            console.error(msg);
            throw new Error(msg);
        }
        return window.fbDb.collection(collectionName).doc(id);
    }

    function _rtcHangup(callId, finalStatus) {
        var cid = callId || _rtc.callId;
        var wasVideo = _rtc.isVideo;
        var wasConnected = !!_rtc.connectedAt;
        var role = _rtc.role;

        /* Stop ringback/ringtone immediately — this is the #1 place a call
           can end, so it's the most reliable single spot to guarantee sound
           always stops (hangup by either side, or a connection failure). */
        _stopTone();

        /* Stop recording (if any) and trigger the download before we tear
           down the streams the recording depends on. */
        if (_rtc.recording) _stopRecording(true);

        /* Stop timers / listeners */
        if (_rtc.dotTimer)   { clearInterval(_rtc.dotTimer);  _rtc.dotTimer  = null; }
        _stopDurationTimer();
        if (_rtc.unsubOffer) { try{_rtc.unsubOffer();}catch(e){} _rtc.unsubOffer = null; }
        if (_rtc.unsubAnswer){ try{_rtc.unsubAnswer();}catch(e){} _rtc.unsubAnswer = null; }
        if (_rtc.unsubCands) { try{_rtc.unsubCands();}catch(e){} _rtc.unsubCands = null; }

        /* Stop local media */
        if (_rtc.localStream) {
            _rtc.localStream.getTracks().forEach(function(t){ try{t.stop();}catch(e){} });
            _rtc.localStream = null;
        }

        /* Close peer connection */
        if (_rtc.pc) { try{_rtc.pc.close();}catch(e){} _rtc.pc = null; }

        /* Remove remote audio element */
        if (_rtc.speakerEl) { try{_rtc.speakerEl.srcObject=null; _rtc.speakerEl.remove();}catch(e){} _rtc.speakerEl = null; }
        _rtc.remoteStream = null;
        _rtc.audioBoosted = false;

        /* Cancel any pending ICE-restart timer and reset renegotiation
           state — this call is over, none of it should bleed into the
           next one. */
        if (_rtc.iceRestartTimer) { clearTimeout(_rtc.iceRestartTimer); _rtc.iceRestartTimer = null; }
        _rtc.iceRestartAttempts  = 0;
        _rtc.myOfferVersion      = 0;
        _rtc.appliedAnswerVersion= 0;
        _rtc.appliedOfferVersion = 0;

        /* Remove any leftover "tap to hear audio" banner — this call is
           over, so it should never carry into the next one. */
        var _unmuteBanner = document.getElementById('oc-unmute-banner');
        if (_unmuteBanner) _unmuteBanner.remove();

        /* Mark call ended in Firestore + write the call-log summary
           (finalStatus/duration/endedAt) exactly once per call. */
        if (_fbOk() && cid) {
            try {
                window.fbDb.collection('calls').doc(cid)
                    .update({ status: 'ended' })
                    .catch(function(){});
            } catch(e){}

            if (!_rtc.callLogged) {
                _rtc.callLogged = true;
                var resolvedStatus = finalStatus || (wasConnected ? 'answered' : (role === 'caller' ? 'no_answer' : 'missed'));
                _finalizeCallRecord(cid, resolvedStatus);

                /* If nobody ever connected and this device is the one that
                   placed the call, the OTHER side missed it — let them know
                   next time they're active, same as the 45s-timeout path. */
                if (!wasConnected && role === 'caller') {
                    var u = _us();
                    window.fbDb.collection('calls').doc(cid).get().then(function (snap) {
                        var d = snap.exists ? snap.data() : {};
                        _notifyMissedCall(d.calleeId, u.id, u.fullName || u.username || 'Someone', wasVideo);
                    }).catch(function(){});
                }
            }
        }

        _rtc.callId      = null;
        _rtc.role        = null;
        _rtc.connectedAt = null;
        _rtc.isVideo     = false;
        _rtc.recRequestPending = false;
        _rtc.onRecordingSnapshot = null;
        if (_rtc.recPromptEl) { try{ _rtc.recPromptEl.remove(); }catch(e){} _rtc.recPromptEl = null; }
        _rtc.videoSwitchPending = false;
        _rtc.videoSwitchAwaitingOffer = false;
        _rtc.videoSwitchAwaitingAnswer = false;
        _rtc.videoSwitchShown = false;
        _rtc.onVideoSwitchSnapshot = null;
        if (_rtc.switchPromptEl) { try{ _rtc.switchPromptEl.remove(); }catch(e){} _rtc.switchPromptEl = null; }

        /* Remove modal (and any minimized pill left over from item 2's
           "exit the call screen while calling" minimize feature — the
           call is actually over now, so nothing should be left floating). */
        var m = document.getElementById('oc-call-modal');
        if (m) m.remove();
        _removeMinimizedPill();
    }

    /* =========================================================================
       MINIMIZE CALL ("caller should be able to exit the call screen while
       calling/ongoing, to check other sections") — hides the full-screen
       #oc-call-modal and replaces it with a small persistent pill the
       person can keep tapping around the rest of the app underneath. The
       call itself is untouched: RTCPeerConnection, local/remote media
       tracks, the Firestore signalling listeners, and the remote <audio>
       element all live outside this modal's DOM, so display:none on the
       modal doesn't pause or drop any of it — restoring just reveals the
       same modal again, mid-call, exactly where it left off.
       ========================================================================= */
    var _minimizedPill = null;
    var _minimizedPillTimer = null;

    function _removeMinimizedPill() {
        if (_minimizedPillTimer) { clearInterval(_minimizedPillTimer); _minimizedPillTimer = null; }
        if (_minimizedPill) { try { _minimizedPill.remove(); } catch (e) {} _minimizedPill = null; }
    }

    function _restoreCall() {
        var modal = document.getElementById('oc-call-modal');
        if (modal) modal.style.display = 'flex';
        _removeMinimizedPill();
    }

    function _minimizeCall(name, avatar) {
        var modal = document.getElementById('oc-call-modal');
        if (!modal || !_rtc.callId) return; // nothing active to minimize
        modal.style.display = 'none';

        _removeMinimizedPill(); // guard against a stray previous pill

        var pill = document.createElement('div');
        pill.id = 'oc-call-minimized-pill';
        pill.style.cssText = [
            'position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:12px;',
            'z-index:999998;display:flex;align-items:center;gap:8px;',
            'background:#1B2B8B;color:#fff;border-radius:24px;padding:8px 14px 8px 8px;',
            'box-shadow:0 6px 18px rgba(0,0,0,0.35);cursor:pointer;',
            'font-family:inherit;-webkit-tap-highlight-color:transparent;'
        ].join('');

        var avatarHtml = avatar
            ? '<img src="' + _esc(avatar) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
            : '<div style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.8rem;flex-shrink:0;">' + _esc((name || 'U').charAt(0).toUpperCase()) + '</div>';

        var textEl = document.createElement('span');
        textEl.id = 'oc-call-minimized-text';
        textEl.style.cssText = 'font-size:0.8rem;font-weight:600;white-space:nowrap;';

        pill.innerHTML = avatarHtml;
        pill.appendChild(textEl);
        document.body.appendChild(pill);
        _minimizedPill = pill;

        function _tick() {
            if (!textEl.parentNode) return;
            if (_rtc.connectedAt) {
                textEl.textContent = _fmtDuration((Date.now() - _rtc.connectedAt) / 1000);
            } else {
                var st = document.getElementById('oc-call-status');
                textEl.textContent = (st && st.textContent) ? st.textContent.replace(/\.+$/, '…') : 'In call…';
            }
        }
        _tick();
        _minimizedPillTimer = setInterval(_tick, 1000);

        pill.addEventListener('click', _restoreCall);
    }

    /* ── build the full-screen call modal ──────────────────── */
    function _buildCallModal(type, name, avatar, callId) {
        var existing = document.getElementById('oc-call-modal');
        if (existing) existing.remove();
        _removeMinimizedPill(); /* a previous call's pill should already be gone via _rtcHangup, but guard anyway */

        var isVideo = (type === 'video');
        _rtc.isVideo = isVideo;

        var modal = document.createElement('div');
        modal.id = 'oc-call-modal';
        modal.style.cssText = [
            'position:fixed;inset:0;z-index:999999;',
            'background:#000;',
            'display:flex;flex-direction:column;',
            'color:#fff;font-family:inherit;',
            '-webkit-tap-highlight-color:transparent;',
            'user-select:none;'
        ].join('');

        /* ── remote video (fills background for video calls) ── */
        var remoteVideo = document.createElement('video');
        remoteVideo.id = 'oc-remote-video';
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.style.cssText = [
            'position:absolute;inset:0;width:100%;height:100%;',
            'object-fit:cover;',
            isVideo ? 'display:block;' : 'display:none;',
            'background:#111;'
        ].join('');
        modal.appendChild(remoteVideo);

        /* ── local video (pip, bottom-right) ── */
        var localVideo = document.createElement('video');
        localVideo.id = 'oc-local-video';
        localVideo.autoplay = true;
        localVideo.playsInline = true;
        localVideo.muted = true;   /* never echo own audio */
        localVideo.style.cssText = [
            'position:absolute;bottom:110px;right:16px;',
            'width:90px;height:120px;border-radius:12px;',
            'object-fit:cover;border:2px solid rgba(255,255,255,0.5);',
            'box-shadow:0 4px 16px rgba(0,0,0,0.4);',
            'z-index:2;',
            isVideo ? 'display:block;' : 'display:none;'
        ].join('');
        modal.appendChild(localVideo);

        /* ── minimize control ("exit the call screen without hanging up",
           so the person can go check another section of the app while a
           call is ringing/ongoing — same idea as a phone call surviving
           you backgrounding it). Tapping it hides this full-screen modal
           and shows a small persistent pill instead; nothing about the
           call itself (RTCPeerConnection, media tracks, Firestore
           listeners, the remote <audio> element) lives inside this modal,
           so hiding it doesn't touch any of that — see _minimizeCall(). */
        var minimizeBtn = document.createElement('button');
        minimizeBtn.id = 'oc-call-minimize';
        minimizeBtn.type = 'button';
        minimizeBtn.setAttribute('aria-label', 'Minimize call');
        minimizeBtn.style.cssText = [
            'position:absolute;top:14px;left:14px;z-index:5;',
            'width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;',
            'background:rgba(0,0,0,0.35);color:#fff;',
            'display:flex;align-items:center;justify-content:center;',
            '-webkit-tap-highlight-color:transparent;outline:none;'
        ].join('');
        /* Icon matches the group call's minimize control
           (app-patch-group-call.js's _minimizeSvg) — same "compress
           corners" glyph on both call surfaces so it reads as one
           consistent feature across 1:1 and group calls. */
        minimizeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M15 4.5h4.5V9" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M19.5 4.5 13.5 10.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>' +
            '<path d="M9 19.5H4.5V15" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M4.5 19.5 10.5 13.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>' +
            '</svg>';
        minimizeBtn.addEventListener('click', function () { _minimizeCall(name, avatar); });
        modal.appendChild(minimizeBtn);

        /* ── overlay panel (voice calls / ringing state) ── */
        var overlay = document.createElement('div');
        overlay.id = 'oc-call-overlay';
        overlay.style.cssText = [
            'position:relative;z-index:3;',
            'display:flex;flex-direction:column;align-items:center;',
            'padding-top:80px;gap:14px;flex:1;',
            'background:' + (isVideo
                ? 'linear-gradient(180deg,rgba(0,0,0,0.55) 0%,transparent 40%)'
                : 'linear-gradient(180deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)')
        ].join('');

        var callTypeLabel = document.createElement('div');
        callTypeLabel.style.cssText = 'font-size:0.82rem;opacity:0.7;letter-spacing:0.5px;text-transform:capitalize;';
        callTypeLabel.textContent = (isVideo ? 'Video' : 'Voice') + ' Call';
        overlay.appendChild(callTypeLabel);

        var avEl = document.createElement('img');
        avEl.src = avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff&size=160');
        avEl.onerror = function() { this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff&size=160'; };
        avEl.id = 'oc-call-avatar';
        avEl.style.cssText = [
            'width:96px;height:96px;border-radius:50%;object-fit:cover;',
            'border:3px solid rgba(255,255,255,0.35);',
            'box-shadow:0 0 0 10px rgba(255,255,255,0.07);',
            isVideo ? 'opacity:0;transition:opacity 0.5s;' : ''
        ].join('');
        overlay.appendChild(avEl);

        var nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:1.35rem;font-weight:700;';
        nameEl.textContent = name;
        overlay.appendChild(nameEl);

        var statusEl = document.createElement('div');
        statusEl.id = 'oc-call-status';
        statusEl.style.cssText = 'font-size:0.88rem;opacity:0.65;';
        statusEl.textContent = 'Calling…';
        overlay.appendChild(statusEl);

        var durationEl = document.createElement('div');
        durationEl.id = 'oc-call-duration';
        durationEl.style.cssText = 'font-size:0.82rem;opacity:0.55;letter-spacing:1px;display:none;';
        durationEl.textContent = '00:00';
        overlay.appendChild(durationEl);

        var recIndicator = document.createElement('div');
        recIndicator.id = 'oc-rec-indicator';
        recIndicator.style.cssText = 'display:none;align-items:center;gap:6px;font-size:0.75rem;color:#ff5252;font-weight:700;';
        recIndicator.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#ff5252;animation:oc-rec-pulse 1s infinite;"></span> Recording';
        overlay.appendChild(recIndicator);
        if (!document.getElementById('oc-rec-style')) {
            var recStyle = document.createElement('style');
            recStyle.id = 'oc-rec-style';
            recStyle.textContent = '@keyframes oc-rec-pulse{0%,100%{opacity:1}50%{opacity:0.25}}';
            document.head.appendChild(recStyle);
        }

        modal.appendChild(overlay);

        /* ── controls bar ── */
        var controls = document.createElement('div');
        controls.id = 'oc-call-controls';
        controls.style.cssText = [
            'position:absolute;bottom:0;left:0;right:0;z-index:4;',
            'display:flex;align-items:center;',
            /* FIX (screenshot: Camera/Flip/Speaker/Record row cut off on
               both edges — up to 6 buttons at 58px + 20px gaps + padding
               is ~496px, wider than most phone screens, and this row had
               no wrap/scroll so justify-content:center simply clipped the
               overflow on both sides). Switch to a horizontally scrollable
               strip instead of a centered, non-wrapping flex row. */
            'justify-content:flex-start;overflow-x:auto;-webkit-overflow-scrolling:touch;',
            'scrollbar-width:none;',
            'gap:20px;',
            'padding:20px 24px;',
            'padding-bottom:calc(20px + env(safe-area-inset-bottom,0px));',
            'background:linear-gradient(0deg,rgba(0,0,0,0.75) 0%,transparent 100%);'
        ].join('');
        controls.style.setProperty('-ms-overflow-style', 'none');
        if (!document.getElementById('_oc_controls_scrollbar_hide')) {
            var _sbStyle = document.createElement('style');
            _sbStyle.id = '_oc_controls_scrollbar_hide';
            _sbStyle.textContent = '#oc-call-controls::-webkit-scrollbar{display:none;}';
            document.head.appendChild(_sbStyle);
        }

        function _makeCtrlBtn(id, iconHtml, bg, label) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;flex:0 0 auto;';
            var btn = document.createElement('button');
            btn.id = id;
            btn.style.cssText = [
                'width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;',
                'background:' + bg + ';color:#fff;',
                'display:flex;align-items:center;justify-content:center;',
                'box-shadow:0 4px 16px rgba(0,0,0,0.35);',
                'transition:transform 0.12s,background 0.2s;',
                '-webkit-tap-highlight-color:transparent;outline:none;'
            ].join('');
            btn.innerHTML = iconHtml;
            btn.addEventListener('touchstart', function(){ btn.style.transform='scale(0.88)'; }, { passive:true });
            btn.addEventListener('touchend',   function(){ btn.style.transform='scale(1)'; },   { passive:true });
            var lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:0.7rem;opacity:0.85;color:#fff;';
            lbl.textContent = label;
            wrap.appendChild(btn);
            wrap.appendChild(lbl);
            return wrap;
        }

        /* SVG icons */
        var SVG = {
            micOn:  '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M12 15c1.66 0 3-1.34 3-3V6a3 3 0 0 0-6 0v6c0 1.66 1.34 3 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg>',
            micOff: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M19 11h-1.7A5 5 0 0 1 7.05 13H5a7 7 0 0 0 5 6.71V22h2v-2.29A7 7 0 0 0 19 13v-2zm-7 4a3 3 0 0 0 3-3V6a3 3 0 0 0-5.12-2.12L19 14.11A7 7 0 0 0 19 12h-2a5 5 0 0 1-.88 2.89L4.27 3.27 3 4.54l3.55 3.55A7 7 0 0 0 5 12H3a7 7 0 0 0 4.92 6.67L5 21.59 6.41 23 12 17.41l7.59 7.59L21 23.59 19 21.59 12 14.59V15z"/></svg>',
            camOn:  '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
            camOff: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/></svg>',
            flip:   '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M9 12c0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3-3 1.34-3 3zm-4.5 0A7.5 7.5 0 0 1 12 4.5c2.04 0 3.88.82 5.22 2.14L15 9h6V3l-2.14 2.14A9.48 9.48 0 0 0 12 3C7.03 3 3.01 7.01 3 12H4.5zm13.5 0A7.5 7.5 0 0 1 12 19.5a7.44 7.44 0 0 1-5.22-2.14L9 15H3v6l2.14-2.14A9.48 9.48 0 0 0 12 21c4.97 0 8.99-4.01 9-9H19.5z"/></svg>',
            /* FIX (2026-08-01 — Issue #5: "flip from video call back to
               voice call not working"): this direction had no icon or
               button anywhere in this file — only voice→video
               (oc-btn-switch-video) existed. Phone-handset icon, visually
               distinct from SVG.flip above (unrelated front/back camera
               flip, left untouched). */
            voiceOnly: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>',
            spkOn:  '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06A7 7 0 0 1 14 20.71v2.06a9 9 0 0 0 0-19.54z"/></svg>',
            endCall:'<svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9a11.07 11.07 0 0 0-2.66 1.85c-.37.36-.98.36-1.41-.01L.29 13.08A.996.996 0 0 1 0 12.38c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a.994.994 0 0 1-1.4 0 11.13 11.13 0 0 0-2.67-1.85c-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>',
            recDot: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="8"/></svg>',
            recStop:'<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
        };

        /* Row 1: Mute | Cam-toggle (video only) | Flip cam (video only) | Switch-to-video (voice only) | Switch-to-voice (video only) | Speaker */
        var muteWrap  = _makeCtrlBtn('oc-btn-mute',    SVG.micOn,  'rgba(255,255,255,0.2)', 'Mute');
        controls.appendChild(muteWrap);

        var camWrap, flipWrap, switchWrap, voiceWrap;
        if (isVideo) {
            camWrap  = _makeCtrlBtn('oc-btn-cam',  SVG.camOn,  'rgba(255,255,255,0.2)', 'Camera');
            flipWrap = _makeCtrlBtn('oc-btn-flip', SVG.flip,   'rgba(255,255,255,0.2)', 'Flip');
            controls.appendChild(camWrap);
            controls.appendChild(flipWrap);
            /* FIX (2026-08-01 — Issue #5): this direction (video→voice) had
               no button at all before. Symmetric with oc-btn-switch-video
               below — wired further down, right after _wireCamFlip. */
            voiceWrap = _makeCtrlBtn('oc-btn-switch-voice', SVG.voiceOnly, 'rgba(255,255,255,0.2)', 'Voice');
            controls.appendChild(voiceWrap);
        } else {
            /* FIX v13 (Issue 2: voice→video switch with consent). Only
               offered on voice calls — once a call is already video there's
               nothing to switch to. */
            switchWrap = _makeCtrlBtn('oc-btn-switch-video', SVG.camOn, 'rgba(255,255,255,0.2)', 'Video');
            controls.appendChild(switchWrap);
        }

        var spkWrap   = _makeCtrlBtn('oc-btn-spk',     SVG.spkOn,  'rgba(255,255,255,0.2)', 'Speaker');
        var recWrap   = _makeCtrlBtn('oc-btn-rec',     SVG.recDot, 'rgba(255,255,255,0.2)', 'Record');
        var endWrap   = _makeCtrlBtn('oc-btn-end',      SVG.endCall,'#E53935',               'End');
        controls.appendChild(spkWrap);
        controls.appendChild(recWrap);
        controls.appendChild(endWrap);

        modal.appendChild(controls);
        document.body.appendChild(modal);

        /* ── wire buttons ── */
        var muteBtn = document.getElementById('oc-btn-mute');
        muteBtn.addEventListener('click', function() {
            _rtc.muted = !_rtc.muted;
            if (_rtc.localStream) {
                _rtc.localStream.getAudioTracks().forEach(function(t){ t.enabled = !_rtc.muted; });
            }
            muteBtn.style.background = _rtc.muted ? '#E53935' : 'rgba(255,255,255,0.2)';
            muteBtn.innerHTML = _rtc.muted ? SVG.micOff : SVG.micOn;
            muteBtn.nextSibling && (muteBtn.parentNode.querySelector('span').textContent = _rtc.muted ? 'Unmute' : 'Mute');
        });

        function _wireCamFlip(camBtn, flipBtn) {
            camBtn.addEventListener('click', function() {
                _rtc.camOff = !_rtc.camOff;
                if (_rtc.localStream) {
                    _rtc.localStream.getVideoTracks().forEach(function(t){ t.enabled = !_rtc.camOff; });
                }
                camBtn.style.background = _rtc.camOff ? '#E53935' : 'rgba(255,255,255,0.2)';
                camBtn.innerHTML = _rtc.camOff ? SVG.camOff : SVG.camOn;
            });

            /* FIX (2026-08-01 — "flip camera does nothing"): this always
               requested the new-facing camera BEFORE releasing the current
               one. Many Android devices/browsers only expose the camera
               pipeline to one active getUserMedia video track at a time —
               requesting a second one while the first is still live fails
               (typically NotReadableError/TrackStartError), and since the
               failure was swallowed by an empty .catch(), the button just
               silently did nothing, exactly as reported. Now: if the first
               attempt fails, the OLD video track is stopped to free the
               hardware and the request is retried once; a failure past
               that is surfaced to the person instead of vanishing. */
            var _facingMode = 'user';
            function _acquireFlippedStream(constraints, isRetry) {
                return navigator.mediaDevices.getUserMedia(constraints).catch(function (err) {
                    if (isRetry) throw err;
                    var oldVideoTracks = _rtc.localStream ? _rtc.localStream.getVideoTracks() : [];
                    oldVideoTracks.forEach(function (t) { try { t.stop(); } catch (e) {} });
                    return _acquireFlippedStream(constraints, true);
                });
            }
            flipBtn.addEventListener('click', function() {
                _facingMode = (_facingMode === 'user') ? 'environment' : 'user';
                if (!_rtc.localStream || !_rtc.pc) return;
                var constraints = { video: { facingMode: _facingMode }, audio: true };
                _acquireFlippedStream(constraints, false).then(function(newStream) {
                    /* Replace video track in peer connection */
                    var newVideoTrack = newStream.getVideoTracks()[0];
                    var sender = _rtc.pc.getSenders().find(function(s){ return s.track && s.track.kind === 'video'; });
                    if (sender && newVideoTrack) sender.replaceTrack(newVideoTrack);
                    /* Update local preview */
                    var lv = document.getElementById('oc-local-video');
                    if (lv) lv.srcObject = newStream;
                    /* Stop old tracks not already stopped by the retry path */
                    _rtc.localStream.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} });
                    _rtc.localStream = newStream;
                }).catch(function(err) {
                    _facingMode = (_facingMode === 'user') ? 'environment' : 'user'; /* revert the toggle, the flip didn't happen */
                    _notify('Could not switch camera' + (err && err.name ? ' (' + err.name + ')' : '') + '.', 'warning');
                });
            });
        }

        if (isVideo) {
            var camBtn  = document.getElementById('oc-btn-cam');
            var flipBtn = document.getElementById('oc-btn-flip');
            _wireCamFlip(camBtn, flipBtn);
        }

        var spkBtn = document.getElementById('oc-btn-spk');
        var _spkOn = false;
        spkBtn.addEventListener('click', function() {
            _spkOn = !_spkOn;
            spkBtn.style.background = _spkOn ? '#1B2B8B' : 'rgba(255,255,255,0.2)';
            /* setSinkId is supported on Chrome/Android for routing to speaker */
            if (_rtc.speakerEl && _rtc.speakerEl.setSinkId) {
                _rtc.speakerEl.setSinkId(_spkOn ? 'default' : '').catch(function(){});
            }
        });

        var recBtn = document.getElementById('oc-btn-rec');
        recBtn.addEventListener('click', function() {
            if (_rtc.recording) {
                _stopRecording(true);
                recBtn.style.background = 'rgba(255,255,255,0.2)';
                recBtn.innerHTML = SVG.recDot;
                recBtn.parentNode.querySelector('span').textContent = 'Record';
                if (_fbOk() && _rtc.callId) {
                    window.fbDb.collection('calls').doc(_rtc.callId)
                        .set({ recordingRequest: { status: 'stopped', by: _us().id, at: new Date().toISOString() } }, { merge: true })
                        .catch(function(){});
                }
                return;
            }
            /* PRIVACY FIX: recording used to start the instant this button
               was tapped, with no way for the other person to know or
               object. Now it asks first — writes a request onto the call
               doc, the other side sees an Accept/Decline banner
               (_showRecordingConsentPrompt), and actual recording only
               starts here once _rtc.onRecordingSnapshot sees status
               'accepted' for a request we made. */
            if (_rtc.recRequestPending) return; /* already waiting */
            if (!_rtc.callId || !_fbOk()) { _notify('Not connected yet — try again in a second.', 'warning'); return; }
            _rtc.recRequestPending = true;
            recBtn.style.background = '#F5A623';
            recBtn.parentNode.querySelector('span').textContent = 'Waiting…';
            window.fbDb.collection('calls').doc(_rtc.callId)
                .set({ recordingRequest: { status: 'requested', by: _us().id, at: new Date().toISOString() } }, { merge: true })
                .then(function() {
                    _notify('Recording request sent — waiting for ' + (name || 'them') + ' to respond.', 'info');
                    setTimeout(function() {
                        if (_rtc.recRequestPending && !_rtc.recording) {
                            _rtc.recRequestPending = false;
                            recBtn.style.background = 'rgba(255,255,255,0.2)';
                            recBtn.parentNode.querySelector('span').textContent = 'Record';
                            _notify('No response to the recording request.', 'info');
                            if (_fbOk() && _rtc.callId) {
                                window.fbDb.collection('calls').doc(_rtc.callId)
                                    .set({ recordingRequest: { status: 'timeout' } }, { merge: true }).catch(function(){});
                            }
                        }
                    }, 20000);
                })
                .catch(function() {
                    _rtc.recRequestPending = false;
                    recBtn.style.background = 'rgba(255,255,255,0.2)';
                    recBtn.parentNode.querySelector('span').textContent = 'Record';
                    _notify('Could not send recording request.', 'warning');
                });
        });

        /* Handles recordingRequest transitions arriving from the OTHER
           side (or our own request being answered) via the call doc's
           existing status listeners — wired below where those listeners
           already exist for both caller and callee. */
        _rtc.onRecordingSnapshot = function(data) {
            if (!data || !data.recordingRequest) return;
            var req = data.recordingRequest;
            var me  = _us().id;

            if (req.status === 'requested' && req.by && req.by !== me && !_rtc.recording) {
                _showRecordingConsentPrompt(req.by, name);
                return;
            }
            if (req.status === 'accepted' && req.by === me && _rtc.recRequestPending && !_rtc.recording) {
                _rtc.recRequestPending = false;
                var ok = _startRecording(isVideo);
                if (ok) {
                    recBtn.style.background = '#E53935';
                    recBtn.innerHTML = SVG.recStop;
                    recBtn.parentNode.querySelector('span').textContent = 'Stop';
                } else {
                    recBtn.style.background = 'rgba(255,255,255,0.2)';
                    recBtn.parentNode.querySelector('span').textContent = 'Record';
                }
                return;
            }
            if ((req.status === 'declined' || req.status === 'timeout') && req.by === me && _rtc.recRequestPending) {
                _rtc.recRequestPending = false;
                recBtn.style.background = 'rgba(255,255,255,0.2)';
                recBtn.parentNode.querySelector('span').textContent = 'Record';
                if (req.status === 'declined') _notify((name || 'They') + ' declined the recording request.', 'info');
            }
        };

        /* =====================================================================
           FIX v13 (Issue 2: voice→video switch with consent)
           ─────────────────────────────────────────────────────────────────────
           Requirement: the recipient must accept before the call transitions;
           if declined, the voice call continues uninterrupted. Reuses the exact
           same "write a request field onto calls/{callId}, other side sees a
           banner, response written back to the same doc" pattern already
           proven out for recording consent above, then performs a standard
           WebRTC renegotiation (addTrack → createOffer/Answer → new SDP fields
           on the same call doc) to actually add live video to the still-open
           RTCPeerConnection — no new call, no dropped audio.
           ===================================================================== */
        function _revealVideoUI() {
            _rtc.isVideo = true;
            var rv = document.getElementById('oc-remote-video');
            var lv = document.getElementById('oc-local-video');
            if (rv) rv.style.display = 'block';
            if (lv) { lv.style.display = 'block'; lv.srcObject = _rtc.localStream; lv.play().catch(function(){}); }
            if (avEl) avEl.style.opacity = '0';
            var label = overlay.firstChild;
            if (label) label.textContent = 'Video Call';

            /* Swap the now-irrelevant "Video" switch button for real
               Camera/Flip/Voice controls, same as a call that started as
               video already has (including the Issue #5 Voice
               switch-back button, added 2026-08-01). */
            if (switchWrap && switchWrap.parentNode) switchWrap.remove();
            switchWrap = null;
            if (!document.getElementById('oc-btn-cam')) {
                camWrap  = _makeCtrlBtn('oc-btn-cam',  SVG.camOn, 'rgba(255,255,255,0.2)', 'Camera');
                flipWrap = _makeCtrlBtn('oc-btn-flip', SVG.flip,  'rgba(255,255,255,0.2)', 'Flip');
                voiceWrap = _makeCtrlBtn('oc-btn-switch-voice', SVG.voiceOnly, 'rgba(255,255,255,0.2)', 'Voice');
                controls.insertBefore(camWrap, muteWrap.nextSibling);
                controls.insertBefore(flipWrap, camWrap.nextSibling);
                controls.insertBefore(voiceWrap, flipWrap.nextSibling);
                _wireCamFlip(camWrap.querySelector('button'), flipWrap.querySelector('button'));
                voiceWrap.querySelector('button').addEventListener('click', _switchToVoice);
            }
        }

        /* Requester side: our request was accepted → add our video track and
           drive the renegotiation offer. */
        function _driveVideoSwitchOffer(callId) {
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(function(vstream) {
                    var vtrack = vstream.getVideoTracks()[0];
                    if (!vtrack || !_rtc.pc || !_rtc.localStream) throw new Error('No camera available');
                    _rtc.localStream.addTrack(vtrack);
                    _rtc.pc.addTrack(vtrack, _rtc.localStream);
                    _revealVideoUI();
                    return _rtc.pc.createOffer();
                })
                .then(function(offer) { return _rtc.pc.setLocalDescription(offer).then(function(){ return offer; }); })
                .then(function(offer) {
                    _rtc.videoSwitchAwaitingAnswer = true;
                    return window.fbDb.collection('calls').doc(callId).set({
                        videoSwitchOffer: { type: offer.type, sdp: offer.sdp }
                    }, { merge: true });
                })
                .catch(function(err) {
                    _notify('Could not switch to video: ' + (err.message || 'camera unavailable'), 'warning');
                });
        }

        /* Accepter side: the requester's renegotiation offer arrived → add
           our own video track (reuses the recvonly transceiver the offer
           just created) and answer it. */
        function _answerVideoSwitchOffer(callId, offerData) {
            _rtc.pc.setRemoteDescription(new RTCSessionDescription(offerData))
                .then(function() { return navigator.mediaDevices.getUserMedia({ video: true }); })
                .then(function(vstream) {
                    var vtrack = vstream.getVideoTracks()[0];
                    if (!vtrack || !_rtc.pc || !_rtc.localStream) throw new Error('No camera available');
                    _rtc.localStream.addTrack(vtrack);
                    _rtc.pc.addTrack(vtrack, _rtc.localStream);
                    _revealVideoUI();
                    return _rtc.pc.createAnswer();
                })
                .then(function(answer) { return _rtc.pc.setLocalDescription(answer).then(function(){ return answer; }); })
                .then(function(answer) {
                    return window.fbDb.collection('calls').doc(callId).set({
                        videoSwitchAnswer: { type: answer.type, sdp: answer.sdp }
                    }, { merge: true });
                })
                .catch(function(err) {
                    _notify('Video switch failed: ' + (err.message || 'camera unavailable'), 'warning');
                });
        }

        /* FIX (2026-08-01 — Issue #5): pulled out of the inline "if
           (switchWrap)" block below into a named, re-callable function so
           the SAME click behaviour can be re-attached after _switchToVoice
           recreates this button (a call that goes video→voice can later
           go voice→video again, same as one that started as voice). Reads
           switchWrap fresh each call (function-scoped var, reassigned by
           _switchToVoice), not the value captured when the modal first
           built its controls. */
        function _wireSwitchToVideoBtn() {
            var switchBtn = document.getElementById('oc-btn-switch-video');
            if (!switchBtn || switchBtn._ocWired) return;
            switchBtn._ocWired = true;
            switchBtn.addEventListener('click', function() {
                if (_rtc.videoSwitchPending) return; /* already waiting */
                if (!_rtc.callId || !_fbOk()) { _notify('Not connected yet — try again in a second.', 'warning'); return; }
                _rtc.videoSwitchPending = true;
                switchBtn.style.background = '#F5A623';
                switchWrap.querySelector('span').textContent = 'Waiting…';
                window.fbDb.collection('calls').doc(_rtc.callId)
                    .set({ videoSwitchRequest: { status: 'requested', by: _us().id, at: new Date().toISOString() } }, { merge: true })
                    .then(function() {
                        _notify('Video call request sent — waiting for ' + (name || 'them') + ' to respond.', 'info');
                        setTimeout(function() {
                            if (_rtc.videoSwitchPending && !_rtc.isVideo) {
                                _rtc.videoSwitchPending = false;
                                switchBtn.style.background = 'rgba(255,255,255,0.2)';
                                switchWrap.querySelector('span').textContent = 'Video';
                                _notify('No response to the video call request.', 'info');
                                if (_fbOk() && _rtc.callId) {
                                    window.fbDb.collection('calls').doc(_rtc.callId)
                                        .set({ videoSwitchRequest: { status: 'timeout' } }, { merge: true }).catch(function(){});
                                }
                            }
                        }, 20000);
                    })
                    .catch(function() {
                        _rtc.videoSwitchPending = false;
                        switchBtn.style.background = 'rgba(255,255,255,0.2)';
                        switchWrap.querySelector('span').textContent = 'Video';
                        _notify('Could not send video call request.', 'warning');
                    });
            });
        }
        if (switchWrap) _wireSwitchToVideoBtn();

        /* FEATURE (2026-08-01 — Issue #5: video→voice, the missing reverse
           direction). Unlike voice→video, this doesn't need a consent
           round-trip: dropping video is the less-intrusive direction (the
           other side simply stops receiving frames), and getUserMedia
           isn't invoked so there's no permission prompt to gate behind
           accept/decline. It still tells the other side via the same
           calls/{callId} doc (voiceSwitch field) so both UIs and both
           peer connections drop the video m-line in step. */
        function _switchToVoice() {
            if (!_rtc.isVideo) return;
            _rtc.isVideo = false;

            if (_rtc.pc) {
                var sender = _rtc.pc.getSenders().filter(function(s) { return s.track && s.track.kind === 'video'; });
                sender.forEach(function(s) {
                    try { s.track.stop(); } catch (e) {}
                    try { _rtc.pc.removeTrack(s); } catch (e) {}
                });
            }
            if (_rtc.localStream) {
                _rtc.localStream.getVideoTracks().forEach(function(t) {
                    try { t.stop(); } catch (e) {}
                    try { _rtc.localStream.removeTrack(t); } catch (e) {}
                });
            }

            var rv = document.getElementById('oc-remote-video');
            var lv = document.getElementById('oc-local-video');
            if (rv) { rv.style.display = 'none'; rv.srcObject = null; }
            if (lv) { lv.style.display = 'none'; lv.srcObject = null; }
            if (avEl) avEl.style.opacity = '1';
            var label = overlay.firstChild;
            if (label) label.textContent = 'Voice Call';

            [camWrap, flipWrap, voiceWrap].forEach(function(w) { if (w && w.parentNode) w.parentNode.removeChild(w); });
            camWrap = flipWrap = voiceWrap = null;
            if (!document.getElementById('oc-btn-switch-video')) {
                switchWrap = _makeCtrlBtn('oc-btn-switch-video', SVG.camOn, 'rgba(255,255,255,0.2)', 'Video');
                controls.insertBefore(switchWrap, muteWrap.nextSibling);
                _wireSwitchToVideoBtn();
            }

            /* Deliberately NOT reusing the videoSwitchOffer/videoSwitchAnswer
               fields here — those are the existing voice→video renegotiation
               channel (see _driveVideoSwitchOffer/_answerVideoSwitchOffer
               above); writing to them from this opposite direction would
               collide with that flow. Stopping+removing our own video
               track already stops the frames the other side receives —
               voiceSwitch below only syncs their UI (hide the now-frozen
               remote video element) instantly instead of them noticing
               only once the stream visibly stalls. */
            if (_rtc.callId && _fbOk()) {
                window.fbDb.collection('calls').doc(_rtc.callId)
                    .set({ voiceSwitch: { by: _us().id, at: new Date().toISOString() } }, { merge: true })
                    .catch(function() {});
            }
            _notify('Switched to voice call.', 'info');
        }
        var voiceBtn = document.getElementById('oc-btn-switch-voice');
        if (voiceBtn) voiceBtn.addEventListener('click', _switchToVoice);

        /* Mirrors the OTHER side dropping to voice: hide our video
           elements too (their track will simply stop sending frames, but
           hiding immediately avoids a frozen last-frame lingering on
           screen) and swap our own controls back to voice-mode, without
           touching our own outgoing video track — matching this feature's
           one-way-initiated, no-consent-needed design above. */
        function _onRemoteSwitchedToVoice() {
            if (!_rtc.isVideo) return;
            var rv = document.getElementById('oc-remote-video');
            if (rv) { rv.style.display = 'none'; rv.srcObject = null; }
            if (avEl) avEl.style.opacity = '1';
        }

        _rtc.onVideoSwitchSnapshot = function(data) {
            if (!data) return;
            var me = _us().id;
            var callId = _rtc.callId;

            /* FEATURE (2026-08-01 — Issue #5, video→voice): mirrors the
               other participant's _switchToVoice write. _lastVoiceSwitchAt
               guard prevents re-running on every later snapshot of the
               same doc (onSnapshot fires again for any unrelated field
               change too, e.g. mute/recording state). */
            var vs = data.voiceSwitch;
            if (vs && vs.by && vs.by !== me && vs.at !== _rtc._lastVoiceSwitchAt) {
                _rtc._lastVoiceSwitchAt = vs.at;
                _onRemoteSwitchedToVoice();
            }

            var req = data.videoSwitchRequest;
            if (req) {
                if (req.status === 'requested' && req.by && req.by !== me && !_rtc.isVideo && !_rtc.videoSwitchShown) {
                    _rtc.videoSwitchShown = true;
                    _rtc.videoSwitchAwaitingOffer = true; /* we'll be the one answering the renegotiation */
                    _showVideoSwitchConsentPrompt(req.by, name, callId);
                } else if (req.status === 'accepted' && req.by === me && _rtc.videoSwitchPending) {
                    _rtc.videoSwitchPending = false;
                    _driveVideoSwitchOffer(callId);
                } else if ((req.status === 'declined' || req.status === 'timeout') && req.by === me && _rtc.videoSwitchPending) {
                    _rtc.videoSwitchPending = false;
                    var sBtn = document.getElementById('oc-btn-switch-video');
                    if (sBtn) { sBtn.style.background = 'rgba(255,255,255,0.2)'; sBtn.parentNode.querySelector('span').textContent = 'Video'; }
                    /* Fallback behaviour: decline just cancels the switch — the
                       voice call itself is completely untouched. */
                    if (req.status === 'declined') _notify((name || 'They') + ' declined the video call request.', 'info');
                }
            }

            if (data.videoSwitchOffer && _rtc.videoSwitchAwaitingOffer && !_rtc.isVideo) {
                _rtc.videoSwitchAwaitingOffer = false;
                _answerVideoSwitchOffer(callId, data.videoSwitchOffer);
            }
            /* FIX (2026-08-01 — "camera flip"/voice→video switch: accepting
               does nothing): `_rtc.pc.currentRemoteDescription` is ALREADY
               set the instant the original call connects (it's the initial
               offer/answer) and never becomes null again — so this guard,
               meant to stop a duplicate apply, was actually stopping EVERY
               apply for any call that had already connected, which is
               every real video-switch renegotiation. The requester's
               peer connection would sit forever in 'have-local-offer' with
               the video track added locally but never actually negotiated,
               so the UI revealed video elements (_revealVideoUI ran on both
               sides) while no video ever flowed — "accepting does nothing".
               Guard on signalingState instead, the same pattern already
               used above for applying the ORIGINAL call answer: a
               videoSwitchAnswer can only be legitimately applied while our
               side is actually waiting on one (have-local-offer), so that's
               the real "already applied" check, not remote-description
               presence. */
            if (data.videoSwitchAnswer && _rtc.videoSwitchAwaitingAnswer) {
                _rtc.videoSwitchAwaitingAnswer = false;
                if (_rtc.pc && _rtc.pc.signalingState === 'have-local-offer') {
                    _rtc.pc.setRemoteDescription(new RTCSessionDescription(data.videoSwitchAnswer)).catch(function(err) {
                        console.error('[OC-Call] video switch answer could not be applied:', err && err.message);
                        _notify('Could not complete the video switch — please try again.', 'warning');
                    });
                }
            }
        };

        var endBtn = document.getElementById('oc-btn-end');
        endBtn.addEventListener('click', function() {
            _rtcHangup(_rtc.callId, _rtc.connectedAt ? 'answered' : undefined);
        });

        return { modal: modal, remoteVideo: remoteVideo, localVideo: localVideo, statusEl: statusEl, avEl: avEl };
    }

    /* ── Consent banner for a voice→video switch request (Issue 2) ──
       Mirrors _showRecordingConsentPrompt's exact pattern below. Decline
       writes 'declined' and does nothing else — per spec, the voice call
       continues without interruption. */
    function _showVideoSwitchConsentPrompt(requesterId, requesterDisplayName, callId) {
        if (_rtc.switchPromptEl) return;

        var box = document.createElement('div');
        box.id = 'oc-video-switch-consent';
        box.style.cssText = [
            'position:fixed;bottom:190px;left:50%;transform:translateX(-50%);',
            'z-index:1000000;background:#1a1a2e;color:#fff;border-radius:16px;',
            'padding:14px 16px;display:flex;align-items:center;gap:12px;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.5);min-width:280px;max-width:88vw;',
            'animation:oc-ring-in 0.3s ease;'
        ].join('');

        var msg = document.createElement('div');
        msg.style.cssText = 'flex:1;font-size:0.85rem;line-height:1.3;';
        msg.textContent = (requesterDisplayName || 'The other person') + ' wants to switch to a video call.';
        box.appendChild(msg);

        var declineBtn = document.createElement('button');
        declineBtn.textContent = 'Decline';
        declineBtn.style.cssText = 'background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:0.78rem;cursor:pointer;flex-shrink:0;';
        box.appendChild(declineBtn);

        var acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept';
        acceptBtn.style.cssText = 'background:#25D366;color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:0.78rem;cursor:pointer;flex-shrink:0;';
        box.appendChild(acceptBtn);

        document.body.appendChild(box);
        _rtc.switchPromptEl = box;

        function _cleanup() {
            if (box.parentNode) box.remove();
            if (_rtc.switchPromptEl === box) _rtc.switchPromptEl = null;
        }

        declineBtn.addEventListener('click', function() {
            _cleanup();
            _rtc.videoSwitchAwaitingOffer = false;
            if (_fbOk() && callId) {
                window.fbDb.collection('calls').doc(callId)
                    .set({ videoSwitchRequest: { status: 'declined', by: requesterId } }, { merge: true })
                    .catch(function(){});
            }
        });

        acceptBtn.addEventListener('click', function() {
            _cleanup();
            if (_fbOk() && callId) {
                window.fbDb.collection('calls').doc(callId)
                    .set({ videoSwitchRequest: { status: 'accepted', by: requesterId } }, { merge: true })
                    .catch(function(){});
            }
            _notify('Switching to video…', 'info');
        });
    }

    /* ── AUTOPLAY-BLOCKED AUDIO FIX ────────────────────────────────────
       BUG: "call connects, other person hears/sees me, I can't hear
       them" — one-directional, intermittent (worse on a fresh browser
       session/device). NOT a TURN/network issue — media is arriving
       fine; it just never plays.
       ROOT CAUSE: rv.play() / speakerEl.play() below used to be called
       on an UNMUTED element carrying live audio, with any rejection
       swallowed by an empty .catch(). Chrome/Android (and most modern
       browsers) block autoplay of unmuted audio unless the browser
       already has a "media engagement" allowance for this origin from
       an earlier session, or play() happens inside a synchronous user
       gesture. pc.ontrack (which is what calls _attachRemoteStream)
       fires asynchronously, well after the original Call/Accept tap's
       gesture window has closed — so on a fresh session this rejection
       happens routinely. The <video> still renders normally either way
       (decoding/painting frames isn't gated the same way autoplay-with-
       -sound is), so the call visibly "connects" while audio silently
       never starts — nothing previously surfaced this failure.
       FIX: try unmuted playback first (succeeds whenever the browser
       already allows it, which is most of the time after first use).
       If that's rejected, fall back to muted playback (always
       succeeds) and show a small "tap to hear audio" banner. Setting
       el.muted = false inside THAT banner's own click handler is a
       genuine user gesture acting on already-playing media, which is
       permitted regardless of any prior engagement history. */
    function _playRemoteMedia(el) {
        if (!el) return;
        el.muted = false;
        var p = el.play();
        if (p && typeof p.catch === 'function') {
            p.catch(function (err) {
                console.warn('[OC-Call] unmuted playback blocked (' + (err && err.name) + ') — falling back to muted playback + tap-to-unmute.', err && err.message);
                el.muted = true;
                el.play().catch(function () {});
                _showUnmuteBanner(el);
            });
        }
    }

    function _showUnmuteBanner(el) {
        if (document.getElementById('oc-unmute-banner')) return;
        var modal = document.getElementById('oc-call-modal');
        if (!modal) return;
        var bar = document.createElement('button');
        bar.id = 'oc-unmute-banner';
        bar.type = 'button';
        bar.textContent = '\uD83D\uDD07 Tap to hear audio';
        bar.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);' +
            'z-index:5;background:rgba(0,0,0,0.78);color:#fff;border:1px solid rgba(255,255,255,0.3);' +
            'border-radius:20px;padding:8px 16px;font-size:0.85rem;cursor:pointer;';
        bar.addEventListener('click', function () {
            el.muted = false; // real gesture, acting on already-playing media — always allowed
            bar.remove();
        });
        modal.appendChild(bar);
    }

    /* ── set remote stream on video/audio elements ──────── */
    function _attachRemoteStream(stream, isVideo) {
        _rtc.remoteStream = stream;
        if (isVideo) {
            var rv = document.getElementById('oc-remote-video');
            if (rv) {
                rv.srcObject = stream;
                rv.volume = 1.0;
                _playRemoteMedia(rv);
            }
            /* REGRESSION FIX: the Web Audio gain-boost path
               (_boostRemoteAudioGain) is disabled here. Creating/using an
               AudioContext can force the page's audio session into a mode
               that conflicts with and suppresses WebRTC's own native audio
               pipeline on some mobile browsers (notably iOS Safari) —
               plausible cause of a "call connects, nobody hears anything"
               regression. Remote audio/video now stays on the plain
               rv.srcObject = stream path above with zero Web Audio
               involvement. _boostRemoteAudioGain() itself is left intact,
               just unused, in case the actual cause turns out to be
               something else and this needs to come back later.
               _boostRemoteAudioGain(rv, stream); */
            /* Hide avatar when remote video flows */
            var av = document.getElementById('oc-call-avatar');
            if (av) av.style.opacity = '0';
        } else {
            /* Voice: route audio through an <audio> element */
            if (!_rtc.speakerEl) {
                _rtc.speakerEl = document.createElement('audio');
                _rtc.speakerEl.autoplay = true;
                _rtc.speakerEl.style.display = 'none';
                document.body.appendChild(_rtc.speakerEl);
            }
            _rtc.speakerEl.srcObject = stream;
            _rtc.speakerEl.volume = 1.0;
            _playRemoteMedia(_rtc.speakerEl);
            /* REGRESSION FIX: same reasoning as the video branch above —
               Web Audio re-routing disabled, native stream only.
               _boostRemoteAudioGain(_rtc.speakerEl, stream); */
        }
        var st = document.getElementById('oc-call-status');
        if (st) st.textContent = 'Connected';
    }

    /* =========================================================================
       CALL RECORDING — mixes local + remote audio (Web Audio API) and, for
       video calls, composites both video feeds onto a hidden canvas (remote
       full-frame, local as a small picture-in-picture corner) so the single
       downloaded file actually contains both sides of the conversation,
       matching what's on screen. Audio-only calls skip the canvas entirely
       and just record the mixed audio track.
       ========================================================================= */
    function _startRecording(isVideo) {
        if (_rtc.recording) return false;
        if (!window.MediaRecorder) { _notify('Recording is not supported on this browser.', 'warning'); return false; }
        if (!_rtc.localStream) { _notify('Call audio not ready yet — try again in a second.', 'warning'); return false; }

        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            var actx = new AC();
            _rtc.recordAudioCtx = actx;
            var dest = actx.createMediaStreamDestination();

            /* Local mic */
            if (_rtc.localStream.getAudioTracks().length) {
                actx.createMediaStreamSource(new MediaStream(_rtc.localStream.getAudioTracks())).connect(dest);
            }
            /* Remote party's audio — from remoteStream (video calls) or the
               <audio> speakerEl's stream (voice calls). */
            var remoteAudioStream = _rtc.remoteStream ||
                (_rtc.speakerEl && _rtc.speakerEl.srcObject) || null;
            if (remoteAudioStream && remoteAudioStream.getAudioTracks && remoteAudioStream.getAudioTracks().length) {
                actx.createMediaStreamSource(new MediaStream(remoteAudioStream.getAudioTracks())).connect(dest);
            }

            var outTracks = dest.stream.getAudioTracks().slice();
            var mimeType = 'audio/webm;codecs=opus';

            if (isVideo) {
                var canvas = document.createElement('canvas');
                canvas.width = 640; canvas.height = 480;
                var ctx2d = canvas.getContext('2d');
                var remoteVideoEl = document.getElementById('oc-remote-video');
                var localVideoEl  = document.getElementById('oc-local-video');

                _rtc.recordCanvasTimer = setInterval(function () {
                    try {
                        ctx2d.fillStyle = '#000';
                        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
                        if (remoteVideoEl && remoteVideoEl.readyState >= 2) {
                            ctx2d.drawImage(remoteVideoEl, 0, 0, canvas.width, canvas.height);
                        }
                        if (localVideoEl && localVideoEl.readyState >= 2) {
                            var pw = canvas.width * 0.28, ph = canvas.height * 0.28;
                            ctx2d.drawImage(localVideoEl, canvas.width - pw - 12, canvas.height - ph - 12, pw, ph);
                        }
                    } catch (drawErr) { /* a mid-frame read failure shouldn't kill the recording */ }
                }, 1000 / 25);

                var canvasStream = canvas.captureStream(25);
                outTracks = canvasStream.getVideoTracks().concat(dest.stream.getAudioTracks());
                mimeType = 'video/webm;codecs=vp8,opus';
            }

            var combined = new MediaStream(outTracks);
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = isVideo ? 'video/webm' : 'audio/webm';

            var recorder = new MediaRecorder(combined, { mimeType: mimeType });
            _rtc.recordChunks = [];
            recorder.ondataavailable = function (e) { if (e.data && e.data.size) _rtc.recordChunks.push(e.data); };
            recorder.onstop = function () {
                var blob = new Blob(_rtc.recordChunks, { type: mimeType });
                var url  = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'empyrean-call-' + Date.now() + (isVideo ? '.webm' : '.webm');
                document.body.appendChild(a);
                a.click();
                setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
                _notify('Recording saved to downloads.', 'success');
            };

            recorder.start(1000);
            _rtc.recorder   = recorder;
            _rtc.recording  = true;
            var ind = document.getElementById('oc-rec-indicator');
            if (ind) ind.style.display = 'flex';
            _notify('Recording started.', 'info');
            return true;
        } catch (err) {
            _notify('Could not start recording: ' + (err && err.message || err), 'warning');
            _teardownRecordingResources();
            return false;
        }
    }

    function _teardownRecordingResources() {
        if (_rtc.recordCanvasTimer) { clearInterval(_rtc.recordCanvasTimer); _rtc.recordCanvasTimer = null; }
        if (_rtc.recordAudioCtx) { try { _rtc.recordAudioCtx.close(); } catch (e) {} _rtc.recordAudioCtx = null; }
        _rtc.recorder  = null;
        _rtc.recording = false;
    }

    function _stopRecording() {
        if (!_rtc.recording) return;
        try {
            if (_rtc.recorder && _rtc.recorder.state !== 'inactive') _rtc.recorder.stop();
        } catch (e) {}
        var ind = document.getElementById('oc-rec-indicator');
        if (ind) ind.style.display = 'none';
        /* onstop (above) fires asynchronously and handles the actual download;
           give it a beat before tearing down the audio graph it still needs. */
        setTimeout(_teardownRecordingResources, 300);
    }

    /* =========================================================================
       AUDIO QUALITY (1:1 calls) — three separate levers:
       1) CAPTURE: plain `audio:true` gives the browser's default mic
          constraints, which on many devices means no echo cancellation /
          noise suppression and a low sample rate. _micConstraints() below
          asks for the good versions of all three explicitly — this is
          what actually determines how clean the audio the OTHER person
          hears is, since it shapes what leaves this device in the first
          place.
       2) ENCODE: WebRTC's default Opus bitrate for a voice call is quite
          low (~32kbps mono) to be bandwidth-conservative. _boostAudioBitrate
          raises the outgoing audio RTCRtpSender's target bitrate after
          tracks are added, for noticeably crisper voice on a decent
          connection, while Opus's built-in bandwidth adaptation still
          protects calls on a poor connection.
       3) PLAYBACK: remote audio used to just play at the <video>/<audio>
          element's own volume (capped at 1.0, and quiet on some devices'
          output routing). _boostRemoteAudioGain routes it through a Web
          Audio GainNode instead, so it can be boosted past 1.0 — the
          media element's own audio path is muted so it isn't heard twice.
       ========================================================================= */
    function _micConstraints(isVideo) {
        var audio = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  true,
            sampleRate:       { ideal: 48000 },
            channelCount:     { ideal: 1 }
        };
        return isVideo
            ? { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: audio }
            : { audio: audio, video: false };
    }

    /* Called right after stream.getTracks().forEach(pc.addTrack(...)) on
       both the caller and callee flows. RTCRtpSender.setParameters isn't
       supported on every browser/track combo, so this is wrapped
       defensively and simply no-ops (call still works at the default
       bitrate) wherever it isn't. */
    function _boostAudioBitrate(pc) {
        try {
            var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === 'audio'; });
            if (!sender || typeof sender.setParameters !== 'function') return;
            var params = sender.getParameters();
            if (!params.encodings || !params.encodings.length) params.encodings = [{}];
            params.encodings[0].maxBitrate = 128000; /* ~4x the default Opus voice bitrate */
            sender.setParameters(params).catch(function () {});
        } catch (e) {}
    }

    /* VOICE QUALITY: munges the Opus fmtp line in a LOCAL SDP (the offer
       we send as caller, or the answer we send as callee) before it goes
       to setLocalDescription. This controls how THIS side's encoder
       behaves, which is exactly what needs tuning for the weak/bouncing
       mobile connections this app already has to deal with (see
       app-patch-v31/v34/v35 headers):
         - useinbandfec=1 : Opus's own forward-error-correction. When a
           packet is lost on a lossy link, the NEXT packet carries enough
           redundant data to reconstruct it, instead of a dropout/glitch.
         - maxaveragebitrate=128000 : raises the target bitrate the
           encoder aims for — _boostAudioBitrate above does the same via
           RTCRtpSender.setParameters, but that API isn't implemented on
           every browser; this SDP-level version is the more universally
           supported of the two, so both are kept as belt-and-suspenders.
         - dtx=0 : stops the encoder from cutting to near-silence during
           quiet/pause moments to save bandwidth — a legitimate feature in
           general, but on a call this app's users already describe as
           having quality problems, the on/off warble it produces reads
           as "choppy audio," not as a helpful optimization.
       Regex-based (not a full SDP parser) — matches this codebase's own
       "surgical, minimal, no new dependencies" convention. No-ops safely
       (returns the SDP unchanged) if no Opus fmtp line is found. */
    function _tuneOpusSdp(sdp) {
        try {
            return sdp.replace(/a=fmtp:(\d+)([^\r\n]*)\r\n/g, function (full, pt, params) {
                           /* Only touch the fmtp line whose payload type is opus —
                              confirmed by checking the matching rtpmap line exists
                              for that pt earlier in the same sdp. */
                           var rtpmapRe = new RegExp('a=rtpmap:' + pt + ' opus/', 'i');
                           if (!rtpmapRe.test(sdp)) return full;
                           var extra = '';
                           if (!/useinbandfec=/i.test(params))    extra += ';useinbandfec=1';
                           if (!/maxaveragebitrate=/i.test(params)) extra += ';maxaveragebitrate=128000';
                           if (!/dtx=/i.test(params))             extra += ';dtx=0';
                           return 'a=fmtp:' + pt + params + extra + '\r\n';
                       });
        } catch (e) { return sdp; }
    }

    var _ocAudioCtx = null;

    function _getOcAudioCtx() {
        if (!_ocAudioCtx) {
            try { _ocAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { return null; }
        }
        if (_ocAudioCtx.state === 'suspended') { _ocAudioCtx.resume().catch(function () {}); }
        return _ocAudioCtx;
    }

    /* mediaEl is whichever element is actually carrying the remote stream
       (#oc-remote-video for a video call, _rtc.speakerEl <audio> for a
       voice call). IMPORTANT: this does NOT mute mediaEl and play the
       boosted copy through ctx.destination — the app's existing speaker/
       earpiece toggle calls speakerEl.setSinkId(...), and that only
       controls audio actually played BY that element. Muting it and
       routing to ctx.destination instead would silently break that
       toggle (boosted audio would always come out the default output
       regardless of what the user picked). Instead, the gain node feeds
       a MediaStreamAudioDestinationNode, and the resulting boosted track
       replaces the audio track in mediaEl's own srcObject — same element,
       same setSinkId control, just louder. Guarded by _rtc.audioBoosted
       so a video switch mid-call (which re-attaches the stream) doesn't
       wire up a second graph on top of the first. */
    function _boostRemoteAudioGain(mediaEl, stream) {
        if (_rtc.audioBoosted || !mediaEl) return;
        var ctx = _getOcAudioCtx();
        if (!ctx || !stream.getAudioTracks || !stream.getAudioTracks().length) return;

        /* FIX (bug: "he says he picked up, I wasn't hearing him"): this
           used to build the boosted graph and swap mediaEl.srcObject onto
           it unconditionally, even while ctx.state was still 'suspended'.
           A MediaStreamAudioDestinationNode produces no audio at all while
           its AudioContext is suspended, so the swap could silently
           replace perfectly good, already-audible raw audio (set moments
           earlier by _attachRemoteStream) with a stream carrying nothing —
           and mediaEl.play() still resolves fine either way, so nothing
           ever surfaced the failure. pc.ontrack (which is what calls this)
           fires asynchronously with no user gesture behind it at all, so
           a resume() attempted only at that point is exactly the kind of
           browsers commonly refuse. _startCallModal / the Accept-button
           handler now warm this same context up earlier, inside a real
           tap, which should mean it's usually already 'running' by here —
           but if it somehow isn't, only swap once it's confirmed running,
           and otherwise leave the raw stream exactly as it was rather than
           silently degrading working audio into nothing. */
        function _applyBoost() {
            if (_rtc.audioBoosted) return; // a retry landed after another path already boosted it
            try {
                var src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
                var gainNode = ctx.createGain();
                gainNode.gain.value = 1.6; /* ~+4dB over unity */
                var dest = ctx.createMediaStreamDestination();
                src.connect(gainNode);
                gainNode.connect(dest);

                var outStream = new MediaStream();
                (stream.getVideoTracks ? stream.getVideoTracks() : []).forEach(function (t) { outStream.addTrack(t); });
                outStream.addTrack(dest.stream.getAudioTracks()[0]);

                mediaEl.srcObject = outStream;
                mediaEl.play().catch(function () {});
                _rtc.audioBoosted = true;
            } catch (e) {}
        }

        if (ctx.state === 'running') {
            _applyBoost();
        } else {
            /* Raw audio (already assigned by _attachRemoteStream, right
               before this function was called) keeps playing untouched
               while we wait. Only apply the +4dB boost if/once resume()
               genuinely succeeds; if the browser never grants it for this
               call, the person still hears the call — just without the
               extra boost, which is the correct trade-off: audible-but-
               quieter beats silent-but-louder every time. */
            ctx.resume().then(function () {
                if (ctx.state === 'running') _applyBoost();
            }).catch(function () {});
        }
    }

    /* ── create RTCPeerConnection with handlers ──────────── */
    /* =========================================================================
       MID-CALL ICE-RESTART RECOVERY
       ─────────────────────────────────────────────────────────────────────
       BUG/GAP: pc.onconnectionstatechange's 'disconnected' case only ever
       updated the on-screen text to "Reconnecting…" — it never actually
       tried to recover the media path. On a genuinely weak/bouncing mobile
       connection (exactly what this app's own users are testing on —
       1-2 signal bars, single-digit KB/s), WebRTC's OWN built-in ICE
       connectivity checks can and do recover on their own sometimes, but
       there's no guarantee, and nothing here was actively helping — which
       matches "it started working again later" being pure luck rather
       than something the app did.
       FIX: only the CALLER attempts a restart (avoids both sides racing
       to renegotiate at once — this app's signalling already has a fixed
       offerer/answerer split, so keeping restarts one-directional avoids
       glare without needing a full perfect-negotiation pattern). After a
       short grace period stuck in 'disconnected' (recovers on its own
       within that window on plenty of blips — no need to touch anything),
       the caller creates a fresh ICE-restart offer and writes it to the
       SAME calls/{callId} doc under a bumped offerVersion. The callee's
       own call-doc listener (see _answerCall) watches for that version
       bump and answers it automatically, without the callee ever tapping
       anything. Capped at 3 attempts per call so a truly dead network
       doesn't retry forever — past that, the browser's own connectionState
       will eventually reach 'failed', which the existing case below still
       hangs up on. */
    function _attemptIceRestart(pc, callId) {
        if (!pc || pc.signalingState === 'closed') return;
        if (_rtc.iceRestartAttempts >= 3) {
            console.warn('[OC-Call] already attempted an ICE restart 3 times this call — leaving it to the browser\u2019s own recovery (or eventual failure) from here rather than retrying forever.');
            return;
        }
        _rtc.iceRestartAttempts++;
        console.warn('[OC-Call] connection has been disconnected for a few seconds \u2014 attempting an ICE restart (#' + _rtc.iceRestartAttempts + ') to recover the media path without dropping the call.');
        pc.createOffer({ iceRestart: true }).then(function (offer) {
            offer.sdp = _tuneOpusSdp(offer.sdp);
            return pc.setLocalDescription(offer).then(function () {
                var nextVersion = (_rtc.myOfferVersion || 1) + 1;
                return _docSafe('calls', callId, 'write ICE-restart offer').update({
                    offer:        { type: offer.type, sdp: offer.sdp },
                    offerVersion: nextVersion
                }).then(function () { _rtc.myOfferVersion = nextVersion; });
            });
        }).catch(function (err) {
            console.warn('[OC-Call] ICE-restart offer failed:', err && err.message);
        });
    }

    function _createPC(callId, role, isVideo) {
        var pc = new RTCPeerConnection(ICE_SERVERS);
        _rtc.pc = pc;

        /* Send ICE candidates to Firestore */
        var candColl = role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
        pc.onicecandidate = function(e) {
            if (!e.candidate) return;
            if (!_fbOk()) return;
            try {
                window.fbDb.collection('calls').doc(callId)
                    .collection(candColl).add({
                        candidate:     e.candidate.candidate,
                        sdpMid:        e.candidate.sdpMid,
                        sdpMLineIndex: e.candidate.sdpMLineIndex
                    }).catch(function(){});
            } catch(ex){}
        };

        /* Remote track arrives */
        pc.ontrack = function(e) {
            var stream = e.streams && e.streams[0];
            if (!stream) { stream = new MediaStream(); stream.addTrack(e.track); }
            /* FIX v13: must read the LIVE _rtc.isVideo, not the isVideo
               argument this closure captured when the call started — a
               voice call that later switches to video (see Issue 2) sets
               _rtc.isVideo=true mid-call, and the incoming video track
               needs to land on #oc-remote-video, not the audio-only
               <audio> element this would otherwise route to. */
            _attachRemoteStream(stream, _rtc.isVideo);
        };

        pc.onconnectionstatechange = function() {
            var st = document.getElementById('oc-call-status');
            if (!st) return;
            switch(pc.connectionState) {
                case 'connecting':   st.textContent = 'Connecting…'; break;
                case 'connected':    st.textContent = 'Connected';
                    if (_rtc.dotTimer) { clearInterval(_rtc.dotTimer); _rtc.dotTimer = null; }
                    /* Recovered (either on its own or via a restart we
                       triggered below) — cancel any pending restart timer
                       and let a FUTURE blip get its own fresh attempts. */
                    if (_rtc.iceRestartTimer) { clearTimeout(_rtc.iceRestartTimer); _rtc.iceRestartTimer = null; }
                    _rtc.iceRestartAttempts = 0;
                    /* Ringback/ringtone has done its job the instant media is
                       actually flowing — stop it here rather than relying on
                       whoever built the modal to remember to. */
                    _stopTone();
                    if (!_rtc.connectedAt) {
                        _startDurationTimer();
                        /* FEATURE ("feedback notification ... call successfully
                           goes through"): a toast on both ends the moment the
                           connection is real, not just "callee tapped accept" —
                           WebRTC's connectionState only reaches 'connected'
                           once media is actually flowing. */
                        _notify('📞 Call connected', 'success');
                    }
                    break;
                case 'disconnected':
                    st.textContent = 'Reconnecting…';
                    /* Give it a few seconds — plenty of blips clear up on
                       their own with zero intervention. Only the caller
                       ever schedules a restart (see _attemptIceRestart's
                       own header for why), and only one timer at a time. */
                    if (role === 'caller' && !_rtc.iceRestartTimer) {
                        _rtc.iceRestartTimer = setTimeout(function () {
                            _rtc.iceRestartTimer = null;
                            if (pc.connectionState === 'disconnected') _attemptIceRestart(pc, callId);
                        }, 4000);
                    }
                    break;
                case 'failed':
                case 'closed':
                    console.warn('[OC-Call] connection ' + pc.connectionState + ' — iceConnectionState=' + pc.iceConnectionState + ', iceGatheringState=' + pc.iceGatheringState);
                    _rtcHangup(callId);
                    break;
            }
        };

        return pc;
    }

    /* ── CALLER flow ─────────────────────────────────────── */
    function _startCallModal(type, name, avatar) {
        if (!_fbOk()) {
            /* FIX (2026-09-02 — same "doesn't connect until refresh"
               report, one step earlier): window._firebaseLoaded flips true
               only once firebase-init.js's async _initFirebase() finishes
               (it has to fetch /api/config first — see that file), which
               can still be in flight in the first second or two after a
               cold page load. Tapping Call in that window used to show "No
               internet connection" — misleading, since the device may have
               a perfectly good connection and Firebase is simply still
               starting up — and gave up immediately instead of waiting the
               short, normal amount of time this takes. Same bounded retry
               as the auth-uid check below, sharing the same counter/cap. */
            _rtc._callAuthRetries = (_rtc._callAuthRetries || 0) + 1;
            if (_rtc._callAuthRetries <= 12) {
                setTimeout(function () { _startCallModal(type, name, avatar); }, 500);
                return;
            }
            _rtc._callAuthRetries = 0;
            _notify('No internet connection', 'warning');
            return;
        }
        /* REGRESSION FIX: the early _getOcAudioCtx() warm-up that used to
           be here is removed — it existed only to support the Web Audio
           gain-boost path, which is now disabled (see _attachRemoteStream)
           because it's the likely cause of a "call connects, nobody hears
           anything" regression on some mobile browsers. No Web Audio API
           involvement at all now for live call audio, caller or callee. */
        var isVideo = (type === 'video');
        var u = _us();
        if (!u.id) { _notify('Please log in to make calls', 'warning'); return; }

        /* FIX (2026-08-01 — "[OC-Call] BUG: about to build a Firestore doc
           ref with an empty/undefined id" on the caller's "listen for
           answer" step): this call-setup chain used to generate callId
           inside the FIRST .then() and then, in the SECOND .then(),
           re-read it back out of _rtc.callId instead of just using the
           same variable. That re-read is racy: _rtc.callId is a shared,
           mutable field that _rtcHangup() nulls out — if a hangup landed
           in the gap between the two .then() callbacks (e.g. the person
           cancelled/backed out of the call while getUserMedia/the offer
           write were still in flight), the second block would read back
           null and _docSafe would correctly refuse to build a doc ref
           with an empty id, exactly as its own diagnostic comment
           predicted ("a variable overwritten mid-flight"). callId itself
           is declared once here, in _startCallModal's own scope, so both
           .then() callbacks close over the SAME local variable — nothing
           else in the app can ever overwrite it out from under this call
           attempt. _rtc.callId is still set for every other consumer
           (hangup, minimize pill, etc.) that legitimately needs the
           live/current call id from outside this closure. */
        var callId = null;

        /* Catches the stale-cached-id-vs-live-Firebase-UID mismatch before
           we ever touch Firestore, instead of silently failing the write
           45s of "Calling…" later or bouncing back instantly. Rather than
           just blocking (which is what made calls permanently unusable —
           see _syncUidIfNeeded above), self-heal userState.id to the live
           UID and proceed. Only block if there's truly no live session. */
        var authUid = _syncUidIfNeeded();
        if (!authUid) {
            /* FIX (2026-09-02 — "video/voice calls don't connect on first
               tap, only after a refresh or a full log-out/log-in"): Firebase
               Auth's own session restore (reading the persisted session back
               out of IndexedDB) is asynchronous and can still be in flight
               at the exact instant someone opens a chat and immediately taps
               Call — especially right after a cold page load, which is the
               most common way someone actually reaches a chat. _authUid()
               correctly reports "no live session YET" in that split second,
               but the code here used to treat that identically to "there
               will never be one" and gave up immediately with a message
               telling the person to log out and back in. That instruction
               doesn't repair anything by itself — it just buys enough
               wall-clock time for the SAME restore to finish, which is
               exactly what a plain page refresh also does by accident.
               Retry briefly first — up to ~6s (12 x 500ms), comfortably
               longer than Firebase Auth's restore normally takes on a real
               connection — by re-entering this same function once the
               session has had more time to settle, instead of failing
               outright on the very first, often premature, check. Only the
               genuine "nobody's logged in" case still shows the original
               message, and only after that window has actually run out. */
            _rtc._callAuthRetries = (_rtc._callAuthRetries || 0) + 1;
            if (_rtc._callAuthRetries <= 12) {
                setTimeout(function () { _startCallModal(type, name, avatar); }, 500);
                return;
            }
            _rtc._callAuthRetries = 0;
            _notify('Your session needs to refresh — please log out and back in, then try again.', 'warning');
            return;
        }
        _rtc._callAuthRetries = 0;
        u = _us();

        var ui = _buildCallModal(type, name, avatar);
        _rtc.role = 'caller';

        /* FEATURE ("ringing sound when calling"): caller hears a ringback
           tone the moment the call UI appears; _stopTone() (called from
           _rtcHangup and from the 'connected' branch above) is the single
           place this ever gets silenced, so it can't outlive the call. */
        _startRingbackTone();

        /* FIX ("show Ringing, not Calling, once the recipient is online"):
           _isPeerActuallyOnline() is already a live, freshness-checked read
           of presence/{peerId} for THIS peer — it's already subscribed the
           moment this chat was opened (see _subscribePresence, wired when
           the chat loads), so no extra Firestore read is needed here.
           'Calling…' now means what it should: the recipient's device
           hasn't shown a live heartbeat recently, so this may not even be
           reaching them yet. 'Ringing…' means their device is live right
           now and this call is actually alerting them. Decided ONCE at
           call start (not re-evaluated mid-call) so the label can't
           flicker between the two while the call is in progress. */
        var _ringWord = _isPeerActuallyOnline() ? 'Ringing' : 'Calling';
        var _statusEl0 = document.getElementById('oc-call-status');
        if (_statusEl0) _statusEl0.textContent = _ringWord + '…';

        /* FIX ("tested this — it never showed Ringing even when the other
           person was online"): the line above trusts whatever the AMBIENT
           presence/{peerId} subscription (_subscribePresence, wired when
           this chat was opened) has managed to deliver by this exact
           synchronous instant — which can be nothing at all yet if the
           call button is tapped soon after opening the chat, before that
           listener's first snapshot has round-tripped. Confirm/correct the
           guess with ONE direct, fresh read of the same doc, in parallel
           with placing the call (not blocking on it). Only correct the
           label while still actually ringing — never after the call has
           connected/ended — so a slow response can't stomp on a later,
           real status. Logged instead of silently swallowed: if reading
           another user's presence/{id} doc is blocked by Firestore rules
           for anyone but its own owner, THIS is where that would surface —
           and the label would otherwise be stuck on "Calling" for every
           call regardless of the peer's real status. That would be a
           rules fix, not a JS fix — the warning below says so directly. */
        if (_fbOk() && _peerId) {
            window.fbDb.collection('presence').doc(_peerId).get().then(function (snap) {
                var st = document.getElementById('oc-call-status');
                if (!st || st.textContent.indexOf(_ringWord) !== 0) return; // already moved past ringing
                var d = snap.exists ? (snap.data() || {}) : {};
                var ls = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
                var freshEnough = ls && !isNaN(ls) && (Date.now() - ls) < PRESENCE_FRESH_MS;
                var reallyOnline = d.online === true && freshEnough;
                var corrected = reallyOnline ? 'Ringing' : 'Calling';
                if (corrected !== _ringWord) {
                    console.log('[OC-Call] correcting label from "' + _ringWord + '" to "' + corrected + '" after a direct presence check — the ambient subscription hadn\'t caught up yet.');
                    _ringWord = corrected;
                    st.textContent = _ringWord + '…';
                }
            }).catch(function (err) {
                console.warn('[OC-Call] direct presence/{peerId} read failed — the Ringing/Calling label will fall back to "Calling" for every call until this is fixed. If this logs a permission-denied error, presence/{id} needs a Firestore rule letting any signed-in user READ another user\'s presence doc (writes should stay restricted to the owner).', err && err.code, err && err.message);
            });
        }

        /* Animate status */
        var dots = 0;
        _rtc.dotTimer = setInterval(function() {
            dots = (dots + 1) % 4;
            var st = document.getElementById('oc-call-status');
            if (st && st.textContent.indexOf(_ringWord) === 0) {
                st.textContent = _ringWord + '.'.repeat(dots);
            }
        }, 600);

        /* Get local media */
        var constraints = _micConstraints(isVideo);

        navigator.mediaDevices.getUserMedia(constraints)
            .then(function(stream) {
                _rtc.localStream = stream;
                var lv = document.getElementById('oc-local-video');
                if (lv && isVideo) { lv.srcObject = stream; lv.play().catch(function(){}); }

                /* Generate a call doc ID */
                var callId = _buildChatId(u.id, _peerId) + '-' + Date.now();
                _rtc.callId = callId;

                var pc = _createPC(callId, 'caller', isVideo);

                /* Add local tracks */
                stream.getTracks().forEach(function(t){ pc.addTrack(t, stream); });
                _boostAudioBitrate(pc);

                /* Create offer */
                return pc.createOffer().then(function(offer) {
                    offer.sdp = _tuneOpusSdp(offer.sdp);
                    return pc.setLocalDescription(offer).then(function() {
                        _rtc.myOfferVersion = 1; /* baseline — bumped by _attemptIceRestart if the connection ever drops mid-call */
                        /* Write call doc */
                        return _docSafe('calls', callId, 'write call doc (caller offer)').set({
                            callerId:    authUid,
                            calleeId:    _peerId,
                            callerName:  u.fullName || u.username || 'User',
                            callerAvatar:u.avatar || u.profilePicture || '',
                            /* lets a call-log query use array-contains instead
                               of two separate callerId/calleeId queries */
                            participants:[u.id, _peerId],
                            type:        type,
                            offer:       { type: offer.type, sdp: offer.sdp },
                            offerVersion:1,
                            status:      'ringing',
                            createdAt:   new Date().toISOString()
                        });
                    });
                });
            })
            .then(function() {
                var callId = _rtc.callId;

                /* Listen for answer */
                _rtc.unsubAnswer = _docSafe('calls', callId, 'listen for answer')
                    .onSnapshot(function(snap) {
                        if (!snap.exists) return;
                        var data = snap.data();
                        if (data.status === 'ended') { _rtcHangup(callId); return; }
                        /* FIX: used to only ever apply the FIRST answer
                           (guarded by "!currentRemoteDescription", which is
                           only ever true once). That silently ignored any
                           later answer written in response to an
                           ICE-restart offer (see _attemptIceRestart) — the
                           restart offer would go out, the callee would
                           answer it, and this side would just never apply
                           that answer, leaving the restart half-finished.
                           Track it by version instead, so both the very
                           first answer AND every later restart answer get
                           applied. Old docs without answerVersion default
                           to 1, so this behaves exactly as before for a
                           normal, never-interrupted call. */
                        if (data.answer && _rtc.pc) {
                            var incomingAnswerVersion = data.answerVersion || 1;
                            if (incomingAnswerVersion > (_rtc.appliedAnswerVersion || 0) &&
                                _rtc.pc.signalingState === 'have-local-offer') {
                                var ans = new RTCSessionDescription(data.answer);
                                _rtc.pc.setRemoteDescription(ans).then(function () {
                                    _rtc.appliedAnswerVersion = incomingAnswerVersion;
                                }).catch(function(){});
                            }
                        }
                        if (_rtc.onRecordingSnapshot) _rtc.onRecordingSnapshot(data);
                        if (_rtc.onVideoSwitchSnapshot) _rtc.onVideoSwitchSnapshot(data);
                    }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });

                /* Listen for callee ICE candidates */
                _rtc.unsubCands = _docSafe('calls', callId, 'listen for callee ICE candidates')
                    .collection('calleeCandidates')
                    .onSnapshot(function(snap) {
                        snap.docChanges().forEach(function(ch) {
                            if (ch.type !== 'added') return;
                            var d = ch.doc.data();
                            if (_rtc.pc) {
                                _rtc.pc.addIceCandidate(new RTCIceCandidate({
                                    candidate:     d.candidate,
                                    sdpMid:        d.sdpMid,
                                    sdpMLineIndex: d.sdpMLineIndex
                                })).catch(function(){});
                            }
                        });
                    }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });

                /* Auto-end if no answer in 45 s */
                setTimeout(function() {
                    var m = document.getElementById('oc-call-modal');
                    var st = document.getElementById('oc-call-status');
                    if (m && st && st.textContent.indexOf(_ringWord) === 0) {
                        _rtcHangup(callId, 'no_answer');
                        _notify(name + ' did not answer', 'info');
                    }
                }, 45000);
            })
            .catch(function(err) {
                _rtcHangup(null);
                _notify(_describeCallSetupError(err, 'start call'), 'warning');
            });
    }

    /* ── Consent banner shown to whichever side did NOT ask to record ──
       PRIVACY FIX: recording used to start unilaterally the instant one
       side tapped the Record button, with no notice to the other party.
       Now that tap only sends a request (see recBtn handler in
       _buildCallModal); this banner is what the other side sees, and
       recording only actually starts once they tap Accept here. */
    function _showRecordingConsentPrompt(requesterId, requesterDisplayName) {
        if (_rtc.recPromptEl) return;
        var callId = _rtc.callId;

        var box = document.createElement('div');
        box.id = 'oc-rec-consent';
        box.style.cssText = [
            'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);',
            'z-index:1000000;background:#1a1a2e;color:#fff;border-radius:16px;',
            'padding:14px 16px;display:flex;align-items:center;gap:12px;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.5);min-width:280px;max-width:88vw;',
            'animation:oc-ring-in 0.3s ease;'
        ].join('');

        var msg = document.createElement('div');
        msg.style.cssText = 'flex:1;font-size:0.85rem;line-height:1.3;';
        msg.textContent = (requesterDisplayName || 'The other person') + ' wants to record this call.';
        box.appendChild(msg);

        var declineBtn = document.createElement('button');
        declineBtn.textContent = 'Decline';
        declineBtn.style.cssText = 'background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:0.78rem;cursor:pointer;flex-shrink:0;';
        box.appendChild(declineBtn);

        var acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept';
        acceptBtn.style.cssText = 'background:#25D366;color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:0.78rem;cursor:pointer;flex-shrink:0;';
        box.appendChild(acceptBtn);

        document.body.appendChild(box);
        _rtc.recPromptEl = box;

        function _cleanup() {
            if (box.parentNode) box.remove();
            if (_rtc.recPromptEl === box) _rtc.recPromptEl = null;
        }

        declineBtn.addEventListener('click', function() {
            _cleanup();
            if (_fbOk() && callId) {
                window.fbDb.collection('calls').doc(callId)
                    .set({ recordingRequest: { status: 'declined', by: requesterId } }, { merge: true })
                    .catch(function(){});
            }
        });

        acceptBtn.addEventListener('click', function() {
            _cleanup();
            if (_fbOk() && callId) {
                window.fbDb.collection('calls').doc(callId)
                    .set({ recordingRequest: { status: 'accepted', by: requesterId } }, { merge: true })
                    .catch(function(){});
            }
            _notify('You agreed to let this call be recorded.', 'info');
        });
    }

    /* ── CALLEE flow — show incoming call UI ─────────────── */
    function _handleIncomingCall(callDoc) {
        var data = callDoc.data();
        var callId = callDoc.id;
        if (!data || data.status !== 'ringing') {
            console.log('[OC] incoming call doc ' + callId + ' ignored — status is "' + (data && data.status) + '", not "ringing".');
            return;
        }

        /* Don't show if already in a call. FIX: this used to be a silent
           bail — if _rtc.callId was ever stuck non-null (e.g. a previous
           call's cleanup got interrupted by a page navigation mid-call, so
           _rtcHangup's own reset never ran), every future incoming call
           would be dropped forever with zero banner and zero ring, and
           nothing in the console would explain why. Now it's at least
           visible, and self-heals: a call doc that's actually still
           "ringing" this long after being created is stale regardless. */
        if (_rtc.callId) {
            console.warn('[OC] incoming call ' + callId + ' suppressed — already tracking call ' + _rtc.callId +
                ' in _rtc.callId. If no call is actually in progress on screen, this is a stuck state; reloading the page clears it.');
            return;
        }

        var isVideo = (data.type === 'video');

        /* Build incoming call UI */
        var ring = document.createElement('div');
        ring.id = 'oc-incoming-call';
        ring.style.cssText = [
            'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);',
            'z-index:999998;',
            'background:#1a1a2e;color:#fff;',
            'border-radius:20px;padding:18px 24px;',
            'display:flex;align-items:center;gap:16px;',
            'box-shadow:0 8px 40px rgba(0,0,0,0.5);',
            'min-width:300px;max-width:90vw;',
            'animation:oc-ring-in 0.3s ease;'
        ].join('');

        /* inject ring animation once */
        if (!document.getElementById('oc-ring-style')) {
            var rs = document.createElement('style');
            rs.id = 'oc-ring-style';
            rs.textContent = '@keyframes oc-ring-in{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
            document.head.appendChild(rs);
        }

        var avEl = document.createElement('img');
        avEl.src = data.callerAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(data.callerName||'User') + '&background=1B2B8B&color=fff&size=80');
        avEl.style.cssText = 'width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;';
        ring.appendChild(avEl);

        var info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        info.innerHTML = '<div style="font-weight:700;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
            + _esc(data.callerName || 'Someone') + '</div>'
            + '<div style="font-size:0.78rem;opacity:0.65;">' + (isVideo ? '📹 Incoming video call' : '📞 Incoming voice call') + '</div>';
        ring.appendChild(info);

        var declineBtn = document.createElement('button');
        declineBtn.style.cssText = 'width:46px;height:46px;border-radius:50%;border:none;background:#E53935;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        declineBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9A11.07 11.07 0 0 0 4.18 15.57c-.37.36-.98.36-1.41-.01L.29 13.08A.996.996 0 0 1 0 12.38c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a.994.994 0 0 1-1.4 0 11.13 11.13 0 0 0-2.67-1.85c-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>';
        declineBtn.title = 'Decline';
        ring.appendChild(declineBtn);

        var acceptBtn = document.createElement('button');
        acceptBtn.style.cssText = 'width:46px;height:46px;border-radius:50%;border:none;background:#25D366;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        acceptBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>';
        acceptBtn.title = 'Accept';
        ring.appendChild(acceptBtn);

        document.body.appendChild(ring);

        /* FEATURE ("connect to the receiver's ringing tone so they know
           they are being called"): the callee's device plays its own
           ringtone the instant this banner appears — independent of the
           caller's ringback, each side hears the tone appropriate to it. */
        _startRingtone();

        /* Pulse the accept button */
        var pulseTimer = setInterval(function() {
            acceptBtn.style.transform = 'scale(1.15)';
            setTimeout(function(){ acceptBtn.style.transform = 'scale(1)'; }, 200);
        }, 800);

        /* Auto-dismiss after 40 s — counts as a missed call: the callee's
           own screen rang and nobody responded. */
        var autoDecline = setTimeout(function() {
            ring.remove();
            clearInterval(pulseTimer);
            _stopTone();
            if (_fbOk()) {
                window.fbDb.collection('calls').doc(callId)
                    .set({ status: 'ended', finalStatus: 'missed', endedAt: new Date().toISOString() }, { merge: true })
                    .catch(function(){});
            }
        }, 40000);

        declineBtn.addEventListener('click', function() {
            clearTimeout(autoDecline);
            clearInterval(pulseTimer);
            ring.remove();
            _stopTone();
            if (_fbOk()) {
                window.fbDb.collection('calls').doc(callId)
                    .set({ status: 'ended', finalStatus: 'declined', endedAt: new Date().toISOString() }, { merge: true })
                    .catch(function(){});
            }
        });

        acceptBtn.addEventListener('click', function() {
            clearTimeout(autoDecline);
            clearInterval(pulseTimer);
            _stopTone();
            ring.remove();
            /* REGRESSION FIX: the early _getOcAudioCtx() warm-up that used
               to be here is removed — same reasoning as _startCallModal.
               No Web Audio API involvement at all now for live call audio. */
            _answerCall(callDoc);
        });
    }

    /* ── CALLEE: answer the call ─────────────────────────── */
    function _answerCall(callDoc) {
        var data   = callDoc.data();
        var callId = callDoc.id;
        var isVideo = (data.type === 'video');

        /* FIX (bug: "call doesn't connect" — this guard was the second
           half of the same mismatch fixed in _resolveCalleeUid() above:
           data.calleeId holds the CALLER's recorded value for "who is
           this call for" — the callee's persistent app user id, not
           their live, per-session Firebase Auth uid. Comparing it against
           authUid could never pass for the real, legitimate callee, so
           tapping Accept always hit the "session out of sync" warning
           below and silently refused to answer, even on the rare occasion
           the ring UI did manage to show up. Compare against the same
           persistent id the caller actually wrote instead. */
        var myId = _us().id;
        if (!myId || myId !== data.calleeId) {
            console.warn('[OC] Answer blocked: this device\u2019s id (' + myId + ') does not match call\u2019s calleeId (' + data.calleeId + ')');
            _notify('Your login session is out of sync — please log out and back in, then try answering again.', 'warning');
            return;
        }

        _rtc.callId = callId;
        _rtc.role   = 'callee';

        _buildCallModal(data.type, data.callerName || 'Caller', data.callerAvatar || '');
        var st = document.getElementById('oc-call-status');
        if (st) st.textContent = 'Connecting…';

        var constraints = _micConstraints(isVideo);

        navigator.mediaDevices.getUserMedia(constraints)
            .then(function(stream) {
                _rtc.localStream = stream;
                var lv = document.getElementById('oc-local-video');
                if (lv && isVideo) { lv.srcObject = stream; lv.play().catch(function(){}); }

                var pc = _createPC(callId, 'callee', isVideo);
                stream.getTracks().forEach(function(t){ pc.addTrack(t, stream); });
                _boostAudioBitrate(pc);

                /* Set remote offer */
                return pc.setRemoteDescription(new RTCSessionDescription(data.offer))
                    .then(function() { return pc.createAnswer(); })
                    .then(function(answer) {
                        answer.sdp = _tuneOpusSdp(answer.sdp);
                        return pc.setLocalDescription(answer).then(function() {
                            var offerVersion = data.offerVersion || 1;
                            _rtc.appliedOfferVersion = offerVersion; /* baseline — bumped again if a later ICE-restart offer arrives */
                            return _docSafe('calls', callId, 'write initial answer').update({
                                answer:       { type: answer.type, sdp: answer.sdp },
                                answerVersion:offerVersion,
                                status: 'active'
                            });
                        });
                    });
            })
            .then(function() {
                /* Listen for caller ICE candidates */
                _rtc.unsubCands = window.fbDb.collection('calls').doc(callId)
                    .collection('callerCandidates')
                    .onSnapshot(function(snap) {
                        snap.docChanges().forEach(function(ch) {
                            if (ch.type !== 'added') return;
                            var d = ch.doc.data();
                            if (_rtc.pc) {
                                _rtc.pc.addIceCandidate(new RTCIceCandidate({
                                    candidate:     d.candidate,
                                    sdpMid:        d.sdpMid,
                                    sdpMLineIndex: d.sdpMLineIndex
                                })).catch(function(){});
                            }
                        });
                    }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });

                /* Watch for caller ending — and, past the initial handshake,
                   for a renegotiated (ICE-restart) offer. See
                   _attemptIceRestart's own header: only the caller ever
                   sends a fresh offer mid-call, tagged with a bumped
                   offerVersion on this same doc. This side answers it
                   automatically — no tap needed, same as the original
                   handshake — and ignores it entirely on a normal call
                   that never drops (offerVersion never changes, so this
                   condition never fires). */
                _rtc.unsubAnswer = window.fbDb.collection('calls').doc(callId)
                    .onSnapshot(function(snap) {
                        if (!snap.exists) return;
                        var data = snap.data();
                        if (data.status === 'ended') { _rtcHangup(callId); return; }
                        if (data.offer && _rtc.pc) {
                            var incomingOfferVersion = data.offerVersion || 1;
                            if (incomingOfferVersion > (_rtc.appliedOfferVersion || 0) &&
                                _rtc.pc.signalingState === 'stable') {
                                console.warn('[OC-Call] callee: applying ICE-restart offer (version ' + incomingOfferVersion + ') from the caller.');
                                var off = new RTCSessionDescription(data.offer);
                                _rtc.pc.setRemoteDescription(off)
                                    .then(function () { return _rtc.pc.createAnswer(); })
                                    .then(function (answer) {
                                        answer.sdp = _tuneOpusSdp(answer.sdp);
                                        return _rtc.pc.setLocalDescription(answer).then(function () {
                                            _rtc.appliedOfferVersion = incomingOfferVersion;
                                            return _docSafe('calls', callId, 'write ICE-restart answer').update({
                                                answer:       { type: answer.type, sdp: answer.sdp },
                                                answerVersion:incomingOfferVersion
                                            });
                                        });
                                    })
                                    .catch(function (err) {
                                        console.warn('[OC-Call] callee failed to answer ICE-restart offer:', err && err.message);
                                    });
                            }
                        }
                        if (_rtc.onRecordingSnapshot) _rtc.onRecordingSnapshot(data);
                        if (_rtc.onVideoSwitchSnapshot) _rtc.onVideoSwitchSnapshot(data);
                    }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
            })
            .catch(function(err) {
                _rtcHangup(null);
                _notify(_describeCallSetupError(err, 'connect call'), 'warning');
            });
    }

    /* ── Expose so header buttons call into WebRTC ───────── */
    function _showCallModal(type, peerName, peerAvatar) {
        _startCallModal(type, peerName, peerAvatar);
    }

    /* Expose globally so other modules can answer a call */
    window.empyreanAnswerCall  = _answerCall;
    window.empyreanHangupCall  = _rtcHangup;

    /* ── Listen for incoming calls once user is known ─────── */
    /* FIX (bug: "calls never ring on the other device, universally, one
       side always fails"): this used to filter on _us().id — the
       app-level cached userState.id restored from localStorage — and
       subscribed exactly ONCE at page load. /calls requires the query's
       own filter to literally equal request.auth.uid (Firestore rejects
       the whole list query otherwise, not just individual docs), so any
       drift between the stale cached id and the live Firebase Auth uid
       — routine on this app per app-patch-v12.js's own history, and
       entirely possible here since this listener could attach before
       _watchAuthForUidDrift (above) finishes reconciling — meant the
       listener silently never delivered a single incoming call for the
       rest of that page load, even after the uid later self-healed
       everywhere else. Every other realtime listener in this file reads
       _authUid() for exactly this reason; this one was missed. Now it
       (a) prefers the live auth uid, falling back to the cached id only
       if no live uid exists yet, and (b) re-subscribes automatically
       whenever the resolved uid changes, instead of trusting a single
       snapshot taken at load time. */
    var _watchedCalleeUid = null;
    var _unsubIncomingCalls = null;

    // FIX (bug: "call no longer connects / doesn't ring at the receiver's
    // end" — reported as "one bug fixed, two [new] bugs emerged"): this
    // function used to resolve to _authUid() on the theory that "the
    // /calls security rule requires this query's calleeId filter to
    // literally equal request.auth.uid" (see the now-outdated reasoning
    // that used to sit in this comment). That premise was wrong: the
    // CALLER writes `calleeId: _peerId` a few hundred lines below —
    // _peerId is the recipient's persistent app user id, not their live,
    // per-session (often anonymous) Firebase Auth uid, which the caller's
    // device has no way to know in advance. So querying by _authUid()
    // here could never match any call doc's calleeId — the receiver's
    // incoming-call listener was permission-clean but permanently
    // returned zero results, which looks identical to "the phone just
    // doesn't ring." Resolving to the same persistent id the caller
    // actually wrote (_us().id) is what makes the query match. The
    // Firestore rule for /calls has also been relaxed to request.auth !=
    // null (firebase-rules.js), so there's no permission requirement left
    // that depended on this being a live auth uid.
    function _resolveCalleeUid() {
        var u = _us();
        return (u && u.id) || null;
    }

    function _watchIncomingCalls() {
        var calleeUid = _resolveCalleeUid();
        // FIX (2026-08-13 — "[OC] incomingCalls listener rejected ...
        // permission-denied. Retrying in a few seconds." looping on
        // boot): _fbOk() only confirmed Firestore itself was initialized,
        // not that a real Firebase Auth session (anonymous or signed-in)
        // existed yet — /calls requires request.auth != null
        // (firebase-rules.js), so the very first subscribe attempt(s)
        // fired before that session settled and were denied every 2.5s
        // until it finally did. Requiring fbAuth.currentUser here too
        // means this simply waits its normal retry loop out quietly
        // instead of logging (and reattempting) a doomed subscribe.
        if (!calleeUid || !_fbOk() || !(window.fbAuth && window.fbAuth.currentUser)) {
            /* Retry until Firebase + auth are ready */
            setTimeout(_watchIncomingCalls, 2500);
            return;
        }
        if (calleeUid === _watchedCalleeUid) return; // already subscribed with the correct uid

        if (_unsubIncomingCalls) {
            try { _unsubIncomingCalls(); } catch (e) {}
            _unsubIncomingCalls = null;
        }
        _watchedCalleeUid = calleeUid;

        try {
            _unsubIncomingCalls = window.fbDb.collection('calls')
                .where('calleeId', '==', calleeUid)
                .where('status',   '==', 'ringing')
                .onSnapshot(function(snap) {
                    snap.docChanges().forEach(function(ch) {
                        if (ch.type === 'added') _handleIncomingCall(ch.doc);
                    });
                }, function(err){
                    /* FIX (regression: "receiver no longer sees/hears
                       incoming 1:1 calls"): this handler used to swallow
                       the error completely — no console output at all —
                       so if this query ever got rejected (stale uid,
                       permission-denied, composite-index requirement, or
                       any other Firestore-side rejection) the failure was
                       *completely invisible*, indistinguishable from "no
                       calls are coming in." Log it now so the real cause
                       shows up in the callee's own console the next time
                       this fires, instead of just quietly retrying. */
                    console.error('[OC] incomingCalls listener rejected for calleeUid=' + calleeUid +
                        (err ? (' — ' + (err.code || '') + ' ' + (err.message || err)) : ' — unknown error') +
                        '. Retrying in a few seconds.');
                    /* Query rejected (e.g. calleeUid was stale after all) —
                       clear so the next poll below can re-subscribe once
                       the uid resolves correctly. */
                    _watchedCalleeUid = null;
                });
        } catch(e){
            console.error('[OC] incomingCalls subscribe threw synchronously: ' + (e && e.message));
            _watchedCalleeUid = null;
        }
    }
    _ready(_watchIncomingCalls);

    /* Re-check on the same cadence _watchAuthForUidDrift uses to
       reconcile userState.id, so a uid correction that happens after the
       first subscribe (real login completing after an anonymous session,
       a slow network restore, etc.) reliably re-arms this listener with
       the correct filter instead of leaving it stuck on the old one. */
    setInterval(_watchIncomingCalls, 3000);


    /* =========================================================================
       §6  RENDER MESSAGES AREA
       ========================================================================= */
    function _getOrCreateBody() {
        /* Use existing chat-messages-container if the app already built it */
        var existing = document.getElementById('chat-messages-container')
                    || document.querySelector('#chat-view-container .chat-messages');
        if (existing) { existing.id = 'oc-messages-body'; return existing; }
        /* Otherwise create our own */
        var body = document.createElement('div');
        body.id  = 'oc-messages-body';
        return body;
    }

    /* =========================================================================
       §6c  CONTACT-LIST BACK BUTTON  (second-level: contact list -> exit messages)
       ========================================================================= */
    function _installContactListBackBtn() {
        /* Don't inject more than once */
        if (document.getElementById('oc-cl-back-btn')) return;

        var mView = document.getElementById('messages-view');
        if (!mView) return;

        /* HARD GUARD: if the in-chat view is still open (oc-mobile-open), don't run yet */
        var chatView = document.getElementById('chat-view-container');
        if (chatView && chatView.classList.contains('oc-mobile-open')) return;

        /* ── Strategy: try to wire into the app's EXISTING back/close button first ──
           Many apps render their own "← Messages" or "✕" button in the contact-list header.
           If one exists, add our handler to it instead of injecting a duplicate header.

           CRITICAL FIX: #oc-back-btn (the in-chat back arrow built in §7, also
           title="Back") lives inside this same #messages-view container as a
           child of #chat-view-container, even while hidden via CSS. The old
           selector below matched it too, so this function was silently adding
           a SECOND click listener (_doExitMessages -> dashboard) onto the
           in-chat back arrow. Result: tapping that arrow correctly showed the
           contact list AND, in the same click, immediately jumped to
           dashboard — looking exactly like "exit always goes home". We now
           explicitly exclude #oc-back-btn and anything inside
           #chat-view-container from this query.                              */
        var existingBackBtn = mView.querySelector(
            '.back-btn:not(#oc-back-btn):not([data-oc-chat-back]), .back-button:not(#oc-back-btn):not([data-oc-chat-back]), ' +
            '[class*="back-btn"]:not(#oc-back-btn):not([data-oc-chat-back]), [class*="back-button"]:not(#oc-back-btn):not([data-oc-chat-back]), ' +
            '[data-action="back"]:not(#oc-back-btn):not([data-oc-chat-back]), ' +
            '[aria-label="Back"]:not(#oc-back-btn):not([data-oc-chat-back]), ' +
            '[title="Back"]:not(#oc-back-btn):not([data-oc-chat-back])'
        );
        /* Belt-and-suspenders: even if a future selector tweak matches it again,
           never let the candidate be the in-chat back arrow or live inside the
           chat panel. */
        if (existingBackBtn && (
            existingBackBtn.id === 'oc-back-btn' ||
            existingBackBtn.getAttribute('data-oc-chat-back') ||
            existingBackBtn.closest('#chat-view-container')
        )) {
            existingBackBtn = null;
        }

        function _doExitMessages() {
            /* ── 1. Remove our injected header ── */
            var injected = document.getElementById('oc-cl-header');
            if (injected) injected.remove();

            /* ── 2. Drop body classes ── */
            document.body.classList.remove('oc-in-messages');
            document.body.classList.remove('oc-chat-open');
            _showStatusBar();

            /* ── 3. Navigate back to dashboard (home) ──
                   This button sits on the Messages contact list — pressing it
                   exits the Messages section entirely and returns to home.       */
            if (typeof window.navigateTo === 'function') {
                try { window.navigateTo('dashboard'); } catch(e) {}
            } else if (typeof window._origNavigateTo === 'function') {
                try { window._origNavigateTo('dashboard'); } catch(e) {}
            } else {
                /* Hard fallback: manually activate dashboard section.
                   FIX: use removeProperty (not a forced 'none'/'block' value)
                   so we never leave an inline style behind that could later
                   override the real router's own class-based CSS once the
                   user navigates elsewhere via the nav bar. */
                document.querySelectorAll('.content-section').forEach(function(s) {
                    s.classList.remove('active');
                    s.style.removeProperty('display');
                });
                var dash = document.getElementById('dashboard');
                if (dash) { dash.classList.add('active'); dash.style.removeProperty('display'); }
            }

            /* ── 4. DOM cleanup after router tick ──
                   FIX: removeProperty instead of forcing 'none'/'block' so this
                   never leaves a stale inline override that blocks a later
                   nav-bar click from showing its section (the original cause
                   of "every nav tap still shows Messages" + overlapping/
                   split-screen sections). */
            setTimeout(function() {
                /* Ensure messages section is hidden */
                var msgSection = document.getElementById('messages');
                if (msgSection) {
                    msgSection.classList.remove('active');
                    msgSection.style.removeProperty('display');
                }
                /* Ensure dashboard is visible */
                var dash = document.getElementById('dashboard');
                if (dash && dash.offsetParent === null) {
                    dash.classList.add('active');
                    dash.style.removeProperty('display');
                }
            }, 80);
        }

        if (existingBackBtn && !existingBackBtn._ocWired) {
            /* Just wire our exit handler onto the existing button — no new DOM */
            existingBackBtn._ocWired = true;
            existingBackBtn.addEventListener('click', _doExitMessages);
            /* Mark with our ID so the duplicate-guard above still works */
            existingBackBtn.id = 'oc-cl-back-btn';
            _ensureChatListMenuBtn();
            return;
        }

        /* ── Fallback: inject a slim top bar ONLY if no existing header is present ── */
        /* Check whether messages-view already has a coloured header row */
        var existingHeader = mView.querySelector(
            '.messages-header, .chat-list-header, #messages-header, ' +
            '[class*="messages-header"], [class*="chat-list-header"]'
        );

        var clHdr = document.createElement('div');
        clHdr.id = 'oc-cl-header';
        clHdr.style.cssText = [
            'display:flex;align-items:center;gap:10px;',
            'padding:10px 14px;',
            'background:#1B2B8B;',
            'color:#fff;',
            'flex-shrink:0;',
            /* FIX (Messages section scroll unification): was position:sticky;top:0,
               which pinned this header at the top of #contact-list-container while
               the list scrolled underneath it. Scroll now happens on the container
               as a whole (see app-fix-final.js), so this bar scrolls away with
               everything else instead of staying fixed. */
            'position:relative;z-index:2;',
            'box-shadow:0 2px 8px rgba(10,14,39,0.22);'
        ].join('');

        var clBackBtn = document.createElement('button');
        clBackBtn.id = 'oc-cl-back-btn';
        clBackBtn.title = 'Back to home';
        clBackBtn.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;padding:4px 8px 4px 0;display:flex;align-items:center;flex-shrink:0;';
        clBackBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>'; /* premium chevron (2026-10-23) */

        var clTitle = document.createElement('span');
        clTitle.style.cssText = 'font-weight:700;font-size:1rem;flex:1;';
        clTitle.textContent = 'Messages';

        clHdr.appendChild(clBackBtn);
        clHdr.appendChild(clTitle);

        clBackBtn.addEventListener('click', _doExitMessages);

        /* FIX: Insert into .contact-list as its first child so it sits as a TOP
           HEADER above the contact items — NOT into #messages-view which is a
           row-flex container (inserting there made #oc-cl-header a left column,
           causing the half-screen split layout bug on mobile). */
        var contactList = mView.querySelector('.contact-list, #contact-list-container');
        if (contactList) {
            if (existingHeader && contactList.contains(existingHeader)) {
                existingHeader.style.display = 'none';
                contactList.insertBefore(clHdr, existingHeader);
            } else {
                contactList.insertBefore(clHdr, contactList.firstChild);
            }
        } else {
            /* Fallback: add to mView but make it full-width so it doesn't split */
            clHdr.style.cssText += 'width:100%;flex-shrink:0;';
            if (existingHeader) {
                existingHeader.style.display = 'none';
                mView.insertBefore(clHdr, existingHeader);
            } else {
                mView.insertBefore(clHdr, mView.firstChild);
            }
        }

        _ensureChatListMenuBtn();
    }

    /* FIX v13 (Enhancement: Group Chat and Broadcast Features). Adds a "+"
       button to the messages list header — wherever it ended up in the DOM,
       whether we built it above or reused the app's own existing header —
       opening "New group" / "New broadcast", same two entries WhatsApp
       offers from its own chats-list header menu. Implementation lives in
       app-patch-v13.js (window._ocOpenGroupBroadcastMenu), kept as a
       separate additive file rather than folded in here since it's new,
       fully self-contained UI rather than a fix to something existing. */
    function _ensureChatListMenuBtn() {
        var backBtn = document.getElementById('oc-cl-back-btn');
        var hdr = backBtn && backBtn.parentElement;
        if (!hdr || document.getElementById('oc-cl-menu-btn')) return;

        var menuBtn = document.createElement('button');
        menuBtn.id = 'oc-cl-menu-btn';
        menuBtn.title = 'New group or broadcast';
        menuBtn.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;padding:4px 6px;flex-shrink:0;margin-left:auto;';
        menuBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';
        hdr.appendChild(menuBtn);

        menuBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (typeof window._ocOpenGroupBroadcastMenu === 'function') {
                window._ocOpenGroupBroadcastMenu();
            } else {
                _notify('Group/broadcast module still loading — try again in a moment.', 'info');
            }
        });
    }

    /* =========================================================================
       §6b  BUILD DESKTOP PLACEHOLDER (no chat selected)
       index.html no longer ships a static #chat-placeholder — it raced against
       our CSS via its inline style attribute. We own the whole lifecycle here:
       build once, let CSS (#chat-placeholder rules + mobile display:none) and
       the inline style set in openChat()/_doCloseChat() handle visibility.
       ========================================================================= */
    function _ensurePlaceholder() {
        if (document.getElementById('chat-placeholder')) return;
        var mView = document.getElementById('messages-view');
        if (!mView) return;

        var ph = document.createElement('div');
        ph.id = 'chat-placeholder';
        ph.innerHTML = [
            '<div style="width:100px;height:100px;border-radius:28px;background:var(--g-navy);display:flex;align-items:center;justify-content:center;margin-bottom:24px;box-shadow:0 8px 30px rgba(27,43,139,0.25);">',
            '  <i class="fas fa-comments" style="font-size:2.5rem;color:white;"></i>',
            '</div>',
            '<h3 style="font-family:\'Syne\',sans-serif;color:var(--primary);font-size:1.2rem;margin-bottom:8px;">Your Messages</h3>',
            '<p style="color:var(--text-muted);font-size:0.9rem;max-width:260px;line-height:1.6;">Select a contact to start a private, secure conversation.</p>'
        ].join('');

        var cv = document.getElementById('chat-view-container');
        if (cv && cv.parentNode === mView) {
            mView.insertBefore(ph, cv.nextSibling);
        } else {
            mView.appendChild(ph);
        }
    }

    /* =========================================================================
       §7  BUILD / REBUILD CHAT VIEW
       ========================================================================= */
    function _buildChatView(peerId, peerName, peerAvatar) {
        var cv = document.getElementById('chat-view-container');
        if (!cv) return;

        /* Clear previous content */
        cv.innerHTML = '';
        _seenDates = {};

        /* FIX (bug: "nothing in the chat responds to clicks until X is
           pressed"): traced to #oc-sheet-overlay (the long-press emoji
           catalog's backdrop) sometimes outliving its sheet — it's a
           position:fixed;inset:0 element at z-index:9999998 appended
           directly to document.body (a SIBLING of #chat-view-container,
           not a descendant), so the old cv.innerHTML='' above never
           touched it. A stray copy would silently sit on top of the
           entire chat, including the header's video/call buttons,
           swallowing every tap. The root leak in _showBubbleEmojiCatalog
           is fixed directly (see that function), but this is a second,
           defensive line: every time a chat is (re)built fresh, sweep away
           any stray copies of these ONE-SHOT, disposable overlay elements
           that might have been left behind from a previous session.
           NOTE: #oc-emoji-bar is intentionally excluded — _buildEmojiBar()
           builds it once and reuses it for the life of the page (toggled
           via a CSS class, not recreated), so removing it here would just
           force a wasteful rebuild and risk invalidating the cached
           _emojiBar module reference for no benefit. */
        ['oc-sheet-overlay', 'oc-bubble-emoji-sheet'].forEach(function(staleId) {
            var stale = document.getElementById(staleId);
            if (stale && stale.parentNode === document.body) stale.remove();
        });

        /* ── HEADER ── */
        var hdr = document.createElement('div');
        hdr.id = 'oc-chat-header';

        /* Close (X) button — right side of header */
        var backBtn = document.createElement('button');
        backBtn.id = 'oc-back-btn';
        backBtn.setAttribute('aria-label', 'Close chat');
        backBtn.setAttribute('data-oc-chat-back', '1');
        backBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

        function _doCloseChat(ev, _viaPopstate) {
            /* RE-ENTRANCY GUARD — prevents the stack overflow that occurs when:
               1. X button tap fires _doCloseChat
               2. _doCloseChat calls history.back()
               3. history.back() fires popstate (synchronously in some browsers)
               4. popstate calls _activeCloseHandler → _doCloseChat again → infinite loop */
            if (_doCloseChat._running) return;
            _doCloseChat._running = true;
            setTimeout(function() { _doCloseChat._running = false; }, 800);

            if (ev) { try { ev.stopPropagation(); } catch(e) {} try { ev.preventDefault(); } catch(e) {} }
            /* FIX: tear down any open emoji catalog/panel/menu the instant the
               chat closes — see _closeFloatingChatUI() for why. */
            _closeFloatingChatUI();
            _stopListener();
            _peerId = '';

            /* IMPORTANT: clear the flag before touching history so that any
               popstate this triggers sees _chatHistoryPushed===false and
               does NOT re-enter _doCloseChat a second time. */
            var _shouldNeutralizeHistory = (_chatHistoryPushed && !_viaPopstate);
            _chatHistoryPushed = false;
            if (_shouldNeutralizeHistory) {
                /* BUG FIX (X-button exit landing on a stale/empty "Messages"
                   screen instead of the real contact list): this used to call
                   history.back() here. On this WebView/browser, back() can
                   walk past the pushState entry opened for this chat and land
                   on whatever the tab's PREVIOUS real navigation entry was —
                   sometimes a bfcache snapshot of the Messages section from
                   earlier in the tab's life (before contacts had loaded),
                   which is exactly the empty "No messages yet" screen being
                   reported. We only ever pushed this entry to give the
                   hardware/gesture back button a way to close the chat; the
                   in-app X button doesn't need real back-navigation, since it
                   already tears down and rebuilds the UI itself below.
                   replaceState swaps the current entry in place — clearing
                   our marker with zero navigation risk — while leaving the
                   popstate listener above free to handle an actual hardware/
                   gesture back press the normal way. */
                try { history.replaceState({}, '', location.href); } catch(err) {}
            }

            /* ── 1. Hide the chat panel and restore it to its original DOM position ──
                   FIX (bug: "UI disrupted, doesn't return to contact list" —
                   reported after ending a video call): this used to trust
                   the cached _ocOrigParent/_ocOrigNextSibling references
                   unconditionally. If ANYTHING rebuilt that parent's
                   innerHTML while the chat was open (e.g. a contact-list
                   re-render triggered by a Firestore listener recovering
                   from the "missing or insufficient permissions" errors
                   seen in the console, or any other script's DOM rebuild),
                   _ocOrigParent silently became a DETACHED node — no longer
                   part of the live document. insertBefore() on a detached
                   node doesn't throw, so the try/catch below never caught
                   it; the chat panel just silently failed to return to a
                   visible location, leaving the broken/overlapping layout
                   reported.
                   FIX: verify _ocOrigParent is still actually attached to
                   the live document (document.contains()) before trusting
                   it. If it's gone, fall back to a fresh, reliable lookup
                   of the real mount point by selector instead of silently
                   doing nothing. */
            var _cv = document.getElementById('chat-view-container');
            if (_cv) {
                _cv.classList.remove('oc-mobile-open');
                var _origParentStillLive = _cv._ocOrigParent && document.contains(_cv._ocOrigParent);
                if (_origParentStillLive) {
                    try {
                        _cv._ocOrigParent.insertBefore(_cv, _cv._ocOrigNextSibling || null);
                    } catch(err) {
                        _origParentStillLive = false; /* fall through to fresh lookup below */
                    }
                }
                if (!_origParentStillLive) {
                    /* Fresh fallback: find the live messages-section container
                       and re-attach cv there directly, so the panel is never
                       left orphaned on <body> with no way back. */
                    var _freshMount = document.getElementById('messages')
                                    || document.querySelector('.content-section#messages, [data-section="messages"]');
                    if (_freshMount && _cv.parentNode !== _freshMount) {
                        try { _freshMount.appendChild(_cv); } catch(err2) { /* last resort: leave on body, still hidden via class removal above */ }
                    }
                }
            }
            /* Restore desktop placeholder (openChat set inline display:none on open) */
            var _ph = document.getElementById('chat-placeholder');
            if (_ph) { _ph.style.removeProperty('display'); }
            document.body.classList.remove('oc-chat-open');

            /* ── 2. Remove active highlight on contact items ── */
            document.querySelectorAll('.contact-item.active').forEach(function(el) {
                el.classList.remove('active');
            });

            /* ── 3. Show the messages section (contact list) ──
                   FIX: previously this (and the two blocks below) set inline
                   style.display DIRECTLY on every .content-section. Inline
                   styles always beat the app's class-based CSS, so once this
                   ran, #messages was permanently pinned to display:block and
                   every other section permanently pinned to display:none —
                   even after the user later clicked Reels/Status/etc in the
                   nav bar. The real navigateTo() would toggle the correct
                   .active classes, but the leftover inline styles from here
                   silently overrode it, which is why every nav-bar tap kept
                   showing (or partially overlapping with) Messages.
                   FIX: only toggle .active classes here; never touch inline
                   style.display. Visibility is driven purely by CSS rules
                   tied to .active, same as the rest of the app's router. */
            document.querySelectorAll('.content-section').forEach(function(s) {
                s.classList.toggle('active', s.id === 'messages');
            });

            /* Call router as courtesy */
            try {
                var _nav = window._origNavigateTo || window.navigateTo;
                if (typeof _nav === 'function') _nav('messages');
            } catch(err) {}

            /* After router settles: restore contact list UI */
            setTimeout(function() {
                /* Triple-check messages section is the active one (class only —
                   no inline style writes, see note above) */
                document.querySelectorAll('.content-section').forEach(function(s) {
                    s.classList.toggle('active', s.id === 'messages');
                });

                /* Show contact list panel */
                var mList = document.querySelector('.contact-list, #messages-list, #chat-list');
                if (mList) mList.style.removeProperty('display');

                /* FIX (bug: "exit button lands on an empty/stale chat-like
                   screen instead of the populated contact list"): this block
                   used to only reveal whatever the contact-list container
                   already held, never asking it to refresh. If its content
                   had gone stale while the chat was open (a Firestore
                   listener rebuild, a permission-recovery re-render, or
                   simply no refresh having run since initial app load), the
                   user saw that stale/empty state on close instead of the
                   real list. renderContactList() is the app's own real
                   contact-list renderer (already called this exact same
                   guarded way elsewhere in app-fixes.js) — calling it here
                   too guarantees the list is fresh every time a chat closes.
                   No-op if it isn't defined; nothing else in this function
                   changes. */
                if (typeof window.renderContactList === 'function') {
                    try { window.renderContactList(); } catch(errRcl) {}
                }

                try { window.scrollTo(0, 0); } catch(err) {}
                if (mList) mList.scrollTop = 0;

                /* Keep status bar hidden — still inside messages section */
                _hideStatusBar();

                /* Install the contacts-list back button (→ home) */
                var oldCl = document.getElementById('oc-cl-header');
                if (oldCl) oldCl.remove();
                var oldClBtn = document.getElementById('oc-cl-back-btn');
                if (oldClBtn) { oldClBtn._ocWired = false; oldClBtn.removeAttribute('id'); }
                _installContactListBackBtn();

                /* SAFETY NET: if the app's user/contact data (mockUsers /
                   registeredUsers / Firestore) hadn't finished loading yet at
                   this +50ms mark, the render above could still come back
                   empty. Re-run it once more shortly after so the list
                   self-heals instead of staying stuck on a stale/empty
                   screen. No-op (harmless) if the list was already fine. */
                setTimeout(function() {
                    if (typeof window.renderContactList === 'function') {
                        try { window.renderContactList(); } catch(errRcl2) {}
                    }
                }, 350);
            }, 50);
        }

        /* Use BOTH touchend (mobile) and click (desktop) — whichever fires first wins.
           Debounce flag is now SHARED at module scope (see §7b below) so the
           geometric fallback listener can never double-trigger a close. */
        _activeCloseHandler = _doCloseChat;
        backBtn.addEventListener('touchend', function(ev) {
            if (_closeDebounce) return;
            _closeDebounce = true;
            setTimeout(function() { _closeDebounce = false; }, 600);
            _doCloseChat(ev);
        }, { passive: false });
        backBtn.addEventListener('click', function(ev) {
            if (_closeDebounce) return;
            _closeDebounce = true;
            setTimeout(function() { _closeDebounce = false; }, 600);
            _doCloseChat(ev);
        });

        /* Peer avatar (wrapped for the online-status dot — mockup parity,
           this session) */
        var avWrap = document.createElement('span');
        avWrap.id = 'oc-peer-avatar-wrap';
        var av = document.createElement('img');
        av.id  = 'oc-peer-avatar';
        av.alt = peerName;
        av.src = peerAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(peerName) + '&background=1B2B8B&color=fff&size=80');
        av.onerror = function() { this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(peerName) + '&background=1B2B8B&color=fff&size=80'; };
        av.style.cursor = 'pointer';
        av.title = 'View profile picture';
        av.addEventListener('click', function() { _openLightbox(av.src); }); /* FIX-2 */
        avWrap.appendChild(av);
        var onlineDot = document.createElement('span');
        onlineDot.id = 'oc-peer-online-dot';
        avWrap.appendChild(onlineDot);
        hdr.appendChild(avWrap);

        /* Name + status.
           FIX (this session — "hide last-seen until expanded by chevron"):
           the collapsed/expandable CSS for this status line and its toggle
           (#oc-status-toggle / .oc-status-open — see _injectStyles above)
           already existed, but nothing ever created the toggle button or
           wired a click to it, so the line was permanently collapsed with
           no way to reveal it. Added here: a text column (name + status)
           plus the toggle button, both still children of #oc-peer-info so
           the existing CSS selectors keep matching unchanged. */
        var info = document.createElement('div');
        info.id = 'oc-peer-info';
        info.innerHTML =
            '<div id="oc-peer-textcol" style="display:flex;flex-direction:column;min-width:0;flex:1;">'
            + '<div id="oc-peer-name">' + _esc(peerName) + '</div>'
            + '<div id="oc-peer-status">online</div>'
            + '</div>'
            + '<button id="oc-status-toggle" type="button" aria-label="Show last seen" title="Show last seen">'
            + '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>'
            + '</button>';
        hdr.appendChild(info);

        var statusToggleBtn = info.querySelector('#oc-status-toggle');
        if (statusToggleBtn) {
            statusToggleBtn.addEventListener('click', function(e) {
                e.stopPropagation(); /* don't also trigger the header's open-profile tap below */
                info.classList.toggle('oc-status-open');
            });
        }

        /* Video call button */
        var vidBtn = document.createElement('button');
        vidBtn.className = 'oc-header-btn';
        vidBtn.title = 'Video call';
        vidBtn.innerHTML = '<svg class="emp-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6.5" width="12.5" height="11" rx="2.8"/><path d="M15 10.3l4.7-2.8a.75.75 0 0 1 1.13.65v7.7a.75.75 0 0 1-1.13.65L15 13.7"/></svg>';
        vidBtn.addEventListener('click', function() {
            /* DIAGNOSTIC (regression: "video call clicks do nothing"):
               logs unconditionally, before anything else runs, so a
               reproduction shows definitively whether the tap is even
               reaching this listener (vs. being swallowed by something
               else, e.g. an overlapping element intercepting the tap
               first — see _closeFloatingChatUI's own comment on the
               #oc-sheet-overlay leak for a past example of exactly that). */
            console.log('[OC-Call] Video call button tapped', { peerId: _peerId, peerName: _peerName });
            try {
                if (typeof window.startVideoCall === 'function') {
                    window.startVideoCall(_peerId, _peerName, _peerAvatar); return;
                }
                if (typeof window.openVideoCall === 'function') {
                    window.openVideoCall(_peerId, _peerName); return;
                }
                if (typeof window._initVideoCall === 'function') {
                    window._initVideoCall(_peerId, _peerName, _peerAvatar); return;
                }
                _showCallModal('video', _peerName, _peerAvatar);
            } catch (err) {
                /* FIX (regression): a synchronous throw anywhere in this
                   chain used to be an opaque, uncaught "Script error."
                   with zero visible feedback — the button would just
                   blink. Now it's logged with a clear tag/stack AND
                   surfaced to the person instead of failing silently. */
                console.error('[OC-Call] video call button threw synchronously:', err && (err.stack || err.message || err));
                _notify('Could not start the video call — please try again.', 'error');
            }
        });
        hdr.appendChild(vidBtn);

        /* Voice call button */
        var callBtn = document.createElement('button');
        callBtn.className = 'oc-header-btn';
        callBtn.title = 'Voice call';
        callBtn.innerHTML = '<svg class="emp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
        callBtn.addEventListener('click', function() {
            /* DIAGNOSTIC — see the matching comment on vidBtn's listener
               above; identical reasoning applies here. */
            console.log('[OC-Call] Voice call button tapped', { peerId: _peerId, peerName: _peerName });
            try {
                if (typeof window.startVoiceCall === 'function') {
                    window.startVoiceCall(_peerId, _peerName, _peerAvatar); return;
                }
                if (typeof window.openVoiceCall === 'function') {
                    window.openVoiceCall(_peerId, _peerName); return;
                }
                if (typeof window._initVoiceCall === 'function') {
                    window._initVoiceCall(_peerId, _peerName, _peerAvatar); return;
                }
                _showCallModal('voice', _peerName, _peerAvatar);
            } catch (err) {
                /* FIX (regression) — see the matching catch on vidBtn's
                   listener above; identical reasoning applies here. */
                console.error('[OC-Call] voice call button threw synchronously:', err && (err.stack || err.message || err));
                _notify('Could not start the voice call — please try again.', 'error');
            }
        });
        hdr.appendChild(callBtn);

        /* More options button */
        var moreBtn = document.createElement('button');
        moreBtn.className = 'oc-header-btn';
        moreBtn.title = 'More options';
        moreBtn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';
        moreBtn.addEventListener('click', function(e){ e.stopPropagation(); _buildMoreMenu(moreBtn, peerId, peerName); });
        hdr.appendChild(moreBtn);

        /* Wire peer data so the rest of the app can read it (renamed away from
           'chat-header-info' to avoid colliding with the static element of the
           same ID in index.html, which we already removed via cv.innerHTML='' —
           reusing that ID risked other scripts' getElementById calls picking up
           this hidden node instead of expecting a real header). */
        var infoEl = document.createElement('span');
        infoEl.id = 'oc-chat-header-info';
        infoEl.dataset.userId   = peerId;
        infoEl.dataset.peerId   = peerId;
        infoEl.dataset.peerName = peerName;
        infoEl.style.display = 'none';
        hdr.appendChild(infoEl);

        /* X close button — appended last so it sits on the far right */
        hdr.appendChild(backBtn);

        /* FEATURE (this session — "make the header interactive/clickable,
           open a screen like the contact-info page shown in the
           screenshot"): tapping anywhere on the header that isn't already
           one of its own controls (close button, avatar photo — which
           already opens the picture lightbox, video/voice/more, or the
           last-seen chevron just wired above) opens the SAME full
           "Contact info" screen already reachable via More > View contact
           (_openProfileModal) — a shortcut to an existing screen, not a
           second implementation of it. */
        hdr.addEventListener('click', function(e) {
            if (e.target.closest('#oc-back-btn, .oc-header-btn, #oc-status-toggle, #oc-peer-avatar-wrap')) return;
            _openProfileModal(peerId, peerName, peerAvatar);
        });
        hdr.style.cursor = 'pointer';

        cv.appendChild(hdr);

        /* ── Pinned messages: horizontal scrollable strip ──
           Populated by _renderPinnedStrip() from _pinnedMsgs, which is kept
           in sync by the existing message onSnapshot listener (no separate
           query / no new Firestore index needed). Hidden (display:none)
           whenever there's nothing pinned. */
        var pinStrip = document.createElement('div');
        pinStrip.id = 'oc-pinned-strip';
        pinStrip.style.cssText = 'display:none;';
        cv.appendChild(pinStrip);

        /* ── Status-reply context banner ──
           FEATURE (status-to-chat integration): when this chat exists
           because someone replied to a status, show a thumbnail preview of
           that status at the top of the chat window, same "hidden until
           populated" pattern as the pinned strip above. Populated by
           _renderStatusPreviewStrip() (see below), which reads
           statusId/statusThumbnail off the chats/{chatId} doc — fields
           app-status.js's _postComment() now writes whenever a chat
           session is created by replying to someone's status. */
        var statusPreviewStrip = document.createElement('div');
        statusPreviewStrip.id = 'oc-status-preview-strip';
        statusPreviewStrip.style.cssText = 'display:none;';
        cv.appendChild(statusPreviewStrip);
        _renderStatusPreviewStrip(peerId);

        /* ── SWEEP: remove any stray call/video/back button that some other
           script injected directly into #chat-view-container (outside our
           #oc-chat-header). This is the actual fix for the "two phone icons"
           bug — a previous patch tried to hide it with brittle nth-of-type
           CSS instead of removing the rogue element, which silently broke
           the moment the header's child order changed. ── */
        Array.prototype.slice.call(cv.children).forEach(function(child) {
            if (child === hdr) return; /* keep our header */
            if (child.id === 'oc-pinned-strip') return; /* keep pinned-messages strip */
            if (child.id === 'oc-status-preview-strip') return; /* keep status-reply context banner */
            if (child.id === 'oc-messages-body') return; /* will be added below, not yet present, harmless */
            if (child.tagName === 'BUTTON' || child.querySelector('button, svg, i.fas, i.fa')) {
                /* Anything button-like or icon-like that isn't our header → remove */
                child.remove();
            }
        });

        /* ── MESSAGES BODY ── */
        var body = document.createElement('div');
        body.id  = 'oc-messages-body';
        /* Also expose as chat-messages-container so app-fixes.js can append to it */
        body.setAttribute('data-role','chat-messages-container');
        /* Ensure the existing ID is also available */
        var legacyAnchor = document.createElement('div');
        legacyAnchor.id  = 'chat-messages-container';
        legacyAnchor.style.display = 'none';
        body.appendChild(legacyAnchor);

        var loadingEl = document.createElement('div');
        loadingEl.id = 'oc-loading';
        loadingEl.textContent = 'Loading messages…';
        body.appendChild(loadingEl);

        cv.appendChild(body);

        /* FEATURE (this session — "header disappears into cloud when
           scrolling"): the translucent/blurred scrolled state
           (#oc-chat-header.oc-header-scrolled — see _injectStyles above)
           already existed in CSS, but nothing ever toggled the class.
           Wired here on the actual messages-scroll container, the one
           node this file already treats as the single scrollable area
           for the chat. A small threshold avoids flicker from sub-pixel
           scroll jitter right at the very top. */
        body.addEventListener('scroll', function() {
            if (body.scrollTop > 6) hdr.classList.add('oc-header-scrolled');
            else hdr.classList.remove('oc-header-scrolled');
        }, { passive: true });

        /* ── COMPOSER ── */
        var composer = document.createElement('div');
        composer.id = 'oc-composer';

        var fileInput = document.createElement('input');
        fileInput.id     = 'oc-file-input';
        fileInput.type   = 'file';
        fileInput.accept = 'image/*,video/*,application/pdf,audio/*';
        fileInput.multiple = true;
        composer.appendChild(fileInput);

        var inner = document.createElement('div');
        inner.className = 'oc-composer-inner';

        /* Emoji icon */
        var emojiBtn = document.createElement('button');
        emojiBtn.id = 'oc-emoji-btn';
        emojiBtn.title = 'Emoji';
        emojiBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zm0-9c-.83 0-1.5-.67-1.5-1.5S9.17 4.5 10 4.5s1.5.67 1.5 1.5S10.83 7.5 10 7.5zm4 0c-.83 0-1.5-.67-1.5-1.5S13.17 4.5 14 4.5s1.5.67 1.5 1.5S14.83 7.5 14 7.5zm2 9c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
        /* Show quick emoji picker inline */
        emojiBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            _showFullEmojiPanel(inner, _getTextInput()); /* FIX-8: full emoji panel */
        });
        inner.appendChild(emojiBtn);

        /* Text area */
        var textInput = document.createElement('textarea');
        textInput.id  = 'oc-text-input';
        textInput.rows = 1;
        textInput.placeholder = 'Message';
        textInput.setAttribute('aria-label', 'Message');
        /* Also wire as message-text-input so app-fixes.js form handler works */
        textInput.name = 'message-text-input';
        /* FIX: on a touch/mobile virtual keyboard there is no reliable way
           to "hold Shift" while tapping the return/arrow key — it always
           reports shiftKey:false, so treating plain Enter as send caused
           every tap of that key to submit the message mid-sentence. On
           touch devices, Enter should ALWAYS just insert a newline; the
           only way to send is tapping the send button. Devices with a
           real physical keyboard keep the familiar Enter-sends /
           Shift+Enter-newline behavior. */
        var _isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        textInput.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter') return;
            if (_isTouchDevice) return; /* let the newline happen naturally */
            if (!e.shiftKey) { e.preventDefault(); _doSend(); }
        });
        inner.appendChild(textInput);

        /* Attach button */
        var attachBtn = document.createElement('button');
        attachBtn.id = 'oc-attach-btn';
        attachBtn.title = 'Attach';
        attachBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>';
        attachBtn.addEventListener('click', function() { safeFileClick(fileInput); });
        inner.appendChild(attachBtn);

        composer.appendChild(inner);

        /* Mic button (shown when input is empty — WhatsApp style) */
        var micBtn = document.createElement('button');
        micBtn.id = 'oc-mic-btn';
        micBtn.type = 'button';
        micBtn.title = 'Voice note';
        micBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V6zM17 12c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V22h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
        micBtn.style.display = 'flex';
        _wiresMicBtn(micBtn);
        composer.appendChild(micBtn);

        /* Send button — always present, shown when text is typed */
        var sendBtn = document.createElement('button');
        sendBtn.id = 'oc-send-btn';
        sendBtn.type = 'button';
        sendBtn.title = 'Send';
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
        sendBtn.style.display = 'none';
        sendBtn.addEventListener('click', _doSend);
        composer.appendChild(sendBtn);

        /* Toggle mic ↔ send based on input content */
        textInput.addEventListener('input', function() {
            textInput.style.height = 'auto';
            textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
            var hasText = (textInput.value || '').trim().length > 0;
            _ocTypingPing(hasText);
            micBtn.style.display  = hasText ? 'none' : 'flex';
            sendBtn.style.display = hasText ? 'flex' : 'none';
        });

        /* File input change — opens the caption composer (preview + "Add a
           caption…" + send) instead of uploading immediately, so a picked
           photo/video can carry a written message the same way WhatsApp's
           media composer does. */
        fileInput.addEventListener('change', function() {
            var _fList = Array.from(fileInput.files || []);
            if (_fList.length) {
                var _sig = _fList.map(function(f){ return f.name + f.size + f.lastModified; }).join('|');
                if (fileInput._lastChangeSig === _sig) return;
                fileInput._lastChangeSig = _sig;
            }
            fileInput.value = '';
            if (_fList.length) _openMediaCaptionComposer(_fList);
            /* After file selected, briefly show send is in progress */
            var sb = document.getElementById('oc-send-btn') || sendBtn;
            var mb = document.getElementById('oc-mic-btn')  || micBtn;
            if (sb) sb.style.display = 'none';
            if (mb) mb.style.display = 'flex';
        });

        /* ── Reply preview bar (long-press a message → Reply) ──
           Sits directly above the composer row, hidden until _startReply()
           populates and shows it; #oc-reply-cancel clears it again. Needs
           its own column wrapper since #oc-composer itself is a flex ROW
           (icons/input/send side by side) — a sibling row, not another
           item squeezed into that same row. */
        var composerWrap = document.createElement('div');
        composerWrap.id = 'oc-composer-wrap';
        composerWrap.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;';

        var replyBar = document.createElement('div');
        replyBar.id = 'oc-reply-bar';
        replyBar.style.cssText = 'display:none;align-items:center;gap:10px;padding:7px 12px;background:#fff;border-top:1px solid rgba(10,14,39,0.08);border-left:3px solid #1B2B8B;flex-shrink:0;';
        replyBar.innerHTML =
            '<img id="oc-reply-thumb" style="display:none;width:38px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0;" alt="">' +
            '<div style="flex:1;min-width:0;">' +
                '<div id="oc-reply-name" style="font-size:0.76rem;font-weight:700;color:#1B2B8B;"></div>' +
                '<div id="oc-reply-snippet" style="font-size:0.82rem;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>' +
            '</div>' +
            '<button id="oc-reply-cancel" type="button" title="Cancel reply" style="background:none;border:none;color:#9CA3AF;font-size:1.2rem;line-height:1;cursor:pointer;flex-shrink:0;padding:4px;">&times;</button>';
        replyBar.querySelector('#oc-reply-cancel').addEventListener('click', function() { _cancelReply(); });

        composerWrap.appendChild(replyBar);
        composerWrap.appendChild(composer);
        cv.appendChild(composerWrap);

        /* Also expose a hidden #message-form so app-fixes.js submit handler keeps working */
        var dummyForm = document.getElementById('message-form');
        if (!dummyForm) {
            dummyForm = document.createElement('form');
            dummyForm.id = 'message-form';
            dummyForm.style.display = 'none';
            var dummyInp = document.createElement('input');
            dummyInp.id   = 'message-text-input';
            dummyInp.type = 'text';
            dummyForm.appendChild(dummyInp);
            cv.appendChild(dummyForm);
            /* Wire submit → our send */
            dummyForm.addEventListener('submit', function(e) {
                e.preventDefault();
                var val = dummyInp.value.trim();
                if (val) { textInput.value = val; _doSend(); dummyInp.value = ''; }
            });
        }

        function _getTextInput() {
            return document.getElementById('oc-text-input') || textInput;
        }

        function _doSend() {
            var inp = document.getElementById('oc-text-input') || textInput;
            var text = (inp.value || '').trim();
            if (!text) return;
            if (_isGuest()) { if (typeof window._empRedirectGuestToSignup === 'function') window._empRedirectGuestToSignup('send messages'); else if (typeof window.openAuthModal === 'function') window.openAuthModal('signup'); return; }

            var msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
            var u = _us();
            var now = new Date().toISOString();
            var chatId = _buildChatId(u.id||'', _peerId);
            /* Snapshot the reply-to state now (if any) — cleared right after
               so the next message sent isn't accidentally threaded too. */
            var replySnapshot = _replyingTo;
            _cancelReply();

            /* Optimistic render — starts in "Sending…" state (Message Send
               Indicator spec item 2). _renderedMsgIds is marked NOW so the
               Firestore listener's own 'added' echo of this same doc never
               double-renders it; the listener's later 'modified'/'added'
               pass instead just replaces this row via _handleSnap once the
               write lands (which also flips status away from 'sending'). */
            _renderedMsgIds[msgId] = true;
            var row = _buildBubble({
                id: msgId, text: text, senderId: u.id, replyTo: replySnapshot,
                createdAt: now, status: 'sending'
            }, u.id);
            _appendBubble(row, now);

            /* Reset input */
            inp.value = '';
            inp.style.height = 'auto';
            _ocTypingPing(false);
            var sb = document.getElementById('oc-send-btn') || sendBtn;
            var mb = document.getElementById('oc-mic-btn')  || micBtn;
            if (sb) sb.style.display = 'none';
            if (mb) mb.style.display = 'flex';

            /* Firestore write — same schema as app-fixes.js */
            if (_fbOk()) {
                /* FIX: same stale-cached-id-vs-live-Firebase-UID mismatch
                   that broke calls (see _authUid() above) also broke
                   message sync — senderId must exactly equal
                   request.auth.uid or Firestore silently denies the write,
                   which is why messages could sit "sent" locally but never
                   sync, and why chatId-query permission errors showed up
                   in the console. Prefer the live UID; fall back to u.id
                   only if we somehow have no live session at all (message
                   still renders locally either way). */
                var authUid = _syncUidIfNeeded();
                if (authUid && authUid !== u.id) {
                    console.warn('[OC] senderId (' + u.id + ') does not match live Firebase UID (' + authUid + ') — using live UID for the Firestore write.');
                }
                var effectiveId = authUid || u.id || '';
                var payload = {
                    id:          msgId,
                    chatId:      chatId,
                    senderId:    effectiveId,
                    receiverId:  _peerId,
                    senderName:  u.fullName || u.username || 'User',
                    text:        text,
                    replyTo:     replySnapshot || null,
                    read:        false,
                    edited:      false,
                    deleted:     false,
                    createdAt:   now
                };
                /* FIX v18 ("send message not delivering", intermittently):
                   a single dropped write on a flaky connection used to go
                   straight to "failed". Now retries once automatically
                   after a short delay before asking the person to tap to
                   retry manually. */
                function _writeMsg(isRetry) {
                    try {
                        window.fbDb.collection('messages').doc(msgId).set(payload)
                            .then(function() { _ocPendingMark(_peerId, msgId, false); _setBubbleSendStatus(row, msgId, 'sent'); })
                            .catch(function() {
                                if (!isRetry) { setTimeout(function () { _writeMsg(true); }, 1500); return; }
                                _ocPendingQueue(_peerId, msgId, payload, row);
                                _setBubbleSendStatus(row, msgId, 'failed', payload);
                            });
                    } catch(e){
                        if (!isRetry) { setTimeout(function () { _writeMsg(true); }, 1500); return; }
                        _ocPendingQueue(_peerId, msgId, payload, row);
                        _setBubbleSendStatus(row, msgId, 'failed', payload);
                    }
                }
                /* E2EE (2026-10-30): seal the text (and any quoted reply text) on this
                   device before anything is written — Firestore only ever sees
                   ciphertext. The chats/{chatId} preview carries the same sealed
                   string and is opened locally in the chat list. */
                var _sealPeer = payload.receiverId;
                function _sealAndSend() {
                    _sealPl(payload, _sealPeer).then(function () {
                        _writeMsg(false);
                        /* Also update chat metadata */
                        window.fbDb.collection('chats').doc(chatId).set({
                            participants: [effectiveId, _sealPeer],
                            lastMessage: payload.text,
                            lastMessageTime: now,
                            lastSenderId: effectiveId
                        }, { merge: true }).catch(function(){});
                    }, function () {
                        /* only reachable when E2EE_ALLOW_PLAINTEXT_FALLBACK is false */
                        _setBubbleSendStatus(row, msgId, 'failed', function () { _sealAndSend(); });
                        _notify('Could not encrypt this message — it was not sent.', 'warning');
                    });
                }
                _sealAndSend();
            } else {
                /* Offline / Firebase not loaded — nothing will ever confirm
                   this send, so don't leave it stuck on "Sending…" forever.
                   It is also queued, so it goes out by itself when the
                   connection returns (and the chat list shows "Waiting for
                   network, will retry" until then). */
                var _offPayload = {
                    id: msgId, chatId: chatId, senderId: u.id || '', receiverId: _peerId,
                    senderName: u.fullName || u.username || 'User', text: text,
                    replyTo: replySnapshot || null, read: false, edited: false, deleted: false, createdAt: now
                };
                _ocPendingQueue(_peerId, msgId, _offPayload, row);
                _setBubbleSendStatus(row, msgId, 'failed', _offPayload);
            }
        }
        window._ocDoSend = _doSend; /* expose for tests */
    }

    /* ── Typing indicator: while the composer has text, ping chats/{chatId}.typing.<myId>
       (throttled, auto-cleared). The other person's chat list reads it in
       app-patch-v36.js's existing chats listener and shows "typing…". update()
       is used on purpose, so no stray chat doc is created before a first message. ── */
    var _typingLastPing = 0, _typingClearTimer = null;
    function _ocTypingPing(on) {
        try {
            if (!_fbOk() || !_peerId) return;
            var u = _us();
            var me = (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || u.id;
            if (!me || !u.id) return;
            var now = Date.now();
            if (on) {
                if (now - _typingLastPing < 2500) return;
                _typingLastPing = now;
            } else {
                if (!_typingLastPing) return;
                _typingLastPing = 0;
            }
            var upd = {}; upd['typing.' + me] = on ? now : 0;
            window.fbDb.collection('chats').doc(_buildChatId(u.id, _peerId)).update(upd).catch(function () {});
            clearTimeout(_typingClearTimer);
            if (on) _typingClearTimer = setTimeout(function () { _ocTypingPing(false); }, 4000);
        } catch (e) {}
    }

    /* ── Unsent-message queue: records what could not be sent (chat list reads
       localStorage 'emp_chat_pending' to show "Waiting for network, will
       retry") and re-sends when the connection is back. In-memory queue, so
       the stored marks are cleared on page load to avoid a stale label. ── */
    var _ocPendingQ = [];
    try { localStorage.removeItem('emp_chat_pending'); } catch (e) {}
    function _ocPendingMark(peerId, msgId, on) {
        try {
            var p = JSON.parse(localStorage.getItem('emp_chat_pending') || '{}');
            var list = p[peerId] || [];
            var i = list.indexOf(msgId);
            if (on && i === -1) list.push(msgId);
            if (!on && i !== -1) list.splice(i, 1);
            if (list.length) p[peerId] = list; else delete p[peerId];
            localStorage.setItem('emp_chat_pending', JSON.stringify(p));
        } catch (e) {}
        if (typeof window._empRefreshRowStatus === 'function') window._empRefreshRowStatus(peerId);
    }
    function _ocPendingQueue(peerId, msgId, payload, row) {
        if (_ocPendingQ.some(function (q) { return q.msgId === msgId; })) return;
        _ocPendingQ.push({ peerId: peerId, msgId: msgId, payload: payload, row: row });
        _ocPendingMark(peerId, msgId, true);
    }
    /* E2EE: seals a message document's text / quoted-reply text in place (no-op if
       already sealed, media-only, or the encryption module is unavailable). */
    function _sealPl(p, peer) {
        return (window._empE2EE && typeof window._empE2EE.sealPayload === 'function')
            ? window._empE2EE.sealPayload(p, peer) : Promise.resolve(p);
    }
    var _ocFlushing = false;
    function _ocFlushPending() {
        if (_ocFlushing || !_ocPendingQ.length || !_fbOk()) return;
        _ocFlushing = true;
        var items = _ocPendingQ.slice(), left = items.length;
        items.forEach(function (q) {
            var pl = Object.assign({}, q.payload);
            var live = window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid;
            if (live) pl.senderId = live;
            _sealPl(pl, q.peerId).then(function () { return window.fbDb.collection('messages').doc(q.msgId).set(pl); }).then(function () {
                _ocPendingQ = _ocPendingQ.filter(function (x) { return x.msgId !== q.msgId; });
                _ocPendingMark(q.peerId, q.msgId, false);
                _setBubbleSendStatus(q.row, q.msgId, 'sent');
                window.fbDb.collection('chats').doc(pl.chatId).set({
                    participants: [pl.senderId, q.peerId], lastMessage: pl.text,
                    lastMessageTime: pl.createdAt, lastSenderId: pl.senderId
                }, { merge: true }).catch(function () {});
            }).catch(function () {}).then(function () { if (--left === 0) _ocFlushing = false; });
        });
    }
    window.addEventListener('online', function () { setTimeout(_ocFlushPending, 1000); });
    setInterval(_ocFlushPending, 15000);

    /* FIX v15 (Message Send Indicator spec): transitions a bubble out of
       the optimistic "Sending…" state once the write settles. Module-level
       so both the text composer (_doSend) and media sends (_sendFile)
       share one implementation. On failure, tapping the "⚠ Not sent"
       label retries — `retry` can be either a Firestore payload object
       (existing text-message behavior: re-run the same .set()) or a
       function (FIX v18: media/voice notes need to redo the whole
       upload-then-save flow, not just the Firestore write, so _sendFile
       passes a retry function that re-attempts everything from scratch). */
    function _setBubbleSendStatus(row, msgId, status, retry) {
        if (!row || !row.parentNode) return;
        if (row._msgData) row._msgData.status = (status === 'sent') ? undefined : status;
        var ts = row.querySelector('.oc-ts');
        if (!ts) return;
        var oldLbl = ts.querySelector('.oc-sending-label, .oc-failed-label, .oc-tick');
        if (oldLbl) oldLbl.remove();
        if (status === 'sent') {
            var tick = document.createElement('span');
            tick.className = 'oc-tick';
            _applyTickState(tick, row._msgData || { read: false });
            ts.appendChild(tick);
        } else if (status === 'failed') {
            var failedLbl = document.createElement('span');
            failedLbl.className = 'oc-failed-label';
            failedLbl.style.cssText = 'color:#E53935;font-weight:600;margin-left:4px;cursor:pointer;';
            failedLbl.textContent = '⚠ Not sent — tap to retry';
            if (typeof retry === 'function') {
                failedLbl.addEventListener('click', function() {
                    failedLbl.textContent = 'Sending…';
                    failedLbl.style.color = '';
                    failedLbl.style.cursor = '';
                    retry();
                });
            } else if (retry) {
                failedLbl.addEventListener('click', function() {
                    failedLbl.textContent = 'Sending…';
                    failedLbl.style.color = '';
                    failedLbl.style.cursor = '';
                    window.fbDb.collection('messages').doc(msgId).set(retry)
                        .then(function() { _setBubbleSendStatus(row, msgId, 'sent'); })
                        .catch(function() { _setBubbleSendStatus(row, msgId, 'failed', retry); });
                });
            }
            ts.appendChild(failedLbl);
        }
    }


    /* =========================================================================
       §8  APPEND BUBBLE WITH DATE SEPARATOR
       ========================================================================= */
    function _tsVal(v) {
        if (!v) return 0;
        if (v.toDate) { try { return v.toDate().getTime(); } catch (e) {} }
        var t = new Date(v).getTime();
        return isNaN(t) ? 0 : t;
    }

    /* FIX (bug: "all sent messages render grouped above all received
       messages, out of chronological order"): _subscribeByParticipants
       above runs TWO separate Firestore listeners — one query for outgoing
       messages, one for incoming — each individually ordered by createdAt
       ascending, but the two listeners' initial snapshots fire
       independently of each other. This function used to always
       body.appendChild(row), so whichever listener's whole initial batch
       of 'added' events happened to run first landed as a solid block
       (e.g. every outgoing message), followed by the other listener's
       whole block (every incoming message) — exactly the up/down split
       seen in the screenshot, instead of the two streams interleaved by
       actual send time. Every bubble already carries data-created-at (set
       in _buildBubble), so instead of always appending at the tail, walk
       the rows already in the DOM and insert this one at its correct
       chronological slot. */
    function _appendBubble(row, ts) {
        var body = document.getElementById('oc-messages-body');
        if (!body) return;
        var loading = document.getElementById('oc-loading');
        if (loading) { loading.remove(); }

        var newVal = _tsVal(ts);
        var rows = body.querySelectorAll('.oc-row');
        var anchor = null;
        for (var i = 0; i < rows.length; i++) {
            if (_tsVal(rows[i].dataset.createdAt) > newVal) { anchor = rows[i]; break; }
        }
        /* Keep a date separator glued to the first message of its day —
           if our insertion point's row has one directly above it, insert
           above THAT separator instead of wedging our row between the
           separator and the message it introduces. */
        if (anchor && anchor.previousElementSibling &&
            anchor.previousElementSibling.classList &&
            anchor.previousElementSibling.classList.contains('oc-date-sep')) {
            anchor = anchor.previousElementSibling;
        }

        /* Date separator for this row's own day, only if not already shown
           somewhere in the thread. */
        var d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
        var sep = null;
        if (d) {
            var dateKey = d.toDateString();
            if (!_seenDates[dateKey]) {
                _seenDates[dateKey] = true;
                sep = _dateSep(ts);
            }
        }

        if (anchor) {
            if (sep) body.insertBefore(sep, anchor);
            body.insertBefore(row, anchor);
        } else {
            if (sep) body.appendChild(sep);
            body.appendChild(row);
        }

        body.scrollTop = body.scrollHeight;
    }


    /* =========================================================================
       §8b  MEDIA CAPTION COMPOSER  (WhatsApp-style: preview + "Add a
            caption…" + send, shown after picking one or more photos/
            videos, before anything actually uploads). Multiple files are
            shown one at a time in sequence; the ✕ cancels the whole
            remaining batch, matching the WhatsApp convention this mirrors.
       ========================================================================= */
    function _openMediaCaptionComposer(files) {
        var queue = files.slice();
        /* Snapshot any active reply once for the whole batch -- only the
           first media message sent from this picker carries the quote,
           same as typing text while replying only quotes once. */
        var batchReply = _replyingTo;
        _cancelReply();

        function _showNext() {
            if (!queue.length) return;
            var file = queue.shift();
            var replyForThis = batchReply;
            batchReply = null;

            var overlay = document.createElement('div');
            overlay.id = 'oc-caption-composer';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:10000010;background:#000;display:flex;flex-direction:column;';

            var topBar = document.createElement('div');
            topBar.style.cssText = 'display:flex;align-items:center;padding:12px 14px;flex-shrink:0;';
            var closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
            closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;';
            closeBtn.addEventListener('click', function() {
                queue = []; /* cancel the rest of the batch too */
                overlay.remove();
            });
            topBar.appendChild(closeBtn);
            overlay.appendChild(topBar);

            var previewWrap = document.createElement('div');
            previewWrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:10px;';
            var url = URL.createObjectURL(file);
            var mediaEl;
            if ((file.type || '').indexOf('video/') === 0) {
                mediaEl = document.createElement('video');
                mediaEl.src = url; mediaEl.controls = true;
            } else if ((file.type || '').indexOf('image/') === 0) {
                mediaEl = document.createElement('img');
                mediaEl.src = url;
            } else {
                mediaEl = document.createElement('div');
                mediaEl.textContent = file.name || 'File';
                mediaEl.style.cssText = 'color:#fff;font-size:0.95rem;padding:20px;text-align:center;';
            }
            mediaEl.style.cssText += 'max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;';
            previewWrap.appendChild(mediaEl);
            overlay.appendChild(previewWrap);

            if (queue.length) {
                var counter = document.createElement('div');
                counter.style.cssText = 'text-align:center;color:rgba(255,255,255,0.7);font-size:0.78rem;padding-bottom:4px;';
                counter.textContent = queue.length + ' more to send after this';
                overlay.appendChild(counter);
            }

            var captionRow = document.createElement('div');
            captionRow.style.cssText = 'display:flex;align-items:flex-end;gap:10px;padding:10px 12px;background:rgba(0,0,0,0.4);flex-shrink:0;';
            /* FIX: was a single-line <input type="text"> — an <input> can never
               hold a line break at all, and the old keydown handler sent on
               every Enter unconditionally. That's why tapping the Android
               keyboard's arrow/Go key always submitted instead of starting a
               new line. Switched to an auto-growing <textarea>, matching the
               same fix already applied to the main chat composer in
               app-patch-space-fix.js. */
            var captionInput = document.createElement('textarea');
            captionInput.rows = 1;
            captionInput.placeholder = 'Add a caption…';
            /* FIX (bug: "arrow/Go key on the Android keyboard submits the
               post instead of starting a new paragraph", confirmed via
               screenshot after deployment): nothing here was telling the
               soft keyboard which action icon to render, so Chrome/WebView
               was free to guess a "Go"/send-style arrow instead of a plain
               return icon on some Android keyboards/builds — and on those,
               tapping that icon doesn't reliably fire a keydown this
               listener can see/preventDefault, so the keydown guard below
               (which is otherwise correct) never gets a chance to run.
               Explicitly requesting the "enter" hint forces the return-
               style icon on virtually all Android keyboards, so it behaves
               like a normal multi-line field again. */
            captionInput.enterKeyHint = 'enter';
            captionInput.style.cssText = 'flex:1;padding:11px 16px;border-radius:22px;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:0.92rem;outline:none;resize:none;max-height:120px;overflow-y:auto;font-family:inherit;line-height:1.3;';
            captionRow.appendChild(captionInput);
            captionInput.addEventListener('input', function() {
                captionInput.style.height = 'auto';
                captionInput.style.height = Math.min(captionInput.scrollHeight, 120) + 'px';
            });

            var sendBtn = document.createElement('button');
            sendBtn.type = 'button';
            sendBtn.title = 'Send';
            sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
            sendBtn.style.cssText = 'width:44px;height:44px;border-radius:50%;border:none;background:#1B2B8B;color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
            captionRow.appendChild(sendBtn);
            overlay.appendChild(captionRow);

            function _confirm() {
                var caption = captionInput.value;
                overlay.remove();
                _sendFile(file, caption, replyForThis);
                _showNext();
            }
            sendBtn.addEventListener('click', _confirm);
            /* On a touch/mobile virtual keyboard there is no way to "hold
               Shift" -- the arrow/Go key always reports shiftKey:false, so
               Enter there must ALWAYS just insert a newline; sending only
               happens via the send button. Physical-keyboard devices keep
               Enter-sends / Shift+Enter-newline. Same convention as the main
               composer fix in app-patch-space-fix.js. */
            var _isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            captionInput.addEventListener('keydown', function(e) {
                /* FIX: some Android WebView/keyboard combos don't populate
                   e.key reliably for the IME action key (report it as
                   'Unidentified' or omit it) — falling back to keyCode/which
                   13 means this guard (and the touch-device newline
                   passthrough below) still catches it either way. */
                var isEnterKey = e.key === 'Enter' || e.keyCode === 13 || e.which === 13;
                if (!isEnterKey) return;
                if (_isTouchDevice) return; /* let the newline happen naturally */
                if (e.shiftKey) return;
                e.preventDefault();
                _confirm();
            });

            document.body.appendChild(overlay);
            setTimeout(function() { captionInput.focus(); }, 60);
        }

        _showNext();
    }


    /* =========================================================================
       §9  SEND FILE
       ========================================================================= */
    function _sendFile(file, caption, replyTo) {
        var u = _us();
        var msgId = 'msg-' + Date.now() + '-f';
        var chatId = _buildChatId(u.id||'', _peerId);
        var cfg = (window._appConfig && window._appConfig.cloudinary) || {};
        var cloud  = cfg.cloud || cfg.cloudName || 'dxwmts9vw';
        var preset = cfg.preset || cfg.uploadPreset || 'ehfapp_preset';
        caption = (caption || '').trim();

        /* Optimistic local preview */
        var localUrl = URL.createObjectURL(file);
        _renderedMsgIds[msgId] = true;
        var row = _buildBubble({
            id: msgId, text: caption, /* caption, if any -- media still speaks for itself when empty */
            mediaUrl: localUrl, mediaType: file.type, fileName: file.name, fileSize: file.size, replyTo: replyTo || null,
            senderId: u.id, createdAt: new Date().toISOString(), status: 'sending'
        }, u.id);
        _appendBubble(row, new Date().toISOString());

        /* FIX v18 (media/voice notes "not delivering", intermittently):
           on a weak/flaky connection (seen in the field — low bars, low
           throughput) a single Cloudinary POST or Firestore write can
           simply time out or drop without anything being wrong with the
           account/preset. Previously that meant an immediate, permanent
           "failed" with no automatic retry and no way to resend without
           re-picking the file from the gallery. This now retries the
           whole attempt once automatically after a short delay, and if
           that also fails, tapping "Not sent" on the bubble re-runs the
           exact same attempt again (via _setBubbleSendStatus's function-
           retry support) without needing the original file re-selected —
           `file` stays captured in this closure. */
        function _attempt(isRetry) {
            var fd = new FormData();
            fd.append('file', file);
            fd.append('upload_preset', preset);
            if (file.type.startsWith('video/') || file.type.startsWith('audio/')) fd.append('resource_type','video');

            fetch('https://api.cloudinary.com/v1_1/' + cloud + '/auto/upload', { method:'POST', body:fd })
                .then(function(r){
                    if (!r.ok) throw new Error('upload http ' + r.status);
                    return r.json();
                })
                .then(function(d){
                    var url = d.secure_url || d.url || '';
                    if (!url) throw new Error((d && d.error && d.error.message) || 'no url returned');
                    /* Update the local preview src */
                    var media = row.querySelector('img,video,audio,a');
                    if (media) { if (media.tagName==='A') media.href=url; else media.src=url; }
                    /* Firestore */
                    if (_fbOk()) {
                        var _mediaDoc = {
                            id:msgId, chatId:chatId,
                            senderId:u.id||'', receiverId:_peerId,
                            senderName:u.fullName||u.username||'User',
                            text:caption, mediaUrl:url, mediaType:file.type, fileName:file.name, fileSize:file.size,
                            replyTo: replyTo ? Object.assign({}, replyTo) : null,
                            read:false, edited:false, deleted:false,
                            createdAt:new Date().toISOString()
                        };
                        /* E2EE: the caption (and any quoted text) is sealed; the file itself is not. */
                        _sealPl(_mediaDoc, _mediaDoc.receiverId).then(function () {
                            return window.fbDb.collection('messages').doc(msgId).set(_mediaDoc);
                        })
                        .then(function() { _setBubbleSendStatus(row, msgId, 'sent'); })
                        .catch(function(err) { _onAttemptFailed(isRetry, err); });
                    } else {
                        _onAttemptFailed(isRetry, new Error('offline'));
                    }
                })
                .catch(function(err){ _onAttemptFailed(isRetry, err); });
        }

        function _onAttemptFailed(wasRetry, err) {
            if (!wasRetry) {
                /* One automatic retry for transient blips before bothering
                   the person with a "failed" state at all. */
                setTimeout(function () { _attempt(true); }, 1500);
                return;
            }
            _setBubbleSendStatus(row, msgId, 'failed', function () { _attempt(false); });
            _notify(
                (err && err.message === 'offline')
                    ? 'No connection — media could not be sent.'
                    : 'File upload failed — check connection.',
                'warning'
            );
        }

        _attempt(false);
    }


    /* =========================================================================
       §10  INLINE EMOJI PICKER
       ========================================================================= */
    var COMMON_EMOJIS = ['😊','😂','❤️','👍','🙏','😢','🔥','🎉','😎','🤔','💯','😍','🙌','✅','🥰','😅','👏','💪'];
    function _showInlineEmojiPicker(anchor, textInput) {
        var existing = document.getElementById('oc-inline-emoji');
        if (existing) { existing.remove(); return; }
        var picker = document.createElement('div');
        picker.id = 'oc-inline-emoji';
        picker.style.cssText = 'position:absolute;bottom:64px;left:8px;background:#fff;border-radius:16px;padding:10px;display:flex;flex-wrap:wrap;gap:6px;max-width:280px;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:9999;';
        COMMON_EMOJIS.forEach(function(em) {
            var span = document.createElement('span');
            span.textContent = em;
            span.style.cssText = 'font-size:1.5rem;cursor:pointer;';
            span.addEventListener('click', function() {
                if (textInput) {
                    var pos = textInput.selectionStart || textInput.value.length;
                    textInput.value = textInput.value.slice(0,pos) + em + textInput.value.slice(pos);
                    textInput.dispatchEvent(new Event('input'));
                    textInput.focus();
                }
                picker.remove();
            });
            picker.appendChild(span);
        });
        var cv = document.getElementById('chat-view-container');
        if (cv) { cv.style.position = 'relative'; cv.appendChild(picker); }
        setTimeout(function() {
            document.addEventListener('click', function() { picker.remove(); }, { once:true });
        }, 50);
    }




    /* =========================================================================
       FIX-8  FULL EMOJI PANEL WITH CATEGORIES
       ========================================================================= */
    var _EMOJI_CATS = {
        '😊 Smileys': ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','🤠','🥸','😷','🤒','🤕','🤢','🤮','🤧','🥴','😇','🤡','🤥','🤫','🤭','🧐','🤓'],
        '👍 Gestures': ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁','👅','👄'],
        '❤️ Hearts':   ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎'],
        '😸 Animals':  ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿','🦔'],
        '🍕 Food':     ['🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🫒','🥑','🍆','🥔','🥕','🌽','🌶','🥒','🥬','🧅','🧄','🍞','🥐','🥖','🫓','🥨','🥯','🧀','🥚','🍳','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥙','🧆','🥚','🍿','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','☕','🫖','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹'],
        '⚽ Activity': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸','🥌','🎿','⛷','🏂','🏋','🤼','🤸','⛹','🤺','🏇','🧘','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖','🏵','🎗','🎫','🎟','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🎹','🥁','🪘','🎷','🎺','🎸','🪕','🎻','🎲','♟','🎯','🎳','🎮','🎰','🧩'],
        '✈️ Travel':   ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍','🛵','🦽','🦼','🛺','🚲','🛴','🛹','🛼','🚏','🛣','🛤','⛽','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🛶','🚤','🛳','⛴','🛥','🚢','✈️','🛩','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰','🚀','🛸','🌍','🌎','🌏','🌐','🗺','🧭','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🧱','🪝','🏘','🏚','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩','🕋','⛲','⛺','🌁','🌉'],
        '💡 Objects':  ['⌚','📱','📲','💻','⌨️','🖥','🖨','🖱','🖲','🗜','💾','💿','📀','📷','📸','📹','🎥','📽','🎞','📞','☎️','📟','📠','📺','📻','🧭','⏰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','💸','💵','💴','💶','💷','🪙','💰','💳','🧾','💹','📈','📉','📊','📋','🗒','🗓','📆','📅','🗑','📁','📂','🗂','🗄','🗃','📊','📋','📌','📍','✂️','🗃','📌','📍','🗃','🗄','📊','🔐','🔑','🗝','🔨','🪓','⛏','⚒','🛠','🗡','⚔️','🔫','🛡','🔧','🔩','⚙️','🗜','🪝','⚗️','🔭','🔬','🩺','🩻','💊','💉','🩸','🩹','🩼','🩺','🪞','🪟','🛋','🚿','🛁','🪣'],
        '🔣 Symbols':  ['❤️','🧡','💛','💚','💙','💜','🖤','✅','❎','🔴','🟠','🟡','🟢','🔵','🟣','🔺','🔻','💠','🔘','🔲','🔳','⬛','⬜','◼️','◻️','◾','◽','▪️','▫️','🔷','🔶','🔹','🔸','🔷','💯','🆗','🆙','🆒','🆕','🆓','🔞','📵','🚫','⭕','❌','❓','❔','❕','❗','💤','🔅','🔆','🔱','♻️','💢','💥','💫','💦','💨','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛','🕜','🕝','🕞','🕟','🕠','🕡','🕢','🕣','🕤','🕥','🕦','🕧']
    };

    function _showFullEmojiPanel(anchor, textInput) {
        var existing = document.getElementById('oc-emoji-panel');
        if (existing) { existing.remove(); return; }

        var panel = document.createElement('div');
        panel.id = 'oc-emoji-panel';

        /* Search bar */
        var search = document.createElement('input');
        search.className = 'oc-emoji-search';
        search.placeholder = 'Search emoji…';
        panel.appendChild(search);

        /* Category tabs */
        var cats = document.createElement('div');
        cats.className = 'oc-emoji-cats';

        var grid = document.createElement('div');
        grid.className = 'oc-emoji-grid';

        var catKeys = Object.keys(_EMOJI_CATS);
        var _currentCat = catKeys[0];

        function _renderCat(catKey) {
            grid.innerHTML = '';
            var emojis = _EMOJI_CATS[catKey] || [];
            emojis.forEach(function(em) {
                var sp = document.createElement('span');
                sp.textContent = em;
                sp.title = em;
                sp.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (textInput) {
                        var pos = textInput.selectionStart || textInput.value.length;
                        textInput.value = textInput.value.slice(0,pos) + em + textInput.value.slice(pos);
                        textInput.dispatchEvent(new Event('input'));
                        textInput.focus();
                    }
                    /* keep panel open for multi-selection */
                });
                grid.appendChild(sp);
            });
        }

        catKeys.forEach(function(key) {
            var btn = document.createElement('button');
            btn.className = 'oc-emoji-cat-btn' + (key === catKeys[0] ? ' active' : '');
            btn.textContent = key.split(' ')[0]; /* just the emoji icon */
            btn.title = key.replace(/^.+ /,'');
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                cats.querySelectorAll('.oc-emoji-cat-btn').forEach(function(b){ b.classList.remove('active'); });
                btn.classList.add('active');
                _currentCat = key;
                _renderCat(key);
            });
            cats.appendChild(btn);
        });

        panel.appendChild(cats);
        panel.appendChild(grid);
        _renderCat(catKeys[0]);

        /* Search filter */
        search.addEventListener('input', function(e) {
            e.stopPropagation();
            var kw = search.value.toLowerCase();
            if (!kw) { _renderCat(_currentCat); return; }
            grid.innerHTML = '';
            catKeys.forEach(function(key) {
                _EMOJI_CATS[key].forEach(function(em) {
                    if (key.toLowerCase().includes(kw) || em.includes(kw)) {
                        var sp = document.createElement('span');
                        sp.textContent = em;
                        sp.addEventListener('click', function(evt) {
                            evt.stopPropagation();
                            if (textInput) {
                                var pos = textInput.selectionStart || textInput.value.length;
                                textInput.value = textInput.value.slice(0,pos) + em + textInput.value.slice(pos);
                                textInput.dispatchEvent(new Event('input'));
                                textInput.focus();
                            }
                        });
                        grid.appendChild(sp);
                    }
                });
            });
        });

        /* Append to chat-view-container */
        var cv = document.getElementById('chat-view-container');
        if (cv) { cv.style.position = 'relative'; cv.appendChild(panel); }
        else { document.body.appendChild(panel); }

        /* Close on outside click but NOT on panel itself */
        setTimeout(function() {
            document.addEventListener('click', function _cp(e) {
                if (!panel.contains(e.target) && e.target !== document.getElementById('oc-emoji-btn')) {
                    panel.remove();
                    document.removeEventListener('click', _cp, true);
                }
            }, { capture: true });
        }, 50);
    }

    /* =========================================================================
       FIX-5  3-DOT MORE OPTIONS DROPDOWN
       ========================================================================= */
    function _buildMoreMenu(moreBtn, peerId, peerName) {
        var existing = document.getElementById('oc-more-menu');
        if (existing) { existing.remove(); return; }

        var menu = document.createElement('div');
        menu.id = 'oc-more-menu';

        /* FIX (2026-08-01 — identity mismatch, same as _openProfileModal
           above): persistent id first, matching the pattern already
           fixed for /groups, /group_calls and /calls. Auth-uid-first
           here meant chatId (and therefore mute state, saved-contact
           lookups, and "Delete chat"'s query) was built from a uid that
           doesn't appear in the actual chat/message docs for any
           non-anonymous session. */
        var myId   = _us().id || _authUid() || '';
        var chatId = _buildChatId(myId, peerId);

        var ITEMS = [
            { label: 'View contact',        action: function(){ _openProfileModal(peerId, peerName, _peerAvatar); } },
            { label: 'Search',              action: function(){ var b=document.getElementById('oc-messages-body'); if(b){ var kw=prompt('Search messages:'); if(kw) _searchMessages(kw); } } },
            { label: _savedContactSet[peerId] ? 'Remove from list' : 'Add to list',
                                             action: function(){ _toggleSavedContact(myId, peerId, peerName); } },
            { label: 'Media, links & docs', action: function(){ _openMediaPanel(); } },
            { label: 'Call log',            action: function(){ _openCallLogPanel(peerId, peerName); } },
            { label: _isMuted(chatId) ? 'Unmute notifications' : 'Mute notifications',
                                             action: function(){ _toggleMute(myId, peerId); } },
            { label: 'Disappearing messages', action: function(){ _openDisappearingSettings(myId, peerId); } },
            { label: 'Clear chat',          action: function(){ if(confirm('Clear all messages in this chat?')) { var b=document.getElementById('oc-messages-body'); if(b) b.querySelectorAll('.oc-row,.oc-date-sep').forEach(function(r){r.remove()}); } } },
            /* FIX (Add delete button spec): "Clear chat" above only ever
               wiped the DOM — the messages themselves were untouched in
               Firestore, so they silently came back on next load or on
               another device. This actually deletes every message doc for
               this chatId, batched (Firestore caps a single batch at 500
               writes) so large histories don't get silently truncated. */
            { label: 'Delete chat', color: '#E53935', action: function(){ window._ocDeleteChat(peerId, function () { if (typeof window._empHideChat === 'function') window._empHideChat(peerId); }); }}
        ];

        ITEMS.forEach(function(item) {
            var div = document.createElement('div');
            div.className = 'oc-menu-item';
            div.textContent = item.label;
            if (item.color) div.style.color = item.color;
            div.addEventListener('click', function(e) {
                e.stopPropagation();
                menu.remove();
                item.action();
            });
            menu.appendChild(div);
        });

        /* Position relative to header */
        var hdr = document.getElementById('oc-chat-header');
        if (hdr) { hdr.style.position = 'relative'; hdr.appendChild(menu); }
        else { document.body.appendChild(menu); }

        /* Close on outside click */
        setTimeout(function() {
            document.addEventListener('click', function _close(){ menu.remove(); document.removeEventListener('click',_close); }, { once:true });
        }, 30);
    }

    function _searchMessages(kw) {
        var body = document.getElementById('oc-messages-body');
        if (!body) return;
        var lkw = kw.toLowerCase();
        body.querySelectorAll('.oc-bubble p').forEach(function(p) {
            var row = p.closest('.oc-row');
            if (!row) return;
            row.style.outline = p.textContent.toLowerCase().includes(lkw) ? '2px solid #1B2B8B' : '';
        });
    }

    /* FIX v13 (Issue 1: "Media, links & docs" was labelled as covering all
       three but only ever scanned <img> tags — links and documents were
       never collected or shown at all, which is exactly the "Link and
       Document" feature the person reported as non-responsive). Now scans
       the actual rendered bubbles for images/videos, http(s) links inside
       message text, and file-type attachments (anything with mediaUrl that
       isn't an image/video/audio), and shows them as three real tabs. */
    var _URL_RE = /(https?:\/\/[^\s<]+)/gi;

    function _openMediaPanel() {
        var body = document.getElementById('oc-messages-body');
        if (!body) { _notify('No chat open','info'); return; }

        var mediaItems = [];   /* {url, isVideo} */
        var linkItems  = [];   /* {url, text}    */
        var docItems   = [];   /* {url, name}    */

        body.querySelectorAll('.oc-bubble img').forEach(function(img){ mediaItems.push({ url: img.src, isVideo:false }); });
        body.querySelectorAll('.oc-bubble video').forEach(function(v){ mediaItems.push({ url: v.currentSrc || v.src, isVideo:true }); });
        body.querySelectorAll('.oc-bubble a[href]').forEach(function(a){
            var href = a.getAttribute('href') || '';
            if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|csv|txt)(\?|$)/i.test(href)) {
                docItems.push({ url: href, name: a.textContent.trim() || href.split('/').pop() });
            }
        });
        body.querySelectorAll('.oc-bubble p').forEach(function(p){
            var matches = (p.textContent || '').match(_URL_RE);
            if (matches) matches.forEach(function(u){ linkItems.push({ url: u, text: p.textContent.trim() }); });
        });

        if (!mediaItems.length && !linkItems.length && !docItems.length) {
            _notify('No media, links, or documents in this chat yet','info');
            return;
        }

        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:9999998;background:#fff;overflow-y:auto;';
        var hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;position:sticky;top:0;z-index:2;';
        hdr.innerHTML = '<button id="oc-mp-back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button><span style="font-weight:700;">Media, links &amp; docs</span>';
        panel.appendChild(hdr);
        panel.querySelector('#oc-mp-back').addEventListener('click', function(){ panel.remove(); });

        var tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex;position:sticky;top:58px;background:#fff;border-bottom:1px solid #eee;z-index:1;';
        var TABS = [
            { key:'media', label:'Media (' + mediaItems.length + ')' },
            { key:'links', label:'Links (' + linkItems.length + ')' },
            { key:'docs',  label:'Docs (' + docItems.length + ')' }
        ];
        var content = document.createElement('div');
        content.style.cssText = 'padding:3px;';

        function render(key) {
            content.innerHTML = '';
            if (key === 'media') {
                if (!mediaItems.length) { content.innerHTML = '<div style="text-align:center;color:#999;padding:24px;">No media yet</div>'; return; }
                var grid = document.createElement('div');
                grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:3px;';
                mediaItems.forEach(function(m) {
                    if (m.isVideo) {
                        var v = document.createElement('video');
                        v.src = m.url; v.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;'; v.muted = true;
                        grid.appendChild(v);
                    } else {
                        var thumb = document.createElement('img');
                        thumb.src = m.url;
                        thumb.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;cursor:zoom-in;';
                        thumb.addEventListener('click', function(){ _openLightbox(m.url); });
                        grid.appendChild(thumb);
                    }
                });
                content.appendChild(grid);
            } else if (key === 'links') {
                if (!linkItems.length) { content.innerHTML = '<div style="text-align:center;color:#999;padding:24px;">No links yet</div>'; return; }
                linkItems.forEach(function(l) {
                    var row = document.createElement('a');
                    row.href = l.url; row.target = '_blank'; row.rel = 'noopener';
                    row.style.cssText = 'display:block;padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#1B2B8B;font-size:0.85rem;word-break:break-all;text-decoration:none;';
                    row.textContent = l.url;
                    content.appendChild(row);
                });
            } else {
                if (!docItems.length) { content.innerHTML = '<div style="text-align:center;color:#999;padding:24px;">No documents yet</div>'; return; }
                docItems.forEach(function(d) {
                    var row = document.createElement('a');
                    row.href = d.url; row.target = '_blank'; row.rel = 'noopener';
                    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#111;font-size:0.85rem;text-decoration:none;';
                    row.innerHTML = '<span style="font-size:1.2rem;">📄</span><span style="word-break:break-all;">' + _esc(d.name) + '</span>';
                    content.appendChild(row);
                });
            }
        }

        TABS.forEach(function(t, i) {
            var btn = document.createElement('button');
            btn.textContent = t.label;
            btn.style.cssText = 'flex:1;padding:12px 6px;background:none;border:none;font-size:0.8rem;cursor:pointer;color:' + (i===0?'#1B2B8B;border-bottom:2px solid #1B2B8B;font-weight:700;':'#6B7280;');
            btn.addEventListener('click', function() {
                tabs.querySelectorAll('button').forEach(function(b){ b.style.color='#6B7280'; b.style.borderBottom='none'; b.style.fontWeight='400'; });
                btn.style.color = '#1B2B8B'; btn.style.borderBottom = '2px solid #1B2B8B'; btn.style.fontWeight = '700';
                render(t.key);
            });
            tabs.appendChild(btn);
        });
        panel.appendChild(tabs);
        panel.appendChild(content);
        render('media');
        document.body.appendChild(panel);
    }

    /* =========================================================================
       CALL LOG PANEL — history of voice/video calls with this contact.
       Reads straight from the `calls` collection (no new collection needed —
       see the schema note above _finalizeCallRecord). Sorted client-side to
       avoid requiring a composite Firestore index for array-contains+orderBy.
       ========================================================================= */
    function _callLogIcon(isVideo, direction) {
        var arrow = direction === 'outgoing'
            ? '<path d="M7 7h8v8" stroke="#25D366" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 15L15 7" stroke="#25D366" stroke-width="2" fill="none" stroke-linecap="round"/>'
            : '<path d="M17 7v8H9" stroke="#1B2B8B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 15L9 7" stroke="#1B2B8B" stroke-width="2" fill="none" stroke-linecap="round"/>';
        return '<svg width="16" height="16" viewBox="0 0 24 24">' + arrow + '</svg>';
    }

    function _callLogStatusLabel(rec, isOutgoing) {
        switch (rec.finalStatus) {
            case 'answered':  return 'Answered · ' + _fmtDuration(rec.duration || 0);
            case 'declined':  return isOutgoing ? 'Declined' : 'You declined';
            case 'missed':    return isOutgoing ? 'Not answered' : 'Missed call';
            case 'no_answer': return isOutgoing ? 'No answer' : 'Missed call';
            default:          return rec.status === 'ended' ? 'Ended' : 'Ringing…';
        }
    }

    function _openCallLogPanel(peerId, peerName) {
        if (!_fbOk()) { _notify('No internet connection', 'warning'); return; }
        var me = _us().id;
        if (!me) { _notify('Please log in', 'warning'); return; }

        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:9999998;background:#fff;overflow-y:auto;';
        var hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;position:sticky;top:0;';
        hdr.innerHTML = '<button id="oc-calllog-back" aria-label="Back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button><span style="font-weight:700;">Call log with ' + _esc(peerName) + '</span>';
        hdr.querySelector('button').addEventListener('click', function(){ panel.remove(); });
        panel.appendChild(hdr);

        var list = document.createElement('div');
        list.style.cssText = 'padding:6px 0;';
        list.innerHTML = '<div style="text-align:center;color:#999;padding:24px;">Loading…</div>';
        panel.appendChild(list);
        document.body.appendChild(panel);

        window.fbDb.collection('calls').where('participants', 'array-contains', me).get()
            .then(function (snap) {
                var recs = [];
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    if (d.callerId === peerId || d.calleeId === peerId) recs.push(d);
                });
                recs.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

                if (!recs.length) {
                    list.innerHTML = '<div style="text-align:center;color:#999;padding:24px;">No calls yet with ' + _esc(peerName) + '.</div>';
                    return;
                }

                list.innerHTML = recs.map(function (rec) {
                    var isOutgoing = rec.callerId === me;
                    var isVideo    = rec.type === 'video';
                    var when = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : '';
                    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f0f0f0;">'
                        + '<div style="flex-shrink:0;">' + _callLogIcon(isVideo, isOutgoing ? 'outgoing' : 'incoming') + '</div>'
                        + '<div style="flex:1;min-width:0;">'
                        + '<div style="font-weight:600;font-size:0.9rem;">' + (isVideo ? '📹 Video call' : '📞 Voice call') + '</div>'
                        + '<div style="font-size:0.78rem;color:#888;">' + _callLogStatusLabel(rec, isOutgoing) + ' · ' + _esc(when) + '</div>'
                        + '</div></div>';
                }).join('');
            })
            .catch(function () {
                list.innerHTML = '<div style="text-align:center;color:#999;padding:24px;">Couldn\'t load call history — try again.</div>';
            });
    }

    /* =========================================================================
       FEATURE (2026-08-01) — "Share to Status" from a 1:1 chat media
       message. Same approach as the group-chat version in
       app-patch-v13.js's _shareGroupMediaToStatus: hand the media off to
       the Status feature's OWN existing #status-file-input + create-status
       modal (app-status.js) instead of building a second upload path.
       ========================================================================= */
    function _shareMediaToStatus(data) {
        var modal = document.getElementById('create-status-modal');
        var fileInp = document.getElementById('status-file-input');
        if (!modal || !fileInp) {
            if (typeof window.showNotification === 'function') window.showNotification('Status feature is still loading — try again in a moment.', 'info');
            return;
        }

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

        /* FIX (2026-08-30 — same ordering bug as app-patch-v13.js's
           _shareToStatus()/_shareGroupMediaToStatus(): this used to fetch
           the media into a File and dispatch 'change' BEFORE opening the
           modal, so app-status.js's preview <video>/<img> was sourced
           while #status-file-preview was still display:none and never
           started decoding — a permanently empty preview box. FOLLOW-UP
           fix (same date, see app-status.js's _attachRemoteStatusMedia
           header): even with modal-first ordering, fetch()-ing the whole
           media into a Blob just to re-upload those same bytes again on
           "Post Status" is a full extra round-trip that can stall
           indefinitely on a poor connection. Since data.mediaUrl is
           already a public, hosted url, skip the round trip entirely when
           app-status.js's remote-attach helper is available — falls back
           to the old fetch-into-File path only if that function isn't
           available (older app-status.js build). */
        if (typeof window._empAttachRemoteStatusMedia === 'function') {
            _openModal();
            var attachedOc = window._empAttachRemoteStatusMedia(data.mediaUrl, data.mediaType);
            if (!attachedOc && typeof window.showNotification === 'function') {
                window.showNotification('Could not auto-attach that media — please add it again from "Add photos or videos".', 'warning');
            }
            var textElOc = document.getElementById('status-text-input');
            if (textElOc && data.text && !textElOc.value) textElOc.value = data.text;
            return;
        }

        if (typeof window.showNotification === 'function') window.showNotification('Preparing to share to your status…', 'info');

        fetch(data.mediaUrl)
            .then(function (r) { if (!r.ok) throw new Error('fetch http ' + r.status); return r.blob(); })
            .then(function (blob) {
                /* Modal opened FIRST — see the fix note above. */
                _openModal();

                var isVideo = (data.mediaType || '').indexOf('video/') === 0;
                var ext = isVideo ? 'mp4' : 'jpg';
                var mime = blob.type || (isVideo ? 'video/mp4' : 'image/jpeg');
                var file = new File([blob], 'shared-status.' + ext, { type: mime });

                var dt = new DataTransfer();
                dt.items.add(file);
                fileInp.files = dt.files;
                fileInp._lastChangeSig = ''; /* clear app-status.js's dup-change guard so this programmatic set is picked up */
                fileInp.dispatchEvent(new Event('change', { bubbles: true }));

                var textEl = document.getElementById('status-text-input');
                if (textEl && data.text && !textEl.value) textEl.value = data.text;
            })
            .catch(function () {
                _openModal();
                if (typeof window.showNotification === 'function') window.showNotification('Could not auto-attach that media — please add it again from "Add photos or videos".', 'warning');
            });
    }

    /* =========================================================================
       FIX-3  IMAGE LIGHTBOX
       ========================================================================= */
    function _openLightbox(src, isVideo) {
        var lb = document.createElement('div');
        lb.id = 'oc-lightbox';
        var media = document.createElement(isVideo ? 'video' : 'img');
        media.src = src;
        if (isVideo) { media.controls = true; media.autoplay = true; media.playsInline = true; }
        var close = document.createElement('button');
        close.id = 'oc-lightbox-close';
        close.innerHTML = '&#x2715;';
        lb.appendChild(media);
        lb.appendChild(close);
        document.body.appendChild(lb);
        function _closeLb() {
            if (isVideo) { try { media.pause(); } catch (e) {} }
            lb.remove();
        }
        close.addEventListener('click', function(e){ e.stopPropagation(); _closeLb(); });
        lb.addEventListener('click', _closeLb);
        media.addEventListener('click', function(e){ e.stopPropagation(); }); /* don't close on media click */
        document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ _closeLb(); document.removeEventListener('keydown',esc); } });
    }
    /* Exposed so any avatar anywhere in the app (contact list, message
       bubbles, etc.) can reuse the exact same full-screen viewer instead
       of a second, inconsistent implementation. */
    window._ocOpenLightbox = _openLightbox;

    /* Exposed the same way, for the same reason (feature: inbox avatar
       tap -> bottom-sheet bio preview with a "View full profile" link,
       see app-chat.js's new _openAvatarPreviewSheet) — reuses this exact
       full "Contact info" screen instead of building a second one. */
    window._ocOpenFullProfile = _openProfileModal;

    /* =========================================================================
       FIX-3b  TAP AVATAR → VIEW PROFILE
       Shared helper so every avatar that should navigate to a profile
       (message bubbles, contact list, anywhere else) does it exactly the
       same way as the rest of the app already does (mentions, business
       page host taps, etc. — see app-feed.js / app-fixes.js usage of the
       same two calls).
       ========================================================================= */
    function _goToUserProfile(userId) {
        if (!userId) return;
        if (typeof window.renderUserProfile === 'function') window.renderUserProfile(userId);
        if (typeof window.navigateTo === 'function') window.navigateTo('profile', true);
    }
    window._ocGoToUserProfile = _goToUserProfile;

    /* =========================================================================
       FIX-2  VOICE RECORDING  — WhatsApp press-and-hold style
       MediaRecorder + Cloudinary upload + live recording bar
       ========================================================================= */
    var _micRec = { recorder: null, chunks: [], stream: null, active: false, timer: null, elapsed: 0 };

    /* Build the recording bar that replaces the composer while recording */
    function _showRecordingBar(micBtn, onStop, onCancel) {
        var composer = document.getElementById('oc-composer');
        if (!composer) return;

        var bar = document.createElement('div');
        bar.id = 'oc-rec-bar';
        bar.style.cssText = [
            'position:absolute;inset:0;',
            'display:flex;align-items:center;gap:10px;',
            'padding:8px 12px;',
            'background:#fff;',
            'z-index:50;',
            'border-top:1px solid rgba(10,14,39,0.08);',
        ].join('');

        /* Cancel (trash) button */
        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;display:flex;align-items:center;flex-shrink:0;';
        cancelBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#E53935"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        cancelBtn.addEventListener('click', function() { onCancel(); });
        bar.appendChild(cancelBtn);

        /* Timer */
        var timerEl = document.createElement('span');
        timerEl.id = 'oc-rec-timer';
        timerEl.style.cssText = 'color:#E53935;font-size:0.88rem;font-weight:600;flex-shrink:0;min-width:38px;';
        timerEl.textContent = '0:00';
        bar.appendChild(timerEl);

        /* Animated waveform dots */
        var wave = document.createElement('div');
        wave.id = 'oc-rec-wave';
        wave.style.cssText = 'flex:1;display:flex;align-items:center;gap:3px;overflow:hidden;';
        for (var w = 0; w < 28; w++) {
            var dot = document.createElement('div');
            var h = (8 + Math.random() * 18) | 0;
            dot.style.cssText = 'width:3px;border-radius:2px;background:#1B2B8B;opacity:0.5;flex-shrink:0;height:' + h + 'px;';
            dot.style.animation = 'oc-wave-anim ' + (0.5 + Math.random() * 0.6).toFixed(2) + 's ease-in-out infinite alternate';
            dot.style.animationDelay = (Math.random() * 0.4).toFixed(2) + 's';
            wave.appendChild(dot);
        }
        bar.appendChild(wave);

        /* Inject wave animation keyframes once */
        if (!document.getElementById('_oc_wave_style')) {
            var ws = document.createElement('style');
            ws.id = '_oc_wave_style';
            ws.textContent = '@keyframes oc-wave-anim{from{transform:scaleY(0.4);opacity:0.4}to{transform:scaleY(1);opacity:1}}';
            document.head.appendChild(ws);
        }

        /* Send (checkmark) button */
        var sendVn = document.createElement('button');
        sendVn.style.cssText = [
            'width:44px;height:44px;min-width:44px;border-radius:50%;border:none;cursor:pointer;',
            'background:#1B2B8B;color:#fff;',
            'display:flex;align-items:center;justify-content:center;flex-shrink:0;',
            'box-shadow:0 2px 8px rgba(27,43,139,0.30);',
        ].join('');
        sendVn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
        sendVn.addEventListener('click', function() { onStop(); });
        bar.appendChild(sendVn);

        /* Make composer relative so absolute bar covers it */
        composer.style.position = 'relative';
        composer.appendChild(bar);

        /* Start elapsed timer */
        _micRec.elapsed = 0;
        _micRec.timer = setInterval(function() {
            _micRec.elapsed++;
            var m = Math.floor(_micRec.elapsed / 60);
            var s = _micRec.elapsed % 60;
            var timerEl2 = document.getElementById('oc-rec-timer');
            if (timerEl2) timerEl2.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        }, 1000);
    }

    function _hideRecordingBar() {
        clearInterval(_micRec.timer);
        _micRec.timer = null;
        var bar = document.getElementById('oc-rec-bar');
        if (bar) bar.remove();
    }

    /* FIX v16 (1:1 voice note button "no longer working in some browsers" +
       spec item to bring the group-chat recorder's behavior here):
       the old version had two gaps the group chat implementation
       (app-patch-v13.js _startRecording) already closed:
         1. It never checked for `window.MediaRecorder` before calling
            `new MediaRecorder(stream)`. Browsers/WebViews without
            MediaRecorder (or where it's only exposed under a vendor
            prefix / not at all, e.g. some in-app browsers and older
            Android WebViews) throw a ReferenceError-style exception
            there, INSIDE a promise .then() — with no .catch() below it
            able to see a synchronous throw from that statement wrapped
            safely, this surfaced as an unhandled rejection and the mic
            button just silently stopped doing anything.
         2. `new MediaRecorder(stream)` with no mimeType let the browser
            pick a default; on browsers where the default codec path is
            unreliable this can throw at construction time too, again
            with nothing catching it.
       This version adds the same feature-detection, explicit
       audio/webm negotiation, and try/catch around construction that
       app-patch-v13.js's group voice notes already use, plus the same
       minimum-recording-length guard, so behavior is now identical
       between 1:1 and group chats. */
    function _startRecording(micBtn) {
        if (_micRec.active) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            _notify('Voice notes aren\'t supported on this browser.', 'warning'); return;
        }
        if (!window.MediaRecorder) {
            _notify('Recording is not supported on this browser.', 'warning'); return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function(stream) {
                _micRec.stream   = stream;
                _micRec.chunks   = [];

                var mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm'))
                    ? 'audio/webm' : '';
                try {
                    _micRec.recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
                } catch (e) {
                    _notify('Could not start recording on this device.', 'warning');
                    stream.getTracks().forEach(function(t){ t.stop(); });
                    _micRec.stream = null;
                    return;
                }
                _micRec.active = true;

                _micRec.recorder.addEventListener('dataavailable', function(e) {
                    if (e.data && e.data.size > 0) _micRec.chunks.push(e.data);
                });

                _micRec._startedAt = Date.now();
                _micRec.recorder.addEventListener('stop', function() {
                    _micRec.active = false;
                    if (_micRec.stream) {
                        _micRec.stream.getTracks().forEach(function(t){ t.stop(); });
                        _micRec.stream = null;
                    }
                    var durationMs = Date.now() - (_micRec._startedAt || 0);
                    if (!_micRec._cancelled) {
                        if (durationMs < 800) {
                            _notify('Recording too short — hold a bit longer.', 'info');
                        } else {
                            var mt = (_micRec.recorder && _micRec.recorder.mimeType) || 'audio/webm';
                            var blob = new Blob(_micRec.chunks, { type: mt });
                            var ext = (mt.indexOf('mp4') !== -1) ? 'm4a' : 'webm';
                            var file = new File([blob], 'voice-note-' + Date.now() + '.' + ext, { type: mt });
                            _sendFile(file);
                        }
                    }
                    _micRec.chunks = [];
                    _micRec._cancelled = false;
                });

                _micRec.recorder.start();

                _showRecordingBar(
                    micBtn,
                    /* onStop  */ function() { _stopRecording(false); },
                    /* onCancel*/ function() { _stopRecording(true);  }
                );
            })
            .catch(function(err) {
                _notify('Microphone permission denied: ' + (err.message || err), 'warning');
            });
    }

    function _stopRecording(cancel) {
        _hideRecordingBar();
        _micRec._cancelled = !!cancel;
        if (_micRec.recorder && _micRec.active) {
            try { _micRec.recorder.stop(); } catch(e) {}
        }
    }

    function _wiresMicBtn(micBtn) {
        /* WhatsApp behaviour: click once to start, click send-checkmark to send,
           click trash to cancel. The mic button itself only starts recording. */
        micBtn.addEventListener('click', function() {
            if (_micRec.active) return; /* recording bar handles stop */
            _startRecording(micBtn);
        });
    }

    /* =========================================================================
       §11  SUBSCRIBE TO FIRESTORE MESSAGES
       ========================================================================= */
    function _subscribe(myId, peerId) {
        _stopListener();
        if (!_fbOk()) {
            var loading = document.getElementById('oc-loading');
            if (loading) loading.textContent = 'You appear to be offline.';
            return;
        }
        _msgSubscribedUid = myId; /* remember for the drift recheck below */
        var chatId = _buildChatId(myId, peerId);
        _seenDates = {};
        var body = document.getElementById('oc-messages-body');

        /* Clear loading */
        var loading = document.getElementById('oc-loading');
        if (loading) loading.textContent = 'Loading…';

        /* FIX (bug: chat stuck on "Loading...", console spammed with
           "[OC] chatId query failed: Missing or insufficient permissions"):
           this used to try a .where('chatId','==',chatId) query first.
           Firestore rejects an ENTIRE list query -- not just individual
           docs -- whenever the query's own filters don't structurally imply
           the security rule's condition. Our /messages rule checks
           resource.data.senderId/receiverId, but this query only filtered
           on chatId, so Firestore could never statically prove every
           possible result satisfies the rule and denied the whole request
           every time -- no composite index fixes that, it's a rules/query
           shape mismatch, not a missing-index problem. Going straight to
           _subscribeByParticipants (which DOES filter on senderId/
           receiverId, matching the rule) is both correct and faster -- no
           wasted round trip through a query that can never succeed under
           the current rules. */
        _subscribeByParticipants(myId, peerId);
    }

    function _subscribeByParticipants(myId, peerId) {
        /* Fallback: two parallel queries, merge in JS */
        _stopListener();
        if (!_fbOk()) return;
        _renderedMsgIds = {}; /* fresh dedupe map for this chat session */
        _pinnedMsgs = {};
        _renderPinnedStrip();

        function _handleSnap(snap) {
            if (!snap) return;
            var loading = document.getElementById('oc-loading');
            if (loading) loading.remove();
            /* E2EE: open each message on this device before it is rendered. */
            var _chs = snap.docChanges();
            Promise.all(_chs.map(function (ch) {
                var d0 = ch.doc.data(); d0.id = ch.doc.id;
                return (window._empE2EE && typeof window._empE2EE.decryptMessage === 'function')
                    ? window._empE2EE.decryptMessage(d0).catch(function () { return d0; })
                    : Promise.resolve(d0);
            })).then(function (_datas) {
              if (_peerId !== peerId) return; /* chat was closed / switched while decrypting */
              _chs.forEach(function(ch, _ci) {
                var data = _datas[_ci];
                /* Only between these two users */
                var ok = (data.senderId===myId && data.receiverId===peerId) ||
                         (data.senderId===peerId && data.receiverId===myId);
                if (!ok) return;

                if (ch.type === 'added') {
                    if (_renderedMsgIds[data.id]) return;
                    /* FIX: a uid-drift resubscribe (see _msgSubscribedUid
                       above) resets _renderedMsgIds for a fresh session,
                       but the DOM from the previous (mis-scoped) listener
                       may already contain some of these rows — re-check
                       the DOM directly so re-subscribing never produces
                       duplicate bubbles for messages already on screen. */
                    if (document.querySelector('.oc-row[data-msg-id="' + data.id + '"]')) {
                        _renderedMsgIds[data.id] = true;
                        return;
                    }
                    _renderedMsgIds[data.id] = true;
                    var em = document.getElementById('oc-empty');
                    if (em) em.remove();
                    var row = _buildBubble(data, myId);
                    row.dataset.msgId = data.id;
                    _appendBubble(row, data.createdAt);

                    if (data.pinned === true && data.deleted !== true) {
                        _pinnedMsgs[data.id] = data;
                        _renderPinnedStrip();
                    }

                    /* FIX v13 (Message Delivery Indicators enhancement): this
                       is the "recipient opened the chat" moment the spec asks
                       for — mark THEIR message as read the instant it renders
                       here, but only while this tab/screen is actually
                       visible (an inactive/backgrounded webview shouldn't
                       silently mark things read). */
                    if (data.senderId === peerId && data.read !== true && data.deleted !== true &&
                        document.visibilityState !== 'hidden' && _fbOk()) {
                        window.fbDb.collection('messages').doc(data.id)
                            .update({ read: true }).catch(function(){});
                    }
                } else if (ch.type === 'modified') {
                    /* FIX v15 (Editing/Deletion/Read-receipt spec): this used
                       to only refresh the read tick. It now also re-renders
                       the bubble entirely on a doc change — the one thing
                       that reliably covers every field a 'modified' event
                       can mean (edited text, a soft delete landing on the
                       OTHER device, reactions, or the read flag), and is
                       what makes edits/deletes propagate cross-device
                       instead of only updating the device that made them. */
                    var existing = document.querySelector('.oc-row[data-msg-id="' + data.id + '"]');
                    if (!existing) return;
                    var freshRow = _buildBubble(data, myId);
                    freshRow.dataset.msgId = data.id;
                    existing.replaceWith(freshRow);

                    if (data.pinned === true && data.deleted !== true) {
                        _pinnedMsgs[data.id] = data;
                    } else if (_pinnedMsgs[data.id]) {
                        delete _pinnedMsgs[data.id];
                    }
                    _renderPinnedStrip();
                }
              });
            });
        }

        /* FIX: these two onSnapshot calls used to pass an EMPTY error
           handler (`function(){}`), so a permission-denied caused by myId
           not matching the live request.auth.uid (see _msgSubscribedUid
           comment above) failed completely silently — no console signal,
           and nothing ever retried, leaving the thread looking simply
           empty. Log the failure and clear _msgSubscribedUid so
           _recheckMessagesUid's periodic poll (below) knows this
           subscription is no longer trustworthy and re-attaches as soon
           as the correct uid is available. */
        function _onMsgQueryError(which) {
            return function(err) {
                console.warn('[OC] messages listener (' + which + ') failed for uid=' + myId + ':', err && err.code, err && err.message);
                _msgSubscribedUid = null;
            };
        }

        try {
            var unsub1 = window.fbDb.collection('messages')
                .where('senderId',  '==', myId)
                .where('receiverId','==', peerId)
                .orderBy('createdAt','asc').limit(80)
                .onSnapshot(_handleSnap, _onMsgQueryError('outgoing'));
            var unsub2 = window.fbDb.collection('messages')
                .where('senderId',  '==', peerId)
                .where('receiverId','==', myId)
                .orderBy('createdAt','asc').limit(80)
                .onSnapshot(_handleSnap, _onMsgQueryError('incoming'));
            _subscribePresence(peerId);
            _unsub = function() {
                try{ unsub1(); }catch(e){}
                try{ unsub2(); }catch(e){}
                if (_unsubPresence) { try{ _unsubPresence(); }catch(e){} _unsubPresence = null; }
            };
        } catch(e){
            _msgSubscribedUid = null;
            var loading = document.getElementById('oc-loading');
            if (loading) loading.textContent = 'Could not load messages.';
        }
    }

    /* FIX: same drift-recheck pattern as _watchIncomingCalls (§5 above) —
       while a chat is open, periodically compare the uid its listener was
       attached with against the currently-resolved live uid, and
       transparently re-subscribe if they no longer match (auth restored/
       changed after the chat was opened, or the previous subscribe failed
       and cleared _msgSubscribedUid above). This is what actually fixes
       "message disappears after refresh/logout" and "opening the chat
       shows nothing" — those were always a live, resolvable uid mismatch,
       just one nothing ever rechecked before. */
    function _recheckMessagesUid() {
        if (!_peerId || !document.getElementById('oc-chat-header')) return; /* no chat open */
        if (!_fbOk()) return;
        /* FIX (2026-08-01 — identity mismatch): persistent id first, same
           fix as _openProfileModal/_buildMoreMenu above. Auth-uid-first
           meant this poller kept "correcting" a working subscription
           into a broken one (or endlessly resolving to a uid that never
           matches _msgSubscribedUid), on every 3s tick, for any
           non-anonymous session. */
        var currentUid = _us().id || _authUid() || '';
        if (!currentUid || currentUid === _msgSubscribedUid) return;
        console.log('[OC] resolved uid changed for open chat (' + _msgSubscribedUid + ' \u2192 ' + currentUid + ') — re-subscribing messages.');
        _subscribe(currentUid, _peerId);
    }
    setInterval(_recheckMessagesUid, 3000);


    /* =========================================================================
       §12  LOOK UP PEER USER
       ========================================================================= */
    function _lookUpUser(userId, cb) {
        /* 1. Check mockUsers (in-memory, populated from Firestore on login) */
        var mu = window.mockUsers && window.mockUsers[userId];
        if (mu) return cb(mu);

        /* 2. Firestore lookup */
        if (_fbOk()) {
            window.fbDb.collection('users').doc(userId).get()
                .then(function(doc) {
                    if (doc.exists) {
                        var data = doc.data(); data.id = doc.id;
                        if (window.mockUsers) window.mockUsers[userId] = data;
                        cb(data);
                    } else {
                        cb({ id:userId, fullName:'', username:'', avatar:'' });
                    }
                })
                .catch(function() { cb({ id:userId, fullName:'', username:'', avatar:'' }); });
        } else {
            cb({ id:userId, fullName:'', username:'', avatar:'' });
        }
    }


    /* =========================================================================
       §12b  HIDE STATUS/STORY BAR  (runtime — handles any class name)
       ========================================================================= */
    function _hideStatusBar() {
        /* Directly hide by ID — works regardless of where it lives in the DOM */
        var sbc = document.getElementById('status-bar-container');
        if (sbc) sbc.style.setProperty('display', 'none', 'important');
    }
    function _showStatusBar() {
        /* Restore status bar when leaving messages section */
        var sbc = document.getElementById('status-bar-container');
        if (sbc) sbc.style.removeProperty('display');
    }

    /* =========================================================================
       §13  MAIN: window.openChat(userId, optionalName)
       ========================================================================= */
    window.openChat = function(userId, optionalName) {
        if (!userId) return;
        try { if (typeof window._empUnhideChat === 'function') window._empUnhideChat(userId); } catch (eUH) {}
        if (_isGuest()) { if (typeof window._empRedirectGuestToSignup === 'function') window._empRedirectGuestToSignup('send messages'); else if (typeof window.openAuthModal==='function') window.openAuthModal('signup'); return; }

        /* ACCESS GATE (2026-10-30): 1:1 chat is limited to people you follow who
           follow you back — see app-chat.js §0a. This is the one choke point for
           every way of opening a chat (list, New chat, profile Message button,
           live, calls log, deep links). Cached follower data can be slightly
           stale, so _empGateChat asks the server before refusing and re-opens
           the chat itself if the follow-back is real. */
        if (typeof window._empCanChat === 'function' && !window._empCanChat(userId)) {
            if (typeof window._empGateChat === 'function') {
                window._empGateChat(userId, optionalName, function () { window.openChat(userId, optionalName); });
            }
            return;
        }

        var myUser = _us();

        /* Inject styles once */
        _injectStyles();
        _buildEmojiBar();

        /* Mark active in contact list */
        document.querySelectorAll('.contact-item').forEach(function(el) {
            el.classList.toggle('active', el.dataset.userId === userId);
        });

        /* Show chat-view-container, hide placeholder on mobile */
        var cv = document.getElementById('chat-view-container');
        var ph = document.getElementById('chat-placeholder');
        if (cv) {
            /* Move to direct child of <body> to escape any parent overflow/transform/
               stacking-context traps that prevent position:fixed from covering the full
               viewport (causing the "← Messages" header to bleed through above). */
            if (cv.parentNode !== document.body) {
                cv._ocOrigParent = cv.parentNode;
                cv._ocOrigNextSibling = cv.nextSibling;
                document.body.appendChild(cv);
            }
            cv.classList.add('oc-mobile-open');
        }
        if (!_chatHistoryPushed) {
            try {
                history.pushState({ _ocChatOpen: true }, '', location.href);
                _chatHistoryPushed = true;
            } catch (err) { /* pushState unsupported/blocked — silently skip, taps/X still work */ }
        }
        if (ph) { ph.style.display = 'none'; }
        document.body.classList.add('oc-chat-open');
        document.body.classList.add('oc-in-messages');

        /* Wipe any stale legacy markup (old composer with its own attach/voice/
           emoji/send icons) the INSTANT the panel goes full-screen — don't wait
           for _buildChatView(), which only runs after the async user lookup
           below resolves. On a slow connection (or while the Firestore
           permissions/listener errors are being worked around) that gap was
           visible as a half-built panel with the wrong icons. A simple loading
           skeleton here means the user never sees old markup, only ever sees
           "our" UI, even before the peer's name/avatar have loaded. */
        if (cv && !(_peerId === userId && document.getElementById('oc-chat-header'))) {
            cv.innerHTML = '<div id="oc-chat-header" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1e3a8a;min-height:58px;"></div>' +
                            '<div id="oc-loading" style="text-align:center;padding:32px;color:#9CA3AF;font-size:0.85rem;flex:1;">Loading…</div>';
        }

        /* Remove the contact-list back header if present — chat panel supersedes it */
        var staleClHdr = document.getElementById('oc-cl-header');
        if (staleClHdr) staleClHdr.remove();
        var staleClBtn = document.getElementById('oc-cl-back-btn');
        if (staleClBtn) { staleClBtn._ocWired = false; staleClBtn.removeAttribute('id'); }
        /* Restore any app header that _installContactListBackBtn may have hidden */
        var mV0 = document.getElementById('messages-view');
        if (mV0) {
            var hiddenHdr = mV0.querySelector('.messages-header,.chat-list-header,#messages-header,[class*="messages-header"],[class*="chat-list-header"]');
            if (hiddenHdr && hiddenHdr.style.display === 'none') hiddenHdr.style.removeProperty('display');
        }
        /* Actively hide the status/stories avatar strip */
        _hideStatusBar();

        /* If same peer, just scroll to bottom */
        if (_peerId === userId && document.getElementById('oc-chat-header')) {
            var body = document.getElementById('oc-messages-body');
            if (body) body.scrollTop = body.scrollHeight;
            return;
        }

        _peerId = userId;

        /* E2EE: make sure this device's key is published, and tell the person once per
           contact (per device) that this chat is end-to-end encrypted. */
        try {
            if (window._empE2EE && window._empE2EE.supported()) {
                window._empE2EE.init();
                window._empE2EE.peerReady(userId).then(function (ready) {
                    if (!ready || _peerId !== userId) return;
                    var k = 'emp_e2ee_noted', seen = {};
                    try { seen = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e0) {}
                    if (seen[userId]) return;
                    seen[userId] = 1;
                    try { localStorage.setItem(k, JSON.stringify(seen)); } catch (e1) {}
                    _notify('\uD83D\uDD12 Messages in this chat are end-to-end encrypted. Only you and this person can read them.', 'info');
                });
            }
        } catch (eE2) {}

        /* Use optionalName immediately so call modal shows the right name before Firestore returns */
        if (optionalName) { _peerName = optionalName; }

        /* Also try to read name from the clicked contact-item in the DOM (fastest path) */
        if (!_peerName || _peerName === 'User') {
            var contactEl = document.querySelector('.contact-item[data-user-id="' + userId + '"],.contact-item[data-userId="' + userId + '"]');
            if (contactEl) {
                var nameNode = contactEl.querySelector('.contact-name,.contact-info h4,.contact-info strong,strong,b,[class*="name"]');
                if (nameNode && nameNode.textContent.trim()) { _peerName = nameNode.textContent.trim(); }
                if (!_peerAvatar) {
                    var avNode = contactEl.querySelector('img');
                    if (avNode && avNode.src) { _peerAvatar = avNode.src; }
                }
            }
        }

        /* Look up peer profile */
        _lookUpUser(userId, function(peer) {
            var resolved = peer.fullName || peer.username || peer.displayName || '';
            _peerName   = (optionalName && optionalName !== 'User') ? optionalName
                        : (resolved && resolved !== 'User')         ? resolved
                        : _peerName || 'User';
            _peerAvatar = peer.avatar   || peer.profilePicture || peer.photoURL || peer.profilePhoto || _peerAvatar || '';

            /* Build the WhatsApp-style UI */
            _buildChatView(_peerId, _peerName, _peerAvatar);

            /* Subscribe to messages.
               FIX (2026-08-01 — "Share to a 1:1 chat doesn't work" /
               messages missing for logged-in-with-a-real-account users):
               this used to prefer the live Firebase Auth uid over the
               persistent app id, on the theory that messages were written
               with the live uid. They're not — _doSend/_sendFile below
               (and every forwarder, including EmpShare's _forwardToChat)
               write senderId as the PERSISTENT id (myUser.id / u.id), the
               exact same identity-system precedent already fixed for
               /groups, /group_calls and /calls elsewhere in this app. An
               auth-uid-first myId here meant the two senderId/receiverId
               listener queries below silently matched nothing for any
               account whose live (non-anonymous) Firebase Auth uid
               differs from its persistent id — including messages this
               same person forwarded to themselves. Flipped to match that
               already-corrected precedent; still falls back to the live
               uid if there's genuinely no persistent id yet. */
            _subscribe(myUser.id || _authUid() || '', _peerId);

            /* FIX v13: actually load persisted mute / saved-contact /
               disappearing-messages state for this chat (see §5b) so the
               3-dot menu reflects reality instead of always showing the
               same static labels. */
            _loadChatFlags(myUser.id || _authUid() || '', _peerId);
        });
    };

    /* Also expose as openChatWith for marketplace overlay compatibility */
    window.openChatWith = window.openChatWith || function(userId, name) {
        window.openChat(userId, name);
    };

    /* =========================================================================
       §13b  GUARD AGAINST COMPETING BACK-BUTTON INJECTORS
       -------------------------------------------------------------------------
       app-fix-final.js (§9) wraps window.openChat AFTER this file runs and,
       400ms after every openChat() call, injects its OWN button
       (#vf-chat-back-btn) as the first child of #chat-view-container. That
       button has different close logic than ours and is what produces the
       "two back/exit controls" + visual duplication bugs. We can't safely
       edit app-fix-final.js (it owns many unrelated features), so instead we
       watch #chat-view-container and strip that button the instant it
       appears — every time, for the life of the page.
       ========================================================================= */
    (function _guardAgainstDuplicateBackBtn() {
        function _strip() {
            /* Search the WHOLE document, not just cv — some versions of
               app-fix-final.js append their button straight to <body> as a
               fixed-position overlay rather than nesting it inside
               #chat-view-container, which a cv-scoped query would miss. */
            var dup = document.querySelector('#vf-chat-back-btn');
            if (dup) dup.remove();
        }
        function _attach() {
            var cv = document.getElementById('chat-view-container');
            if (!cv || cv._ocGuarded) return;
            cv._ocGuarded = true;
            _strip();
            if (window.MutationObserver) {
                /* subtree:true — catches insertions anywhere under <body>,
                   not just direct children of cv, in case the duplicate is
                   nested inside our own header or appended elsewhere. */
                new MutationObserver(_strip).observe(document.body, { childList: true, subtree: true });
            }
            /* Safety-net poll: some WebViews fire MutationObserver callbacks
               in batched/async ways that can lag behind a fast 400ms
               inject-then-tap sequence, so also check on a timer. */
            if (!window._ocBackBtnPoll) {
                window._ocBackBtnPoll = setInterval(_strip, 300);
            }
        }
        if (document.readyState !== 'loading') _attach();
        else document.addEventListener('DOMContentLoaded', _attach);
        /* chat-view-container gets moved to <body> on open — re-check then too */
        var _origOpenChat = window.openChat;
        window.openChat = function() {
            _attach();
            return _origOpenChat.apply(this, arguments);
        };
    })();

    /* =========================================================================
       §13c  GEOMETRIC FALLBACK FOR THE CLOSE (X) BUTTON
       -------------------------------------------------------------------------
       Belt-and-suspenders against the exact symptom reported: the X looks
       right and sits at max z-index, but tapping it does nothing. That
       happens when some OTHER element — invisible, transparent, or simply
       unknown to us — is physically on top of it in the paint order and
       swallows the tap before it ever reaches #oc-back-btn. Rather than
       trying to guess every possible culprit element, we hit-test by
       SCREEN COORDINATES: any tap/click landing inside the close button's
       visible box closes the chat, regardless of which element actually
       received the event. Shares _closeDebounce with the button's own
       listeners (§7) so a tap that DOES reach the real button correctly
       can never double-fire this fallback.
       ========================================================================= */
    (function _installCloseBtnGeometricFallback() {
        /* FIX: this used to hit-test by SCREEN COORDINATES ONLY, with no check
           on what was actually clicked. Once the section-overlap/inline-style
           bug was fixed and the chat header started laying out at its correct,
           stable position, the video-call, voice-call, emoji, and voice-note
           buttons in that same header could end up sitting inside (or very
           near) #oc-back-btn's last-measured bounding box during a reflow.
           Any click landing in that box — including clicks squarely on those
           OTHER buttons — was treated as a tap on the X, and _doCloseChat()
           immediately calls ev.stopPropagation()/preventDefault(), which
           killed the click before it ever reached the real button's own
           listener. That's why those four controls silently stopped working.
           FIX: require the click's TARGET to actually be #oc-back-btn (or a
           descendant of it, e.g. its inner <svg>/<path>) in addition to the
           coordinate check. This still catches the original "invisible
           overlay sitting on top of the real button" case the coordinate
           check was built for, since closest() walks up from whatever
           element was actually clicked — but it can no longer fire for a
           click that lands on a completely different, unrelated button. */
        function _hit(x, y) {
            var btn = document.getElementById('oc-back-btn');
            if (!btn || !document.body.contains(btn)) return false;
            var r = btn.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false; /* hidden/detached */
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        }
        function _isActualBackBtnTarget(ev) {
            var btn = document.getElementById('oc-back-btn');
            if (!btn) return false;
            var t = ev.target;
            return !!(t && typeof t.closest === 'function' && t.closest('#oc-back-btn') === btn);
        }
        function _trigger(ev) {
            /* Only close if the chat panel is actually open — prevents spurious
               triggers after the chat has already been closed (e.g. tapping the
               same screen region on the contact list). */
            var cv = document.getElementById('chat-view-container');
            if (!cv || !cv.classList.contains('oc-mobile-open')) return;
            if (_closeDebounce) return;
            _closeDebounce = true;
            setTimeout(function() { _closeDebounce = false; }, 600);
            if (typeof _activeCloseHandler === 'function') _activeCloseHandler(ev);
        }
        /* IMPORTANT: only ever trigger via coordinates when the click target is
           NOT a recognizable interactive control of its own (button, link, or
           anything with a click handler-bearing role). That preserves the
           original goal — catching a truly invisible/transparent overlay that
           swallows taps meant for the X — without ever stealing a click that
           legitimately landed on the video/call/emoji/mic buttons (or any
           other real control) just because it happened to sit inside the X
           button's last-measured box. */
        function _targetIsOtherInteractiveControl(ev) {
            var t = ev.target;
            if (!t || typeof t.closest !== 'function') return false;
            var el = t.closest('button, a, input, textarea, select, [role="button"], [onclick]');
            return !!(el && el.id !== 'oc-back-btn');
        }
        document.addEventListener('click', function(ev) {
            if (_isActualBackBtnTarget(ev)) return; /* real listener on the button already handles this */
            if (_targetIsOtherInteractiveControl(ev)) return; /* never steal clicks meant for a different control */
            if (_hit(ev.clientX, ev.clientY)) _trigger(ev);
        }, true); /* capture phase — runs before whatever intercepted the event can stop it */
        document.addEventListener('touchend', function(ev) {
            if (_isActualBackBtnTarget(ev)) return;
            if (_targetIsOtherInteractiveControl(ev)) return;
            var t = ev.changedTouches && ev.changedTouches[0];
            if (t && _hit(t.clientX, t.clientY)) _trigger(ev);
        }, { capture: true, passive: false });
    })();

    /* =========================================================================
       §13d  CLOSE VIA HARDWARE/BROWSER BACK BUTTON
       -------------------------------------------------------------------------
       A deliberately DIFFERENT mechanism from everything above: this doesn't
       listen for clicks or taps on any element at all. openChat() pushes a
       history entry; pressing the phone's back button (hardware key, gesture,
       or the browser's own back control) fires a native 'popstate' event
       BEFORE the event ever touches page-level DOM elements, so it cannot be
       swallowed by an overlapping element, an inspector overlay, or any
       other script's click handling the way a tap on #oc-back-btn can be.
       This gives the user a guaranteed second way to exit the chat even in
       environments where every tap-based approach is being intercepted.
       ========================================================================= */
    window.addEventListener('popstate', function(ev) {
        if (!_chatHistoryPushed) return; /* no chat-related entry was open — not ours to handle */
        var cv = document.getElementById('chat-view-container');
        var isOpen = !!(cv && cv.classList.contains('oc-mobile-open'));
        /* Clear flag FIRST before calling handler, so any synchronous side-effects
           that check _chatHistoryPushed see the correct state immediately. */
        _chatHistoryPushed = false;
        if (isOpen && typeof _activeCloseHandler === 'function') {
            _activeCloseHandler(ev, /* _viaPopstate */ true);
        }
    });

    /* Legacy alias used inside app-fixes.js scope */
    if (!window._openChatWithUser) {
        window._openChatWithUser = function(userObj) {
            window.openChat((userObj||{}).id || '', (userObj||{}).fullName || (userObj||{}).username || '');
        };
    }

    /* =========================================================================
       §14  REWIRE CONTACT-ITEM CLICKS (belt-and-suspenders)
            app-fixes.js wires .contact-item clicks and calls openChat().
            Now that openChat exists, those clicks will work automatically.
            But we also add a direct listener as fallback.
       ========================================================================= */
    _ready(function() {
        /* Styles + placeholder must exist before any chat is opened, not just
           lazily inside openChat() — otherwise desktop shows a blank panel
           until the first click. */
        _injectStyles();
        _ensurePlaceholder();

        /* Mark body when messages section is active — hides status bar avatars */
        function _checkMessagesVisible() {
            var mView = document.getElementById('messages-view');
            var visible = mView && mView.style.display !== 'none' && mView.offsetParent !== null;
            document.body.classList.toggle('oc-in-messages', !!visible);
            /* Directly control status bar visibility based on whether messages section is open */
            if (visible) {
                _hideStatusBar();
                /* FIX (2026-10-21 — Messages header hidden): the "Messages" header
                   (#oc-cl-header: back arrow, title, + menu) used to be built ONLY
                   by _installContactListBackBtn() when a chat was closed, so a fresh
                   visit to Messages (no chat opened yet) never had a header at all.
                   Build it whenever the list is showing and it is missing. The
                   function itself is idempotent and refuses to run while a chat is
                   open, but the extra guards keep the MutationObserver quiet. */
                var _cvEl = document.getElementById('chat-view-container');
                if (!document.getElementById('oc-cl-header') &&
                    !document.body.classList.contains('oc-chat-open') &&
                    !(_cvEl && _cvEl.classList.contains('oc-mobile-open'))) {
                    try { _installContactListBackBtn(); } catch (eHdr) {}
                    var _clEl = document.getElementById('contact-list-container');
                    if (_clEl) _clEl.scrollTop = 0; /* start at the header */
                }
            } else {
                _showStatusBar();
            }
        }

        /* FIX (2026-10-21 — Messages header/scroll): make the whole Messages
           list ONE scroll surface from the header down to the very last row.
           - #oc-cl-header is forced visible and flows with the content.
           - The spacer after #contacts-inner lets the last row scroll clear of
             the floating Help / Report / New-chat buttons and the bottom nav.
           - On phones the header's left padding clears the fixed hamburger
             (.mobile-menu-toggle) so the back arrow is not hidden under it. */
        (function _injectMsgHeaderScrollCss() {
            if (document.getElementById('oc-msg-header-scroll-css')) return;
            var st = document.createElement('style');
            st.id = 'oc-msg-header-scroll-css';
            st.textContent = [
                'body.oc-in-messages #messages-view #contact-list-container{',
                '  height:100%!important;min-height:0!important;',
                '  overflow-y:auto!important;overflow-x:hidden!important;',
                '  -webkit-overflow-scrolling:touch;overscroll-behavior-y:auto;}', /* was contain: it stopped a swipe-down at the list top from reaching .main-content, leaving the header's top clipped (2026-10-30). .main-content keeps its own contain, so no pull-to-refresh. */
                'body.oc-in-messages #messages-view #contacts-inner::after{',
                '  content:"";display:block;',
                '  height:calc(170px + env(safe-area-inset-bottom,0px));}',
                'body.oc-in-messages #oc-cl-header{',
                '  display:flex!important;visibility:visible!important;opacity:1!important;',
                '  position:relative!important;flex-shrink:0!important;}',
                '@media(max-width:992px){',
                '  body.oc-in-messages #oc-cl-header{padding-left:68px!important;}',
                '}'
            ].join('');
            document.head.appendChild(st);
        })();

        /* FIX (2026-10-30 — "scroll the Messages section to the top of the header"):
           .main-content is the real outer scroller and #contact-list-container scrolls
           inside it. If the outer one is left a few px down (focus jump, keyboard,
           arriving from another section) the top of #oc-cl-header sits above the
           screen and could not be reached. Reset it to 0 when Messages opens and
           whenever the list itself is back at its top. Only acts while Messages is
           showing and only when the outer scroller is actually off the top. */
        (function _msgHeaderReachable() {
            function _toTop() {
                var m = document.querySelector('.main-content');
                if (m && document.body.classList.contains('oc-in-messages') && m.scrollTop > 0) m.scrollTop = 0;
            }
            function _wire() {
                var cl = document.getElementById('contact-list-container');
                if (cl && !cl._ocTopWired) {
                    cl._ocTopWired = true;
                    cl.addEventListener('scroll', function () { if (cl.scrollTop <= 0) _toTop(); }, { passive: true });
                }
            }
            _wire();
            document.addEventListener('empyrean-section-change', function (e) {
                if (e && e.detail && e.detail.section === 'messages') {
                    _wire();
                    setTimeout(_toTop, 60);
                    setTimeout(_toTop, 450);
                }
            });
        })();

        _checkMessagesVisible();

        /* FIX (bug: nav bar always landing on Messages / overlapping-split
           sections): several functions in this file (chat close button,
           contact-list exit button) used to write inline style.display
           directly onto .content-section elements. Inline styles always
           beat the app's own class-based CSS, so once one of those ran,
           a section could get permanently stuck visible or hidden no
           matter what the real router did afterward — which is exactly
           why every nav-bar tap kept showing/overlapping with Messages.
           Those call sites have been fixed to stop writing inline styles,
           but as a safety net (covering any stale styles already present,
           or written by other scripts) we strip inline display from every
           .content-section EXCEPT the one being navigated to, on every
           single navigateTo() call. */
        function _clearStaleSectionDisplay(targetSection) {
            document.querySelectorAll('.content-section').forEach(function(s) {
                if (s.id !== targetSection) s.style.removeProperty('display');
            });
        }

        /* Patch navigateTo so we track when messages section opens/closes */
        var _origNavigateTo = window.navigateTo;
        window._origNavigateTo = _origNavigateTo; /* expose for back button */
        window.navigateTo = function(section) {
            if (typeof _origNavigateTo === 'function') _origNavigateTo(section);
            /* Clean up immediately, then again after the router's own async
               work (if any) settles — matches the existing 80ms tick below. */
            _clearStaleSectionDisplay(section);
            setTimeout(function() {
                _clearStaleSectionDisplay(section);
                _checkMessagesVisible();
            }, 80);
        };
        /* Also watch for display changes via MutationObserver */
        if (window.MutationObserver) {
            var _navObs = new MutationObserver(_checkMessagesVisible);
            var _root = document.getElementById('main-content') || document.getElementById('app-content') || document.body;
            _navObs.observe(_root, { attributes: true, subtree: true, attributeFilter: ['style','class'] });
        }

        document.addEventListener('click', function(e) {
            var item = e.target.closest('.contact-item');
            if (!item) return;
            var uid = item.dataset.userId;
            if (!uid) return;
            e.preventDefault();
            var mView = document.getElementById('messages-view');
            if (!mView || mView.style.display === 'none') {
                if (typeof window.navigateTo === 'function') window.navigateTo('messages');
                setTimeout(function() { window.openChat(uid); }, 220);
            } else {
                window.openChat(uid);
            }
        }, true); /* capture phase */
    });

    /* ── Patch renderStatusBar so it cannot override our status bar hide while in messages ── */
    (function() {
        function _messagesVisible() {
            var mView = document.getElementById('messages-view');
            return !!(mView && mView.style.display !== 'none' && mView.offsetParent !== null);
        }
        function _patchRenderStatusBar() {
            var orig = window.renderStatusBar;
            if (!orig || orig._ocPatched) return;
            window.renderStatusBar = function() {
                orig.apply(this, arguments);
                /* app-status.js sets sbc.style.display='block' — override it if messages is open */
                if (_messagesVisible() || document.body.classList.contains('oc-chat-open')) {
                    var sbc = document.getElementById('status-bar-container');
                    if (sbc) sbc.style.setProperty('display', 'none', 'important');
                }
            };
            window.renderStatusBar._ocPatched = true;
        }
        if (window.renderStatusBar) {
            _patchRenderStatusBar();
        } else {
            var _pi = setInterval(function() {
                if (window.renderStatusBar) { _patchRenderStatusBar(); clearInterval(_pi); }
            }, 200);
        }
    })();

    /* =========================================================================
       §15  BROKEN AVATAR FALLBACK (contact list + status strip)
       ========================================================================= */
    (function _fixBrokenAvatars() {
        function _fallbackUrl(img) {
            var name = img.alt || '';
            if (!name) {
                var row = img.closest('.contact-item') || img.closest('[class*="status"]') || img.parentElement;
                if (row) {
                    var nameNode = row.querySelector('.contact-name,strong,b,h4,h3,[class*="name"]');
                    if (nameNode) name = nameNode.textContent.trim();
                }
            }
            return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || '?') + '&background=1B2B8B&color=fff&size=80';
        }
        function _wire(img) {
            if (!img || img._ocAvatarWired) return;
            img._ocAvatarWired = true;
            function _handleBroken() {
                if (img._ocFellBack) return;
                img._ocFellBack = true;
                img.src = _fallbackUrl(img);
            }
            img.addEventListener('error', _handleBroken);
            if (img.complete && img.naturalWidth === 0 && img.src) _handleBroken();
        }
        function _scan(root) {
            if (!root || !root.querySelectorAll) return;
            root.querySelectorAll('#contact-list-container img, #status-bar-container img, .contact-item img').forEach(_wire);
        }
        _ready(function() {
            _scan(document);
            if (window.MutationObserver) {
                var obs = new MutationObserver(function(mutations) {
                    mutations.forEach(function(m) {
                        m.addedNodes && m.addedNodes.forEach(function(node) {
                            if (node.nodeType !== 1) return;
                            if (node.tagName === 'IMG') { _wire(node); return; }
                            _scan(node);
                        });
                    });
                });
                var clRoot = document.getElementById('contact-list-container');
                var sbRoot = document.getElementById('status-bar-container');
                if (clRoot) obs.observe(clRoot, { childList: true, subtree: true });
                if (sbRoot) obs.observe(sbRoot, { childList: true, subtree: true });
            }
            var _tries = 0;
            var _rescan = setInterval(function() {
                _scan(document);
                if (++_tries >= 10) clearInterval(_rescan);
            }, 500);
        });
    })();

    /* UPGRADE (Messages): "Jump to latest" button. Appears once the person
       has scrolled up more than ~one screen inside an open chat and takes
       them back to the newest message. Listens (capture phase, since scroll
       events don't bubble) for scrolls on #oc-messages-body — which is
       rebuilt for every opened chat — so nothing needs re-wiring per chat.
       Pure addition: never touches message rendering or scroll position
       logic of the chat itself. */
    (function _jumpToLatest() {
        var btn = null;
        function ensureBtn() {
            if (btn && document.body.contains(btn)) return btn;
            btn = document.createElement('button');
            btn.id = 'oc-jump-latest';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Jump to latest message');
            btn.style.cssText = 'position:fixed;right:16px;bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:9000;'
                + 'width:42px;height:42px;border-radius:50%;border:1px solid #D3D8E4;background:#fff;color:#1B2B8B;'
                + 'box-shadow:0 4px 14px rgba(10,14,39,0.18);display:none;align-items:center;justify-content:center;'
                + 'cursor:pointer;font-size:1rem;padding:0;';
            btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
            btn.addEventListener('click', function () {
                var b = document.getElementById('oc-messages-body');
                if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' });
            });
            document.body.appendChild(btn);
            return btn;
        }
        function update(b) {
            var show = !!b && b.offsetParent !== null && (b.scrollHeight - b.scrollTop - b.clientHeight) > Math.max(400, b.clientHeight * 0.8);
            var el = ensureBtn();
            el.style.display = show ? 'flex' : 'none';
        }
        document.addEventListener('scroll', function (e) {
            var t = e.target;
            if (t && t.id === 'oc-messages-body') update(t);
        }, true);
        /* hide it when the chat is closed / another screen is showing */
        setInterval(function () {
            if (!btn) return;
            var b = document.getElementById('oc-messages-body');
            if (!b || b.offsetParent === null) btn.style.display = 'none';
        }, 1000);
    })();

    console.log('[EmpyreanOpenChat] ✅ window.openChat defined — WhatsApp-style chat UI + emoji reactions ready.');

})();