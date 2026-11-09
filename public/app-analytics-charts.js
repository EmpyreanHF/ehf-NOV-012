/* =============================================================================
   EMPYREAN INTERNATIONAL — PLATFORM ANALYTICS (ADMIN) + CREATOR ANALYTICS (PROFILE)
   app-analytics-charts.js  |  Load after app-analytics.js (tracking) — see index.html.

   2026-11-07 REBUILD — what changed and why
   ──────────────────────────────────────────────────────────────────────────
   1. ONE dashboard, no legacy. The old "Engagement & Visitor Analytics" cards, the 14-day bar
      chart, "Interactive Insights" and the pie are gone: index.html now ships only an empty
      mount (#emp-admin-analytics-root) and this file paints the Platform Analytics layout from
      the approved mockup into it. If a stale copy of the old markup is ever served (cached
      index.html), mounting wipes it first, so the old panels can never show again.
   2. REAL numbers only. The layout follows the mockup (5 KPI cards, overview chart, top
      creators, creator funnel, needs-attention queue) but every figure is read from Firestore
      (analytics_daily written by app-analytics.js, users, withdrawal_queue). Where the app does
      not record something (ad revenue, server load, audience city) the panel says so instead of
      showing an invented number.
   3. Creator Analytics (Profile → Analytics) replaces the card that failed with
      "Could not load your post data (timeout)". The post read is now cache-first (instant paint
      from the local Firestore cache), then the server with a 25 s window and one automatic retry;
      a failure shows a Retry button on top of whatever data we have — never a dead message.
   5. 2026-11-07 (Ads + audience + server health): the "not recorded yet" gaps are closed with REAL data only —
      Ad revenue + campaign review (server.js /api/admin/ads/*, ad_daily), Server health (server.js /api/admin/server-stats),
      Audience cities (analytics_daily.cities, written by app-analytics.js) and creator Audience (post_views). If
      Firestore rules reject the browser's read (permission-denied) the dashboard now falls back to the same data read
      through the server (/api/admin/analytics/bundle) instead of showing zeros.
   4. No vanishing. The last good HTML is cached and re-injected synchronously whenever a mount
      is found empty (MutationObserver + tab clicks + section changes), and every paint
      re-resolves its container by id, so a profile/admin DOM rebuild can't strand the output.
   ============================================================================= */

(function empyreanExecutiveAnalytics() {
    'use strict';

    if (window._empAnalyticsExecutiveLoaded) {
        console.warn('[Analytics] Executive suite already loaded.');
        return;
    }
    window._empAnalyticsExecutiveLoaded = true;

    /* ───────────────────────────── helpers ───────────────────────────── */
    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb && typeof window.fbDb.collection === 'function'); }
    function _us() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _tmo(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject({ code: 'timeout', message: 'Request timed out' }); }, ms || 15000);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function _fmtN(n) {
        n = Math.round(n || 0);
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        return n.toLocaleString();
    }
    function _fmtDur(sec) {
        sec = Math.max(0, Math.round(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
        return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    }
    // Same Africa/Lagos day keys the tracker (app-analytics.js) writes with.
    var TZ_MS = 3600000;
    function _dayKey(ago) { return new Date(Date.now() + TZ_MS - (ago || 0) * 86400000).toISOString().slice(0, 10); }
    function _dayStartISO(key) { return new Date(key + 'T00:00:00+01:00').toISOString(); }
    function _shortDay(key) { return key.slice(5).replace('-', '/'); }
    function _weekday(key) { try { return new Date(key + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }); } catch (e) { return _shortDay(key); } }
    function _download(name, text) {
        try {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
            a.download = name; document.body.appendChild(a); a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 600);
        } catch (e) { console.warn('[Analytics] CSV export failed:', e && e.message); }
    }
    function _csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function _delta(cur, prev) {
        if (cur == null || prev == null) return { txt: '—', cls: 'fl' };
        if (!prev) return cur > 0 ? { txt: 'New', cls: 'up' } : { txt: '0%', cls: 'fl' };
        var p = (cur - prev) / prev * 100, r = Math.abs(p) < 10 ? Math.round(p * 10) / 10 : Math.round(p);
        return { txt: (r > 0 ? '\u2191 +' : r < 0 ? '\u2193 ' : '') + r + '%', cls: r > 0 ? 'up' : r < 0 ? 'dn' : 'fl' };
    }
    function _whenFb(cb, maxMs) {
        if (_fbOk()) { cb(true); return; }
        var waited = 0, t = setInterval(function () {
            waited += 500;
            if (_fbOk()) { clearInterval(t); cb(true); }
            else if (waited >= (maxMs || 20000)) { clearInterval(t); cb(false); }
        }, 500);
    }

    /* ───────────────────────────── styles ───────────────────────────── */
    (function injectCSS() {
        if (document.getElementById('emp-exec-analytics-css')) return;
        var s = document.createElement('style');
        s.id = 'emp-exec-analytics-css';
        s.textContent =
            '.ea{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1e293b;}' +
            '.ea *{box-sizing:border-box;}' +
            '.ea-admin{background:#f8fafc;border-radius:18px;padding:22px;min-height:100%;}' +
            '.ea-head{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px;margin-bottom:22px;}' +
            '.ea-h1{font-size:1.6rem;font-weight:900;color:#0b1528;margin:0 0 4px;letter-spacing:-.5px;}' +
            '.ea-subtitle{font-size:.8rem;color:#64748b;margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
            '.ea-live{display:inline-flex;align-items:center;gap:6px;font-weight:800;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:20px;padding:2px 10px;font-size:.72rem;}' +
            '.ea-live i{width:7px;height:7px;border-radius:50%;background:#10b981;display:inline-block;animation:eaPulse 1.6s infinite;}' +
            '@keyframes eaPulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.5)}70%{box-shadow:0 0 0 7px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}' +
            '.ea-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
            '.ea-seg{display:inline-flex;background:#e2e8f0;padding:3px;border-radius:10px;}' +
            '.ea-seg button{border:0;background:transparent;padding:7px 14px;font-size:.75rem;font-weight:700;color:#64748b;border-radius:7px;cursor:pointer;min-height:34px;}' +
            '.ea-seg button.on{background:#fff;color:#1d4ed8;box-shadow:0 1px 3px rgba(0,0,0,.08);}' +
            '.ea-btn{background:#0c1e4a;color:#fff;border:0;padding:8px 16px;border-radius:10px;font-size:.75rem;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:36px;}' +
            '.ea-btn.ghost{background:#fff;color:#1B2B8B;border:1.5px solid #d5daea;}' +
            '.ea-btn:disabled{opacity:.55;cursor:default;}' +
            '.ea-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:22px;}' +
            '.ea-kpi{background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:16px;box-shadow:0 2px 4px rgba(0,0,0,.02);}' +
            '.ea-kpi .t{font-size:.68rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.5px;}' +
            '.ea-kpi .v{font-size:1.5rem;font-weight:900;color:#0b1528;margin:4px 0 2px;}' +
            '.ea-kpi .s{font-size:.7rem;color:#94a3b8;margin-top:2px;}' +
            '.ea-d{font-size:.72rem;font-weight:800;}.ea-d.up{color:#059669;}.ea-d.dn{color:#e11d48;}.ea-d.fl{color:#64748b;}' +
            '.ea-mid{display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:22px;}' +
            '.ea-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px;margin-bottom:22px;}' +
            '@media(max-width:820px){.ea-mid{grid-template-columns:1fr;}.ea-admin{padding:14px;}}' +
            '.ea-card{background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:20px;box-shadow:0 2px 6px rgba(0,0,0,.02);min-width:0;}' +
            '.ea-card h3{font-size:.95rem;font-weight:800;color:#0f172a;margin:0;}' +
            '.ea-card .sub{font-size:.74rem;color:#64748b;}' +
            '.ea-card-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}' +
            '.ea-pill{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:.72rem;font-weight:800;padding:3px 10px;border-radius:20px;}' +
            '.ea-pill.dn{background:#fff1f2;color:#be123c;border-color:#fecdd3;}.ea-pill.fl{background:#f1f5f9;color:#475569;border-color:#e2e8f0;}' +
            '.ea-legend{display:flex;gap:14px;font-size:.72rem;font-weight:700;color:#64748b;margin-bottom:8px;flex-wrap:wrap;}' +
            '.ea-legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle;}' +
            '.ea-plot{margin-left:34px;touch-action:pan-y;}' + '.ea-sw{position:relative;}' +
            '.ea-plot svg{display:block;width:100%;height:auto;overflow:visible;}' +
            '.ea-yl{position:absolute;left:-34px;width:30px;text-align:right;font-size:.62rem;font-weight:700;color:#94a3b8;transform:translateY(-50%);}' +
            '.ea-xl{position:relative;height:18px;margin-top:6px;}' +
            '.ea-xl span{position:absolute;transform:translateX(-50%);font-size:.66rem;font-weight:700;color:#94a3b8;white-space:nowrap;}' +
            '.ea-cross{position:absolute;top:0;bottom:0;width:1px;background:#cbd5e1;display:none;pointer-events:none;}' +
            '.ea-dot{position:absolute;width:11px;height:11px;border-radius:50%;background:#fff;border:2.5px solid #1d4ed8;transform:translate(-50%,-50%);display:none;pointer-events:none;}' +
            '.ea-tip{position:absolute;top:-6px;background:#0f172a;color:#fff;font-size:.7rem;font-weight:700;padding:6px 9px;border-radius:8px;display:none;pointer-events:none;white-space:nowrap;transform:translate(-50%,-100%);z-index:3;line-height:1.5;}' +
            '.ea-bar-row{margin-bottom:14px;}.ea-bar-row:last-child{margin-bottom:0;}' +
            '.ea-bar-l{display:flex;justify-content:space-between;gap:8px;font-size:.78rem;font-weight:700;color:#0f172a;margin-bottom:5px;}' +
            '.ea-bar-l .h{font-weight:500;color:#94a3b8;font-size:.72rem;margin-left:4px;}' +
            '.ea-trk{height:7px;width:100%;background:#f1f5f9;border-radius:10px;overflow:hidden;}' +
            '.ea-trk i{display:block;height:100%;border-radius:10px;background:#1d4ed8;transition:width .5s ease;}' +
            '.ea-trk.ind i{background:#4338ca;}.ea-trk.am i{background:#f59e0b;}' +
            '.ea-att{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:10px;font-size:.76rem;font-weight:700;color:#334155;margin-bottom:8px;border:1px solid #e2e8f0;background:#f8fafc;}' +
            '.ea-att b{font-weight:900;padding:2px 9px;border-radius:6px;background:#e2e8f0;color:#334155;}' +
            '.ea-att.am{background:#fffbeb;border-color:#fde68a;}.ea-att.am b{background:#fef3c7;color:#92400e;}' +
            '.ea-att.ro{background:#fff1f2;border-color:#fecdd3;}.ea-att.ro b{background:#ffe4e6;color:#9f1239;}' +
            '.ea-att.ok b{background:#dcfce7;color:#166534;}' +
            '.ea-split{display:flex;height:10px;border-radius:10px;overflow:hidden;background:#f1f5f9;margin:8px 0 6px;}' +
            '.ea-split i{display:block;height:100%;}' +
            '.ea-note{font-size:.76rem;color:#64748b;line-height:1.5;}' +
            '.ea-banner{padding:12px 14px;border-radius:12px;font-size:.8rem;line-height:1.5;margin-bottom:18px;}' +
            '.ea-banner.err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;}' +
            '.ea-banner.info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;}' +
            '.ea-banner pre{margin:8px 0 0;padding:10px;background:rgba(10,14,39,.06);border-radius:8px;font-size:.7rem;white-space:pre-wrap;overflow-x:auto;color:#0a0e27;}' +
            '.ea-hours{display:flex;align-items:flex-end;gap:3px;height:96px;}' +
            '.ea-hours div{flex:1;border-radius:3px 3px 1px 1px;background:#93c5fd;min-height:2px;}' +
            '.ea-hours div.pk{background:#1d4ed8;}' +
            '.ea-sk{background:linear-gradient(90deg,#eef2f7 25%,#f8fafc 50%,#eef2f7 75%);background-size:200% 100%;animation:eaSk 1.2s infinite;border-radius:8px;}' +
            '@keyframes eaSk{from{background-position:200% 0}to{background-position:-200% 0}}' +
            /* creator (profile) */
            '.ea-creator{max-width:460px;margin:0 auto;background:#fff;border-radius:20px;border:1px solid #edf2f7;padding:20px;box-shadow:0 4px 12px rgba(0,0,0,.03);}' +
            '.ea-creator h2{font-size:1.3rem;font-weight:900;color:#0b1528;margin:0;}' +
            '.ea-c-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;}' +
            '.ea-pills{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}' +
            '.ea-pills button{border:0;background:#f1f5f9;color:#64748b;padding:7px 15px;border-radius:20px;font-size:.74rem;font-weight:700;cursor:pointer;min-height:34px;}' +
            '.ea-pills button.on{background:#0c1e4a;color:#fff;}' +
            '.ea-c-k{font-size:.74rem;color:#64748b;font-weight:600;}' +
            '.ea-c-big{display:flex;align-items:baseline;gap:8px;margin-top:2px;flex-wrap:wrap;}' +
            '.ea-c-big b{font-size:1.7rem;font-weight:900;color:#0b1528;}' +
            '.ea-bars{display:flex;align-items:flex-end;justify-content:space-between;height:128px;border-bottom:1px solid #f1f5f9;padding-bottom:6px;margin:12px 0 6px;gap:5px;}' +
            '.ea-bars>div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;cursor:pointer;}' +
            '.ea-bars i{display:block;width:100%;max-width:28px;background:#5b67b8;border-radius:4px 4px 0 0;min-height:2px;}' +
            '.ea-bars>div.t i,.ea-bars>div.sel i{background:#0c1e4a;}' +
            '.ea-bars span{font-size:.6rem;font-weight:700;color:#94a3b8;margin-top:4px;white-space:nowrap;height:12px;}' +
            '.ea-readout{font-size:.72rem;color:#64748b;min-height:18px;margin-bottom:16px;}' +
            '.ea-2x2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px;}' +
            '.ea-2x2>div{background:#f8fafc;padding:12px;border-radius:12px;border:1px solid #f1f5f9;}' +
            '.ea-2x2 .k{font-size:.7rem;color:#64748b;font-weight:600;}.ea-2x2 .v{font-size:1.15rem;font-weight:900;color:#0b1528;margin:2px 0;}' +
            '.ea-c-sec{margin-bottom:22px;}' +
            '.ea-c-sec h4{font-size:.8rem;font-weight:900;color:#0b1528;margin:0 0 2px;text-transform:uppercase;letter-spacing:.5px;}' +
            '.ea-c-sec .sub{font-size:.7rem;color:#94a3b8;margin:0 0 10px;}' +
            '.ea-top{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8fafc;padding:10px 12px;border-radius:10px;font-size:.75rem;margin-bottom:6px;}' +
            '.ea-top span:first-child{font-weight:700;color:#1e293b;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.ea-top span:last-child{font-weight:800;color:#64748b;flex-shrink:0;}' +
            '.ea-err{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:12px;font-size:.78rem;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;}' +
            '.ea-err button{border:0;background:#9a3412;color:#fff;border-radius:8px;padding:7px 12px;font-weight:800;font-size:.74rem;cursor:pointer;min-height:34px;}' +
            /* ads / server / review (2026-11-07) */
            '.ea-st{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:.78rem;font-weight:700;color:#334155;}.ea-st:last-child{border-bottom:0;}' +
            '.ea-st b{font-weight:900;color:#0b1528;text-align:right;}.ea-st small{display:block;font-weight:500;color:#94a3b8;font-size:.68rem;}' +
            '.ea-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px;}.ea-chip{font-size:.68rem;font-weight:800;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:#475569;}' +
            '.ea-chip.g{background:#dcfce7;color:#166534;}.ea-chip.a{background:#fef3c7;color:#92400e;}.ea-chip.r{background:#ffe4e6;color:#9f1239;}' +
            '.ea-rv{display:flex;gap:12px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;margin-bottom:10px;align-items:flex-start;flex-wrap:wrap;}' +
            '.ea-rv img,.ea-rv video{width:84px;height:84px;object-fit:cover;border-radius:10px;background:#e2e8f0;flex-shrink:0;}' +
            '.ea-rv .m{flex:1;min-width:200px;font-size:.76rem;color:#475569;line-height:1.5;}.ea-rv .m strong{color:#0b1528;font-size:.84rem;}' +
            '.ea-rv .m a,.ea-rv .m .u{color:#1d4ed8;word-break:break-all;}' +
            '.ea-rv .a{display:flex;gap:8px;flex-wrap:wrap;}.ea-btn.ok{background:#047857;}.ea-btn.no{background:#be123c;}';
        document.head.appendChild(s);
    })();

    /* ═══════════════════════════════════════════════════════════════════
       1. DATA LAYER — analytics_daily / users / withdrawal_queue
       ═══════════════════════════════════════════════════════════════════ */
    var _diag = { denied: false, offline: false };
    function _noteErr(e, analytics) {
        var c = e && e.code;
        if (c === 'permission-denied') { _diag.denied = true; if (analytics) _diag.aDenied = true; else _diag.oDenied = true; }
        else if (c !== 'nocount') _diag.offline = true;
    }
    function _normDay(key, d) {
        d = d || {};
        var secs = Object.assign({}, d.sections || {});
        Object.keys(d).forEach(function (k) { if (k.indexOf('sections.') === 0) { var n = k.slice(9); secs[n] = (secs[n] || 0) + (d[k] || 0); } });
        return {
            key: key, pageViews: d.pageViews || 0, sessions: d.sessions || 0, sessionSeconds: d.sessionSeconds || 0,
            activeUsers: d.activeUsers || 0, guestSessions: d.guestSessions || 0,
            sections: secs, hours: d.hours || {}, devices: d.devices || {}, os: d.os || {}, cities: d.cities || {}
        };
    }
    var _dayCache = {};   // closed days never change, so they are fetched once per page load
    function _getDay(key, force) {
        var isOpen = key === _dayKey(0) || key === _dayKey(1);
        if (!force && !isOpen && _dayCache[key]) return Promise.resolve(_dayCache[key]);
        return _tmo(window.fbDb.collection('analytics_daily').doc(key).get(), 15000).then(function (doc) {
            var n = _normDay(key, doc.exists ? doc.data() : {});
            _dayCache[key] = n; return n;
        }).catch(function (e) {
            _noteErr(e, true);
            if (_dayCache[key]) return _dayCache[key];       // keep the last good copy instead of flashing zeros
            var z = _normDay(key, {}); z.failed = true; return z;
        });
    }
    var _cntCapped = false;
    function _cnt(q) {
        var p = (typeof q.count === 'function') ? q.count().get().then(function (s) { return s.data().count; }) : Promise.reject({ code: 'nocount' });
        return _tmo(p.catch(function () { return q.limit(1000).get().then(function (s) { if (s.size >= 1000) _cntCapped = true; return s.size; }); }), 15000)
            .catch(function (e) { _noteErr(e); return null; });
    }
    function _users() { return window.fbDb.collection('users'); }
    function _signups(fromKey, toKeyExcl) {
        var q = _users().where('createdAt', '>=', _dayStartISO(fromKey));
        if (toKeyExcl) q = q.where('createdAt', '<', _dayStartISO(toKeyExcl));
        return _cnt(q);
    }
    function _activeNow() {
        var since = new Date(Date.now() - 90000).toISOString();
        return _tmo(window.fbDb.collection('analytics_sessions').where('lastSeen', '>=', since).limit(500).get(), 12000).then(function (snap) {
            var uids = {}, guests = 0;
            snap.forEach(function (d) { var x = d.data() || {}; if (x.uid) uids[x.uid] = 1; else guests++; });
            return { members: Object.keys(uids).length, guests: guests };
        }).catch(function (e) { _noteErr(e, true); return null; });
    }
    function _topCreators() {
        return _tmo(_users().orderBy('followerCount', 'desc').limit(5).get(), 15000).then(function (snap) {
            var out = []; snap.forEach(function (d) {
                var x = d.data() || {};
                if ((x.followerCount || 0) > 0) out.push({ name: x.fullName || x.username || 'Member', handle: x.username ? '@' + x.username : '', followers: x.followerCount || 0 });
            });
            return out;
        }).catch(function (e) { _noteErr(e); return null; });
    }

    /* ═══════════════════════════════════════════════════════════════════
       2. ADMIN — PLATFORM ANALYTICS
       ═══════════════════════════════════════════════════════════════════ */
    var A = { range: 7, model: null, html: '', loading: false, loadedAt: 0, lastForce: false };

    /* ── server routes (Admin SDK) — ads, server health, and the analytics fallback ─────────── */
    function _fmtUsd(n) { n = Number(n) || 0; return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function _apiCall(method, path, body) {
        if (!window.fbAuth || !window.fbAuth.currentUser) return Promise.reject({ code: 'noauth', message: 'Not signed in' });
        return window.fbAuth.currentUser.getIdToken().then(function (t) {
            var base = (typeof window._empApiBase === 'function' ? window._empApiBase() : '') + '/api';
            var opt = { method: method, headers: { 'Authorization': 'Bearer ' + t } };
            if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
            return _tmo(fetch(base + path, opt), 20000).then(function (r) {
                return r.json().then(function (j) {
                    if (!r.ok) throw { code: 'http-' + r.status, message: (j && j.error) || ('HTTP ' + r.status) };
                    return j;
                }, function () { throw { code: 'http-' + r.status, message: 'HTTP ' + r.status }; });
            });
        });
    }
    function _errTxt(e) { return (e && (e.message || e.code)) || 'unknown error'; }
    function _adsSummary(n) { return _apiCall('GET', '/admin/ads/summary?days=' + n).catch(function (e) { return { err: _errTxt(e) }; }); }
    function _serverStats() { return _apiCall('GET', '/admin/server-stats').catch(function (e) { return { err: _errTxt(e) }; }); }
    function _pendingAds() { return _apiCall('GET', '/admin/ads/campaigns?status=active').catch(function (e) { return { err: _errTxt(e) }; }); }
    // Browser read blocked by Firestore rules? Re-read analytics_daily + live sessions through the server instead.
    function _serverFallback(r, n, list) {
        if (!_diag.aDenied) return Promise.resolve(r);
        return _apiCall('GET', '/admin/analytics/bundle?days=' + n).then(function (b) {
            r[0] = list.map(function (k) { var d = _normDay(k, (b.days || {})[k] || {}); _dayCache[k] = d; return d; });
            r[2] = b.activeNow || null;
            _diag.aDenied = false; _diag.denied = !!_diag.oDenied; _diag.viaServer = true;
            return r;
        }).catch(function () { return r; });
    }
    var ROOT_ID = 'emp-admin-analytics-root';

    function _rangeKeys(n, offsetDays) {      // oldest → newest
        var out = []; for (var i = n - 1; i >= 0; i--) out.push(_dayKey(i + (offsetDays || 0))); return out;
    }
    function _sum(days, f) { return days.reduce(function (s, d) { return s + (d[f] || 0); }, 0); }
    function _sumMap(days, f) {
        var o = {}; days.forEach(function (d) { var m = d[f] || {}; Object.keys(m).forEach(function (k) { o[k] = (o[k] || 0) + (m[k] || 0); }); }); return o;
    }

    function _spline(pts) {
        var line = 'M ' + pts[0].x + ' ' + pts[0].y;
        for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[i], p1 = pts[i + 1], mx = (p0.x + p1.x) / 2;
            line += ' C ' + mx + ' ' + p0.y + ', ' + mx + ' ' + p1.y + ', ' + p1.x + ' ' + p1.y;
        }
        return line;
    }
    var W = 640, H = 220, PT = 14, PB = 6;
    function _chartHtml(series, xLabels) {
        var n = series[0].vals.length, all = [];
        series.forEach(function (s) { all = all.concat(s.vals); });
        var rawMax = Math.max.apply(null, all.concat([0]));
        var max = Math.max(4, Math.ceil(rawMax * 1.12));
        function X(i) { return n === 1 ? W / 2 : Math.round(i * (W / (n - 1))); }
        function Y(v) { return Math.round(H - PB - (v / max) * (H - PT - PB)); }
        var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trend chart"><defs><linearGradient id="eaGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#3b82f6" stop-opacity=".30"/><stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>';
        var yl = '';
        for (var g = 0; g <= 3; g++) {
            var gv = Math.round(max * (1 - g / 3)), gy = Y(gv);
            svg += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" stroke="#eef2f7" stroke-width="1.5"/>';
            yl += '<div class="ea-yl" style="top:' + (gy / H * 100).toFixed(2) + '%">' + _fmtN(gv) + '</div>';
        }
        series.forEach(function (s, si) {
            var pts = s.vals.map(function (v, i) { return { x: X(i), y: Y(v) }; });
            var path = n === 1 ? 'M ' + (pts[0].x - 30) + ' ' + pts[0].y + ' L ' + (pts[0].x + 30) + ' ' + pts[0].y : _spline(pts);
            if (si === 0 && n > 1) svg += '<path d="' + path + ' L ' + pts[n - 1].x + ' ' + (H - PB) + ' L ' + pts[0].x + ' ' + (H - PB) + ' Z" fill="url(#eaGrad)"/>';
            svg += '<path d="' + path + '" fill="none" stroke="' + s.color + '" stroke-width="' + (si === 0 ? 3 : 2.2) + '"' + (s.dashed ? ' stroke-dasharray="6 5"' : '') + ' stroke-linecap="round" stroke-linejoin="round"/>';
            if (si === 0 && n <= 14) pts.forEach(function (p) { svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="4.2" fill="#fff" stroke="' + s.color + '" stroke-width="2.4"/>'; });
        });
        svg += '</svg>';
        var step = n <= 8 ? 1 : Math.ceil(n / 7), xl = '';
        for (var i = 0; i < n; i += step) xl += '<span style="left:' + (X(i) / W * 100).toFixed(2) + '%">' + _esc(xLabels[i]) + '</span>';
        var legend = '<div class="ea-legend">' + series.map(function (s) {
            return '<span><i style="background:' + s.color + (s.dashed ? ';opacity:.6' : '') + '"></i>' + _esc(s.name) + '</span>';
        }).join('') + '</div>';
        return legend + '<div class="ea-plot" id="ea-plot" data-n="' + n + '"><div class="ea-sw">' + svg + yl +
            '<div class="ea-cross" id="ea-cross"></div><div class="ea-dot" id="ea-dot"></div><div class="ea-tip" id="ea-tip"></div></div>' +
            '<div class="ea-xl">' + xl + '</div></div>' +
            (rawMax === 0 ? '<div class="ea-note" style="text-align:center;margin-top:8px;">No traffic recorded in this period yet.</div>' : '');
    }
    function _bars(rows, cls, total) {
        var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
        return rows.map(function (r) {
            var pct = Math.max(r.v ? 3 : 0, Math.round(r.v / (total || max) * 100));
            return '<div class="ea-bar-row"><div class="ea-bar-l"><span>' + _esc(r.label) + (r.hint ? '<span class="h">' + _esc(r.hint) + '</span>' : '') + '</span><span>' + _esc(r.right) + '</span></div>' +
                '<div class="ea-trk ' + (cls || '') + '"><i style="width:' + Math.min(100, pct) + '%"></i></div></div>';
        }).join('');
    }
    function _kpi(title, value, d, sub) {
        return '<div class="ea-kpi"><div class="t">' + _esc(title) + '</div><div class="v">' + value + '</div>' +
            (d ? '<span class="ea-d ' + d.cls + '">' + _esc(d.txt) + '</span>' : '') + (sub ? '<div class="s">' + _esc(sub) + '</div>' : '') + '</div>';
    }
    function _attRow(label, count, kind) {
        var k = count == null ? '' : (count === 0 ? 'ok' : kind);
        return '<div class="ea-att ' + k + '"><span>' + _esc(label) + '</span><b>' + (count == null ? '—' : (count === 0 ? 'Clear' : _fmtN(count))) + '</b></div>';
    }

    function _buildAdmin(M) {
        var n = M.range, isToday = n === 1;
        var cur = M.cur, prev = M.prev, today = M.today, yest = M.yest;
        var pvCur = isToday ? today.pageViews : _sum(cur, 'pageViews');
        var pvPrev = isToday ? yest.pageViews : _sum(prev, 'pageViews');
        var dPv = _delta(pvCur, pvPrev);
        var avgT = today.sessions ? today.sessionSeconds / today.sessions : 0, avgY = yest.sessions ? yest.sessionSeconds / yest.sessions : 0;
        var total = M.users;
        var h = '<div class="ea ea-admin">';

        h += '<div class="ea-head"><div><h1 class="ea-h1">Platform Analytics</h1><p class="ea-subtitle">' +
            (isToday ? 'Today (Lagos time)' : 'Last ' + n + ' days') + ' &bull; Updated ' + _esc(new Date(M.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + ' &bull; auto-refresh 30s' +
            (M.activeNow ? ' <span class="ea-live"><i></i>' + (M.activeNow.members + M.activeNow.guests) + ' online now</span>' : '') + '</p></div>' +
            '<div class="ea-tools"><div class="ea-seg">' +
            [[1, 'Today'], [7, '7d'], [30, '30d']].map(function (r) { return '<button type="button" data-ea-range="' + r[0] + '" class="' + (r[0] === n ? 'on' : '') + '">' + r[1] + '</button>'; }).join('') +
            '</div><button type="button" class="ea-btn ghost" data-ea-refresh="1"><i class="fas fa-sync-alt"></i> Refresh</button>' +
            '<button type="button" class="ea-btn" data-ea-csv="admin"><i class="fas fa-file-csv"></i> Export CSV</button></div></div>';

        // diagnostics
        var failedAll = M.cur.length && M.cur.every(function (d) { return d.failed; });
        var allEmpty = M.cur.every(function (d) { return !d.pageViews && !d.sessions; }) && !today.pageViews;
        if (M.diag.denied) {
            h += '<div class="ea-banner err"><strong>Firestore blocked part of this read (permission-denied).</strong> Missing figures are caused by security rules, not by an absence of traffic. Publish the current firebase-rules.js (it already contains these rules) or add:' +
                '<pre>match /analytics_daily/{day} { allow read: if isAdmin(); allow write: if request.auth != null; }\nmatch /analytics_sessions/{id} { allow read: if isAdmin(); allow write: if request.auth != null; }</pre>' +
                'Also check that your account has <code>isAdmin: true</code> on its users document (or the admin token claim).</div>';
        } else if (failedAll || (M.diag.offline && allEmpty)) {
            h += '<div class="ea-banner err">Could not reach Firestore (offline or a very slow connection). Tap Refresh once you are back online.</div>';
        } else if (M.viaServer) {
            h += '<div class="ea-banner info">Traffic figures were loaded through the secure server route because Firestore rules refused the direct browser read. Publish the latest firebase-rules.js to read directly.</div>';
        } else if (allEmpty) {
            h += '<div class="ea-banner info">No analytics recorded yet. Tracking is active \u2014 data appears about 20 seconds after someone uses the app.</div>';
        }

        h += '<div class="ea-kpis">' +
            _kpi('Total users', total == null ? '—' : _fmtN(total.count) + (total.truncated ? '+' : ''), M.signupsT == null ? null : { txt: '+' + M.signupsT + ' today', cls: M.signupsT > 0 ? 'up' : 'fl' }) +
            _kpi('Daily active', _fmtN(today.activeUsers), _delta(today.activeUsers, yest.activeUsers), 'vs yesterday') +
            _kpi('New signups', M.signupsT == null ? '—' : _fmtN(M.signupsT), _delta(M.signupsT, M.signupsY), 'today vs yesterday') +
            _kpi('Page views', _fmtN(pvCur), dPv, isToday ? 'today vs yesterday' : 'vs previous ' + n + ' days') +
            _kpi('Avg. session', _fmtDur(avgT), _delta(avgT, avgY), 'today vs yesterday') +
            _adKpi(M, isToday, n) + '</div>';

        // chart + top creators
        var series, labels;
        if (isToday) {
            var hv = []; for (var i = 0; i < 24; i++) hv.push((today.hours && today.hours['h' + i]) || 0);
            series = [{ name: 'Page views by hour (WAT)', vals: hv, color: '#2563eb' }];
            labels = hv.map(function (v, i) { return (i < 10 ? '0' : '') + i + 'h'; });
        } else {
            series = [{ name: 'Page views', vals: cur.map(function (d) { return d.pageViews; }), color: '#2563eb' },
                      { name: 'Sessions', vals: cur.map(function (d) { return d.sessions; }), color: '#94a3b8', dashed: true }];
            labels = cur.map(function (d) { return n <= 7 ? _weekday(d.key) : _shortDay(d.key); });
        }
        M.chart = { series: series, labels: labels, keys: isToday ? labels : cur.map(function (d) { return d.key; }) };
        h += '<div class="ea-mid"><div class="ea-card"><div class="ea-card-top"><div><h3>Overview and page views</h3><span class="sub">' +
            (isToday ? 'Hourly activity today' : 'Page views vs sessions') + '</span></div><span class="ea-pill ' + dPv.cls + '">' + _esc(dPv.txt === '—' ? 'No comparison yet' : dPv.txt + (isToday ? ' vs yesterday' : ' vs previous period')) + '</span></div>' +
            _chartHtml(series, labels) + '</div>';

        h += '<div class="ea-card"><h3 style="margin-bottom:16px;">Top creators</h3><div class="sub" style="margin:-10px 0 14px;">Ranked by followers</div>' +
            (M.top == null ? '<div class="ea-note">Could not read creators.</div>' :
                (M.top.length ? _bars(M.top.map(function (c) { return { label: c.name, hint: c.handle, right: _fmtN(c.followers), v: c.followers }; }), '', M.top[0].followers)
                    : '<div class="ea-note">Creators appear here once members have followers.</div>')) + '</div></div>';

        // funnel / audience / attention
        var f = M.funnel || {};
        var base = total ? total.count : 0;
        function frow(label, v) { return { label: label, right: v == null ? '—' : _fmtN(v) + (base && v != null ? ' · ' + Math.min(100, Math.round(v / base * 100)) + '%' : ''), v: v || 0 }; }
        var sess = _sum(cur, 'sessions'), gs = _sum(cur, 'guestSessions');
        var mem = Math.max(0, sess - gs), mp = sess ? Math.round(mem / sess * 100) : 0;
        var dev = _sumMap(isToday ? [today] : cur, 'devices'), devRows = Object.keys(dev).map(function (k) { return { k: k, v: dev[k] }; }).sort(function (a, b) { return b.v - a.v; });
        var devTot = devRows.reduce(function (s, r) { return s + r.v; }, 0);
        var devNames = { mobile: 'Mobile', desktop: 'Desktop', tablet: 'Tablet' };

        h += '<div class="ea-cols">' +
            '<div class="ea-card"><h3 style="margin-bottom:16px;">Creator monetization funnel</h3>' +
            _bars([frow('Registered members', base || null), frow('KYC verified', f.verified), frow('Bronze-eligible (1K+ followers)', f.bronze)], 'ind', base || 1) + '</div>' +

            '<div class="ea-card"><h3 style="margin-bottom:6px;">Audience &amp; devices</h3><span class="sub">Sessions in this period</span>' +
            '<div class="ea-split"><i style="width:' + mp + '%;background:#1d4ed8"></i><i style="width:' + (sess ? 100 - mp : 0) + '%;background:#f59e0b"></i></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:.74rem;font-weight:700;color:#64748b;margin-bottom:16px;"><span>Members ' + _fmtN(mem) + '</span><span>Guests ' + _fmtN(gs) + '</span></div>' +
            (devTot ? _bars(devRows.map(function (r) { return { label: devNames[r.k] || r.k, right: Math.round(r.v / devTot * 100) + '%', v: r.v }; }), '', devTot) : '<div class="ea-note">Device split appears once sessions are recorded.</div>') +
            '</div>' +

            '<div class="ea-card"><h3 style="margin-bottom:14px;">Needs attention</h3>' +
            _attRow('KYC verification queue', M.att.kyc, 'am') + _attRow('Pending withdrawals', M.att.pending, 'am') + _attRow('Flagged withdrawals', M.att.flagged, 'ro') + '</div></div>';

        // sections + peak hours
        var secs = _sumMap(isToday ? [today] : cur, 'sections'), secRows = Object.keys(secs).map(function (k) { return { label: k.replace(/[-_]/g, ' '), v: secs[k], right: _fmtN(secs[k]) }; })
            .sort(function (a, b) { return b.v - a.v; }).slice(0, 6);
        var hrs = []; for (var hh = 0; hh < 24; hh++) hrs.push(_sumDays(isToday ? [today] : cur, hh));
        var hMax = Math.max.apply(null, hrs.concat([0])), pk = hrs.indexOf(hMax);
        h += '<div class="ea-cols">' +
            '<div class="ea-card"><h3 style="margin-bottom:16px;">Top sections</h3>' + (secRows.length ? _bars(secRows, 'ind') : '<div class="ea-note">No section visits recorded in this period.</div>') + '</div>' +
            '<div class="ea-card"><h3 style="margin-bottom:6px;">Peak hours</h3><span class="sub">When members are online (WAT)</span><div style="height:12px"></div>' +
            (hMax ? '<div class="ea-hours">' + hrs.map(function (v, i) { return '<div class="' + (i === pk ? 'pk' : '') + '" style="height:' + Math.max(3, Math.round(v / hMax * 100)) + '%" title="' + i + ':00 \u2014 ' + v + ' views"></div>'; }).join('') + '</div>' +
                '<div class="ea-note" style="margin-top:8px;">Busiest hour: <strong>' + (pk < 10 ? '0' : '') + pk + ':00</strong></div>' : '<div class="ea-note">Hourly activity appears once members use the app.</div>') + '</div></div>';

        h += '<div class="ea-cols">' + _adsCard(M, isToday, n) + _serverCard(M) + _citiesCard(isToday ? [today] : cur) + '</div>';
        h += _reviewCard(M);
        return h + '</div>';
    }
    function _adKpi(M, isToday, n) {
        var a = M.ads;
        if (!a || a.err) return _kpi('Ad revenue', '\u2014', null, a && a.err ? 'Ad data unavailable' : 'Loading\u2026');
        var usd = a.totals.spend * a.empyUsd, prev = a.totals.prevSpend * a.empyUsd;
        return _kpi('Ad revenue', _fmtUsd(usd), _delta(usd, prev), _fmtN(a.totals.spend) + ' EMPY delivered \u2022 ' + (isToday ? 'today vs yesterday' : 'vs previous ' + n + ' days'));
    }
    function _stRow(label, value, hint) { return '<div class="ea-st"><span>' + _esc(label) + (hint ? '<small>' + _esc(hint) + '</small>' : '') + '</span><b>' + value + '</b></div>'; }
    function _adsCard(M, isToday, n) {
        var a = M.ads, h = '<div class="ea-card"><h3 style="margin-bottom:4px;">Ads &amp; revenue</h3><span class="sub">' + (isToday ? 'Today' : 'Last ' + n + ' days') + ' \u2022 delivered campaign spend</span><div style="height:10px"></div>';
        if (!a || a.err) return h + '<div class="ea-note">Could not load ad figures' + (a && a.err ? ' (' + _esc(a.err) + ')' : '') + '. If you just updated, redeploy server.js and tap Refresh.</div></div>';
        var t = a.totals, ctr = t.impressions ? t.clicks / t.impressions * 100 : 0, cpm = t.impressions ? t.spend / (t.impressions / 1000) : 0, cpc = t.clicks ? t.spend / t.clicks : 0;
        var dI = _delta(t.impressions, t.prevImpressions), dC = _delta(t.clicks, t.prevClicks), st = a.status || {};
        h += _stRow('Ad revenue', _fmtUsd(t.spend * a.empyUsd), _fmtN(t.spend) + ' EMPY') +
            _stRow('Impressions', _fmtN(t.impressions), dI.txt) + _stRow('Clicks', _fmtN(t.clicks), dC.txt) +
            _stRow('Click-through rate', (Math.round(ctr * 100) / 100) + '%') +
            _stRow('Effective CPM / CPC', (t.impressions ? (Math.round(cpm * 100) / 100) : '\u2014') + ' / ' + (t.clicks ? (Math.round(cpc * 100) / 100) : '\u2014') + ' EMPY');
        h += '<div class="ea-chips"><span class="ea-chip g">Active ' + (st.active || 0) + '</span><span class="ea-chip a">Pending ' + (st.pending_review || 0) + '</span><span class="ea-chip">Paused ' + (st.paused || 0) + '</span><span class="ea-chip">Completed ' + (st.completed || 0) + '</span><span class="ea-chip r">Rejected ' + (st.rejected || 0) + '</span></div>';
        var p = a.purchases || {};
        h += '<div class="ea-note" style="margin-top:8px;">Paid up-front, not counted above: post boosts \u20A6' + _fmtN(p.boostNgn || 0) + ' (' + (p.boostCount || 0) + ') \u2022 business-page campaigns ' + _fmtN(p.bizEmpy || 0) + ' EMPY (' + (p.bizCount || 0) + ').</div>';
        if (a.top && a.top.length && a.top[0].spent > 0) h += '<div style="height:12px"></div>' + _bars(a.top.filter(function (c) { return c.spent > 0; }).map(function (c) { return { label: c.name || c.id, hint: c.advertiser, right: _fmtN(c.spent) + ' EMPY', v: c.spent }; }), 'am', a.top[0].spent);
        return h + '</div>';
    }
    function _serverCard(M) {
        var s2 = M.server, h = '<div class="ea-card"><h3 style="margin-bottom:4px;">Server health</h3><span class="sub">Live process figures from the API server</span><div style="height:10px"></div>';
        if (!s2 || s2.err) return h + '<div class="ea-note">Could not read server stats' + (s2 && s2.err ? ' (' + _esc(s2.err) + ')' : '') + '. If you just updated, redeploy server.js.</div></div>';
        var up = s2.uptimeSec, upTxt = up >= 86400 ? Math.floor(up / 86400) + 'd ' + Math.floor(up % 86400 / 3600) + 'h' : up >= 3600 ? Math.floor(up / 3600) + 'h ' + Math.floor(up % 3600 / 60) + 'm' : Math.floor(up / 60) + 'm';
        h += _stRow('CPU load', s2.cpuLoadPct + '%', '1-min load ' + s2.loadAvg[0] + ' on ' + s2.cpus + ' core' + (s2.cpus === 1 ? '' : 's')) +
            _stRow('Memory (process)', s2.rssMb + ' MB', 'heap ' + s2.heapUsedMb + ' / ' + s2.heapTotalMb + ' MB') +
            _stRow('Event-loop delay', s2.eventLoop ? s2.eventLoop.p99Ms + ' ms' : '\u2014', s2.eventLoop ? 'p99 \u2022 mean ' + s2.eventLoop.meanMs + ' ms' : '') +
            _stRow('Requests / min', String(s2.last5min.rpm), 'last 5 minutes') + _stRow('Avg response', s2.last5min.avgMs + ' ms') +
            _stRow('Server errors (5xx)', String(s2.last5min.errors5xx), 'last 5 minutes') + _stRow('Uptime', upTxt, 'Node ' + _esc(s2.node));
        var mx = Math.max.apply(null, s2.series.map(function (x) { return x.n; }).concat([1]));
        h += '<div class="ea-hours" style="margin-top:12px;">' + s2.series.map(function (x) { return '<div style="height:' + Math.max(3, Math.round(x.n / mx * 100)) + '%" title="' + x.n + ' requests"></div>'; }).join('') + '</div><div class="ea-note" style="margin-top:6px;">Requests per minute, last 30 minutes</div>';
        return h + '</div>';
    }
    function _citiesCard(days) {
        var m = _sumMap(days, 'cities'), rows = Object.keys(m).map(function (k) { return { k: k, v: m[k] }; }).sort(function (a, b) { return b.v - a.v; });
        var tot = rows.reduce(function (x, r) { return x + r.v; }, 0), h = '<div class="ea-card"><h3 style="margin-bottom:4px;">Audience cities</h3><span class="sub">Member sessions by profile location</span><div style="height:12px"></div>';
        if (!tot) return h + '<div class="ea-note">City data appears as members open the app with a location on their profile. Guests are not placed.</div></div>';
        h += _bars(rows.slice(0, 8).map(function (r) { return { label: r.k.replace(/_/g, ' '), right: Math.round(r.v / tot * 100) + '% \u00B7 ' + _fmtN(r.v), v: r.v }; }), 'ind', tot);
        return h + '<div class="ea-note" style="margin-top:8px;">Based on the location members typed on their own profile \u2014 not tracked by IP.</div></div>';
    }
    function _reviewCard(M) {
        var pd = M.pending, h = '<div class="ea-card" style="margin-bottom:22px;"><div class="ea-card-top"><div><h3>Running ad campaigns</h3><span class="sub">Campaigns go live automatically after a policy check. Stop any that break the rules \u2014 the advertiser is refunded the unspent budget.</span></div>' +
            '<span class="ea-pill ' + (pd && pd.campaigns && pd.campaigns.length ? '' : 'fl') + '">' + (pd && pd.campaigns ? pd.campaigns.length + ' running' : '\u2014') + '</span></div>';
        if (!pd || pd.err) return h + '<div class="ea-note">Could not load running campaigns' + (pd && pd.err ? ' (' + _esc(pd.err) + ')' : '') + '.</div></div>';
        if (!pd.campaigns.length) return h + '<div class="ea-note">No campaigns are running right now.</div></div>';
        return h + pd.campaigns.map(function (c) {
            var tg = c.targeting || {}, media = c.mediaType === 'video' ? '<video src="' + _esc(c.mediaUrl) + '" muted playsinline preload="metadata"></video>' : '<img src="' + _esc(c.mediaUrl) + '" alt="" loading="lazy">';
            return '<div class="ea-rv">' + media + '<div class="m"><strong>' + _esc(c.name) + '</strong> \u2022 ' + _esc(c.advertiserName) + '<br>' + _esc(c.objective) + ' \u2022 ' + _fmtN(c.dailyBudget) + ' EMPY/day \u00D7 ' + c.durationDays + ' days = <strong>' + _fmtN(c.totalBudget) + ' EMPY</strong><br>' +
                (c.caption ? '\u201C' + _esc(c.caption) + '\u201D<br>' : '') + (c.linkUrl ? '<span class="u">' + _esc(c.ctaLabel) + ' \u2192 ' + _esc(c.linkUrl) + '</span><br>' : '') +
                'Audience: ' + ((tg.locations || []).length ? _esc(tg.locations.join(', ')) : 'everyone') + ((tg.keywords || []).length ? ' \u2022 interests: ' + _esc(tg.keywords.join(', ')) : '') + ' \u2022 by ' + _esc(c.ownerName || c.ownerId) + ' \u2022 paid by ' + (c.fundedVia === 'card' ? 'card' : 'EMPY wallet') + ' \u2022 spent ' + _fmtN(c.spent || 0) + '</div>' +
                '<div class="a"><button type="button" class="ea-btn no" data-ea-ad="stop" data-id="' + _esc(c.id) + '">Stop campaign</button></div></div>';
        }).join('') + '</div>';
    }
    function _sumDays(days, hour) { return days.reduce(function (s, d) { return s + ((d.hours && d.hours['h' + hour]) || 0); }, 0); }

    function _adminSkeleton() {
        var sk = function (h) { return '<div class="ea-sk" style="height:' + h + 'px"></div>'; };
        return '<div class="ea ea-admin"><div class="ea-head"><div><h1 class="ea-h1">Platform Analytics</h1><p class="ea-subtitle">Loading live figures\u2026</p></div></div>' +
            '<div class="ea-kpis">' + [1, 2, 3, 4, 5].map(function () { return '<div class="ea-kpi">' + sk(64) + '</div>'; }).join('') + '</div>' +
            '<div class="ea-mid"><div class="ea-card">' + sk(250) + '</div><div class="ea-card">' + sk(250) + '</div></div></div>';
    }

    function _adminTab() { return document.getElementById('admin-analytics-tab'); }
    function _adminRoot(create) {
        var tab = _adminTab(); if (!tab) return null;
        var root = document.getElementById(ROOT_ID);
        if (!root && create) {
            // Wipe any legacy markup (old stat cards, #an-* charts, Interactive Insights) before mounting.
            tab.innerHTML = '<div id="' + ROOT_ID + '"></div>';
            root = document.getElementById(ROOT_ID);
        }
        return root;
    }
    function _paintAdmin(html) {
        var root = _adminRoot(true); if (!root) return;
        root.innerHTML = html;
        _bindPlot();
    }
    function _adminVisible() { var t = _adminTab(); return !!(t && t.offsetParent !== null); }

    function loadAdmin(force, silent) {
        if (A.loading) { A.again = true; return; }
        var root = _adminRoot(true); if (!root) return;
        if (!root.querySelector('.ea-admin')) _paintAdmin(A.html || _adminSkeleton());
        if (!_fbOk()) { _whenFb(function (ok) { if (ok) loadAdmin(force, true); }, 20000); return; }
        A.loading = true; _diag = { denied: false, offline: false };
        var n = A.range, span = n === 1 ? 1 : n;
        var keysCur = _rangeKeys(span, 0), keysPrev = _rangeKeys(span, span);
        var todayKey = _dayKey(0), yKey = _dayKey(1);
        var dayKeys = {}; keysCur.concat(keysPrev, [todayKey, yKey]).forEach(function (k) { dayKeys[k] = 1; });
        var list = Object.keys(dayKeys);

        Promise.all([
            Promise.all(list.map(function (k) { return _getDay(k, force); })),
            _tmo(_cnt(_users()), 20000).then(function (c) { return c == null ? null : { count: c, truncated: _cntCapped && c >= 1000 }; }).catch(function () { return null; }),
            _activeNow(), _signups(todayKey, null), _signups(yKey, todayKey), _topCreators(),
            _cnt(_users().where('isVerified', '==', true)), _cnt(_users().where('followerCount', '>=', 1000)),
            _cnt(_users().where('kycStatus', '==', 'pending')),
            _cnt(window.fbDb.collection('withdrawal_queue').where('status', '==', 'pending')),
            _cnt(window.fbDb.collection('withdrawal_queue').where('flaggedForReview', '==', true).where('status', '==', 'pending')),
            _adsSummary(n), _serverStats(), _pendingAds()
        ]).then(function (r) { return _serverFallback(r, n, list); }).then(function (r) {
            var byKey = {}; r[0].forEach(function (d) { byKey[d.key] = d; });
            var M = {
                range: n, at: Date.now(), diag: _diag,
                cur: keysCur.map(function (k) { return byKey[k]; }), prev: keysPrev.map(function (k) { return byKey[k]; }),
                today: byKey[todayKey], yest: byKey[yKey],
                users: r[1], activeNow: r[2], signupsT: r[3], signupsY: r[4], top: r[5],
                funnel: { verified: r[6], bronze: r[7] }, att: { kyc: r[8], pending: r[9], flagged: r[10] },
                ads: r[11], server: r[12], pending: r[13], viaServer: !!_diag.viaServer
            };
            A.model = M; A.loadedAt = Date.now();
            A.html = _buildAdmin(M);
            if (A.range === n) _paintAdmin(A.html);
        }).catch(function (err) {
            console.warn('[Analytics] admin load failed:', err && (err.message || err.code));
            if (!A.html) _paintAdmin('<div class="ea ea-admin"><div class="ea-banner err">Could not load analytics: ' + _esc((err && (err.message || err.code)) || 'unknown error') + '. <button type="button" class="ea-btn" data-ea-refresh="1">Retry</button></div></div>');
        }).then(function () { A.loading = false; if (A.again) { A.again = false; loadAdmin(false, true); } });
    }

    // Hover / touch tooltip on the overview chart (no re-render: it only moves three elements).
    function _bindPlot() { /* handlers are delegated below; nothing to bind per render */ }
    function _plotMove(e) {
        var plot = document.getElementById('ea-plot'); if (!plot || !A.model || !A.model.chart) return;
        var svg = plot.querySelector('svg'); var rect = svg.getBoundingClientRect(); if (!rect.width) return;
        var pt = (e.touches && e.touches[0]) || e;
        var n = parseInt(plot.getAttribute('data-n'), 10) || 1;
        var rel = Math.min(1, Math.max(0, (pt.clientX - rect.left) / rect.width));
        var i = n === 1 ? 0 : Math.round(rel * (n - 1));
        var ch = A.model.chart, s0 = ch.series[0], max = Math.max(4, Math.ceil(Math.max.apply(null, [].concat.apply([], ch.series.map(function (s) { return s.vals; })).concat([0])) * 1.12));
        var xPct = n === 1 ? 50 : i / (n - 1) * 100, yPct = ((H - PB - (s0.vals[i] / max) * (H - PT - PB)) / H) * 100;
        var cross = document.getElementById('ea-cross'), dot = document.getElementById('ea-dot'), tip = document.getElementById('ea-tip');
        cross.style.display = dot.style.display = tip.style.display = 'block';
        cross.style.left = dot.style.left = tip.style.left = xPct + '%';
        dot.style.top = yPct + '%';
        tip.style.left = Math.min(88, Math.max(12, xPct)) + '%';
        tip.innerHTML = _esc(String(ch.keys[i])) + '<br>' + ch.series.map(function (s) { return _esc(s.name) + ': ' + (s.vals[i] || 0).toLocaleString(); }).join('<br>');
    }
    function _plotLeave() {
        ['ea-cross', 'ea-dot', 'ea-tip'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    }
    document.addEventListener('mousemove', function (e) { if (e.target && e.target.closest && e.target.closest('#ea-plot')) _plotMove(e); else if (document.getElementById('ea-tip') && document.getElementById('ea-tip').style.display === 'block') _plotLeave(); });
    document.addEventListener('touchstart', function (e) { if (e.target && e.target.closest && e.target.closest('#ea-plot')) _plotMove(e); }, { passive: true });
    document.addEventListener('touchmove', function (e) { if (e.target && e.target.closest && e.target.closest('#ea-plot')) _plotMove(e); }, { passive: true });

    function _adminCsv() {
        var M = A.model; if (!M) return;
        var rows = ['date,page_views,sessions,daily_active,guest_sessions,session_seconds,ad_spend_empy,ad_impressions,ad_clicks'];
        var adBy = {}; if (M.ads && M.ads.cur) { M.ads.cur.forEach(function (x) { adBy[x.key] = x; }); }
        (M.range === 1 ? [M.today] : M.cur).forEach(function (d) { var ad = adBy[d.key] || {}; rows.push([d.key, d.pageViews, d.sessions, d.activeUsers, d.guestSessions, d.sessionSeconds, ad.spend == null ? '' : ad.spend, ad.impressions == null ? '' : ad.impressions, ad.clicks == null ? '' : ad.clicks].map(_csvCell).join(',')); });
        _download('empyrean-platform-analytics-' + _dayKey(0) + '.csv', rows.join('\n'));
    }

    // Public entry points (old names kept so nothing that called them breaks).
    window.loadAnalyticsDashboard = function () { loadAdmin(true, false); };
    window._empLoadAnalyticsDashboard = window.loadAnalyticsDashboard;
    window.exportAdminAnalyticsCSV = _adminCsv;

    // Self-heal + auto-refresh for the admin tab
    var _adminWatched = false;
    function watchAdminTab() {
        var tab = _adminTab(); if (!tab || tab._empWatch) return;
        tab._empWatch = true;
        var was = tab.offsetParent !== null;
        new MutationObserver(function () {
            var now = tab.offsetParent !== null;
            if (now && !was) loadAdmin(false, false);
            was = now;
        }).observe(tab, { attributes: true, attributeFilter: ['style', 'class'] });
        _adminWatched = true;
    }
    setInterval(function () { if (document.visibilityState === 'visible' && _adminVisible()) loadAdmin(true, true); }, 30000);

    /* ═══════════════════════════════════════════════════════════════════
       3. CREATOR ANALYTICS (Profile → Analytics)
       ═══════════════════════════════════════════════════════════════════ */
    var C = { range: 7, html: '', uid: null, busy: false, at: 0 };
    var _pCache = { uid: null, list: null, at: 0 };

    function _ts(d) {
        var c = d.createdAt || d.timestamp || d.time; if (!c) return 0;
        if (typeof c.toMillis === 'function') return c.toMillis();
        if (c.seconds) return c.seconds * 1000;
        var t = new Date(c).getTime(); return isNaN(t) ? 0 : t;
    }
    function _cnum(v) { return Array.isArray(v) ? v.length : (typeof v === 'number' ? v : 0); }
    function _post(d, id) {
        var likes = _cnum(d.likes), com = _cnum(d.commentCount != null ? d.commentCount : d.comments), sh = _cnum(d.shareCount != null ? d.shareCount : d.shares);
        return {
            id: id, ts: _ts(d), views: _cnum(d.views != null ? d.views : d.viewCount), likes: likes, comments: com, shares: sh, inter: likes + com + sh,
            title: String(d.text || d.caption || d.title || (d.isReel ? 'Reel' : 'Post')).replace(/\s+/g, ' ').slice(0, 48),
            kind: d.isReel ? 'Reel' : (d.isQuoteCard ? 'Card' : 'Post')
        };
    }
    function _listFrom(snap) { var l = []; snap.forEach(function (doc) { l.push(_post(doc.data() || {}, doc.id)); }); return l; }

    // cb(list, meta). May fire twice: first from the local cache (meta.cached), then from the server.
    function _loadPosts(uid, force, cb) {
        if (!force && _pCache.uid === uid && _pCache.list && Date.now() - _pCache.at < 60000) { cb(_pCache.list, {}); return; }
        _whenFb(function (ok) {
            if (!ok) { cb(_pCache.uid === uid ? _pCache.list : null, { err: 'offline' }); return; }
            var q = window.fbDb.collection('posts').where('userId', '==', uid).limit(300);
            var shown = _pCache.uid === uid && _pCache.list ? true : false, finished = false;
            if (shown) cb(_pCache.list, { cached: true });
            else q.get({ source: 'cache' }).then(function (snap) {
                if (finished || snap.empty) return;
                shown = true; cb(_listFrom(snap), { cached: true });
            }).catch(function () { });
            function server(attempt) {
                _tmo(q.get(), 25000).then(function (snap) {
                    finished = true; var list = _listFrom(snap);
                    _pCache = { uid: uid, list: list, at: Date.now() }; cb(list, {});
                }).catch(function (e) {
                    if (attempt < 2) { server(attempt + 1); return; }
                    finished = true;
                    cb(shown ? (_pCache.list || null) : null, { err: (e && e.code) || 'error', stale: shown });
                });
            }
            server(1);
        }, 15000);
    }

    function _sumPosts(list, from, to) {
        var o = { posts: 0, views: 0, inter: 0, likes: 0, comments: 0, shares: 0, reel: 0, post: 0, card: 0 };
        list.forEach(function (p) {
            if (p.ts >= from && p.ts < to) {
                o.posts++; o.views += p.views; o.inter += p.inter; o.likes += p.likes; o.comments += p.comments; o.shares += p.shares;
                if (p.kind === 'Reel') o.reel += p.views; else if (p.kind === 'Card') o.card += p.views; else o.post += p.views;
            }
        });
        return o;
    }
    function _buildCreator(list, meta) {
        var us = _us(), DAY = 86400000, now = Date.now(), n = C.range;
        var from = now - n * DAY, cur = _sumPosts(list, from, now + 1), prev = _sumPosts(list, from - n * DAY, from);
        var days = [], maxV = 1;
        for (var i = n - 1; i >= 0; i--) {
            var d0 = new Date(now - i * DAY); d0.setHours(0, 0, 0, 0);
            var a = d0.getTime(), v = _sumPosts(list, a, a + DAY).views;
            days.push({ v: v, a: a, t: i === 0, l: n <= 7 ? d0.toLocaleDateString(undefined, { weekday: 'short' }) : (i % Math.ceil(n / 7) === 0 ? (d0.getMonth() + 1) + '/' + d0.getDate() : ''), full: d0.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) });
            if (v > maxV) maxV = v;
        }
        var dV = _delta(cur.views, prev.views), dI = _delta(cur.inter, prev.inter), dP = _delta(cur.posts, prev.posts);
        var er = cur.views ? cur.inter / cur.views * 100 : 0, erPrev = prev.views ? prev.inter / prev.views * 100 : 0;
        var dE = _delta(er, erPrev);
        var top = list.filter(function (p) { return p.ts >= from && p.views > 0; }).sort(function (a, b) { return b.views - a.views; }).slice(0, 5);
        var mixTot = cur.likes + cur.comments + cur.shares, typeTot = cur.reel + cur.post + cur.card;

        var h = '<div class="ea ea-creator" data-ea-uid="' + _esc(us.id || '') + '">';
        h += '<div class="ea-c-head"><h2>Analytics</h2><button type="button" class="ea-btn ghost" data-ea-csv="creator"><i class="fas fa-download"></i> Export CSV</button></div>';
        if (meta && meta.err) {
            h += '<div class="ea-err"><span>' + (meta.stale ? 'Showing saved data \u2014 could not refresh (' : 'Could not load your post data (') + _esc(meta.err) + ').</span><button type="button" data-ea-retry="1">Retry</button></div>';
        }
        h += '<div class="ea-pills">' + [7, 14, 28].map(function (r) { return '<button type="button" data-ea-crange="' + r + '" class="' + (r === n ? 'on' : '') + '">' + r + ' days</button>'; }).join('') + '</div>';
        h += '<div style="margin-bottom:6px;"><span class="ea-c-k">Views</span><div class="ea-c-big"><b>' + _fmtN(cur.views) + '</b><span class="ea-d ' + dV.cls + '">' + _esc(dV.txt) + ' vs previous</span></div></div>';
        h += '<div class="ea-bars">' + days.map(function (d, idx) {
            return '<div class="' + (d.t ? 't' : '') + '" data-ea-bar="' + idx + '" data-label="' + _esc(d.full) + '" data-v="' + d.v + '"><i style="height:' + Math.max(2, Math.round(d.v / maxV * 100)) + '%"></i><span>' + _esc(d.l) + '</span></div>';
        }).join('') + '</div><div class="ea-readout" id="ea-readout">Tap a bar to see that day. Views are counted on the day each post was published.</div>';
        h += '<div class="ea-2x2">' +
            '<div><div class="k">Interactions</div><div class="v">' + _fmtN(cur.inter) + '</div><span class="ea-d ' + dI.cls + '">' + _esc(dI.txt) + '</span></div>' +
            '<div><div class="k">Posts published</div><div class="v">' + cur.posts + '</div><span class="ea-d ' + dP.cls + '">' + _esc(dP.txt) + '</span></div>' +
            '<div><div class="k">Engagement rate</div><div class="v">' + (Math.round(er * 10) / 10) + '%</div><span class="ea-d ' + dE.cls + '">' + _esc(dE.txt) + '</span></div>' +
            '<div><div class="k">Followers</div><div class="v">' + _fmtN(us.followerCount || 0) + '</div><span class="ea-d fl">Total today</span></div></div>';

        h += '<div class="ea-c-sec"><h4>Interactions</h4><p class="sub">Likes, comments and shares this period</p>' +
            (mixTot ? _bars([{ label: 'Likes', right: _fmtN(cur.likes), v: cur.likes }, { label: 'Comments', right: _fmtN(cur.comments), v: cur.comments }, { label: 'Shares', right: _fmtN(cur.shares), v: cur.shares }], '', mixTot)
                : '<div class="ea-note">No interactions in this period yet.</div>') + '</div>';
        h += '<div class="ea-c-sec"><h4>Content types</h4><p class="sub">Where your views come from</p>' +
            (typeTot ? _bars([{ label: 'Reels', right: _fmtN(cur.reel), v: cur.reel }, { label: 'Posts', right: _fmtN(cur.post), v: cur.post }, { label: 'Cards', right: _fmtN(cur.card), v: cur.card }], 'ind', typeTot)
                : '<div class="ea-note">Publish a post or reel and its views will appear here.</div>') + '</div>';
        h += '<div class="ea-c-sec"><h4>Audience</h4><p class="sub">Who is viewing your posts this period</p>' + _audienceHtml(us.id, n) + '</div>';
        h += '<div class="ea-c-sec" style="margin-bottom:0;"><h4>Top content</h4><p class="sub">Best performing this period</p>' +
            (top.length ? top.map(function (p) { return '<div class="ea-top"><span>' + _esc(p.kind) + ': ' + _esc(p.title) + '</span><span>' + _fmtN(p.views) + ' views</span></div>'; }).join('')
                : '<div class="ea-note">Nothing yet \u2014 publish a post and its views will rank here.</div>') + '</div>';
        return h + '</div>';
    }
    // Audience = post_views docs (one per viewer per post per day; see app-analytics.js §1b + the post_views rule).
    function _audienceHtml(uid, n) {
        var a = C.aud;
        if (!a || a.uid !== uid || a.n !== n || a.loading) return '<div class="ea-note">Loading audience\u2026</div>';
        if (a.err) return '<div class="ea-note">Audience data could not be loaded (' + _esc(a.err) + '). Nothing is estimated.</div>';
        var d = a.data;
        if (!d.total) return '<div class="ea-note">No viewer data in this period yet. Each time another member scrolls past one of your posts it is counted here \u2014 nothing is estimated.</div>';
        var mem = d.followers + d.non, fp = mem ? Math.round(d.followers / mem * 100) : 0;
        var h = '<div class="ea-note" style="margin-bottom:6px;"><strong>Followers vs non-followers</strong> (member views)</div>' +
            '<div class="ea-split"><i style="width:' + fp + '%;background:#1d4ed8"></i><i style="width:' + (mem ? 100 - fp : 0) + '%;background:#f59e0b"></i></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:.74rem;font-weight:700;color:#64748b;margin-bottom:6px;"><span>Followers ' + _fmtN(d.followers) + ' (' + fp + '%)</span><span>Non-followers ' + _fmtN(d.non) + ' (' + (mem ? 100 - fp : 0) + '%)</span></div>' +
            (d.guests ? '<div class="ea-note" style="margin-bottom:10px;">Plus ' + _fmtN(d.guests) + ' view' + (d.guests === 1 ? '' : 's') + ' from guests.</div>' : '<div style="height:10px"></div>');
        var rows = Object.keys(d.loc).map(function (k) { return { k: k, v: d.loc[k] }; }).sort(function (x, y) { return y.v - x.v; }), lt = rows.reduce(function (s0, r) { return s0 + r.v; }, 0);
        h += '<div class="ea-note" style="margin-bottom:8px;"><strong>Top locations</strong> (from viewers\u2019 profiles)</div>' +
            (lt ? _bars(rows.slice(0, 5).map(function (r) { return { label: r.k, right: Math.round(r.v / lt * 100) + '%', v: r.v }; }), 'ind', lt) : '<div class="ea-note">Viewers have not set a profile location yet.</div>');
        return h;
    }
    function _repaintCreator() {
        var uid = _us().id;
        if (_pCache.uid === uid && _pCache.list) { C.html = _buildCreator(_pCache.list, null); var b = _creatorBox(); if (b) b.innerHTML = C.html; }
    }
    function _ensureAudience(uid, force) {
        var n = C.range, a = C.aud;
        if (!force && a && a.uid === uid && a.n === n && (a.loading || Date.now() - a.at < 120000)) return;
        C.aud = { uid: uid, n: n, loading: true, at: Date.now() };
        _whenFb(function (ok) {
            if (!ok) { C.aud = { uid: uid, n: n, err: 'offline', at: Date.now() }; _repaintCreator(); return; }
            var keys = [], chunks = [], i; for (i = 0; i < n; i++) keys.push(_dayKey(i));
            for (i = 0; i < keys.length; i += 10) chunks.push(keys.slice(i, i + 10));
            Promise.all(chunks.map(function (ch) { return _tmo(window.fbDb.collection('post_views').where('ownerId', '==', uid).where('dateKey', 'in', ch).limit(2000).get(), 25000); })).then(function (snaps) {
                var agg = { total: 0, followers: 0, non: 0, guests: 0, loc: {} };
                snaps.forEach(function (sn) { sn.forEach(function (doc) {
                    var x = doc.data() || {}; agg.total++;
                    if (x.isGuest) agg.guests++; else if (x.isFollower) agg.followers++; else agg.non++;
                    var l = String(x.loc || '').trim(); if (l) agg.loc[l] = (agg.loc[l] || 0) + 1;
                }); });
                if (C.aud && C.aud.uid === uid && C.aud.n === n) { C.aud = { uid: uid, n: n, data: agg, at: Date.now() }; _repaintCreator(); }
            }).catch(function (e) { C.aud = { uid: uid, n: n, err: (e && e.code) || 'error', at: Date.now() }; _repaintCreator(); });
        }, 15000);
    }
    function _creatorSkeleton() {
        var sk = function (h, w) { return '<div class="ea-sk" style="height:' + h + 'px;' + (w ? 'width:' + w + ';' : '') + '"></div>'; };
        return '<div class="ea ea-creator"><div class="ea-c-head"><h2>Analytics</h2></div>' + sk(30, '60%') + '<div style="height:12px"></div>' + sk(130) +
            '<div class="ea-2x2" style="margin-top:16px;">' + [1, 2, 3, 4].map(function () { return '<div>' + sk(44) + '</div>'; }).join('') + '</div></div>';
    }
    function _creatorBox() { return document.getElementById('profile-analytics'); }

    function renderCreatorAnalytics(force) {
        var box = _creatorBox(); if (!box) return;
        var us = _us(), uid = us && us.id;
        if (!uid) return;
        if (!box.querySelector('.ea-creator')) box.innerHTML = (C.uid === uid && C.html) ? C.html : _creatorSkeleton();
        if (C.busy && !force) return;
        C.busy = true;
        var gotAny = false;
        _loadPosts(uid, !!force, function (list, meta) {
            var b = _creatorBox();
            if (list) {
                gotAny = true;
                C.html = _buildCreator(list, meta); C.uid = uid; C.at = Date.now();
                if (b) b.innerHTML = C.html;
            } else if (b) {
                if (!b.querySelector('.ea-err')) b.innerHTML = _buildCreator([], meta);
            }
            if (!meta || !meta.cached) C.busy = false;
            if (list) _ensureAudience(uid, false);
        });
    }
    window._empRenderCreatorAnalytics = function () { renderCreatorAnalytics(false); };
    window.renderCreatorAnalyticsTab = window._empRenderCreatorAnalytics;

    function _creatorCsv() {
        var uid = _us().id;
        var list = (_pCache.uid === uid && _pCache.list) || [];
        var rows = ['date,type,views,likes,comments,shares,title'].concat(list.slice().sort(function (a, b) { return b.ts - a.ts; }).map(function (p) {
            return [p.ts ? new Date(p.ts).toISOString().slice(0, 10) : '', p.kind, p.views, p.likes, p.comments, p.shares, p.title].map(_csvCell).join(',');
        }));
        _download('empyrean-creator-analytics-' + _dayKey(0) + '.csv', rows.join('\n'));
    }
    window.exportCreatorAnalyticsCSV = _creatorCsv;

    /* ═══════════════════════════════════════════════════════════════════
       4. EVENTS — one delegated listener, plus self-healing observers
       ═══════════════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target : null; if (!t) return;

        // Admin
        if (t.closest('[data-tab="admin-analytics-tab"]') || t.closest('.admin-analytics-link')) {
            setTimeout(function () { watchAdminTab(); loadAdmin(false, false); }, 20);
            return;
        }
        var rv = t.closest('[data-ea-ad]');
        if (rv) {
            var act = rv.getAttribute('data-ea-ad'), cid = rv.getAttribute('data-id'), reason = '';
            if (act === 'stop') { reason = window.prompt('Reason for stopping this campaign (the unspent budget is refunded to the advertiser):', 'Does not meet our advertising guidelines'); if (reason == null) return; reason = String(reason).trim(); if (reason.length < 3) { alert('Please give a short reason.'); return; } }
            rv.disabled = true; rv.textContent = 'Working\u2026';
            _apiCall('POST', '/admin/ads/campaigns/' + encodeURIComponent(cid) + '/review', { decision: act, reason: reason })
                .then(function () { loadAdmin(true, false); })
                .catch(function (e) { rv.disabled = false; rv.textContent = 'Stop campaign'; alert('Could not ' + act + ': ' + _errTxt(e)); });
            return;
        }
        var rg = t.closest('[data-ea-range]');
        if (rg) { A.range = parseInt(rg.getAttribute('data-ea-range'), 10) || 7; A.html = ''; _paintAdmin(_adminSkeleton()); loadAdmin(false, false); return; }
        if (t.closest('[data-ea-refresh]')) { loadAdmin(true, false); return; }
        var csv = t.closest('[data-ea-csv]');
        if (csv) { if (csv.getAttribute('data-ea-csv') === 'admin') _adminCsv(); else _creatorCsv(); return; }

        // Creator
        var cr = t.closest('[data-ea-crange]');
        if (cr) {
            C.range = parseInt(cr.getAttribute('data-ea-crange'), 10) || 7;
            var uid = _us().id;
            if (_pCache.uid === uid && _pCache.list) { C.html = _buildCreator(_pCache.list, null); var b = _creatorBox(); if (b) b.innerHTML = C.html; _ensureAudience(uid, false); } else renderCreatorAnalytics(true);
            return;
        }
        if (t.closest('[data-ea-retry]')) { C.busy = false; renderCreatorAnalytics(true); return; }
        var bar = t.closest('[data-ea-bar]');
        if (bar) {
            var wrap = bar.parentNode; Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('sel'); });
            bar.classList.add('sel');
            var ro = document.getElementById('ea-readout');
            if (ro) ro.textContent = bar.getAttribute('data-label') + ' \u2014 ' + Number(bar.getAttribute('data-v')).toLocaleString() + ' views';
            return;
        }
        if (t.closest('.profile-tab[data-target="profile-analytics"]')) {
            setTimeout(function () { renderCreatorAnalytics(false); }, 0);
            setTimeout(function () { var b2 = _creatorBox(); if (b2 && !b2.querySelector('.ea-creator')) renderCreatorAnalytics(false); }, 300);
        }
    });

    // Any DOM rebuild that empties a mount repaints it on the next frame from the cached HTML.
    (function armSelfHeal() {
        if (typeof MutationObserver === 'undefined') return;
        var queued = false;
        function check() {
            queued = false;
            var cb = _creatorBox();
            if (cb && !cb.querySelector('.ea-creator') && cb.offsetParent !== null && _us().id) renderCreatorAnalytics(false);
            var tab = _adminTab();
            if (tab) {
                watchAdminTab();
                if (!document.getElementById(ROOT_ID)) _adminRoot(true);     // strips any legacy markup that was re-served
                var root = document.getElementById(ROOT_ID);
                if (root && !root.querySelector('.ea-admin') && _adminVisible()) loadAdmin(false, false);
            }
        }
        function start() {
            new MutationObserver(function () { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(check); })
                .observe(document.body, { childList: true, subtree: true });
            check();
        }
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    })();
    document.addEventListener('empyrean-init-done', function () { setTimeout(function () { watchAdminTab(); _adminRoot(true); }, 400); });

    window.AdminAnalytics = { load: function (f) { loadAdmin(!!f, false); }, exportCSV: _adminCsv };
    window.CreatorAnalytics = { render: function (f) { renderCreatorAnalytics(!!f); }, exportCSV: _creatorCsv };

    console.log('[EmpyreanAnalytics] \u2705 Platform Analytics + Creator Analytics loaded (real data, self-healing mounts).');
})();