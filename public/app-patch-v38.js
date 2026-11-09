/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v38 (DIAGNOSTIC ONLY — NO BEHAVIOR CHANGE)
   app-patch-v38.js  |  Load LAST (after everything else, including v37)

   PURPOSE: pin down two reported regressions — audio echoing (affecting
   viewers, the host, AND the guest broadcaster themselves) and tapping
   freezing (not confined to the live screen) — before writing an actual
   fix. Guessing at either in a codebase this layered risks introducing a
   THIRD bug on top, which is exactly what was asked to be avoided. This
   patch changes nothing about how the app behaves; it only observes and
   logs, so it is safe to ship, reproduce against, then remove once the
   real fix is written.

   ═══════════════════════════════════════════════════════════════════════
   WHAT IT LOGS
   ═══════════════════════════════════════════════════════════════════════
   §1 — Every AgoraRTC.createClient() call, and every join/leave/publish/
        unpublish on the client it returns: timestamp, channel, uid, and
        (for createClient) the top few stack frames of WHO created it.
        AgoraRTC's real methods are still called exactly as before —
        this only wraps them to log before/after, via each client's own
        instance methods (does not touch AgoraRTC's prototype globally,
        so unrelated Agora usage elsewhere is unaffected). If the echo
        is caused by more than one client ending up joined to the same
        channel at once, or a client re-joining before a previous one
        finished leaving, this log will show it directly — no guessing.
        Running totals live in window._empAgoraDiag.events (last 200).

   §2 — A capture-phase click listener on `document` that only records
        which element was tapped (id/class/tag) into a rolling buffer
        (window._empClickDiag, last 30) — it never calls
        preventDefault() or stopPropagation(), so it cannot change which
        element receives the tap or how any existing handler responds
        to it. Alongside that, a window 'error' and 'unhandledrejection'
        listener logs any uncaught exception together with the last few
        taps that preceded it. Since several files (app-fixes.js in
        particular) route many different actions through one shared
        document-level click handler, an exception thrown partway
        through handling one tap can silently stop the rest of that
        SAME handler from running for that tap — which looks exactly
        like "tapping stopped working," anywhere in the app, not just on
        the live screen. This makes that failure visible instead of
        silent, without changing what happens when no error occurs.

   ═══════════════════════════════════════════════════════════════════════
   HOW TO USE IT
   ═══════════════════════════════════════════════════════════════════════
   Load this after everything else, reproduce either bug (start a live
   stream / join as a viewer / promote a guest and let the echo happen;
   or tap around until the screen freezes), then open the browser
   console and copy back:
     - every line prefixed [V38-DIAG], and/or
     - the output of `window._empAgoraDiag.events` and
       `window._empClickDiag` (typed directly into the console)
   That's what turns "it echoes" / "it froze" into an actual root cause
   instead of a guess.
   ============================================================================= */

(function empyreanPatchV38() {
    'use strict';

    if (window._empPatchV38Loaded) {
        console.warn('[V38] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV38Loaded = true;

    function log(msg) { console.log('[V38-DIAG] ' + msg); }

    /* =========================================================================
       §1 — Agora client lifecycle instrumentation (observational only —
       every wrapped method still calls straight through to the real
       Agora SDK method with the same arguments and return value).
       ========================================================================= */
    window._empAgoraDiag = { activeClients: 0, events: [] };

    function _record(kind, detail) {
        var entry = { t: Date.now(), kind: kind, detail: detail };
        window._empAgoraDiag.events.push(entry);
        if (window._empAgoraDiag.events.length > 200) window._empAgoraDiag.events.shift();
        log(kind + ' ' + JSON.stringify(detail) + ' (active Agora clients right now: ' + window._empAgoraDiag.activeClients + ')');
    }

    function _instrumentClient(client, callerStack) {
        if (!client || client._pv38Wrapped) return client;
        client._pv38Wrapped = true;
        client._pv38CreatedAt = Date.now();

        if (typeof client.join === 'function') {
            var origJoin = client.join.bind(client);
            client.join = function (appId, channel, token, uid) {
                _record('join:start', { channel: channel, uid: uid });
                return origJoin(appId, channel, token, uid).then(function (res) {
                    window._empAgoraDiag.activeClients++;
                    client._pv38Joined = true;
                    _record('join:success', { channel: channel, uid: uid, resultUid: res });
                    return res;
                }, function (err) {
                    _record('join:error', { channel: channel, uid: uid, error: err && err.message });
                    throw err;
                });
            };
        }

        if (typeof client.leave === 'function') {
            var origLeave = client.leave.bind(client);
            client.leave = function () {
                _record('leave:start', {});
                return origLeave().then(function (res) {
                    if (client._pv38Joined) { window._empAgoraDiag.activeClients--; client._pv38Joined = false; }
                    _record('leave:success', {});
                    return res;
                }, function (err) {
                    _record('leave:error', { error: err && err.message });
                    throw err;
                });
            };
        }

        if (typeof client.publish === 'function') {
            var origPublish = client.publish.bind(client);
            client.publish = function (tracks) {
                _record('publish', { count: Array.isArray(tracks) ? tracks.length : 1, createdFrom: callerStack });
                return origPublish(tracks);
            };
        }

        if (typeof client.unpublish === 'function') {
            var origUnpublish = client.unpublish.bind(client);
            client.unpublish = function (tracks) {
                _record('unpublish', { count: Array.isArray(tracks) ? tracks.length : 1 });
                return origUnpublish(tracks);
            };
        }

        return client;
    }

    function _armAgoraInstrumentation() {
        if (typeof AgoraRTC === 'undefined' || AgoraRTC._pv38Wrapped) return;
        var origCreateClient = AgoraRTC.createClient.bind(AgoraRTC);
        AgoraRTC.createClient = function (config) {
            var stack = (new Error('client created')).stack || '';
            var client = origCreateClient(config);
            _record('createClient', { mode: config && config.mode, calledFrom: stack.split('\n').slice(1, 4).join(' | ') });
            return _instrumentClient(client, stack);
        };
        AgoraRTC._pv38Wrapped = true;
        log('Agora instrumentation armed.');
    }
    _armAgoraInstrumentation();
    setTimeout(_armAgoraInstrumentation, 500);
    setTimeout(_armAgoraInstrumentation, 1500);
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_armAgoraInstrumentation, 50); });
    /* 2026-10-28: the SDK is lazy-loaded now (index.html's window._empLoadAgora) — arm the instant it actually exists. */
    window.addEventListener('empyrean:agora-ready', function () { _armAgoraInstrumentation(); });

    /* =========================================================================
       §2 — click + uncaught-error/rejection correlation. Capture phase,
       records only — never calls preventDefault()/stopPropagation(), so
       this cannot change which element a tap resolves to or how any
       existing handler reacts to it.
       ========================================================================= */
    window._empClickDiag = [];
    document.addEventListener('click', function (e) {
        try {
            var t = e.target;
            var desc = t ? (t.id ? ('#' + t.id) : (typeof t.className === 'string' && t.className ? '.' + t.className.trim().split(/\s+/).join('.') : t.tagName)) : 'unknown';
            window._empClickDiag.push({ t: Date.now(), desc: desc });
            if (window._empClickDiag.length > 30) window._empClickDiag.shift();
        } catch (eDiag) { /* never let the diagnostic itself break a tap */ }
    }, true);

    function _lastClicks(n) {
        return window._empClickDiag.slice(-n).map(function (c) { return c.desc; }).join(' -> ');
    }

    window.addEventListener('error', function (e) {
        /* FIX (2026-08-10): same opaque-cross-origin case app-fixes.js's
           window.onerror now labels explicitly — e.message === 'Script
           error.' with no filename/lineno means the browser withheld
           every detail because the throwing script loaded cross-origin
           without CORS (almost always a third-party tag: AdSense, Google
           CSE, Flutterwave — see index.html's own script tags), not an
           Empyrean bug this diagnostic failed to capture. Labeled here
           too so it doesn't read as an unexplained app failure in the
           console right alongside genuine [V38-DIAG] catches, which
           always do have a real filename/lineno since every first-party
           script here is same-origin. */
        if (e.message === 'Script error.' && !e.filename && !e.lineno) {
            /* console.warn, not console.error — this case is already
               confirmed benign (third-party tag, not Empyrean code), so it
               shouldn't paint red next to a genuine [V38-DIAG] catch below.
               NOTE: the "Error: Script error." line the browser itself
               prints immediately above this one is native browser console
               output for the uncaught cross-origin exception — it's logged
               by the browser before this handler ever runs, so no app code
               (this file included) can suppress or recolor that specific
               line. This only affects our own follow-up log line. */
            console.warn('[V38-DIAG] Opaque cross-origin script error (no file/line — third-party tag, not Empyrean code) | last taps: ' + _lastClicks(5));
            return;
        }
        console.error('[V38-DIAG] Uncaught error: ' + e.message + ' at ' + e.filename + ':' + e.lineno +
            ' | last taps: ' + _lastClicks(5) +
            (e.error && e.error.stack ? ('\n' + e.error.stack) : ''));
    });
    /* FIX (2026-08-30 — permission-denied errors reported as "interrupting"
       share/navigation flows): this listener could already SHOW an
       unhandled Firestore rejection, but never said WHICH collection/
       operation it came from (Firestore's own error.message is always the
       generic "Missing or insufficient permissions." — no path, no
       operation), so a report like this session's screenshots could be
       seen happening but not pinpointed to a specific fix. Two additions,
       still purely observational — nothing here changes what the app
       does, only what gets logged:
         1. reason.code (Firestore's own machine-readable error code, e.g.
            'permission-denied') is now included — cheap, was simply never
            read before.
         2. The exact same message firing twice within a short window
            (visible in this session's own screenshots — two identical
            "Missing or insufficient permissions" blocks back to back) is
            now collapsed into one log line with a repeat count, instead of
            printing the full block twice — makes a genuine second,
            different failure easy to spot instead of getting lost in a
            duplicate of the first. */
    var _lastRejectionKey = null, _lastRejectionAt = 0, _rejectionRepeatCount = 0;
    window.addEventListener('unhandledrejection', function (e) {
        var reason = e.reason;
        var msg = (reason && reason.message) ? reason.message : String(reason);
        var code = reason && reason.code ? (' [code=' + reason.code + ']') : '';
        var key = msg + code;
        var now = Date.now();
        if (key === _lastRejectionKey && (now - _lastRejectionAt) < 1500) {
            _rejectionRepeatCount++;
            console.error('[V38-DIAG] (repeat x' + (_rejectionRepeatCount + 1) + ') Unhandled promise rejection: ' + msg + code);
            _lastRejectionAt = now;
            return;
        }
        _lastRejectionKey = key;
        _lastRejectionAt = now;
        _rejectionRepeatCount = 0;
        console.error('[V38-DIAG] Unhandled promise rejection: ' + msg + code +
            ' | last taps: ' + _lastClicks(5) +
            (reason && reason.stack ? ('\n' + reason.stack) : ''));
    });

    console.log('[EmpyreanPatchV38] \u2705 Diagnostics-only patch armed \u2014 no behavior changed. Reproduce the echo or the frozen-tap bug, then copy back the [V38-DIAG] console lines (or window._empAgoraDiag.events / window._empClickDiag) so the real fix can be written from evidence instead of a guess.');

})();