/**
 * Empyrean Humanitarian Platform — Render Server
 * ─────────────────────────────────────────────
 * All sensitive API keys live ONLY in Render environment variables.
 * The client fetches /api/config on load and receives only what it needs.
 * Firebase Admin SDK operations that need a service account key run here.
 */

'use strict';

const express     = require('express');
const path        = require('path');
const fs          = require('fs'); // used by the server-side config-injection index.html handler below (see EMPYREAN_SERVER_CONFIG_INJECT)
const cors        = require('cors');
const helmet      = require('helmet');
const https       = require('https');
const crypto      = require('crypto'); // used by /api/admin/media-migration to mint firebaseStorageDownloadTokens (see that route)
const compression = require('compression'); // gzip/brotli responses — see app.use() below for why
const QRCode         = require('qrcode');
const emailService    = require('./email-service');
const emailTemplates  = require('./email-templates');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Branding ────────────────────────────────────────────────────────────
// Single source of truth for the app name + logo, reused by the push
// notification payload below AND by the OG-preview fallback further down
// (so a post with no media of its own still shows the app logo instead of
// a blank card in WhatsApp/Facebook). Override via env var without a
// redeploy of code; falls back to a sensible default otherwise.
const APP_NAME = process.env.APP_NAME || 'Empyrean';

// MARKETPLACE ESCROW PAYOUT RULE (explicit — do not "helpfully" convert):
// a seller is paid in the EXACT SAME currency the buyer paid in. If the
// buyer paid fiat (NGN/USD/etc, via Flutterwave), the seller is credited
// that same fiat amount — never converted to EMPY. EMPY is only ever
// credited when the order's own currency IS 'EMPY' (i.e. the buyer paid
// with their EMPY balance for that listing), in which case it's a 1:1
// credit, not a rate conversion. See marketplace_orders' `currency`
// field, set at order-creation time directly from the listing's own
// priced currency — that already tells us what the buyer actually paid
// in; no separate "payment method" field is needed.
//
// Fiat credits are tracked in `users/{sellerId}.fiatBalance.<CURRENCY>` —
// a currency-keyed map, kept entirely separate from `empyBalance` so a
// naira sale can never inflate a seller's EMPY balance. NOTE: as of this
// writing there is no withdrawal UI/route wired to fiatBalance yet (the
// existing withdrawal_requests flow — app-patch-v48.js — is EMPY-only).
// Flagging this so it isn't a silent gap: sellers will accumulate a
// correct fiatBalance from marketplace sales, but cashing that out to a
// bank account needs its own withdrawal path, not built here.

// The logo file itself is a static asset — public/logo.png, alongside the
// existing public/icon-192.png convention. We build its absolute URL from
// the incoming request instead of hardcoding a domain, so it keeps working
// whether you're on the Render *.onrender.com URL or a custom domain
// pointed at it later.
// Two distinct assets, two distinct jobs:
//  - _logoUrl(): small square icon (icon-192.png) used as the <link rel="icon">
//    favicon — this is what WhatsApp/Messenger/Facebook render as the tiny
//    round logo NEXT TO the domain/link text at the bottom of the card
//    (see the reference screenshot: the small "f" badge beside facebook.com).
//  - _fallbackCardUrl(): the big 1200x630 branded card image, used as the
//    og:image ONLY when a post has no media of its own. Previously this
//    fallback was the same small circular logo.png stretched to fill the
//    whole image slot, which is why it looked oversized/plain instead of
//    a proper card — public/og-fallback.jpg is a purpose-built 1200x630
//    graphic (gradient background + centered emblem + wordmark) sized to
//    the exact aspect ratio WhatsApp/Facebook/Twitter expect.
function _logoUrl(req) {
    return req.protocol + '://' + req.get('host') + '/icon-192.png';
}
function _fallbackCardUrl(req) {
    return req.protocol + '://' + req.get('host') + '/og-fallback.jpg';
}
// White-on-transparent version of the logo, purpose-built for stamping onto
// a card image (a colored/navy logo would disappear against a dark photo,
// and clash against a light one) — falls back to icon-192.png so nothing
// breaks if public/logo-white.png hasn't been added yet, it'll just render
// a little less crisply against dark backgrounds until it is.
function _whiteLogoUrl(req) {
    return req.protocol + '://' + req.get('host') + '/logo-white.png';
}

// ── Response compression (gzip/brotli) ─────────────────────────────────────
// FIX (site slow/unreachable on weak mobile connections — Lagos users
// specifically reported): this app was shipping every JS/HTML/CSS file
// completely uncompressed. Express does not compress responses on its own;
// without this, `compression` was never even a dependency. Text compresses
// to roughly 20-30% of its original size with gzip, so this alone should
// cut total page-load bytes by 3-5x for every visitor — the single highest-
// leverage fix for the "site won't load" complaints, and it doesn't touch
// any of the ~100 client-side script files or their load order at all.
// Placed before helmet/cors/static so it applies to every response below it.
app.use(compression());

// ── Security headers (Helmet) ─────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // FIX (Issue #1/#5 — blank host video + dead camera toggle on the
            // Render deploy only, working fine on localhost): the plain static
            // server used for local testing sends no CSP header at all, so the
            // browser loads every script it's given. Render runs THIS file,
            // where scriptSrc never whitelisted https://download.agora.io —
            // exactly the domain index.html loads the Agora SDK from. The
            // browser silently blocks that <script> tag as a CSP violation,
            // which fires its onerror handler and sets
            // window._agoraAvailable = false. initAgoraHost()'s very first
            // line is `if (!window._agoraAvailable) return false;` — it
            // returns before ever reaching the getUserMedia local-camera
            // fallback in its catch block, so on Render there is neither
            // Agora nor a fallback preview: a genuinely blank video and a
            // camera-toggle button with nothing to toggle. Also added
            // 'wasm-unsafe-eval' and worker-src blob: — Agora's audio/video
            // pipeline uses WebAssembly and Web Workers, gated separately
            // from plain script execution in some browsers.
            scriptSrc: [
                "'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'",
                "https://www.gstatic.com", "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com", "https://checkout.flutterwave.com",
                "https://api.cloudinary.com", "https://download.agora.io"
            ],
            styleSrc:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            imgSrc:    ["'self'", "data:", "blob:", "https:", "http:"],
            mediaSrc:  ["'self'", "blob:", "https:", "http:"],
            connectSrc:["'self'", "https:", "wss:", "blob:"],
            fontSrc:   ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            frameSrc:  ["'self'", "https://checkout.flutterwave.com"],
            workerSrc: ["'self'", "blob:"],
        }
    },
    crossOriginEmbedderPolicy: false,
    // FIX (2026-08-25 — root cause of local/pre-deploy "Preview" testing
    // showing "[Config] /api/config attempt N failed ... Failed to fetch"
    // in a loop, cascading into "Firebase not ready", the login screen's
    // "Couldn't reach the server to verify your account", and every other
    // feature that depends on Firebase/config): helmet() defaults
    // `crossOriginResourcePolicy` to `{ policy: 'same-origin' }`, which
    // stamps every response from this server -- including /api/config --
    // with a `Cross-Origin-Resource-Policy: same-origin` header. That
    // header is enforced by the BROWSER independently of CORS: even
    // though app.use(cors()) below correctly sends
    // Access-Control-Allow-Origin: *, a browser fetch() from any origin
    // OTHER than this server's own (e.g. a local on-device "Preview" tool,
    // file://, a staging domain, or any pre-deploy test harness -- exactly
    // the "I should be able to test before deploying live" case) still
    // gets the response silently blocked at the network layer the instant
    // that header is present, which surfaces to fetch() callers as a bare
    // "TypeError: Failed to fetch" -- indistinguishable from a real
    // network outage, which is exactly what index.html's own retry-with-
    // backoff logic (see its "[Config] /api/config attempt N failed"
    // logging) was seeing and correctly retrying against, forever, since
    // the block isn't transient. This app's own architecture already
    // assumes every /api/* route can be called cross-origin -- see
    // index.html's window._empApiBase(), which exists specifically to
    // route local/test builds to the live backend's full URL -- so
    // same-origin CORP was always at odds with how this server is meant
    // to be used, not just a local-testing inconvenience. Every response
    // here is either public config/API data already gated by its own
    // auth checks, or a public static asset -- nothing served by this
    // app depends on CORP for protection, so opening it to 'cross-origin'
    // (matching the cors() policy already in effect two lines down) costs
    // nothing and unblocks exactly the testing workflow this was fought.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors());
app.use(express.json());

// ── request meter for Admin ▸ Platform Analytics ▸ Server health (2026-11-07; see ADS MANAGER BLOCK near the end of this file)
const _adsOs = require('os');
const _adsPerf = require('perf_hooks');
// ── per-minute request meter (memory-bounded: 90 one-minute buckets) ──────────────────────
const _srvMeter = { startedAt: Date.now(), buckets: {}, loop: null };
try { _srvMeter.loop = _adsPerf.monitorEventLoopDelay({ resolution: 20 }); _srvMeter.loop.enable(); } catch (e) { _srvMeter.loop = null; }
app.use(function _srvMeterMw(req, res, next) {
    const t0 = process.hrtime.bigint();
    res.on('finish', function () {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const k = Math.floor(Date.now() / 60000);
        const b = _srvMeter.buckets[k] || (_srvMeter.buckets[k] = { n: 0, ms: 0, e5: 0, max: 0 });
        b.n++; b.ms += ms; if (res.statusCode >= 500) b.e5++; if (ms > b.max) b.max = ms;
        if (b.n === 1) Object.keys(_srvMeter.buckets).forEach(function (kk) { if (Number(kk) < k - 90) delete _srvMeter.buckets[kk]; });
    });
    next();
});


// ── Public client config — single source of truth ─────────────────────────
// Used by BOTH /api/config (the original network-fetch path, kept exactly
// as-is for any client that hasn't picked up the server-injection fix
// below yet, and as a background refresh/fallback for every client) AND
// the app.get(['/','/index.html']) handler further down, which injects
// this same object directly into the HTML response — see that handler's
// own comment for why. Extracted here so both paths can never drift out
// of sync with each other.
function _buildPublicConfig() {
    const required = [
        'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
        'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID',
        'CLOUDINARY_CLOUD', 'CLOUDINARY_PRESET',
        'FLW_PUBLIC_KEY'
    ];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) return { config: null, missing };

    return {
        missing: [],
        config: {
            firebase: {
                apiKey:            process.env.FIREBASE_API_KEY,
                authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
                projectId:         process.env.FIREBASE_PROJECT_ID,
                storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
                messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
                appId:             process.env.FIREBASE_APP_ID,
                measurementId:     process.env.FIREBASE_MEASUREMENT_ID || ''
            },
            cloudinary: {
                cloud:  process.env.CLOUDINARY_CLOUD,
                preset: process.env.CLOUDINARY_PRESET
            },
            flutterwave: {
                publicKey: process.env.FLW_PUBLIC_KEY
            },
            agora: {
                appId: process.env.AGORA_APP_ID || ''
            },
            fcm: {
                vapidKey: process.env.FCM_VAPID_KEY || ''
            },
            recording: {
                cloudAvailable: !!(
                    process.env.AGORA_CUSTOMER_KEY && process.env.AGORA_CUSTOMER_SECRET &&
                    process.env.RECORDING_STORAGE_VENDOR && process.env.RECORDING_BUCKET &&
                    process.env.RECORDING_ACCESS_KEY && process.env.RECORDING_SECRET_KEY
                )
            }
        }
    };
}

// ── /api/config ── Returns only PUBLIC keys the browser needs ─────────────
// SECRET keys (Firebase service account, Flutterwave secret, etc.) stay here.
// Only PUBLISHABLE / PRESET keys that Cloudinary and Flutterwave require
// on the client side are forwarded.
//
// STATUS (2026-08-18): this is no longer the ONLY way the browser gets this
// config — see app.get(['/','/index.html']) further down, which now injects
// the exact same object directly into the HTML for a real visitor, removing
// this fetch from the critical path entirely for most page loads. This
// route is kept fully intact and unchanged in behavior: it's still what the
// client's own background refresh call hits (keeps a cached copy fresh for
// next visit), still the fallback for any client that loaded before this
// feature shipped, and still the only path at all if HTML injection isn't
// possible for some reason (see that handler's own comment).
app.get('/api/config', (req, res) => {
    const { config, missing } = _buildPublicConfig();
    if (!config) {
        console.error('[Config] Missing env vars:', missing.join(', '));
        return res.status(500).json({ error: 'Server misconfiguration', missing });
    }
    res.json(config);
});

// ── /api/link-preview ── Server-side Open Graph unfurler for feed posts ───
// ADDED 2026-10-03 (report: "dropping a Empyrean / Facebook / Instagram /
// X link in a public feed post only highlights it and makes it clickable —
// it doesn't build the thumbnail card WhatsApp and Facebook do").
// A browser can't read another site's <meta property="og:*"> tags itself
// (CORS blocks the cross-origin fetch), so the feed needs a server to do
// the fetch. app-patch-v41.js's _richFormatText() marks the first plain
// link in a post with an empty .emp-linkcard placeholder; its hydrator
// calls this route and draws the card from the JSON below.
//
// SSRF-hardened on purpose — this route fetches a URL a visitor supplies:
//   • http/https only, no credentials in the URL, no non-standard ports
//   • every address the hostname resolves to is checked AT CONNECT TIME
//     (custom `lookup` on the request itself, so a DNS-rebinding answer
//     that changes between a pre-check and the real connect can't slip
//     through), and loopback / private / link-local / CGNAT / metadata
//     ranges are refused, as are IP-literal hosts in those ranges
//   • redirects followed manually (max 4) with the SAME checks each hop
//   • 6s timeout, 600KB body cap, per-IP rate limit, result cache
const _lpDns  = require('dns');
const _lpNet  = require('net');
const _lpHttp = require('http');
const _lpZlib = require('zlib');

const _LP_TTL_OK_MS   = 6 * 60 * 60 * 1000;
const _LP_TTL_FAIL_MS = 10 * 60 * 1000;
const _LP_MAX_BYTES   = 600 * 1024;
const _lpCache = new Map();      // url -> { t, ttl, data }
const _lpHits  = new Map();      // ip  -> { n, resetAt }

function _lpIsPrivateIp(ip) {
    if (!ip) return true;
    if (_lpNet.isIPv6(ip)) {
        const v = ip.toLowerCase();
        if (v === '::1' || v === '::') return true;
        if (v.startsWith('fc') || v.startsWith('fd')) return true;   // unique-local
        if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true; // link-local
        const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);            // IPv4-mapped
        if (m) return _lpIsPrivateIp(m[1]);
        return false;
    }
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(function (x) { return !(x >= 0 && x <= 255); })) return true;
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;        // CGNAT
    if (p[0] === 169 && p[1] === 254) return true;                     // link-local + cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;
    if (p[0] >= 224) return true;                                      // multicast / reserved
    return false;
}

function _lpSafeLookup(hostname, options, cb) {
    _lpDns.lookup(hostname, options, function (err, address, family) {
        if (err) return cb(err);
        const list = Array.isArray(address) ? address : [{ address: address, family: family }];
        for (let i = 0; i < list.length; i++) {
            if (_lpIsPrivateIp(list[i].address)) return cb(new Error('blocked address'));
        }
        cb(null, address, family);
    });
}

function _lpUaFor(host) {
    // Facebook/Instagram/most sites hand their full OG tags to Facebook's
    // own crawler UA; X/Twitter does the same for Twitterbot. Empyrean's
    // own server.js share route also recognises both (CRAWLER_UA_RE).
    if (/(^|\.)(x|twitter)\.com$/i.test(host)) return 'Twitterbot/1.0';
    return 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
}

// UPDATED 2026-10-19 (report: "the Facebook link has stopped generating a thumbnail"): Facebook now often refuses
// pages fetched with only the facebookexternalhit user agent from a server IP and returns a login page or an error, so
// the route returned nothing and the feed drew no card. For Facebook-family hosts the route now (1) retries with other
// crawler user agents, (2) survives the first request failing, and (3) as a last resort returns a branded "Facebook"
// card (no picture) instead of nothing, so the post never ends up with just a bare link.
function _lpIsFb(host) { return /(^|\.)(facebook\.com|fb\.com|fb\.watch|fb\.me)$/i.test(String(host || '')); }
const _LP_FB_RETRY_UAS = [
    'WhatsApp/2.23.20.0 A',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
];

// FIX (2026-10-28 — chat link cards: "WhatsApp group link shows a plain 'WhatsApp link' card with no picture, WhatsApp itself
// shows the group photo"): chat.whatsapp.com invite pages carry the group's photo + name as og:image / og:title, but WhatsApp
// often answers a datacenter fetch made with only the facebookexternalhit user agent with a bare page (no image), and the photo
// URL it does hand back (pps.whatsapp.net) is a short-lived signed CDN link some networks/referrers refuse to load in a browser.
// So for WhatsApp hosts the route (1) retries with other crawler user agents when no image came back, and (2) downloads the
// photo itself (same SSRF checks as the page fetch, 400KB cap, image/* only) and returns it inline as a data: URI so the chat
// card never depends on the CDN link surviving in the viewer's browser.
function _lpIsWa(host) { return /(^|\.)(whatsapp\.com|wa\.me|whatsapp\.net)$/i.test(String(host || '')); }
const _LP_WA_RETRY_UAS = [
    'WhatsApp/2.23.20.0 A',
    'facebookexternalhit/1.1',
    'TelegramBot (like TwitterBot)',
    'Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
];
function _lpGetImageDataUri(urlStr, hops) {
    return new Promise(function (resolve, reject) {
        let u;
        try { u = new URL(urlStr); } catch (e) { return reject(new Error('bad url')); }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('bad protocol'));
        if (u.username || u.password) return reject(new Error('credentials not allowed'));
        if (u.port && u.port !== '80' && u.port !== '443') return reject(new Error('port not allowed'));
        const host = u.hostname.replace(/^\[|\]$/g, '');
        if (_lpNet.isIP(host) && _lpIsPrivateIp(host)) return reject(new Error('blocked address'));
        const lib = u.protocol === 'https:' ? https : _lpHttp;
        const req = lib.request({
            protocol: u.protocol, hostname: host, port: u.port || undefined,
            path: u.pathname + u.search, method: 'GET', lookup: _lpSafeLookup,
            headers: { 'User-Agent': 'WhatsApp/2.23.20.0 A', 'Accept': 'image/*,*/*;q=0.5' }
        }, function (res) {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                if ((hops || 0) >= 3) return reject(new Error('too many redirects'));
                let next;
                try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(new Error('bad redirect')); }
                return resolve(_lpGetImageDataUri(next, (hops || 0) + 1));
            }
            const ctype = String(res.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
            if (status < 200 || status >= 300 || ctype.indexOf('image/') !== 0) { res.resume(); return reject(new Error('not an image')); }
            const chunks = []; let total = 0; let over = false;
            res.on('data', function (c) {
                total += c.length;
                if (total > 150 * 1024) { over = true; try { req.destroy(); } catch (e) {} return; }
                chunks.push(c);
            });
            res.on('end', function () {
                if (over || !total) return reject(new Error('image too large'));
                resolve('data:' + ctype + ';base64,' + Buffer.concat(chunks).toString('base64'));
            });
            res.on('error', function () { reject(new Error('stream error')); });
        });
        req.setTimeout(6000, function () { req.destroy(new Error('timeout')); });
        req.on('error', function (e) { reject(e); });
        req.end();
    });
}

function _lpGet(urlStr, hops, uaOverride) {
    return new Promise(function (resolve, reject) {
        let u;
        try { u = new URL(urlStr); } catch (e) { return reject(new Error('bad url')); }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('bad protocol'));
        if (u.username || u.password) return reject(new Error('credentials not allowed'));
        if (u.port && u.port !== '80' && u.port !== '443') return reject(new Error('port not allowed'));
        const host = u.hostname.replace(/^\[|\]$/g, '');
        if (_lpNet.isIP(host) && _lpIsPrivateIp(host)) return reject(new Error('blocked address'));

        const lib = u.protocol === 'https:' ? https : _lpHttp;
        const req = lib.request({
            protocol: u.protocol, hostname: host, port: u.port || undefined,
            path: u.pathname + u.search, method: 'GET', lookup: _lpSafeLookup,
            headers: {
                'User-Agent': uaOverride || _lpUaFor(host),
                'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
                'Accept-Language': 'en',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        }, function (res) {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                if ((hops || 0) >= 4) return reject(new Error('too many redirects'));
                let next;
                try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(new Error('bad redirect')); }
                return resolve(_lpGet(next, (hops || 0) + 1, uaOverride));
            }
            if (status < 200 || status >= 300) { res.resume(); return reject(new Error('http ' + status)); }
            const ctype = String(res.headers['content-type'] || '').toLowerCase();
            if (ctype && ctype.indexOf('html') === -1 && ctype.indexOf('xml') === -1) { res.resume(); return reject(new Error('not html')); }

            let stream = res;
            const enc = String(res.headers['content-encoding'] || '').toLowerCase();
            if (enc === 'gzip') stream = res.pipe(_lpZlib.createGunzip());
            else if (enc === 'deflate') stream = res.pipe(_lpZlib.createInflate());
            else if (enc === 'br') stream = res.pipe(_lpZlib.createBrotliDecompress());

            const chunks = []; let total = 0; let done = false;
            function finish() {
                if (done) return; done = true;
                resolve({ finalUrl: u.toString(), html: Buffer.concat(chunks).toString('utf8') });
            }
            stream.on('data', function (c) {
                total += c.length; chunks.push(c);
                if (total >= _LP_MAX_BYTES) { try { req.destroy(); } catch (e) {} finish(); }
            });
            stream.on('end', finish);
            stream.on('error', function () { if (total) finish(); else if (!done) { done = true; reject(new Error('stream error')); } });
        });
        req.setTimeout(6000, function () { req.destroy(new Error('timeout')); });
        req.on('error', function (e) { reject(e); });
        req.end();
    });
}

function _lpDecode(s) {
    return String(s || '')
        .replace(/&#x([0-9a-f]+);/gi, function (m, h) { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; } })
        .replace(/&#(\d+);/g, function (m, d) { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ''; } })
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').trim();
}

function _lpParse(html, finalUrl) {
    const head = html.slice(0, Math.max(html.search(/<\/head>/i), 0) || html.length);
    const meta = {};
    const re = /<meta\s+([^>]*?)\/?>/gi;
    let m;
    while ((m = re.exec(head))) {
        const attrs = {};
        const ar = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = ar.exec(m[1]))) attrs[a[1].toLowerCase()] = a[3] != null ? a[3] : a[4];
        const key = (attrs.property || attrs.name || '').toLowerCase();
        if (key && attrs.content != null && meta[key] == null) meta[key] = _lpDecode(attrs.content);
    }
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
    const title = meta['og:title'] || meta['twitter:title'] || (t ? _lpDecode(t[1]) : '');
    const description = meta['og:description'] || meta['twitter:description'] || meta['description'] || '';
    let image = meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
    if (image) { try { image = new URL(image, finalUrl).toString(); } catch (e) { image = ''; } }
    if (image && !/^https?:\/\//i.test(image)) image = '';
    return {
        title: title.slice(0, 200),
        description: description.slice(0, 300),
        image: image,
        siteName: (meta['og:site_name'] || '').slice(0, 80)
    };
}

app.get('/api/link-preview', async (req, res) => {
    try {
        const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
        const now = Date.now();
        const hit = _lpHits.get(ip);
        if (!hit || now > hit.resetAt) _lpHits.set(ip, { n: 1, resetAt: now + 60000 });
        else if (++hit.n > 40) return res.status(429).json({ ok: false, error: 'rate limited' });
        if (_lpHits.size > 5000) { _lpHits.forEach(function (v, k) { if (now > v.resetAt) _lpHits.delete(k); }); }

        const raw = String(req.query.url || '').trim();
        if (!raw || raw.length > 2048) return res.status(400).json({ ok: false, error: 'bad url' });
        let target;
        try { target = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return res.status(400).json({ ok: false, error: 'bad url' }); }
        target.hash = '';
        const key = target.toString();

        const cached = _lpCache.get(key);
        if (cached && now - cached.t < cached.ttl) {
            res.set('Cache-Control', 'public, max-age=3600');
            return res.json(cached.data);
        }

        let data;
        try {
            let page;
            try { page = await _lpGet(key, 0); }
            catch (e0) { if (!_lpIsFb(target.hostname) && !_lpIsWa(target.hostname)) throw e0; page = { finalUrl: key, html: '' }; }
            let info = _lpParse(page.html, page.finalUrl);
            let fbFallback = false;
            if (_lpIsFb(target.hostname) && !info.image) {
                for (let ui = 0; ui < _LP_FB_RETRY_UAS.length && !info.image; ui++) {
                    try {
                        const p3 = await _lpGet(key, 0, _LP_FB_RETRY_UAS[ui]);
                        const i3 = _lpParse(p3.html, p3.finalUrl);
                        if (i3.image || (!info.title && i3.title)) { info = i3; page = p3; }
                    } catch (e3) { /* try the next user agent */ }
                }
                if (!info.image) {
                    const goodTitle = !!info.title && !/^(facebook|log in|log into facebook|facebook\s*[-\u2013\u2014]\s*log in)/i.test(info.title.trim());
                    fbFallback = true;
                    info = {
                        title: goodTitle ? info.title : 'Facebook video or post',
                        description: goodTitle && info.description ? info.description : 'Tap to open on Facebook',
                        image: '',
                        siteName: 'Facebook'
                    };
                }
            }
            // WhatsApp invite/channel links (see _lpIsWa note above): retry other crawler UAs for the group photo, inline it as a
            // data: URI, and fall back to a branded title-only card (never "nothing") if WhatsApp truly gives us no metadata.
            let waFallback = false;
            if (_lpIsWa(target.hostname)) {
                if (!info.image) {
                    for (let wi = 0; wi < _LP_WA_RETRY_UAS.length && !info.image; wi++) {
                        try {
                            const pw = await _lpGet(key, 0, _LP_WA_RETRY_UAS[wi]);
                            const iw = _lpParse(pw.html, pw.finalUrl);
                            if (iw.image || (!info.title && iw.title)) { info = iw; page = pw; }
                        } catch (ew) { /* try the next user agent */ }
                    }
                }
                if (info.image) {
                    try { info.image = await _lpGetImageDataUri(info.image, 0); }
                    catch (ei) { /* keep the remote URL — the browser may still be able to load it */ }
                }
                if (!info.image) {
                    const isInvite = /^chat\./i.test(target.hostname);
                    const goodWa = !!info.title && !/^whatsapp(\s+web)?$/i.test(info.title.trim());
                    waFallback = true;
                    info = {
                        title: goodWa ? info.title : (isInvite ? 'WhatsApp Group Invite' : 'WhatsApp link'),
                        description: goodWa && info.description ? info.description : 'Tap to open on WhatsApp',
                        image: '',
                        siteName: 'WhatsApp'
                    };
                }
            }
            // X/Twitter serves a near-empty shell to most crawlers; fxtwitter
            // exists specifically to return a real OG card for a post URL.
            if (/(^|\.)(x|twitter)\.com$/i.test(target.hostname) && (!info.image && (!info.title || /^(x|twitter)$/i.test(info.title.trim())))) {
                try {
                    const fx = new URL(key); fx.hostname = 'fxtwitter.com';
                    const p2 = await _lpGet(fx.toString(), 0);
                    const i2 = _lpParse(p2.html, p2.finalUrl);
                    if (i2.title || i2.image) info = i2;
                } catch (e) { /* keep the first result */ }
            }
            let finalHost = target.hostname;
            try { finalHost = new URL(page.finalUrl).hostname; } catch (e) {}
            if (info.title || info.image) {
                data = { ok: true, url: key, domain: (fbFallback ? 'facebook.com' : (waFallback ? 'whatsapp.com' : finalHost.replace(/^www\./, ''))), title: info.title, description: info.description, image: info.image, siteName: info.siteName };
                if (fbFallback || waFallback) data.fallback = true;
            } else {
                data = { ok: false, error: 'no metadata' };
            }
        } catch (e) {
            data = { ok: false, error: 'fetch failed' };
        }
        if (_lpCache.size > 1000) _lpCache.delete(_lpCache.keys().next().value);
        _lpCache.set(key, { t: now, ttl: (data.ok && !data.fallback) ? _LP_TTL_OK_MS : _LP_TTL_FAIL_MS, data: data });
        res.set('Cache-Control', 'public, max-age=' + ((data.ok && !data.fallback) ? 3600 : 300));
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'server error' });
    }
});


// FEATURE (2026-10-28 — chat group-invite cards): the in-chat card for an Empyrean "?openGroup=<id>" link used to read
// groups/{id} straight from the browser, which comes back empty for anyone who isn't (yet) a member of that group — so the card
// fell back to a generic "Empyrean group" with no picture. This returns ONLY the public card fields (name, picture, member
// count) via the Admin SDK so the card shows the real group avatar for every viewer. The id is the unguessable Firestore doc id
// already embedded in the invite link itself, so this exposes nothing a link-holder couldn't already see on the join screen.
app.get('/api/group-invite-meta', async (req, res) => {
    try {
        const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
        const now = Date.now();
        const hit = _lpHits.get('g:' + ip);
        if (!hit || now > hit.resetAt) _lpHits.set('g:' + ip, { n: 1, resetAt: now + 60000 });
        else if (++hit.n > 60) return res.status(429).json({ ok: false, error: 'rate limited' });
        const id = String(req.query.id || '').trim();
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return res.status(400).json({ ok: false, error: 'bad id' });
        const admin = _getAdmin();
        if (!admin) return res.json({ ok: false, error: 'unavailable' });
        const snap = await admin.firestore().collection('groups').doc(id).get();
        if (!snap.exists) return res.json({ ok: false, error: 'not found' });
        const d = snap.data() || {};
        res.set('Cache-Control', 'public, max-age=300');
        return res.json({
            ok: true, id: id,
            name: String(d.name || '').slice(0, 120),
            avatar: (typeof d.avatar === 'string' && /^https?:\/\//i.test(d.avatar)) ? d.avatar : '',
            members: Array.isArray(d.members) ? d.members.length : 0
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'server error' });
    }
});

// ── /api/notify ── Server-side push notification dispatcher ──────────────
// Mirrors the Android dispatchNotification() pattern from the integration notes.
// Sends FCM push via Firebase Admin SDK (service account key never leaves server).
//
// Two targeting modes:
//   - token given  → sends to that one device (e.g. a DM/reply notification)
//   - no token     → broadcasts to the BROADCAST_TOPIC (every device that
//                     called /api/fcm/subscribe below) — this is the mode
//                     the new-post/SOS/crisis listener uses, since a new
//                     public post should reach everyone, not one person.
const BROADCAST_TOPIC = process.env.FCM_BROADCAST_TOPIC || 'empyrean_all';

app.post('/api/notify', async (req, res) => {
    // userName: the profile name of the person who triggered the update
    // (e.g. "Adefemi Bola") — shown in the notification body so it reads
    // like "Adefemi Bola posted in SOS" rather than a faceless "SOS Update".
    // postId: if the notification is about a specific post, we look it up
    // via the same Firestore path the OG-preview route below already uses,
    // so the notification's thumbnail is the exact same rich video/photo
    // poster frame that a shared link would show — one source of truth.
    // uid: NEW (feature — follow notifications) — targets ONE specific
    // person by their own user id rather than a device token the caller
    // can't be expected to know. Looked up server-side against
    // users/{uid}.fcmToken, the exact same field app-push-setup.js's
    // /api/fcm/subscribe already writes for the scheduled-stream-reminder
    // feature — so this reuses that existing per-user token storage
    // instead of inventing a second one. Naturally respects the only
    // notification preference this app has today: someone with no stored
    // token has never opted into push, so there's nothing to send to.
    const { section, summary, imageUrl, token, topic, userName, postId, uid } = req.body;
    if (!section || !summary) return res.status(400).json({ error: 'section and summary required' });

    // Only attempt if FCM Admin is configured
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        return res.json({ sent: false, reason: 'FCM not configured' });
    }

    try {
        // Lazy-init Firebase Admin (avoids crash when env var missing in dev)
        if (!app._firebaseAdmin) {
            const admin = require('firebase-admin');
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            // storageBucket added (2026-08) so admin.storage() is usable from
            // WHICHEVER of the three lazy-init blocks in this file happens to
            // run first — see the /api/admin/media-migration route further
            // down, which needs admin.storage().bucket() to re-upload old
            // Cloudinary media into Firebase Storage. Harmless no-op for
            // every other caller of this block (FCM/Firestore don't look at
            // this option at all).
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
            });
            app._firebaseAdmin = admin;
        }
        const admin = app._firebaseAdmin;

        // Prefer an explicitly-passed imageUrl; otherwise, if a postId was
        // given, pull its poster/thumbnail from Firestore so the caller
        // doesn't have to resolve the video-poster-frame logic itself.
        let thumb = imageUrl || '';
        if (!thumb && postId) {
            const meta = await _fetchPostForPreview(String(postId), req);
            if (meta && meta.image) thumb = meta.image;
        }
        const logo = _logoUrl(req);

        const title = APP_NAME;
        const body  = userName ? `${userName}: ${summary}` : `${section}: ${summary}`;

        // Target: an explicit token wins; else a uid is resolved to that
        // person's own stored token; else broadcast to a topic (either the
        // one the caller named, or the default "everyone" topic). FCM's
        // send() only accepts ONE of token/topic/condition — never both —
        // so this picks exactly one field to set.
        let resolvedToken = token || null;
        if (!resolvedToken && uid) {
            try {
                const userSnap = await admin.firestore().collection('users').doc(String(uid)).get();
                resolvedToken = (userSnap.exists && userSnap.data() && userSnap.data().fcmToken) || null;
            } catch (err) {
                console.warn('[Notify] uid token lookup failed for', uid, '-', err.message);
            }
            if (!resolvedToken) {
                // Nothing to send to — this person has never registered a
                // device for push. Not an error; same as every other
                // "no token" skip in this file (see _sendBirthdayPushToFollowers).
                return res.json({ sent: false, reason: 'recipient has no registered push token' });
            }
        }
        const target = resolvedToken ? { token: resolvedToken } : { topic: topic || BROADCAST_TOPIC };

        const message = {
            ...target,
            notification: {
                title,
                body,
                // "image" is the big picture shown when the notification is
                // expanded — the rich video/photo poster frame thumbnail.
                ...(thumb ? { imageUrl: thumb } : {})
            },
            // Web push (browser/PWA) reads `icon` for the small app-branding
            // glyph shown next to the title — this is where the logo goes
            // for web. Native Android's small status-bar icon instead comes
            // from a drawable bundled inside the APK (android.notification.icon
            // below expects a resource *name*, e.g. "ic_notification", not a
            // URL) — set ANDROID_NOTIFICATION_ICON if the app has one; the
            // big "image" above still shows the real logo/thumbnail either way.
            webpush: {
                // `badge`: the small monochrome-ish status-bar/header glyph
                // shown right next to the app's own name ("Empyrean") on
                // Android/Chrome — a DIFFERENT slot than `icon` above (which
                // is the larger picture next to the body text, and can
                // legitimately be a poster's own avatar elsewhere in this
                // file). This is the one that should always be the actual
                // Empyrean logo, regardless of what `icon` shows.
                notification: { icon: logo, image: thumb || logo, badge: logo },
                // Deep-link a click on the notification straight to the post.
                fcmOptions: postId ? { link: `/?post=${encodeURIComponent(postId)}` } : undefined
            },
            android: {
                priority: 'high',
                notification: {
                    ...(process.env.ANDROID_NOTIFICATION_ICON ? { icon: process.env.ANDROID_NOTIFICATION_ICON } : {}),
                    color: '#1a2b85' // matches the logo's blue
                }
            },
            apns: { payload: { aps: { sound: 'default' } } }
        };
        const result = await admin.messaging().send(message);
        res.json({ sent: true, messageId: result, target, title, body, image: thumb || logo });
    } catch (err) {
        console.error('[Notify] FCM error:', err.message);
        res.status(500).json({ sent: false, error: err.message });
    }
});

// ── NEURAL TEXT-TO-SPEECH PROXY (ElevenLabs) ──────────────────────────────
// FEATURE: replaces the robotic OS-installed voice the "🔊 Hear this
// section" voice assistants (Donor Hub / Sponsor a Cause, and the Grant
// Transparency Portal — see index.html's §48/§49 blocks) used to rely on
// exclusively (window.speechSynthesis, whose actual voice quality is
// whatever happens to be installed on the visitor's OS — often noticeably
// robotic). This route generates real, human-sounding narration via
// ElevenLabs' Multilingual v2 model server-side, so the API key never
// reaches the browser (same "secret stays server-side, client only ever
// gets the derived result" pattern already used for Flutterwave's secret
// key and SendGrid's API key elsewhere in this file).
//
// The client falls back to speechSynthesis automatically if this route
// ever fails for any reason (key not configured, ElevenLabs outage, rate
// limit, network error) — see index.html's own try/catch around its
// fetch('/api/tts') call. Nothing else changes if ELEVENLABS_API_KEY is
// left unset: this route just answers 501 and the existing browser-voice
// behavior continues exactly as it did before this feature shipped.
//
// COST CONTROL: the handful of narration texts this feature actually
// serves (one per language, per section — a fixed, small set) are cached
// in memory by a hash of (lang + text), so the very first play of each
// language/section combo is the only one that ever calls the paid
// ElevenLabs API — every later play for that same narration, from any
// visitor, is served straight out of this process's memory. A generous
// but bounded MAX_TEXT_LEN keeps any single request cheap even before
// caching kicks in.
const _ttsCache = new Map(); // sha256(lang+'|'+text) -> mp3 Buffer
const TTS_CACHE_MAX_ENTRIES = 200; // this feature only ever needs a couple dozen; a cap is just a safety net against unbounded growth
const TTS_MAX_TEXT_LEN = 6000; // comfortably covers the longest existing narration (a few hundred words) with headroom, well under Multilingual v2's own 10,000-char limit
// Default: ElevenLabs' "Rachel" premade voice — clear, natural, and
// verified to support all six languages this feature narrates in (English,
// French, Spanish, Arabic, Chinese, Greek) under the eleven_multilingual_v2
// model. Override with ELEVENLABS_VOICE_ID for a different voice without a
// code change.
const ELEVENLABS_DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

app.post('/api/tts', express.json({ limit: '256kb' }), async (req, res) => {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            // Not configured — client falls back to speechSynthesis. Not an
            // error condition worth logging on every single play attempt.
            return res.status(501).json({ error: 'ElevenLabs not configured on this server.' });
        }

        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        const lang = typeof req.body?.lang === 'string' ? req.body.lang.trim() : '';
        if (!text) return res.status(400).json({ error: 'text is required' });
        if (text.length > TTS_MAX_TEXT_LEN) {
            return res.status(400).json({ error: `text exceeds ${TTS_MAX_TEXT_LEN} characters` });
        }

        const cacheKey = crypto.createHash('sha256').update('v2|' + lang + '|' + text).digest('hex'); // 'v2|' = voice-settings revision, so audio cached under the old settings is never reused
        const cached = _ttsCache.get(cacheKey);
        if (cached) {
            res.set('Content-Type', 'audio/mpeg');
            res.set('X-TTS-Cache', 'hit');
            return res.send(cached);
        }

        const voiceId = process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_DEFAULT_VOICE_ID;
        const elResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg'
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_multilingual_v2',
                /* HUMAN-VOICE UPGRADE (2026-10-27): lower stability = more natural pitch/pace variation between
                   sentences (0.5 reads a little flat over a long script); higher similarity keeps the voice
                   consistent across the ~500-char segments the client sends separately; a touch of style gives
                   warmer, more conversational delivery; speaker boost sharpens clarity on phone speakers. */
                voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true }
            })
        });

        if (!elResp.ok) {
            const detail = await elResp.text().catch(() => '');
            console.error('[TTS] ElevenLabs error', elResp.status, detail.slice(0, 300));
            return res.status(502).json({ error: 'ElevenLabs request failed (' + elResp.status + ')' });
        }

        const audioBuffer = Buffer.from(await elResp.arrayBuffer());

        // Simple bounded cache — evict the oldest entry once full (Map
        // preserves insertion order, so the first key IS the oldest).
        if (_ttsCache.size >= TTS_CACHE_MAX_ENTRIES) {
            _ttsCache.delete(_ttsCache.keys().next().value);
        }
        _ttsCache.set(cacheKey, audioBuffer);

        res.set('Content-Type', 'audio/mpeg');
        res.set('X-TTS-Cache', 'miss');
        res.send(audioBuffer);
    } catch (err) {
        console.error('[TTS] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── SERVER-SIDE NOTIFY LISTENERS (no client required) ────────────────────
// FIX (feature: "notifications should still go out even if nobody has the
// app open anywhere"): app-push-setup.js's old empyreanPostNotifyTrigger()
// was a Firestore listener that only ran INSIDE A BROWSER TAB — if nobody
// had the app open when a post/SOS/crisis doc was created, nothing fired
// until someone reconnected. This does the same job from inside THIS
// process instead. server.js is a persistent Node process (not a browser
// tab) that already stays running 24/7 on Render's starter plan, already
// has the Firebase Admin SDK credentials loaded (FIREBASE_SERVICE_ACCOUNT_
// JSON, used by /api/notify above), and Admin SDK Firestore listeners run
// with admin privileges — they're not subject to the Firestore security
// rules a browser client would be. So the listener attaches once at boot
// and keeps running for the life of this server, independent of any
// client being connected. No Firebase Blaze plan needed — this isn't a
// Cloud Function, just another listener living in the same server process
// that already sends the pushes.
//
// IMPORTANT: this REPLACES app-push-setup.js's client-side trigger (Part
// 2, empyreanPostNotifyTrigger). That client-side code must stay removed/
// disabled once this is deployed — running both at once double-sends
// every notification. See the matching comment left in app-push-setup.js.
//
// Trade-off vs. a true Cloud Function: this depends on the Render dyno
// itself staying up. Render's starter plan doesn't sleep and restarts are
// rare, but a deploy or platform restart means a few seconds where the
// listener isn't attached — a Cloud Function has stronger uptime
// guarantees than any single server process, at the cost of needing the
// Blaze plan. Revisit if that gap ever matters for something urgent (e.g.
// SOS).

// NOTE: 'statuses' is deliberately NOT in this list -- unlike posts/sos/
// crisis/news/reels (one brand-new Firestore doc per post), a status is ONE
// doc per user (id "status-<uid>") whose `items` array just grows via a
// merge update (see app-status.js's writers). A generic "doc added" watcher
// would only ever fire for someone's very first-ever status and stay silent
// for every one after that, so statuses gets its own listener below
// (_watchStatuses) that diffs items.length instead of doc-added events.
// (Reels DO fit the generic pattern here -- app-fixes.js writes a fresh
// doc per upload via .doc(reelId).set(...); the later .update() calls for
// likes/retweets are 'modified' events, which _watchCollection below
// already ignores, so those don't cause spurious re-notifications.)
const NOTIFY_COLLECTIONS = [
    { name: 'posts',          section: 'Post'         },
    { name: 'sos_queue',      section: 'SOS'          },
    { name: 'crisis_reports', section: 'Crisis'       },
    { name: 'news_posts',     section: 'News'         },
    { name: 'reels',          section: 'Reel'         },
    // FIX (bug: "offline push notifications are not delivered" / "please
    // connect all posts from all site sections to ... the offline push
    // notification system"): admin announcements already have a working,
    // real-time, cross-device IN-APP bell notification (see the
    // 'announcements' onSnapshot listener in app-fixes.js/app-feed.js --
    // that one was never broken). But nothing ever sent an announcement
    // out as an actual FCM push, so anyone with the app closed never saw
    // it at all. Added here for the same offline-delivery treatment every
    // other collection in this list already gets.
    { name: 'announcements',  section: 'Announcement' }
];

// APP_DOMAIN is optional/manual (see render.yaml); RENDER_EXTERNAL_URL is
// set automatically by Render for every web service, no config needed —
// so this works out of the box on Render without any new env var.
function _appDomain() {
    return process.env.APP_DOMAIN || process.env.RENDER_EXTERNAL_URL || '';
}

// Same shape as the removed client-side _summarize() in app-push-setup.js.
function _summarizeDoc(section, d) {
    // "name" (not "username") is the display-name field on a statuses doc --
    // see app-status.js's writer -- so it has to be checked here too, same
    // as _fetchPostForPreview's author resolution already does.
    // Announcements (app-fixes.js's admin publish handler) carry NEITHER --
    // their schema is just { type, title, body, adminId, createdAt }, no
    // display-name field at all -- so every one of those would otherwise
    // fall through to the generic "Someone" fallback below.
    const author = section === 'Announcement'
        ? APP_NAME
        : (d.username || d.displayUsername || d.fullName || d.name || 'Someone');

    let text;
    if (section === 'News') {
        // news_posts schema: { title, content, ... } -- lead with the body
        // text; the title is already folded into "News: <summary>" by the
        // caller via `section`, so it's only used here as a fallback.
        text = String(d.content || d.title || '').replace(/\s+/g, ' ').trim();
    } else if (section === 'Reel') {
        // reels schema (app-fixes.js): { videoUrl, url, caption, userId,
        // username, avatar, poster, likes, views, createdAt }.
        text = String(d.caption || '').replace(/\s+/g, ' ').trim();
    } else if (section === 'Announcement') {
        // announcements schema: { type, title, body, adminId, createdAt } --
        // lead with the body text, title as fallback, same convention News
        // already uses for its own title/content split.
        text = String(d.body || d.title || '').replace(/\s+/g, ' ').trim();
    } else if (section === 'Status') {
        // statuses schema: { items: [...] }, each item shaped like
        // app-status.js's own _mkItem() writer -- the newest entry is the
        // one that just triggered this notification (see _watchStatuses).
        const items = Array.isArray(d.items) ? d.items : [];
        const latest = items[items.length - 1] || {};
        text = String(latest.content || '').replace(/\s+/g, ' ').trim();
    } else {
        text = String(d.story || d.text || d.title || d.description || '').replace(/\s+/g, ' ').trim();
    }

    const summary = text ? text.slice(0, 120)
        : section === 'SOS'          ? 'Needs help — tap to view.'
        : section === 'Status'       ? 'Posted a new status.'
        : section === 'News'         ? 'Read the full story on Empyrean.'
        : section === 'Reel'         ? 'Watch this reel on Empyrean.'
        : section === 'Announcement' ? 'New announcement — tap to view.'
        : 'New update on Empyrean.';
    return { author, summary };
}

// FIX (root cause of SOS/post video cards silently never showing an image):
// this used to check `first.type === 'video'` — an exact-string match — but
// the client (see app-sos.js's _submitSosForm / _submitCrisisForm) stores
// the browser File object's real MIME type here, e.g. "video/mp4", which
// never equals the bare string "video". That check was always false, so
// whether a card got a poster frame at all silently depended entirely on
// the fallback regex matching a recognisable file extension in the URL —
// true most of the time, but not for every Cloudinary delivery variant
// (e.g. no extension present at all). Checking the MIME prefix AND the
// Cloudinary /video/upload/ path segment directly (the most reliable
// signal we actually have) makes this correct instead of "usually right".
function _looksLikeVideo(first, rawUrl) {
    const t = (typeof first === 'object' && first && first.type) || '';
    return t === 'video' || /^video\//i.test(t)
        || /\/video\/upload\//i.test(rawUrl)
        || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(rawUrl);
}

// A minimal req-like shim so the branding-overlay helpers (which only ever
// need req.protocol + req.get('host')) can be reused from contexts that
// aren't inside an Express request handler — namely the Firestore listeners
// below, which fire from server boot, not from an incoming HTTP request.
function _pseudoReq() {
    const domain = _appDomain();
    if (!domain) return null;
    const m = /^(https?):\/\/(.+)$/i.exec(domain) || [null, 'https', domain];
    const host = m[2];
    return { protocol: m[1], get: () => host };
}

// Same media-resolution logic as _fetchPostForPreview() above, minus the
// Firestore read — the listener hands us the doc directly. Needs `section`
// now because News (mediaUrl/mediaType) and Status (items[].url) don't use
// the generic `media` array that Post/SOS/Crisis do.
function _resolveImageFromDoc(section, d) {
    const pReq = _pseudoReq(); // null if APP_DOMAIN/RENDER_EXTERNAL_URL isn't set yet
    const author = section === 'Announcement'
        ? APP_NAME
        : (d.username || d.displayUsername || d.fullName || d.name || 'Someone');
    const avatar = d.avatar || '';
    let image = '';
    if (section === 'News') {
        const newsIsVideo = !!(d.mediaUrl && (
            (d.mediaType || '').startsWith('video/')
            || /\/video\/upload\//i.test(d.mediaUrl)
            || /\.(mp4|webm|mov)(\?|$)/i.test(d.mediaUrl)
        ));
        image = d.mediaUrl ? (newsIsVideo ? (_videoPosterFromCloudinary(d.mediaUrl, pReq, avatar) || '') : d.mediaUrl) : '';
    } else if (section === 'Reel') {
        // reels are always video — same videoUrl/url + poster fallback
        // _fetchPostForPreview's isReel branch uses.
        const rawUrl = d.videoUrl || d.url || '';
        image = _videoPosterFromCloudinary(rawUrl, pReq, avatar) || d.poster || d.thumbnailUrl || '';
    } else if (section === 'Status') {
        const items = Array.isArray(d.items) ? d.items : [];
        const latest = items[items.length - 1] || {};
        const rawUrl = latest.url || '';
        image = (latest.type === 'video') ? (_videoPosterFromCloudinary(rawUrl, pReq, avatar) || '') : rawUrl;
    } else {
        const media = d.media || [];
        if (Array.isArray(media) && media.length) {
            const first = media[0];
            const rawUrl = (typeof first === 'string') ? first : (first && (first.url || first._cloudUrl)) || '';
            image = _looksLikeVideo(first, rawUrl)
                ? (_videoPosterFromCloudinary(rawUrl, pReq, avatar) || d.thumbnailUrl || d.posterUrl || '')
                : rawUrl;
        }
    }
    // No media of its own — frame the author's real avatar (or, failing
    // that, a generated initials placeholder) onto our branded card rather
    // than sending a bare, unframed avatar image as the push thumbnail.
    if (!image) {
        image = _avatarPlaceholderCard(avatar || _uiAvatarPlaceholder(author), pReq);
    }
    return image;
}

async function _sendPushForDoc(section, docId, d) {
    const admin = _getAdmin();
    if (!admin) return;
    const { author, summary } = _summarizeDoc(section, d);
    const domain = _appDomain();
    // FIX (2026-08-24 — "Empyrean logo doesn't show in the offline push
    // notification"): this and every other push-sending function in this
    // file built its own `domain + '/logo.png'` URL, independently of
    // _logoUrl(req) above (which points at /icon-192.png instead).
    // /icon-192.png is the one logo asset this app can GUARANTEE exists on
    // every deploy — it's required by manifest.json for the PWA install
    // check and is the <link rel="icon"> favicon (index.html), both of
    // which this app already depends on working. /logo.png was never
    // wired into either of those hard requirements, so a deploy missing
    // that one optional file would silently 404 every push notification's
    // icon/badge image with no error anywhere — exactly "logo doesn't
    // show". Standardized every push's icon/badge on the verified-present
    // asset instead.
    const logo   = domain ? domain + '/icon-192.png' : '';
    const thumb  = _resolveImageFromDoc(section, d) || logo;

    // FIX (feature: notification should show the POSTER'S OWN round avatar
    // on the left, like X/Twitter, Facebook, and TikTok's push
    // notifications do — not the generic app logo every push previously
    // used regardless of who posted). `d.avatar` is already the poster's
    // own profile picture field on every section this fires for except
    // Announcement, which is a system-wide admin broadcast with no single
    // personal author — the app logo is the correct "who sent this" signal
    // there, so that one case keeps it. Falls back to the logo for any
    // other doc that happens to be missing an avatar, so this can never
    // send a broken/empty icon.
    const posterAvatar = section === 'Announcement' ? '' : (d.avatar || '');
    const icon = posterAvatar || logo;

    // FIX ("sos thumbnail attempts to start but silently fails after some
    // time"): Cloudinary generates transformed derivatives (poster frames,
    // avatar-framed cards) lazily, on the FIRST request for that exact
    // transform URL — for a video with the play-button + branding overlay
    // chain baked in, that first render can take several seconds. WhatsApp/
    // Facebook/etc. only wait a few seconds when fetching og:image for a
    // link preview, so if the share is the very first hit on that URL, the
    // crawler's own fetch times out and the card silently comes back
    // image-less — no error anywhere, it just never finishes "attempting to
    // start". Firing this fetch here, the moment the post/SOS/crisis doc is
    // created (well before anyone has a chance to tap Share), forces
    // Cloudinary to render and CDN-cache it early, so by share time the
    // exact same URL is already warm and returns instantly.
    _prewarmUrl(thumb);

    const message = {
        topic: BROADCAST_TOPIC,
        notification: {
            title: APP_NAME,
            body:  `${author}: ${summary}`,
            ...(thumb ? { imageUrl: thumb } : {})
        },
        webpush: {
            // icon: small, round, left (poster's own avatar) — image: big,
            // square, right/full (the actual post media) — see silent/
            // vibrate fix note below for why both are explicit. badge: the
            // status-bar/header glyph next to the app's own name — always
            // the real Empyrean logo, never the poster's avatar, since
            // that's a different visual slot from `icon` above.
            notification: { icon: icon, image: thumb || logo, badge: logo, silent: false, vibrate: [200, 100, 200] },
            fcmOptions: domain ? { link: `${domain}/?post=${encodeURIComponent(docId)}` } : undefined
        },
        android: {
            priority: 'high',
            notification: {
                ...(process.env.ANDROID_NOTIFICATION_ICON ? { icon: process.env.ANDROID_NOTIFICATION_ICON } : {}),
                color: '#1a2b85', // matches the logo's blue
                sound: 'default'  // same fix as webpush above, for the native-Android delivery path
            }
        },
        apns: { payload: { aps: { sound: 'default' } } }
    };

    try {
        const id = await admin.messaging().send(message);
        console.log(`[ServerNotify] ${section} ${docId} -> ${id}`);
    } catch (err) {
        console.error(`[ServerNotify] ${section} ${docId} failed:`, err.message);
    }
}

function _watchCollection(admin, name, section) {
    // FIX (bug: "received one push notification, then nothing ever again"):
    // onSnapshot's error callback below used to just console.warn and stop —
    // it never re-subscribed. Any single transient error (an auth token
    // refresh hiccup, a brief network blip to Firestore, Render's own
    // outbound connection being recycled, etc.) permanently killed this
    // listener for the remaining lifetime of the server process. Since
    // server.js only calls startServerNotifyListeners() once at boot, that
    // meant EVERY post/SOS/crisis/news/reel/announcement created after the
    // first such error produced zero pushes, silently, with only a single
    // warning line in the logs to show it ever happened — exactly the "one
    // then nothing" symptom. attach() now re-subscribes after a short delay
    // instead of giving up for good.
    //
    // Re-attaching a brand-new onSnapshot also creates a NEW problem on its
    // own: a freshly (re)subscribed listener's first snapshot reports every
    // doc in the current top-5 window as change.type === 'added' — Firestore
    // has no memory of what a previous, now-dead listener already saw. Left
    // as-is, every reconnect would re-fire pushes for the same 5 most-recent
    // docs all over again. So "what counts as new" no longer trusts
    // change.type at all; it compares each doc's createdAt against the
    // newest createdAt this watcher has ever actually seen, which — unlike
    // firstSnapshot/change.type — survives a reconnect correctly: docs older
    // than or equal to the watermark are re-delivered-but-ignored, and any
    // doc genuinely created during the (hopefully brief) gap while
    // disconnected still gets caught and pushed once reconnected.
    let newestSeenCreatedAt = null; // watermark; persists across reconnects
    let bootstrapped = false;       // true once the pre-existing top doc's timestamp has been captured — only happens once, at real server boot, not on a reconnect

    function attach() {
        admin.firestore().collection(name)
            .orderBy('createdAt', 'desc')
            .limit(5)
            .onSnapshot(function(snapshot) {
                const docs = snapshot.docs; // already newest-first
                if (!bootstrapped) {
                    // Server boot only: record what's already there, notify
                    // for none of it — same "don't notify for pre-existing
                    // docs" guard the old firstSnapshot flag provided.
                    if (docs.length) newestSeenCreatedAt = docs[0].get('createdAt');
                    bootstrapped = true;
                    return;
                }
                docs.forEach(function(doc) {
                    const createdAt = doc.get('createdAt');
                    if (createdAt && (!newestSeenCreatedAt || createdAt > newestSeenCreatedAt)) {
                        _sendPushForDoc(section, doc.id, doc.data() || {});
                    }
                });
                if (docs.length && (!newestSeenCreatedAt || docs[0].get('createdAt') > newestSeenCreatedAt)) {
                    newestSeenCreatedAt = docs[0].get('createdAt');
                }
            }, function(err) {
                console.warn(`[ServerNotify] listener error on ${name}:`, err.message, '— reconnecting in 5s');
                setTimeout(attach, 5000);
            });
    }
    attach();
}

// Statuses need a different watcher than _watchCollection above: a status
// doc (id "status-<uid>") is created ONCE per user and then just grows its
// `items` array via a merge update every time that user posts a new status
// (see app-status.js's writers) — there's no second "doc added" event to
// hook into. Instead, this tracks each doc's last-seen items.length and
// only fires when that count goes UP, which is true both for someone's
// very first status ever (0 -> 1) and every one after (N -> N+1), but not
// for deletions (N -> N-1) or unrelated merges.
function _watchStatuses(admin) {
    let firstSnapshot = true;
    const lastItemCount = new Map(); // docId -> items.length as of last snapshot — declared outside attach() so it (and firstSnapshot) survive a reconnect, which is what makes reconnecting here safe without any extra watermark logic: a re-delivered "added" for a doc whose items.length hasn't changed since we last recorded it just compares equal and no-ops.

    // FIX (same "one push then nothing ever again" bug as _watchCollection
    // above): reconnect on error instead of dying silently. Unlike
    // _watchCollection, this watcher's existing dedupe (the Map above) is
    // ALREADY reconnect-safe as-is — it's keyed on each doc's own
    // items.length, not on change.type or a boot-only flag — so no other
    // logic needed to change here, just the retry.
    function attach() {
        admin.firestore().collection('statuses')
            .onSnapshot(function(snapshot) {
                snapshot.docChanges().forEach(function(change) {
                    if (change.type === 'removed') { lastItemCount.delete(change.doc.id); return; }
                    const d = change.doc.data() || {};
                    const items = Array.isArray(d.items) ? d.items : [];
                    const prevCount = lastItemCount.has(change.doc.id) ? lastItemCount.get(change.doc.id) : 0;
                    lastItemCount.set(change.doc.id, items.length);
                    // Skip the initial snapshot (docs/items that already existed
                    // before this listener attached) — same boot guard the other
                    // collections use, just measured in item-count instead of
                    // doc existence.
                    if (!firstSnapshot && items.length > prevCount) {
                        _sendPushForDoc('Status', change.doc.id, d);
                    }
                });
                firstSnapshot = false;
            }, function(err) {
                console.warn('[ServerNotify] listener error on statuses:', err.message, '— reconnecting in 5s');
                setTimeout(attach, 5000);
            });
    }
    attach();
}

// ── SCHOLARSHIP PUSH (2026-09-28) ─────────────────────────────────────────
// Admin Panel → Scholarships → "Push Scholarship" (app-admin.js →
// initScholarshipManager) writes to `scholarship_adverts`, which puts the
// card on every OPEN dashboard live. This is the matching OFFLINE half: the
// same event also goes out as an FCM broadcast so members with the app
// closed are told too, and tapping it lands on ?scholarship=<id> (which
// app-feed.js's empyreanScholarshipRail() opens as the details modal).
//
// Why its own watcher instead of a NOTIFY_COLLECTIONS entry: that generic
// watcher only fires on a brand-new doc (createdAt watermark) and knows
// nothing about `active`. A scholarship must ALSO (a) stay silent when the
// admin saves it paused, (b) push again when a paused one is RESUMED (the
// admin panel stamps a fresh `pushedAt` on create and on resume, never on a
// plain edit or pause), and (c) honour the admin's "Send push notification"
// checkbox (`notifyPush`, default true when the field is absent). So the
// watermark here is `pushedAt`, not `createdAt`.
function _scholarshipMs(v) {
    try { if (v && typeof v.toMillis === 'function') return v.toMillis(); if (v) return new Date(v).getTime() || 0; } catch (e) {}
    return 0;
}
function _scholarshipTodayStr() {
    // en-CA formats as YYYY-MM-DD — the same string shape the admin form's
    // <input type="date"> stores in startDate/endDate. Lagos by default
    // (this app's audience); override with SCHOLARSHIP_TZ if ever needed.
    try { return new Date().toLocaleDateString('en-CA', { timeZone: process.env.SCHOLARSHIP_TZ || 'Africa/Lagos' }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
}
function _scholarshipFmtDate(s) {
    const p = String(s || '').split('-');
    if (p.length !== 3) return String(s || '');
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function _scholarshipMoney(n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); }

async function _sendScholarshipPush(docId, d) {
    const admin = _getAdmin();
    if (!admin) return;
    const domain = _appDomain();
    const logo   = domain ? domain + '/icon-192.png' : '';
    const pReq   = _pseudoReq();
    // (2026-09-29) Prefer the scholarship's own image (d.imageUrl) for the push thumbnail too;
    // the branded 1200x630 card is only the fallback for a scholarship pushed without one.
    const ownImage = (typeof d.imageUrl === 'string' && /^https?:\/\//i.test(d.imageUrl)) ? d.imageUrl : '';
    const image  = ownImage || (pReq ? _fallbackCardUrl(pReq) : logo);

    const title = String(d.title || 'New scholarship').replace(/\s+/g, ' ').trim();
    const bits = [];
    if (d.institution) bits.push(String(d.institution));
    const _bothTiers = /full/i.test(String(d.fundingType || '')) && /partial/i.test(String(d.fundingType || ''));
    if (_bothTiers) bits.push('fully & partially funded slots');
    else if (d.totalFee != null) bits.push(Number(d.studentPays) > 0 ? 'you pay ' + _scholarshipMoney(d.studentPays) : 'fully funded \u2014 free to you');
    if (d.endDate) bits.push('apply by ' + _scholarshipFmtDate(d.endDate));
    const body = (title + (bits.length ? ' — ' + bits.join(' · ') : '')).slice(0, 180);

    _prewarmUrl(image);

    const message = {
        topic: BROADCAST_TOPIC,
        notification: {
            title: '🎓 ' + (d.fundingType || 'Scholarship') + ' opportunity',
            body: body,
            ...(image ? { imageUrl: image } : {})
        },
        data: { type: 'scholarship', scholarshipId: String(docId) },
        webpush: {
            notification: { icon: logo, image: image || logo, badge: logo, silent: false, vibrate: [200, 100, 200] },
            fcmOptions: domain ? { link: `${domain}/?scholarship=${encodeURIComponent(docId)}` } : undefined
        },
        android: {
            priority: 'high',
            notification: {
                ...(process.env.ANDROID_NOTIFICATION_ICON ? { icon: process.env.ANDROID_NOTIFICATION_ICON } : {}),
                color: '#1a2b85',
                sound: 'default'
            }
        },
        apns: { payload: { aps: { sound: 'default' } } }
    };

    try {
        const id = await admin.messaging().send(message);
        console.log(`[ServerNotify] Scholarship ${docId} -> ${id}`);
    } catch (err) {
        console.error(`[ServerNotify] Scholarship ${docId} failed:`, err.message);
    }
}

function _watchScholarships(admin) {
    // Same reconnect-safe design as _watchCollection: the watermark lives
    // OUTSIDE attach(), so a re-subscribe after an error re-delivers the
    // top-5 window but only docs newer than what was already handled fire.
    let watermark = 0;
    let bootstrapped = false;

    function attach() {
        admin.firestore().collection('scholarship_adverts')
            .orderBy('pushedAt', 'desc')
            .limit(5)
            .onSnapshot(function(snapshot) {
                const docs = snapshot.docs; // newest first
                if (!bootstrapped) {
                    if (docs.length) watermark = _scholarshipMs(docs[0].get('pushedAt'));
                    bootstrapped = true;
                    return;
                }
                const today = _scholarshipTodayStr();
                docs.slice().reverse().forEach(function(doc) { // oldest first, so several pushes arrive in order
                    if (_scholarshipMs(doc.get('pushedAt')) <= watermark) return;
                    const d = doc.data() || {};
                    if (d.active === false) return;                 // saved paused — nothing to announce yet
                    if (d.notifyPush === false) return;             // admin unticked "Send push notification"
                    if (d.endDate && today > d.endDate) return;     // already closed
                    _sendScholarshipPush(doc.id, d);
                });
                if (docs.length) watermark = Math.max(watermark, _scholarshipMs(docs[0].get('pushedAt')));
            }, function(err) {
                console.warn('[ServerNotify] listener error on scholarship_adverts:', err.message, '— reconnecting in 5s');
                setTimeout(attach, 5000);
            });
    }
    attach();
}

// ── FRIEND-SUGGESTION PUSH ("suggested for you" — new member joined) ─────
// FEATURE: the in-app "Suggested For You" widget (app-feed.js's own
// renderSuggestedUsers()) has always been purely client-side and
// foreground-only — someone with the app closed never found out a new
// person joined that they might want to follow. This gives that same
// event the identical offline/background FCM treatment every collection
// in NOTIFY_COLLECTIONS above already gets. Kept as its own function
// rather than folded into NOTIFY_COLLECTIONS/_watchCollection because a
// new-user doc doesn't share _summarizeDoc/_resolveImageFromDoc's
// post-shaped schema (author/summary/media) at all — it's a person, not a
// piece of content — so it needs its own small notification builder
// below, not a variant of the post one.
//
// AVATAR LAYOUT (this session's request): the new member's own round
// profile picture is the small notification icon (left, standard
// left-side "who" slot) and that same avatar again, full-size, is the big
// notification image (right/below depending on platform — the standard
// "what to look at" slot) — the same "person's own photo, not the app
// logo" treatment _sendPushForDoc above now also uses for every other
// push type.
function _watchNewUsersForSuggestions(admin) {
    let newestSeenCreatedAt = null; // watermark; survives a reconnect, same as _watchCollection
    let bootstrapped = false;       // true once server-boot's pre-existing top doc is captured, never notify for it

    function attach() {
        admin.firestore().collection('users')
            .orderBy('createdAt', 'desc')
            .limit(5)
            .onSnapshot(function (snapshot) {
                const docs = snapshot.docs; // newest-first
                if (!bootstrapped) {
                    if (docs.length) newestSeenCreatedAt = docs[0].get('createdAt');
                    bootstrapped = true;
                    return;
                }
                docs.forEach(function (doc) {
                    const createdAt = doc.get('createdAt');
                    if (createdAt && (!newestSeenCreatedAt || createdAt > newestSeenCreatedAt)) {
                        _sendFriendSuggestionPush(doc.id, doc.data() || {});
                    }
                });
                if (docs.length && (!newestSeenCreatedAt || docs[0].get('createdAt') > newestSeenCreatedAt)) {
                    newestSeenCreatedAt = docs[0].get('createdAt');
                }
            }, function (err) {
                console.warn('[ServerNotify] listener error on users (friend suggestions):', err.message, '— reconnecting in 5s');
                setTimeout(attach, 5000);
            });
    }
    attach();
}

async function _sendFriendSuggestionPush(userId, d) {
    const admin = _getAdmin();
    if (!admin) return;
    const domain = _appDomain();
    const logo   = domain ? domain + '/icon-192.png' : ''; // FIX 2026-08-24 — see _sendPushForDoc's comment
    const name   = d.fullName || d.username || d.name || 'Someone new';
    // Same round-avatar-left / square-avatar-right pairing as every other
    // push now uses — both slots point at the SAME avatar image here since
    // there's only one photo to show for a person (unlike a post, which
    // has a separate author avatar and content image); the OS renders the
    // icon slot circular and the image slot as a big square/rectangle
    // regardless of the source image's own shape, which is what actually
    // produces the "circle left, square right" layout on screen.
    const avatar = d.avatar || _uiAvatarPlaceholder(name) || logo;

    const message = {
        topic: BROADCAST_TOPIC,
        notification: {
            title: APP_NAME,
            body:  `👋 ${name} just joined — suggested for you.`,
            ...(avatar ? { imageUrl: avatar } : {})
        },
        webpush: {
            // badge: status-bar/header glyph next to the app's own name —
            // always the real Empyrean logo, a different slot from `icon`
            // (the suggested person's own avatar).
            notification: { icon: avatar, image: avatar, badge: logo, silent: false, vibrate: [200, 100, 200] },
            fcmOptions: domain ? { link: `${domain}/?suggested=${encodeURIComponent(userId)}` } : undefined
        },
        android: {
            priority: 'high',
            notification: {
                ...(process.env.ANDROID_NOTIFICATION_ICON ? { icon: process.env.ANDROID_NOTIFICATION_ICON } : {}),
                color: '#1a2b85',
                sound: 'default'
            }
        },
        apns: { payload: { aps: { sound: 'default' } } }
    };

    try {
        const id = await admin.messaging().send(message);
        console.log(`[ServerNotify] friend-suggestion ${userId} -> ${id}`);
    } catch (err) {
        console.error(`[ServerNotify] friend-suggestion ${userId} failed:`, err.message);
    }
}

// ── NEW-FOLLOWER PUSH ──────────────────────────────────────────────────
// FEATURE: "enable an offline push notification to be sent when someone
// follows a user account." Nothing fired for this before because a follow
// isn't a fresh doc the way every NOTIFY_COLLECTIONS entry is — per the
// FOLLOWER LOOKUP note above _sendBirthdayPushToFollowers, this schema has
// no separate followers table; a follow is just one more id appended to
// the FOLLOWER's OWN followedUserIds array on their own users/{uid} doc
// (app-fixes.js's follow-button handler). That's the same "one doc per
// user, a field that only ever grows" shape _watchStatuses above already
// solved for — this reuses that exact diff-against-a-per-doc-Map approach,
// just comparing SET CONTENTS rather than array length, since someone
// could unfollow one person and follow another in the same write and keep
// the length identical while still genuinely following someone new.
function _watchFollows(admin) {
    let firstSnapshot = true;
    const lastFollowedIds = new Map(); // followerUid -> Set(followedUserIds) as of last snapshot — survives a reconnect, same as _watchStatuses' lastItemCount

    function attach() {
        admin.firestore().collection('users')
            .onSnapshot(function (snapshot) {
                snapshot.docChanges().forEach(function (change) {
                    if (change.type === 'removed') { lastFollowedIds.delete(change.doc.id); return; }
                    const d = change.doc.data() || {};
                    const current = new Set(Array.isArray(d.followedUserIds) ? d.followedUserIds : []);
                    const prev = lastFollowedIds.get(change.doc.id) || new Set();
                    lastFollowedIds.set(change.doc.id, current);
                    // Boot only: record every user's current followedUserIds as the
                    // baseline and notify for none of it — same guard
                    // _watchCollection/_watchStatuses/_watchNewUsersForSuggestions
                    // all use for their own first snapshot.
                    if (firstSnapshot) return;
                    current.forEach(function (followedUserId) {
                        if (followedUserId && followedUserId !== change.doc.id && !prev.has(followedUserId)) {
                            _sendFollowPush(admin, change.doc.id, d, followedUserId);
                        }
                    });
                });
                firstSnapshot = false;
            }, function (err) {
                console.warn('[ServerNotify] listener error on users (follows):', err.message, '— reconnecting in 5s');
                setTimeout(attach, 5000);
            });
    }
    attach();
}

async function _sendFollowPush(admin, followerId, followerData, followedUserId) {
    try {
        // Targeted at the ONE person who was just followed — same
        // per-uid fcmToken lookup _sendReminderPush/uid-branch of
        // /api/notify already use, not the broadcast topic.
        const userSnap = await admin.firestore().collection('users').doc(String(followedUserId)).get();
        const token = userSnap.exists && userSnap.data() ? userSnap.data().fcmToken : null;
        if (!token) return; // never registered a device for push — nothing to send to, same as every other targeted push in this file

        const domain = _appDomain();
        const logo   = domain ? domain + '/icon-192.png' : ''; // FIX 2026-08-24 — see _sendPushForDoc's comment
        const name   = followerData.fullName || followerData.username || 'Someone';
        // Same round-avatar-left / square-avatar-right pairing every other
        // person-shaped push (friend-suggestion, above) already uses.
        const avatar = followerData.avatar || _uiAvatarPlaceholder(name) || logo;

        await admin.messaging().send({
            token,
            notification: {
                title: APP_NAME,
                body: `👤 ${name} started following you.`,
                ...(avatar ? { imageUrl: avatar } : {})
            },
            webpush: {
                notification: { icon: avatar, image: avatar, badge: logo, silent: false, vibrate: [200, 100, 200] },
                // Same '?post=profile-<uid>' convention app-startup.js's own
                // boot-time deep-link handler already resolves (see its
                // '^profile-' branch) — reused as-is rather than inventing a
                // new query param this app doesn't already know how to open.
                fcmOptions: domain ? { link: `${domain}/?post=${encodeURIComponent('profile-' + followerId)}` } : undefined
            },
            android: {
                priority: 'high',
                notification: {
                    ...(process.env.ANDROID_NOTIFICATION_ICON ? { icon: process.env.ANDROID_NOTIFICATION_ICON } : {}),
                    color: '#1a2b85',
                    sound: 'default'
                }
            },
            apns: { payload: { aps: { sound: 'default' } } }
        });
        console.log(`[ServerNotify] follow ${followerId} -> ${followedUserId}`);
    } catch (err) {
        console.warn('[ServerNotify] follow push failed for', followerId, '->', followedUserId, '-', err.message);
    }
}

// ── PER-USER NOTIFICATION PUSH (likes, mentions, live, SOS decisions, …) ───
// FIX (report: "users hardly get push notifications"): every per-person event
// in the client (like, mention, group_mention, live, sos_rejected, …) is a
// 'user_notifications' doc written by the browser — which only ever reached
// the in-app bell/toast of a device that already had the app OPEN. Nothing
// server-side turned those docs into an FCM push, so anyone with the app
// closed never heard about them. Follows (_watchFollows) and new
// posts/reels/news (NOTIFY_COLLECTIONS, broadcast topic) already have their
// own pushes, so those types are skipped here to avoid double-sending.
//
// Dedupe: `pushed:true` is written onto the doc before sending, so a server
// restart / listener reconnect (which replays the lookback window below) can
// never re-send. A doc already `read:true` is skipped — the open app marks
// docs read the instant it shows them, so that device already saw it live.
// The send is delayed a few seconds so that mark has time to land.
function _watchUserNotifications(admin) {
    const SKIP_TYPES = new Set(['new_follower', 'new_post', 'new_reel', 'new_news']);
    // Lookback covers phone clocks running a few minutes slow (createdAt is a
    // client-written ISO string) and a quick redeploy; `pushed` makes the
    // overlap harmless. Single-field range filter — needs no composite index.
    const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    function attach() {
        admin.firestore().collection('user_notifications')
            .where('createdAt', '>', sinceIso)
            .onSnapshot(function (snapshot) {
                snapshot.docChanges().forEach(function (change) {
                    if (change.type !== 'added') return;
                    const d = change.doc.data() || {};
                    if (!d.userId || !d.message) return;
                    if (d.pushed === true || d.read === true) return;
                    if (SKIP_TYPES.has(d.type)) return;
                    if (d.fromUserId && d.fromUserId === d.userId) return;
                    const ref = change.doc.ref;
                    setTimeout(function () { _sendUserNotificationPush(admin, ref); }, 6000);
                });
            }, function (err) {
                console.warn('[ServerNotify] listener error on user_notifications:', err.message, '— reconnecting in 5s');
                setTimeout(attach, 5000);
            });
    }
    attach();
}

async function _sendUserNotificationPush(admin, ref) {
    try {
        const snap = await ref.get();
        if (!snap.exists) return;
        const n = snap.data() || {};
        if (n.pushed === true || n.read === true) return;

        const userRef = admin.firestore().collection('users').doc(String(n.userId));
        const userSnap = await userRef.get();
        const ud = userSnap.exists ? (userSnap.data() || {}) : {};
        const tokens = Array.from(new Set(
            [ud.fcmToken].concat(Array.isArray(ud.fcmTokens) ? ud.fcmTokens : [])
                .filter(function (t) { return typeof t === 'string' && t; })
        ));

        // Claim before sending — see dedupe note above.
        await ref.update({ pushed: true });
        if (!tokens.length) return; // recipient never registered a device for push

        const domain = _appDomain();
        const logo   = domain ? domain + '/icon-192.png' : '';
        const img    = (typeof n.thumb === 'string' && /^https:\/\//i.test(n.thumb)) ? n.thumb : logo;
        let link = domain || '';
        if (domain && n.postId) link = domain + '/?post=' + encodeURIComponent(n.postId);

        const wpNotif = { silent: false, vibrate: [200, 100, 200] };
        if (logo) { wpNotif.icon = logo; wpNotif.badge = logo; }
        if (img)  { wpNotif.image = img; }
        const webpush = { notification: wpNotif };
        if (link) webpush.fcmOptions = { link: link };

        const res = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: Object.assign({ title: APP_NAME, body: String(n.message).slice(0, 200) }, img ? { imageUrl: img } : {}),
            webpush,
            android: { priority: 'high', notification: { color: '#1a2b85', sound: 'default' } },
            apns: { payload: { aps: { sound: 'default' } } }
        });

        // Prune tokens FCM says are dead so they don't accumulate.
        const dead = [];
        res.responses.forEach(function (r, i) {
            const code = r && r.error && r.error.code || '';
            if (!r.success && /registration-token-not-registered|invalid-registration-token/.test(code)) dead.push(tokens[i]);
        });
        if (dead.length) {
            const FV = admin.firestore.FieldValue;
            const upd = { fcmTokens: FV.arrayRemove.apply(FV, dead) };
            if (dead.indexOf(ud.fcmToken) !== -1) upd.fcmToken = FV.delete();
            await userRef.update(upd).catch(function () {});
        }
        console.log('[ServerNotify] user_notification ' + (n.type || '?') + ' -> ' + n.userId + ' (' + res.successCount + '/' + tokens.length + ' devices)');
    } catch (err) {
        console.warn('[ServerNotify] user_notification push failed:', err.message);
    }
}

// ── SCHEDULED-STREAM REMINDERS (v58 follow-up) ────────────────────────────
// v58's own client-side code (now merged into app-patch-v42.js — see that
// file's own header for the merge/renumbering note) deliberately
// shipped reminders through the in-app bell only, flagging true FCM push as
// a follow-up once /api/notify's contract was known — it's known now (see
// /api/notify above), so this wires the real thing.
//
// Why POLLING on an interval, not onSnapshot like NOTIFY_COLLECTIONS above:
// every other listener in this file fires on a DISCRETE EVENT ("a doc was
// just added"). A reminder fires when a CLOCK reaches a point relative to
// a field already sitting quietly in an existing doc — nothing changes in
// Firestore at the moment a reminder becomes due, so there's no snapshot
// event to hook. Polling once a minute (same cadence the client's own
// _checkReminders already uses) is the correct tool here, not a
// workaround.
//
// DEDUPE: unlike the client's own localStorage-based dedupe (which is
// necessarily per-device), this has to be per-DOCUMENT, because it's the
// one place that pushes to every recipient at once — a Firestore field
// (`reminder15Sent: true`) written back onto the scheduled_streams doc
// itself after sending is the natural place for that, and it means a
// server restart mid-window can never double-send: the field survives
// the restart even though the in-memory poll loop doesn't.
//
// TARGETING NOTE: this reads fcmToken off users/{uid} docs, populated by
// app-push-setup.js's _subscribeToken() passing uid to /api/fcm/subscribe
// (see that route's own comment above) whenever a real logged-in identity
// is available. A user who hasn't opened the app since this shipped, or
// who's only ever used it as a guest, simply has no fcmToken yet —
// admin.messaging().send() then has nothing to send to, and this no-ops
// for that one uid without throwing or blocking any other recipient/
// listener in this file.
async function _sendReminderPush(admin, uid, streamDoc) {
    if (!uid) return false;
    try {
        const userSnap = await admin.firestore().collection('users').doc(String(uid)).get();
        const token = userSnap.exists && userSnap.data() ? userSnap.data().fcmToken : null;
        if (!token) return false;
        const domain = _appDomain();
        await admin.messaging().send({
            token,
            notification: {
                title: APP_NAME,
                body: `"${streamDoc.title || 'A live stream'}" starts in about 15 minutes.`
            },
            webpush: {
                notification: { icon: domain ? domain + '/icon-192.png' : '', badge: domain ? domain + '/icon-192.png' : '' }, // FIX 2026-08-24 — see _sendPushForDoc's comment
                fcmOptions: domain ? { link: `${domain}/?live=${encodeURIComponent(streamDoc.id || '')}` } : undefined
            },
            android: { priority: 'high', notification: { color: '#1a2b85' } },
            apns: { payload: { aps: { sound: 'default' } } }
        });
        return true;
    } catch (err) {
        // A single bad/expired token (e.g. user uninstalled, token
        // rotated) must never take down the batch for every other
        // recipient of the same reminder — log and move to the next uid.
        console.warn('[ScheduledReminder] push failed for uid', uid, '-', err.message);
        return false;
    }
}

async function _checkScheduledStreamReminders(admin) {
    try {
        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        const soonIso = new Date(now + 16 * 60 * 1000).toISOString(); // same 16-min catch window as the client's own poll
        const snap = await admin.firestore().collection('scheduled_streams')
            .where('scheduledFor', '>=', nowIso)
            .where('scheduledFor', '<=', soonIso)
            .get();
        if (snap.empty) return;

        for (const doc of snap.docs) {
            const d = doc.data() || {};
            if (d.reminder15Sent) continue; // already handled this doc's 15-min window

            const recipients = new Set();
            if (d.hostId) recipients.add(d.hostId);
            if (Array.isArray(d.remindMe)) d.remindMe.forEach(uid => uid && recipients.add(uid));
            if (recipients.size === 0) continue;

            let sentAny = false;
            for (const uid of recipients) {
                const ok = await _sendReminderPush(admin, uid, d);
                sentAny = sentAny || ok;
            }
            // Mark handled regardless of whether any token was actually
            // found — a doc with zero resolvable tokens right now would
            // otherwise be re-queried and re-attempted every 60s for its
            // entire 16-minute window for no reason; this is the same
            // "mark as handled once processed" discipline
            // _watchStatuses/_watchCollection already use for their own
            // dedupe, just field-based instead of Map-based since this
            // has to survive a server restart.
            try {
                await doc.ref.set({ reminder15Sent: true, reminder15SentAt: new Date().toISOString() }, { merge: true });
            } catch (wErr) {
                console.warn('[ScheduledReminder] failed to mark', doc.id, 'as sent -', wErr.message);
            }
            if (sentAny) console.log('[ScheduledReminder]', doc.id, '-> pushed to', recipients.size, 'recipient(s)');
        }
    } catch (err) {
        console.warn('[ScheduledReminder] check failed:', err.message);
    }
}

function startScheduledStreamReminders() {
    const admin = _getAdmin();
    if (!admin) {
        console.warn('[ScheduledReminder] FIREBASE_SERVICE_ACCOUNT_JSON not set — scheduled-stream reminder watcher disabled.');
        return;
    }
    setInterval(() => _checkScheduledStreamReminders(admin), 60 * 1000);
    _checkScheduledStreamReminders(admin); // also run once immediately at boot, not just after the first 60s tick
    console.log('[ScheduledReminder] Watching scheduled_streams for reminders due in the next ~15 minutes.');
}

// ── BIRTHDAY FEATURE — daily check + follower push ────────────────────────
// FEATURE: "on the user's birthday, send a push notification to all
// followers, with 'Wish Happy Birthday' and 'Send Gift' CTAs." The birthday
// FRAME itself (auto-applied to the profile picture) is computed purely
// client-side in app-profile.js by comparing today's month-day against the
// profile owner's own dobMonthDay — it needs no server involvement, since
// it's just "is today this specific date," recomputed fresh every time
// that profile renders. The one thing that genuinely needs a server-side
// job is this: reliably firing an OFFLINE push to every follower exactly
// once, which (like the scheduled-stream reminder above) has to run even
// when nobody has the app open anywhere.
//
// QUERY STRATEGY: dobMonthDay ('MM-DD', written once at signup — see
// app-auth.js's newUser object) lets this run a cheap equality query
// instead of pulling every user doc and parsing dates client-side; matters
// once this collection has more than a handful of users. Same reasoning
// FCM_BROADCAST_TOPIC's "topic" isn't used here as followedUserIds's own
// array-contains query below.
//
// FOLLOWER LOOKUP: there's no separate reverse-index "followers" table in
// this schema — but every user doc already stores its OWN followedUserIds
// array (see app-fixes.js's follow-button handler), so
// `where('followedUserIds', 'array-contains', birthdayUserId)` finds
// exactly the set of people who follow that user, with no schema change.
//
// FREQUENCY GUARD: lastBirthdayCelebratedYear (set on the user doc itself,
// survives a server restart) — same "mark handled before acting, so a
// mid-loop restart can't double-send" discipline
// _checkScheduledStreamReminders already uses above, just per-year instead
// of per-document-window.
async function _sendBirthdayPushToFollowers(admin, birthdayUserId, d) {
    const domain = _appDomain();
    const logo   = domain ? domain + '/icon-192.png' : ''; // FIX 2026-08-24 — see _sendPushForDoc's comment
    const name   = d.fullName || d.username || 'A friend';
    const avatar = d.avatar || logo;

    let followersSnap;
    try {
        followersSnap = await admin.firestore().collection('users')
            .where('followedUserIds', 'array-contains', birthdayUserId)
            .get();
    } catch (err) {
        console.warn('[Birthday] follower lookup failed for', birthdayUserId, '-', err.message);
        return;
    }
    if (followersSnap.empty) return;

    let sentCount = 0;
    for (const followerDoc of followersSnap.docs) {
        const token = followerDoc.get('fcmToken');
        if (!token) continue; // this follower has never registered a device for push — nothing to send to, not an error
        try {
            await admin.messaging().send({
                token,
                notification: {
                    title: APP_NAME,
                    body: `🎂 It's ${name}'s birthday today! Send your wishes.`,
                    ...(avatar ? { imageUrl: avatar } : {})
                },
                webpush: {
                    notification: {
                        icon: avatar, image: avatar, badge: logo, silent: false, vibrate: [200, 100, 200],
                        // badge: status-bar/header glyph next to the app's
                        // own name — always the real Empyrean logo, a
                        // different slot from `icon` (the birthday
                        // person's own avatar).
                        // "Wish Happy Birthday" + "Send Gift" CTA buttons —
                        // handled by firebase-messaging-sw.js's
                        // notificationclick, which reads event.action and
                        // appends it to the deep link. Action buttons are a
                        // browser-support-dependent enhancement (mainly
                        // Chrome desktop/Android) — tapping the notification
                        // BODY (not a specific action button) still opens
                        // the birthday feed via fcmOptions.link below on
                        // every platform, so this degrades gracefully.
                        actions: [
                            { action: 'wish', title: '💬 Wish Happy Birthday' },
                            { action: 'gift', title: '🎁 Send Gift' }
                        ]
                    },
                    fcmOptions: domain ? { link: `${domain}/?birthday=${encodeURIComponent(birthdayUserId)}` } : undefined
                },
                android: { priority: 'high', notification: { color: '#1a2b85', sound: 'default' } },
                apns: { payload: { aps: { sound: 'default' } } },
                data: {
                    type: 'birthday',
                    birthdayUserId: birthdayUserId,
                    birthdayUserName: name
                }
            });
            sentCount++;
        } catch (err) {
            // One follower's bad/expired token must never take down the
            // batch for every other follower — same discipline
            // _sendReminderPush already uses above.
            console.warn('[Birthday] push failed for follower', followerDoc.id, '-', err.message);
        }
    }
    console.log(`[Birthday] ${birthdayUserId} (${name}) -> pushed to ${sentCount}/${followersSnap.size} follower(s)`);
}

// Self-contained HTML — deliberately NOT routed through email-templates.js.
// That module already has its own welcomeEmailTemplate()/other templates,
// but this feature only needs one new, simple, one-off layout, and every
// existing template in that file is reached through call sites elsewhere
// in this same file that this patch doesn't otherwise touch — adding a
// new export there would mean editing a file this session never opened.
// Kept as a local function instead, same "own file, own concern" pattern
// _buildVCard()/_buildQrAttachment() above already use for the welcome
// email's QR code.
//
// bannerUrl points at public/birthday-banner.jpg — a new static asset
// (added alongside the existing public/icon-192.png convention), NOT
// generated per-user, so this never depends on Cloudinary/Firestore being
// reachable to render.
function _buildBirthdayEmailHtml(name, domain) {
    const bannerUrl = domain ? domain + '/birthday-banner.jpg' : '';
    const openUrl   = domain || '#';
    const safeName  = String(name || 'there').replace(/[<>]/g, '');
    return [
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f4fa;font-family:Arial,Helvetica,sans-serif;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4fa;padding:24px 0;">',
        '<tr><td align="center">',
        '<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(10,14,39,0.08);">',
        bannerUrl ? ('<tr><td><img src="' + bannerUrl + '" alt="Happy Birthday from Empyrean" width="560" style="width:100%;display:block;"></td></tr>') : '',
        '<tr><td style="padding:32px 32px 8px;">',
        '<h1 style="margin:0 0 4px;font-size:22px;color:#1B2B8B;">Happy Birthday, ' + safeName + '! \uD83C\uDF89</h1>',
        '</td></tr>',
        '<tr><td style="padding:0 32px 24px;color:#333;font-size:15px;line-height:1.65;">',
        '<p style="margin:0 0 16px;">From all of us at Empyrean, we hope your day is filled with joy, laughter, and unforgettable moments.</p>',
        '<p style="margin:0 0 16px;">It\u2019s a privilege having you as part of our community, and we\u2019re wishing you every success and happiness in the year ahead.</p>',
        '<p style="margin:0 0 24px;">Go on and enjoy your day to the fullest \u2014 you\u2019ve earned it!</p>',
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:24px;background:#C9A66B;">',
        '<a href="' + openUrl + '" style="display:inline-block;padding:12px 28px;color:#1B2B8B;font-weight:700;text-decoration:none;font-size:14px;border-radius:24px;">Open Empyrean</a>',
        '</td></tr></table>',
        '<p style="margin:28px 0 0;color:#333;">Warm wishes,<br><strong>The Empyrean Team</strong></p>',
        '</td></tr>',
        '<tr><td style="padding:18px 32px;background:#f7f8fc;color:#8a8fa3;font-size:11px;text-align:center;">',
        'You\u2019re receiving this because it\u2019s the birthday on file for your Empyrean account.',
        '</td></tr>',
        '</table></td></tr></table></body></html>'
    ].join('');
}

// EMAIL half of the birthday feature — sent to the birthday person
// themselves (not the follower push above, which is a separate audience
// and a separate channel). Same "one follower's bad token can't take
// down the batch" discipline doesn't apply here since this is a single
// send per birthday, but a failure here still must never stop
// _sendBirthdayPushToFollowers from running for the same person, so this
// is deliberately its own try/catch, called independently below.
async function _sendBirthdayEmail(birthdayUserId, d) {
    if (!d.email) { console.warn('[Birthday] no email on file for', birthdayUserId, '- skipping birthday email.'); return; }
    try {
        const domain = _appDomain();
        const name = d.fullName || d.username || 'there';
        await emailService.sendEmail({
            to: d.email,
            subject: `\uD83C\uDF82 Happy Birthday, ${name}! \u2014 from Empyrean`,
            html: _buildBirthdayEmailHtml(name, domain)
        });
        console.log(`[Birthday] birthday email sent to ${d.email} (${birthdayUserId}).`);
    } catch (err) {
        console.warn('[Birthday] birthday email failed for', birthdayUserId, '-', err.message);
    }
}

async function _checkBirthdays(admin) {
    try {
        const now = new Date();
        const todayMonthDay = now.toISOString().slice(5, 10); // 'YYYY-MM-DD'.slice(5) === 'MM-DD', UTC
        const currentYear   = now.getUTCFullYear();

        const snap = await admin.firestore().collection('users')
            .where('dobMonthDay', '==', todayMonthDay)
            .get();
        if (snap.empty) return;

        for (const doc of snap.docs) {
            const d = doc.data() || {};
            if (d.lastBirthdayCelebratedYear === currentYear) continue; // already celebrated this year — frequency guard

            // Mark FIRST, before any push work — so an overlapping tick or
            // a restart mid-loop can never double-fire for the same
            // person. If the write itself fails, skip pushing this round
            // rather than risk a definite double-send on the next retry.
            try {
                await doc.ref.set({ lastBirthdayCelebratedYear: currentYear }, { merge: true });
            } catch (wErr) {
                console.warn('[Birthday] failed to mark', doc.id, 'as celebrated -', wErr.message);
                continue;
            }

            await _sendBirthdayPushToFollowers(admin, doc.id, d);
            // Email half — the birthday person themselves, separate
            // channel/audience from the follower push above. Its own
            // try/catch (inside _sendBirthdayEmail) so an email failure
            // (bad address, SendGrid outage, etc.) can never roll back or
            // block the push that already went out to followers.
            await _sendBirthdayEmail(doc.id, d);
        }
    } catch (err) {
        console.warn('[Birthday] check failed:', err.message);
    }
}

function startBirthdayWatcher() {
    const admin = _getAdmin();
    if (!admin) {
        console.warn('[Birthday] FIREBASE_SERVICE_ACCOUNT_JSON not set — birthday watcher disabled.');
        return;
    }
    // A birthday doesn't become "due" between checks the way a
    // 15-minutes-away stream reminder does — once a day is the actual
    // requirement, but checking every 6 hours keeps this responsive across
    // time zones (a user whose local midnight falls mid-window still gets
    // caught within a few hours) without hammering Firestore.
    setInterval(() => _checkBirthdays(admin), 6 * 60 * 60 * 1000);
    _checkBirthdays(admin); // also run once immediately at boot
    console.log('[Birthday] Watching for users whose birthday (dobMonthDay) matches today.');
}

// ── EMAIL NOTIFICATIONS (welcome / SOS / withdrawal) ──────────────────────
// Same "server listens to Firestore directly, no client tab required"
// pattern as the FCM push listeners above — a welcome/SOS/withdrawal email
// goes out even if nobody's browser is open when the triggering doc is
// written. Reuses the same _getAdmin() Firebase Admin instance; SendGrid is
// a completely separate credential (SENDGRID_API_KEY), so one being unset
// never blocks the other from working.

// Build a minimal vCard (name + Empyrean Unique ID as a NOTE field) so the
// welcome-email QR code is scannable straight into a phone's Contacts app.
function _buildVCard(fullName, uniqueId) {
    const name = String(fullName || 'Empyrean Member').replace(/[\r\n]/g, ' ');
    return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:' + name,
        'N:' + name,
        'ORG:' + APP_NAME + ' Ecosystem',
        'NOTE:Empyrean Unique ID: ' + uniqueId,
        'END:VCARD'
    ].join('\r\n');
}

// Renders the vCard as a PNG QR code and returns it as a SendGrid inline
// attachment (base64 + content_id). Returns null on failure — callers treat
// a null QR as "send the email anyway, just without the code" rather than
// blocking the whole welcome email on a QR-rendering hiccup.
async function _buildQrAttachment(fullName, uniqueId) {
    try {
        const dataUrl = await QRCode.toDataURL(_buildVCard(fullName, uniqueId), { width: 320, margin: 1 });
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const contentId = 'empyrean-qr-' + Date.now();
        return {
            cid: contentId,
            attachment: {
                content: base64,
                filename: 'empyrean-qr.png',
                type: 'image/png',
                disposition: 'inline',
                content_id: contentId
            }
        };
    } catch (err) {
        console.warn('[Email] QR code generation failed:', err.message);
        return null;
    }
}

// Matches the timezone-naive "Date & Time" style used elsewhere in the app.
function _formatEmailTimestamp(d) {
    try { return new Date(d || Date.now()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return new Date().toString(); }
}

// sos_queue / withdrawal_requests docs store userId but not email — this
// fills in email + fullName from users/{uid}, same read _fetchAuthorMeta
// already does for OGP cards above.
async function _lookupUserContact(admin, userId) {
    if (!userId) return null;
    try {
        const snap = await admin.firestore().collection('users').doc(userId).get();
        if (!snap.exists) return null;
        const u = snap.data() || {};
        return { email: u.email || '', fullName: u.fullName || u.username || 'Empyrean Member' };
    } catch (err) {
        console.warn('[Email] user lookup failed for', userId, '-', err.message);
        return null;
    }
}

// 1) WELCOME EMAIL — fires once, the moment a new users/{uid} doc is
//    created (registration). Skips the initial snapshot on boot, same
//    "only new docs after startup" guard _watchCollection uses above.
function _watchUsersForWelcomeEmail(admin) {
    let firstSnapshot = true;
    admin.firestore().collection('users')
        .onSnapshot(function (snapshot) {
            if (firstSnapshot) { firstSnapshot = false; return; }
            snapshot.docChanges().forEach(async function (change) {
                if (change.type !== 'added') return;
                const d = change.doc.data() || {};
                if (!d.email) return; // nothing to send to
                try {
                    const qr = await _buildQrAttachment(d.fullName || d.username, change.doc.id);
                    const { subject, html } = emailTemplates.welcomeEmailTemplate({
                        appName: APP_NAME,
                        logoUrl: _appDomain() ? _appDomain() + '/icon-192.png' : '',
                        fullName: d.fullName || d.username || 'Empyrean Member',
                        uniqueId: change.doc.id,
                        email: d.email,
                        bio: d.bio || '',
                        qrCid: qr ? qr.cid : ''
                    });
                    await emailService.sendEmail({
                        to: d.email, subject, html,
                        attachments: qr ? [qr.attachment] : []
                    });
                } catch (err) {
                    console.error('[Email] Welcome email failed for', change.doc.id, '-', err.message);
                }
            });
        }, function (err) {
            console.warn('[Email] listener error on users (welcome email):', err.message);
        });
}

// 2) SOS REQUEST RECEIVED — fires once, the moment a new sos_queue/{id}
//    doc is created (a fresh SOS submission, before any admin review).
function _watchSosForEmail(admin) {
    let firstSnapshot = true;
    admin.firestore().collection('sos_queue')
        .onSnapshot(function (snapshot) {
            if (firstSnapshot) { firstSnapshot = false; return; }
            snapshot.docChanges().forEach(async function (change) {
                if (change.type !== 'added') return;
                const d = change.doc.data() || {};
                try {
                    const contact = await _lookupUserContact(admin, d.userId);
                    const email = (contact && contact.email) || d.email || '';
                    if (!email) return;
                    const fullName = (contact && contact.fullName) || d.username || 'Empyrean Member';
                    const { subject, html } = emailTemplates.sosReceivedEmailTemplate({
                        appName: APP_NAME,
                        logoUrl: _appDomain() ? _appDomain() + '/icon-192.png' : '',
                        fullName,
                        requestId: change.doc.id,
                        timestamp: _formatEmailTimestamp(d.createdAt)
                    });
                    await emailService.sendEmail({ to: email, subject, html });
                } catch (err) {
                    console.error('[Email] SOS confirmation email failed for', change.doc.id, '-', err.message);
                }
            });
        }, function (err) {
            console.warn('[Email] listener error on sos_queue (SOS email):', err.message);
        });
}

// 3) WITHDRAWAL EMAILS — dynamic status (pending / processed / declined).
//    withdrawal_requests/{id} docs are created with status:'pending' by
//    app-patch-v48.js's real Firestore-backed withdrawal form, then flipped
//    to 'processed' or 'declined' by the admin approve/reject buttons (same
//    file). This one listener covers both the "added" event (pending email)
//    and "modified" events where status actually changed (processed/
//    declined email), so each of the three emails goes out exactly once, at
//    the right point in the flow — never all at once.
function _watchWithdrawalsForEmail(admin) {
    let firstSnapshot = true;
    const lastStatus = new Map(); // docId -> status as of last snapshot — so an unrelated field edit doesn't re-fire an email
    admin.firestore().collection('withdrawal_requests')
        .onSnapshot(function (snapshot) {
            snapshot.docChanges().forEach(async function (change) {
                if (change.type === 'removed') { lastStatus.delete(change.doc.id); return; }
                const d = change.doc.data() || {};
                const status = d.status || 'pending';
                const prevStatus = lastStatus.get(change.doc.id);
                lastStatus.set(change.doc.id, status);

                if (firstSnapshot) return; // skip whatever already existed at boot
                const isNew = change.type === 'added';
                const statusChanged = change.type === 'modified' && prevStatus && prevStatus !== status;
                if (!isNew && !statusChanged) return;
                if (isNew && status !== 'pending') return; // a brand-new doc always starts pending

                try {
                    const contact = await _lookupUserContact(admin, d.userId);
                    const email = (contact && contact.email) || d.email || '';
                    if (!email) return;
                    const fullName = (contact && contact.fullName) || d.username || 'Empyrean Member';
                    const { subject, html } = emailTemplates.withdrawalEmailTemplate({
                        appName: APP_NAME,
                        logoUrl: _appDomain() ? _appDomain() + '/icon-192.png' : '',
                        status,
                        fullName,
                        transactionId: change.doc.id,
                        amount: d.amount,
                        currency: d.currency || 'EMPY',
                        timestamp: _formatEmailTimestamp(d.updatedAt || d.createdAt)
                    });
                    await emailService.sendEmail({ to: email, subject, html });
                } catch (err) {
                    console.error('[Email] Withdrawal email failed for', change.doc.id, '-', err.message);
                }
            });
            firstSnapshot = false;
        }, function (err) {
            console.warn('[Email] listener error on withdrawal_requests:', err.message);
        });
}

// 4) MARKETPLACE ESCROW EMAILS — marketplace_orders/{id} docs are created
//    with status:'paid' by /api/marketplace/order/confirm above (only
//    after server-side Flutterwave verification), then flipped to
//    'released' by /api/marketplace/order/:id/confirm-receipt once the
//    buyer confirms delivery. Same added/modified-with-status-change
//    pattern as _watchWithdrawalsForEmail above: 'paid' fires BOTH the
//    seller-notified and buyer-payment-confirmation emails (two different
//    templates, two different recipients, same event); 'released' fires
//    the seller-funds-released email. lastStatus guards against an
//    unrelated field edit re-firing either email a second time.
function _watchMarketplaceOrdersForEmail(admin) {
    let firstSnapshot = true;
    const lastStatus = new Map(); // docId -> status as of last snapshot
    admin.firestore().collection('marketplace_orders')
        .onSnapshot(function (snapshot) {
            snapshot.docChanges().forEach(async function (change) {
                if (change.type === 'removed') { lastStatus.delete(change.doc.id); return; }
                const d = change.doc.data() || {};
                const status = d.status || 'paid';
                const prevStatus = lastStatus.get(change.doc.id);
                lastStatus.set(change.doc.id, status);

                if (firstSnapshot) return; // skip whatever already existed at boot
                const isNewPaid = change.type === 'added' && status === 'paid';
                const releasedNow = change.type === 'modified' && prevStatus && prevStatus !== status && status === 'released';
                if (!isNewPaid && !releasedNow) return;

                try {
                    const timestamp = _formatEmailTimestamp(d.updatedAt || d.createdAt);
                    const logoUrl = _appDomain() ? _appDomain() + '/icon-192.png' : '';

                    if (isNewPaid) {
                        const sellerContact = await _lookupUserContact(admin, d.sellerId);
                        if (sellerContact && sellerContact.email) {
                            const seller = emailTemplates.escrowSellerNotifiedEmailTemplate({
                                appName: APP_NAME, logoUrl,
                                sellerName: sellerContact.fullName,
                                productTitle: d.productTitle, productId: d.productId,
                                buyerName: d.buyerName, buyerPhone: d.buyerPhone,
                                timestamp
                            });
                            await emailService.sendEmail({ to: sellerContact.email, subject: seller.subject, html: seller.html });
                        }
                        if (d.buyerEmail) {
                            const buyer = emailTemplates.escrowBuyerPaymentEmailTemplate({
                                appName: APP_NAME, logoUrl,
                                buyerName: d.buyerName,
                                productTitle: d.productTitle, productId: d.productId,
                                sellerName: (await _lookupUserContact(admin, d.sellerId) || {}).fullName || 'the seller',
                                timestamp
                            });
                            await emailService.sendEmail({ to: d.buyerEmail, subject: buyer.subject, html: buyer.html });
                        }
                    } else if (releasedNow) {
                        const sellerContact = await _lookupUserContact(admin, d.sellerId);
                        if (sellerContact && sellerContact.email) {
                            const released = emailTemplates.escrowSellerReleasedEmailTemplate({
                                appName: APP_NAME, logoUrl,
                                sellerName: sellerContact.fullName,
                                productTitle: d.productTitle, productId: d.productId,
                                buyerName: d.buyerName, buyerPhone: d.buyerPhone,
                                timestamp,
                                // All three fields are written in the SAME
                                // Firestore transaction as the status flip to
                                // 'released' (see /api/marketplace/order/:id/
                                // confirm-receipt above), so they're already
                                // present on `d` by the time this listener
                                // fires for that change.
                                creditedAmount:   typeof d.creditedAmount === 'number' ? d.creditedAmount : null,
                                creditedCurrency: d.creditedCurrency || null,
                                creditFailed:     !!d.creditFailed
                            });
                            await emailService.sendEmail({ to: sellerContact.email, subject: released.subject, html: released.html });
                        }
                    }
                } catch (err) {
                    console.error('[Email] Marketplace escrow email failed for', change.doc.id, '-', err.message);
                }
            });
            firstSnapshot = false;
        }, function (err) {
            console.warn('[Email] listener error on marketplace_orders:', err.message);
        });
}

function startServerNotifyListeners() {
    const admin = _getAdmin();
    if (!admin) {
        console.warn('[ServerNotify] FIREBASE_SERVICE_ACCOUNT_JSON not set — server-side notify listeners disabled.');
        return;
    }
    NOTIFY_COLLECTIONS.forEach(c => _watchCollection(admin, c.name, c.section));
    _watchStatuses(admin);
    _watchScholarships(admin); // 2026-09-28 — scholarship pushed from Admin Panel → FCM broadcast
    _watchNewUsersForSuggestions(admin);
    _watchFollows(admin);
    _watchUserNotifications(admin); // likes / mentions / live / SOS decisions → FCM push (was in-app bell only)
    console.log('[ServerNotify] Listening for new docs on', NOTIFY_COLLECTIONS.map(c => c.name).join(', '), '+ new items on statuses + new users (friend suggestions) + new follows');

    // Email notifications — separate credential (SendGrid) and trigger
    // semantics from the FCM push listeners above, so kept as their own
    // functions, but started from the same boot hook.
    _watchUsersForWelcomeEmail(admin);
    _watchSosForEmail(admin);
    _watchWithdrawalsForEmail(admin);
    _watchMarketplaceOrdersForEmail(admin);
    console.log('[Email] Listening for new users (welcome), sos_queue (SOS confirmation), withdrawal_requests (status updates), and marketplace_orders (escrow payment/release).');

    // Scheduled-stream reminders (v58 follow-up) — separate cadence
    // (polling, not onSnapshot) from everything above, so kept as its own
    // startup function; see that function's own header for why.
    startScheduledStreamReminders();

    // Birthday feature — same "own startup function, own polling cadence"
    // reasoning as the scheduled-stream reminders right above.
    startBirthdayWatcher();
}

// ── /api/scholarships/apply ── secure, server-verified application ────────
// (2026-09-28) app-feed.js's empyreanScholarshipRail() used to write the
// application AND bump scholarship_adverts.applicantCount straight from the
// browser, which meant Firestore rules had to let ANY signed-in member
// increment a counter on an admin-owned doc — and nothing stopped a
// tampered client from skipping the deadline / slot-full / duplicate checks.
// This does the identical transaction with the Admin SDK instead: the ID
// token is verified, the deadline is judged on the SERVER's clock (Lagos
// date), and the one-application-per-account rule is the doc id itself
// (scholarship_applications/{advertId}_{uid}, the same key the client and
// the admin applicants list already use — so nothing else has to change).
// The client tries this first and only falls back to its old direct
// transaction if this route is unreachable/unconfigured (code 'unavailable').
app.post('/api/scholarships/apply', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(503).json({ error: 'Applications are temporarily unavailable.', code: 'unavailable' });

    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'Please sign in to apply.', code: 'auth' });
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(m[1]); }
    catch (err) { return res.status(401).json({ error: 'Your session has expired — please sign in again.', code: 'auth' }); }
    if (decoded.firebase && decoded.firebase.sign_in_provider === 'anonymous') {
        return res.status(401).json({ error: 'Please sign in to your Empyrean account to apply.', code: 'auth' });
    }

    const b = req.body || {};
    const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    const advertId = clean(b.advertId, 128);
    const name  = clean(b.name, 120);
    const email = clean(b.email, 160);
    const phone = clean(b.phone, 30);
    const regNo = clean(b.regNo, 60);
    // (2026-09-29) bio-data captured by the new application form (formVersion 2, mirrors the RECTEM Google
    // Form). Older cached clients send none of these and still work exactly as before.
    const bio = {};
    if (b.formVersion === 2) {
        const surname = clean(b.surname, 60), firstName = clean(b.firstName, 80);
        const dob = clean(b.dob, 10), sex = clean(b.sex, 10), level = clean(b.level, 4), studyMode = clean(b.studyMode, 12);
        if (surname.length < 2) return res.status(400).json({ error: 'Please enter your surname.', code: 'invalid' });
        if (firstName.length < 2) return res.status(400).json({ error: 'Please enter your first name and other names.', code: 'invalid' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(Date.parse(dob)) || dob > _scholarshipTodayStr() || dob < '1920-01-01') {
            return res.status(400).json({ error: 'Please enter a valid date of birth.', code: 'invalid' });
        }
        if (sex && !['Male', 'Female'].includes(sex)) return res.status(400).json({ error: 'Invalid sex selection.', code: 'invalid' });
        if (level && !['ND', 'HND'].includes(level)) return res.status(400).json({ error: 'Please choose ND or HND.', code: 'invalid' });
        if (studyMode && !['Full-Time', 'Part-Time'].includes(studyMode)) return res.status(400).json({ error: 'Invalid study mode.', code: 'invalid' });
        if (level === 'HND' && studyMode && studyMode !== 'Full-Time') return res.status(400).json({ error: 'HND programmes are Full-Time only.', code: 'invalid' });
        Object.assign(bio, {
            surname: surname, firstName: firstName, sex: sex, dob: dob,
            state: clean(b.state, 60), province: clean(b.province, 60),
            level: level, studyMode: studyMode, course: clean(b.course, 120), formVersion: 2
        });
    }
    if (!advertId || /[\/\\]/.test(advertId)) return res.status(400).json({ error: 'Invalid scholarship.', code: 'gone' });
    if (name.length < 3) return res.status(400).json({ error: 'Please enter your full name.', code: 'invalid' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.', code: 'invalid' });
    if (phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Please enter a valid phone number.', code: 'invalid' });
    if (!regNo) return res.status(400).json({ error: 'Please enter your registration number.', code: 'invalid' });
    if (b.consent !== true) return res.status(400).json({ error: 'Please tick both confirmation boxes.', code: 'invalid' });

    const db = admin.firestore();
    const uid = decoded.uid;
    const adRef  = db.collection('scholarship_adverts').doc(advertId);
    const appRef = db.collection('scholarship_applications').doc(advertId + '_' + uid);
    const fail = (status, code, msg) => Object.assign(new Error(msg), { status, code });

    try {
        await db.runTransaction(async (tx) => {
            const adSnap  = await tx.get(adRef);
            const appSnap = await tx.get(appRef);
            if (!adSnap.exists) throw fail(410, 'gone', 'This scholarship is no longer available.');
            const ad = adSnap.data() || {};
            if (ad.active === false) throw fail(410, 'gone', 'This scholarship is no longer available.');
            if (appSnap.exists) throw fail(409, 'dup', 'You have already applied for this scholarship.');

            const today = _scholarshipTodayStr();
            const slots = Number(ad.slots) || 0, cnt = Number(ad.applicantCount) || 0;
            if (ad.startDate && today < ad.startDate) throw fail(403, 'soon', 'Applications have not opened yet.');
            if (ad.endDate && today > ad.endDate)     throw fail(403, 'closed', 'Applications for this scholarship have closed.');
            if (slots > 0 && cnt >= slots)            throw fail(403, 'full', 'We apologise — all scholarship slots have been filled.');

            // RECTEM adverts need the admission details (ND/HND, study mode, course) — enforced here, not just in the form
            if (b.formVersion === 2 && /rectem/i.test(String(ad.institution || ''))) {
                if (!bio.level || !bio.studyMode || !bio.course) throw fail(400, 'invalid', 'Please choose ND or HND, your study mode and your intended course.');
                if (bio.level === 'HND' && bio.studyMode !== 'Full-Time') throw fail(400, 'invalid', 'HND programmes are Full-Time only.');
            }
            tx.set(appRef, Object.assign({
                advertId: advertId, advertTitle: ad.title || '', userId: uid,
                name: name, email: email, phone: phone, regNo: regNo,
                via: 'server', createdAt: admin.firestore.FieldValue.serverTimestamp()
            }, bio));
            tx.update(adRef, { applicantCount: cnt + 1 });
        });
        res.json({ ok: true });
    } catch (err) {
        if (!err.status) console.error('[Scholarship] apply failed:', err.message);
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not submit your application — please try again.', code: err.code || 'error' });
    }
});

// ── /api/fcm/subscribe ── Register a device's FCM token for broadcasts ───
// Called by the client (see app-push-setup.js) right after it obtains a
// Web Push token from Firebase Messaging. Subscribing server-side via the
// Admin SDK is required for web tokens — the client Firebase JS SDK has no
// subscribeToTopic() of its own, unlike the native Android/iOS SDKs.
app.post('/api/fcm/subscribe', async (req, res) => {
    // uid: OPTIONAL — added for the scheduled-stream reminder watcher
    // below (_checkScheduledStreamReminders), which needs to push a
    // targeted notification to ONE specific user (the host, or whoever
    // tapped "remind me"), not the broadcast topic every other listener in
    // this file sends to. Every existing caller of this route only ever
    // sent {token, topic} (topic-broadcast use case) and still works
    // identically — uid is additive, not required, and the topic
    // subscription below is unconditional either way, so nothing about
    // the existing contract changes for a caller that doesn't send it.
    // app-push-setup.js's _subscribeToken() now sends uid whenever a real
    // logged-in identity is available (window.userState, not a guest
    // session) — a guest or a not-yet-updated client simply omits it, and
    // this route degrades to its original topic-only behavior for that
    // request, same as before.
    const { token, topic, uid } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        return res.json({ subscribed: false, reason: 'FCM not configured' });
    }
    try {
        if (!app._firebaseAdmin) {
            const admin = require('firebase-admin');
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            // storageBucket added (2026-08) — see identical comment on the
            // /api/notify init block above; same reasoning applies here.
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
            });
            app._firebaseAdmin = admin;
        }
        await app._firebaseAdmin.messaging().subscribeToTopic([token], topic || BROADCAST_TOPIC);
        // Admin SDK write — bypasses firestore.rules entirely (this is a
        // trusted server process, not a browser client), so no rule change
        // is needed for this. merge:true so this never clobbers any other
        // field already on the user's doc.
        // SUPERSEDED (push fix): this stored ONE token per user, so signing in on
        // a second device silently cut push off on the first — and left the token
        // on the previous account's doc after a shared-device account switch.
        // Original block kept below, disabled; replacement follows it.
        if (uid) {
            try {
                const _fdb = app._firebaseAdmin.firestore();
                const _FV  = app._firebaseAdmin.firestore.FieldValue;
                await _fdb.collection('users').doc(String(uid)).set({
                    fcmToken: token,                       // latest device (kept for existing readers)
                    fcmTokens: _FV.arrayUnion(token),      // every device — read by _sendUserNotificationPush
                    fcmTokenUpdatedAt: new Date().toISOString()
                }, { merge: true });
                // A device belongs to whoever is signed in on it now: take this
                // token off any OTHER account's doc so they stop receiving this
                // person's notifications on it.
                const [_a, _b] = await Promise.all([
                    _fdb.collection('users').where('fcmToken', '==', token).get(),
                    _fdb.collection('users').where('fcmTokens', 'array-contains', token).get()
                ]);
                const _others = new Map();
                _a.forEach(function (doc) { _others.set(doc.id, doc); });
                _b.forEach(function (doc) { _others.set(doc.id, doc); });
                _others.forEach(function (doc, id) {
                    if (id === String(uid)) return;
                    const upd = { fcmTokens: _FV.arrayRemove(token) };
                    if ((doc.data() || {}).fcmToken === token) upd.fcmToken = _FV.delete();
                    doc.ref.update(upd).catch(function () {});
                });
            } catch (uErr2) {
                console.error('[FCM Subscribe] multi-device token save failed for uid', uid, '-', uErr2.message);
            }
        }
        if (false && uid) {
            try {
                await app._firebaseAdmin.firestore().collection('users').doc(String(uid))
                    .set({ fcmToken: token, fcmTokenUpdatedAt: new Date().toISOString() }, { merge: true });
            } catch (uErr) {
                console.error('[FCM Subscribe] failed to persist token for uid', uid, '-', uErr.message);
                // Don't fail the whole request over this — the topic
                // subscription above already succeeded and is the part
                // every existing caller actually depends on.
            }
        }
        res.json({ subscribed: true, topic: topic || BROADCAST_TOPIC, tokenSaved: !!uid });
    } catch (err) {
        console.error('[FCM Subscribe] error:', err.message);
        res.status(500).json({ subscribed: false, error: err.message });
    }
});

// ── /api/fcm/unsubscribe ── Mirror of the above, called on logout ────────
app.post('/api/fcm/unsubscribe', async (req, res) => {
    const { token, topic } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !app._firebaseAdmin) {
        return res.json({ unsubscribed: false, reason: 'FCM not configured' });
    }
    try {
        await app._firebaseAdmin.messaging().unsubscribeFromTopic([token], topic || BROADCAST_TOPIC);
        res.json({ unsubscribed: true });
    } catch (err) {
        console.error('[FCM Unsubscribe] error:', err.message);
        res.status(500).json({ unsubscribed: false, error: err.message });
    }
});

// Shared helper — the actual "call Flutterwave and verify a tx_ref"
// network call, factored out of /api/flw/verify below so the new
// marketplace escrow route (further down) can reuse the exact same
// server-side verification instead of duplicating this https.request
// logic a second time. Behavior/response shape is unchanged from what
// /api/flw/verify already returned before this refactor.
function _verifyFlwTxRef(txRef) {
    if (!process.env.FLW_SECRET_KEY) return Promise.reject(new Error('FLW_SECRET_KEY not configured'));
    const options = {
        hostname: 'api.flutterwave.com',
        path:     '/v3/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(txRef),
        method:   'GET',
        headers:  { Authorization: 'Bearer ' + process.env.FLW_SECRET_KEY }
    };
    return new Promise((resolve, reject) => {
        const req2 = https.request(options, r => {
            let body = '';
            r.on('data', d => body += d);
            r.on('end',  () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({ raw: body }); }
            });
        });
        req2.on('error', reject);
        req2.end();
    });
}

// ── /api/flw/verify ── Verify Flutterwave transaction (secret key stays server) ──
app.post('/api/flw/verify', async (req, res) => {
    const { txRef } = req.body;
    if (!txRef) return res.status(400).json({ error: 'txRef required' });
    if (!process.env.FLW_SECRET_KEY) return res.status(500).json({ error: 'FLW_SECRET_KEY not configured' });
    try {
        const parsed = await _verifyFlwTxRef(txRef);
        res.json(parsed);
    } catch (err) {
        res.status(502).json({ error: 'Flutterwave verification request failed', detail: err.message });
    }
});

// ── /api/wallet/confirm-purchase ── Verified card→EMPY token purchase ────
// Closes a real gap: app-tokenpurchase.js's buyEmpyWithCard() used to
// credit userState.empyBalance and write straight to Firestore from
// inside Flutterwave's own CLIENT-SIDE success callback — trusting that
// callback outright, with no server check that a payment ever happened.
// Firestore's owner-write rule (`allow write: if request.auth.uid ==
// userId`) gives every user's own client full write access to their own
// empyBalance field, so that callback could be invoked manually (browser
// console) to mint unlimited free EMPY. Every OTHER crediting pathway in
// this app already avoids that trap — marketplace escrow verifies
// server-side (see /api/marketplace/order/confirm above), the withdrawal
// queue and P2P/wallet-transfer flows use Admin-SDK-only or strictly-
// credit-only Firestore rules — this route brings token purchases to the
// same standard, reusing the exact same _verifyFlwTxRef() helper.
//
// The EMPY amount is computed HERE, server-side, from Flutterwave's own
// confirmed charged amount (flwResult.data.amount/currency) — never from
// a client-submitted empyAmount — using the same EMPY_RATE_USD (0.10) /
// USD_TO_NGN_RATE (1500) constants app-state.js already hardcodes on the
// client (kept in sync manually; there is no shared-constants module in
// this codebase, same as every other duplicated rate constant here).
//
// Idempotent via a deterministic transactions/{txRef} doc id inside a
// Firestore transaction: a retried/duplicated call for the same tx_ref
// can never credit twice, because the second attempt's tx.create() on
// an already-existing doc throws and the transaction retries/aborts
// before touching empyBalance a second time.
const EMPY_RATE_USD    = 0.10;
const USD_TO_NGN_RATE  = 1500;

app.post('/api/wallet/confirm-purchase', async (req, res) => {
    const { txRef, userId } = req.body || {};
    if (!txRef)  return res.status(400).json({ error: 'txRef required' });
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    let flwResult;
    try {
        flwResult = await _verifyFlwTxRef(txRef);
    } catch (err) {
        return res.status(502).json({ error: 'Flutterwave verification request failed', detail: err.message });
    }
    const flwStatusOk = flwResult && flwResult.status === 'success' &&
        flwResult.data && flwResult.data.status === 'successful' &&
        flwResult.data.currency === 'NGN';
    if (!flwStatusOk) {
        console.warn('[Wallet Purchase] rejected — Flutterwave did not confirm tx_ref', txRef, ':', JSON.stringify(flwResult).slice(0, 300));
        return res.status(402).json({ error: 'Payment not confirmed by Flutterwave for this tx_ref', flw: flwResult });
    }

    const amountNgn     = flwResult.data.amount || 0;
    const empyToReceive = Math.floor((amountNgn / USD_TO_NGN_RATE) / EMPY_RATE_USD);
    if (empyToReceive <= 0) {
        return res.status(400).json({ error: 'Confirmed charge amount too small to credit any EMPY.' });
    }

    try {
        const db = admin.firestore();
        const txDocRef   = db.collection('transactions').doc(txRef); // deterministic id = idempotency key
        const userRef    = db.collection('users').doc(userId);
        let newBalance;

        await db.runTransaction(async (tx) => {
            const existing = await tx.get(txDocRef);
            if (existing.exists) {
                // Already credited by a prior call for this exact tx_ref —
                // report success without crediting again.
                newBalance = null;
                return;
            }
            const userSnap = await tx.get(userRef);
            const uData = userSnap.exists ? (userSnap.data() || {}) : {};
            const prevBalance = typeof uData.empyBalance === 'number' ? uData.empyBalance : 0;
            newBalance = prevBalance + empyToReceive;

            // ADDED (Payment System Restructuring — earnings segmentation):
            // also track this credit on giftTokenBalance, the withdrawable
            // ledger the new Gifting & Tipping withdrawal tier draws from.
            // These are card-purchased tokens — per the restructuring spec,
            // "Since these tokens are purchased directly, users may
            // withdraw them" — unlike engagement-reward EMPY (rewardsBalance,
            // see claim-mining-reward/claim-rank-reward below), which stays
            // locked until official launch. empyBalance itself is UNCHANGED
            // by this addition — it remains the one general spendable
            // balance every existing flow (gifting spend, staking, P2P,
            // marketplace) already reads, so nothing about how these tokens
            // can be SPENT changes, only that this specific inflow is now
            // also tracked toward what's eligible to be withdrawn later.
            const prevGiftTokenBalance = typeof uData.giftTokenBalance === 'number' ? uData.giftTokenBalance : 0;
            const newGiftTokenBalance = prevGiftTokenBalance + empyToReceive;

            tx.set(userRef, { empyBalance: newBalance, giftTokenBalance: newGiftTokenBalance }, { merge: true });
            tx.create(txDocRef, {
                userId,
                type:       'buy_empy_card',
                amountNgn,
                empyAmount: empyToReceive,
                txRef,
                status:     'completed',
                createdAt:  admin.firestore.FieldValue.serverTimestamp()
            });
        });

        if (newBalance === null) {
            console.log('[Wallet Purchase] duplicate confirm-purchase call for tx_ref', txRef, '— already credited, no-op.');
            return res.json({ ok: true, alreadyCredited: true, empyAmount: empyToReceive });
        }
        res.json({ ok: true, empyAmount: empyToReceive, newBalance });
    } catch (err) {
        console.error('[Wallet Purchase] Firestore transaction failed:', err.message);
        res.status(500).json({ error: 'Could not credit EMPY balance', detail: err.message });
    }
});

// ── /api/promotion/confirm ── Verified Fiat-funded business promotion ──────
// ADDED (2026-08-08 — Fiat funding for business-page promotions): the
// business-campaign "Launch Campaign" modal (app-patch-v3.js) now lets a
// user pick EMPY wallet OR card/bank as the payment method, matching the
// choice app-fixes.js's post-boost finalize form already offers. This is
// the card path's landing point — mirrors /api/wallet/confirm-purchase and
// /api/marketplace/order/confirm exactly: re-verifies the SAME tx_ref
// server-side via _verifyFlwTxRef() before writing anything to Firestore,
// rather than trusting Flutterwave's client-side "successful" callback
// outright (the gap the post-boost card path's own comment flags and
// recommends closing this same way — this route is that fix, scoped to
// business campaigns specifically).
//
// dailyBudget/totalBudget are computed HERE, server-side, from
// Flutterwave's own confirmed charged amount — never from a client-
// submitted budget — using the same EMPY_RATE_USD/USD_TO_NGN_RATE
// constants already declared above for /api/wallet/confirm-purchase, so a
// manipulated request can't claim a bigger campaign than was actually paid
// for.
//
// Idempotent via a deterministic promotions/{promo-fiat-<txRef>} doc id
// inside a Firestore transaction: a retried/duplicated call for the same
// tx_ref can never create two campaigns, because the second attempt's
// tx.create() on an already-existing doc throws and the transaction
// aborts before anything is written twice.
app.post('/api/promotion/confirm', async (req, res) => {
    const { txRef, promo } = req.body || {};
    if (!txRef) return res.status(400).json({ error: 'txRef required' });
    if (!promo || typeof promo !== 'object') return res.status(400).json({ error: 'promo object required' });
    const { pageId, ownerId } = promo;
    if (!pageId)  return res.status(400).json({ error: 'promo.pageId required' });
    if (!ownerId) return res.status(400).json({ error: 'promo.ownerId required' });

    // Same bounds app-patch-v3.js's client already clamps to — enforced
    // again here since this route is the actual source of truth.
    const durationDays = Math.min(90, Math.max(1, parseInt(promo.durationDays, 10) || 0));

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    let flwResult;
    try {
        flwResult = await _verifyFlwTxRef(txRef);
    } catch (err) {
        return res.status(502).json({ error: 'Flutterwave verification request failed', detail: err.message });
    }
    const flwStatusOk = flwResult && flwResult.status === 'success' &&
        flwResult.data && flwResult.data.status === 'successful' &&
        flwResult.data.currency === 'NGN';
    if (!flwStatusOk) {
        console.warn('[BizPromo Confirm] rejected — Flutterwave did not confirm tx_ref', txRef, ':', JSON.stringify(flwResult).slice(0, 300));
        return res.status(402).json({ error: 'Payment not confirmed by Flutterwave for this tx_ref', flw: flwResult });
    }

    const amountNgn   = flwResult.data.amount || 0;
    const totalBudget = Math.floor((amountNgn / USD_TO_NGN_RATE) / EMPY_RATE_USD);
    if (totalBudget <= 0) {
        return res.status(400).json({ error: 'Confirmed charge amount too small to fund any campaign budget.' });
    }
    const dailyBudget = Math.max(1, Math.floor(totalBudget / durationDays));

    try {
        const db = admin.firestore();
        const promoRef = db.collection('promotions').doc('promo-fiat-' + txRef); // deterministic id = idempotency key
        let alreadyCreated = false;

        await db.runTransaction(async (tx) => {
            const existing = await tx.get(promoRef);
            if (existing.exists) { alreadyCreated = true; return; }
            tx.create(promoRef, {
                id: promoRef.id,
                pageId,
                pageName:     promo.pageName || '',
                ownerId,
                objective:    promo.objective || 'awareness',
                dailyBudget,
                durationDays,
                totalBudget,
                audiences:    Array.isArray(promo.audiences) ? promo.audiences : ['all'],
                cta:          promo.cta || 'learn_more',
                headline:     promo.headline || '',
                status:       'active',
                impressions:  0,
                clicks:       0,
                fundedVia:    'fiat',
                amountNgn,
                txRef,
                createdAt:    admin.firestore.FieldValue.serverTimestamp(),
                endsAt:       Date.now() + durationDays * 86400000
            });
        });

        if (alreadyCreated) {
            console.log('[BizPromo Confirm] duplicate confirm call for tx_ref', txRef, '— already created, no-op.');
            return res.json({ ok: true, alreadyCreated: true, promoId: promoRef.id });
        }
        res.json({ ok: true, promoId: promoRef.id, dailyBudget, totalBudget });
    } catch (err) {
        console.error('[BizPromo Confirm] Firestore transaction failed:', err.message);
        res.status(500).json({ error: 'Could not create campaign', detail: err.message });
    }
});

// ── /api/promotion/boost/confirm ── Verified Fiat-funded post boost ───────
// ADDED (2026-08-08): closes the exact gap app-fixes.js's own comment used
// to flag next to its post-boost card-payment FlutterwaveCheckout call —
// that path used to activate a promotion straight off Flutterwave's
// CLIENT-SIDE "successful" callback, with no server check a charge ever
// happened. Mirrors /api/promotion/confirm (business campaigns, just
// above) and /api/marketplace/order/confirm exactly: re-verifies the SAME
// tx_ref server-side via _verifyFlwTxRef() before writing anything.
//
// Separate route (and separate doc-id prefix, promo-boost-*) from
// /api/promotion/confirm rather than a shared one — the two write
// genuinely different document shapes into the same `promotions`
// collection (this one is postId/budgetNGN-keyed, matching
// app-live.js's registerPromotion() exactly; the business-campaign one is
// pageId/dailyBudget-keyed) and conflating them would risk one route's
// validation silently accepting the other shape's fields.
//
// budgetNGN is taken from Flutterwave's OWN confirmed charged amount —
// never from a client-submitted budget — so a manipulated request can't
// activate a bigger boost than was actually paid for. The doc shape below
// matches registerPromotion()'s own output field-for-field so the existing
// feed-ranking budgetScore formula (app-live.js's scorePost()) keeps
// working unchanged for fiat-funded boosts, same as it already does for
// wallet-funded ones.
//
// Idempotent via a deterministic promotions/{promo-boost-<txRef>} doc id
// inside a Firestore transaction — a retried/duplicated call for the same
// tx_ref can never activate the same payment twice.
app.post('/api/promotion/boost/confirm', async (req, res) => {
    const { txRef, postId, userId, username, targetAudience } = req.body || {};
    if (!txRef)  return res.status(400).json({ error: 'txRef required' });
    if (!postId) return res.status(400).json({ error: 'postId required' });
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const durationDays = Math.min(90, Math.max(1, parseInt(req.body && req.body.durationDays, 10) || 0));

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    let flwResult;
    try {
        flwResult = await _verifyFlwTxRef(txRef);
    } catch (err) {
        return res.status(502).json({ error: 'Flutterwave verification request failed', detail: err.message });
    }
    const flwStatusOk = flwResult && flwResult.status === 'success' &&
        flwResult.data && flwResult.data.status === 'successful' &&
        flwResult.data.currency === 'NGN';
    if (!flwStatusOk) {
        console.warn('[PostBoost Confirm] rejected — Flutterwave did not confirm tx_ref', txRef, ':', JSON.stringify(flwResult).slice(0, 300));
        return res.status(402).json({ error: 'Payment not confirmed by Flutterwave for this tx_ref', flw: flwResult });
    }

    const budgetNGN = flwResult.data.amount || 0;
    if (budgetNGN <= 0) {
        return res.status(400).json({ error: 'Confirmed charge amount too small to fund a boost.' });
    }

    try {
        const db = admin.firestore();
        const promoRef = db.collection('promotions').doc('promo-boost-' + txRef); // deterministic id = idempotency key
        let alreadyCreated = false;

        await db.runTransaction(async (tx) => {
            const existing = await tx.get(promoRef);
            if (existing.exists) { alreadyCreated = true; return; }
            tx.create(promoRef, {
                id:                promoRef.id,
                postId,
                budgetNGN,
                budgetRemaining:   budgetNGN,
                targetAudience:    targetAudience || 'all',
                durationDays,
                startTime:         Date.now(),
                endTime:           Date.now() + durationDays * 86400000,
                impressions:       0,
                clicks:            0,
                costPerImpression: Math.max(0.5, budgetNGN / 10000),
                active:            true,
                fundedVia:         'fiat',
                txRef,
                userId,
                username:          username || '',
                createdAt:         admin.firestore.FieldValue.serverTimestamp()
            });
        });

        if (alreadyCreated) {
            console.log('[PostBoost Confirm] duplicate confirm call for tx_ref', txRef, '— already created, no-op.');
            return res.json({ ok: true, alreadyCreated: true, promoId: promoRef.id });
        }
        res.json({ ok: true, promoId: promoRef.id, budgetNGN });
    } catch (err) {
        console.error('[PostBoost Confirm] Firestore transaction failed:', err.message);
        res.status(500).json({ error: 'Could not activate boost', detail: err.message });
    }
});


// =============================================================================
// BACKGROUND: firebase-rules.js's isEmpyBalanceCreditOnlyUpdate/
// isLiveIncomeOnlyUpdate rules cap and direction-check CROSS-user credit
// writes, but the general owner rule further down (`allow write: if
// request.auth.uid == userId`) still let a signed-in client write ANY value
// into its OWN empyBalance directly — no cap, no direction check — because
// that rule doesn't scope which fields it covers. That's the actual "type
// one command in devtools, become a billionaire" hole, and every legitimate
// self-credit flow in the app (rank rewards, impact-mining task/action
// rewards, P2P listing-cancel refunds) was ALSO relying on that same
// unrestricted rule to write its own reward locally. Closing the hole and
// keeping those features working can't be done in firebase-rules.js alone
// — it means moving the actual crediting to server-side Admin SDK writes
// (which bypass client rules entirely and can enforce real business logic:
// reward tables, one-time-only checks, daily pool budgets) and then, only
// once that's done, tightening the client rule so it can no longer
// INCREASE its own empyBalance directly at all (see the matching
// firebase-rules.js diff shipped alongside this file — isSelfEmpyBalanceSafe).
// Decreases (spending EMPY on a gift, staking, listing something for sale,
// a wallet transfer send, etc.) are untouched — those are safe to leave
// client-writable and are not part of this migration.
//
// Auth/trust model: matches this codebase's existing convention for
// user-level (non-admin) money routes — see confirm-receipt/mark-dispatched
// above, which trust a client-supplied id checked against the field
// actually stored on the target document, rather than a bearer ID token.
// These five routes follow the same pattern; none of them trust a
// client-supplied REWARD AMOUNT, only a client-supplied identity, which is
// then checked against server-held state before anything is credited.
//
// CLIENT WIRING STATUS (2026-07-31, completion pass): all five routes above
// now have their client call sites migrated too — app-fixes.js's rank-
// reward and community-task claims, app-impactmining.js's _processReward
// (the 5 non-premium self-mining actions: SUCCESSFUL_ESCROW_SELLER/BUYER,
// SHARE_POST, RETWEET_POST, SEND_GIFT — see that file's own comment for why
// the 9 PREMIUM 60/40-split actions are NOT migrated here), and
// app-p2p-trading.js's _p2pCancelListing/_p2pReleaseEscrow. app-wallet.js's
// buy-empy-form (Flutterwave card purchase) was also found to be
// self-crediting directly from its own client-side payment callback — not
// one of the original five, but the same class of bug — and is now wired to
// this file's existing /api/wallet/confirm-purchase instead.
//
// STAKING — NOW BUILT (2026-07-31, follow-up to the completion pass above).
// app-wallet.js's stake-form/unstake-form/claim-reward-btn and
// simulateRewardAccrual()'s locked-staking release used to run on pure
// client-side numbers (manualStakedBalance/lockedStakedBalance/
// earnedRewards) with no Firestore-backed ledger at all — except the claim
// itself, which DID persist straight to empyBalance via a direct client
// write once tapped, from a client-computed "earned" figure a user could
// set to anything via devtools first. That's now closed: users/{userId}
// gains five new server-only fields (manualStakedBalance,
// lockedStakedBalance, lockedStakingEndTime, stakingEarnedRewards,
// stakingLastAccrualAt), computeStakingAccrual() below is the ONLY thing
// that ever advances stakingEarnedRewards or releases a matured lock, and
// four new endpoints (/api/staking/stake, /unstake, /claim-rewards, /sync)
// are the ONLY way any of those five fields change — see
// firebase-rules.js's touchesServerOnlyStakingFields, which blocks the
// client from writing any of them directly, same as empyBalance increases.
//
// STILL NOT covered by this: the 9 PREMIUM 60/40-split impact-mining
// actions (CREATE_POST, CREATE_REEL, PUBLISH_NEWS, LIVE_STREAM_INTERVAL,
// VERIFIED_CRISIS_REPORT, VERIFIED_SOS_REQUEST, SUCCESSFUL_REFERRAL,
// GUEST_JOINED_LIVE, HOST_INVITED_GUEST) still self-credit their 60%
// withdrawable portion via a direct client write, and their 40% locked
// portion was never persisted anywhere (see app-impactmining.js's own
// comment). Now that lockedStakedBalance/lockedStakingEndTime exist and
// are real, wiring those 9 actions to deposit their 40% here too — and
// crediting their 60% via claim-mining-reward instead of direct-write — is
// the natural next step, but is its own scoped change (needs
// claim-mining-reward to support a split credit), not bundled into this
// one. Because those 9 actions still self-credit directly,
// firebase-rules.js's general owner-write rule remains the CAPPED
// mitigation (isSelfEmpyBalanceNonIncreasing), not an outright ban — see
// that function's own comment.

// Mirrors app-state.js's own STAKING_APY_ESTIMATE / STAKING_LOCK_DURATION —
// the ONLY values used to compute a staking reward or a lock window
// server-side; the client never gets to submit its own accrual number or
// its own lock end time.
const STAKING_APY_ESTIMATE  = 0.157; // 15.7 %, matches the staking UI's own label
const STAKING_LOCK_DURATION = 6 * 30 * 24 * 60 * 60 * 1000; // 6 months — for the day a locked deposit is created here too (see comment above)

// Recomputes a user's staking fields up to `now` from their currently
// stored doc — a pure function, no I/O, so every staking endpoint below
// calls it right after its own transaction's read and before applying
// whatever action-specific delta (stake/unstake/claim) it's handling.
// Two things happen here, independent of which endpoint called it:
//   1. Continuous APY accrual on manualStakedBalance, added to
//      stakingEarnedRewards (uncapped — it keeps growing until claimed,
//      same as the old client-side simulateRewardAccrual did).
//   2. Auto-release of lockedStakedBalance into empyBalance once
//      lockedStakingEndTime has passed (mirrors that same function's old
//      client-side auto-release — now happens here, the moment ANY
//      staking endpoint is next called, instead of on a client-side
//      per-second timer with no server involved at all).
// Nothing currently WRITES lockedStakedBalance for any user (the premium
// impact-mining reward's 40% lock split is still on the old
// client-authoritative direct-write path — see the SELF_MINING_ACTIONS
// comment above) — this function is already correct for the day that
// split gets migrated here too.
function computeStakingAccrual(u, now) {
    const manualStaked  = Number(u.manualStakedBalance || 0);
    const lastAccrualAt = Number(u.stakingLastAccrualAt || now);
    const elapsedMs     = Math.max(0, now - lastAccrualAt);

    let earned = Number(u.stakingEarnedRewards || 0);
    if (manualStaked > 0 && elapsedMs > 0) {
        const elapsedYears = elapsedMs / (365 * 24 * 60 * 60 * 1000);
        earned += manualStaked * STAKING_APY_ESTIMATE * elapsedYears;
    }

    let lockedStaked = Number(u.lockedStakedBalance || 0);
    let lockEnd      = Number(u.lockedStakingEndTime || 0);
    let releasedLock = 0;
    if (lockedStaked > 0 && lockEnd > 0 && now >= lockEnd) {
        releasedLock = lockedStaked;
        lockedStaked = 0;
        lockEnd = 0;
    }

    return {
        manualStakedBalance:  manualStaked,
        stakingEarnedRewards: earned,
        lockedStakedBalance:  lockedStaked,
        lockedStakingEndTime: lockEnd,
        stakingLastAccrualAt: now,
        releasedLock:         releasedLock
    };
}

// REDUCED (2026-08-15 — token-allocation review): mirrors app-wallet.js's
// now-reduced canonical RANKS list exactly (that file is the single source
// of truth on the client; app-profile.js's display copy and this server
// table must both stay identical to it). Old amounts were 10x these — see
// app-wallet.js's own RANKS comment for the full reconciliation note (this
// server table, app-wallet.js, and app-profile.js had all drifted apart
// before this pass).
const RANKS = [
    { id: 'rank-1', followers: 500,     reward: 5 },
    { id: 'rank-2', followers: 1000,    reward: 10 },
    { id: 'rank-3', followers: 5000,    reward: 25 },
    { id: 'rank-4', followers: 10000,   reward: 50 },
    { id: 'rank-5', followers: 50000,   reward: 100 },
    { id: 'rank-6', followers: 100000,  reward: 250 },
    { id: 'rank-7', followers: 250000,  reward: 500 },
    { id: 'rank-8', followers: 500000,  reward: 1000 },
    { id: 'rank-9', followers: 1000000, reward: 2500 }
];
// Mirrors app-state.js's own RANKING_REWARDS_POOL (IMPACT_MINING_TOTAL_POOL * 0.10).
// REDUCED (2026-08-15): pool cut 37,500,000 -> 35,000,000 EMPY total.
const RANKING_REWARDS_POOL = 35000000 * 0.10;

// Mirrors app-fixes.js's own mockCommunityTasks (line ~380) — the ONLY
// place task ids/rewards are defined; the client's data-reward attribute
// is never trusted here.
const COMMUNITY_TASKS = {
    'task-1': 5,
    'task-2': 5,
    'task-3': 10,
    'task-4': 8,
    'task-5': 10,
    'task-6': 10,
    // ADDED (2026-10-09): Facebook + two TikTok accounts — must match
    // app-state.js's mockCommunityTasks ids/rewards exactly.
    'task-7': 5,   // Follow on Facebook
    'task-8': 5,   // Follow on TikTok (@empyreanapp)
    'task-9': 5    // Follow @alexicographer9 on TikTok
};

// Mirrors app-helper.js's own rewardUserForAction() rewardsTable, SELF-
// TARGET ACTIONS ONLY (the caller is rewarded for something the caller
// itself just did). ENGAGE_LIKE / ENGAGE_COMMENT are exactly that kind of
// claim — "I just liked/commented, pay ME" — same trust model as
// CREATE_POST, so they belong here. RECEIVE_LIKE / RECEIVE_COMMENT are
// RETIRED (2026-08-15) and deliberately absent from this table: those used
// to credit a DIFFERENT user than the caller based solely on the caller's
// say-so ("I liked/commented on this post, so pay its owner") — that's
// exactly as forgeable server-side as it was client-side unless the server
// can independently verify the like/comment actually happened. That's what
// startLikeCommentRewardListeners() further down this file used to do (an
// Admin-SDK Firestore listener, not a client claim), but the whole feature
// is now retired regardless of forgeability — see RECEIVE_MINING_ACTIONS'
// own comment for why receiving engagement moved to app-monetization.js
// instead of paying out of the mining pool a second time. SEND_GIFT, unlike
// RECEIVE_LIKE/RECEIVE_COMMENT, rewards the SENDER for their own action
// (not a claim about someone else), so it's safe to include here alongside
// the rest of the self-target set.
// UPDATED (2026-08-15 — official launch forecast): entries marked FORECAST
// now use the exact values from the launch reward-allocation forecast —
// mirrors app-impactmining.js's own REWARD_TABLE for the same actions
// exactly (see that file's own comment for the full mapping). Actions NOT
// in the forecast list keep their prior (already-reduced, provisional)
// rate from the previous pass, flagged individually below. Old amounts
// left as inline comments for anyone diffing against earlier deploys.
const SELF_MINING_ACTIONS = {
    VERIFIED_CRISIS_REPORT:   0.025,  // FORECAST — was 12 / 50
    VERIFIED_SOS_REQUEST:     0.015,  // FORECAST — was 6 / 25
    SUCCESSFUL_ESCROW_SELLER: 0.0075, // FORECAST — was 4 / 15
    SUCCESSFUL_ESCROW_BUYER:  0.005,  // FORECAST — was 1.5 / 5
    CREATE_REEL:              0.004,  // FORECAST — was 0.4 / 2.0
    CREATE_POST:              0.0025, // FORECAST — was 0.2 / 1.0
    PUBLISH_NEWS:             2.5,    // not in forecast — provisional, unchanged
    LIVE_STREAM_INTERVAL:     0.25,   // not in forecast — provisional, unchanged
    SUCCESSFUL_REFERRAL:      1,      // FORECAST — was 5 / 20
    SHARE_POST:               0.001,  // FORECAST — was 0.1 / 0.5 — "Share/Retweet"
    RETWEET_POST:             0.001,  // FORECAST — was 0.1 / 0.5 — "Share/Retweet"
    GUEST_JOINED_LIVE:        1,      // not in forecast — provisional, unchanged
    HOST_INVITED_GUEST:       0.4,    // not in forecast — provisional, unchanged
    SEND_GIFT:                0.02,   // not in forecast — provisional, unchanged
    // NEW (2026-08-15 — engagement-attribution fix): FORECAST "Receive a
    // Like/Comment" rate (0.0005), now correctly self-target — this pays
    // the person DOING the liking/commenting, not the post/comment owner.
    // Moved here from RECEIVE_MINING_ACTIONS below (which used to pay the
    // owner instead) — see that table's own RETIRED note for the full
    // reasoning, and app-impactmining.js's matching header note.
    ENGAGE_LIKE:              0.0005, // FORECAST — combined "Receive a Like/Comment" rate, now paid to the engager
    ENGAGE_COMMENT:           0.0005  // FORECAST — combined "Receive a Like/Comment" rate, now paid to the engager
};

// NEW (2026-08-15 — official launch forecast, "Receive a Like/Comment"
// line item): unlike everything in SELF_MINING_ACTIONS above, these two
// credit a DIFFERENT user than whoever triggered the underlying action —
// the post/comment OWNER, not the person liking/commenting. That's exactly
// why they were never in SELF_MINING_ACTIONS (see the comment on that
// table) — a client claiming "I liked this post, pay its owner" can't be
// trusted the same way a client claiming "I just created a post, pay ME"
// can (the latter is at least verifiable as "did this account's own write
// succeed"; the former requires trusting an unverifiable third-party
// claim). Instead of a client-called claim endpoint, these are credited
// automatically by startLikeCommentRewardListeners() below, which watches
// Firestore directly via the Admin SDK for a like/comment that ACTUALLY
// happened (a likedBy array gaining a new uid, confirmed by Firestore's
// own isToggleField/isOneTimeField-gated write rules — see
// firebase-rules.js — so this can't be forged by a client either) and
// credits the real owner the moment it's observed. See _creditReceiveReward
// and the listener functions further down this file.
// RETIRED (2026-08-15 — engagement-attribution fix): this used to pay the
// post/comment OWNER every time someone else liked/commented on their
// content. Two problems with that: (1) wrong side of the interaction — the
// owner already earns EMPY for the act of posting (CREATE_POST/CREATE_REEL
// in SELF_MINING_ACTIONS above); the "Receive a Like/Comment" forecast rate
// belongs to whoever performs the like/comment, not whoever receives it a
// second time — that's now ENGAGE_LIKE/ENGAGE_COMMENT in SELF_MINING_ACTIONS
// above. (2) receiving engagement is a creator-monetization concern, not an
// impact-mining one — app-monetization.js's computeEngagement() already
// reads a creator's total likes/commentCount/shareCount straight off their
// posts to gate their payout tier/eligibility, so a creator already gets
// real payout upside from receiving likes/comments through that system.
// Paying it again here, per-event, out of the mining pool was duplicate
// credit through the wrong channel. Left as an empty object (not deleted)
// per this codebase's own convention, and because _creditReceiveReward
// below still references it defensively — see startLikeCommentRewardListeners()
// further down, now retired to a no-op for the same reason.
const RECEIVE_MINING_ACTIONS = {};
// REDUCED (2026-08-15): pool cut 37,500,000 -> 35,000,000 EMPY, spread over
// MINING_POOL_YEARS (10, was an implicit 12) — mirrors app-state.js's own
// IMPACT_MINING_TOTAL_POOL / MINING_POOL_YEARS exactly.
const IMPACT_MINING_DAILY_BUDGET = (35000000 * 0.90) / (10 * 365.25);

// NEW (2026-08-15 — token-allocation review): per-USER daily earning cap,
// mirrors app-state.js's own DAILY_USER_EMPY_CAP. Previously the only
// throttle claim-mining-reward enforced was the shared, platform-wide
// IMPACT_MINING_DAILY_BUDGET above — nothing stopped one account from
// claiming most of a day's entire budget by itself before anyone else got
// a turn (the client-side per-user cap added to app-impactmining.js this
// same review is a localStorage guard only, easily bypassed by clearing
// storage or switching devices — this is the real, unbypassable
// enforcement). Tracked in its own per-user-per-day doc (NOT a field on
// the shared daily budget doc) so concurrent claims from different users
// don't contend on the same document.
const DAILY_USER_EMPY_CAP = 15;

// FIX (2026-07-31 — premium split follow-up): mirrors app-impactmining.js's
// own PREMIUM_ACTIONS set, restricted to the subset that's ALSO a
// self-target action above. ENGAGE_LIKE/ENGAGE_COMMENT (added 2026-08-15)
// are self-target but deliberately NOT in this set — like every other
// "Social engagement (sent)" action in app-impactmining.js's REWARD_TABLE,
// they go straight to withdrawable balance, no 60/40 lock split. For every
// action in this set,
// claim-mining-reward below splits the SELF_MINING_ACTIONS amount 60%
// straight to empyBalance / 40% into lockedStakedBalance (unlocking
// STAKING_LOCK_DURATION from now, via the same computeStakingAccrual()
// staking uses — see its own comment) instead of crediting the full
// amount to empyBalance outright. This is what let firebase-rules.js's
// general owner-write rule finally go from "capped mitigation" to an
// outright ban on client self-increases: every action that used to
// self-credit directly is now on one of these two paths.
const PREMIUM_MINING_ACTIONS = new Set([
    'VERIFIED_CRISIS_REPORT', 'VERIFIED_SOS_REQUEST', 'CREATE_REEL',
    'CREATE_POST', 'PUBLISH_NEWS', 'LIVE_STREAM_INTERVAL',
    'SUCCESSFUL_REFERRAL', 'GUEST_JOINED_LIVE', 'HOST_INVITED_GUEST'
]);

function _dayKey() { return new Date().toISOString().slice(0, 10); } // UTC calendar day, e.g. "2026-07-31"

// ── /api/wallet/claim-rank-reward ── one-time reward when a user's follower
// count first crosses a rank threshold (app-fixes.js's checkAndAwardRank).
// Recomputes eligibility from the user's OWN stored followerCount/
// awardedRanks — never trusts a client-submitted reward amount — and
// enforces the shared RANKING_REWARDS_POOL budget with a transaction
// against one global counter doc, so concurrent claims across different
// users can't collectively overspend the pool.
app.post('/api/wallet/claim-rank-reward', async (req, res) => {
    const { userId, rankId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const rank = RANKS.find(r => r.id === rankId);
    if (!rank) return res.status(400).json({ error: 'Unknown rankId' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const userRef  = db.collection('users').doc(userId);
        const poolRef  = db.collection('impact_mining_state').doc('ranking_pool');

        const result = await db.runTransaction(async (tx) => {
            const [userSnap, poolSnap] = await Promise.all([tx.get(userRef), tx.get(poolRef)]);
            if (!userSnap.exists) return { code: 404, body: { error: 'User not found' } };
            const u = userSnap.data() || {};
            const followerCount = Number(u.followerCount || 0);
            const awardedRanks  = Array.isArray(u.awardedRanks) ? u.awardedRanks : [];

            if (followerCount < rank.followers) {
                return { code: 400, body: { error: 'Follower count does not yet meet this rank\u2019s threshold' } };
            }
            if (awardedRanks.includes(rank.id)) {
                return { code: 200, body: { ok: true, alreadyAwarded: true } };
            }
            const spentSoFar = poolSnap.exists ? Number(poolSnap.data().spent || 0) : 0;
            if (spentSoFar + rank.reward > RANKING_REWARDS_POOL) {
                return { code: 409, body: { error: 'The ranking rewards pool has been exhausted.' } };
            }

            const prevBalance = Number(u.empyBalance || 0);
            // ADDED (Payment System Restructuring — earnings segmentation):
            // rank rewards are engagement-driven (the "Rewards System,
            // formerly Impact Mining" segment), so also track them on
            // rewardsBalance — the ledger the launch-gated Rewards
            // withdrawal checks — same additive pattern as
            // claim-mining-reward below. empyBalance is unaffected: this
            // reward still spends exactly as it always has.
            const prevRewardsBalance = Number(u.rewardsBalance || 0);
            tx.update(userRef, {
                empyBalance:    prevBalance + rank.reward,
                rewardsBalance: prevRewardsBalance + rank.reward,
                awardedRanks:   admin.firestore.FieldValue.arrayUnion(rank.id)
            });
            tx.set(poolRef, { spent: spentSoFar + rank.reward }, { merge: true });
            tx.set(db.collection('transactions').doc(), {
                userId, type: 'rank_reward', rankId: rank.id, amount: rank.reward,
                status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { code: 200, body: { ok: true, amount: rank.reward, newBalance: prevBalance + rank.reward } };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Rank Reward] failed:', err.message);
        res.status(500).json({ error: 'Could not credit rank reward', detail: err.message });
    }
});

// ── /api/wallet/claim-mining-reward ── impact-mining reward for a self-
// triggered action (app-helper.js's rewardUserForAction, self-target
// subset only — see SELF_MINING_ACTIONS comment above). Daily pool budget
// is tracked in one doc per UTC day so concurrent claims across every user
// on the platform share one real, transactionally-enforced cap, instead of
// each browser tab tracking its own local copy of the budget (the previous
// design, which meant the cap was never actually shared across users).
//
// FIX (2026-07-31 — premium split): PREMIUM_MINING_ACTIONS (above) now
// split their reward 60% empyBalance / 40% lockedStakedBalance instead of
// crediting the full amount straight to empyBalance — mirrors
// app-impactmining.js's own client-side 60/40 logic exactly (same
// percentages, same "reset the lock to a fresh STAKING_LOCK_DURATION from
// now" behavior on every new premium reward, matching what the client did
// before this was migrated). Runs computeStakingAccrual() first so a
// PRIOR lock that's already matured is released into empyBalance before
// this new premium reward's 40% starts a fresh one — a matured lock is
// never silently overwritten or merged into a brand new lock window.
app.post('/api/wallet/claim-mining-reward', async (req, res) => {
    const { userId, action } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const rewardAmount = SELF_MINING_ACTIONS[action];
    if (!rewardAmount) return res.status(400).json({ error: 'Unknown or unsupported action for self-crediting' });
    const isPremium = PREMIUM_MINING_ACTIONS.has(action);

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const userRef    = db.collection('users').doc(userId);
        const dayRef      = db.collection('impact_mining_state').doc('daily_' + _dayKey());
        // Separate doc per user per day (not a field on dayRef) so
        // concurrent claims from DIFFERENT users never contend on the same
        // document — only this one user's own repeated claims do.
        const userDayRef = db.collection('impact_mining_state').doc('daily_' + _dayKey() + '_user_' + userId);

        const result = await db.runTransaction(async (tx) => {
            const [userSnap, daySnap, userDaySnap] = await Promise.all([tx.get(userRef), tx.get(dayRef), tx.get(userDayRef)]);
            if (!userSnap.exists) return { code: 404, body: { error: 'User not found' } };
            const spentToday = daySnap.exists ? Number(daySnap.data().spent || 0) : 0;
            if (spentToday + rewardAmount > IMPACT_MINING_DAILY_BUDGET) {
                return { code: 409, body: { error: 'Today\u2019s impact-mining reward budget is exhausted \u2014 try again tomorrow.' } };
            }

            // NEW (2026-08-15) — per-user daily cap, enforced independently
            // of the shared pool budget above. See DAILY_USER_EMPY_CAP's own
            // comment for why this was added.
            const userSpentToday = userDaySnap.exists ? Number(userDaySnap.data().spent || 0) : 0;
            if (userSpentToday + rewardAmount > DAILY_USER_EMPY_CAP) {
                return { code: 409, body: { error: 'You\u2019ve reached today\u2019s mining reward limit \u2014 more available tomorrow.' } };
            }

            const u = userSnap.data() || {};
            const now = Date.now();
            const accrual = computeStakingAccrual(u, now);
            const prevBalance = Number(u.empyBalance || 0) + accrual.releasedLock;
            // ADDED (Payment System Restructuring — earnings segmentation):
            // every impact-mining reward — premium-split or not — is
            // engagement-driven "Rewards System" income, so the FULL
            // rewardAmount (not just the 60% withdrawn share) is tracked
            // here, regardless of how much of it also went into
            // lockedStakedBalance. This is the ledger the launch-gated
            // Rewards withdrawal endpoint checks; empyBalance/staking
            // fields are unaffected by this addition.
            const prevRewardsBalance = Number(u.rewardsBalance || 0);
            const nextRewardsBalance = prevRewardsBalance + rewardAmount;

            let update, withdrawn, locked;
            if (isPremium) {
                locked    = rewardAmount * 0.40;
                withdrawn = rewardAmount * 0.60;
                update = {
                    empyBalance:          prevBalance + withdrawn,
                    rewardsBalance:       nextRewardsBalance,
                    lockedStakedBalance:  accrual.lockedStakedBalance + locked,
                    lockedStakingEndTime: now + STAKING_LOCK_DURATION,
                    manualStakedBalance:  accrual.manualStakedBalance,
                    stakingEarnedRewards: accrual.stakingEarnedRewards,
                    stakingLastAccrualAt: accrual.stakingLastAccrualAt
                };
            } else {
                withdrawn = rewardAmount;
                locked = 0;
                update = {
                    empyBalance:          prevBalance + rewardAmount,
                    rewardsBalance:       nextRewardsBalance,
                    manualStakedBalance:  accrual.manualStakedBalance,
                    lockedStakedBalance:  accrual.lockedStakedBalance,
                    lockedStakingEndTime: accrual.lockedStakingEndTime,
                    stakingEarnedRewards: accrual.stakingEarnedRewards,
                    stakingLastAccrualAt: accrual.stakingLastAccrualAt
                };
            }

            tx.update(userRef, update);
            tx.set(dayRef, { spent: spentToday + rewardAmount }, { merge: true });
            tx.set(userDayRef, { spent: userSpentToday + rewardAmount, userId }, { merge: true });
            tx.set(db.collection('transactions').doc(), {
                userId, type: 'mining_reward', action, amount: rewardAmount,
                withdrawn, locked, status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { code: 200, body: Object.assign({ ok: true, amount: rewardAmount, withdrawn, locked, newBalance: update.empyBalance }, update) };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Mining Reward] failed:', err.message);
        res.status(500).json({ error: 'Could not credit mining reward', detail: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════
// RETIRED (2026-08-15, same day it shipped) — SERVER-SIDE LIKE/COMMENT
// REWARD CREDITING
// ═════════════════════════════════════════════════════════════════════════
// This whole block paid the post/comment OWNER out of the impact-mining
// pool every time someone else liked/commented on their content — wrong
// side of the interaction (the engagement reward belongs to whoever DID
// the liking/commenting — see SELF_MINING_ACTIONS' new ENGAGE_LIKE/
// ENGAGE_COMMENT entries above) and the wrong system for it besides
// (receiving engagement is what drives a creator's payout tier in
// app-monetization.js's computeEngagement(), which already reads the same
// likes/commentCount fields this listener was watching — paying it again
// here was duplicate credit through the mining pool). RECEIVE_MINING_ACTIONS
// is now an empty object (see its own comment) and
// startLikeCommentRewardListeners() below is a documented no-op — neither
// attaches a Firestore listener nor credits anything any more. The
// functions are left in place, inert, rather than deleted, per this
// codebase's own "supersede, don't delete" convention, in case a FUTURE,
// deliberately-designed monetization payout ever wants this same
// observed-Firestore-diff pattern (it would need to credit a monetization
// ledger, not empyBalance/the mining pool, to actually be correct).
//
// _creditReceiveReward() is the shared crediting function both listener
// callbacks below call. It follows the exact same daily-pool-budget +
// per-user-daily-cap + transactions-audit-record pattern as
// /api/wallet/claim-mining-reward above, just triggered by an observed
// Firestore change instead of an HTTP request from the recipient — there's
// no "recipient" client to call this endpoint anyway, since the reward is
// for something someone ELSE did to their content.
//
// Idempotency: a `mining_reward_receipts/{receiptKey}` doc is
// created (inside the same transaction as the credit) the first time a
// given like/comment is rewarded, and checked before crediting again.
// receiptKey is built from the specific like/comment event itself (see
// each listener), so: (a) a listener restart re-diffing existing state
// can't double-credit anything it already paid out before restarting, and
// (b) unliking then re-liking the same post only ever pays out once ever
// for that (post, liker) pair — this is a deliberate anti-farming measure,
// not an oversight; see startLikeCommentRewardListeners()'s own comment.
async function _creditReceiveReward(db, admin, recipientUserId, action, receiptKey) {
    const amount = RECEIVE_MINING_ACTIONS[action];
    if (!amount || !recipientUserId) return;

    const userRef     = db.collection('users').doc(recipientUserId);
    const dayRef       = db.collection('impact_mining_state').doc('daily_' + _dayKey());
    const userDayRef  = db.collection('impact_mining_state').doc('daily_' + _dayKey() + '_user_' + recipientUserId);
    const receiptRef  = db.collection('mining_reward_receipts').doc(receiptKey);

    try {
        await db.runTransaction(async (tx) => {
            const [receiptSnap, userSnap, daySnap, userDaySnap] = await Promise.all([
                tx.get(receiptRef), tx.get(userRef), tx.get(dayRef), tx.get(userDayRef)
            ]);
            if (receiptSnap.exists) return; // already credited — listener redelivery/restart re-diff, no-op
            if (!userSnap.exists) return;   // recipient account no longer exists

            const spentToday = daySnap.exists ? Number(daySnap.data().spent || 0) : 0;
            if (spentToday + amount > IMPACT_MINING_DAILY_BUDGET) return; // pool exhausted for today — silently skip, nothing user-facing to error out to

            const userSpentToday = userDaySnap.exists ? Number(userDaySnap.data().spent || 0) : 0;
            if (userSpentToday + amount > DAILY_USER_EMPY_CAP) return; // this recipient already hit their own daily cap

            const prevBalance = Number(userSnap.data().empyBalance || 0);
            tx.update(userRef, { empyBalance: prevBalance + amount });
            tx.set(dayRef, { spent: spentToday + amount }, { merge: true });
            tx.set(userDayRef, { spent: userSpentToday + amount, userId: recipientUserId }, { merge: true });
            tx.set(receiptRef, {
                action, amount, recipientUserId,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            tx.set(db.collection('transactions').doc(), {
                userId: recipientUserId, type: 'mining_reward', action, amount,
                withdrawn: amount, locked: 0, status: 'completed',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
    } catch (err) {
        console.error('[MiningRewards] _creditReceiveReward failed for', action, receiptKey, '-', err.message);
    }
}

// ── startLikeCommentRewardListeners() — RETIRED 2026-08-15, see below ──
// The notes in this comment block (SCOPE / COST NOTE / SKIP-FIRST-SNAPSHOT)
// describe how this function used to behave when it was live. It no longer
// runs — see the RETIRED note right above _creditReceiveReward, and the
// early `return` at the top of the function itself. Kept for anyone
// designing a real, monetization-side replacement later: the same
// Watches-Firestore-directly / diff-likedBy / SCOPE / COST-NOTE /
// SKIP-FIRST-SNAPSHOT shape would still apply to that, just crediting a
// monetization ledger instead of empyBalance.
//
// Watched Firestore directly (Admin SDK — bypasses firestore.rules, same
// as every other server-side listener in this file) for two things:
//   1. A post's `likedBy` array gaining a NEW uid  -> credited the post's
//      OWNER (data.userId) RECEIVE_LIKE, once ever per (post, liker) pair.
//   2. A NEW document appearing in any `comments` subcollection -> credited
//      the PARENT POST's owner RECEIVE_COMMENT, once ever per comment.
//      (If a comment document itself ever grows a `likedBy` array too,
//      the same diffing was applied there as a bonus — costs nothing if
//      that field never appears on comments in practice.)
//
// SCOPE (deliberate, first pass, back when this was live): only the
// top-level `posts` collection and its `comments` subcollection were
// covered. reels/news_posts/business_posts/etc. have their own likedBy
// fields too (per firebase-rules.js's shared isValidEngagementChange
// helper) but were never wired up here — moot now that receiving a
// like/comment doesn't pay EMPY at all, from any collection.
//
// COST NOTE: this attached a SEPARATE onSnapshot listener to the whole
// `posts` collection and to collectionGroup('comments'), on top of the
// existing top-5-only listener _watchCollection() already has on `posts`
// for push notifications. That meant every post document was read by two
// independent listeners instead of one — accepted at the time as the same
// "additive, don't touch the working thing" tradeoff this codebase makes
// elsewhere (see e.g. app-patch-v39's own header). Moot now that the
// listener never attaches.
//
// SKIP-FIRST-SNAPSHOT: mirrored _watchCollection()'s own reasoning for
// exactly the same problem — a freshly (re)attached listener's first
// callback reports EVERY existing document as if it just changed. Without
// a guard, every restart would have re-diffed (and, without the
// receipt-doc idempotency check, re-credited) every like/comment that ever
// existed. The receipt-doc check in _creditReceiveReward was the real
// safety net; this flag only avoided needlessly attempting (and logging)
// thousands of already-credited transactions on every boot. Moot now.
function startLikeCommentRewardListeners() {
    // RETIRED (2026-08-15) — see the block comment above _creditReceiveReward
    // for the full reasoning. Receiving a like/comment no longer credits
    // EMPY from the impact-mining pool at all; app-monetization.js's
    // engagement-based creator payout tier is the correct channel for that
    // now. Everything below this point in the function is unreachable —
    // left in place, not deleted, in case a future monetization-side
    // feature wants the same observed-Firestore-diff pattern (it would need
    // to credit a monetization ledger, not empyBalance, to be correct).
    console.log('[MiningRewards] Like/comment reward listeners retired (2026-08-15) — receiving a like/comment no longer pays EMPY from the mining pool; see app-monetization.js\u2019s engagement-based payout tier instead.');
    return;

    const admin = _getAdmin();
    if (!admin) {
        console.warn('[MiningRewards] FIREBASE_SERVICE_ACCOUNT_JSON not set — like/comment reward listeners disabled.');
        return;
    }
    const db = admin.firestore();

    // ---- posts: likedBy diff -> RECEIVE_LIKE for the post owner --------
    (function watchPostLikes() {
        const prevLikedBy = new Map(); // postId -> Set(uid), in-memory diff baseline
        let baselined = false;

        db.collection('posts').onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                const postId = change.doc.id;
                const data = change.doc.data() || {};
                const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];

                if (baselined && data.userId) {
                    const prevSet = prevLikedBy.get(postId) || new Set();
                    likedBy.forEach(uid => {
                        if (uid && uid !== data.userId && !prevSet.has(uid)) {
                            _creditReceiveReward(db, admin, data.userId, 'RECEIVE_LIKE', 'like_post_' + postId + '_' + uid)
                                .catch(() => {}); // _creditReceiveReward already logs its own errors
                        }
                    });
                }
                prevLikedBy.set(postId, new Set(likedBy));
            });
            baselined = true; // everything after this callback is a genuine post-boot change
        }, err => {
            console.error('[MiningRewards] posts like-listener error (will not auto-retry — restart the server to resume):', err.message);
        });
    })();

    // ---- comments: new doc -> RECEIVE_COMMENT for the PARENT POST owner;
    //      likedBy diff (if present) -> RECEIVE_LIKE for the comment owner
    (function watchComments() {
        const prevLikedBy = new Map();      // commentPath -> Set(uid)
        const postOwnerCache = new Map();   // postId -> ownerUid (small cache; avoids re-reading the parent post on every comment under it)
        let baselined = false;

        db.collectionGroup('comments').onSnapshot(async snap => {
            for (const change of snap.docChanges()) {
                const doc = change.doc;
                const data = doc.data() || {};
                const commentPath = doc.ref.path;

                if (baselined && change.type === 'added') {
                    const postRef = doc.ref.parent.parent; // posts/{postId}/comments/{commentId} -> posts/{postId}
                    if (postRef) {
                        try {
                            let ownerUid = postOwnerCache.get(postRef.id);
                            if (ownerUid === undefined) {
                                const postSnap = await postRef.get();
                                ownerUid = postSnap.exists ? (postSnap.data().userId || null) : null;
                                postOwnerCache.set(postRef.id, ownerUid);
                            }
                            if (ownerUid && ownerUid !== data.userId) {
                                await _creditReceiveReward(db, admin, ownerUid, 'RECEIVE_COMMENT', 'comment_' + doc.id);
                            }
                        } catch (err) {
                            console.error('[MiningRewards] could not resolve parent post owner for', commentPath, '-', err.message);
                        }
                    }
                }

                const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
                if (baselined && data.userId) {
                    const prevSet = prevLikedBy.get(commentPath) || new Set();
                    likedBy.forEach(uid => {
                        if (uid && uid !== data.userId && !prevSet.has(uid)) {
                            _creditReceiveReward(db, admin, data.userId, 'RECEIVE_LIKE', 'like_comment_' + commentPath + '_' + uid)
                                .catch(() => {});
                        }
                    });
                }
                prevLikedBy.set(commentPath, new Set(likedBy));
            }
            baselined = true;
        }, err => {
            console.error('[MiningRewards] comments listener error (will not auto-retry — restart the server to resume):', err.message);
        });
    })();

    console.log('[MiningRewards] Listening for new likes on posts and new comments/comment-likes (collectionGroup) — crediting RECEIVE_LIKE/RECEIVE_COMMENT to the real post/comment owner as they happen.');
}

// ── /api/wallet/complete-community-task ── one-time follow/subscribe task
// reward (app-fixes.js's mockCommunityTasks). taskId is checked against
// COMMUNITY_TASKS above; the client's own data-reward attribute (trivially
// editable via devtools, since it's just a DOM attribute) is never read.
app.post('/api/wallet/complete-community-task', async (req, res) => {
    const { userId, taskId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const reward = COMMUNITY_TASKS[taskId];
    if (!reward) return res.status(400).json({ error: 'Unknown taskId' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const userRef = db.collection('users').doc(userId);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return { code: 404, body: { error: 'User not found' } };
            const u = snap.data() || {};
            const completed = Array.isArray(u.completedTasks) ? u.completedTasks : [];
            if (completed.includes(taskId)) {
                return { code: 200, body: { ok: true, alreadyCompleted: true } };
            }
            const prevBalance = Number(u.empyBalance || 0);
            tx.update(userRef, {
                empyBalance:     prevBalance + reward,
                completedTasks:  admin.firestore.FieldValue.arrayUnion(taskId)
            });
            tx.set(db.collection('transactions').doc(), {
                userId, type: 'community_task', taskId, amount: reward,
                status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { code: 200, body: { ok: true, amount: reward, newBalance: prevBalance + reward } };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Community Task] failed:', err.message);
        res.status(500).json({ error: 'Could not credit task reward', detail: err.message });
    }
});

// ── /api/p2p/cancel-listing ── refund the untraded remainder of a seller's
// own P2P listing back into their empyBalance (was app-p2p-trading.js's
// window._p2pCancelListing, a raw client Firestore transaction). The
// refund amount now comes ONLY from the listing doc's own stored
// amountRemaining, read server-side inside the same transaction that
// closes the listing — a client can no longer submit whatever "remaining"
// number it likes.
app.post('/api/p2p/cancel-listing', async (req, res) => {
    const { userId, listingId } = req.body || {};
    if (!userId)    return res.status(400).json({ error: 'userId required' });
    if (!listingId) return res.status(400).json({ error: 'listingId required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const listingRef = db.collection('p2p_listings').doc(listingId);
        const userRef     = db.collection('users').doc(userId);

        const result = await db.runTransaction(async (tx) => {
            const [lSnap, uSnap] = await Promise.all([tx.get(listingRef), tx.get(userRef)]);
            if (!lSnap.exists) return { code: 404, body: { error: 'LISTING_GONE' } };
            const l = lSnap.data() || {};
            if (l.sellerUserId !== userId) return { code: 403, body: { error: 'NOT_YOURS' } };
            if (l.status === 'cancelled')  return { code: 200, body: { ok: true, alreadyCancelled: true } };
            if (!uSnap.exists) return { code: 404, body: { error: 'User not found' } };

            const remaining   = Number(l.amountRemaining || 0);
            const prevBalance = Number((uSnap.data() || {}).empyBalance || 0);

            tx.update(listingRef, { status: 'cancelled', amountRemaining: 0 });
            if (remaining > 0) {
                tx.update(userRef, { empyBalance: prevBalance + remaining });
                tx.set(db.collection('transactions').doc(), {
                    userId, type: 'p2p_listing_cancel_refund', listingId, amount: remaining,
                    status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
            return { code: 200, body: { ok: true, refunded: remaining, newBalance: prevBalance + remaining } };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[P2P Cancel] failed:', err.message);
        res.status(500).json({ error: 'Could not cancel listing', detail: err.message });
    }
});

// ── /api/p2p/release-escrow ── seller confirms payment received, releasing
// escrowed EMPY to the buyer (was app-p2p-trading.js's window.
// _p2pReleaseEscrow, two separate un-transacted client writes with no
// status check at all beyond "is this the seller"). Now one Admin SDK
// transaction, and now also requires the trade to actually be in
// 'payment_claimed' status first (the buyer must have tapped "I've Paid")
// before a release can happen — closing a workflow-integrity gap on top
// of the credit-authority one.
app.post('/api/p2p/release-escrow', async (req, res) => {
    const { userId, tradeId } = req.body || {};
    if (!userId)  return res.status(400).json({ error: 'userId required' });
    if (!tradeId) return res.status(400).json({ error: 'tradeId required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const tradeRef = db.collection('p2p_trades').doc(tradeId);

        const result = await db.runTransaction(async (tx) => {
            const tSnap = await tx.get(tradeRef);
            if (!tSnap.exists) return { code: 404, body: { error: 'Trade not found.' } };
            const t = tSnap.data() || {};
            if (t.sellerUserId !== userId) return { code: 403, body: { error: 'Only the seller can release this trade.' } };
            if (t.status === 'released')   return { code: 200, body: { ok: true, alreadyReleased: true } };
            if (t.status !== 'payment_claimed') {
                return { code: 409, body: { error: 'The buyer hasn\u2019t marked this trade as paid yet.' } };
            }

            const buyerRef = db.collection('users').doc(t.buyerUserId);
            const bSnap = await tx.get(buyerRef);
            if (!bSnap.exists) return { code: 404, body: { error: 'Buyer account not found.' } };
            const prevBalance = Number((bSnap.data() || {}).empyBalance || 0);
            const amountEmpy  = Number(t.amountEmpy || 0);

            tx.update(buyerRef, { empyBalance: prevBalance + amountEmpy });
            tx.update(tradeRef, { status: 'released', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            tx.set(db.collection('transactions').doc(), {
                userId: t.buyerUserId, type: 'p2p_escrow_release', tradeId, sellerUserId: userId,
                amount: amountEmpy, status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { code: 200, body: { ok: true, amount: amountEmpy } };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[P2P Release] failed:', err.message);
        res.status(500).json({ error: 'Could not release escrow', detail: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// STAKING — server-authoritative stake / unstake / claim / sync
// (was app-wallet.js's stake-form / unstake-form / claim-reward-btn /
// simulateRewardAccrual — see the long comment above computeStakingAccrual()
// and the one further above SELF_MINING_ACTIONS for the full history).
// All four routes below share the identical read-accrue-apply-write shape:
// read the user doc inside a transaction, call computeStakingAccrual() to
// bring stakingEarnedRewards/lockedStakedBalance up to date as of THIS
// call, then apply whatever this specific route additionally does, in one
// write. That ordering means a lock release or reward accrual can never be
// silently dropped just because the user happened to stake/unstake/claim
// instead of waiting for a plain sync.
// ═══════════════════════════════════════════════════════════════════════

// ── /api/staking/stake ── move EMPY from a user's own withdrawable
// empyBalance into manualStakedBalance, where it starts earning
// STAKING_APY_ESTIMATE. Re-checks the balance server-side inside the
// transaction — two clients staking concurrently can no longer each pass
// their own stale local balance check and jointly over-stake.
app.post('/api/staking/stake', async (req, res) => {
    const { userId, amount } = req.body || {};
    const amt = Number(amount);
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!(amt > 0) || !isFinite(amt)) return res.status(400).json({ error: 'amount must be a positive number' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const userRef = db.collection('users').doc(userId);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return { code: 404, body: { error: 'User not found' } };
            const u = snap.data() || {};
            const now = Date.now();
            const accrual = computeStakingAccrual(u, now);
            const prevBalance = Number(u.empyBalance || 0) + accrual.releasedLock;

            if (prevBalance < amt) {
                return { code: 400, body: { error: 'Insufficient EMPY balance for staking.' } };
            }

            const update = {
                empyBalance:          prevBalance - amt,
                manualStakedBalance:  accrual.manualStakedBalance + amt,
                stakingEarnedRewards: accrual.stakingEarnedRewards,
                lockedStakedBalance:  accrual.lockedStakedBalance,
                lockedStakingEndTime: accrual.lockedStakingEndTime,
                stakingLastAccrualAt: accrual.stakingLastAccrualAt
            };
            tx.update(userRef, update);
            tx.set(db.collection('transactions').doc(), {
                userId, type: 'stake', amount: amt,
                status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { code: 200, body: Object.assign({ ok: true, newBalance: update.empyBalance }, update) };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Staking Stake] failed:', err.message);
        res.status(500).json({ error: 'Could not stake', detail: err.message });
    }
});

// ── /api/staking/unstake ── move EMPY back from manualStakedBalance into
// empyBalance. Same client-authoritative gap as stake above, plus this is
// where locked-staking's auto-release used to have no trigger OTHER than
// a client-side per-second timer with nothing server-side backing it.
app.post('/api/staking/unstake', async (req, res) => {
    const { userId, amount } = req.body || {};
    const amt = Number(amount);
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!(amt > 0) || !isFinite(amt)) return res.status(400).json({ error: 'amount must be a positive number' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const userRef = db.collection('users').doc(userId);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return { code: 404, body: { error: 'User not found' } };
            const u = snap.data() || {};
            const now = Date.now();
            const accrual = computeStakingAccrual(u, now);

            if (accrual.manualStakedBalance < amt) {
                return { code: 400, body: { error: 'You don\u2019t have enough manually staked EMPY to unstake.' } };
            }

            const prevBalance = Number(u.empyBalance || 0) + accrual.releasedLock;
            const update = {
                empyBalance:          prevBalance + amt,
                manualStakedBalance:  accrual.manualStakedBalance - amt,
                stakingEarnedRewards: accrual.stakingEarnedRewards,
                lockedStakedBalance:  accrual.lockedStakedBalance,
                lockedStakingEndTime: accrual.lockedStakingEndTime,
                stakingLastAccrualAt: accrual.stakingLastAccrualAt
            };
            tx.update(userRef, update);
            tx.set(db.collection('transactions').doc(), {
                userId, type: 'unstake', amount: amt,
                status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { code: 200, body: Object.assign({ ok: true, newBalance: update.empyBalance }, update) };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Staking Unstake] failed:', err.message);
        res.status(500).json({ error: 'Could not unstake', detail: err.message });
    }
});

// ── /api/staking/claim-rewards ── move accrued stakingEarnedRewards into
// empyBalance and reset the accrual to 0. THE actual live exploit found
// during the earlier completion pass: the old claim-reward-btn persisted
// straight to empyBalance from a client-side "earned" number with no
// Firestore-backed accrual anywhere — trivially settable to anything from
// devtools before tapping Claim. The reward amount here comes ONLY from
// computeStakingAccrual()'s own math over the user's OWN stored
// manualStakedBalance/stakingLastAccrualAt; the client submits nothing but
// userId.
app.post('/api/staking/claim-rewards', async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const userRef = db.collection('users').doc(userId);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return { code: 404, body: { error: 'User not found' } };
            const u = snap.data() || {};
            const now = Date.now();
            const accrual = computeStakingAccrual(u, now);
            const claimAmount = accrual.stakingEarnedRewards;
            const prevBalance = Number(u.empyBalance || 0) + accrual.releasedLock;

            if (claimAmount <= 0) {
                // Nothing to claim — still persist a released lock / the
                // fresh accrual timestamp so it isn't silently lost until
                // the next mutating call.
                if (accrual.releasedLock > 0) {
                    tx.update(userRef, {
                        empyBalance:          prevBalance,
                        stakingLastAccrualAt: accrual.stakingLastAccrualAt,
                        lockedStakedBalance:  accrual.lockedStakedBalance,
                        lockedStakingEndTime: accrual.lockedStakingEndTime
                    });
                }
                return { code: 200, body: { ok: true, claimed: 0, newBalance: prevBalance } };
            }

            const update = {
                empyBalance:          prevBalance + claimAmount,
                stakingEarnedRewards: 0,
                manualStakedBalance:  accrual.manualStakedBalance,
                lockedStakedBalance:  accrual.lockedStakedBalance,
                lockedStakingEndTime: accrual.lockedStakingEndTime,
                stakingLastAccrualAt: accrual.stakingLastAccrualAt
            };
            tx.update(userRef, update);
            tx.set(db.collection('transactions').doc(), {
                userId, type: 'staking_reward_claim', amount: claimAmount,
                status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { code: 200, body: Object.assign({ ok: true, claimed: claimAmount, newBalance: update.empyBalance }, update) };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Staking Claim] failed:', err.message);
        res.status(500).json({ error: 'Could not claim staking rewards', detail: err.message });
    }
});

// ── /api/staking/sync ── read-and-tick: recompute accrual/lock-release
// with no user-initiated fund movement, and return the full current
// staking state. Called by app-wallet.js on wallet-tab open and on a
// periodic refresh — replacing the old per-second client-side
// simulateRewardAccrual, which both computed AND persisted its own numbers
// with nothing server-side checking them — so the displayed
// earned-rewards/locked-balance figures are always the server's own.
app.post('/api/staking/sync', async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const userRef = db.collection('users').doc(userId);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return { code: 404, body: { error: 'User not found' } };
            const u = snap.data() || {};
            const now = Date.now();
            const accrual = computeStakingAccrual(u, now);
            const prevBalance = Number(u.empyBalance || 0) + accrual.releasedLock;

            // Skip the write entirely if this tick genuinely changed
            // nothing (no staked balance, no matured lock) — avoids a
            // write on every single poll for a user who isn't staking.
            const changed = accrual.releasedLock > 0 ||
                accrual.stakingEarnedRewards !== Number(u.stakingEarnedRewards || 0) ||
                u.stakingLastAccrualAt == null;
            if (changed) {
                tx.update(userRef, {
                    empyBalance:          prevBalance,
                    stakingEarnedRewards: accrual.stakingEarnedRewards,
                    lockedStakedBalance:  accrual.lockedStakedBalance,
                    lockedStakingEndTime: accrual.lockedStakingEndTime,
                    stakingLastAccrualAt: accrual.stakingLastAccrualAt
                });
            }

            return {
                code: 200,
                body: {
                    ok: true,
                    newBalance:           prevBalance,
                    manualStakedBalance:  accrual.manualStakedBalance,
                    lockedStakedBalance:  accrual.lockedStakedBalance,
                    lockedStakingEndTime: accrual.lockedStakingEndTime,
                    stakingEarnedRewards: accrual.stakingEarnedRewards,
                    apy:                  STAKING_APY_ESTIMATE
                }
            };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Staking Sync] failed:', err.message);
        res.status(500).json({ error: 'Could not sync staking state', detail: err.message });
    }
});

// ── /api/marketplace/order/confirm ── Create a verified escrow order ─────
// Called by the client (app-marketplace.js's _doFlutterwaveCheckout
// callback) the moment Flutterwave's own popup reports success. Trusting
// that client-side callback alone was the gap this route closes: it
// re-verifies the SAME tx_ref server-side via _verifyFlwTxRef() (the
// FLW_SECRET_KEY never leaves the server, same as /api/flw/verify above)
// before writing anything to Firestore, so a manipulated/replayed client
// request can no longer fabricate a "successful" order.
//
// One marketplace_orders/{id} doc is created PER ITEM (a cart can span
// multiple sellers in one Flutterwave charge; escrow is a per-seller,
// per-product relationship, and _watchMarketplaceOrdersForEmail below
// needs one seller/product per doc to send the right emails to the right
// people). All docs from the same checkout share the same txRef, so
// they can still be traced back to one payment.
//
// Idempotent on (txRef + itemId): if the client retries this call (e.g.
// a flaky connection resent the request), an already-created order for
// that exact item/tx pair is returned as-is instead of being duplicated
// or re-emailing anyone a second time.
app.post('/api/marketplace/order/confirm', async (req, res) => {
    const { txRef, items, buyerId, buyerName, buyerEmail, buyerPhone } = req.body || {};
    if (!txRef) return res.status(400).json({ error: 'txRef required' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items (non-empty array) required' });
    if (!buyerEmail) return res.status(400).json({ error: 'buyerEmail required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    let flwResult;
    try {
        flwResult = await _verifyFlwTxRef(txRef);
    } catch (err) {
        return res.status(502).json({ error: 'Flutterwave verification request failed', detail: err.message });
    }
    const flwStatusOk = flwResult && flwResult.status === 'success' &&
        flwResult.data && flwResult.data.status === 'successful';
    if (!flwStatusOk) {
        console.warn('[Marketplace Order] rejected — Flutterwave did not confirm tx_ref', txRef, ':', JSON.stringify(flwResult).slice(0, 300));
        return res.status(402).json({ error: 'Payment not confirmed by Flutterwave for this tx_ref', flw: flwResult });
    }

    try {
        const db = admin.firestore();
        const created = [];
        for (const item of items) {
            const itemId = item && item.id;
            if (!itemId || !item.sellerId) continue; // can't build an escrow relationship without both sides

            // Idempotency check — same tx_ref + same item never creates twice.
            const existing = await db.collection('marketplace_orders')
                .where('txRef', '==', txRef).where('productId', '==', itemId).limit(1).get();
            if (!existing.empty) { created.push(existing.docs[0].id); continue; }

            const docRef = await db.collection('marketplace_orders').add({
                txRef,
                productId:    itemId,
                productTitle: item.name || 'Item',
                amount:       item.price || 0,
                currency:     item.currency || 'NGN',
                sellerId:     item.sellerId,
                buyerId:      buyerId || '',
                buyerName:    buyerName || 'Buyer',
                buyerEmail,
                buyerPhone:   buyerPhone || '',
                status:       'paid', // paid -> released (see confirm-receipt route below)
                createdAt:    admin.firestore.FieldValue.serverTimestamp(),
                updatedAt:    admin.firestore.FieldValue.serverTimestamp()
            });
            created.push(docRef.id);
        }
        res.json({ ok: true, orderIds: created });
    } catch (err) {
        console.error('[Marketplace Order] Firestore write failed:', err.message);
        res.status(500).json({ error: 'Could not record order', detail: err.message });
    }
});

// ── /api/marketplace/order/:id/confirm-receipt ── Buyer releases escrow ──
// Called when the buyer taps "Confirm Receipt" (client UI added in
// app-marketplace.js / app-marketplace-sellers.js's Orders pane). Flips
// status 'paid'/'dispatched' -> 'released' AND, atomically in the same
// Firestore transaction, credits the seller — in the SAME currency the
// buyer paid, per marketplace_orders' own `currency` field (set at
// order-creation time directly from the listing's priced currency, which
// is what Flutterwave actually charged the buyer in): fiat stays fiat
// (users/{sellerId}.fiatBalance.<CURRENCY>, a currency-keyed map, kept
// fully separate from empyBalance), and EMPY is only ever credited when
// the order's currency IS 'EMPY' — a 1:1 credit in that case, never a
// rate conversion. Also logs an entry into the existing `transactions`
// collection (same shape app-tokenpurchase.js's own purchase-callback
// already writes there), so this shows up in whatever transaction-
// history UI already reads that collection.
//
// Everything below happens inside ONE db.runTransaction() — the status
// flip, the balance credit, and the log write either all commit together
// or none do. This also closes a real correctness gap a naive get-then-
// update version of this route would have: two near-simultaneous
// confirm-receipt calls for the same order could both pass the "not yet
// released" check before either write landed, crediting the seller
// twice. A Firestore transaction can't do that — the second call's read
// is guaranteed to see the first call's write (or the transaction
// retries), so the status re-check happens under an actual lock.
//
// Fails safe rather than guessing: a zero/invalid order amount or a
// seller account that doesn't exist results in the order still being
// marked 'released' (the buyer's confirmation is honored either way —
// they shouldn't be stuck mid-flow over a crediting edge case) but
// WITHOUT a balance credit, flagged via `creditFailed`/
// `creditFailedReason` on the order doc for manual reconciliation, and
// reflected honestly in the seller's email (see email-templates.js's
// escrowSellerReleasedEmailTemplate).
//
// Gating: same trust level the rest of this codebase's routes already
// operate at (no server-side session/idToken check exists anywhere else
// in server.js either — see /api/fcm/subscribe, /api/agora-token above)
// — caller must supply the buyerId that was actually stored on the
// order at creation time, not just any buyerId.
app.post('/api/marketplace/order/:id/confirm-receipt', async (req, res) => {
    const { id } = req.params;
    const { buyerId } = req.body || {};
    if (!buyerId) return res.status(400).json({ error: 'buyerId required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const orderRef = db.collection('marketplace_orders').doc(id);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(orderRef);
            if (!snap.exists) return { code: 404, body: { error: 'Order not found' } };
            const d = snap.data() || {};
            if (d.buyerId !== buyerId) return { code: 403, body: { error: 'buyerId does not match this order' } };
            if (d.status === 'released') return { code: 200, body: { ok: true, alreadyReleased: true } };

            const cur = String(d.currency || 'NGN').toUpperCase();
            const amt = parseFloat(d.amount) || 0;
            const isEmpyOrder = cur === 'EMPY';

            let sellerRef = null;
            let sellerExists = false;
            if (amt > 0 && d.sellerId) {
                sellerRef = db.collection('users').doc(d.sellerId);
                const sellerSnap = await tx.get(sellerRef); // all reads must happen before any writes in a Firestore transaction
                sellerExists = sellerSnap.exists;
            }
            const willCredit = amt > 0 && sellerExists;

            const orderUpdate = { status: 'released', updatedAt: admin.firestore.FieldValue.serverTimestamp() };
            if (willCredit) {
                orderUpdate.creditedAmount = amt;
                orderUpdate.creditedCurrency = isEmpyOrder ? 'EMPY' : cur;
            } else {
                orderUpdate.creditFailed = true;
                orderUpdate.creditFailedReason = amt <= 0 ? 'invalid order amount' : 'seller account not found';
            }
            tx.update(orderRef, orderUpdate);

            if (willCredit) {
                if (isEmpyOrder) {
                    // Buyer paid with EMPY for this listing — credit the
                    // seller's EMPY balance 1:1. Not a rate conversion.
                    tx.update(sellerRef, { empyBalance: admin.firestore.FieldValue.increment(amt) });
                } else {
                    // Buyer paid fiat — seller is owed that SAME fiat
                    // amount, in its own currency bucket. Never touches
                    // empyBalance.
                    tx.update(sellerRef, { ['fiatBalance.' + cur]: admin.firestore.FieldValue.increment(amt) });
                }

                // Same collection/shape app-tokenpurchase.js's own
                // purchase-callback already writes to — see that file's
                // callback() for the exact field set this mirrors.
                const txLogRef = db.collection('transactions').doc();
                tx.set(txLogRef, {
                    userId:    d.sellerId,
                    type:      'marketplace_escrow_release',
                    amount:    amt,
                    currency:  isEmpyOrder ? 'EMPY' : cur,
                    txRef:     d.txRef || '',
                    orderId:   id,
                    productId: d.productId || '',
                    status:    'completed',
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            return {
                code: 200,
                body: { ok: true, creditedAmount: willCredit ? amt : null, creditedCurrency: willCredit ? (isEmpyOrder ? 'EMPY' : cur) : null }
            };
        });

        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Marketplace Order] confirm-receipt failed:', err.message);
        res.status(500).json({ error: 'Could not release order', detail: err.message });
    }
});

// ── /api/marketplace/order/:id/mark-dispatched ── Seller marks shipped ───
// Called when the seller taps "Mark as Dispatched" (client UI added in
// app-marketplace-sellers.js's Orders pane). Flips status 'paid' ->
// 'dispatched'. No email template exists for this transition (only
// payment-received and funds-released were requested), so
// _watchMarketplaceOrdersForEmail below intentionally ignores it — this
// route only updates Firestore state so the buyer's order list reflects
// it. Same trust-level gating as confirm-receipt: caller must supply the
// sellerId that was actually stored on the order at creation time.
app.post('/api/marketplace/order/:id/mark-dispatched', async (req, res) => {
    const { id } = req.params;
    const { sellerId } = req.body || {};
    if (!sellerId) return res.status(400).json({ error: 'sellerId required' });

    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    try {
        const db = admin.firestore();
        const ref = db.collection('marketplace_orders').doc(id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
        const d = snap.data() || {};
        if (d.sellerId !== sellerId) return res.status(403).json({ error: 'sellerId does not match this order' });
        if (d.status === 'released') return res.status(409).json({ error: 'Order funds already released — cannot mark dispatched after release' });
        if (d.status === 'dispatched') return res.json({ ok: true, alreadyDispatched: true });

        await ref.update({ status: 'dispatched', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        res.json({ ok: true });
    } catch (err) {
        console.error('[Marketplace Order] mark-dispatched failed:', err.message);
        res.status(500).json({ error: 'Could not mark order dispatched', detail: err.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// FEATURE (2026-10-03 — paid 1:1 live consultations): server-authoritative billing.
// The viewer's wallet can only be DEBITED by its owner and never credited by its owner
// (firebase-rules.js isSelfEmpyBalanceNonIncreasing), and a host credit is capped at 100,000 per write,
// so a refund / payout cannot be done from the browser. These routes do it with the Admin SDK:
//   POST /api/consult/hold   — host accepted a PAID request: debit the viewer for the chosen duration
//   POST /api/consult/end    — stamp the session's end on the SERVER clock (first write wins)
//   POST /api/consult/settle — session finished: bill the minutes used, pay the host, refund the rest
// Where the truth lives (clients can never write any of it — firebase-rules.js):
//   active_streams/{streamId}/consultHolds/{key}  public-read, server-write. THE proof a paid session was paid for:
//       the apps only start a paid call once this doc exists, and they read price/duration from HERE, not
//       from the (client-writable) request, so a request edited afterwards cannot make a paid call free.
//   consult_settlements/{ledgerId}                private money ledger + idempotency guard.
// Billed time = (server-stamped end, else settle time) - (server-stamped start); the client's own endedAt is ignored.
// ─────────────────────────────────────────────────────────────────────────────
const CONSULT_DURATIONS = [5, 10, 15, 30];
const CONSULT_MIN_BILLABLE_SEC = 15;
async function _consultCaller(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Please sign in.', code: 'auth' }); return null; }
    try {
        const d = await admin.auth().verifyIdToken(m[1]);
        if (d.firebase && d.firebase.sign_in_provider === 'anonymous') { res.status(401).json({ error: 'Please sign in to your Empyrean account.', code: 'auth' }); return null; }
        return d;
    } catch (e) { res.status(401).json({ error: 'Session expired \u2014 please sign in again.', code: 'auth' }); return null; }
}
function _consultKeys(b) {
    const streamId = String((b && b.streamId) || '').slice(0, 200);
    const key = String((b && b.key) || '').replace(/[^\w\-]/g, '_').slice(0, 200);
    if (!streamId || !key || streamId.indexOf('/') !== -1) return null;
    return { streamId, key };
}
app.post('/api/consult/hold', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(503).json({ error: 'Billing is temporarily unavailable.', code: 'unavailable' });
    if (!(await _consultCaller(req, res, admin))) return;
    const k = _consultKeys(req.body);
    if (!k) return res.status(400).json({ error: 'streamId and key required' });
    try {
        const db = admin.firestore(), FV = admin.firestore.FieldValue;
        const streamRef = db.collection('active_streams').doc(k.streamId);
        const holdRef = streamRef.collection('consultHolds').doc(k.key);
        const result = await db.runTransaction(async (tx) => {
            const sSnap = await tx.get(streamRef);
            if (!sSnap.exists) return { code: 404, body: { error: 'This live has ended.' } };
            const s = sSnap.data() || {};
            const r = (s.consultRequests || {})[k.key];
            if (!r || r.type !== 'paid') return { code: 400, body: { error: 'Not a paid request.' } };
            if (r.status !== 'accepted') return { code: 409, body: { error: 'The host has not accepted this request.', code: 'not-accepted' } };
            const minutes = Number(r.minutes), rate = Math.floor(Number(r.rate)), price = minutes * rate;
            if (CONSULT_DURATIONS.indexOf(minutes) === -1 || !(rate >= 1 && rate <= 100000) || Number(r.price) !== price)
                return { code: 400, body: { error: 'Invalid consultation price.' } };
            const hostId = s.hostUserId || s.hostId;
            if (!hostId || !r.uid || r.uid === hostId) return { code: 400, body: { error: 'Invalid consultation.' } };
            const hSnap = await tx.get(holdRef);
            if (hSnap.exists) {
                const h = hSnap.data() || {};
                if (h.requestedAt === String(r.requestedAt || '')) return { code: 200, body: { ok: true, already: true, newBalance: null } };
                if (h.status === 'held') return { code: 409, body: { error: 'Your previous consultation is still being settled \u2014 try again in a moment.', code: 'unsettled' } };
            }
            const ledgerId = (k.streamId + '__' + k.key + '__' + String(r.requestedAt || '')).replace(/[^\w\-]/g, '_').slice(0, 300);
            const ledgerRef = db.collection('consult_settlements').doc(ledgerId);
            const userRef = db.collection('users').doc(r.uid);
            const uSnap = await tx.get(userRef);
            const bal = Number((uSnap.exists && (uSnap.data() || {}).empyBalance) || 0);
            if (bal < price) {
                tx.update(streamRef, { ['consultRequests.' + k.key + '.status']: 'cancelled' });
                return { code: 402, body: { error: 'Not enough EMPY for this consultation.', code: 'insufficient' } };
            }
            const startedAt = new Date().toISOString();
            tx.update(userRef, { empyBalance: bal - price });
            tx.create(ledgerRef, { streamId: k.streamId, key: k.key, uid: r.uid, hostId, minutes, rate, price, status: 'held', startedAt, createdAt: FV.serverTimestamp() });
            tx.set(holdRef, { requestedAt: String(r.requestedAt || ''), uid: r.uid, hostId, minutes, rate, price, status: 'held', startedAt, ledgerId });
            tx.set(db.collection('transactions').doc(), { userId: r.uid, type: 'consult_hold', amount: price, streamId: k.streamId, status: 'completed', createdAt: FV.serverTimestamp() });
            return { code: 200, body: { ok: true, startedAt, newBalance: bal - price } };
        });
        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Consult Hold] failed:', err.message);
        res.status(500).json({ error: 'Could not reserve tokens', detail: err.message });
    }
});
// Stamps the end of the session on the server clock. Ignored while the request is still "accepted" (a live call
// can't be ended on paper only), and the first stamp wins, so it can't be moved later by either side.
app.post('/api/consult/end', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(503).json({ error: 'Billing is temporarily unavailable.', code: 'unavailable' });
    if (!(await _consultCaller(req, res, admin))) return;
    const k = _consultKeys(req.body);
    if (!k) return res.status(400).json({ error: 'streamId and key required' });
    try {
        const db = admin.firestore();
        const streamRef = db.collection('active_streams').doc(k.streamId);
        const holdRef = streamRef.collection('consultHolds').doc(k.key);
        const out = await db.runTransaction(async (tx) => {
            const sSnap = await tx.get(streamRef), hSnap = await tx.get(holdRef);
            if (!hSnap.exists) return { ok: true, nothing: true };
            const h = hSnap.data() || {};
            const r = sSnap.exists ? ((sSnap.data() || {}).consultRequests || {})[k.key] : null;
            if (h.status !== 'held' || h.endedAt) return { ok: true, already: true };
            if (r && r.status === 'accepted' && String(r.requestedAt || '') === h.requestedAt) return { ok: false, code: 409, error: 'Consultation still in progress.' };
            const endedAt = new Date().toISOString();
            tx.update(holdRef, { endedAt });
            tx.update(db.collection('consult_settlements').doc(h.ledgerId), { endedAt });
            return { ok: true, endedAt };
        });
        if (out.ok === false) return res.status(out.code).json({ error: out.error, code: 'in-progress' });
        res.json(out);
    } catch (err) {
        console.error('[Consult End] failed:', err.message);
        res.status(500).json({ error: 'Could not record the end of the consultation', detail: err.message });
    }
});
app.post('/api/consult/settle', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(503).json({ error: 'Billing is temporarily unavailable.', code: 'unavailable' });
    if (!(await _consultCaller(req, res, admin))) return;
    const k = _consultKeys(req.body);
    if (!k) return res.status(400).json({ error: 'streamId and key required' });
    try {
        const db = admin.firestore(), FV = admin.firestore.FieldValue;
        const streamRef = db.collection('active_streams').doc(k.streamId);
        const holdRef = streamRef.collection('consultHolds').doc(k.key);
        const result = await db.runTransaction(async (tx) => {
            const sSnap = await tx.get(streamRef), hSnap = await tx.get(holdRef);
            if (!hSnap.exists) return { code: 200, body: { ok: true, nothing: true } };
            const h = hSnap.data() || {};
            if (h.status !== 'held') return { code: 200, body: { ok: true, already: true, charged: h.charged || 0, refunded: h.refunded || 0, usedMinutes: h.usedMinutes || 0 } };
            const r = sSnap.exists ? ((sSnap.data() || {}).consultRequests || {})[k.key] : null;
            const same = r && String(r.requestedAt || '') === h.requestedAt;
            if (same && (r.status === 'accepted' || r.status === 'pending')) return { code: 409, body: { error: 'Consultation still in progress.', code: 'in-progress' } };
            const ledgerRef = db.collection('consult_settlements').doc(h.ledgerId);
            const t0 = new Date(h.startedAt).getTime(), now = Date.now();
            let secs = 0;
            if (!same || r.status === 'ended') {
                let t1 = h.endedAt ? new Date(h.endedAt).getTime() : now;     // server-stamped end, else now — never the client's clock
                if (!isFinite(t1) || t1 < t0 || t1 > now) t1 = now;
                secs = Math.floor((t1 - t0) / 1000);
            }                                            // declined / cancelled after payment => 0 seconds => full refund
            const used = secs < CONSULT_MIN_BILLABLE_SEC ? 0 : Math.min(h.minutes, Math.ceil(secs / 60));
            const cost = Math.min(h.price, used * h.rate), refund = h.price - cost;
            if (cost > 0) tx.set(db.collection('users').doc(h.hostId), { giftTokenBalance: FV.increment(cost) }, { merge: true });
            if (refund > 0) tx.set(db.collection('users').doc(h.uid), { empyBalance: FV.increment(refund) }, { merge: true });
            tx.update(ledgerRef, { status: 'settled', usedMinutes: used, charged: cost, refunded: refund, settledAt: FV.serverTimestamp() });
            tx.update(holdRef, { status: 'settled', usedMinutes: used, charged: cost, refunded: refund });
            if (cost > 0) tx.set(db.collection('transactions').doc(), { userId: h.hostId, type: 'consult_earning', amount: cost, fromUid: h.uid, streamId: k.streamId, status: 'completed', createdAt: FV.serverTimestamp() });
            if (refund > 0) tx.set(db.collection('transactions').doc(), { userId: h.uid, type: 'consult_refund', amount: refund, streamId: k.streamId, status: 'completed', createdAt: FV.serverTimestamp() });
            return { code: 200, body: { ok: true, charged: cost, refunded: refund, usedMinutes: used, uid: h.uid } };
        });
        res.status(result.code).json(result.body);
    } catch (err) {
        console.error('[Consult Settle] failed:', err.message);
        res.status(500).json({ error: 'Could not settle consultation', detail: err.message });
    }
});

// The App Certificate (AGORA_APP_CERTIFICATE) is the secret half of the
// Agora credential pair and must NEVER be sent to the client — only this
// route touches it. The client sends the channel it wants to join (and,
// for viewers, that they only need to subscribe, not publish); this route
// signs a token valid for that one channel for a limited time and hands
// back just the token + the (public) App ID.
//
// role: 'host' (publisher — can send audio/video) or 'viewer' (subscriber —
// can only receive). Defaults to viewer if omitted/unrecognised, so a
// missing/incorrect value fails safe (can't accidentally grant publish
// rights) rather than failing open.
app.post('/api/agora-token', (req, res) => {
    const { channelName, uid, role } = req.body || {};
    if (!channelName) return res.status(400).json({ error: 'channelName required' });

    const appId          = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    if (!appId || !appCertificate) {
        console.error('[Agora Token] AGORA_APP_ID / AGORA_APP_CERTIFICATE not set in Render environment.');
        return res.status(500).json({ error: 'Agora not configured on server' });
    }

    let RtcTokenBuilder, RtcRole;
    try {
        ({ RtcTokenBuilder, RtcRole } = require('agora-access-token'));
    } catch (err) {
        console.error('[Agora Token] "agora-access-token" package not installed. Run: npm install agora-access-token');
        return res.status(500).json({ error: 'Server missing agora-access-token dependency' });
    }

    // uid 0 lets the Agora SDK assign one automatically on join — supported
    // and commonly used, so we don't force the client to invent one.
    const uidNum = Number.isFinite(Number(uid)) ? Number(uid) : 0;
    const agoraRole = role === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    const expirationTimeInSeconds = 3600; // 1 hour — client should re-fetch a fresh token if a stream runs longer
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    try {
        const token = RtcTokenBuilder.buildTokenWithUid(
            appId, appCertificate, channelName, uidNum, agoraRole, privilegeExpiredTs
        );
        res.json({ token, appId, uid: uidNum, channelName, expiresAt: privilegeExpiredTs });
    } catch (err) {
        console.error('[Agora Token] generation failed:', err.message);
        res.status(500).json({ error: 'Token generation failed' });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// AGORA CLOUD RECORDING — server-side, multi-participant composited
// replay (upgrade over v57's honestly-scoped host-device-only recording).
// ═══════════════════════════════════════════════════════════════════════
// Three Agora REST calls are involved, all authenticated with Basic auth
// built from a Customer ID/Secret pair (RESTful API credentials — a
// DIFFERENT credential pair from the App ID/App Certificate used for RTC
// tokens above, generated separately in Agora Console → RESTful API):
//   1. acquire   — reserve a resourceId for a (channel, uid) pair
//   2. start     — begin composited "mix mode" recording against that
//                  resourceId, writing straight to a third-party cloud
//                  storage bucket (Agora does not hold the files itself)
//   3. stop      — end recording, returns the fileList that landed in
//                  that bucket
// The recording joins the channel as its own dedicated Agora participant
// (a fixed bot uid, subscribing to every publisher — host, promoted
// guests, everyone) — this is precisely what closes v57's own documented
// gap ("doesn't composite in guest-broadcaster video/audio").
//
// STATE ACROSS acquire → start → stop: Agora requires the exact same
// resourceId + sid on the stop call that acquire/start returned. Kept in
// an in-memory Map (this server process stays up between those calls for
// any realistic stream length) AND mirrored to a `live_recordings/
// {channelName}` Firestore doc via the Admin SDK, purely as a crash-
// recovery backup — if this Render process restarts mid-recording, the
// in-memory Map is gone, but the Firestore doc still has enough (resourceId,
// sid, uid, channelName) for a manual/future recovery stop call, same
// "state that must survive a restart goes to Firestore, not memory alone"
// discipline the scheduled-stream reminder dedupe above already follows.
const _activeRecordings = new Map(); // channelName -> { resourceId, sid, uid, hostId, hostName, hostAvatar, title, streamId, startedAt }

function _agoraRecordingAuthHeader() {
    const key = process.env.AGORA_CUSTOMER_KEY, secret = process.env.AGORA_CUSTOMER_SECRET;
    if (!key || !secret) return null;
    return 'Basic ' + Buffer.from(key + ':' + secret).toString('base64');
}

function _recordingConfigured() {
    return !!(
        process.env.AGORA_APP_ID && process.env.AGORA_APP_CERTIFICATE &&
        process.env.AGORA_CUSTOMER_KEY && process.env.AGORA_CUSTOMER_SECRET &&
        process.env.RECORDING_STORAGE_VENDOR && process.env.RECORDING_BUCKET &&
        process.env.RECORDING_ACCESS_KEY && process.env.RECORDING_SECRET_KEY
    );
}

// Fixed bot uid the recording service joins each channel as. Deliberately
// a large, unlikely-to-collide constant rather than a per-recording random
// number — Agora's cloud recording docs recommend a stable/reserved uid
// for the recording participant, and a fixed value also means this same
// uid can be excluded client-side from any "who's in this call" UI if
// that's ever needed later (not done yet — flagged for whoever picks that
// up), same as the PK-opponent / guest-broadcast clients already get
// filtered by role elsewhere in this app rather than by a magic uid, but
// this constant is available for that if a role-based filter isn't handy
// in some future call site.
const RECORDING_BOT_UID = Number(process.env.AGORA_RECORDING_UID) || 999999;

async function _agoraRecordingRequest(path, body) {
    const auth = _agoraRecordingAuthHeader();
    if (!auth) throw new Error('AGORA_CUSTOMER_KEY/AGORA_CUSTOMER_SECRET not configured');
    const appId = process.env.AGORA_APP_ID;
    const url = `https://api.agora.io/v1/apps/${appId}/cloud_recording/${path}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': auth },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = (data && (data.reason || data.message)) || `Agora Cloud Recording HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

// Numeric vendor code per Agora's storageConfig.vendor spec (e.g. 1 = AWS
// S3, 2 = Alibaba Cloud OSS, 5 = Tencent COS, 6 = AWS S3-compatible/MinIO,
// 7 = Qiniu — set RECORDING_STORAGE_VENDOR to whatever numeric code
// matches your actual bucket; this route doesn't hardcode a single vendor
// so it isn't locked to one cloud provider).
function _storageConfig() {
    return {
        vendor: Number(process.env.RECORDING_STORAGE_VENDOR),
        region: Number(process.env.RECORDING_STORAGE_REGION) || 0,
        bucket: process.env.RECORDING_BUCKET,
        accessKey: process.env.RECORDING_ACCESS_KEY,
        secretKey: process.env.RECORDING_SECRET_KEY,
        fileNamePrefix: ['empyrean-replays']
    };
}

// ── /api/agora-recording/start ────────────────────────────────────────
// Called once, when the host opts into recording (v57's client code —
// see that file's own header for the fallback-to-device-recording
// behavior when recording.cloudAvailable is false in /api/config).
app.post('/api/agora-recording/start', async (req, res) => {
    const { channelName, hostId, hostName, hostAvatar, title, streamId } = req.body || {};
    if (!channelName) return res.status(400).json({ error: 'channelName required' });
    if (!_recordingConfigured()) return res.status(500).json({ error: 'Cloud recording not configured on server', cloudAvailable: false });
    if (_activeRecordings.has(channelName)) return res.status(409).json({ error: 'Recording already in progress for this channel' });

    let RtcTokenBuilder, RtcRole;
    try { ({ RtcTokenBuilder, RtcRole } = require('agora-access-token')); }
    catch (err) { return res.status(500).json({ error: 'Server missing agora-access-token dependency' }); }

    const uidStr = String(RECORDING_BOT_UID);
    try {
        // 1. acquire a resourceId for this (channel, recording-uid) pair.
        const acquireData = await _agoraRecordingRequest(`acquire`, {
            cname: channelName,
            uid: uidStr,
            clientRequest: { resourceExpiredHour: 24 }
        });
        const resourceId = acquireData.resourceId;
        if (!resourceId) throw new Error('Agora did not return a resourceId');

        // The recording bot needs its own valid RTC token to join, same as
        // any other participant — PUBLISHER role, matching Agora's own
        // cloud-recording samples (the recording service subscribes to
        // every OTHER publisher in the channel; it doesn't need to be able
        // to publish itself, but Agora's documented examples consistently
        // use PUBLISHER for the recording uid's own token, so this matches
        // that precedent rather than an unproven SUBSCRIBER-only variant).
        const expirationTimeInSeconds = 24 * 3600;
        const privilegeExpiredTs = Math.floor(Date.now() / 1000) + expirationTimeInSeconds;
        const recordingToken = RtcTokenBuilder.buildTokenWithUid(
            process.env.AGORA_APP_ID, process.env.AGORA_APP_CERTIFICATE,
            channelName, RECORDING_BOT_UID, RtcRole.PUBLISHER, privilegeExpiredTs
        );

        // 2. start mix-mode (single composited output) recording.
        const startData = await _agoraRecordingRequest(`resourceid/${resourceId}/mode/mix/start`, {
            cname: channelName,
            uid: uidStr,
            clientRequest: {
                token: recordingToken,
                recordingConfig: {
                    channelType: 1,          // live broadcast mode, matching how this app's own host/viewer clients join
                    streamTypes: 2,          // audio + video
                    maxIdleTime: 300,        // auto-stop if the channel goes empty for 5 minutes (host disconnected without tapping stop)
                    transcodingConfig: {
                        width: 1280, height: 720, fps: 30, bitrate: 2000,
                        mixedVideoLayout: 1  // best-fit floating layout across all publishers — no manual per-participant positioning needed
                    }
                },
                storageConfig: _storageConfig()
            }
        });
        const sid = startData.sid;
        if (!sid) throw new Error('Agora did not return a sid');

        const record = { resourceId, sid, uid: uidStr, hostId, hostName, hostAvatar, title, streamId, startedAt: Date.now() };
        _activeRecordings.set(channelName, record);

        // Crash-recovery mirror — see header. Best-effort: a failure here
        // doesn't fail the request, since the recording itself is already
        // running server-side on Agora's end regardless.
        const admin = _getAdmin();
        if (admin) {
            admin.firestore().collection('live_recordings').doc(channelName)
                .set({ ...record, startedAtIso: new Date().toISOString() })
                .catch(err => console.warn('[CloudRecording] backup write failed:', err.message));
        }

        console.log('[CloudRecording] started for channel', channelName, '- resourceId', resourceId, 'sid', sid);
        res.json({ recording: true, resourceId, sid });
    } catch (err) {
        console.error('[CloudRecording] start failed for', channelName, '-', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── /api/agora-recording/stop ─────────────────────────────────────────
// Stops the recording, resolves the resulting file into a playable URL,
// and writes the SAME stream_replays doc shape v57's own client-side path
// already writes (id, streamId, hostId, hostName, hostAvatar, title,
// videoUrl, durationSec, createdAt, views) plus source:'cloud' so the
// existing Replays browser/player (built once, in v57, for the device-
// recording path) plays this back with zero changes on that side —
// exactly the "same doc shape, new producer" reuse this session's earlier
// work (firebase-rules.js, the scheduled-stream reminder watcher) already
// leaned on wherever possible instead of building a second, parallel UI.
app.post('/api/agora-recording/stop', async (req, res) => {
    const { channelName } = req.body || {};
    if (!channelName) return res.status(400).json({ error: 'channelName required' });

    let record = _activeRecordings.get(channelName);
    if (!record) {
        // Recovery path: this process may have restarted since start() ran.
        const admin = _getAdmin();
        if (admin) {
            try {
                const snap = await admin.firestore().collection('live_recordings').doc(channelName).get();
                if (snap.exists) record = snap.data();
            } catch (e) { /* fall through to the 404 below */ }
        }
    }
    if (!record) return res.status(404).json({ error: 'No active recording found for this channel' });

    try {
        const stopData = await _agoraRecordingRequest(
            `resourceid/${record.resourceId}/sid/${record.sid}/mode/mix/stop`,
            { cname: channelName, uid: record.uid, clientRequest: {} }
        );
        _activeRecordings.delete(channelName);
        const admin = _getAdmin();
        if (admin) admin.firestore().collection('live_recordings').doc(channelName).delete().catch(() => {});

        // serverResponse.fileList: an array (mix mode with a single
        // composited output typically returns one entry) of
        // { fileName, trackType, uid, mixedAllUser, isPlayable, sliceStartTime }.
        // fileName is the object's path/key inside the configured bucket —
        // turned into a public URL via RECORDING_PUBLIC_BASE_URL (the
        // bucket's own public/CDN base, set once in Render env, not
        // derived/guessed here since bucket URL shape differs per vendor
        // and per whether a CDN sits in front of it).
        const fileList = (stopData.serverResponse && stopData.serverResponse.fileList) || [];
        const playable = fileList.find(f => f.isPlayable !== false) || fileList[0];
        const base = (process.env.RECORDING_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
        const videoUrl = (playable && base) ? `${base}/${playable.fileName}`.replace(/([^:]\/)\/+/g, '$1') : '';

        const durationSec = record.startedAt ? Math.round((Date.now() - record.startedAt) / 1000) : null;
        let replayId = null, savedToReplays = false;

        if (videoUrl && admin) {
            replayId = 'replay_' + (record.streamId || channelName) + '_' + Date.now();
            try {
                await admin.firestore().collection('stream_replays').doc(replayId).set({
                    id: replayId,
                    streamId: record.streamId || null,
                    hostId: record.hostId || null,
                    hostName: record.hostName || 'Host',
                    hostAvatar: record.hostAvatar || '',
                    title: record.title || 'Live stream',
                    videoUrl,
                    durationSec,
                    createdAt: new Date().toISOString(),
                    views: 0,
                    source: 'cloud' // distinguishes a true multi-participant composited replay from v57's own device-recorded ones — additive field, existing player doesn't need to read it to keep working
                });
                savedToReplays = true;
            } catch (err) {
                console.error('[CloudRecording] failed to write stream_replays doc:', err.message);
            }
        } else if (!videoUrl) {
            console.warn('[CloudRecording] stopped', channelName, 'but no playable file/RECORDING_PUBLIC_BASE_URL to build a URL from — nothing saved to stream_replays.');
        }

        console.log('[CloudRecording] stopped for channel', channelName, savedToReplays ? '- saved as ' + replayId : '- not saved (see warning above)');
        res.json({ stopped: true, videoUrl: videoUrl || null, replayId, savedToReplays, fileList });
    } catch (err) {
        console.error('[CloudRecording] stop failed for', channelName, '-', err.message);
        res.status(500).json({ error: err.message });
    }
});


// ── /api/admin/bulk-disburse/* ── CSV bulk disbursement via Flutterwave
//    Transfers API (server-to-server, not the Checkout popup — see the
//    header comment in bulk-disburse-routes.js for why). Reuses the same
//    lazy Firebase Admin getter (_getAdmin, declared below — function
//    declarations hoist, so this reference is safe) that the OGP preview
//    routes use, so there's only ever one admin.initializeApp() call no
//    matter which route triggers it first.
const createBulkDisburseRouter = require('./bulk-disburse-routes');
app.use('/api/admin/bulk-disburse', createBulkDisburseRouter(_getAdmin));

// ── /api/earnings/* ── Payment System Restructuring — earnings segmentation
//    (Rewards System / Gifting & Tipping withdrawals / Advert Revenue kept
//    as three independently-gated balances). Same lazy-admin-getter mount
//    pattern as bulk-disburse above — see earnings-routes.js's own header
//    comment for the full model.
const createEarningsRouter = require('./earnings-routes');
app.use('/api/earnings', createEarningsRouter(_getAdmin));

// ── /api/watermark/* ── Server-side .mp4 video watermark (ffmpeg) ─────────
//    Real .mp4 counterpart to app-fixes.js's client-only canvas/MediaRecorder
//    watermark engine (which can only ever produce .webm) — see
//    watermark-routes.js's own header for the full design and its bottom
//    "CLIENT INTEGRATION" note for how app-reel.js / app-video-fullscreen.js /
//    app-fixes.js's own multi-file download handler call this ahead of that
//    client engine, falling back to it (then to a plain download) on any
//    failure. Same lazy-admin-getter mount pattern as bulk-disburse/earnings
//    above — this route is Bearer-gated for any authenticated user, not
//    admin-only (see _requireAuthedUid in watermark-routes.js), so it does
//    NOT reuse bulk-disburse-routes.js's ADMIN_EMAILS gate.
const createWatermarkRouter = require('./watermark-routes');
app.use('/api/watermark', createWatermarkRouter(_getAdmin));

// ── /api/media/download ── generic download proxy (CORS-immune) ──────────
//    Streams any allowed-host media URL back with a real
//    Content-Disposition: attachment header, fetched server-to-server so
//    the browser's CORS policy never applies. Added because Firebase
//    Storage/GCS (this app's current upload target — see media-uploads.md)
//    don't send CORS headers the way Cloudinary did by default, which was
//    silently breaking every client-side fetch+blob download path. See
//    media-download-routes.js's own header for the full explanation and
//    its client-side usage in app-fixes.js's _mediaProxyUrl/
//    _fetchWithProgress. No admin getter needed — this route touches no
//    Firestore/Auth, just proxies an already-public media URL.
const createMediaDownloadRouter = require('./media-download-routes');
// _getAdmin passed through (same lazy Firebase Admin getter every other
// admin route in this file already shares — see createBulkDisburseRouter's
// identical wiring just above) so the new admin-only POST /api/media/purge
// route (content-removal media deletion) can verify a bearer token and
// reach Admin Storage, without media-download-routes.js opening a second,
// independent Admin SDK instance of its own.
app.use('/api/media', createMediaDownloadRouter(_getAdmin));

// ── LIVE POLLS ── admin poll tickets, click-to-vote, real-time progress
//    bars, CSV export.
//
//    Poll creation/close and the vote COUNTS themselves are ordinary
//    client-side Firestore writes/reads from app-admin.js (create/close,
//    admin-gated the same client-side way every other admin-only write in
//    this app already is) and app-feed.js (the participant voting widget,
//    read directly off the poll doc via onSnapshot for live bars). Only
//    the two pieces below genuinely need a server, and live here rather
//    than as client code:
//
//      1. POST /api/polls/:id/vote-guest — a SIGNED-IN vote is guarded by
//         a client-side Firestore transaction against polls/{id}/voters/
//         {uid} (see app-feed.js), which works because a uid can't be
//         forged by the caller. A GUEST vote has no uid to key off — a
//         guest could clear localStorage and reload to vote again, so
//         "have they already voted" has to be answered from something the
//         client can't fake: the actual TCP-layer request IP. That can
//         only be read server-side.
//
//      2. POST /api/polls/:id/respond-guest (2026-09-26) — the same problem
//         for the newer 'collect' (data-collection) poll type: a signed-in
//         member's response is guarded client-side against
//         polls/{id}/responses/{uid}; a guest has no uid, so this mirrors
//         vote-guest's IP-hash approach against polls/{id}/responses
//         instead, bumping totalResponses in the same transaction.
//
//      3. GET /api/admin/polls/:id/export-csv — aggregates every doc in
//         polls/{id}/voters, OR — for a 'collect' poll — polls/{id}/responses
//         (either can run into the thousands) into one CSV server-side via
//         the Admin SDK, rather than round-tripping every voter/response doc
//         through an admin's browser just to build a file.
//
//    Reuses the exact same bearer-ID-token + ADMIN_EMAILS gate pattern
//    every other admin route in this file already uses (see
//    WITHDRAWAL_ADMIN_EMAILS / AD_REVENUE_ADMIN_EMAILS above) — duplicated
//    on purpose, same reasoning as those: money/content-affecting routes
//    each keep their own explicit admin check rather than trusting a
//    shared one silently.
const POLLS_ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];

async function _requireAdminForPolls(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        const isAdmin = decoded.admin === true || POLLS_ADMIN_EMAILS.includes(decoded.email);
        if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

// FEATURE (2026-09-27 — server-side enforcement for data-collection
// responses): a SIGNED-IN response used to be written straight from the
// browser via a client Firestore transaction (app-feed.js's
// _submitAnswersAuthenticated/_updateAnswersAuthenticated/
// _withdrawAnswersAuthenticated) — real for "did I already respond"
// (Firestore rules can check request.auth.uid against the doc id, which
// can't be forged) but NOT for whether the answers themselves actually
// matched the poll's own question list: a required question could be
// left blank, a single_choice/multi_choice answer could be any string at
// all rather than one of the poll's real choice ids, and a
// signature/file_upload answer could be any string at all rather than a
// URL actually pointing at this app's own storage — none of that is
// something Firestore security rules can practically check per-question
// (rules have no per-element loop over a dynamic-length array against a
// dynamic key). So, mirroring how /api/polls/:id/respond-guest already
// has to validate a GUEST'S answers server-side (a guest has no uid
// rules could trust), every response write — guest AND signed-in — now
// goes through this file via the Admin SDK, which bypasses Firestore
// rules entirely and lets real per-question-type validation run in one
// place (_validateCollectAnswers below) for both paths. The matching
// Firestore rules (firebase-rules.js) now deny direct client writes to
// polls/{id}/responses/{uid} altogether — same pattern already used for
// empyBalance/staking fields once those moved server-side.
//
// This gate differs from _requireAdminForPolls above only in NOT
// requiring admin — any signed-in user may submit/edit/withdraw their
// OWN response; the route handlers below additionally check the doc id
// (or, for submit, generate it) against decoded.uid so nobody can act on
// someone else's response.
async function _requireAuthedUidForPolls(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Please sign in.' }); return null; }
    try {
        return await admin.auth().verifyIdToken(m[1]);
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired session — please sign in again.' });
        return null;
    }
}

// Trusted hosts for a signature/file_upload answer's stored URL — the only
// two places window.uploadToCloudinary (app-dom.js) can ever resolve a
// permanent URL to: Firebase Storage (current uploads) or the legacy
// res.cloudinary.com host (pre-migration assets/fallback). Anything else —
// a data: URI, a javascript: URI, an arbitrary third-party host — is
// rejected outright: these values get rendered back as <img src> (signature)
// or <a href> (file) in every viewer's browser, including the poll
// creator's export tooling, so accepting an arbitrary string here would be
// a stored-content injection vector, not just a data-quality one.
const POLL_ANSWER_URL_HOSTS_RE = /^https:\/\/(firebasestorage\.googleapis\.com|res\.cloudinary\.com)\//i;

// Validates ONE answer against its question's declared answerType/required/
// choices, returning { ok:true, value } (the cleaned value to actually
// store) or { ok:false, error }. Shared by the guest and authenticated
// respond routes below so the two paths can never quietly drift apart.
// `guestMode` additionally refuses a signature/file_upload value outright
// (not just when required) — those two types are gated to signed-in users
// client-side already (a guest has no uid for Storage to authorize an
// upload against), so a guest request that somehow includes one is either
// a stale/buggy client or a crafted request, not a legitimate answer.
function _validateCollectAnswer(q, raw, guestMode) {
    var required = q.required !== false;
    var isEmpty = raw === undefined || raw === null || raw === '' ||
        (Array.isArray(raw) && raw.length === 0);

    if (q.answerType === 'single_choice') {
        if (isEmpty) return required ? { ok: false, error: 'missing-required' } : { ok: true, value: '' };
        if (typeof raw !== 'string') return { ok: false, error: 'bad-answer-shape' };
        var choiceIds = (q.choices || []).map(function (c) { return c.id; });
        if (choiceIds.indexOf(raw) === -1) return { ok: false, error: 'bad-choice' };
        return { ok: true, value: raw };
    }

    if (q.answerType === 'multi_choice') {
        if (isEmpty) return required ? { ok: false, error: 'missing-required' } : { ok: true, value: [] };
        if (!Array.isArray(raw)) return { ok: false, error: 'bad-answer-shape' };
        var validIds = (q.choices || []).map(function (c) { return c.id; });
        var seen = {};
        var cleaned = [];
        for (var i = 0; i < raw.length; i++) {
            var v = raw[i];
            if (typeof v !== 'string' || validIds.indexOf(v) === -1) return { ok: false, error: 'bad-choice' };
            if (!seen[v]) { seen[v] = true; cleaned.push(v); }
        }
        if (required && cleaned.length === 0) return { ok: false, error: 'missing-required' };
        return { ok: true, value: cleaned };
    }

    if (q.answerType === 'signature' || q.answerType === 'file_upload') {
        if (isEmpty) return required ? { ok: false, error: 'missing-required' } : { ok: true, value: '' };
        if (guestMode) return { ok: false, error: 'signin-required-for-type' };
        if (typeof raw !== 'string' || raw.length > 700 || !POLL_ANSWER_URL_HOSTS_RE.test(raw)) {
            return { ok: false, error: 'bad-file-url' };
        }
        return { ok: true, value: raw };
    }

    // short / paragraph (and any future unrecognized type falls back to
    // this, matching _answerDisplay's own fallback in app-feed.js)
    if (isEmpty) return required ? { ok: false, error: 'missing-required' } : { ok: true, value: '' };
    if (typeof raw !== 'string') return { ok: false, error: 'bad-answer-shape' };
    var maxLen = q.answerType === 'paragraph' ? 1000 : 300;
    return { ok: true, value: raw.trim().slice(0, maxLen) };
}

// Validates every question in one pass. Returns { ok:true, cleaned } or
// { ok:false, error, questionId } (questionId included so a future client
// could point the respondent at exactly which question failed, though the
// current callers just surface a generic message).
function _validateCollectAnswers(questions, answersIn, guestMode) {
    var answers = (answersIn && typeof answersIn === 'object' && !Array.isArray(answersIn)) ? answersIn : {};
    var cleaned = {};
    for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        var result = _validateCollectAnswer(q, answers[q.id], !!guestMode);
        if (!result.ok) return { ok: false, error: result.error, questionId: q.id };
        cleaned[q.id] = result.value;
    }
    return { ok: true, cleaned: cleaned };
}

function _collectValidationErrorMessage(code) {
    switch (code) {
        case 'missing-required': return 'Please answer every required question, then submit.';
        case 'bad-choice': return 'One of your answers doesn\u2019t match an available choice — please re-select and try again.';
        case 'bad-answer-shape': return 'One of your answers was in an unexpected format — please try again.';
        case 'bad-file-url': return 'One of your uploaded files/signatures couldn\u2019t be verified — please re-upload and try again.';
        case 'signin-required-for-type': return 'Please sign in to provide a signature or upload a file.';
        default: return 'Please check your answers and try again.';
    }
}

// This app does not call `app.set('trust proxy', ...)` anywhere (checked —
// setting it globally would also change req.ip/req.secure/req.protocol for
// every OTHER route in this file, which is out of scope for this feature),
// so req.ip on Render is the load balancer's own address, not the visitor's.
// Render (and effectively every host behind a reverse proxy) puts the real
// client IP as the FIRST entry of X-Forwarded-For — read that directly
// instead, falling back to the raw socket address only for local dev where
// the header won't be present at all.
function _pollsRealIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

// Never store a raw IP at rest — a poll's voters subcollection is readable
// by the CSV export above, and a raw IP there would be more than this
// feature needs to keep. A salted hash still lets the transaction below
// enforce "this IP already voted on THIS poll" (pollId is part of the
// hashed input, so the same visitor's hash differs poll to poll and can't
// be used to correlate them) without ever writing anything reversible.
const POLLS_IP_SALT = 'empyrean-live-polls-v1';
function _pollsGuestVoterId(ip, pollId) {
    return 'ip_' + crypto.createHash('sha256').update(POLLS_IP_SALT + '|' + pollId + '|' + ip).digest('hex').slice(0, 32);
}

app.post('/api/polls/:id/vote-guest', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    const { id } = req.params;
    const optionId = req.body && req.body.optionId;
    if (!optionId) return res.status(400).json({ error: 'optionId is required' });

    const ip = _pollsRealIp(req);
    const voterId = _pollsGuestVoterId(ip, id);

    const db = admin.firestore();
    const pollRef = db.collection('polls').doc(id);
    const voterRef = pollRef.collection('voters').doc(voterId);

    try {
        await db.runTransaction(async (tx) => {
            const voterSnap = await tx.get(voterRef);
            if (voterSnap.exists) { const err = new Error('already voted'); err.code = 'already-voted'; throw err; }

            const pollSnap = await tx.get(pollRef);
            if (!pollSnap.exists) { const err = new Error('poll not found'); err.code = 'poll-not-found'; throw err; }
            const data = pollSnap.data() || {};
            if (data.status !== 'open') { const err = new Error('poll closed'); err.code = 'poll-closed'; throw err; }

            const options = data.options || [];
            if (!options.some(o => o.id === optionId)) { const err = new Error('bad option'); err.code = 'bad-option'; throw err; }

            const updated = options.map(o => o.id === optionId ? Object.assign({}, o, { votes: (o.votes || 0) + 1 }) : o);
            tx.update(pollRef, { options: updated, totalVotes: (data.totalVotes || 0) + 1 });
            tx.set(voterRef, {
                optionId,
                votedAt: admin.firestore.FieldValue.serverTimestamp(),
                method: 'ip'
            });
        });
        res.json({ voted: true });
    } catch (err) {
        if (err.code === 'already-voted') return res.status(409).json({ error: 'You have already voted on this poll.' });
        if (err.code === 'poll-closed') return res.status(409).json({ error: 'This poll is closed.' });
        if (err.code === 'poll-not-found') return res.status(404).json({ error: 'Poll not found.' });
        if (err.code === 'bad-option') return res.status(400).json({ error: 'Invalid option.' });
        console.error('[Polls] vote-guest failed for', id, '-', err.message);
        res.status(500).json({ error: 'Could not record your vote. Please try again.' });
    }
});

// POST /api/polls/:id/respond-guest — the data-collection-poll counterpart
// to vote-guest just above, same reasoning: a signed-in response is guarded
// client-side by a polls/{id}/responses/{uid} doc (see app-feed.js's
// _submitAnswersAuthenticated), which works because a uid can't be forged;
// a guest has no uid, so "have they already responded" again has to come
// from the real request IP, which only the server can read. Mirrors
// vote-guest's transaction shape exactly (check-then-set inside one
// transaction, poll's aggregate field bumped by exactly 1 in the same
// commit) with 'responses'/'totalResponses' in place of 'voters'/
// 'totalVotes', and answers validated for count (must match the poll's own
// question list — same defense vote-guest applies to optionId) and length
// (each answer capped so a guest can't write an unbounded blob into a
// public-readable subcollection).
function _pollsGuestResponderId(ip, pollId) {
    // Separate 'resp_' prefix + its own hash namespace ('responses' folded
    // into the hashed input) so a guest's hashed ID for VOTING and for
    // RESPONDING on the same poll id can never collide — costs nothing and
    // rules out that whole class of bug even though no poll is both types.
    return 'resp_' + crypto.createHash('sha256').update(POLLS_IP_SALT + '|responses|' + pollId + '|' + ip).digest('hex').slice(0, 32);
}

app.post('/api/polls/:id/respond-guest', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    const { id } = req.params;
    // Matches app-feed.js's submit handler exactly: a map keyed by each
    // question's `id` (data-question-id -> input value), NOT a positional
    // array — the client builds it the same way for both the authenticated
    // and guest paths, so this route has to accept the identical shape.
    const answers = req.body && req.body.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return res.status(400).json({ error: 'answers is required' });
    }

    const ip = _pollsRealIp(req);
    const responderId = _pollsGuestResponderId(ip, id);

    const db = admin.firestore();
    const pollRef = db.collection('polls').doc(id);
    const responseRef = pollRef.collection('responses').doc(responderId);

    try {
        await db.runTransaction(async (tx) => {
            const respSnap = await tx.get(responseRef);
            if (respSnap.exists) { const err = new Error('already responded'); err.code = 'already-responded'; throw err; }

            const pollSnap = await tx.get(pollRef);
            if (!pollSnap.exists) { const err = new Error('poll not found'); err.code = 'poll-not-found'; throw err; }
            const data = pollSnap.data() || {};
            if (data.type !== 'collect') { const err = new Error('not a data-collection poll'); err.code = 'wrong-type'; throw err; }
            if (data.status !== 'open') { const err = new Error('poll closed'); err.code = 'poll-closed'; throw err; }

            // FIX (2026-09-27 — per-question-type validation): this used to
            // just require every question to be a non-empty trimmed string
            // capped at 2000 chars, regardless of the question's actual
            // answerType — which meant EVERY multi_choice guest submission
            // was silently rejected (its value is an array, so
            // `typeof v !== 'string'` always failed), a required:false
            // question could never actually be left blank, single_choice/
            // multi_choice accepted any string rather than a real choice
            // id, and a signature/file_upload URL was accepted unchecked.
            // Delegated to the same _validateCollectAnswers() the new
            // authenticated respond routes below use, with guestMode:true
            // so a signature/file_upload answer (which requires a signed-in
            // uploader — see that function's own comment) is refused
            // outright rather than silently accepted.
            const questions = data.questions || [];
            const validated = _validateCollectAnswers(questions, answers, true);
            if (!validated.ok) { const err = new Error(validated.error); err.code = 'bad-answers'; throw err; }

            tx.update(pollRef, { totalResponses: (data.totalResponses || 0) + 1 });
            tx.set(responseRef, {
                answers: validated.cleaned,
                respondentName: 'Guest',
                submittedAt: admin.firestore.FieldValue.serverTimestamp(),
                method: 'ip'
            });
        });
        res.json({ responded: true });
    } catch (err) {
        if (err.code === 'already-responded') return res.status(409).json({ error: 'You have already responded to this poll.' });
        if (err.code === 'poll-closed') return res.status(409).json({ error: 'This poll is closed.' });
        if (err.code === 'poll-not-found') return res.status(404).json({ error: 'Poll not found.' });
        if (err.code === 'wrong-type') return res.status(400).json({ error: 'This poll does not accept responses.' });
        if (err.code === 'bad-answers') return res.status(400).json({ error: _collectValidationErrorMessage(err.message) });
        console.error('[Polls] respond-guest failed for', id, '-', err.message);
        res.status(500).json({ error: 'Could not submit your response. Please try again.' });
    }
});

// POST/PATCH/DELETE /api/polls/:id/respond — the SIGNED-IN counterpart to
// respond-guest above, replacing app-feed.js's old direct-from-browser
// Firestore transaction (_submitAnswersAuthenticated/
// _updateAnswersAuthenticated/_withdrawAnswersAuthenticated) now that those
// three matching Firestore rules branches are locked to `if false` (see
// firebase-rules.js) — see _requireAuthedUidForPolls's comment above for
// why. Doc id is the responder's real Firebase Auth uid (decoded.uid),
// exactly as the old client-side rules already keyed it, so "have I
// responded" / "is this my response" still work the same way; the
// difference is entirely in WHO validates the write.
app.post('/api/polls/:id/respond', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthedUidForPolls(req, res, admin);
    if (!decoded) return;

    const { id } = req.params;
    const answers = req.body && req.body.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return res.status(400).json({ error: 'answers is required' });
    }

    const db = admin.firestore();
    const pollRef = db.collection('polls').doc(id);
    const responseRef = pollRef.collection('responses').doc(decoded.uid);

    try {
        await db.runTransaction(async (tx) => {
            const respSnap = await tx.get(responseRef);
            if (respSnap.exists) { const err = new Error('already responded'); err.code = 'already-responded'; throw err; }

            const pollSnap = await tx.get(pollRef);
            if (!pollSnap.exists) { const err = new Error('poll not found'); err.code = 'poll-not-found'; throw err; }
            const data = pollSnap.data() || {};
            if (data.type !== 'collect') { const err = new Error('not a data-collection poll'); err.code = 'wrong-type'; throw err; }
            if (data.status !== 'open') { const err = new Error('poll closed'); err.code = 'poll-closed'; throw err; }

            const questions = data.questions || [];
            const validated = _validateCollectAnswers(questions, answers, false);
            if (!validated.ok) { const err = new Error(validated.error); err.code = 'bad-answers'; throw err; }

            // Respondent display name is looked up server-side (users/{uid})
            // rather than trusted from the request body — the old client-
            // direct write let the caller supply any respondentName string
            // it liked, which is exactly the kind of thing moving this
            // server-side is meant to close off.
            let respondentName = 'Member';
            try {
                const userSnap = await tx.get(db.collection('users').doc(decoded.uid));
                if (userSnap.exists) {
                    const ud = userSnap.data() || {};
                    respondentName = ud.fullName || ud.username || decoded.name || 'Member';
                }
            } catch (_) { /* fall back to 'Member' — a lookup failure shouldn't block a response */ }

            tx.update(pollRef, { totalResponses: (data.totalResponses || 0) + 1 });
            tx.set(responseRef, {
                answers: validated.cleaned,
                respondentName: respondentName,
                submittedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        res.json({ responded: true });
    } catch (err) {
        if (err.code === 'already-responded') return res.status(409).json({ error: 'You have already responded to this poll.' });
        if (err.code === 'poll-closed') return res.status(409).json({ error: 'This poll is closed.' });
        if (err.code === 'poll-not-found') return res.status(404).json({ error: 'Poll not found.' });
        if (err.code === 'wrong-type') return res.status(400).json({ error: 'This poll does not accept responses.' });
        if (err.code === 'bad-answers') return res.status(400).json({ error: _collectValidationErrorMessage(err.message) });
        console.error('[Polls] respond failed for', id, '-', err.message);
        res.status(500).json({ error: 'Could not submit your response. Please try again.' });
    }
});

app.patch('/api/polls/:id/respond', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthedUidForPolls(req, res, admin);
    if (!decoded) return;

    const { id } = req.params;
    const answers = req.body && req.body.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return res.status(400).json({ error: 'answers is required' });
    }

    const db = admin.firestore();
    const pollRef = db.collection('polls').doc(id);
    const responseRef = pollRef.collection('responses').doc(decoded.uid);

    try {
        await db.runTransaction(async (tx) => {
            const respSnap = await tx.get(responseRef);
            if (!respSnap.exists) { const err = new Error('no response to edit'); err.code = 'no-response'; throw err; }

            const pollSnap = await tx.get(pollRef);
            const data = (pollSnap.exists && pollSnap.data()) || {};
            if (pollSnap.exists && data.status !== 'open') { const err = new Error('poll closed'); err.code = 'poll-closed'; throw err; }

            const questions = data.questions || [];
            const validated = _validateCollectAnswers(questions, answers, false);
            if (!validated.ok) { const err = new Error(validated.error); err.code = 'bad-answers'; throw err; }

            tx.update(responseRef, {
                answers: validated.cleaned,
                editedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        res.json({ updated: true });
    } catch (err) {
        if (err.code === 'no-response') return res.status(404).json({ error: 'No existing response to edit.' });
        if (err.code === 'poll-closed') return res.status(409).json({ error: 'This poll is closed.' });
        if (err.code === 'bad-answers') return res.status(400).json({ error: _collectValidationErrorMessage(err.message) });
        console.error('[Polls] respond edit failed for', id, '-', err.message);
        res.status(500).json({ error: 'Could not update your response. Please try again.' });
    }
});

app.delete('/api/polls/:id/respond', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthedUidForPolls(req, res, admin);
    if (!decoded) return;

    const { id } = req.params;
    const db = admin.firestore();
    const pollRef = db.collection('polls').doc(id);
    const responseRef = pollRef.collection('responses').doc(decoded.uid);

    try {
        await db.runTransaction(async (tx) => {
            const respSnap = await tx.get(responseRef);
            if (!respSnap.exists) { const err = new Error('no response to withdraw'); err.code = 'no-response'; throw err; }
            const pollSnap = await tx.get(pollRef);
            if (pollSnap.exists) {
                const pd = pollSnap.data() || {};
                tx.update(pollRef, { totalResponses: Math.max(0, (pd.totalResponses || 0) - 1) });
            }
            tx.delete(responseRef);
        });
        res.json({ withdrawn: true });
    } catch (err) {
        if (err.code === 'no-response') return res.status(404).json({ error: 'No existing response to withdraw.' });
        console.error('[Polls] respond withdraw failed for', id, '-', err.message);
        res.status(500).json({ error: 'Could not withdraw your response. Please try again.' });
    }
});

// DELETE /api/polls/:id (2026-09-29 — "clicking delete on a poll / data collection card does
// nothing"): the poll's creator or an admin can delete it. Done here with the Admin SDK so it does not
// depend on the polls/{id} Firestore delete rule, and so the poll's votes / responses / comments /
// viewer-presence sub-collections go with it (a client-side delete can't cascade — those used to be
// left behind as orphans). Same auth gate as the respond routes above; ownership/admin is checked
// against the stored createdByUid and the same admin rule as _requireAdminForPolls.
app.delete('/api/polls/:id', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthedUidForPolls(req, res, admin);
    if (!decoded) return;

    const { id } = req.params;
    const db = admin.firestore();
    const pollRef = db.collection('polls').doc(id);
    try {
        const snap = await pollRef.get();
        if (!snap.exists) return res.json({ deleted: true, alreadyGone: true });
        const pd = snap.data() || {};
        const isAdmin = decoded.admin === true || POLLS_ADMIN_EMAILS.includes(decoded.email);
        const isOwner = !!pd.createdByUid && pd.createdByUid === decoded.uid;
        if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Only the poll creator or an admin can delete this poll.' });

        if (typeof db.recursiveDelete === 'function') {
            await db.recursiveDelete(pollRef);
        } else {
            for (const sub of await pollRef.listCollections()) {
                const docs = await sub.listDocuments();
                for (let i = 0; i < docs.length; i += 400) {
                    const batch = db.batch();
                    docs.slice(i, i + 400).forEach((d) => batch.delete(d));
                    await batch.commit();
                }
            }
            await pollRef.delete();
        }
        res.json({ deleted: true });
    } catch (err) {
        console.error('[Polls] delete failed for', id, '-', err.message);
        res.status(500).json({ error: 'Could not delete the poll. Please try again.' });
    }
});

app.get('/api/admin/polls/:id/export-csv', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    const decoded = await _requireAdminForPolls(req, res, admin);
    if (!decoded) return;

    const { id } = req.params;
    const db = admin.firestore();

    function _csvCell(v) {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function _csvRow(cells) { return cells.map(_csvCell).join(','); }

    try {
        const pollSnap = await db.collection('polls').doc(id).get();
        if (!pollSnap.exists) return res.status(404).json({ error: 'Poll not found' });
        const poll = pollSnap.data() || {};

        const lines = [];
        lines.push(_csvRow(['Question', poll.question || '']));
        lines.push(_csvRow(['Topic', poll.topic || '']));
        lines.push(_csvRow(['Status', poll.status || '']));

        // 2026-09-26: data-collection polls (type:'collect') have no
        // options/voters to export — they have questions/responses instead.
        // Branch the whole export rather than bolt collect fields onto the
        // choice-poll shape below, since the two have nothing in common past
        // the three header lines just above. Existing (pre-type) polls have
        // no `type` field, which `!== 'collect'` (same guard app-feed.js
        // uses) correctly routes into the untouched choice-poll branch.
        if (poll.type === 'collect') {
            const questions = poll.questions || [];
            const responsesSnap = await db.collection('polls').doc(id).collection('responses').get();

            lines.push(_csvRow(['Total Responses', poll.totalResponses || 0]));
            lines.push('');
            lines.push(_csvRow(['Respondent', 'Submitted At'].concat(questions.map(q => q.text || ''))));
            responsesSnap.forEach(doc => {
                const r = doc.data() || {};
                const submittedAt = r.submittedAt && r.submittedAt.toDate ? r.submittedAt.toDate().toISOString() : '';
                const answers = questions.map((q, i) => (r.answers && r.answers[q.id] != null) ? r.answers[q.id] : '');
                lines.push(_csvRow([r.respondentName || '', submittedAt].concat(answers)));
            });
        } else {
            const optionTextById = {};
            (poll.options || []).forEach(o => { optionTextById[o.id] = o.text; });
            const total = poll.totalVotes || 0;

            const votersSnap = await db.collection('polls').doc(id).collection('voters').get();

            lines.push(_csvRow(['Total Votes', total]));
            lines.push('');
            lines.push(_csvRow(['Option', 'Votes', 'Percentage']));
            (poll.options || []).forEach(o => {
                const pct = total > 0 ? ((o.votes || 0) / total * 100).toFixed(1) : '0.0';
                lines.push(_csvRow([o.text || '', o.votes || 0, pct + '%']));
            });
            lines.push('');
            lines.push(_csvRow(['Voter ID', 'Chosen Option', 'Method', 'Voted At']));
            votersSnap.forEach(doc => {
                const v = doc.data() || {};
                const votedAt = v.votedAt && v.votedAt.toDate ? v.votedAt.toDate().toISOString() : '';
                lines.push(_csvRow([doc.id, optionTextById[v.optionId] || v.optionId || '', v.method || '', votedAt]));
            });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="poll-' + id + '-results.csv"');
        res.send(lines.join('\n'));
    } catch (err) {
        console.error('[Polls] export-csv failed for', id, '-', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/election/results ── 2027 election results feed for
//    app-patch-v49-v50.js's Election Hub dashboard tab. INEC has no
//    public API, and the election itself is Jan 16, 2027 — until
//    INEC_RESULTS_URL is set (Render env var), this returns a clearly-
//    labeled provisional/zero state (matches the mock-up's own "Results
//    are provisional" footer disclaimer). When set, tries JSON first,
//    then a generic best-effort HTML scrape as a starting point for
//    whatever page ends up hosting results — not a finished scraper for
//    a specific page whose markup isn't public yet. Party/candidate
//    pairings verified against INEC's actual final 2027 candidates' list
//    (Atiku → ADC, not PDP; Obi → NDC).
(function mountElectionResults() {
    const ELECTION_CANDIDATES = [
        { id: 'tinubu', name: 'Bola Ahmed Tinubu', party: 'APC' },
        { id: 'atiku',  name: 'Atiku Abubakar',     party: 'ADC' },
        { id: 'obi',    name: 'Peter Obi',          party: 'NDC' },
        { id: 'sowore', name: 'Omoyele Sowore',     party: 'AAC' }
    ];
    let _electionCache = { data: null, ts: 0 };
    const ELECTION_CACHE_MS = 5 * 60 * 1000; // avoid hammering whatever source gets configured

    // Generic fallback: look for a candidate's surname, then the first
    // run of digits within a short window after it, and treat that as a
    // vote count. Deliberately simple — a starting point to adapt once a
    // real results page/feed and its markup are known, not a guarantee
    // it parses correctly on day one.
    function _electionScrapeHtml(html) {
        const out = ELECTION_CANDIDATES.map(c => ({ id: c.id, name: c.name, party: c.party, votes: 0 }));
        let found = false;
        out.forEach(row => {
            const needle = row.name.split(' ').pop();
            const idx = html.indexOf(needle);
            if (idx === -1) return;
            const m = html.slice(idx, idx + 400).match(/([\d,]{3,})/);
            if (m) {
                const n = parseInt(m[1].replace(/,/g, ''), 10);
                if (!isNaN(n)) { row.votes = n; found = true; }
            }
        });
        return found ? out : null;
    }

    async function _electionFetchLive() {
        const url = process.env.INEC_RESULTS_URL;
        if (!url) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let res;
        try {
            res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'EmpyreanApp/1.0 (+election-dashboard)' } });
        } finally {
            clearTimeout(timeout);
        }
        if (!res.ok) throw new Error('source responded ' + res.status);
        const raw = await res.text();

        // Try JSON first — a data-partner API or hand-maintained feed is
        // far more likely to be JSON than a scrape of INEC's own site.
        try {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.candidates)) {
                return {
                    live: true,
                    updatedAt: new Date().toISOString(),
                    electionDate: '2027-01-16',
                    source: 'configured-feed',
                    candidates: ELECTION_CANDIDATES.map(c => {
                        const match = parsed.candidates.find(p => p.id === c.id || p.party === c.party) || {};
                        return { id: c.id, name: c.name, party: c.party, votes: match.votes || 0 };
                    }),
                    note: parsed.note || null
                };
            }
        } catch (eJson) { /* not JSON — fall through to HTML scrape */ }

        const scraped = _electionScrapeHtml(raw);
        if (scraped) {
            return {
                live: true,
                updatedAt: new Date().toISOString(),
                electionDate: '2027-01-16',
                source: 'configured-feed-html',
                candidates: scraped,
                note: 'Parsed via a generic best-effort scrape — verify against the source directly.'
            };
        }
        return null; // configured but nothing recognizable came back
    }

    function _electionEmptyPayload() {
        return {
            live: false,
            updatedAt: new Date().toISOString(),
            electionDate: '2027-01-16',
            source: process.env.INEC_RESULTS_URL ? 'configured-feed' : 'none-configured',
            candidates: ELECTION_CANDIDATES.map(c => ({ id: c.id, name: c.name, party: c.party, votes: 0 })),
            note: 'INEC has not published results for this election yet.'
        };
    }

    app.get('/api/election/results', async (req, res) => {
        try {
            if (_electionCache.data && (Date.now() - _electionCache.ts) < ELECTION_CACHE_MS) {
                return res.json(_electionCache.data);
            }
            let payload = null;
            try {
                payload = await _electionFetchLive();
            } catch (err) {
                console.warn('[Election] live fetch failed:', err.message);
            }
            if (!payload) payload = _electionEmptyPayload();
            _electionCache = { data: payload, ts: Date.now() };
            res.json(payload);
        } catch (err) {
            console.error('[Election] /results error:', err.message);
            res.status(500).json({ error: 'Could not load election results.' });
        }
    });

    // ── POST /api/election/verify-result ── automatic image/tally
    //    consistency check for the public per-polling-unit uploader (see
    //    app-patch-v49-v50.js's renderResultsTab()/§3.5 — dev task list
    //    item 4: "the uploaded images and text entered in the result
    //    column must match accurately ... flagged immediately" if not).
    //    Sends the uploaded result-sheet photo(s) to Claude's vision API
    //    and asks it to read the tally straight off the sheet, then diffs
    //    that against what the uploader typed. This never blocks a
    //    submission — submitPuResult()'s once-per-polling-unit
    //    transaction (client-side) still runs regardless of the verdict
    //    here; this route only decides the `flagged`/`flagReason` fields
    //    stored alongside the result, matching the brief's "flagged" (not
    //    "rejected") wording.
    //    Requires ANTHROPIC_API_KEY (Render env var). Left unset, or if
    //    anything about the call fails, this fails OPEN — it answers
    //    `{ flagged: false, skipped: true }` rather than an error, same
    //    reasoning as /api/tts's missing-ELEVENLABS_API_KEY fallback
    //    above: an uploader submitting a real, good-faith result sheet
    //    shouldn't be blocked (or silently unflagged either way — see
    //    "skipped") by a misconfigured or down verification service.
    async function _verifyPuFetchImage(url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const r = await fetch(url, { signal: controller.signal });
            if (!r.ok) throw new Error('image fetch ' + r.status);
            const buf = Buffer.from(await r.arrayBuffer());
            const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
            return { media_type: ct, data: buf.toString('base64') };
        } finally {
            clearTimeout(timeout);
        }
    }

    app.post('/api/election/verify-result', async (req, res) => {
        try {
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) return res.json({ flagged: false, reason: null, skipped: true, note: 'Verification not configured.' });

            const imageUrls = Array.isArray(req.body && req.body.imageUrls) ? req.body.imageUrls.slice(0, 4) : [];
            const tally = (req.body && req.body.tally) || {};
            if (!imageUrls.length || !Object.keys(tally).length) {
                return res.status(400).json({ error: 'imageUrls and tally are required.' });
            }

            let images;
            try {
                images = await Promise.all(imageUrls.map(_verifyPuFetchImage));
            } catch (err) {
                return res.json({ flagged: false, reason: null, skipped: true, note: 'Could not fetch photo(s) for verification: ' + err.message });
            }

            const submittedLines = ELECTION_CANDIDATES.map(c =>
                c.name + ' (' + c.party + '): ' + (tally[c.id] != null ? tally[c.id] : 'not submitted')
            ).join('\n');

            const content = images.map(img => ({
                type: 'image',
                source: { type: 'base64', media_type: img.media_type, data: img.data }
            })).concat([{
                type: 'text',
                text: 'This is a photo of a polling unit election result sheet. Read the vote tally ' +
                    'for each of these candidates as written/printed on the sheet, as best you can:\n' +
                    ELECTION_CANDIDATES.map(c => '- ' + c.id + ': ' + c.name + ' (' + c.party + ')').join('\n') +
                    '\n\nThe uploader typed in these numbers:\n' + submittedLines +
                    '\n\nRespond with ONLY a JSON object, no other text, exactly shaped like:\n' +
                    '{"readable": true|false, "extracted": {"<candidateId>": <number|null>, ...}, ' +
                    '"mismatches": ["<candidateId>", ...], "note": "<short note, or null>"}\n' +
                    'Only include a candidateId in "mismatches" if the sheet CLEARLY shows a different ' +
                    'number than what was typed. If the sheet is blurry, cropped, or a number isn\u2019t ' +
                    'legible for a candidate, leave that candidate out of "mismatches" and set its ' +
                    '"extracted" value to null rather than guessing.'
            }]);

            const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-5',
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: content }]
                })
            });
            if (!apiRes.ok) {
                const errText = await apiRes.text().catch(function () { return ''; });
                console.warn('[Election] verify-result API error', apiRes.status, errText);
                return res.json({ flagged: false, reason: null, skipped: true, note: 'Verification service unavailable.' });
            }
            const data = await apiRes.json();
            const textBlock = (data.content || []).find(function (b) { return b.type === 'text'; });
            let parsed;
            try {
                const raw = ((textBlock && textBlock.text) || '').trim().replace(/^```json\s*|```$/g, '');
                parsed = JSON.parse(raw);
            } catch (err) {
                return res.json({ flagged: false, reason: null, skipped: true, note: 'Could not parse verification response.' });
            }

            const mismatches = Array.isArray(parsed.mismatches)
                ? parsed.mismatches.filter(function (id) { return ELECTION_CANDIDATES.some(function (c) { return c.id === id; }); })
                : [];
            const flagged = mismatches.length > 0;
            const reason = flagged
                ? 'Typed tally doesn\u2019t match the number(s) on the uploaded photo for: ' +
                  mismatches.map(function (id) { return (ELECTION_CANDIDATES.find(function (c) { return c.id === id; }) || {}).name || id; }).join(', ') +
                  (parsed.note ? ' \u2014 ' + parsed.note : '')
                : null;

            res.json({ flagged: flagged, reason: reason, extracted: parsed.extracted || null, readable: parsed.readable !== false });
        } catch (err) {
            console.error('[Election] /verify-result error:', err.message);
            res.json({ flagged: false, reason: null, skipped: true, note: 'Verification error.' });
        }
    });

    // ── Admin review of flagged polling-unit results (dev task list —
    //    "add a dismiss flag / remove result action to the admin panel's
    //    Election tab", following up on the auto-flag above). Two routes,
    //    same admin-bearer-token convention every other admin route in
    //    this file uses (own duplicated ADMIN_EMAILS + _requireAdminFor*
    //    helper — see _requireAdminForWithdrawalPayout/_requireAdminForAdRevenue/
    //    _requireAdminForMediaMigration above for the identical pattern).
    //    Deliberately real server routes rather than a Firestore rule
    //    change: firebase-rules.js wasn't part of this edit, and an
    //    admin-gated route here needs no rules-file change to ship.
    const ELECTION_FLAG_ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];

    async function _requireAdminForElectionFlag(req, res, admin) {
        const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
        if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
        try {
            const decoded = await admin.auth().verifyIdToken(m[1]);
            const isAdmin = decoded.admin === true || ELECTION_FLAG_ADMIN_EMAILS.includes(decoded.email);
            if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
            return decoded;
        } catch (err) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return null;
        }
    }

    // POST /api/admin/election/pu-results/:key/dismiss-flag — clears the
    // flag but keeps the result (e.g. the admin checked the photo
    // themselves and the numbers actually do match — the vision check
    // isn't infallible). Leaves images/tally/uploader info untouched;
    // only the flag-related fields change.
    app.post('/api/admin/election/pu-results/:key/dismiss-flag', async (req, res) => {
        const admin = _getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
        const decoded = await _requireAdminForElectionFlag(req, res, admin);
        if (!decoded) return;
        try {
            const ref = admin.firestore().collection('election_pu_results').doc(req.params.key);
            const snap = await ref.get();
            if (!snap.exists) return res.status(404).json({ error: 'Result not found.' });
            await ref.update({
                flagged: false,
                flagReason: null,
                flagDismissedBy: decoded.email || null,
                flagDismissedAt: new Date().toISOString()
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('[Election] dismiss-flag error:', err.message);
            res.status(500).json({ error: 'Could not dismiss flag.' });
        }
    });

    // DELETE /api/admin/election/pu-results/:key — removes the result
    // entirely (e.g. the photo was genuinely fake/wrong). This also frees
    // up the polling-unit key: submitPuResult()'s transaction only
    // blocks on a doc that still exists, so deleting here lets a fresh,
    // correct result be uploaded for the same polling unit afterward.
    app.delete('/api/admin/election/pu-results/:key', async (req, res) => {
        const admin = _getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
        const decoded = await _requireAdminForElectionFlag(req, res, admin);
        if (!decoded) return;
        try {
            const ref = admin.firestore().collection('election_pu_results').doc(req.params.key);
            const snap = await ref.get();
            if (!snap.exists) return res.status(404).json({ error: 'Result not found.' });
            await ref.delete();
            res.json({ ok: true });
        } catch (err) {
            console.error('[Election] delete pu-result error:', err.message);
            res.status(500).json({ error: 'Could not remove result.' });
        }
    });

    // GET /api/admin/election/pu-results/flagged — list for the admin
    // panel's review card (app-admin.js's initElectionFlagsPanel below).
    // Simple bearer-gated read, same admin check as the two mutating
    // routes just above.
    app.get('/api/admin/election/pu-results/flagged', async (req, res) => {
        const admin = _getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
        const decoded = await _requireAdminForElectionFlag(req, res, admin);
        if (!decoded) return;
        try {
            const snap = await admin.firestore().collection('election_pu_results')
                .where('flagged', '==', true)
                .orderBy('createdAt', 'desc')
                .limit(100)
                .get();
            const rows = [];
            snap.forEach(doc => rows.push(Object.assign({ key: doc.id }, doc.data())));
            res.json({ rows: rows });
        } catch (err) {
            console.error('[Election] list flagged pu-results error:', err.message);
            res.status(500).json({ error: 'Could not load flagged results.' });
        }
    });
})();

// ── /api/admin/withdrawals/:id/payout ── Real NGN bank payout ─────────────
// Fills the gap flagged in the MARKETPLACE ESCROW PAYOUT RULE comment near
// the top of this file: sellers accumulate real money in
// users/{sellerId}.fiatBalance.NGN from naira marketplace sales, but until
// now there was no route that could actually send it to their bank account.
//
// Scope, deliberately narrow: this route ONLY pays out
// withdrawal_requests/{id} docs where currency === 'NGN' AND method ===
// 'bank'. Those are always naira-earnings withdrawals — see
// app-marketplace-sellers.js's "Withdraw to Bank" flow, the only place that
// currency/method combination is ever written. Every other withdrawal
// (EMPY via empyrean-card/usdt/bank, i.e. the general wallet withdrawal
// form in app-patch-v48.js) is untouched by this route and keeps working
// exactly as before — approve there just flips Firestore status, no real
// transfer, because there's no real fiat behind an EMPY balance to move.
//
// Reuses bulk-disburse-routes.js's exported getBankList/resolveBankCode/
// resolveAccount/transfer instead of a second Flutterwave integration — see
// that file's own header comment for why Transfers (not Checkout) is the
// right API here, and why a 200 here means "accepted", not "settled".
//
// Auth: same bearer-ID-token + ADMIN_EMAILS gate bulk-disburse-routes.js's
// own _requireAdmin uses (that helper isn't exported — money-moving routes
// each keep their own explicit admin check rather than trusting a shared
// one silently). Duplicated ADMIN_EMAILS on purpose, same reasoning as
// every other file in this codebase that needs a client- or server-side
// "is this an admin" answer.
const WITHDRAWAL_ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];

async function _requireAdminForWithdrawalPayout(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        const isAdmin = decoded.admin === true || WITHDRAWAL_ADMIN_EMAILS.includes(decoded.email);
        if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

// ── POST /api/admin/backfill-name-index ── (2026-10-30)
// One-time/occasional backfill for the chat people-search: writes users/{uid}.fullNameLower
// (lower-cased fullName) so name search is case-insensitive. Clients keep their OWN field
// current (app-chat.js _healNameIndex); this covers everyone who has not opened the app
// since. Admin-only (same gate as the withdrawal payout route), idempotent, and paged so
// it never runs long on Render: body { startAfter?: <docId>, limit?: <=450 >}; reply
// { scanned, updated, done, nextCursor } — call again with startAfter=nextCursor until done.
app.post('/api/admin/backfill-name-index', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForWithdrawalPayout(req, res, admin);
    if (!decoded) return;
    try {
        const db = admin.firestore();
        const body = req.body || {};
        const pageSize = Math.min(Math.max(parseInt(body.limit, 10) || 400, 1), 450);
        let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
        if (body.startAfter) q = q.startAfter(String(body.startAfter));
        const snap = await q.get();
        const batch = db.batch();
        let updated = 0;
        snap.forEach(function (doc) {
            const d = doc.data() || {};
            const nm = typeof d.fullName === 'string' ? d.fullName.trim() : '';
            if (!nm) return;
            const low = nm.toLowerCase();
            if (d.fullNameLower === low) return;
            batch.update(doc.ref, { fullNameLower: low });
            updated++;
        });
        if (updated) await batch.commit();
        const last = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;
        res.json({ scanned: snap.size, updated: updated, done: snap.size < pageSize, nextCursor: last });
    } catch (err) {
        console.error('[backfill-name-index] failed:', err && err.message);
        res.status(500).json({ error: (err && err.message) || 'Backfill failed' });
    }
});

app.post('/api/admin/withdrawals/:id/payout', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });

    const decoded = await _requireAdminForWithdrawalPayout(req, res, admin);
    if (!decoded) return;

    if (!process.env.FLW_SECRET_KEY) return res.status(500).json({ error: 'FLW_SECRET_KEY not configured on server' });

    const { id } = req.params;
    const db = admin.firestore();
    const ref = db.collection('withdrawal_requests').doc(id);

    let wd;
    try {
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Withdrawal request not found' });
        wd = snap.data() || {};
    } catch (err) {
        return res.status(500).json({ error: 'Could not load withdrawal request', detail: err.message });
    }

    if (wd.status !== 'pending') return res.status(409).json({ error: 'Withdrawal is not pending (status: ' + wd.status + ')' });
    if (String(wd.currency || '').toUpperCase() !== 'NGN' || wd.method !== 'bank') {
        return res.status(400).json({ error: 'This route only pays out NGN bank-transfer withdrawals — use the existing approve button for EMPY or other methods' });
    }

    const acct = wd.accountDetails || {};
    const bankNameRaw = acct.bankName || '';
    const accountNumber = String(acct.accountNumber || '').replace(/\D/g, '');
    const amount = Number(wd.amount) || 0;

    if (!bankNameRaw || accountNumber.length !== 10 || amount <= 0) {
        return res.status(400).json({ error: 'Withdrawal request is missing a valid bank name, 10-digit account number, or amount' });
    }

    // fiatBalance.NGN was already decremented (held) when the member
    // submitted this request — see app-marketplace-sellers.js's
    // _submitNairaWithdraw. On success we only flip status + record the
    // transfer reference; on failure we leave status 'pending' (no refund)
    // so an admin can retry from the same queue item once the underlying
    // issue — bad bank name, Flutterwave outage, etc — is fixed, exactly
    // like a failed row in a bulk-disburse batch.
    try {
        const bankList = await createBulkDisburseRouter.getBankList();
        const match = createBulkDisburseRouter.resolveBankCode(bankNameRaw, bankList);
        if (!match) return res.status(400).json({ error: 'Could not recognize bank "' + bankNameRaw + '" — ask the member to double-check their bank name, or decline and have them resubmit' });

        const row = { bankCode: match.code, bankName: match.name, accountNumber, amount, currency: 'NGN', purpose: 'Empyrean withdrawal ' + id };

        let resolvedName;
        try {
            resolvedName = await createBulkDisburseRouter.resolveAccount(row);
        } catch (err) {
            return res.status(400).json({ error: 'Account could not be resolved: ' + err.message });
        }

        const reference = 'WD-' + id;
        const result = await createBulkDisburseRouter.transfer(row, reference);

        if (!result.ok) {
            const msg = (result.json && result.json.message) || ('HTTP ' + result.status);
            return res.status(502).json({ error: 'Transfer failed: ' + msg, resolvedName });
        }

        const flwRef = result.json.data && result.json.data.reference;
        const flwId  = result.json.data && result.json.data.id;

        await ref.update({
            status: 'processed',
            txRef: reference,
            flwRef: flwRef || '',
            flwId: flwId || '',
            resolvedAccountName: resolvedName || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ ok: true, resolvedName, txRef: reference, flwRef: flwRef || null });
    } catch (err) {
        console.error('[Withdrawal Payout] failed for', id, '-', err.message);
        res.status(500).json({ error: 'Payout failed', detail: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// AD REVENUE SHARE — Content Creator Monetization Model (server-side)
// ═══════════════════════════════════════════════════════════════════════
// FIX (2026-08, follow-up to app-monetization.js §14): the first pass of
// this feature computed everything client-side against a made-up
// perViewUsd constant, had no bridge to a real, withdrawable balance, and
// relied only on Firestore's "admin can write" rule to keep the ledger
// honest. All three are fixed here:
//   1. perViewUsd was fictional — nothing backed the dollar figure a
//      creator saw. Now an admin enters the REAL ad revenue figure for a
//      period (whatever an actual ad network/partner pays this platform)
//      via /set-pool, and every creator's share is a proportional cut of
//      THAT real number, weighted by their share of total platform
//      engagement that period.
//   2. There was no path from the ledger to real money. /request-payout
//      moves a creator's available (unpaid) balance into the existing
//      withdrawal_queue collection — the same collection and the same
//      admin review flow app-monetization.js's EMPY withdrawal form
//      already uses.
//   3. Computation ran in the browser; only a Firestore rule stood
//      between a client and a fabricated ledger entry. Every number here
//      is now computed from `posts`/`users` server-side via the Admin
//      SDK, and firebase-rules.js denies ALL client writes to
//      ad_revenue_shares/ad_revenue_quarterly_reports/
//      ad_revenue_program_meta outright (`if false`) — the client can
//      only read what this file already wrote. Per-period idempotency
//      (lastPeriodKey) stops a second run of the same period from
//      double-crediting, and a trailing-average anomaly check withholds
//      credit (flags for review instead) on an obvious view-stuffing
//      spike rather than paying it out automatically.
// ═══════════════════════════════════════════════════════════════════════

const AD_REVENUE_ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];
const AD_REVENUE_BASELINE_PCT = 0.30;                  // proposal §2.1 "Baseline Guarantee"
const AD_REVENUE_MAX_PCT = 0.50;                       // proposal §2.1 "Flexible Range"
const AD_REVENUE_BONUS_POOL_PCT = 0.05;                // proposal "Performance Bonus Pool"
const AD_REVENUE_BONUS_VIEW_THRESHOLD = 1500;          // 3x the 500-views/post bar app-monetization.js's client-side ENGAGEMENT_BAR already uses for the (separate) creator-tier gate
const AD_REVENUE_BONUS_INTERACTION_THRESHOLD = 150;    // 3x that bar's 50-interactions/post
const AD_REVENUE_ANOMALY_MULTIPLIER = 5;               // this period's avg views > 5x a creator's own trailing average => withhold + flag, don't auto-pay
// Illustrative regional ad-CPM disparity — proposal's "Regional
// Adaptation: Platforms in weaker ad markets may adjust distribution
// while maintaining the minimum guarantee." This scales a creator's
// WEIGHT toward the shared pool, never their %; the baseline/max clamp
// below is completely untouched by region. Edit this table directly to
// tune a region — there's no separate config surface for it (yet).
const AD_REVENUE_REGION_MULTIPLIERS = {
    US: 1.0, GB: 1.0, CA: 1.0, AU: 1.0, DE: 0.9, FR: 0.9, JP: 0.9,
    NG: 0.45, IN: 0.4, PH: 0.4, PK: 0.35, KE: 0.4, GH: 0.45, ZA: 0.55,
    default: 0.6
};

function _adRevClampSharePct(pct) {
    if (typeof pct !== 'number' || isNaN(pct)) return AD_REVENUE_BASELINE_PCT;
    return Math.max(AD_REVENUE_BASELINE_PCT, Math.min(AD_REVENUE_MAX_PCT, pct));
}

async function _requireAdminForAdRevenue(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        const isAdmin = decoded.admin === true || AD_REVENUE_ADMIN_EMAILS.includes(decoded.email);
        if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

async function _requireAuthForAdRevenue(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
    try {
        return await admin.auth().verifyIdToken(m[1]);
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

function _adRevCurrentQuarterKey(d) {
    d = d || new Date();
    const q = Math.floor(d.getMonth() / 3) + 1;
    return d.getFullYear() + '-Q' + q;
}

// ── admin enters the REAL ad revenue figure for a period ──────────────
app.post('/api/admin/ad-revenue/set-pool', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;

    const totalAdRevenueUsd = Number(req.body && req.body.totalAdRevenueUsd);
    const periodKey = (req.body && req.body.periodKey) || _adRevCurrentQuarterKey();
    const source = (req.body && req.body.source) || '';
    if (!(totalAdRevenueUsd > 0)) {
        return res.status(400).json({ error: 'totalAdRevenueUsd must be a positive number — enter the real figure from the ad network/platform payout, not an estimate.' });
    }

    try {
        const db = admin.firestore();
        await db.collection('ad_revenue_program_meta').doc('pool_' + periodKey).set({
            periodKey, totalAdRevenueUsd, source,
            enteredBy: decoded.email || decoded.uid,
            enteredAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        res.json({ ok: true, periodKey, totalAdRevenueUsd });
    } catch (err) {
        res.status(500).json({ error: 'Could not save pool figure', detail: err.message });
    }
});

// ── server-side computation: proportional split of the REAL pool by
//    engagement weight, gated on the same isVerified + engagement-bar
//    eligibility app-monetization.js's client-side eligibility engine
//    already checks for the (separate) creator-tier system — recomputed
//    independently here; the server does not trust anything a client
//    reports about its own performance. ─────────────────────────────────
app.post('/api/admin/ad-revenue/compute-payouts', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;

    const periodKey = (req.body && req.body.periodKey) || _adRevCurrentQuarterKey();
    const db = admin.firestore();

    try {
        const poolSnap = await db.collection('ad_revenue_program_meta').doc('pool_' + periodKey).get();
        if (!poolSnap.exists) return res.status(400).json({ error: 'No ad revenue pool figure on file for ' + periodKey + ' — call /set-pool first with the real per-period figure.' });
        const pool = poolSnap.data() || {};
        const totalAdRevenueUsd = Number(pool.totalAdRevenueUsd) || 0;

        // Pull every post once, aggregate per-author in memory — same
        // fields app-feed.js already writes (views/likes/commentCount/
        // shareCount), same source app-monetization.js's client-side
        // computeEngagement() reads for the separate tier system, just
        // done here once with Admin SDK privileges instead of N per-user
        // client queries.
        const postsSnap = await db.collection('posts').get();
        const perUser = {}; // userId -> { postCount, totalViews, totalInteractions }
        postsSnap.forEach(doc => {
            const p = doc.data() || {};
            const uid = p.userId;
            if (!uid) return;
            if (!perUser[uid]) perUser[uid] = { postCount: 0, totalViews: 0, totalInteractions: 0 };
            const views = Number(p.views) || 0;
            const interactions = (Number(p.likes) || 0) + (Number(p.commentCount) || 0) + (Number(p.shareCount) || 0);
            perUser[uid].postCount++;
            perUser[uid].totalViews += views;
            perUser[uid].totalInteractions += interactions;
        });

        const userIds = Object.keys(perUser);
        if (!userIds.length) return res.json({ ok: true, periodKey, creatorsPaid: 0, creatorsFlagged: 0, note: 'No posts with an author found.' });

        const userRefs   = userIds.map(id => db.collection('users').doc(id));
        const ledgerRefs = userIds.map(id => db.collection('ad_revenue_shares').doc(id));
        const [userDocs, ledgerDocs] = await Promise.all([db.getAll(...userRefs), db.getAll(...ledgerRefs)]);

        const eligible = [];
        userIds.forEach((uid, i) => {
            const u = userDocs[i].exists ? (userDocs[i].data() || {}) : {};
            const ledger = ledgerDocs[i].exists ? (ledgerDocs[i].data() || {}) : {};
            const stats = perUser[uid];

            // Eligibility gate — mirrors the 500-views/50-interactions
            // ENGAGEMENT_BAR + KYC check app-monetization.js already
            // enforces client-side for the (separate) creator-tier
            // system, recomputed here rather than trusted from the client.
            const avgViews = stats.postCount ? stats.totalViews / stats.postCount : 0;
            const avgInteractions = stats.postCount ? stats.totalInteractions / stats.postCount : 0;
            const meetsBar = stats.postCount > 0 && avgViews >= 500 && avgInteractions >= 50;
            if (!u.isVerified || !meetsBar) return; // not eligible this period — no ledger write, nothing credited

            // Anomaly check against this creator's OWN trailing average —
            // a brand-new ledger (no trailingAvgViews yet) can't be judged
            // against history, so it's allowed through; the check only
            // fires on a sudden spike relative to a creator's established
            // baseline, not on a naturally high performer.
            const priorAvgViews = Number(ledger.trailingAvgViews) || 0;
            const suspicious = priorAvgViews > 0 && avgViews > priorAvgViews * AD_REVENUE_ANOMALY_MULTIPLIER;

            const region = String(u.country || u.region || '').toUpperCase();
            const regionMult = AD_REVENUE_REGION_MULTIPLIERS[region] != null ? AD_REVENUE_REGION_MULTIPLIERS[region] : AD_REVENUE_REGION_MULTIPLIERS.default;

            // Interactions weighted 2x views as a performance signal (a
            // like/comment/share is a stronger signal than a passive
            // view) — this 1:2 weighting is defined in exactly one place
            // now; nothing client-side duplicates this formula anymore.
            const weight = (stats.totalViews * 1 + stats.totalInteractions * 2) * regionMult;

            eligible.push({ uid, avgViews, avgInteractions, weight, suspicious, ledger });
        });

        const totalWeight = eligible.reduce((sum, e) => sum + (e.suspicious ? 0 : e.weight), 0);

        const batch = db.batch();
        let creatorsPaid = 0, creatorsFlagged = 0, creatorsSkippedIdempotent = 0;
        const nowTs = admin.firestore.FieldValue.serverTimestamp();

        eligible.forEach(e => {
            const ref = db.collection('ad_revenue_shares').doc(e.uid);
            if (e.ledger.lastPeriodKey === periodKey) { creatorsSkippedIdempotent++; return; } // idempotent — re-running the same period never double-credits

            if (e.suspicious) {
                batch.set(ref, {
                    userId: e.uid, suspiciousFlag: true,
                    suspiciousReason: 'Views ' + Math.round(e.avgViews) + '/post vs trailing avg ' + Math.round(Number(e.ledger.trailingAvgViews) || 0) + '/post (>' + AD_REVENUE_ANOMALY_MULTIPLIER + 'x)',
                    lastPeriodKey: periodKey, lastFlaggedAt: nowTs
                }, { merge: true });
                creatorsFlagged++;
                return;
            }

            const grossUsd = totalWeight > 0 ? (e.weight / totalWeight) * totalAdRevenueUsd : 0;
            const bonusUnlocked = e.avgViews >= AD_REVENUE_BONUS_VIEW_THRESHOLD && e.avgInteractions >= AD_REVENUE_BONUS_INTERACTION_THRESHOLD;
            const sharePct = _adRevClampSharePct((typeof e.ledger.overridePct === 'number' ? e.ledger.overridePct : AD_REVENUE_BASELINE_PCT) + (bonusUnlocked ? AD_REVENUE_BONUS_POOL_PCT : 0));
            const creatorShareUsd = grossUsd * sharePct;
            const prevTotalEarned = Number(e.ledger.totalEarnedUsd) || 0;
            const prevTrailing = Number(e.ledger.trailingAvgViews) || 0;
            // Rolling average of the previous trailing figure and this
            // period's, so one big period doesn't permanently reset what
            // "normal" looks like for the anomaly check, but also isn't
            // stuck forever on the very first period's number.
            const newTrailing = prevTrailing > 0 ? (prevTrailing + e.avgViews) / 2 : e.avgViews;

            batch.set(ref, {
                userId: e.uid,
                sharePct, bonusUnlocked,
                lastPeriodKey: periodKey,
                lastPeriodGrossUsd: grossUsd,
                lastPeriodCreatorShareUsd: creatorShareUsd,
                totalEarnedUsd: prevTotalEarned + creatorShareUsd,
                paidOutUsd: Number(e.ledger.paidOutUsd) || 0,
                trailingAvgViews: newTrailing,
                suspiciousFlag: false,
                lastComputedAt: nowTs
            }, { merge: true });
            creatorsPaid++;
        });

        await batch.commit();
        res.json({ ok: true, periodKey, totalAdRevenueUsd, creatorsEvaluated: eligible.length, creatorsPaid, creatorsFlagged, creatorsSkippedIdempotent });
    } catch (err) {
        console.error('[AdRevenue] compute-payouts failed:', err.message);
        res.status(500).json({ error: 'Compute failed', detail: err.message });
    }
});

// ── publish the quarterly transparency report from server-computed data ──
app.post('/api/admin/ad-revenue/publish-report', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;

    const periodKey = (req.body && req.body.periodKey) || _adRevCurrentQuarterKey();
    const db = admin.firestore();
    try {
        const snap = await db.collection('ad_revenue_shares').where('lastPeriodKey', '==', periodKey).get();
        const creators = [];
        let platformGrossUsd = 0, platformCreatorShareUsd = 0;
        snap.forEach(doc => {
            const v = doc.data() || {};
            creators.push({
                userId: doc.id, sharePct: v.sharePct || AD_REVENUE_BASELINE_PCT,
                lastPeriodGrossUsd: v.lastPeriodGrossUsd || 0,
                lastPeriodCreatorShareUsd: v.lastPeriodCreatorShareUsd || 0,
                totalEarnedUsd: v.totalEarnedUsd || 0
            });
            platformGrossUsd += v.lastPeriodGrossUsd || 0;
            platformCreatorShareUsd += v.lastPeriodCreatorShareUsd || 0;
        });

        const report = {
            quarter: periodKey, publishedAt: admin.firestore.FieldValue.serverTimestamp(),
            publishedBy: decoded.email || decoded.uid,
            baselinePct: AD_REVENUE_BASELINE_PCT, maxPct: AD_REVENUE_MAX_PCT,
            platformGrossUsd, platformCreatorShareUsd, creatorCount: creators.length, creators
        };
        await db.collection('ad_revenue_quarterly_reports').doc(periodKey).set(report);
        res.json({ ok: true, periodKey, creatorCount: creators.length, platformCreatorShareUsd });
    } catch (err) {
        res.status(500).json({ error: 'Publish failed', detail: err.message });
    }
});

// ── admin sets a per-creator override % (still clamped server-side to
//    [baseline, max] no matter what's sent) ────────────────────────────
app.post('/api/admin/ad-revenue/set-share-pct', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;

    const userId = req.body && req.body.userId;
    const pct = _adRevClampSharePct(Number(req.body && req.body.pct));
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
        await admin.firestore().collection('ad_revenue_shares').doc(userId).set({ overridePct: pct }, { merge: true });
        res.json({ ok: true, userId, pct });
    } catch (err) {
        res.status(500).json({ error: 'Could not set share', detail: err.message });
    }
});

// ── "Market Adjustment Clause: reviewed every 2 years" — records that a
//    review happened; does not itself change baseline/max (that's a
//    deliberate business decision each review, not an auto-adjustment). ──
app.post('/api/admin/ad-revenue/mark-reviewed', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;

    try {
        const nowIso = new Date().toISOString();
        await admin.firestore().collection('ad_revenue_program_meta').doc('schedule').set({
            lastReviewedAt: nowIso, reviewedBy: decoded.email || decoded.uid
        }, { merge: true });
        res.json({ ok: true, lastReviewedAt: nowIso });
    } catch (err) {
        res.status(500).json({ error: 'Could not record review', detail: err.message });
    }
});

// ── creator requests a payout of their AVAILABLE (unpaid) ad-revenue
//    balance — server re-reads the ledger inside a transaction and
//    reserves the amount atomically, so two rapid taps (or a race with
//    the next compute-payouts run) can't double-spend the same balance ──
app.post('/api/ad-revenue/request-payout', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;

    const db = admin.firestore();
    const uid = decoded.uid;
    const ledgerRef = db.collection('ad_revenue_shares').doc(uid);

    try {
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ledgerRef);
            const v = snap.exists ? (snap.data() || {}) : {};
            const available = (Number(v.totalEarnedUsd) || 0) - (Number(v.paidOutUsd) || 0);
            if (available <= 0.01) throw Object.assign(new Error('No available ad-revenue balance to request.'), { status: 400 });
            if (v.suspiciousFlag) throw Object.assign(new Error('This account is under review for unusual engagement — payout is on hold until an admin clears it.'), { status: 403 });

            const rateUsd = Number(process.env.EMPY_RATE_USD) || 0.10;
            const amountEmpy = available / rateUsd;
            const reqRef = db.collection('withdrawal_queue').doc();
            tx.set(reqRef, {
                userId: uid, amountEmpy, method: 'ad_revenue_transfer',
                sourceType: 'ad_revenue', sourceAmountUsd: available,
                status: 'pending', flaggedForReview: false,
                requestedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            tx.set(ledgerRef, { paidOutUsd: (Number(v.paidOutUsd) || 0) + available }, { merge: true });
            return { amountUsd: available, amountEmpy };
        });
        res.json({ ok: true, amountUsd: result.amountUsd, amountEmpy: result.amountEmpy });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || 'Payout request failed' });
    }
});


// ── /api/admin/media-migration ── Cloudinary -> Firebase Storage ──────────
// One-off (repeatable/idempotent) background job for the 2026-08 Cloudinary
// stall: old posts/reels/statuses/etc still hold `https://res.cloudinary.com/
// dxwmts9vw/...` URLs from before the Blaze-plan switch to Firebase Storage
// (see app-dom.js's uploadToCloudinary — new uploads already go to Storage;
// this route is ONLY for the historical URLs already sitting in Firestore).
//
// Deliberately NOT a fixed per-collection field list (posts.mediaUrl,
// reels.videoUrl, etc.) — this codebase has ~30+ collections and several
// (chats/{id}/msgs, comments/replies) are nested subcollections reachable
// only via collectionGroup(). Instead this deep-scans every field of every
// doc in the configured targets for any string containing a Cloudinary URL,
// wherever it's nested (works for arrays of attachments, {url, thumb} maps,
// etc. with zero schema knowledge). Firestore Timestamp/GeoPoint values are
// left untouched (they have no cloudinary content and recursing into their
// internals would break them).
//
// Flow: POST /start kicks off an in-memory job (same pattern as bulk-
// disburse-routes.js's _batches Map) and returns immediately; the job then
// (1) scans all targets and collects every distinct Cloudinary URL found,
// (2) downloads + re-uploads each DISTINCT url exactly once (so a thumbnail
// reused across 40 posts is only migrated once), (3) re-walks each affected
// doc and writes back only the top-level fields that actually changed.
// GET /:id/status polls progress. A urlsFailed entry (bad/expired Cloudinary
// URL — the account being on a stalled plan may mean SOME assets are truly
// gone) leaves that one field's URL untouched rather than blanking it, so a
// failed migration never destroys a working reference by accident.
//
// Uploaded files get a `firebaseStorageDownloadTokens` metadata value and a
// hand-built https://firebasestorage.googleapis.com/... URL — the exact
// format admin.storage()'s Node SDK doesn't return directly but Firebase's
// own client getDownloadURL() calls produce — so every migrated URL plays
// back through the existing <video>/<img> tags with zero frontend changes.
const MEDIA_MIGRATION_ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];
const CLOUDINARY_URL_RE = /https?:\/\/res\.cloudinary\.com\/[^\s"'\\<>]+/g;
const MEDIA_MIGRATION_CONCURRENCY = 4;
const _mediaMigrationJobs = new Map();

// Every collection this codebase writes media URLs into, plus the
// collectionGroup()s needed for nested subcollections (chats/{id}/msgs,
// posts/{id}/comments, comments/{id}/replies — some of these also exist as
// flat top-level collections elsewhere in the code, collectionGroup() finds
// both). Override with body.targets on the /start call to run a narrower
// first pass (e.g. just posts) before migrating everything.
const MEDIA_MIGRATION_DEFAULT_TARGETS = [
    { type: 'collection', name: 'posts' },
    { type: 'collection', name: 'reels' },
    { type: 'collection', name: 'statuses' },
    { type: 'collection', name: 'news_articles' },
    { type: 'collection', name: 'news_posts' },
    { type: 'collection', name: 'business_posts' },
    { type: 'collection', name: 'business_pages' },
    { type: 'collection', name: 'marketplace_listings' },
    { type: 'collection', name: 'marketplace_messages' },
    { type: 'collection', name: 'crisis_reports' },
    { type: 'collection', name: 'sos_queue' },
    { type: 'collection', name: 'kyc_submissions' },
    { type: 'collection', name: 'kyc_selfies' },
    { type: 'collection', name: 'announcements' },
    { type: 'collection', name: 'promotions' },
    { type: 'collection', name: 'live_recordings' },
    { type: 'collection', name: 'stream_replays' },
    { type: 'collection', name: 'ngo_partners' },
    { type: 'collection', name: 'disbursements' },
    { type: 'collection', name: 'moderation_flags' },
    { type: 'collection', name: 'users' },        // avatar/cover photos
    { type: 'collection', name: 'comments' },      // flat top-level usage (app-news.js, app-fixes.js)
    { type: 'collectionGroup', name: 'comments' }, // nested usage (app-thread.js: posts/{id}/comments)
    { type: 'collectionGroup', name: 'replies' },  // nested (comments/{id}/replies)
    { type: 'collectionGroup', name: 'msgs' }      // nested (messages/{threadId}/msgs — app-chat.js)
];

async function _requireAdminForMediaMigration(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        const isAdmin = decoded.admin === true || MEDIA_MIGRATION_ADMIN_EMAILS.includes(decoded.email);
        if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

// Opaque leaf types we must not recurse into (Firestore Timestamp/GeoPoint
// instances) — both expose these distinguishing members without needing to
// require firebase-admin's internal classes here.
function _isOpaqueFirestoreValue(v) {
    return !!v && typeof v === 'object' && (
        typeof v.toDate === 'function' ||                              // Timestamp
        (typeof v.latitude === 'number' && typeof v.longitude === 'number') // GeoPoint
    );
}

// Walks any Firestore field value, collecting every distinct Cloudinary URL
// found in any string, at any depth.
function _collectCloudinaryUrls(value, into) {
    if (typeof value === 'string') {
        const matches = value.match(CLOUDINARY_URL_RE);
        if (matches) matches.forEach(u => into.add(u));
        return;
    }
    if (Array.isArray(value)) { value.forEach(v => _collectCloudinaryUrls(v, into)); return; }
    if (value && typeof value === 'object' && !_isOpaqueFirestoreValue(value)) {
        for (const k in value) _collectCloudinaryUrls(value[k], into);
    }
}

// Rebuilds a value with every Cloudinary URL present in urlMap swapped for
// its migrated Firebase Storage URL. URLs NOT in urlMap (failed downloads)
// are left exactly as-is. Returns { value, changed }.
function _replaceCloudinaryUrls(value, urlMap) {
    if (typeof value === 'string') {
        if (value.indexOf('res.cloudinary.com') === -1) return { value, changed: false };
        let changed = false;
        const next = value.replace(CLOUDINARY_URL_RE, (m) => {
            if (urlMap.has(m)) { changed = true; return urlMap.get(m); }
            return m;
        });
        return { value: next, changed };
    }
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map(v => {
            const r = _replaceCloudinaryUrls(v, urlMap);
            if (r.changed) changed = true;
            return r.value;
        });
        return { value: next, changed };
    }
    if (value && typeof value === 'object' && !_isOpaqueFirestoreValue(value)) {
        let changed = false;
        const next = {};
        for (const k in value) {
            const r = _replaceCloudinaryUrls(value[k], urlMap);
            if (r.changed) changed = true;
            next[k] = r.value;
        }
        return { value: next, changed };
    }
    return { value, changed: false };
}

function _extFromContentTypeOrUrl(contentType, url) {
    const ctMap = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
    if (contentType && ctMap[contentType.split(';')[0].trim()]) return ctMap[contentType.split(';')[0].trim()];
    const m = /\.(mp4|mov|webm|jpg|jpeg|png|gif|webp)(\?|$)/i.exec(url);
    return m ? '.' + m[1].toLowerCase() : '';
}

// Downloads one Cloudinary URL and re-uploads it into Firebase Storage under
// uploads/migrated-cloudinary/, returning a URL in the same
// https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&
// token=<uuid> shape the client SDK's getDownloadURL() produces — so nothing
// downstream (video/img tags, og:video meta tags, etc.) needs to change.
async function _migrateOneCloudinaryUrl(admin, bucketName, url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('download failed: HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const ext = _extFromContentTypeOrUrl(contentType, url);
    const path = 'uploads/migrated-cloudinary/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    const token = crypto.randomUUID();
    const bucket = admin.storage().bucket(bucketName);
    await bucket.file(path).save(buf, {
        contentType,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } }
    });
    return 'https://firebasestorage.googleapis.com/v0/b/' + bucketName + '/o/' +
        encodeURIComponent(path) + '?alt=media&token=' + token;
}

// Simple bounded-concurrency runner — mirrors bulk-disburse-routes.js's own
// CONCURRENCY-limited pattern rather than firing every download at once.
async function _runWithConcurrency(items, limit, worker) {
    let i = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (i < items.length) {
            const idx = i++;
            await worker(items[idx], idx);
        }
    });
    await Promise.all(runners);
}

async function _runMediaMigrationJob(job, admin, targets, dryRun) {
    const db = admin.firestore();
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

    // ---- Phase 1: scan every target, remember which docs actually had a
    // Cloudinary URL (skip the rest — most docs won't) ----
    const docEntries = []; // { ref, data }
    const allUrls = new Set();

    for (const target of targets) {
        let snap;
        try {
            snap = target.type === 'collectionGroup'
                ? await db.collectionGroup(target.name).get()
                : await db.collection(target.name).get();
        } catch (err) {
            job.scanErrors.push({ target: target.type + ':' + target.name, error: err.message });
            continue;
        }
        snap.forEach(doc => {
            job.docsScanned++;
            const data = doc.data();
            const found = new Set();
            _collectCloudinaryUrls(data, found);
            if (found.size) {
                docEntries.push({ ref: doc.ref, data });
                found.forEach(u => allUrls.add(u));
            }
        });
    }
    job.urlsFound = allUrls.size;
    job.docsWithMedia = docEntries.length;

    // ---- Phase 2: migrate every distinct URL exactly once ----
    const urlMap = new Map(); // old cloudinary url -> new firebase storage url
    const urlList = Array.from(allUrls);
    await _runWithConcurrency(urlList, MEDIA_MIGRATION_CONCURRENCY, async (url) => {
        try {
            if (dryRun) {
                // Dry run: confirm the URL is actually reachable without
                // uploading anything, so a "scan first" pass can surface
                // dead Cloudinary links before committing to real uploads.
                const resp = await fetch(url, { method: 'HEAD' });
                if (!resp.ok) throw new Error('HEAD check failed: HTTP ' + resp.status);
                job.urlsMigrated++;
                return;
            }
            const newUrl = await _migrateOneCloudinaryUrl(admin, bucketName, url);
            urlMap.set(url, newUrl);
            job.urlsMigrated++;
        } catch (err) {
            job.urlsFailed++;
            job.failures.push({ url, error: err.message });
        }
        job.urlsProcessed++;
    });

    // ---- Phase 3: patch back only the docs/fields that actually changed ----
    if (!dryRun) {
        for (const entry of docEntries) {
            const patch = {};
            let anyChanged = false;
            for (const key in entry.data) {
                const r = _replaceCloudinaryUrls(entry.data[key], urlMap);
                if (r.changed) { patch[key] = r.value; anyChanged = true; }
            }
            if (anyChanged) {
                try {
                    await entry.ref.update(patch);
                    job.docsUpdated++;
                } catch (err) {
                    job.failures.push({ docPath: entry.ref.path, error: 'Firestore update failed: ' + err.message });
                }
            }
        }
    }

    job.status = 'completed';
    job.finishedAt = Date.now();
}

app.post('/api/admin/media-migration/start', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    if (!process.env.FIREBASE_STORAGE_BUCKET) return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured on server' });

    const decoded = await _requireAdminForMediaMigration(req, res, admin);
    if (!decoded) return;

    const dryRun = !!(req.body && req.body.dryRun);
    const targets = (req.body && Array.isArray(req.body.targets) && req.body.targets.length)
        ? req.body.targets
        : MEDIA_MIGRATION_DEFAULT_TARGETS;

    const jobId = 'mm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const job = {
        id: jobId, dryRun, status: 'running', startedAt: Date.now(), finishedAt: null,
        docsScanned: 0, docsWithMedia: 0, docsUpdated: 0,
        urlsFound: 0, urlsProcessed: 0, urlsMigrated: 0, urlsFailed: 0,
        scanErrors: [], failures: []
    };
    _mediaMigrationJobs.set(jobId, job);

    res.json({ jobId, dryRun, targets: targets.map(t => t.type + ':' + t.name) });

    _runMediaMigrationJob(job, admin, targets, dryRun).catch(err => {
        console.error('[MediaMigration] job ' + jobId + ' crashed:', err);
        job.status = 'error';
        job.error = err.message;
        job.finishedAt = Date.now();
    });
});

app.get('/api/admin/media-migration/:id/status', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForMediaMigration(req, res, admin);
    if (!decoded) return;

    const job = _mediaMigrationJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found (in-memory only — lost on server restart)' });

    res.json({
        id: job.id, dryRun: job.dryRun, status: job.status,
        docsScanned: job.docsScanned, docsWithMedia: job.docsWithMedia, docsUpdated: job.docsUpdated,
        urlsFound: job.urlsFound, urlsProcessed: job.urlsProcessed, urlsMigrated: job.urlsMigrated, urlsFailed: job.urlsFailed,
        scanErrors: job.scanErrors, failures: job.failures.slice(0, 200), // cap payload size
        error: job.error || null
    });
});

// ── /api/webhooks/flutterwave ── Transfer settlement confirmation ─────────
// Closes a gap both this file's /payout route above and bulk-disburse-
// routes.js's own header comment explicitly flag: a successful response
// from Flutterwave's Transfers API means the transfer was ACCEPTED for
// processing, not that it has SETTLED. Until now nothing in this codebase
// ever found out whether an accepted transfer actually landed — this route
// is that missing piece. Flutterwave calls it asynchronously once a
// transfer's real outcome is known.
//
// Reference format tells us which system a payout came from (both already
// build references this exact way, nothing changed there):
//   'WD-<withdrawalRequestId>'     — this file's /payout route, above
//   'BULK-<batchId>-<rowNumber>'   — bulk-disburse-routes.js's _processRow
//
// Auth: Flutterwave signs webhook calls with a `verif-hash` header that
// must match a secret string YOU set once in the Flutterwave dashboard
// (Settings > Webhooks) — this is NOT FLW_SECRET_KEY and needs its own new
// Render env var, FLW_WEBHOOK_HASH (see render.yaml). Anything without a
// matching header is ignored — that's the only thing standing between this
// public URL and anyone on the internet POSTing a fake "your transfer
// failed" event.
//
// Responds 200 immediately, before any Firestore work — Flutterwave
// retries on a non-2xx/timeout, and a slow write here shouldn't look like
// a failed delivery and trigger a duplicate/retried event.
app.post('/api/webhooks/flutterwave', async (req, res) => {
    res.status(200).json({ received: true });

    if (!process.env.FLW_WEBHOOK_HASH) {
        console.warn('[FLW Webhook] FLW_WEBHOOK_HASH not configured — ignoring inbound webhook (cannot verify authenticity)');
        return;
    }
    const signature = req.headers['verif-hash'];
    if (!signature || signature !== process.env.FLW_WEBHOOK_HASH) {
        console.warn('[FLW Webhook] Rejected — missing or mismatched verif-hash signature');
        return;
    }

    const payload = req.body || {};
    if (payload.event !== 'transfer.completed') return; // only transfer settlement is handled here — charge/payment events are already verified synchronously by /api/marketplace/order/confirm

    const data = payload.data || {};
    const reference = String(data.reference || '');
    const status = String(data.status || '').toUpperCase(); // SUCCESSFUL | FAILED
    const settled = status === 'SUCCESSFUL';

    const admin = _getAdmin();
    if (!admin) { console.warn('[FLW Webhook] Firebase Admin not configured — cannot record settlement for', reference); return; }
    const db = admin.firestore();

    try {
        if (reference.indexOf('WD-') === 0) {
            await _settleWithdrawalTransfer(db, admin, reference.slice(3), settled, data);
        } else if (reference.indexOf('BULK-') === 0) {
            await _settleBulkDisburseRow(db, admin, reference, settled, data);
        } else {
            console.warn('[FLW Webhook] Unrecognized reference format, ignoring:', reference);
        }
    } catch (err) {
        console.error('[FLW Webhook] Failed to process settlement for', reference, '-', err.message);
    }
});

// withdrawal_requests/{id} settlement: on success, just record final
// confirmation (no balance change — the amount was already held at
// request time via fiatBalance.NGN/empyBalance decrement and is never
// refunded on success). On failure, the /payout route's optimistic
// status:'processed' is now wrong — flip it to 'failed', refund the held
// balance, and leave a clear trail so it reappears for an admin to retry
// or otherwise handle, instead of silently vanishing from the queue.
async function _settleWithdrawalTransfer(db, admin, withdrawalId, settled, flwData) {
    const ref = db.collection('withdrawal_requests').doc(withdrawalId);
    const snap = await ref.get();
    if (!snap.exists) { console.warn('[FLW Webhook] withdrawal_requests/' + withdrawalId + ' not found'); return; }
    const wd = snap.data() || {};

    if (settled) {
        await ref.update({
            settlementStatus: 'settled',
            settledAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
    }

    await ref.update({
        status: 'failed',
        settlementStatus: 'failed',
        settlementError: (flwData && flwData.complete_message) || 'Transfer failed to settle',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (wd.userId && wd.amount) {
        const isNgnBank = String(wd.currency || '').toUpperCase() === 'NGN' && wd.method === 'bank';
        const balanceField = isNgnBank ? 'fiatBalance.NGN' : 'empyBalance';
        try {
            await db.collection('users').doc(wd.userId).update({
                [balanceField]: admin.firestore.FieldValue.increment(Number(wd.amount))
            });
        } catch (err) {
            console.warn('[FLW Webhook] Refund-on-settlement-failure failed for', withdrawalId, '-', err.message);
        }
    }
    console.warn('[FLW Webhook] Withdrawal', withdrawalId, 'failed to settle — refunded and flagged for admin review');
}

// disbursements/{docId} settlement (bulk CSV grants): _logToLedger in
// bulk-disburse-routes.js writes one doc per successful row with
// txRef === this exact reference string — find it and record the real
// outcome instead of leaving status:'completed' (accepted, not settled)
// as the final word, per that file's own header comment.
async function _settleBulkDisburseRow(db, admin, reference, settled, flwData) {
    const q = await db.collection('disbursements').where('txRef', '==', reference).limit(1).get();
    if (q.empty) { console.warn('[FLW Webhook] No disbursements doc found for', reference); return; }
    await q.docs[0].ref.update({
        status: settled ? 'settled' : 'reversed',
        settledAt: admin.firestore.FieldValue.serverTimestamp(),
        settlementError: settled ? null : ((flwData && flwData.complete_message) || 'Transfer failed to settle')
    });
}

// ── Link-preview crawlers (WhatsApp, Facebook, Twitter/X, LinkedIn,
//    Telegram, Discord, Slack) do NOT execute JavaScript — they fetch the
//    raw HTML once and read <meta property="og:..."> tags from it. Because
//    this app is a single-page app, every URL (including ?post=<id> share
//    links) was serving the exact same static index.html with the exact
//    same generic <title> and no og: tags at all, so no platform could ever
//    render a preview card, regardless of domain/deployment status.
//
//    This route intercepts ONLY requests that are (a) for a post-share URL
//    and (b) sent by a recognised crawler User-Agent, and serves a tiny,
//    fast, server-rendered HTML page with the real per-post og:title /
//    og:description / og:image baked in directly from Firestore — read via
//    the same Firebase Admin SDK service-account credential already used
//    for FCM push above. Real human visitors (normal browser User-Agent)
//    are NOT matched by _isCrawler() and fall straight through to the
//    existing express.static + SPA-fallback handling below, completely
//    untouched — this never changes what a person sees when they actually
//    open the link, only what bots see when generating a preview card.
const CRAWLER_UA_RE = /(facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|TelegramBot|Discordbot|Slackbot|SkypeUriPreview|vkShare|W3C_Validator|redditbot|Pinterest|Embedly)/i;

function _isCrawler(req) {
    return CRAWLER_UA_RE.test(req.get('user-agent') || '');
}

function _escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Lazy-init Firebase Admin Firestore — shares the same admin instance/app
// the /api/notify route above already creates, so the service account is
// only ever initialised once no matter which route hits it first.
function _getAdmin() {
    if (app._firebaseAdminInitFailed) return null; // already failed once this run — don't retry every request
    if (!app._firebaseAdmin) {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
        try {
            const admin = require('firebase-admin');
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            // storageBucket added (2026-08) so admin.storage().bucket() works
            // for the /api/admin/media-migration route (Cloudinary -> Firebase
            // Storage migration) — see that route further down. FIREBASE_
            // STORAGE_BUCKET is already in render.yaml (it's the same public
            // bucket name the client SDK uses), just wasn't being passed to
            // the Admin SDK's initializeApp before now.
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
            });
            app._firebaseAdmin = admin;
        } catch (err) {
            console.error('[OGP] Firebase Admin init failed — preview cards will use fallback text:', err.message);
            app._firebaseAdminInitFailed = true;
            return null;
        }
    }
    return app._firebaseAdmin;
}

// Post-ID prefix → Firestore collection. Matches the classification logic
// already used client-side, so a crawler hitting ?post=sos-... or
// ?post=crisis-... looks in the SAME collection the in-app code does,
// instead of always querying `posts` (which is why several link types were
// falling back to the generic card).
//
// FIX (2026-07-29): two prefixes were routed to the wrong collection:
//  - `sos-` was sent to `sos_queue`, but that collection only holds SOS
//    requests still awaiting admin approval. Once approved, app-fixes.js's
//    own .approve-sos-btn / .delete-approved-sos-btn handlers show the live
//    post is written to (and deleted from) `posts` instead, with the queue
//    entry removed — so any share link for an already-approved SOS request
//    was looking in a collection where the doc no longer existed.
//  - `bizpost-` (an individual post ON a business page — see the
//    create-business-post-form handler, which writes to `business_posts`)
//    was never matched at all: the regex only covered `biz-` (the business
//    PAGE/profile itself, confirmed against the
//    `userIdToFollow.startsWith('biz-')` check), so `bizpost-...` IDs fell
//    through to the default `posts` collection.
function _collectionForId(postId) {
    if (/^crisis-/i.test(postId))  return 'crisis_reports';
    if (/^sos-/i.test(postId))     return 'posts';          // approved SOS posts live here, not sos_queue
    if (/^news-/i.test(postId))    return 'news_posts';
    if (/^reel-/i.test(postId))    return 'reels';
    if (/^status-/i.test(postId))  return 'statuses';
    if (/^bizpost-/i.test(postId)) return 'business_posts';  // an individual post on a business page
    if (/^biz-/i.test(postId))     return 'business_pages';  // the business page/profile itself
    // FIX (request — "auto-generated response message containing the
    // product/car card link... the shared link should display the
    // published card thumbnail"): marketplace listing ids are minted as
    // 'mkt-' + Date.now() (see app-fixes.js's marketplace-form submit
    // handler) — until now this fell through to the 'posts' default below,
    // so a shared listing link either 404'd against the wrong collection
    // or silently rendered generic post fallback text/image instead of
    // the actual product name/price/photo.
    if (/^mkt-/i.test(postId))     return 'marketplace_listings';
    // FIX (report: "admin account doesn't generate a thumbnail card"):
    // '.share-profile-btn' (app-fixes.js) mints 'profile-<uid>' links —
    // this prefix was never mapped here at all, so every profile share
    // fell through to the 'posts' default below and looked up
    // posts/profile-<uid>, which can never exist. See _fetchPostForPreview
    // for how the 'profile-' prefix is stripped back off before the actual
    // users/{uid} doc read.
    if (/^profile-/i.test(postId)) return 'users';
    return 'posts'; // regular posts, quick posts, quotes, and retweets (rt-) all share this collection
}

// Compact follower-count formatting matching the in-app convention
// (toLocaleString() for raw numbers elsewhere) but abbreviated for a
// preview card, e.g. 12,340 -> "12.3K", 1,000,000 -> "1M".
function _formatFollowers(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n % 1000000 === 0 ? (n / 1000000) : (n / 1000000).toFixed(1)) + 'M';
    if (n >= 1000)    return (n % 1000    === 0 ? (n / 1000)    : (n / 1000).toFixed(1)) + 'K';
    return String(n);
}

// Looks up the author's public profile (users/{userId}) for the follower
// count + verified badge shown on the preview card — post/reel/news/status
// docs only store username + avatar, not followerCount, so this is a
// second, deliberately small read (id + 2 fields) rather than pulling the
// whole user doc's fields into every preview.
async function _fetchAuthorMeta(admin, userId) {
    if (!userId) return null;
    try {
        const snap = await admin.firestore().collection('users').doc(userId).get();
        if (!snap.exists) return null;
        const u = snap.data() || {};
        return {
            username: u.username || u.fullName || '',
            followerCount: u.followerCount || 0,
            isVerified: !!u.isVerified,
            avatar: u.avatar || u.photoURL || ''
        };
    } catch (err) {
        console.warn('[OGP] Author lookup failed for', userId, '-', err.message);
        return null;
    }
}

// FEATURE (2026-09-27 — "the share link should display the poll logo not
// a generic fall back picture or instead the initiator of the poll's
// pictures"): poll share links are minted by app-feed.js's
// _openShareModal as base + '/?poll=' + pollId — a different query param
// from every other content type's ?post=, and polls/{id} docs (plain
// Firestore auto-ids, no recognisable prefix the way sos-/crisis-/mkt-
// ids have) were never wired into _collectionForId or
// _fetchPostForPreviewOnce at all. A shared poll link therefore always
// fell straight through to the generic branded "Join the Empyrean
// community" fallback card, regardless of which poll was actually shared
// — never the poll's own content, and never the person who started it.
// This is a small, poll-specific sibling to _fetchPostForPreviewOnce
// rather than another branch inside it, since a poll doc's shape
// (question/options/createdBy) has nothing in common with the
// media-array shape every branch in that function assumes.
async function _fetchPollForPreview(pollId, req) {
    const admin = _getAdmin();
    if (!admin) return null;
    try {
        const snap = await admin.firestore().collection('polls').doc(pollId).get();
        if (!snap.exists) { console.warn('[OGP] No poll found for', pollId); return null; }
        const d = snap.data() || {};
        const topic = d.topic || 'general';
        const topicLabel = topic.charAt(0).toUpperCase() + topic.slice(1);
        const title = 'Empyrean poll: ' + topicLabel;
        const desc = d.question || 'Vote in this Empyrean poll.';

        // Image priority: (1) a poll-level logo/image field, if a poll
        // ever carries one (none does today — the create-a-poll flow has
        // no image upload of its own — but this leaves room for one
        // later without another server change); (2) falling back to the
        // "or instead" option explicitly asked for — the poll's own
        // initiator's profile picture, since the poll has no thumbnail of
        // its own otherwise; (3) the plain branded fallback card, same as
        // every other content type that ends up with no photo at all.
        let image = d.image || d.logo || '';
        let hasOwnImage = !!image;
        if (!image && d.createdBy) {
            const author = await _fetchAuthorMeta(admin, d.createdBy);
            if (author && author.avatar) { image = author.avatar; hasOwnImage = true; }
        }
        if (image) image = _brandExistingImage(image, req);
        if (!image) { image = _fallbackCardUrl(req); hasOwnImage = false; }

        return { title, desc, image, video: '', hasOwnImage };
    } catch (err) {
        console.warn('[OGP] Poll fetch failed for', pollId, '-', err.message);
        return null;
    }
}

// FEATURE (2026-09-28 — scholarship share-link preview): the scholarship
// details modal's Share tray (app-feed.js → _shareLink) mints
// ?scholarship=<advertId> links. Like ?poll=, that id lives in its own
// collection (scholarship_adverts), so it gets its own small lookup instead
// of going through _fetchPostForPreview. A paused/deleted scholarship
// returns null on purpose → the crawler gets the plain branded card and no
// details of something the admin has withdrawn.
async function _fetchScholarshipForPreview(advertId, req) {
    const admin = _getAdmin();
    if (!admin) return null;
    try {
        const snap = await admin.firestore().collection('scholarship_adverts').doc(advertId).get();
        if (!snap.exists) { console.warn('[OGP] No scholarship found for', advertId); return null; }
        const d = snap.data() || {};
        if (d.active === false) return null;
        const title = '🎓 ' + (d.title || 'Scholarship') + (d.sponsor ? ' — sponsored by ' + d.sponsor : '');
        const parts = [];
        parts.push((d.fundingType || 'Scholarship') + (d.institution ? ' at ' + d.institution : '') + '.');
        if (/full/i.test(String(d.fundingType || '')) && /partial/i.test(String(d.fundingType || ''))) parts.push('Fully funded and partially funded opportunities available.');
        else if (d.totalFee != null) parts.push(Number(d.studentPays) > 0 ? 'Sponsor covers ' + _scholarshipMoney(d.sponsorPays) + ', you pay ' + _scholarshipMoney(d.studentPays) + '.' : 'Fully funded \u2014 no cost to you.');
        if (d.endDate) parts.push('Apply by ' + _scholarshipFmtDate(d.endDate) + '.');
        parts.push('Tap to view requirements and apply on Empyrean.');
        // (2026-09-29) The scholarship's own image (Admin → Scholarships → "Scholarship Image",
        // saved as `imageUrl` by app-admin.js) is the share thumbnail; the branded fallback card is
        // now only used when a scholarship was pushed without one. Used as-is (no logo stamp — the
        // artwork already carries its own emblem) and flagged hasOwnImage so no 1200x630 dims are
        // asserted for an image of a different aspect ratio.
        const ownImage = (typeof d.imageUrl === 'string' && /^https?:\/\//i.test(d.imageUrl)) ? d.imageUrl : '';
        return { title, desc: parts.join(' '), image: ownImage || _fallbackCardUrl(req), video: '', hasOwnImage: !!ownImage };
    } catch (err) {
        console.warn('[OGP] Scholarship fetch failed for', advertId, '-', err.message);
        return null;
    }
}

// FEATURE (2026-10-23 — celebration share-link preview): the Graduate Celebrations gallery
// (app-feed.js → empyreanCelebrationRail) mints ?celebration=<id> links. The link thumbnail is the
// FIRST photo the student uploaded for their matriculation/convocation card, with the card's
// name / institution / course in the title + description. Paused or deleted cards (active === false
// / missing) return null → the crawler gets the plain branded card and nothing about them.
async function _fetchCelebrationForPreview(celId, req) {
    const admin = _getAdmin();
    if (!admin) return null;
    try {
        const snap = await admin.firestore().collection('celebrations').doc(celId).get();
        if (!snap.exists) { console.warn('[OGP] No celebration found for', celId); return null; }
        const d = snap.data() || {};
        if (d.active === false) return null;
        const mat = d.type === 'matriculation';
        const name = d.studentName || 'Our student';
        const title = (mat ? '🎉 ' : '🎓 ') + name + ' — ' + (mat ? 'Matriculation' : 'Convocation') + (d.institution ? ' at ' + d.institution : '');
        const parts = [];
        if (d.course) parts.push(d.course + (d.department ? ' (' + d.department + ')' : '') + '.');
        else if (d.department) parts.push('Department of ' + d.department + '.');
        parts.push(mat ? 'Welcome to campus! Celebrate this new student on Empyrean.' : 'Congratulations, graduate! Celebrate this milestone on Empyrean.');
        const first = (Array.isArray(d.images) ? d.images : []).find(u => typeof u === 'string' && /^https?:\/\//i.test(u)) || '';
        return { title, desc: parts.join(' '), image: first || _fallbackCardUrl(req), video: '', hasOwnImage: !!first };
    } catch (err) {
        console.warn('[OGP] Celebration fetch failed for', celId, '-', err.message);
        return null;
    }
}

// FEATURE (2026-11-06 — disbursement invite link preview): the "Application Submitted" screen (app-ngo.js
// _indAcctShowInvite) mints links as "/?invite=<CODE>". The code lives on the applicant's individual_account_info doc
// (inviteCode); only the CATEGORY is read from it — nothing about the applicant is ever put on the card. When the code
// isn't found (or Firestore Admin isn't configured) the live category on app_settings/individual_account_form is used,
// and failing that a generic "Disbursement" card. Image = the branded 1200x630 card with the category + "REGISTRATION
// NOW OPEN" stamped on via Cloudinary text layers (needs CLOUDINARY_CLOUD; without it the plain branded card + QR is used).
function _cldText(s) { return encodeURIComponent(String(s)).replace(/%2C/g, '%252C').replace(/%2F/g, '%252F'); }
function _inviteCardUrl(category, req) {
    const cloud = process.env.CLOUDINARY_CLOUD;
    if (!cloud) return _fallbackCardWithQr(req);
    const t = String(category || 'Disbursement').slice(0, 40);
    const size = t.length <= 18 ? 76 : t.length <= 28 ? 60 : 46;
    const chain = 'w_1200,h_630,c_fill,q_auto,f_jpg'
        + '/l_text:Georgia_' + size + '_bold:' + _cldText(t) + ',co_white,b_rgb:0B1E3FD9,g_south_west,x_60,y_150,fl_layer_apply'
        + '/l_text:Arial_28_bold_letter_spacing_6:' + _cldText('REGISTRATION NOW OPEN') + ',co_rgb:E8CF8E,b_rgb:0B1E3FD9,g_south_west,x_60,y_90,fl_layer_apply'
        + (_qrOn(req) ? '/' + _qrOverlayLayer(req, { w: 0.2, g: 'south_east', x: 40, y: 40 }) : '');
    return 'https://res.cloudinary.com/' + cloud + '/image/fetch/' + chain + '/' + encodeURIComponent(_fallbackCardUrl(req));
}
async function _fetchInviteForPreview(code, req) {
    let category = '';
    const admin = _getAdmin();
    if (admin) {
        try {
            const db = admin.firestore();
            const q = await db.collection('individual_account_info').where('inviteCode', '==', String(code).toUpperCase()).limit(1).get();
            if (!q.empty) category = String((q.docs[0].data() || {}).category || '').trim();
            if (!category) {
                const st = await db.collection('app_settings').doc('individual_account_form').get();
                if (st.exists) category = String((st.data() || {}).category || '').trim();
            }
        } catch (err) {
            console.warn('[OGP] Invite fetch failed for', code, '-', err.message);
        }
    }
    const label = category || 'Disbursement';
    return {
        title: label + ' — Register on Empyrean',
        desc: 'You have been invited to apply. Tap to register and submit your details.',
        image: _inviteCardUrl(label, req),
        video: '',
        hasOwnImage: false
    };
}

// FEATURE (2026-10-28 — group invite link preview): "?openGroup=<id>" links now unfurl to the group's own picture + name
// (previously they hit the bare-app branch and showed the generic Empyrean card). No picture set -> branded card, same as before.
/* FIX (2026-10-28 — group link still showed the generic logo): unlike _fetchPostForPreview, this had no second chance —
   one transient Firestore/Admin hiccup on the crawler's single request returned null and WhatsApp got (and then cached) the
   generic "Join the Empyrean community" card. Retries once after 400ms, same as posts. */
async function _fetchGroupForPreview(groupId, req) {
    const first = await _fetchGroupForPreviewOnce(groupId, req);
    if (first) return first;
    await _delay(400);
    return _fetchGroupForPreviewOnce(groupId, req);
}
async function _fetchGroupForPreviewOnce(groupId, req) {
    const admin = _getAdmin();
    if (!admin) return null;
    try {
        const snap = await admin.firestore().collection('groups').doc(groupId).get();
        if (!snap.exists) return null;
        const d = snap.data() || {};
        const av = (typeof d.avatar === 'string' && /^https?:\/\//i.test(d.avatar)) ? d.avatar : '';
        const n = Array.isArray(d.members) ? d.members.length : 0;
        return {
            title: d.name || 'Empyrean group',
            desc: 'Group chat invite' + (n ? ' · ' + n + ' member' + (n === 1 ? '' : 's') : '') + ' — tap to join on Empyrean.',
            // compact (<=1000px JPEG, logo + QR badge) so the group photo stays under WhatsApp's ~300KB og:image limit — a raw
            // uploaded avatar is often larger than that, in which case WhatsApp silently drops it and shows the generic logo.
            image: av ? _brandExistingImage(av, req, true) : _fallbackCardUrl(req), video: '', hasOwnImage: !!av
        };
    } catch (err) {
        console.warn('[OGP] Group fetch failed for', groupId, '-', err.message);
        return null;
    }
}

// Cloudinary can derive a static JPG poster frame from a video URL by
// swapping /video/upload/ → /video/upload/<flags>/ and the extension to
// .jpg. This lets video posts still show a real thumbnail in WhatsApp/FB
// previews even though inline video playback in those apps isn't possible
// for non-whitelisted domains. Only rewrites recognised Cloudinary video
// URLs; anything else (e.g. a raw Render-hosted mp4) is left alone and
// simply won't get an og:image, same as before.
//
// A translucent dark circle + white play triangle is chained on top (two
// stacked l_text unicode-glyph overlays, so no separate icon asset has to
// be uploaded to Cloudinary). This keeps the "this is a video, tap to
// watch" affordance visible even on platforms that only ever render the
// static og:image and never attempt inline playback at all (WhatsApp,
// Telegram, iMessage) — see the og:video tags added in _fetchPostForPreview
// below for the platforms that CAN autoplay it inline instead.
const PLAY_BUTTON_OVERLAY =
    'l_text:Arial_170_bold:%E2%97%8F,co_rgb:00000080,fl_layer_apply,g_center' +
    '/l_text:Arial_80_bold:%E2%96%B6,co_white,fl_layer_apply,g_center,x_8';

// ── Branding overlay: the small white logo badge stamped onto the
//    bottom-right corner of EVERY generated card (real photo, video poster,
//    or avatar placeholder alike — this is what "insert the logo in all
//    thumbnail cards across all sections" means below). This is separate
//    from the tiny favicon that WhatsApp/Facebook already render next to
//    the domain/link line (see _logoUrl/_whiteLogoUrl usage in the <head>
//    below) — that one is out of our hands stylistically (the platform
//    renders it, we only supply the URL). This overlay is baked directly
//    into the image pixels, so it survives on every platform including the
//    ones (X/Twitter, iMessage) that don't show a favicon line at all.
//
// l_fetch:<base64 remote url> lets Cloudinary pull our own /logo-white.png
// into the transformation without it having to be uploaded to the
// Cloudinary account first — works for both requests to Cloudinary-hosted
// images (image/upload/...) and remote-fetched ones (image/fetch/...).
function _logoOverlayLayer(req, opts) {
    opts = opts || {};
    const w = opts.w || 90;
    const logoB64 = Buffer.from(_whiteLogoUrl(req)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // Cloudinary wants URL-safe, unpadded base64
    return 'l_fetch:' + logoB64 + ',w_' + w + ',fl_relative,c_fit,o_92' +
        ',g_south_east,x_28,y_24,fl_layer_apply';
}

// The avatar badge stamped onto the TOP-LEFT corner — used on video posters
// and on the avatar-placeholder card (a real photo post keeps its own
// composition untouched aside from the logo badge above, so it isn't also
// covered by a redundant avatar circle).
function _avatarOverlayLayer(avatarUrl, opts) {
    opts = opts || {};
    const size = opts.size || 130;
    const avatarB64 = Buffer.from(avatarUrl).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return 'l_fetch:' + avatarB64 +
        ',w_' + size + ',h_' + size + ',c_thumb,g_face,r_max,bo_6px_solid_white' +
        ',g_north_west,x_28,y_24,fl_layer_apply';
}

// ── QR code overlay for share-link thumbnail cards ─────────────────────────
// FEATURE (request — "along the join empyrean link let it generate QR code that people can scan and join the site",
// later extended to "it should also generate the video and pictures images"): every card a crawler gets from the
// share route below (Join/fallback card, photo posts, video posters, avatar-placeholder cards) now carries a small
// "SCAN TO JOIN" QR badge baked into the image pixels, exactly the way the white logo badge already is
// (_logoOverlayLayer): a Cloudinary `l_fetch` overlay that pulls our own /qr-join.png (route further down).
//  - Opt-in per request: only the share route sets req._withQr, so push-notification thumbnails (which reuse the same
//    helpers with a pseudo-req) are untouched.
//  - Placement: bottom-LEFT on photos/videos/avatar cards (avatar badge is top-left, logo bottom-right, play button
//    centre), bottom-RIGHT on the plain Join/fallback card (it has no logo badge).
//  - Target: QR_JOIN_URL env var if set, else APP_DOMAIN (or https://joinempyrean.com) + "/?ref=qr" so sign-ups from
//    scans can be told apart. Bump the "?v=" number in _qrImageUrl() after changing it, to bust Cloudinary's cache.
const _zlib = require('zlib');
let _qrJoinPng = null;

function _qrOn(req) { return !!(req && req._withQr === true); }
function _qrJoinTarget() {
    if (process.env.QR_JOIN_URL) return process.env.QR_JOIN_URL;
    return String(process.env.APP_DOMAIN || 'https://joinempyrean.com').replace(/\/+$/, '') + '/?ref=qr';
}
function _qrImageUrl(req) {
    return req.protocol + '://' + req.get('host') + '/qr-join.png?v=1';
}
function _qrOverlayLayer(req, opts) {
    opts = opts || {};
    const b64 = Buffer.from(_qrImageUrl(req)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return 'l_fetch:' + b64 + ',w_' + (opts.w || 0.17) + ',fl_relative,c_fit,r_14' +
        ',g_' + (opts.g || 'south_west') + ',x_' + (opts.x || 28) + ',y_' + (opts.y || 24) + ',fl_layer_apply';
}
// The plain branded 1200x630 card, with only the QR added (bottom-right) — used wherever the share route has no
// media of its own and would otherwise hand the crawler the bare static og-fallback.jpg.
function _fallbackCardWithQr(req) {
    const cloud = process.env.CLOUDINARY_CLOUD;
    if (!cloud || !_qrOn(req)) return _fallbackCardUrl(req);
    const chain = 'w_1200,h_630,c_fill,q_auto,f_jpg/' + _qrOverlayLayer(req, { w: 0.2, g: 'south_east', x: 40, y: 40 });
    return 'https://res.cloudinary.com/' + cloud + '/image/fetch/' + chain + '/' + encodeURIComponent(_fallbackCardUrl(req));
}

// Builds the QR panel PNG itself (white panel, QR, "SCAN TO JOIN" caption) with Node's built-in zlib — no image
// library needed. Grayscale 8-bit PNG, cached in memory after the first request.
const _QR_FONT = {
    S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
    C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
    A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
    N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
    T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
    O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
    J: ['..XXX', '...X.', '...X.', '...X.', '...X.', 'X..X.', '.XX..'],
    I: ['.XXX.', '..X..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
};
let _crcTable = null;
function _crc32(buf) {
    if (!_crcTable) {
        _crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crcTable[n] = c; }
    }
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}
function _pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(_crc32(td), 0);
    return Buffer.concat([len, td, crc]);
}
function _buildJoinQrPng() {
    const qr = QRCode.create(_qrJoinTarget(), { errorCorrectionLevel: 'M' });
    const n = qr.modules.size, mods = qr.modules.data;
    const S = 10, Q = 4;                         // pixels per module, quiet-zone modules
    const qrPx = (n + 2 * Q) * S;
    const D = 4, label = 'SCAN TO JOIN';         // caption dot size
    const labelH = 7 * D + 2 * 12;
    const W = qrPx, H = qrPx + labelH;
    const px = Buffer.alloc(W * H, 255);         // white
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (!mods[r * n + c]) continue;
        const x0 = (Q + c) * S, y0 = (Q + r) * S;
        for (let y = 0; y < S; y++) px.fill(10, (y0 + y) * W + x0, (y0 + y) * W + x0 + S);
    }
    const textW = label.length * 6 * D - D;      // 5 dots + 1 dot gap per glyph
    let tx = Math.floor((W - textW) / 2);
    const ty = qrPx + 12 - Q * 0;                // caption sits just under the quiet zone's bottom edge
    for (const ch of label) {
        const g = _QR_FONT[ch] || _QR_FONT[' '];
        for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
            if (g[gy][gx] !== 'X') continue;
            for (let dy = 0; dy < D; dy++) px.fill(10, (ty + gy * D + dy) * W + tx + gx * D, (ty + gy * D + dy) * W + tx + gx * D + D);
        }
        tx += 6 * D;
    }
    const raw = Buffer.alloc((W + 1) * H);
    for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; px.copy(raw, y * (W + 1) + 1, y * W, y * W + W); }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        _pngChunk('IHDR', ihdr), _pngChunk('IDAT', _zlib.deflateSync(raw, { level: 9 })), _pngChunk('IEND', Buffer.alloc(0))
    ]);
}

// Fire-and-forget GET that forces a lazily-generated Cloudinary derivative
// (video poster + branding overlay chain, or a fetched/framed avatar card)
// to render and cache NOW, instead of waiting for whichever platform first
// tries to load a share link to accidentally trigger — and possibly time
// out on — that same render. Errors/timeouts here are swallowed on
// purpose: this is a best-effort optimization, never something a caller
// should block on or fail because of.
function _prewarmUrl(url) {
    if (!url || !/^https:\/\//i.test(url)) return;
    try {
        const req = https.get(url, { timeout: 20000 }, (res) => {
            res.resume(); // drain and discard — we only care that Cloudinary rendered it
        });
        req.on('error', (err) => console.warn('[Prewarm] failed for', url, '-', err.message));
        req.on('timeout', () => req.destroy());
    } catch (err) {
        console.warn('[Prewarm] threw for', url, '-', err.message);
    }
}

// FIX (share-link card thumbnail failing/blank): _prewarmUrl above is
// fire-and-forget, fired only from _sendPushForDoc — i.e. only for the
// push-notification thumbnail, at doc-creation time. It was never called
// from the actual crawler-facing share-preview route below, so the very
// FIRST time anyone's og:image/og:video URL is hit — which, for a share
// link, is exactly the crawler's own fetch — Cloudinary has to render that
// derivative (video poster frame + logo/avatar overlay chain) from cold.
// That render can take several seconds; WhatsApp/Facebook/etc. only wait a
// few before giving up, so the very share this whole feature exists for is
// the one most likely to get a blank/failed card. This is the exact same
// failure mode the comment above _prewarmUrl already documents for push
// thumbnails — just never applied to this route too.
//
// Awaitable, bounded version: used ONLY here, right before responding to a
// real crawler, so THIS crawler's own fetch (which happens immediately
// after we respond) lands on an already-rendered, CDN-cached derivative
// instead of racing Cloudinary's first render. Never rejects and never
// waits past timeoutMs — a slow/unavailable Cloudinary render just means
// this crawler's own subsequent fetch has to do the cold render itself,
// i.e. no worse than before this fix, only better.
function _prewarmUrlAwait(url, timeoutMs) {
    return new Promise((resolve) => {
        if (!url || !/^https:\/\//i.test(url)) { resolve(); return; }
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        try {
            const req = https.get(url, { timeout: timeoutMs }, (res) => {
                res.resume();
                res.on('end', finish);
                res.on('error', finish);
            });
            req.on('error', finish);
            req.on('timeout', () => { req.destroy(); finish(); });
        } catch (err) {
            finish();
        }
        setTimeout(finish, timeoutMs); // hard ceiling regardless of socket/stream state
    });
}

function _videoPosterFromCloudinary(url, req, avatarUrl) {
    if (!url) return '';
    try {
        let chain = 'so_0,w_1200,h_630,c_fill,q_auto,f_jpg/' + PLAY_BUTTON_OVERLAY;
        // Branding is optional here (req not always available to every
        // caller of this helper) — callers that can supply it get the full
        // avatar+logo treatment; the rest still get a correct poster frame,
        // just without the badges baked in.
        if (req) {
            if (avatarUrl) chain += '/' + _avatarOverlayLayer(avatarUrl);
            chain += '/' + _logoOverlayLayer(req);
            if (_qrOn(req)) chain += '/' + _qrOverlayLayer(req); // QR badge, bottom-left
        }

        // Cloudinary-hosted video (older posts, uploaded before the
        // 2026-08-03 Firebase Storage migration) — rewrite the URL in
        // place, exactly as before. Unchanged so existing share links for
        // old posts keep working.
        if (/res\.cloudinary\.com/i.test(url) && /\/video\/upload\//.test(url)) {
            return url
                .replace('/video/upload/', '/video/upload/' + chain + '/f_jpg/')
                .replace(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i, '.jpg');
        }

        // MIGRATED (2026-08-03): new video uploads go to Firebase Storage,
        // not Cloudinary, so they never match the block above. Cloudinary's
        // "fetch" delivery type can still pull ANY public URL on the fly
        // (video included) and derive a poster frame from it — the same
        // trick _avatarPlaceholderCard below already relies on for
        // non-Cloudinary avatar photos. Requires CLOUDINARY_CLOUD, which
        // stays configured specifically for this transform-only role even
        // though it's no longer used for storage — see render.yaml.
        //
        // FIX (News Media video thumbnail falling back to the generic logo
        // — image thumbnails worked fine, video didn't): this branch was
        // missing the exact same ".jpg" trick the in-account branch two
        // lines above already relies on. `f_jpg` inside the transformation
        // chain only controls video ENCODING format (f_mp4/f_webm/etc.) —
        // it does not, on its own, tell Cloudinary's /video/fetch/ delivery
        // to output a still IMAGE instead of a transcoded video. The
        // documented way to get an image derivative from a fetched video is
        // the same one already used for in-account videos: end the request
        // path in a still-image extension. Without it, Cloudinary either
        // served (or tried to transcode into) an actual video file where an
        // og:image was expected — which every platform treats as a broken
        // image and silently falls back to the generic branded/logo card,
        // exactly the reported symptom.
        const cloud = process.env.CLOUDINARY_CLOUD;
        if (cloud && /^https?:\/\//i.test(url)) {
            return 'https://res.cloudinary.com/' + cloud + '/video/fetch/' + chain + '/' + encodeURIComponent(url) + '.jpg';
        }

        return '';
    } catch (e) {
        return '';
    }
}

// Video file extension → MIME type, for the og:video:type tag below.
// Anything unrecognised defaults to mp4, the format the app's own upload
// pipeline normalizes most video to.
function _videoMimeType(url) {
    return /\.webm(\?|$)/i.test(url) ? 'video/webm' : 'video/mp4';
}

// When someone has no avatar photo at all, generate the SAME initials
// placeholder the client already falls back to on a broken <img> (see
// app-status.js's `onerror="this.src='https://ui-avatars.com/api/?...'"`)
// so a share-link card and the in-app UI never disagree about what a
// avatar-less user "looks like".
function _uiAvatarPlaceholder(name) {
    const label = String(name || 'U').trim() || 'U';
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(label)
        + '&background=1B2B8B&color=fff&size=512&bold=true&format=png';
}

// REDESIGN (2026-07-29 — replaces the old "one oversized avatar stretched
// to the middle of the card" look, per the reference screenshot): the
// avatar is meant to be a small circle-cropped badge tucked into the
// TOP-LEFT corner with a white ring, matching how a real WhatsApp/
// Facebook share card frames the sender's photo — not a giant centered
// portrait. The white logo badge (_logoOverlayLayer) is stamped
// bottom-right on the same canvas, so the card reads "branded post from
// this person" at a glance instead of just "here's someone's face".
//
// FIX (2026-08-18 — reported again: "the profile avatar picture is at the
// center and very blur"): the previous canvas ('w_1,h_1,c_fill' collapsing
// the avatar down to a single pixel, then 'c_pad' framing THAT into
// 1200x630) was meant to make the collapsed pixel invisible, but
// Cloudinary's c_pad scales a square source up to fill the SHORTER target
// dimension (630 here) before padding the rest with the background color
// — so instead of vanishing, that 1x1 pixel was stretched into a visible
// ~630x630 smear of the avatar's own average color sitting dead center of
// the card, underneath the small corner badge. That smear is exactly the
// "center and very blur" symptom. Deriving the canvas from the avatar
// photo at all was the mistake — this now builds the base canvas from the
// site's own already-correct 1200x630 branded card asset
// (_fallbackCardUrl, the same one used as the ultimate no-post-found
// fallback further down this file) instead, so nothing of the avatar is
// ever baked into the background — the avatar only ever appears as the
// small top-left corner badge it was always meant to be.
// Requires CLOUDINARY_CLOUD (already set for uploads — see render.yaml);
// returns '' if it isn't configured, so callers can fall back gracefully.
function _avatarPlaceholderCard(avatarUrl, req) {
    if (!avatarUrl) return '';
    const cloud = process.env.CLOUDINARY_CLOUD;
    if (!cloud) return '';

    // req is optional (see _resolveImageFromDoc's pseudo-req callers) —
    // without a real req we can't build the logo overlay URL (needs
    // req.protocol/host), so just fall back to a plain, un-badged branded
    // card rather than skip straight to a bare avatar photo.
    const baseReq = req || _pseudoReq();
    const baseUrl = _fallbackCardUrl(baseReq || { protocol: 'https', get: () => 'joinempyrean.com' });

    let chain = 'w_1200,h_630,c_fill,q_auto,f_jpg';
    if (req) {
        // Layered on top of the branded base image, positioned against the
        // full 1200x630 frame — top-left avatar badge, bottom-right logo.
        chain += '/' + _avatarOverlayLayer(avatarUrl, { size: 150 });
        chain += '/' + _logoOverlayLayer(req);
        if (_qrOn(req)) chain += '/' + _qrOverlayLayer(req); // QR badge, bottom-left
    }

    return 'https://res.cloudinary.com/' + cloud + '/image/fetch/' + chain + '/' + encodeURIComponent(baseUrl);
}

// Shared media-array resolver — same logic previously inlined in
// _fetchPostForPreview, now callable for any doc shaped like a regular
// post (a `media` array field), so SOS/crisis/quick-post/quote docs all
// go through one path. Returns both the poster `image` (for og:image /
// the notification thumbnail) and the raw `video` URL when the first media
// item is a video, so callers can also emit og:video for inline playback.
function _imageFromMediaArray(media, d, req) {
    media = media || [];
    if (!Array.isArray(media) || !media.length) return { image: '', video: '' };
    const first = media[0];
    const rawUrl = (typeof first === 'string') ? first : (first && (first.url || first._cloudUrl)) || '';
    if (_looksLikeVideo(first, rawUrl)) {
        const avatar = d && d.avatar || '';
        return { image: _videoPosterFromCloudinary(rawUrl, req, avatar) || d.thumbnailUrl || d.posterUrl || '', video: rawUrl };
    }
    // A real photo already carries plenty of content of its own — only the
    // logo badge is stamped on it (no avatar circle, so the photo itself
    // stays uncovered), still satisfying "logo inserted in all thumbnail
    // cards across all sections" for image posts.
    // SUPERSEDED (quote/meme share-thumbnail fix): kept for reference, never runs.
    // It handed WhatsApp the raw original — for a Quote/Meme Card that is a
    // 1080x1080 PNG (app-fixes.js's EmpQuoteCard export; app-dom.js's
    // _compressImage leaves PNGs under 1920px untouched), typically well
    // over the ~300KB WhatsApp will accept for an og:image, so it silently
    // dropped the thumbnail and showed the small favicon logo instead.
    if (false && rawUrl && req) {
        return { image: _brandExistingImage(rawUrl, req), video: '' };
    }
    const _isQuoteMemeCard = !!(d && d.isQuoteCard === true) || /quote-card-/i.test(String(rawUrl));
    if (rawUrl && req) {
        return { image: _brandExistingImage(rawUrl, req, _isQuoteMemeCard), video: '' };
    }
    return { image: rawUrl, video: '' };
}

// Stamps just the white logo badge (no avatar) onto an already-final photo
// — used for real post/reel/news/status images so every card carries the
// brand mark without a redundant face badge covering someone's photo.
function _brandExistingImage(imageUrl, req, compact) {
    if (!imageUrl) return imageUrl;
    const logoLayer = _logoOverlayLayer(req);
    // QR badge (share route only — see _qrOn): appended right after the logo layer in every branch below.
    const qrPart = _qrOn(req) ? '/' + _qrOverlayLayer(req) : '';
    // compact (Quote/Meme Card share previews only): re-encode as a <=1000px
    // JPEG so the og:image stays under WhatsApp's thumbnail size limit.
    // Cloudinary-hosted originals get the transform inserted in place;
    // anything else (Firebase Storage — where uploads live now) goes through
    // Cloudinary's /image/fetch/ exactly like _avatarPlaceholderCard and
    // _videoPosterFromCloudinary already do. Falls through to the original
    // behaviour below if Cloudinary isn't configured.
    if (compact) {
        const compactChain = 'w_1000,c_limit,q_auto,f_jpg';
        if (/^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//i.test(imageUrl)) {
            return imageUrl.replace('/image/upload/', '/image/upload/' + compactChain + '/' + logoLayer + qrPart + '/');
        }
        const _cloud = process.env.CLOUDINARY_CLOUD;
        if (_cloud && /^https:\/\//i.test(imageUrl)) {
            return 'https://res.cloudinary.com/' + _cloud + '/image/fetch/' + compactChain + '/' + logoLayer + qrPart + '/' + encodeURIComponent(imageUrl);
        }
    }
    if (/^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//i.test(imageUrl)) {
        return imageUrl.replace('/image/upload/', '/image/upload/' + logoLayer + qrPart + '/');
    }
    // QR share cards: photos hosted on Firebase Storage (where uploads live now) can't take an in-place transform, so
    // when the QR is on they go through Cloudinary's /image/fetch/ like the poster/avatar cards do, re-encoded as a
    // <=1200px JPEG (also keeps the og:image under WhatsApp's thumbnail size limit).
    if (qrPart && /^https:\/\//i.test(imageUrl) && process.env.CLOUDINARY_CLOUD) {
        return 'https://res.cloudinary.com/' + process.env.CLOUDINARY_CLOUD + '/image/fetch/w_1200,c_limit,q_auto,f_jpg/' + logoLayer + qrPart + '/' + encodeURIComponent(imageUrl);
    }
    // Not a Cloudinary asset we can insert a transform into directly (rare —
    // e.g. an OAuth photo URL saved straight onto a doc) — leave untouched
    // rather than forcing every real photo through a remote-fetch re-encode.
    return imageUrl;
}

// One retry, 400ms later, ONLY on a thrown error (a genuinely missing doc
// — snap.exists === false — is not retried, that's a correct "not found",
// not a transient failure). FIX (reported — a specific share link fell
// all the way back to the generic branded "Join the Empyrean community"
// card instead of generating that post's own avatar/thumbnail card): a
// crawler's fetch is a single, one-shot HTTP request with no retry of its
// own — if the Admin SDK's Firestore call hiccups on that one attempt
// (a momentary network blip to Firestore, the same class of transient
// failure app-patch-v26.js/v35.js already retry on the client side for
// auth/join-request calls), _fetchPostForPreview used to return null
// immediately and the crawler got the plain fallback card, with no second
// chance — even though the doc is perfectly fine and a normal page load
// a moment later would have found it. This gives that one extra chance
// before giving up.
async function _fetchPostForPreviewOnce(postId, req) {
    const admin = _getAdmin();
    if (!admin) return null;
    try {
        let collection = _collectionForId(postId);
        // 'profile-<uid>' is the only prefix where the Firestore doc id
        // ISN'T the raw postId itself — every other prefix (news-, reel-,
        // mkt-, etc.) is baked into the actual doc id at write time, but
        // users/{uid} docs are keyed by the plain uid, same as
        // app-startup.js's own boot-time opener already strips it (see
        // that file's profile- branch) before calling renderUserProfile().
        const docId = collection === 'users' ? postId.replace(/^profile-/i, '') : postId;
        let snap = await admin.firestore().collection(collection).doc(docId).get();

        // FIX (Go Live Share button + Admin announcement posts falling back
        // to the generic logo, for BOTH image and video, not just video):
        // unlike every other content type, announcements are created with
        // Firestore's own auto-generated push id (see app-fixes.js's
        // announce-form submit handler: `fbDb.collection('announcements').doc()`
        // with no custom prefix at all), and this codebase's live-stream
        // docs follow the same bare-id convention. _collectionForId() only
        // ever knows how to route a RECOGNISED PREFIX (crisis-, sos-, news-,
        // reel-, ...) — an unprefixed id it's never seen before just falls
        // through to its `return 'posts'` default, which of course 404s,
        // since the real doc lives in 'announcements' or 'active_streams'.
        // A 404 here previously meant an immediate `return null` — the
        // crawler got the plain generic fallback card with no attempt to
        // look anywhere else. Trying those two collections next, only when
        // the first guess missed, fixes both share flows without needing
        // to know (or guess wrong) the exact id scheme each one mints —
        // and costs nothing extra for every OTHER content type, which
        // already matches on the first try and never reaches this fallback.
        if (!snap.exists) {
            for (const fallbackCol of ['announcements', 'active_streams']) {
                if (fallbackCol === collection) continue; // already tried above
                const fbSnap = await admin.firestore().collection(fallbackCol).doc(postId).get();
                if (fbSnap.exists) { snap = fbSnap; collection = fallbackCol; break; }
            }
        }

        if (!snap.exists) {
            console.warn('[OGP] No doc found for', postId, 'in collection', collection, '(also checked announcements/active_streams)');
            return null;
        }
        const d = snap.data() || {};

        // isSos is keyed off the ID prefix, not the collection, now that
        // sos- IDs are looked up in `posts` (see _collectionForId above) —
        // `collection === 'sos_queue'` would never be true anymore, and
        // `d.isSOS` is never actually written by the client, so it was
        // always dead weight anyway.
        const isSos    = /^sos-/i.test(postId);
        const isCrisis = collection === 'crisis_reports';
        const isNews   = collection === 'news_posts';
        const isReel   = collection === 'reels';
        const isStatus = collection === 'statuses';
        const isBiz    = collection === 'business_pages';
        const isMarketplace = collection === 'marketplace_listings';
        const isProfile = collection === 'users';
        const isAnnouncement = collection === 'announcements';
        const isLive   = collection === 'active_streams';

        const author = d.username || d.displayUsername || d.fullName || d.name || 'Empyrean';

        // Follower count + verified badge for the Facebook-style card — a
        // second, small read against users/{userId}, since post/reel/news/
        // status docs only store username + avatar, not followerCount.
        // Skipped for SOS/crisis, which lead with the report, not the
        // reporter's profile. Marketplace listings lead with the product,
        // not the seller's follower count, so also skipped here. Skipped
        // for a profile link too — `d` IS the users/ doc already, a second
        // lookup of the same doc would just be wasted latency.
        // Also skipped when d.userId is the literal string 'admin' —
        // app-admin.js's news-publish form falls back to that placeholder
        // when no real logged-in uid is available (see its own comment:
        // `(window.userState && window.userState.id) || 'admin'`), which is
        // never an actual users/{uid} doc id, so this would always be a
        // guaranteed-to-fail extra round trip for every article published
        // that way — pure wasted latency on the crawler's one-shot request,
        // and latency is exactly what pushes a request past whatever
        // patience a crawler has before it gives up and shows the generic
        // fallback card instead.
        let authorMeta = null;
        if (!isSos && !isCrisis && !isBiz && !isMarketplace && !isProfile && !isAnnouncement && !isLive && d.userId && d.userId !== 'admin') {
            authorMeta = await _fetchAuthorMeta(admin, d.userId);
        }
        const followersLine = authorMeta
            ? _formatFollowers(authorMeta.followerCount) + (authorMeta.followerCount === 1 ? ' follower' : ' followers')
            : '';
        const verifiedMark = (authorMeta && authorMeta.isVerified) ? '✓ ' : '';

        let title, desc, image = '', video = '';

        if (isSos) {
            title = '🆘 SOS: ' + (d.title || 'Help Request') + ' — by @' + author;
            desc  = String(d.story || d.text || d.description || 'View this post on Empyrean.').replace(/\s+/g, ' ').trim().slice(0, 180);
            ({ image, video } = _imageFromMediaArray(d.media, d, req));
        } else if (isCrisis) {
            title = '🚨 Crisis Report — by @' + author;
            desc  = String(d.story || d.text || d.description || 'View this post on Empyrean.').replace(/\s+/g, ' ').trim().slice(0, 180);
            ({ image, video } = _imageFromMediaArray(d.media, d, req));
        } else if (isNews) {
            // news_posts schema, confirmed against app-news.js's own renderer:
            // { title, content, mediaUrl, mediaType, userId, username, createdAt }.
            // mediaType is a MIME string ("video/mp4"), not the bare word
            // "video" — matched here the same way app-news.js itself detects
            // video vs image (MIME prefix, Cloudinary video path, or file ext).
            const newsIsVideo = !!(d.mediaUrl && (
                (d.mediaType || '').startsWith('video/')
                || /\/video\/upload\//i.test(d.mediaUrl)
                || /\.(mp4|webm|mov)(\?|$)/i.test(d.mediaUrl)
            ));
            title = '📰 ' + (d.title || 'Empyrean News');
            desc  = String(d.content || 'Read the full story on Empyrean.').replace(/\s+/g, ' ').trim().slice(0, 180);
            image = d.mediaUrl
                ? (newsIsVideo ? (_videoPosterFromCloudinary(d.mediaUrl, req, d.avatar || '') || '') : (req ? _brandExistingImage(d.mediaUrl, req) : d.mediaUrl))
                : '';
            video = newsIsVideo ? d.mediaUrl : '';
        } else if (isReel) {
            // reels schema (app-fixes.js): { videoUrl, url, caption, userId, username, avatar, poster, likes, views, createdAt }
            title = verifiedMark + '🎬 Reel by @' + author;
            desc  = (followersLine ? followersLine + ' · ' : '') + String(d.caption || 'Watch this reel on Empyrean.').replace(/\s+/g, ' ').trim().slice(0, 160);
            video = d.videoUrl || d.url || '';
            image = _videoPosterFromCloudinary(video, req, d.avatar || '') || d.poster || d.thumbnailUrl || '';
        } else if (isStatus) {
            // statuses schema, confirmed against app-status.js's own writer
            // (_mkItem + the doc.set() calls): the doc is
            // { userId, name, avatar, items: [...], viewed, createdAt, docId },
            // and each item is { id, type, url, content, bg, createdAt, likes,
            // retweets, likedBy, retweetedBy, viewers } — NOT text/caption/
            // mediaUrl as an earlier version of this function guessed. "name"
            // (not "username") is the author display-name field here.
            const items = Array.isArray(d.items) ? d.items : [];
            const latest = items[items.length - 1] || {};
            title = verifiedMark + author + '\u2019s Status';
            desc  = (followersLine ? followersLine + ' · ' : '') + String(latest.content || 'View this status on Empyrean.').replace(/\s+/g, ' ').trim().slice(0, 160);
            const rawUrl = latest.url || '';
            const isVid = latest.type === 'video';
            image = isVid ? (_videoPosterFromCloudinary(rawUrl, req, d.avatar || '') || '') : (rawUrl && req ? _brandExistingImage(rawUrl, req) : rawUrl);
            video = isVid ? rawUrl : '';
        } else if (isBiz) {
            // business_pages schema, confirmed against app-business.js's own
            // renderer: { name, ownerId, bio|description|tagline,
            // coverPhoto|coverImage, profilePhoto|logo,
            // followers (array) OR followerCount (number) }. The page's own
            // follower count is used directly here (no second users/ lookup —
            // that pattern is for a post's personal author, not a page).
            const bizFollowerCount = Array.isArray(d.followers) ? d.followers.length : (d.followerCount || 0);
            const bizFollowersLine = _formatFollowers(bizFollowerCount) + (bizFollowerCount === 1 ? ' follower' : ' followers');
            const bizName = d.name || d.businessName || 'Business';
            title = bizName + ' on Empyrean';
            desc  = bizFollowersLine + ' · ' + String(d.bio || d.description || d.tagline || ('Check out ' + bizName + ' on Empyrean.')).replace(/\s+/g, ' ').trim().slice(0, 150);
            const bizImage = d.coverPhoto || d.coverImage || d.profilePhoto || d.logo || '';
            image = (bizImage && req) ? _brandExistingImage(bizImage, req) : bizImage;
        } else if (isProfile) {
            // users/{uid} schema, confirmed against app-profile.js's own
            // renderer: { fullName, username, bio, avatar, coverPhoto,
            // followerCount, isVerified }. `d` IS the profile doc itself
            // here (not a post authored by someone), so this leads with
            // the person's name/bio/photo directly instead of routing
            // through the author/followersLine machinery built for posts.
            const pFollowerCount = d.followerCount || 0;
            const pFollowersLine = _formatFollowers(pFollowerCount) + (pFollowerCount === 1 ? ' follower' : ' followers');
            const pVerified = d.isVerified ? '✓ ' : '';
            const pName = d.fullName || d.username || 'Empyrean User';
            title = pVerified + pName + ' on Empyrean';
            desc  = pFollowersLine + (d.bio ? (' · ' + String(d.bio).replace(/\s+/g, ' ').trim().slice(0, 150)) : ' · View this profile on Empyrean.');
            const pPhoto = d.avatar || d.photoURL || d.coverPhoto || '';
            image = pPhoto ? _avatarPlaceholderCard(pPhoto, req) : '';
        } else if (isAnnouncement) {
            // announcements schema, confirmed against app-fixes.js's
            // admin-announce-form submit handler: { type, title, body,
            // adminId, createdAt, media? } — media is attached in a
            // separate follow-up write (`.set({media: cloudUrls},
            // {merge:true})`) once any attached photo/video finishes
            // uploading, so it can legitimately be absent on a
            // text-only announcement. Reuses the same media-array
            // resolver every other content type already uses, so
            // announcement videos get the exact same poster-frame +
            // avatar/logo badge treatment as everything else instead
            // of the generic fallback they got before this existed.
            const annIconText = { announcement: '📢', appreciation: '🏆', update: '🔔', 'sos-thanks': '❤️' };
            title = (annIconText[d.type] || '🔔') + ' ' + (d.title || 'Empyrean Admin Announcement');
            desc  = String(d.body || 'View this announcement on Empyrean.').replace(/\s+/g, ' ').trim().slice(0, 180);
            ({ image, video } = _imageFromMediaArray(d.media, d, req));
        } else if (isLive) {
            // active_streams schema — CONFIRMED against app-live.js's own
            // publishLiveStreamToFirestore() write (hostName, hostAvatar,
            // title, doc keyed by the bare streamId with no prefix — the
            // same id the fallback lookup above already searches for
            // directly). A live stream has no static video file to derive
            // a poster from (it's happening right now), so this leads with
            // the host's avatar the same way a profile/no-media post
            // already does, rather than trying to fetch a "poster" that
            // doesn't exist.
            const hostName = d.hostName || d.hostUsername || 'Someone';
            title = '🔴 LIVE: ' + (d.title || 'Live Stream') + ' — ' + hostName;
            desc  = 'Hosted by ' + hostName + '. Tap to join before the stream ends.';
            image = _avatarPlaceholderCard(d.hostAvatar || _uiAvatarPlaceholder(hostName), req);
        } else if (isMarketplace) {
            // marketplace_listings schema, confirmed against
            // app-fixes.js's marketplace-form submit handler: { name,
            // price, currency, description, media, category, categoryFields,
            // salesType, sellerId, sellerName, contactName, location,
            // createdAt }. This is what makes the WhatsApp/Message "share
            // this listing" auto-reply (app-marketplace.js's
            // _mktDecorateDashboardCard / _mktDecorateCard, app-patch-v2.js's
            // quick-contact icons) actually show the product's own photo
            // and name/price instead of a generic Empyrean card once the
            // seller/buyer pastes the link into WhatsApp — those files
            // build the link as '?post=' + the 'mkt-...' listing id.
            const syms = { NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', EMPY: 'EMPY ', USDT: 'USDT ' };
            const sym = syms[d.currency] || '₦';
            const priceStr = sym + (parseFloat(d.price || 0) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
            const sellerLabel = d.sellerName || d.contactName || 'a seller';
            title = (d.name || 'Marketplace Listing') + ' — ' + priceStr;
            desc  = String(d.description || ('Listed by ' + sellerLabel + (d.location ? ' in ' + d.location : '') + ' on Empyrean Marketplace.'))
                .replace(/\s+/g, ' ').trim().slice(0, 180);
            ({ image, video } = _imageFromMediaArray(d.media, d, req));
        } else {
            // Regular posts, Quick Posts, and Quotes all share the 'posts'
            // collection and this same schema.
            title = verifiedMark + '@' + author + ' on Empyrean';
            desc  = (followersLine ? followersLine + ' · ' : '') + String(d.text || d.title || d.description || 'View this post on Empyrean.').replace(/\s+/g, ' ').trim().slice(0, 160);
            ({ image, video } = _imageFromMediaArray(d.media, d, req));
        }

        // hasOwnImage: genuine post/reel/news/status media of unknown aspect
        // ratio — the caller won't assert exact og:image dimensions for this.
        const hasOwnImage = !!image;

        // No media of its own — instead of jumping straight to the generic
        // branded card, personalize it: frame the author's real avatar (own
        // doc's d.avatar, else the users/ profile lookup above) if they have
        // one, or — if they have no avatar photo at all — the same
        // ui-avatars.com initials placeholder the client already falls back
        // to on a broken <img> (see app-status.js). Business pages already
        // have their own logo/coverPhoto fallback above and don't get an
        // authorMeta lookup, so they're left as-is here.
        if (!image && !isBiz && !isMarketplace) {
            const rawAvatar = d.avatar || (authorMeta && authorMeta.avatar) || '';
            image = _avatarPlaceholderCard(rawAvatar || _uiAvatarPlaceholder(author), req);
        }

        return { title, desc, image, video, hasOwnImage };
    } catch (err) {
        console.warn('[OGP] Firestore fetch failed for', postId, 'in', _collectionForId(postId), '-', err.message);
        return null;
    }
}

function _delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function _fetchPostForPreview(postId, req) {
    const first = await _fetchPostForPreviewOnce(postId, req);
    if (first) return first;
    // See _fetchPostForPreviewOnce's own header comment for why this
    // retries once — a genuinely nonexistent doc already resolved above
    // (that path doesn't throw, so this second attempt costs nothing extra
    // for the common "no such post" case; it only matters for a real
    // transient failure on the first attempt).
    console.warn('[OGP] Retrying preview fetch for', postId, 'once after 400ms before falling back to the generic card.');
    await _delay(400);
    return _fetchPostForPreviewOnce(postId, req);
}

// Admin/local access to the SAME card generation crawlers get, so it can
// actually be eyeballed while developing/debugging (e.g.
// http://localhost:26543/?post=post-...) instead of having to spoof a
// crawler User-Agent or wait for WhatsApp/Facebook's own (cached, opaque)
// debug tools. Gated to loopback addresses only — this exposes nothing a
// public crawler request to the same ?post= URL doesn't already reveal,
// but the debug=1 view below shows raw title/desc/image/video values as
// plain HTML rather than the redirect-in-0-seconds crawler page, so it's
// still worth keeping off the public internet.
function _isLocalAdmin(req) {
    const ip = req.ip || req.connection.remoteAddress || '';
    return /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ip) || req.hostname === 'localhost';
}

// ── Server-side config injection for real (non-crawler) visitors ─────────
// Reads public/index.html, injects a synchronous window._appConfig=...
// script right at the EMPYREAN_SERVER_CONFIG_INJECT marker (top of <head>
// — see that marker's own comment in index.html), and serves the result
// directly. This removes the client-side /api/config network round-trip
// from the critical path for EVERY page load, including a person's very
// first-ever visit — not just a cached repeat visit. On a weak connection
// this is the single biggest lever available for "can I even reach a
// working login form" — see this session's own diagnosis (field
// screenshot: 4G/2-bar/70.5 K/s, two sequential ~2-minute retry ladders
// before this fix — /api/config's own retry, THEN Firebase Auth's) for
// the full reasoning.
//
// Falls through to next() (the existing express.static handling further
// down, completely unchanged) whenever injection isn't possible: env vars
// misconfigured, the file can't be read, or the marker isn't present for
// some reason. A real visitor never sees a broken page because of this —
// worst case they silently get the exact same experience as before this
// feature existed (client-side /api/config fetch, as before).
const INDEX_HTML_PATH = path.join(__dirname, 'public', 'index.html');
const CONFIG_INJECT_MARKER = '<!-- EMPYREAN_SERVER_CONFIG_INJECT';
let _indexHtmlCache = null; // { mtimeMs, raw, injected } — avoids re-reading/re-splicing the file on every single request; invalidated automatically on redeploy via mtime

function _serveIndexWithInjectedConfig(req, res, next) {
    try {
        const { config, missing } = _buildPublicConfig();
        if (!config) {
            console.warn('[Config] Server misconfigured (' + missing.join(', ') + ') — serving index.html without injected config; client-side /api/config fetch will handle it as before.');
            return next();
        }

        const stat = fs.statSync(INDEX_HTML_PATH);
        if (!_indexHtmlCache || _indexHtmlCache.mtimeMs !== stat.mtimeMs) {
            const raw = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
            const markerIdx = raw.indexOf(CONFIG_INJECT_MARKER);
            if (markerIdx === -1) {
                console.warn('[Config] EMPYREAN_SERVER_CONFIG_INJECT marker not found in index.html — skipping server-side injection this deploy.');
            }
            _indexHtmlCache = { mtimeMs: stat.mtimeMs, raw, injected: markerIdx === -1 ? null : markerIdx };
        }

        if (_indexHtmlCache.injected === null) return next();

        // \u003c-escape any '<' in the serialized config so a value can
        // never prematurely close this inline <script> tag (defense in
        // depth — these values come from our own trusted env vars, but
        // costs nothing to guard anyway).
        const safeJson = JSON.stringify(config).replace(/</g, '\\u003c');
        const scriptTag = '<script>window._appConfig=Object.assign({cloudinary:{cloud:\'dxwmts9vw\',preset:\'ehfapp_preset\'}},'
            + safeJson + ');</script>\n    ';

        const html = _indexHtmlCache.raw.slice(0, _indexHtmlCache.injected)
            + scriptTag
            + _indexHtmlCache.raw.slice(_indexHtmlCache.injected);

        // Dynamic per-request response now (was a plain static file before)
        // — no-store so a redeploy's changed env vars are never served
        // stale from an intermediary cache. The app's own JS/CSS keep their
        // existing long-cache + ?v= cache-busting untouched; only this one
        // HTML shell response's caching behavior changes.
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.warn('[Config] Server-side config injection failed (' + (err && err.message) + ') — falling back to normal static serving.');
        next();
    }
}

app.get(['/', '/index.html'], async (req, res, next) => {
    // FIX (marketplace product link showing the generic logo + QR card instead of the product photo): opening a
    // listing's detail page makes app-marketplace-sellers.js rewrite the address bar to
    // "?mktView=listing&mktItem=mkt-<id>" (_mktBuildListingDeepLink) — there is no "?post=" in it. A link copied from
    // that page (browser/PWA copy or share) therefore reached this route with no post id at all, so the crawler got
    // the bare branded fallback card (+ QR) instead of the listing's own thumbnail. "?mktItem=" is now accepted as
    // the listing id when no "?post=" is present, so those links resolve exactly like the "?post=mkt-..." ones.
    // Listing ids are always 'mkt-...' (see _collectionForId), so anything else in mktItem is ignored.
    const _mktItemParam = (typeof req.query.mktItem === 'string' && /^mkt-[A-Za-z0-9_-]+$/.test(req.query.mktItem)) ? req.query.mktItem : '';
    const postId = req.query.post || _mktItemParam || undefined;
    // FEATURE (2026-09-27 — poll share-link preview): app-feed.js's poll
    // share sheet mints links as ?poll=<id>, not ?post=<id> — a separate
    // query param needs its own separate check here, since it never
    // shares an id scheme or a Firestore collection with anything
    // _fetchPostForPreview already knows how to look up.
    const pollId = req.query.poll;
    // FEATURE (2026-09-28 — scholarship share-link preview): ?scholarship=<id>,
    // see _fetchScholarshipForPreview above.
    const scholarshipId = req.query.scholarship;
    // FEATURE (2026-10-23 — celebration share-link preview): ?celebration=<id>, see
    // _fetchCelebrationForPreview above.
    const celebrationId = req.query.celebration;
    const groupInviteId = (typeof req.query.openGroup === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(req.query.openGroup)) ? req.query.openGroup : '';
    // FEATURE (2026-11-06 — disbursement invite link preview): ?invite=<CODE>, see _fetchInviteForPreview above.
    const inviteCode = (typeof req.query.invite === 'string' && /^[A-Za-z0-9]{6,12}$/.test(req.query.invite)) ? req.query.invite : '';
    const shareId = postId || pollId || scholarshipId || celebrationId || groupInviteId || inviteCode;
    const isAdminDebug = !!shareId && req.query.debug === '1' && _isLocalAdmin(req);
    if (!_isCrawler(req) && !isAdminDebug) return _serveIndexWithInjectedConfig(req, res, next);
    // Crawler with no ?post=/?poll= id (e.g. someone shared the bare app
    // link) — still worth a branded card instead of falling through to
    // the JS-only SPA shell a bot can't render, so it isn't gated on either id.

    req._withQr = true; // QR badge on every share-card image built below (see _qrOn)
    const meta = pollId ? await _fetchPollForPreview(String(pollId), req)
        : scholarshipId && !postId ? await _fetchScholarshipForPreview(String(scholarshipId), req)
        : celebrationId && !postId ? await _fetchCelebrationForPreview(String(celebrationId), req)
        : groupInviteId && !postId ? await _fetchGroupForPreview(groupInviteId, req)
        : inviteCode && !postId ? await _fetchInviteForPreview(inviteCode, req)
        : postId ? await _fetchPostForPreview(String(postId), req)
        : null;
    const pageUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    const favicon = _logoUrl(req);

    if (isAdminDebug) {
        // Admin view: render the resolved values directly (title/desc/image/
        // video + a live <img> of the actual generated card) instead of the
        // instant meta-refresh a real crawler gets, and expose a one-click
        // way to force a fresh Cloudinary render if something looks stale.
        res.set('Cache-Control', 'no-store');
        return res.send(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Card preview — ' + _escHtml(shareId) + '</title>' +
            '<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;background:#f4f5f7}' +
            'img{max-width:100%;border-radius:8px;border:1px solid #ddd}code{background:#eee;padding:2px 6px;border-radius:4px}' +
            'dt{font-weight:600;margin-top:14px}dd{margin:2px 0 0}</style></head><body>' +
            '<h2>Card preview: ' + _escHtml(shareId) + '</h2>' +
            (meta
                ? '<img src="' + _escHtml(meta.image) + '" alt="card preview"><dl>' +
                  '<dt>Title</dt><dd>' + _escHtml(meta.title) + '</dd>' +
                  '<dt>Description</dt><dd>' + _escHtml(meta.desc) + '</dd>' +
                  '<dt>Image URL</dt><dd><code>' + _escHtml(meta.image) + '</code></dd>' +
                  (meta.video ? '<dt>Video URL</dt><dd><code>' + _escHtml(meta.video) + '</code></dd>' : '') +
                  '<dt>Has own media</dt><dd>' + (meta.hasOwnImage ? 'yes' : 'no (branded fallback)') + '</dd></dl>' +
                  '<p><a href="' + _escHtml(meta.image) + '" target="_blank" rel="noopener">Force-load image directly (bypasses this page\'s cache)</a></p>'
                : '<p><em>No doc found for this ID, or Firestore Admin isn\'t configured — this is the fallback branded card any real crawler would also get.</em></p>'
            ) +
            '</body></html>'
        );
    }

    // Graceful fallback: post not found / Firestore unreachable / no id at
    // all — still give the crawler SOMETHING coherent rather than a
    // blank/generic card. The image falls back to the purpose-built
    // 1200x630 branded card (not the raw circular logo) so a share link
    // is never image-less AND never looks like a stretched icon.
    //
    // hasOwnImage: real post/reel/news/status media of unknown aspect ratio
    // (dims NOT asserted below). Everything else the image can be — the
    // per-author avatar-placeholder card _fetchPostForPreview already built,
    // or the plain branded fallback below for "no post/no avatar/Firestore
    // down" — is one of OUR OWN exactly-1200x630 canvases, so dims ARE
    // asserted for those.
    const hasOwnImage = !!(meta && meta.hasOwnImage);
    const title = meta ? meta.title : APP_NAME;
    const desc  = meta ? meta.desc  : (scholarshipId && !postId ? 'Open this link to view the scholarship and apply on Empyrean.' : celebrationId && !postId ? 'Open this link to celebrate this milestone on Empyrean.' : 'Join the Empyrean community to view this post.');
    let image = (meta && meta.image) ? meta.image : _fallbackCardUrl(req);
    if (image === _fallbackCardUrl(req)) image = _fallbackCardWithQr(req); // bare branded card -> same card + QR (the "Join Empyrean" card)

    // og:video: only set when there's a real, direct video file to point
    // at (see the `video` field _fetchPostForPreview now returns alongside
    // `image` for reels/videos/status-videos/news-videos). Facebook,
    // Messenger, Discord, Slack and Telegram all read this and will play
    // the clip inline right from the card — no tap-through needed. Twitter/X
    // doesn't honor og:video at all (it needs its own approved Player Card
    // setup, which isn't wired up here), so it — like WhatsApp/iMessage,
    // which never inline-play regardless of tags — still just gets the
    // poster image above, now with the play-button overlay baked in so it's
    // still obviously "tap to watch" rather than a plain photo.
    const video = (meta && meta.video) ? meta.video : '';
    const hasVideo = !!video;

    // Warm Cloudinary's lazily-rendered derivative(s) BEFORE responding to
    // this crawler — see _prewarmUrlAwait's own comment just above its
    // definition for why this is the actual fix for "card thumbnail
    // generated link is failing/blank". Bounded to 6s so a slow or
    // unreachable Cloudinary render never holds up the response
    // indefinitely; worst case this crawler's own fetch just does the cold
    // render itself, same as before this fix.
    await Promise.all([
        _prewarmUrlAwait(image, 6000),
        hasVideo ? _prewarmUrlAwait(video, 6000) : Promise.resolve()
    ]);

    res.set('Cache-Control', 'public, max-age=300'); // crawlers re-fetch periodically; 5 min is plenty fresh
    res.send(
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<title>' + _escHtml(title) + '</title>' +
        // Small round icon WhatsApp/Facebook/Messenger show next to the
        // domain/link line at the bottom of the card (the "small logo
        // adjacent the link" — see the reference screenshot's tiny "f" badge).
        '<link rel="icon" type="image/png" href="' + _escHtml(favicon) + '">' +
        '<meta property="og:site_name" content="' + _escHtml(APP_NAME) + '">' +
        '<meta property="og:title" content="' + _escHtml(title) + '">' +
        '<meta property="og:description" content="' + _escHtml(desc) + '">' +
        '<meta property="og:url" content="' + _escHtml(pageUrl) + '">' +
        '<meta property="og:type" content="' + (hasVideo ? 'video.other' : 'article') + '">' +
        '<meta property="og:image" content="' + _escHtml(image) + '">' +
        // Exact dimensions only asserted for the branded fallback card,
        // whose size we control — a real post's photo/poster frame may be
        // any aspect ratio, so those dims are left for the crawler to detect.
        (hasOwnImage ? '' :
            '<meta property="og:image:width" content="1200">' +
            '<meta property="og:image:height" content="630">'
        ) +
        (hasVideo ?
            '<meta property="og:video" content="' + _escHtml(video) + '">' +
            '<meta property="og:video:secure_url" content="' + _escHtml(video) + '">' +
            '<meta property="og:video:type" content="' + _escHtml(_videoMimeType(video)) + '">'
            : ''
        ) +
        '<meta name="twitter:card" content="summary_large_image">' +
        '<meta name="twitter:title" content="' + _escHtml(title) + '">' +
        '<meta name="twitter:description" content="' + _escHtml(desc) + '">' +
        '<meta name="twitter:image" content="' + _escHtml(image) + '">' +
        // If a human somehow opens this crawler-only page directly (e.g. pastes
        // the raw URL), send them straight into the real app instantly.
        '<meta http-equiv="refresh" content="0;url=' + _escHtml(pageUrl) + '">' +
        '</head><body><p>Redirecting to Empyrean…</p></body></html>'
    );
});


// Serves the QR panel the share-card overlays above pull in (Cloudinary fetches this URL, same as /logo-white.png).
app.get('/qr-join.png', (req, res) => {
    try {
        if (!_qrJoinPng) _qrJoinPng = _buildJoinQrPng();
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        res.send(_qrJoinPng);
    } catch (err) {
        console.warn('[QR] failed to build /qr-join.png:', err.message);
        res.status(500).end();
    }
});

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',
    setHeaders(res, filePath) {
        // No-cache for HTML so config changes take effect immediately
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
        // No-cache for the service worker itself: the browser already re-checks
        // it periodically on its own, but an HTTP-level 1-day cache on top of
        // that would mean a bug fix to service-worker.js's own logic could take
        // up to a day (plus the browser's own delay) to reach anyone who's
        // already installed it — the file needs to always be fetched fresh so
        // the browser's update check actually sees new bytes when they exist.
        if (filePath.endsWith('service-worker.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// Google AdSense verification — served dynamically, no separate file needed
// Must stay above the SPA catch-all below, or that wildcard would intercept
// this path and serve index.html instead of the plain-text ads.txt content.
app.get('/ads.txt', (req, res) => {
    res.type('text/plain');
    res.send('google.com, pub-2997796984554830, DIRECT, f08c47fec0942fa0\n');
});

// FIX (2026-08-04): robots.txt had no dedicated route, same gap /ads.txt's
// own comment above already warned about — without one, ANY crawler
// requesting /robots.txt fell straight through to the SPA catch-all below
// and got back the full index.html page instead of real robots directives.
// A 200 response that isn't valid robots.txt syntax is exactly the kind of
// ambiguous result that makes automated fetchers/crawlers treat a site as
// fully blocked rather than risk over-crawling it — this is explicitly
// permissive (Allow: / for every user-agent) so there's no ambiguity for
// search engines or any other well-behaved crawler. /api/ is excluded
// since those are backend endpoints, not pages meant to be indexed — this
// has no effect on real visitors either way, browsers never read
// robots.txt at all.
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(
        'User-agent: *\n' +
        'Allow: /\n' +
        'Disallow: /api/\n' +
        'Sitemap: https://' + req.get('host') + '/sitemap.xml\n'
    );
});

// Android Trusted Web Activity (Play Store wrapper) verification — Digital
// Asset Links. Must be an EXPLICIT route, not just a file dropped into
// public/.well-known/: express.static's `dotfiles` option defaults to
// "ignore" for any path segment starting with a dot, which .well-known is —
// so a static file here would silently 404 (same class of gap /robots.txt's
// own comment above documents) and, worse, fall through to the SPA
// catch-all below and return index.html instead of JSON. Google's Digital
// Asset Links checker requires a real 200 + application/json array at this
// exact path or the TWA app never gets "verified" (the address bar stays
// visible instead of the app looking native, and Play Store review can
// reject it outright). Must stay above the catch-all, same reason
// /robots.txt and /ads.txt do.
app.get('/.well-known/assetlinks.json', (req, res) => {
    res.type('application/json');
    res.json([
        {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
                namespace: 'android_app',
                package_name: 'com.joinempyrean.empyrean.store',
                sha256_cert_fingerprints: [
                    '9E:3A:19:F5:FA:94:BB:CD:5A:B5:40:44:D9:6F:E5:5B:48:55:A8:DB:9E:C7:17:05:34:9E:BA:6D:F5:01:F4:63',
                    '8D:2E:D8:A6:98:A1:7E:65:F0:59:5A:E9:DE:28:D6:BC:4A:83:35:A0:65:83:3E:B3:59:34:FD:45:3D:11:CC:F3'
                ]
            }
        }
    ]);
});

// FIX (2026-08-04): Privacy Policy and Terms & Conditions already existed
// as real text (see index.html's #settings-privacy / #settings-terms), but
// ONLY inside the in-app Settings panel — reachable solely by logging in
// and clicking through client-side SPA navigation. Google's crawler (and
// AdSense's own review process, which explicitly requires a reachable
// privacy policy before approving an account for ads) never logs in or
// drives a page's JS the way a person would, so as far as either was
// concerned this site had NO privacy policy at all — a common, concrete
// reason AdSense applications get rejected outright. These two routes
// serve the exact same text as real, public, static HTML pages that need
// no auth and no JS to read, reusing the copy already written in
// index.html rather than introducing new legal text. Simple inline CSS
// only (no dependency on style.css/app-*.js) so these render correctly
// even if something else on the page is broken.
function _staticPolicyPage(title, bodyHtml) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>' + title + ' — Empyrean</title>' +
        '<meta name="robots" content="index, follow">' +
        '<style>' +
        'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;' +
        'padding:32px 20px 60px;color:#0A0E27;line-height:1.6;}' +
        'h3{font-size:1.5rem;margin-top:0;} h4{margin-top:28px;} ' +
        'a.back{display:inline-block;margin-bottom:24px;color:#1B2B8B;text-decoration:none;font-weight:600;}' +
        '</style></head><body>' +
        '<a class="back" href="/">← Back to Empyrean</a>' +
        bodyHtml +
        '</body></html>';
}

app.get('/privacy', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(_staticPolicyPage('Privacy Policy',
        '<div><h3>Privacy Policy</h3><p><em>Effective date: 26 August, 2026</em></p>' +
        '<p>Empyrean International ("Empyrean", "we", "our", "us") operates a social platform that includes a news feed, live streaming, reels, direct messaging and group calls, a marketplace and business pages, status/stories, a digital wallet (EMPY token), donor/grant tools, and an SOS/emergency-assistance feature. This Privacy Policy explains what information we collect, how we use it, who we share it with, and the choices you have.</p>' +
        '<p>By creating an account or using Empyrean, you agree to the collection and use of information as described here.</p>' +
        '<h4>1. Information We Collect</h4><p><strong>Provided by you:</strong></p><ul>' +
        '<li><strong>Account information:</strong> full name, username, email address, phone number, and profile photo. Passwords are handled by Firebase Authentication — we never see or store raw passwords.</li>' +
        '<li><strong>Identity verification (KYC):</strong> if you use wallet, payout, or grant-disbursement features, a government-issued ID and related verification information, to comply with financial and anti-fraud regulations.</li>' +
        '<li><strong>Content you post or send:</strong> posts, comments, reels, live-stream video/audio, status updates, direct messages, group chat messages, gifts, and any photos, videos, or files you upload.</li>' +
        '<li><strong>Payment information:</strong> wallet funding, EMPY token purchases, and payments are processed by our licensed payment processor, Flutterwave. Empyrean does not collect or store your full card or bank account number. In-app EMPY token purchases on the Android app will use Google Play Billing, in line with Google Play policy for digital goods.</li>' +
        '<li><strong>SOS/emergency requests:</strong> details you submit, and, if you choose to share it, your location. Contact details on SOS reports are never shown publicly — visible only to authorized admin reviewers.</li>' +
        '</ul><p><strong>Collected automatically:</strong></p><ul>' +
        '<li>Device and usage data (device type, OS, app version, IP address, general usage patterns).</li>' +
        '<li>A push-notification token (Firebase Cloud Messaging), used to deliver notifications you have permitted.</li>' +
        '<li>Approximate location only where a specific feature needs it (e.g. an SOS report you submit); we do not track location in the background.</li></ul>' +
        '<h4>2. How We Use Your Information</h4><ul>' +
        '<li>To create and maintain your account and authenticate you securely.</li>' +
        '<li>To operate core features: feed, live streaming, messaging/calls, marketplace, wallet, reels, status, and SOS reporting.</li>' +
        '<li>To process payments, token purchases, and — for approved NGOs/administrators — grant or donation disbursements.</li>' +
        '<li>To send transactional emails and permitted push notifications.</li>' +
        '<li>To detect and prevent fraud, abuse, and violations of our Terms.</li>' +
        '<li>To respond to SOS/emergency submissions and support requests.</li>' +
        '<li>To comply with legal, tax, and financial-regulatory obligations, including KYC requirements tied to wallet and payout features.</li></ul>' +
        '<p>We do not sell your personal information.</p>' +
        '<h4>3. How Information Is Shared</h4><p>We share information only as needed to operate the service, with service providers including: Google Firebase (authentication, database, storage, push notifications), Agora (live audio/video), Cloudinary (media hosting), Flutterwave (payment processing), SendGrid (transactional email), and Render (server hosting) — each contractually restricted to using your data solely to provide their service to us. We may also disclose information to comply with a legal obligation, to protect rights, property, or safety, or with your consent.</p>' +
        '<h4>4. Advertising</h4><p>We use Google AdSense to display ads on our platform. Google and its partners may use cookies and similar technologies (including the advertising ID on Android) to serve ads based on your visits to this and other sites, and to measure ad performance. This does not include your Empyrean account content, messages, or wallet activity. You can review or adjust your ad personalization settings at <a href="https://adssettings.google.com" target="_blank" rel="noopener">adssettings.google.com</a>, and see Google\u2019s own practices at <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">policies.google.com/technologies/partner-sites</a>.</p>' +
        '<h4>5. Data Retention</h4><p>We retain your information for as long as your account is active or as needed to provide the service. If you delete your account, we delete or anonymize your personal data within a reasonable period, except where required to retain records (e.g. financial transactions) for legal purposes.</p>' +
        '<h4>6. Your Rights</h4><ul>' +
        '<li>Access and update most profile information directly in Settings.</li>' +
        '<li>Request deletion of your account and associated data directly from Settings &gt; Delete Account in the app, or by contacting us below. Deletion requests are processed within 30 days, except for records we are legally required to retain (e.g. financial transaction records).</li>' +
        '<li>Disable push notifications at any time in your device settings.</li>' +
        '<li>Decline to share location, though this may limit certain features.</li></ul>' +
        '<h4>7. Data Security</h4><p>We use encrypted connections (HTTPS/TLS), Firebase Authentication, and access-restricted admin tooling to protect your information. No system is 100% secure.</p>' +
        '<h4>8. Children\u2019s Privacy</h4><p>Empyrean is not directed at children under 13 (or the minimum age required in your country) and we do not knowingly collect their personal information.</p>' +
        '<h4>9. Changes to This Policy</h4><p>We may update this policy from time to time. Material changes will be noted here and, where appropriate, within the app.</p>' +
        '<h4>10. Contact Us</h4><p>Questions or data requests: <a href="mailto:support@joinempyrean.com">support@joinempyrean.com</a></p></div>'
    ));
});

app.get('/terms', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(_staticPolicyPage('Terms & Conditions',
        '<div><h3>Terms &amp; Conditions</h3><p>The rules that govern your use of Empyrean.</p>' +
        '<h4>2.1 Acceptance of Terms</h4><p>By using our services, you agree to these Terms & Conditions. If you do not agree, please discontinue use immediately.</p>' +
        '<h4>2.2 Services Provided</h4><p>Empyrean offers:</p><ul>' +
        '<li>Humanitarian aid facilitation, including SOS/crisis reporting and NGO partnerships.</li>' +
        '<li>EMPY, an in-app rewards system earned through platform activity such as likes and shares, redeemable for in-app benefits.</li>' +
        '<li>Marketplace for goods and services, with Escrow-protected and Direct Trade options.</li>' +
        '<li>Live-stream gifting and social engagement, including Reels, Groups, and Broadcast Channels.</li>' +
        '<li>Direct and group messaging.</li>' +
        '<li>Business Pages for verified organizations and vendors.</li>' +
        '<li>A digital wallet for in-app purchases and NGO/grant transactions.</li></ul>' +
        '<h4>2.3 User Obligations</h4><p>You agree to:</p><ol>' +
        '<li>Provide accurate and truthful information.</li>' +
        '<li>Use the platform lawfully and ethically.</li>' +
        '<li>Respect community guidelines, avoiding hate speech, fraud, or exploitation.</li>' +
        '<li>Not use EMPY or the wallet for illegal or unapproved financial activities.</li></ol>' +
        '<h4>2.4 Limitation of Liability</h4><p>Empyrean will not be liable for:</p><ul>' +
        '<li>Third-party fraud or hacking incidents outside our control.</li>' +
        '<li>Service interruptions caused by external factors.</li></ul>' +
        '<h3>3. Disclaimer</h3>' +
        '<p><strong>No Financial Advice:</strong> Content and tools provided by Empyrean are for informational and humanitarian purposes only, not as investment advice.</p>' +
        '<p><strong>Third-Party Services:</strong> We are not responsible for the content, policies, or operations of external websites or partners linked from our platform.</p>' +
        '<h3>4. Governing Law</h3><p>This agreement is governed by the laws of the Federal Republic of Nigeria, without regard to its conflict of law principles.</p></div>'
    ));
});

// Google Play "Child Safety Standards" declaration requires a publicly
// published, non-editable page describing our standards against child
// sexual abuse and exploitation (CSAE) — see Play Console > App content >
// Child safety standards. This is that page. Same pattern as /privacy and
// /terms above (static HTML, no auth, cached an hour, never a PDF).
app.get('/child-safety', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(_staticPolicyPage('Child Safety Standards',
        '<div><h3>Child Safety Standards</h3><p><em>Effective date: 3 September, 2026</em></p>' +
        '<p>Empyrean International ("Empyrean", "we", "our", "us") is committed to protecting children and preventing child sexual abuse and exploitation (CSAE) on our platform, in line with the Google Play Child Safety Standards policy.</p>' +
        '<h4>1. Zero-Tolerance Policy</h4><p>Empyrean strictly prohibits any content, behavior, or activity that sexualizes, exploits, or endangers minors on or through our platform. This includes, without limitation: child sexual abuse material (CSAM) in any form; grooming or solicitation of a minor; sextortion; and any content that sexualizes children, whether real, drawn, or computer-generated. Accounts found violating this policy are immediately suspended, their content removed, and the matter is reported to the appropriate authorities.</p>' +
        '<h4>2. In-App Reporting</h4><p>Every reel, post, listing, business page, and conversation can be reported directly from its own menu using the "Report" option, and includes a specific reason for child sexual abuse or exploitation. Reports are reviewed by our moderation team, and confirmed violations are escalated immediately. You can also reach our Safety & Security team directly — see Contact below — and can read step-by-step reporting guidance in the app under <strong>Settings → Help Center → Safety &amp; Security</strong>.</p>' +
        '<h4>3. Legal Compliance &amp; Reporting to Authorities</h4><p>Empyrean complies with all applicable child safety laws and cooperates with law enforcement and relevant regulatory authorities. Where required by law, confirmed CSAM is reported to the National Center for Missing &amp; Exploited Children (NCMEC) at <a href="https://report.cybertip.org" target="_blank" rel="noopener">report.cybertip.org</a> and/or other appropriate national authorities.</p>' +
        '<h4>4. Point of Contact</h4><p>Our designated point of contact for CSAM prevention practices and compliance is reachable at <a href="mailto:support@joinempyrean.com">support@joinempyrean.com</a>.</p>' +
        '<h4>5. Related Policies</h4><p>See also our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms &amp; Conditions</a>.</p></div>'
    ));
});

// Minimal sitemap so search engines discover the handful of pages that
// exist OUTSIDE the login-gated SPA shell. The app itself (posts, reels,
// profiles, etc.) is intentionally not enumerated here — that content is
// per-user/dynamic and already has its own crawler-friendly share-card
// route elsewhere in this file; a sitemap is for the small set of stable,
// public marketing/legal pages.
app.get('/sitemap.xml', (req, res) => {
    const base = 'https://' + req.get('host');
    res.type('application/xml');
    res.send(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        '<url><loc>' + base + '/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>' +
        '<url><loc>' + base + '/privacy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>' +
        '<url><loc>' + base + '/terms</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>' +
        '<url><loc>' + base + '/child-safety</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>' +
        '</urlset>'
    );
});

// SPA fallback — all unknown routes serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── FREE-TIER KEEP-ALIVE ──────────────────────────────────────────────────
// FIX (root cause of "push notifications work once, then stop for good" on
// Render's Free plan): Free-tier services spin down after ~15 minutes with
// no INCOMING HTTP request. A new Firestore doc being created does NOT
// count as traffic to this server — Firestore talks to Google's servers,
// not to this dyno — so the exact moment a user creates a post is exactly
// the moment this process is most likely to be asleep, with the
// _watchCollection/_watchStatuses listeners above not running at all (a
// sleeping dyno doesn't run JS, so reconnect logic can't save it either —
// this needs a different fix than the listener-reconnect one above).
//
// The standard, no-cost workaround: have the server hit its OWN public URL
// on an interval shorter than the spin-down window, so Render always sees
// recent inbound traffic and never considers this dyno idle in the first
// place. This does NOT wake an already-sleeping dyno (a sleeping process
// runs no code, so it can't fire its own timer) — it only works by making
// sure the dyno never falls asleep to begin with, which is sufficient as
// long as the interval below stays comfortably under 15 minutes and this
// process itself never crashes/redeploys and sits dead for a stretch first.
// If it DOES go to sleep before this ships (or after a deploy), the very
// next real visitor's page load is what wakes it back up, same as today.
//
// Pings /api/config specifically — it's the same lightweight route
// render.yaml already uses as healthCheckPath, does no Firestore read, and
// req.protocol/host don't matter here since RENDER_EXTERNAL_URL already IS
// this service's full public https URL.
//
// Deliberately does nothing outside Render (no RENDER_EXTERNAL_URL means
// local dev, or a host that doesn't need this trick) — so this is a no-op
// everywhere except where it's actually needed.
function _startFreeTierKeepAlive() {
    const base = process.env.RENDER_EXTERNAL_URL;
    if (!base) return; // not running on Render — nothing to keep alive
    const pingUrl = base.replace(/\/$/, '') + '/api/config';
    const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 min — comfortably under Free tier's ~15 min idle window

    function ping() {
        try {
            https.get(pingUrl, { timeout: 20000 }, (res) => {
                res.resume(); // drain and discard — we only need Render to see the request
            }).on('error', (err) => {
                console.warn('[KeepAlive] self-ping failed (non-fatal):', err.message);
            });
        } catch (err) {
            console.warn('[KeepAlive] self-ping threw (non-fatal):', err.message);
        }
    }
    setInterval(ping, PING_INTERVAL_MS);
    console.log('[KeepAlive] Self-pinging', pingUrl, 'every', PING_INTERVAL_MS / 60000, 'min to prevent free-tier spin-down.');
}

// =============================================================================
// FACEBOOK PAGE SYNC (2026-10-04) — Empyrean <-> official Facebook Page
// =============================================================================
// OUTBOUND (app -> Facebook): ADMIN-authored content only. The same Admin-SDK
//   Firestore listeners this file already uses for push notifications watch
//   posts / reels / marketplace_listings / sos_queue / crisis_reports /
//   news_posts. A new doc whose author is an admin account is published to the
//   Page (photo / multi-photo / video / text+link card). Quotes, memes, profile
//   posts and the "I Support" election cards all live in `posts`, so they are
//   covered by that one listener. Nothing a normal member posts is ever sent.
// INBOUND (Facebook -> app): the Page feed is polled; each new Page post is
//   re-hosted into Firebase Storage (Facebook CDN links expire) and written to
//   `posts` as the admin account (source:'facebook'), so it shows in the public
//   general feed like any other post.
// LOOP GUARD: `fb_sync_map/*` ledger docs (server-only, see firebase-rules.js)
//   remember every doc already sent out and every Facebook post already
//   imported; imported docs carry source:'facebook' and are never re-sent, and
//   outbound Page posts contain an app link so the importer skips them.
// CONFIG (all optional except the token):
//   FB_PAGE_TOKEN                   Page access token. If unset, it is read from
//                                   Google Secret Manager (secret FB_PAGE_TOKEN).
//   FB_PAGE_ID                      default 1277689802105508
//   FB_SECRET_PROJECT               project id or number holding that secret
//   FB_SYNC_ADMIN_EMAILS            comma list; default = the two admin emails
//   FB_SYNC_ADMIN_UIDS              extra admin uids (comma list)
//   FB_SYNC_INCLUDE_ISADMIN=1       also treat users/{uid}.isAdmin==true as admin
//   FB_SYNC_POST_AS_UID             account imported Page posts appear under
//   FB_SYNC_ENABLED=0               kill switch      FB_GRAPH_VERSION (v26.0)
//   FB_PULL_INTERVAL_MIN (3)  FB_SYNC_MAX_AGE_MIN (30)  FB_IMPORT_BACKFILL_DAYS (0)
// SOS + STATUS (added 2026-10-04):
//   OUT  SOS     an approved SOS (posts doc, isSOS:true) already goes to the Page - unchanged.
//   OUT  STATUS  any member's new status item (audience 'everyone' only; voice notes and
//                the 2nd+ segment of a split video are skipped) is queued as 'awaiting' and
//                goes to the Page only when an admin approves it in Admin -> Facebook.
//                Admin-authored statuses follow the Automatic / Ask-me-first switch.
//   IN   SOS     a Page post containing #SOS is written to sos_queue as 'pending_approval'
//                (the normal admin SOS review); it is never published without that approval.
//   IN   STATUS  a Page post containing #status is added as a status item on the admin account.
const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v26.0';
const FB_PAGE_ID       = process.env.FB_PAGE_ID || '1277689802105508';
const FB_SECRET_PROJECT = process.env.FB_SECRET_PROJECT || '343934674682';
const FB_ADMIN_EMAILS  = (process.env.FB_SYNC_ADMIN_EMAILS || 'chiefadmin@empyreanhumanitarianfoundation.com,admin@empyrean.com')
    .split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
const FB_SYNC_SOURCES = [
    { col: 'posts',                author: 'userId'   },
    { col: 'reels',                author: 'userId'   },
    { col: 'marketplace_listings', author: 'sellerId' },
    // sos_queue is deliberately NOT watched: an SOS goes to Facebook only after admin approval,
    // which is when it is written to `posts` with isSOS:true (see _fbIsApprovedSos).
    { col: 'crisis_reports',       author: 'userId'   },
    { col: 'news_posts',           author: 'userId'   },
    // statuses: ONE doc per user whose `items` array grows, so it has its own item-level watcher
    // (_fbWatchStatuses) instead of the generic "doc added" one. Listed here so the retry sweep and
    // the admin approve/retry route can resolve it.
    { col: 'statuses',             author: 'userId', custom: true }
];
const FB_LEDGER = 'fb_sync_map';
// const fbStats = { lastPullAt: null, lastPullImported: 0, sent: 0, failed: 0, imported: 0, lastError: null };   // superseded 2026-10-04: + lastSkip, queued
const fbStats = { lastPullAt: null, lastPullImported: 0, sent: 0, failed: 0, imported: 0, lastError: null, lastSkip: null, queued: 0 };

// Admin-controlled switches (Admin Panel -> Facebook tab). Stored in fb_sync_map/_settings.
//   mode: 'auto' (post straight away) | 'approve' (queue for admin OK) | 'off'
//   inbound: import Facebook Page posts into the app feed (true/false)
let _fbSettingsCache = { v: null, t: 0 };
async function _fbSettings(admin, fresh) {
    if (!fresh && _fbSettingsCache.v && Date.now() - _fbSettingsCache.t < 10000) return _fbSettingsCache.v;
    const v = { mode: 'auto', inbound: true, inboundSince: 0 };
    try {
        const sn = await admin.firestore().collection(FB_LEDGER).doc('_settings').get();
        if (sn.exists) {
            const d = sn.data() || {};
            if (['auto', 'approve', 'off'].indexOf(d.mode) !== -1) v.mode = d.mode;
            if (d.inbound === false) v.inbound = false;
            v.inboundSince = Number(d.inboundSince) || 0;
        }
    } catch (e) { /* defaults */ }
    _fbSettingsCache = { v: v, t: Date.now() };
    return v;
}
function _fbThumbOf(item) {
    const im = item.media.find(function (m) { return !m.video; });
    return (im && im.url) || item.poster || '';
}

let _fbTokenCache = { v: null, t: 0 };
let _fbWarnedNoToken = 0;
async function _fbGetPageToken() {
    if (process.env.FB_PAGE_TOKEN) return process.env.FB_PAGE_TOKEN.trim();
    if (_fbTokenCache.v && Date.now() - _fbTokenCache.t < 3600000) return _fbTokenCache.v;
    const admin = _getAdmin();
    if (!admin) return null;
    try {
        const cred = admin.app().options.credential;
        const at = await cred.getAccessToken();
        const url = 'https://secretmanager.googleapis.com/v1/projects/' + encodeURIComponent(FB_SECRET_PROJECT) +
            '/secrets/FB_PAGE_TOKEN/versions/latest:access';
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + at.access_token } });
        const j = await r.json().catch(function () { return {}; });
        if (!r.ok || !j.payload || !j.payload.data) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        _fbTokenCache = { v: Buffer.from(j.payload.data, 'base64').toString('utf8').trim(), t: Date.now() };
        return _fbTokenCache.v;
    } catch (err) {
        if (Date.now() - _fbWarnedNoToken > 600000) {
            _fbWarnedNoToken = Date.now();
            console.warn('[FBSync] No Page token available (set FB_PAGE_TOKEN on Render, or give the service account "Secret Manager Secret Accessor" on secret FB_PAGE_TOKEN):', err.message);
        }
        return null;
    }
}

async function _fbGraph(method, path, params, token) {
    const p = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null) p.append(k, String(params[k])); });
    p.append('access_token', token);
    const base = 'https://graph.facebook.com/' + FB_GRAPH_VERSION + path;
    // const res = method === 'GET' ? await fetch(base + '?' + p.toString()) : await fetch(base, { method: 'POST', body: p });   // superseded 2026-10-04: a bare "fetch failed" gave no clue and one dropped connection failed the whole send
    let res = null, netErr = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try {
            res = method === 'GET' ? await fetch(base + '?' + p.toString()) : await fetch(base, { method: 'POST', body: p });
        } catch (e) {
            netErr = e;
            if (attempt < 2) await new Promise(function (r) { setTimeout(r, 1500 * (attempt + 1)); });
        }
    }
    if (!res) {
        const why = netErr && netErr.cause ? (netErr.cause.code || netErr.cause.message || '') : '';
        throw new Error('Could not reach Facebook (' + ((netErr && netErr.message) || 'network error') + (why ? ': ' + why : '') + ')');
    }
    const j = await res.json().catch(function () { return {}; });
    if (!res.ok || j.error) throw new Error((j.error && j.error.message) || ('Graph HTTP ' + res.status));
    return j;
}

let _fbAdminCache = { ids: new Set(), primary: null, t: 0 };
async function _fbAdminIds(admin) {
    if (_fbAdminCache.ids.size && Date.now() - _fbAdminCache.t < 300000) return _fbAdminCache;
    const db = admin.firestore(), ids = new Set(); let primary = process.env.FB_SYNC_POST_AS_UID || null;
    for (let i = 0; i < FB_ADMIN_EMAILS.length; i++) {
        try {
            const s = await db.collection('users').where('email', '==', FB_ADMIN_EMAILS[i]).limit(3).get();
            s.forEach(function (d) { ids.add(d.id); if (!primary) primary = d.id; });
        } catch (e) { /* keep going */ }
    }
    (process.env.FB_SYNC_ADMIN_UIDS || '').split(',').forEach(function (u) { u = u.trim(); if (u) { ids.add(u); if (!primary) primary = u; } });
    // if (process.env.FB_SYNC_INCLUDE_ISADMIN === '1') {   // superseded 2026-10-04: an admin whose users/{uid}.email differs from the two listed emails was never recognised, so their posts never reached the approval list
    if (process.env.FB_SYNC_INCLUDE_ISADMIN !== '0') {
        try { (await db.collection('users').where('isAdmin', '==', true).get()).forEach(function (d) { ids.add(d.id); }); } catch (e) {}
    }
    _fbAdminCache = { ids: ids, primary: primary, t: Date.now() };
    return _fbAdminCache;
}

// An SOS the admin has approved: app-sos.js writes it to `posts` with isSOS:true / status:'approved'.
// Its author is the SUBMITTER, so it is exempt from the admin-author check; the admin's approval is the permission.
function _fbIsApprovedSos(col, d) { return col === 'posts' && d.isSOS === true && d.status === 'approved'; }

function _fbMs(v) {
    try { if (v && typeof v.toMillis === 'function') return v.toMillis(); if (v) return new Date(v).getTime() || 0; } catch (e) {}
    return 0;
}
function _fbMedia(arr) {
    const out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (m) {
        const u = typeof m === 'string' ? m : (m && (m.url || m._cloudUrl)) || '';
        if (!/^https?:\/\//i.test(u)) return;
        out.push({ url: u, video: !!_looksLikeVideo(m, u) });
    });
    return out;
}

// Turns one Firestore doc into { message, link, media[], poster } — or null if
// there is nothing worth posting. Seller contact details are never included.
function _fbBuildItem(col, id, d) {
    const domain = _appDomain();
    const link = domain ? domain + '/?post=' + encodeURIComponent(id) : '';
    const clean = function (s, n) { return String(s || '').replace(/\r/g, '').trim().slice(0, n); };
    let head = '', body = '', media = [], poster = '';
    if (col === 'posts' && d.isSOS === true) {
        // Public SOS card: story, place and amount only. No name, no contact details.
        head = '\uD83C\uDD98 SOS \u2014 ' + clean(d.title, 120);
        body = [clean(d.story, 2000), d.location ? '\uD83D\uDCCD ' + clean(d.location, 120) : '',
            d.amount ? '\uD83D\uDCB0 Needed: ' + (d.currency || '') + ' ' + d.amount : ''].filter(Boolean).join('\n');
        media = _fbMedia(d.media);
    } else if (col === 'posts') {
        body = clean(d.text, 4000); media = _fbMedia(d.media);
        if (d.isElectionSupportPost && !media.length && d.logoUrl) media = _fbMedia([d.logoUrl]);
    } else if (col === 'reels') {
        body = clean(d.caption, 2000);
        const u = d.videoUrl || d.url;
        if (u) media = [{ url: u, video: true }];
        poster = d.poster || d.thumbnailUrl || '';
    } else if (col === 'marketplace_listings') {
        head = '🛍️ ' + clean(d.name, 150) + (d.price != null && d.price !== '' ? ' — ' + (d.currency || '') + ' ' + d.price : '');
        body = [d.location ? '📍 ' + clean(d.location, 120) : '', clean(d.description, 1500)].filter(Boolean).join('\n');
        media = _fbMedia(d.media);
    } else if (col === 'sos_queue') {
        head = '🆘 SOS — ' + clean(d.title || d.category, 120);
        body = [clean(d.story, 2000), d.location ? '📍 ' + clean(d.location, 120) : '',
            d.amount ? '💰 Needed: ' + (d.currency || '') + ' ' + d.amount : ''].filter(Boolean).join('\n');
        media = _fbMedia(d.media);
    } else if (col === 'crisis_reports') {
        head = '⚠️ Crisis report' + (d.type ? ' — ' + clean(d.type, 80) : '');
        body = [clean(d.description, 2000), d.location ? '📍 ' + clean(d.location, 120) : ''].filter(Boolean).join('\n');
        media = _fbMedia(d.media);
    } else if (col === 'news_posts') {
        head = '📰 ' + clean(d.title, 200); body = clean(d.content, 3000);
        if (d.mediaUrl) media = _fbMedia([{ url: d.mediaUrl, type: d.mediaType || '' }]);
    } else if (col === 'statuses') {
        // d = { userId, name, item } (see _fbLoadSourceData). Caption + media only: no name, no contact details.
        const it = d.item || {}, ty = String(it.type || '').toLowerCase();
        body = clean(it.content, 2000);
        if ((ty === 'image' || ty === 'video') && /^https?:\/\//i.test(String(it.url || ''))) media = [{ url: it.url, video: ty === 'video' }];
    }
    const text = [head, body].filter(Boolean).join('\n\n');
    if (!text && !media.length) return null;
    return { message: text, link: link, media: media, poster: poster };
}

async function _fbSetVideoThumb(token, videoId, posterUrl) {
    const r = await fetch(posterUrl);
    if (!r.ok) throw new Error('poster ' + r.status);
    const buf = await r.arrayBuffer();
    const fd = new FormData();
    fd.append('access_token', token);
    fd.append('is_preferred', 'true');
    fd.append('source', new Blob([buf], { type: r.headers.get('content-type') || 'image/jpeg' }), 'thumb.jpg');
    const out = await fetch('https://graph.facebook.com/' + FB_GRAPH_VERSION + '/' + videoId + '/thumbnails', { method: 'POST', body: fd });
    if (!out.ok) throw new Error('thumb HTTP ' + out.status);
}

async function _fbPublish(token, item) {
    const page = FB_PAGE_ID;
    // const full = item.message + (item.link ? (item.message ? '\n\n' : '') + '🔗 ' + item.link : '');   // superseded 2026-10-04: plain "🔗 link" -> labelled, tappable Empyrean banner line
    // const full = item.message + (item.link ? (item.message ? '\n\n' : '') + '📲 Open this on the Empyrean app ▶ ' + item.link : '');   // superseded 2026-10-04 (b): raw link sat bare under the text; now a branded footer
    const _foot = '━━━━━━━━━━━━━━\n📲 Posted from the Empyrean App' + (item.link ? '\n👉 View the full post: ' + item.link : '');
    const full = item.message + (item.message ? '\n\n' : '') + _foot;
    const vids = item.media.filter(function (m) { return m.video; });
    const imgs = item.media.filter(function (m) { return !m.video; });
    if (vids.length) {
        const r = await _fbGraph('POST', '/' + page + '/videos', { file_url: vids[0].url, description: full }, token);
        // FB builds its own thumbnail from the video; if the app has a poster, ask FB to prefer it (video must finish processing first).
        if (item.poster && /^https?:/i.test(item.poster)) {
            setTimeout(function () { _fbSetVideoThumb(token, r.id, item.poster).catch(function (e) { console.warn('[FBSync] custom thumbnail skipped:', e.message); }); }, 90000);
        }
        return { fbPostId: r.post_id || r.id };
    }
    if (imgs.length === 1) {
        const r = await _fbGraph('POST', '/' + page + '/photos', { url: imgs[0].url, caption: full, published: 'true' }, token);
        return { fbPostId: r.post_id || r.id };
    }
    if (imgs.length > 1) {
        const ids = [];
        for (let i = 0; i < Math.min(imgs.length, 10); i++) {
            const r = await _fbGraph('POST', '/' + page + '/photos', { url: imgs[i].url, published: 'false' }, token);
            ids.push(r.id);
        }
        const params = { message: full };
        ids.forEach(function (pid, i) { params['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: pid }); });
        const r = await _fbGraph('POST', '/' + page + '/feed', params, token);
        return { fbPostId: r.id };
    }
    // Text only: pass the app link as a link attachment so Facebook draws the OG thumbnail card.
    // const params = { message: item.message || full };   // superseded 2026-10-04 (b): text-only posts keep the link OUT of the text (Facebook draws the preview card from `link`) but gain the branded line
    const params = { message: (item.message ? item.message + '\n\n' : '') + '📲 Posted from the Empyrean App' };
    if (item.link) params.link = item.link;
    const r = await _fbGraph('POST', '/' + page + '/feed', params, token);
    return { fbPostId: r.id };
}

// Shared by the live listener, the retry sweep and the manual push route.
async function _fbPublishDoc(admin, src, id, d, ledgerRef, attempts) {
    const token = await _fbGetPageToken();
    if (!token) { await ledgerRef.set({ status: 'failed', error: 'no page token', attempts: attempts + 1 }, { merge: true }); fbStats.failed++; return { ok: false, error: 'no page token' }; }
    const item = _fbBuildItem(src.col, id, d);
    if (!item) { await ledgerRef.set({ status: 'skipped', error: 'nothing to post' }, { merge: true }); return { ok: false, error: 'nothing to post' }; }
    try {
        const res = await _fbPublish(token, item);
        await ledgerRef.set({ status: 'done', fbPostId: res.fbPostId, publishedAt: new Date().toISOString(), attempts: attempts + 1, error: null, col: src.col, docId: id, preview: String(item.message || '').slice(0, 200), thumb: _fbThumbOf(item) }, { merge: true });
        if (src.col !== 'statuses') admin.firestore().collection(src.col).doc(id).set({ fbPostId: res.fbPostId }, { merge: true }).catch(function () {});
        fbStats.sent++;
        // Photo/video posts cannot carry a link-preview card, but a Page comment can: post the app link as the
        // first comment so Facebook draws the Empyrean preview card under the post. Best effort only.
        try {
            const _it = _fbBuildItem(src.col, id, d);
            if (_it && _it.link && _it.media.length) {
                _fbGetPageToken().then(function (tk) {
                    if (tk) _fbGraph('POST', '/' + res.fbPostId + '/comments', { message: '📲 Posted from the Empyrean App — view it here: ' + _it.link }, tk)
                        .catch(function (ce) { console.warn('[FBSync] preview-link comment skipped:', ce.message); });
                });
            }
        } catch (_ce) { /* cosmetic */ }
        console.log('[FBSync] ' + src.col + '/' + id + ' -> Facebook ' + res.fbPostId);
        return { ok: true, fbPostId: res.fbPostId };
    } catch (err) {
        fbStats.failed++; fbStats.lastError = err.message;
        await ledgerRef.set({ status: 'failed', error: String(err.message).slice(0, 300), attempts: attempts + 1, failedAt: new Date().toISOString() }, { merge: true }).catch(function () {});
        console.warn('[FBSync] publish failed for ' + src.col + '/' + id + ':', err.message);
        return { ok: false, error: err.message };
    }
}

async function _fbHandleDoc(admin, src, id, d) {
    if (d.source === 'facebook' || d.fbPostId) return;
    if (src.col === 'posts' && /^sos-fb-/.test(String(id))) return;   // approved SOS that originated on Facebook
    if (src.col === 'posts' && (d.isRetweet || d.isDeleted || d.hidden)) return;
    const maxAge = (Number(process.env.FB_SYNC_MAX_AGE_MIN) || 30) * 60000;
    const created = _fbMs(d.createdAt);
    if (!created || Date.now() - created > maxAge) return;           // never back-fill history on a restart/reconnect
    const ad = await _fbAdminIds(admin);
    const _sos = _fbIsApprovedSos(src.col, d);
    // if (!_sos && !ad.ids.has(String(d[src.author] || ''))) return;   // superseded 2026-10-04: same rule, but now records WHY a post was skipped (shown in Admin -> Facebook)
    if (!_sos && !ad.ids.has(String(d[src.author] || ''))) {
        fbStats.lastSkip = src.col + '/' + id + ': author "' + String(d[src.author] || '(none)') + '" is not one of the ' + ad.ids.size + ' admin account(s)';
        console.log('[FBSync] skipped ' + fbStats.lastSkip);
        return;                                                       // ADMIN accounts only (approved SOS is the one exception)
    }
    const cfg = await _fbSettings(admin);
    if (cfg.mode === 'off') return;                                   // admin switched outbound sync off
    const ledgerRef = admin.firestore().collection(FB_LEDGER).doc('out__' + src.col + '__' + id);
    try { await ledgerRef.create({ col: src.col, docId: id, status: 'pending', createdAt: new Date().toISOString() }); }
    catch (e) { return; }                                             // already claimed -> never post twice
    if (cfg.mode === 'approve' && !_sos) {                            // wait for the admin's OK in the Facebook tab
        const item = _fbBuildItem(src.col, id, d);
        if (!item) { await ledgerRef.set({ status: 'skipped', error: 'nothing to post' }, { merge: true }); return; }
        await ledgerRef.set({ status: 'awaiting', preview: String(item.message || '').slice(0, 200), thumb: _fbThumbOf(item), kind: item.media.some(function (m) { return m.video; }) ? 'video' : (item.media.length ? 'photo' : 'text') }, { merge: true });
        fbStats.queued++;
        return;
    }
    await _fbPublishDoc(admin, src, id, d, ledgerRef, 0);
}

// Loads the data _fbBuildItem needs. For `statuses` the Firestore doc holds many items, so the ledger
// entry carries `itemId` and this returns { userId, name, audience, item } for that one item (or null).
async function _fbLoadSourceData(admin, col, docId, itemId) {
    const s = await admin.firestore().collection(col).doc(docId).get();
    if (!s.exists) return null;
    const d = s.data() || {};
    if (col !== 'statuses') return d;
    const it = (Array.isArray(d.items) ? d.items : []).find(function (x) { return x && x.id === itemId; });
    return it ? { userId: d.userId, name: d.name, audience: d.audience, item: it } : null;
}

// One NEW status item. Members' statuses are NEVER sent without an admin's OK (always 'awaiting').
async function _fbHandleStatusItem(admin, docId, doc, it) {
    if (!it || !it.id || it.source === 'facebook' || it.fbPostId || it.repostOf) return;   // imported / already sent / someone else's content
    if (doc.audience && doc.audience !== 'everyone') return;                                // limited-audience statuses never leave the app
    const ty = String(it.type || '').toLowerCase();
    if (ty === 'voice') return;                                                              // nothing Facebook can show
    if (ty === 'video' && Number(it.startOffset) > 0) return;                                // 2nd+ segment of a split video = same file
    if (ty !== 'image' && ty !== 'video' && !String(it.content || '').trim()) return;
    const maxAge = (Number(process.env.FB_SYNC_MAX_AGE_MIN) || 30) * 60000;
    const created = _fbMs(it.createdAt);
    if (!created || Date.now() - created > maxAge) return;
    const cfg = await _fbSettings(admin);
    if (cfg.mode === 'off') return;
    const ad = await _fbAdminIds(admin);
    const isAdminAuthor = ad.ids.has(String(doc.userId || ''));
    const src = FB_SYNC_SOURCES.find(function (s) { return s.col === 'statuses'; });
    const data = { userId: doc.userId, name: doc.name, audience: doc.audience, item: it };
    const ledgerRef = admin.firestore().collection(FB_LEDGER).doc('out__statuses__' + it.id);
    try { await ledgerRef.create({ col: 'statuses', docId: docId, itemId: it.id, status: 'pending', createdAt: new Date().toISOString() }); }
    catch (e) { return; }                                                                    // already claimed -> never post twice
    const item = _fbBuildItem('statuses', docId, data);
    if (!item) { await ledgerRef.set({ status: 'skipped', error: 'nothing to post' }, { merge: true }); return; }
    if (!isAdminAuthor || cfg.mode === 'approve') {
        await ledgerRef.set({ status: 'awaiting', preview: String(item.message || '').slice(0, 200), thumb: _fbThumbOf(item), kind: item.media.some(function (m) { return m.video; }) ? 'video' : (item.media.length ? 'photo' : 'text') }, { merge: true });
        return;
    }
    await _fbPublishDoc(admin, src, docId, data, ledgerRef, 0);
}

// Same shape as the push-notification watcher (_watchStatuses) but diffed by item id, so it survives
// reconnects. The first snapshot only records what already exists - nothing old is ever back-filled.
function _fbWatchStatuses(admin) {
    const seen = new Map();            // docId -> Set(item ids already known)
    let first = true;
    function attach() {
        admin.firestore().collection('statuses').onSnapshot(function (snap) {
            snap.docChanges().forEach(function (ch) {
                if (ch.type === 'removed') { seen.delete(ch.doc.id); return; }
                const d = ch.doc.data() || {};
                const items = Array.isArray(d.items) ? d.items : [];
                const known = seen.get(ch.doc.id) || new Set();
                const fresh = items.filter(function (x) { return x && x.id && !known.has(x.id); });
                items.forEach(function (x) { if (x && x.id) known.add(x.id); });
                seen.set(ch.doc.id, known);
                if (first) return;
                fresh.forEach(function (x) { _fbHandleStatusItem(admin, ch.doc.id, d, x).catch(function (e) { console.warn('[FBSync] status handler error', e.message); }); });
            });
            first = false;
        }, function (err) {
            console.warn('[FBSync] listener error on statuses:', err.message, '— reconnecting in 5s');
            setTimeout(attach, 5000);
        });
    }
    attach();
}

function _fbWatchSource(admin, src) {
    let first = true;
    function attach() {
        admin.firestore().collection(src.col).orderBy('createdAt', 'desc').limit(20).onSnapshot(function (snap) {
            if (first) { first = false; return; }                     // docs that existed at boot are not "new"
            snap.docChanges().forEach(function (ch) {
                if (ch.type !== 'added') return;
                _fbHandleDoc(admin, src, ch.doc.id, ch.doc.data() || {}).catch(function (e) { console.warn('[FBSync] handler error', src.col, e.message); });
            });
        }, function (err) {
            console.warn('[FBSync] listener error on ' + src.col + ':', err.message, '— reconnecting in 5s');
            setTimeout(attach, 5000);
        });
    }
    attach();
}

async function _fbRetrySweep(admin) {
    try {
        const snap = await admin.firestore().collection(FB_LEDGER).where('status', '==', 'failed').limit(10).get();
        for (const doc of snap.docs) {
            const l = doc.data() || {};
            if (!l.col || !l.docId || (l.attempts || 0) >= 3) continue;
            const src = FB_SYNC_SOURCES.find(function (s) { return s.col === l.col; });
            if (!src) continue;
            const sd = await _fbLoadSourceData(admin, l.col, l.docId, l.itemId);
            if (!sd) continue;
            await _fbPublishDoc(admin, src, l.docId, sd, doc.ref, l.attempts || 0);
        }
    } catch (err) { console.warn('[FBSync] retry sweep failed:', err.message); }
}

// ── INBOUND ───────────────────────────────────────────────────────────────
async function _fbRehost(admin, url, destBase, maxBytes) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('download ' + r.status);
    if (Number(r.headers.get('content-length') || 0) > maxBytes) throw new Error('too large');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('too large');
    const ct = (r.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    const ext = /mp4/.test(ct) ? '.mp4' : /webm/.test(ct) ? '.webm' : /png/.test(ct) ? '.png' : /gif/.test(ct) ? '.gif' : /webp/.test(ct) ? '.webp' : /video/.test(ct) ? '.mp4' : '.jpg';
    const dest = 'facebook_sync/' + destBase + ext;
    const bucket = admin.storage().bucket();
    const token = crypto.randomUUID();
    await bucket.file(dest).save(buf, { resumable: false, metadata: { contentType: ct, metadata: { firebaseStorageDownloadTokens: token } } });
    return 'https://firebasestorage.googleapis.com/v0/b/' + bucket.name + '/o/' + encodeURIComponent(dest) + '?alt=media&token=' + token;
}

// Page posts tagged #SOS or #status are routed to those sections instead of the general feed.
function _fbInboundKind(msg) {
    const m = String(msg || '');
    if (/(^|\s)#sos\b/i.test(m)) return 'sos';
    if (/(^|\s)#status\b/i.test(m)) return 'status';
    return null;
}
function _fbStripTag(msg, kind) {
    return String(msg || '').replace(new RegExp('(^|\\s)#' + kind + '\\b', 'ig'), '$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function _fbIsVideoUrl(u) { return /\.(mp4|webm|mov)(\?|$)/i.test(String(u || '')); }

// #SOS -> sos_queue as 'pending_approval'. The existing admin SOS review (app-sos.js) is the approval.
async function _fbImportSos(db, p, safe, t, postAs, as, text, media, poster) {
    const lines = text.split('\n').filter(function (x) { return x.trim(); });
    const title = (lines[0] || 'SOS').slice(0, 100);
    const id = 'sos-fb-' + safe;
    await db.collection('sos_queue').doc(id).set({
        id: id, userId: postAs, username: as.fullName || as.username || 'Empyrean', avatar: as.avatar || '',
        title: title, category: 'other', categoryOther: title, story: text, amount: '', currency: '', location: '',
        coords: null, contact: '',
        media: media.map(function (u) { return { url: u, type: _fbIsVideoUrl(u) ? 'video/mp4' : 'image/jpeg' }; }),
        createdAt: new Date(t).toISOString(), status: 'pending_approval',
        source: 'facebook', fbPostId: p.id, fbPermalink: p.permalink_url || ''
    });
    return id;
}

// #status -> a new item on the admin account's status doc.
async function _fbImportStatus(db, p, safe, t, postAs, as, text, media, poster) {
    const docRef = db.collection('statuses').doc('status-' + postAs);
    const cur = await docRef.get();
    const old = cur.exists ? ((cur.data() || {}).items || []) : [];
    const cutoff = Date.now() - 24 * 3600000;
    const kept = old.filter(function (x) { return x && _fbMs(x.createdAt) > cutoff; });      // statuses live 24h
    const vid = media.find(_fbIsVideoUrl);
    const img = media.find(function (u) { return !_fbIsVideoUrl(u); }) || poster || '';
    const type = vid ? 'video' : (img ? 'image' : 'text');
    const itemId = 'si-fb-' + safe;
    if (kept.some(function (x) { return x && x.id === itemId; })) return itemId;
    kept.push({ id: itemId, type: type, url: vid || img || '', content: text, bg: 'var(--primary-color,#1B2B8B)', createdAt: new Date(t).toISOString(),
        likes: 0, retweets: 0, likedBy: [], retweetedBy: [], viewers: [], source: 'facebook', fbPostId: p.id });
    await docRef.set({ userId: postAs, name: as.fullName || as.username || 'Empyrean', avatar: as.avatar || '', items: kept,
        createdAt: (cur.exists && (cur.data() || {}).createdAt) || new Date().toISOString(), audience: 'everyone', excludedUserIds: [] }, { merge: true });
    return itemId;
}

async function _fbPullPageFeed(admin, force) {
    const cfg = await _fbSettings(admin);
    if (!force && !cfg.inbound) return { imported: 0, skipped: true };
    const token = await _fbGetPageToken();
    if (!token) return { imported: 0, error: 'no page token' };
    const db = admin.firestore();
    const stateRef = db.collection(FB_LEDGER).doc('_state');
    let st = await stateRef.get();
    if (!st.exists) { await stateRef.set({ startedAt: new Date().toISOString() }); st = await stateRef.get(); }
    let since = new Date(st.data().startedAt).getTime() - (Number(process.env.FB_IMPORT_BACKFILL_DAYS) || 0) * 86400000;
    if (cfg.inboundSince && cfg.inboundSince > since) since = cfg.inboundSince;   // re-enabling never floods the feed with what was missed while off
    const ad = await _fbAdminIds(admin);
    const postAs = ad.primary;
    if (!postAs) return { imported: 0, error: 'no admin account found to post as' };
    const as = (await db.collection('users').doc(postAs).get()).data() || {};
    const domain = _appDomain();

    const fields = 'id,message,created_time,full_picture,permalink_url,is_published,' +
        'attachments{media_type,type,url,target{id},media{image{src}},subattachments{media{image{src}},type,target{id}}}';
    const feed = await _fbGraph('GET', '/' + FB_PAGE_ID + '/posts', { fields: fields, limit: 25 }, token);
    const posts = (feed.data || []).slice().reverse();                // oldest first
    let imported = 0;

    for (const p of posts) {
        try {
            if (p.is_published === false) continue;
            const t = new Date(p.created_time).getTime();
            if (!t || t < since) continue;
            if (domain && p.message && p.message.indexOf(domain + '/?post=') !== -1) continue;   // our own outbound post
            const safe = String(p.id).replace(/[^\w\-]/g, '_');
            const known = await db.collection(FB_LEDGER).where('fbPostId', '==', p.id).limit(1).get();
            if (!known.empty) continue;                                                       // outbound post, matched by id
            const lref = db.collection(FB_LEDGER).doc('in__' + safe);
            try { await lref.create({ fbPostId: p.id, direction: 'in', status: 'pending', createdAt: new Date().toISOString() }); }
            catch (e) { continue; }                                                           // already imported

            const att = (p.attachments && p.attachments.data && p.attachments.data[0]) || {};
            const kind = String(att.media_type || att.type || '').toLowerCase();
            const media = []; let poster = '';
            try {
                if (kind.indexOf('video') !== -1 && att.target && att.target.id) {
                    const v = await _fbGraph('GET', '/' + att.target.id, { fields: 'source,picture' }, token);
                    if (v.picture) { try { poster = await _fbRehost(admin, v.picture, safe + '_poster', 15 * 1048576); } catch (e) {} }
                    if (v.source) { try { media.push(await _fbRehost(admin, v.source, safe + '_video', 80 * 1048576)); } catch (e) { console.warn('[FBSync] video too large/unavailable, imported with thumbnail only:', e.message); } }
                } else if (att.subattachments && att.subattachments.data && att.subattachments.data.length) {
                    const subs = att.subattachments.data.slice(0, 10);
                    for (let i = 0; i < subs.length; i++) {
                        const src = subs[i].media && subs[i].media.image && subs[i].media.image.src;
                        if (src) media.push(await _fbRehost(admin, src, safe + '_' + i, 15 * 1048576));
                    }
                } else {
                    const src = (att.media && att.media.image && att.media.image.src) || p.full_picture;
                    if (src) media.push(await _fbRehost(admin, src, safe + '_0', 15 * 1048576));
                }
            } catch (mErr) { console.warn('[FBSync] media import issue for', p.id, '-', mErr.message); }

            if (!p.message && !media.length && !poster) { await lref.set({ status: 'skipped' }, { merge: true }); continue; }
            const kindTag = _fbInboundKind(p.message);
            if (kindTag) {                                                                     // #SOS / #status -> their own section
                const txt = _fbStripTag(p.message, kindTag);
                const rid = kindTag === 'sos'
                    ? await _fbImportSos(db, p, safe, t, postAs, as, txt, media, poster)
                    : await _fbImportStatus(db, p, safe, t, postAs, as, txt, media, poster);
                await lref.set({ status: 'done', docId: rid, kind: kindTag }, { merge: true });
                imported++; fbStats.imported++;
                continue;
            }
            const docId = 'fb_' + safe;
            const doc = {
                id: docId, userId: postAs,
                username: as.fullName || as.username || 'Empyrean',
                avatar: as.avatar || '',
                text: p.message || '', media: media,
                createdAt: new Date(t).toISOString(), likes: 0,
                source: 'facebook', fbPostId: p.id, fbPermalink: p.permalink_url || ''
            };
            if (poster) { doc.poster = poster; doc.thumbnailUrl = poster; }
            await db.collection('posts').doc(docId).set(doc);
            await lref.set({ status: 'done', docId: docId }, { merge: true });
            imported++; fbStats.imported++;
        } catch (err) {
            console.warn('[FBSync] import failed for', p.id, '-', err.message);
            fbStats.lastError = err.message;
            await db.collection(FB_LEDGER).doc('in__' + String(p.id).replace(/[^\w\-]/g, '_')).delete().catch(function () {});   // let the next poll retry
        }
    }
    fbStats.lastPullAt = new Date().toISOString(); fbStats.lastPullImported = imported;
    return { imported: imported };
}

function startFacebookSync() {
    if (process.env.FB_SYNC_ENABLED === '0') { console.log('[FBSync] disabled (FB_SYNC_ENABLED=0).'); return; }
    const admin = _getAdmin();
    if (!admin) { console.warn('[FBSync] FIREBASE_SERVICE_ACCOUNT_JSON not set — Facebook sync disabled.'); return; }
    FB_SYNC_SOURCES.forEach(function (s) { if (!s.custom) _fbWatchSource(admin, s); });
    _fbWatchStatuses(admin);
    const pullMs = (Number(process.env.FB_PULL_INTERVAL_MIN) || 3) * 60000;
    setInterval(function () { _fbPullPageFeed(admin).catch(function (e) { fbStats.lastError = e.message; console.warn('[FBSync] pull failed:', e.message); }); }, pullMs);
    setTimeout(function () { _fbPullPageFeed(admin).catch(function (e) { fbStats.lastError = e.message; console.warn('[FBSync] first pull failed:', e.message); }); }, 20000);
    setInterval(function () { _fbRetrySweep(admin); }, 10 * 60000);
    _fbGetPageToken().then(function (t) { console.log('[FBSync] Watching ' + FB_SYNC_SOURCES.map(function (s) { return s.col; }).join(', ') + ' (admin-only) -> Page ' + FB_PAGE_ID + '; page token ' + (t ? 'found' : 'NOT found') + '.'); });
}

// Admin-only helpers. POST on purpose: the SPA catch-all above only handles GET.
app.post('/api/admin/facebook/status', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    if (!(await _requireAdminForPolls(req, res, admin))) return;
    const token = await _fbGetPageToken();
    let page = null, pageError = null;
    if (token) { try { page = await _fbGraph('GET', '/' + FB_PAGE_ID, { fields: 'id,name,link' }, token); } catch (e) { pageError = e.message; } }
    const ad = await _fbAdminIds(admin);
    res.json({ tokenFound: !!token, page: page, pageError: pageError, adminUids: Array.from(ad.ids), postAs: ad.primary, stats: fbStats, settings: await _fbSettings(admin, true) });
});
app.post('/api/admin/facebook/push', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    if (!(await _requireAdminForPolls(req, res, admin))) return;
    const col = String((req.body && req.body.collection) || ''), id = String((req.body && req.body.id) || '');
    const src = FB_SYNC_SOURCES.find(function (s) { return s.col === col; });
    if (!src || src.custom || !id || id.indexOf('/') !== -1) return res.status(400).json({ error: 'collection (one of ' + FB_SYNC_SOURCES.filter(function (s) { return !s.custom; }).map(function (s) { return s.col; }).join(', ') + ') and id required' });
    const snap = await admin.firestore().collection(col).doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Document not found' });
    const ledgerRef = admin.firestore().collection(FB_LEDGER).doc('out__' + col + '__' + id);
    const led = await ledgerRef.get();
    if (led.exists && led.data().status === 'done' && !(req.body && req.body.force)) return res.status(409).json({ error: 'Already posted', fbPostId: led.data().fbPostId });
    const out = await _fbPublishDoc(admin, src, id, snap.data() || {}, ledgerRef, (led.exists && led.data().attempts) || 0);
    res.status(out.ok ? 200 : 502).json(out);
});
app.post('/api/admin/facebook/pull', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    if (!(await _requireAdminForPolls(req, res, admin))) return;
    try { res.json(await _fbPullPageFeed(admin, true)); } catch (e) { res.status(502).json({ error: e.message }); }
});

// Admin control routes used by Admin Panel -> Facebook tab (app-admin.js).
app.post('/api/admin/facebook/settings', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    if (!(await _requireAdminForPolls(req, res, admin))) return;
    try {
        const b = req.body || {}, patch = {};
        if (b.mode != null) {
            if (['auto', 'approve', 'off'].indexOf(b.mode) === -1) return res.status(400).json({ error: 'mode must be auto, approve or off' });
            patch.mode = b.mode;
        }
        if (b.inbound != null) {
            patch.inbound = !!b.inbound;
            if (patch.inbound) patch.inboundSince = Date.now();
        }
        if (Object.keys(patch).length) {
            patch.updatedAt = new Date().toISOString();
            await admin.firestore().collection(FB_LEDGER).doc('_settings').set(patch, { merge: true });
        }
        res.json({ settings: await _fbSettings(admin, true) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin/facebook/queue', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    if (!(await _requireAdminForPolls(req, res, admin))) return;
    try {
        const col = admin.firestore().collection(FB_LEDGER);
        const shape = function (d) { const x = d.data() || {}; return { key: d.id, col: x.col || '', docId: x.docId || '', status: x.status, kind: x.kind || '', preview: x.preview || '', thumb: x.thumb || '', error: x.error || '', fbPostId: x.fbPostId || '', at: x.publishedAt || x.failedAt || x.createdAt || '' }; };
        const [aw, fl, dn] = await Promise.all([
            col.where('status', '==', 'awaiting').limit(50).get(),
            col.where('status', '==', 'failed').limit(20).get(),
            col.orderBy('publishedAt', 'desc').limit(15).get()
        ]);
        res.json({
            awaiting: aw.docs.map(shape).filter(function (x) { return x.col; }),
            failed:   fl.docs.map(shape).filter(function (x) { return x.col; }),
            recent:   dn.docs.map(shape).filter(function (x) { return x.col && x.status === 'done'; })
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin/facebook/decide', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
    if (!(await _requireAdminForPolls(req, res, admin))) return;
    const key = String((req.body && req.body.key) || ''), action = String((req.body && req.body.action) || '');
    if (!/^out__[\w\-]+__[\w\-]+$/.test(key) || ['approve', 'reject', 'retry'].indexOf(action) === -1) return res.status(400).json({ error: 'key and action (approve|reject|retry) required' });
    try {
        const ref = admin.firestore().collection(FB_LEDGER).doc(key);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Entry not found' });
        const l = snap.data() || {};
        if (action === 'reject') {
            if (l.status !== 'awaiting' && l.status !== 'failed') return res.status(409).json({ error: 'Nothing to reject' });
            await ref.set({ status: 'rejected', decidedAt: new Date().toISOString() }, { merge: true });
            return res.json({ ok: true });
        }
        if (!((action === 'approve' && l.status === 'awaiting') || (action === 'retry' && l.status === 'failed'))) return res.status(409).json({ error: 'This entry is already ' + l.status });
        const src = FB_SYNC_SOURCES.find(function (s2) { return s2.col === l.col; });
        const sdata = src ? await _fbLoadSourceData(admin, l.col, l.docId, l.itemId) : null;
        if (!sdata) { await ref.set({ status: 'skipped', error: 'original post no longer exists' }, { merge: true }); return res.status(404).json({ error: 'The original post no longer exists.' }); }
        const out = await _fbPublishDoc(admin, src, l.docId, sdata, ref, l.attempts || 0);
        res.status(out.ok ? 200 : 502).json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// =============================================================================
// ADS MANAGER + AD REVENUE + SERVER HEALTH + ADMIN ANALYTICS BUNDLE  (2026-11-07)
//
// WHY THIS BLOCK EXISTS (Admin ▸ Platform Analytics said "not recorded by the app yet"
// for ad revenue, server load, audience city; and every browser read of analytics_daily
// could fail with permission-denied whenever the published Firestore rules were older than
// firebase-rules.js):
//   1. AD CAMPAIGNS (Facebook-Ads-Manager style): advertisers fund a campaign from their EMPY
//      wallet (atomic debit), an admin approves it, it is served in the feed (app-feed.js
//      empyreanAdvertsFeedInjector), and delivery is METERED HERE — the browser never writes
//      impressions/clicks/spend itself, so the numbers cannot be inflated from devtools.
//        awareness -> billed per 1,000 impressions (CPM)      traffic / leads -> billed per click (CPC)
//      Unspent budget is refunded when a campaign is cancelled, rejected or expires.
//      Platform AD REVENUE = the spend actually delivered (ad_campaigns.spent / ad_daily.spend).
//   2. SERVER HEALTH: real process numbers (memory, load average, event-loop lag, request rate,
//      latency, 5xx count) from a tiny per-minute request meter — nothing estimated.
//   3. ADMIN ANALYTICS BUNDLE: the same analytics_daily/analytics_sessions data, read with the
//      Admin SDK so the dashboard still works if the browser is blocked by stale security rules.
// All routes verify the caller's Firebase ID token; admin routes reuse _requireAdminForAdRevenue.
// =============================================================================
const AD_CPM_EMPY = Number(process.env.AD_CPM_EMPY) || 5;      // EMPY per 1,000 impressions (awareness)
const AD_CPC_EMPY = Number(process.env.AD_CPC_EMPY) || 0.5;    // EMPY per click (traffic / leads)
const AD_MIN_DAILY_EMPY = 20, AD_MAX_DAILY_EMPY = 50000, AD_MAX_TOTAL_EMPY = 200000, AD_MAX_DAYS = 30;
const AD_OBJECTIVES = ['awareness', 'traffic', 'leads'];
const AD_CTAS = ['Learn More', 'Shop Now', 'Sign Up', 'Donate', 'Contact Us', 'Download', 'Apply Now'];
function _adsLagosDay(ago) { return new Date(Date.now() + 3600000 - (ago || 0) * 86400000).toISOString().slice(0, 10); }
function _adsRound(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

app.get('/api/admin/server-stats', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;
    const mem = process.memoryUsage(), cpus = (_adsOs.cpus() || []).length || 1, load = _adsOs.loadavg();
    const nowMin = Math.floor(Date.now() / 60000), series = [];
    let n5 = 0, ms5 = 0, e5 = 0;
    for (let i = 29; i >= 0; i--) {
        const b = _srvMeter.buckets[nowMin - i];
        series.push({ t: (nowMin - i) * 60000, n: b ? b.n : 0, avgMs: b && b.n ? Math.round(b.ms / b.n) : 0 });
        if (i < 5 && b) { n5 += b.n; ms5 += b.ms; e5 += b.e5; }
    }
    let loop = null;
    if (_srvMeter.loop) { loop = { meanMs: Math.round(_srvMeter.loop.mean / 1e6 * 10) / 10, p99Ms: Math.round(_srvMeter.loop.percentile(99) / 1e6 * 10) / 10 }; _srvMeter.loop.reset(); }
    res.json({
        ok: true, at: Date.now(), uptimeSec: Math.round(process.uptime()), node: process.version,
        rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), heapTotalMb: Math.round(mem.heapTotal / 1048576),
        hostMemTotalMb: Math.round(_adsOs.totalmem() / 1048576), hostMemFreeMb: Math.round(_adsOs.freemem() / 1048576),
        cpus, loadAvg: load.map(function (x) { return Math.round(x * 100) / 100; }), cpuLoadPct: Math.min(100, Math.round(load[0] / cpus * 100)),
        eventLoop: loop, last5min: { requests: n5, rpm: Math.round(n5 / 5 * 10) / 10, avgMs: n5 ? Math.round(ms5 / n5) : 0, errors5xx: e5 }, series
    });
});

// ── Admin analytics read through the Admin SDK (bypasses browser security rules) ──────────
app.get('/api/admin/analytics/bundle', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    try {
        const db = admin.firestore(), keys = {};
        for (let i = 0; i < days * 2 + 2; i++) keys[_adsLagosDay(i)] = 1;
        const list = Object.keys(keys), out = {};
        const snaps = await Promise.all(list.map(function (k) { return db.collection('analytics_daily').doc(k).get(); }));
        snaps.forEach(function (s, i) { if (s.exists) out[list[i]] = s.data(); });
        const since = new Date(Date.now() - 90000).toISOString();
        const act = await db.collection('analytics_sessions').where('lastSeen', '>=', since).limit(500).get();
        const uids = {}; let guests = 0;
        act.forEach(function (d) { const x = d.data() || {}; if (x.uid) uids[x.uid] = 1; else guests++; });
        res.json({ ok: true, days: out, activeNow: { members: Object.keys(uids).length, guests } });
    } catch (err) { res.status(500).json({ error: 'Could not read analytics', detail: err.message }); }
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────
function _adsHttps(u, max) {
    if (!u) return '';
    u = String(u).trim(); if (u.length > (max || 500)) return null;
    try { const p = new URL(u); return p.protocol === 'https:' ? p.href : null; } catch (e) { return null; }
}
function _adsList(a, maxItems, maxLen) {
    if (!Array.isArray(a)) return [];
    const seen = {}, out = [];
    a.forEach(function (x) { x = String(x == null ? '' : x).trim().toLowerCase().slice(0, maxLen); if (x && !seen[x] && out.length < maxItems) { seen[x] = 1; out.push(x); } });
    return out;
}
function _adsRemaining(c) { return Math.max(0, _adsRound((c.totalBudget || 0) - (c.spent || 0) - (c.refunded || 0))); }
// Refund the unspent part of a campaign to the advertiser's EMPY balance. MUST run inside a transaction
// that has already read campRef (c) and userRef (u) — returns the amount refunded.
function _adsRefundInTx(tx, admin, db, campRef, c, userRef, why) {
    const left = _adsRemaining(c);
    if (left > 0) {
        tx.update(userRef, { empyBalance: admin.firestore.FieldValue.increment(left) });
        tx.set(db.collection('transactions').doc(), { userId: c.ownerId, type: 'ad_campaign_refund', campaignId: campRef.id, amount: left, reason: why, status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    return left;
}

const AD_BLOCKED_PHRASES = ['guaranteed returns', 'double your money', 'doubling your', 'crypto giveaway', 'send btc', 'get rich quick', 'forex signal', 'investment plan'];
// Validate + normalise a campaign request. Returns { err } or { v }.
function _adsParse(b) {
    const name = String(b.name || '').trim().slice(0, 60), advertiserName = String(b.advertiserName || '').trim().slice(0, 60);
    const caption = String(b.caption || '').trim().slice(0, 300), objective = String(b.objective || '');
    const mediaUrl = _adsHttps(b.mediaUrl, 600), linkUrl = _adsHttps(b.linkUrl, 500);
    const mediaType = b.mediaType === 'video' ? 'video' : 'image';
    const ctaLabel = AD_CTAS.indexOf(b.ctaLabel) > -1 ? b.ctaLabel : 'Learn More';
    const dailyBudget = Math.floor(Number(b.dailyBudget)), durationDays = Math.floor(Number(b.durationDays));
    const postId = b.postId ? String(b.postId).slice(0, 80) : '';
    if (name.length < 3) return { err: 'Give the campaign a name (3+ characters).' };
    if (advertiserName.length < 2) return { err: 'Enter the advertiser / page name shown on the ad.' };
    if (AD_OBJECTIVES.indexOf(objective) < 0) return { err: 'Choose a valid objective.' };
    if (!mediaUrl) return { err: 'Add an image or video for the ad (https).' };
    if (linkUrl === null) return { err: 'The destination link must be a valid https:// URL.' };
    if (objective !== 'awareness' && !linkUrl) return { err: 'Traffic and lead campaigns need a destination link.' };
    if (!(dailyBudget >= AD_MIN_DAILY_EMPY && dailyBudget <= AD_MAX_DAILY_EMPY)) return { err: 'Daily budget must be between ' + AD_MIN_DAILY_EMPY + ' and ' + AD_MAX_DAILY_EMPY + ' EMPY.' };
    if (!(durationDays >= 1 && durationDays <= AD_MAX_DAYS)) return { err: 'Duration must be 1-' + AD_MAX_DAYS + ' days.' };
    const totalBudget = dailyBudget * durationDays;
    if (totalBudget > AD_MAX_TOTAL_EMPY) return { err: 'Total budget cannot exceed ' + AD_MAX_TOTAL_EMPY + ' EMPY.' };
    const text = (name + ' ' + caption + ' ' + advertiserName).toLowerCase();
    if (AD_BLOCKED_PHRASES.some(function (p) { return text.indexOf(p) > -1; })) return { err: 'This ad was blocked by our automatic advertising policy check (misleading financial claims). Please change the wording.' };
    return { v: { name, advertiserName, caption, objective, mediaUrl, mediaType, linkUrl: linkUrl || '', ctaLabel, dailyBudget, durationDays, totalBudget, postId,
        targeting: { locations: _adsList(b.locations, 10, 40), keywords: _adsList(b.keywords, 10, 30), placements: ['feed'] } } };
}
// Campaigns go live immediately (no manual approval): the automatic policy check above is the gate, and an
// admin can still stop any running campaign (the unspent budget is refunded).
function _adsCampaignDoc(admin, v, uid, ud, id, extra) {
    const now = Date.now();
    return Object.assign({
        id, ownerId: uid, ownerName: ud.fullName || ud.username || '', name: v.name, objective: v.objective, status: 'active',
        advertiserName: v.advertiserName, caption: v.caption, mediaUrl: v.mediaUrl, mediaType: v.mediaType, linkUrl: v.linkUrl, ctaLabel: v.ctaLabel, priority: 1,
        postId: v.postId || '', targeting: v.targeting, pricing: v.objective === 'awareness' ? { model: 'cpm', rate: AD_CPM_EMPY } : { model: 'cpc', rate: AD_CPC_EMPY },
        dailyBudget: v.dailyBudget, durationDays: v.durationDays, totalBudget: v.totalBudget, spent: 0, refunded: 0, impressions: 0, clicks: 0, reach: 0, daily: {},
        startAt: now, endAt: now + v.durationDays * 86400000, createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, extra || {});
}
async function _adsCheckPost(db, v, uid) {
    if (!v.postId) return null;
    const p = await db.collection('posts').doc(v.postId).get();
    if (!p.exists || (p.data() || {}).userId !== uid) return 'You can only promote your own posts.';
    return null;
}

// ── create + fund a campaign from the EMPY wallet ─────────────────────────────────────────
app.post('/api/ads/campaigns/create', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;
    if (decoded.firebase && decoded.firebase.sign_in_provider === 'anonymous') return res.status(403).json({ error: 'Create an account to run ads.' });
    const parsed = _adsParse(req.body || {}); if (parsed.err) return res.status(400).json({ error: parsed.err });
    const v = parsed.v, uid = decoded.uid;
    try {
        const db = admin.firestore(), postErr = await _adsCheckPost(db, v, uid);
        if (postErr) return res.status(403).json({ error: postErr });
        const userRef = db.collection('users').doc(uid), campRef = db.collection('ad_campaigns').doc('cmp_' + db.collection('_').doc().id);
        const result = await db.runTransaction(async (tx) => {
            const u = await tx.get(userRef);
            if (!u.exists) return { code: 404, body: { error: 'Account not found.' } };
            const ud = u.data() || {};
            if (Number(ud.empyBalance || 0) < v.totalBudget) return { code: 402, body: { error: 'Not enough EMPY. This campaign needs ' + v.totalBudget + ' EMPY; your balance is ' + Math.floor(Number(ud.empyBalance || 0)) + '. You can also pay by card.' } };
            tx.update(userRef, { empyBalance: admin.firestore.FieldValue.increment(-v.totalBudget) });
            tx.set(campRef, _adsCampaignDoc(admin, v, uid, ud, campRef.id, { fundedVia: 'wallet' }));
            tx.set(db.collection('transactions').doc(), { userId: uid, type: 'ad_campaign_funding', campaignId: campRef.id, amount: v.totalBudget, status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp() });
            return { code: 200, body: { ok: true, id: campRef.id, totalBudget: v.totalBudget, status: 'active' } };
        });
        res.status(result.code).json(result.body);
    } catch (err) { console.error('[Ads] create failed:', err.message); res.status(500).json({ error: 'Could not create campaign', detail: err.message }); }
});

// ── create + fund a campaign by CARD / bank transfer (Flutterwave, verified server-side) ───
// The charged NGN amount is re-checked with Flutterwave using the secret key; tx_ref must embed the caller's uid
// (EMPY-AD-<uid>-<ts>) so one person's payment can't fund another's campaign; the campaign id is derived from the
// tx_ref so a retried call can never create (or charge for) the same campaign twice. Any unspent budget on a
// card-funded campaign is refunded as EMPY wallet credit at the same rate.
app.post('/api/ads/campaigns/create-card', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;
    if (decoded.firebase && decoded.firebase.sign_in_provider === 'anonymous') return res.status(403).json({ error: 'Create an account to run ads.' });
    const uid = decoded.uid, txRef = String((req.body && req.body.txRef) || '');
    if (!/^EMPY-AD-[A-Za-z0-9]+-\d{10,15}$/.test(txRef) || txRef.indexOf('EMPY-AD-' + uid + '-') !== 0) return res.status(400).json({ error: 'Invalid payment reference.' });
    const parsed = _adsParse(req.body || {}); if (parsed.err) return res.status(400).json({ error: parsed.err });
    const v = parsed.v;
    let flw;
    try { flw = await _verifyFlwTxRef(txRef); } catch (err) { return res.status(502).json({ error: 'Could not verify the payment with Flutterwave.', detail: err.message }); }
    const d = flw && flw.data, expected = Math.ceil(v.totalBudget * EMPY_RATE_USD * USD_TO_NGN_RATE);
    if (!(flw && flw.status === 'success' && d && d.status === 'successful' && d.currency === 'NGN')) return res.status(402).json({ error: 'Payment was not confirmed by Flutterwave.' });
    if (Number(d.amount) < expected - 0.5) return res.status(402).json({ error: 'The amount paid (' + d.amount + ' NGN) is less than this campaign costs (' + expected + ' NGN).' });
    try {
        const db = admin.firestore(), postErr = await _adsCheckPost(db, v, uid);
        if (postErr) return res.status(403).json({ error: postErr });
        const id = 'cmp_' + require('crypto').createHash('sha1').update(txRef).digest('hex').slice(0, 24);
        const campRef = db.collection('ad_campaigns').doc(id), userRef = db.collection('users').doc(uid);
        const out = await db.runTransaction(async (tx) => {
            const [c, u] = await Promise.all([tx.get(campRef), tx.get(userRef)]);
            if (c.exists) return { ok: true, id, already: true };
            if (!u.exists) return { err: 'Account not found.' };
            tx.set(campRef, _adsCampaignDoc(admin, v, uid, u.data() || {}, id, { fundedVia: 'card', txRef, amountNgn: Number(d.amount) }));
            tx.set(db.collection('transactions').doc(), { userId: uid, type: 'ad_campaign_funding_card', campaignId: id, amount: v.totalBudget, amountNgn: Number(d.amount), txRef, status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp() });
            return { ok: true, id, totalBudget: v.totalBudget, status: 'active' };
        });
        if (out.err) return res.status(404).json({ error: out.err });
        res.json(out);
    } catch (err) { console.error('[Ads] card create failed:', err.message); res.status(500).json({ error: 'Payment received but the campaign could not be saved. Contact support with reference ' + txRef, detail: err.message }); }
});

// Public price list for the Ads Manager's budget estimator (no auth, nothing sensitive).
app.get('/api/ads/pricing', (req, res) => {
    res.json({ cpm: AD_CPM_EMPY, cpc: AD_CPC_EMPY, minDaily: AD_MIN_DAILY_EMPY, maxDaily: AD_MAX_DAILY_EMPY, maxDays: AD_MAX_DAYS, ctas: AD_CTAS, objectives: AD_OBJECTIVES, empyUsd: EMPY_RATE_USD, ngnPerEmpy: EMPY_RATE_USD * USD_TO_NGN_RATE, cardEnabled: !!process.env.FLW_SECRET_KEY });
});

// ── owner actions: pause / resume / cancel ────────────────────────────────────────────────
app.post('/api/ads/campaigns/:id/action', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;
    const action = String((req.body && req.body.action) || '');
    if (['pause', 'resume', 'cancel'].indexOf(action) < 0) return res.status(400).json({ error: 'Unknown action.' });
    try {
        const db = admin.firestore(), campRef = db.collection('ad_campaigns').doc(String(req.params.id));
        const result = await db.runTransaction(async (tx) => {
            const s = await tx.get(campRef);
            if (!s.exists) return { code: 404, body: { error: 'Campaign not found.' } };
            const c = s.data();
            if (c.ownerId !== decoded.uid) return { code: 403, body: { error: 'Not your campaign.' } };
            const userRef = db.collection('users').doc(c.ownerId);
            let u = null; if (action === 'cancel') u = await tx.get(userRef);
            if (action === 'pause') { if (c.status !== 'active') return { code: 409, body: { error: 'Only a running campaign can be paused.' } }; tx.update(campRef, { status: 'paused' }); return { code: 200, body: { ok: true, status: 'paused' } }; }
            if (action === 'resume') {
                if (c.status !== 'paused') return { code: 409, body: { error: 'Only a paused campaign can be resumed.' } };
                if (Date.now() >= (c.endAt || 0)) return { code: 409, body: { error: 'This campaign has already reached its end date.' } };
                tx.update(campRef, { status: 'active' }); return { code: 200, body: { ok: true, status: 'active' } };
            }
            if (['pending_review', 'active', 'paused'].indexOf(c.status) < 0) return { code: 409, body: { error: 'This campaign is already finished.' } };
            const refunded = _adsRefundInTx(tx, admin, db, campRef, c, userRef, 'cancelled by advertiser');
            tx.update(campRef, { status: 'cancelled', refunded: _adsRound((c.refunded || 0) + refunded), endedAt: Date.now() });
            return { code: 200, body: { ok: true, status: 'cancelled', refunded } };
        });
        res.status(result.code).json(result.body);
    } catch (err) { res.status(500).json({ error: 'Could not update campaign', detail: err.message }); }
});

// ── delivery metering: the ONLY writer of impressions / clicks / spend ────────────────────
app.post('/api/ads/event', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(204).end();
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;
    const campaignId = String((req.body && req.body.campaignId) || ''), type = req.body && req.body.type;
    if (!/^cmp_[A-Za-z0-9]{10,40}$/.test(campaignId) || (type !== 'impression' && type !== 'click')) return res.status(400).json({ error: 'Bad event.' });
    const uid = decoded.uid, FV = admin.firestore.FieldValue;
    try {
        const db = admin.firestore(), campRef = db.collection('ad_campaigns').doc(campaignId);
        const now = Date.now(), dayKey = _adsLagosDay(0), dk = dayKey.replace(/-/g, '_');
        const bucket = type === 'impression' ? Math.floor(now / 1800000) : Math.floor(now / 60000);
        const dupRef = db.collection('ad_event_dedupe').doc(campaignId + '_' + uid + '_' + type.charAt(0) + '_' + bucket);
        const reachRef = db.collection('ad_event_dedupe').doc(campaignId + '_' + uid + '_reach');
        const out = await db.runTransaction(async (tx) => {
            const [cs, dup, rch] = await Promise.all([tx.get(campRef), tx.get(dupRef), tx.get(reachRef)]);
            if (!cs.exists) return 'missing';
            const c = cs.data();
            if (c.status !== 'active' || now < (c.startAt || 0) || now >= (c.endAt || 0)) return 'inactive';
            if (c.ownerId === uid) return 'self';
            if (dup.exists) return 'duplicate';
            const dayStat = (c.daily && c.daily[dk]) || {};
            const roomTotal = (c.totalBudget || 0) - (c.spent || 0) - (c.refunded || 0), roomDay = (c.dailyBudget || 0) - (dayStat.spend || 0);
            if (roomTotal <= 0.0001 || roomDay <= 0.0001) return 'capped';
            const p = c.pricing || {}; let cost = 0;
            if (p.model === 'cpm' && type === 'impression') cost = (p.rate || AD_CPM_EMPY) / 1000;
            else if (p.model === 'cpc' && type === 'click') cost = p.rate || AD_CPC_EMPY;
            cost = _adsRound(Math.min(cost, roomTotal, roomDay));
            const upd = {}, dayUpd = {};
            const fld = type === 'impression' ? 'impressions' : 'clicks';
            upd[fld] = FV.increment(1); upd['daily.' + dk + '.' + fld] = FV.increment(1); dayUpd[fld] = FV.increment(1);
            if (type === 'impression' && !rch.exists) { upd.reach = FV.increment(1); tx.set(reachRef, { ts: now, c: campaignId }); }
            if (cost > 0) { upd.spent = FV.increment(cost); upd['daily.' + dk + '.spend'] = FV.increment(cost); dayUpd.spend = FV.increment(cost); }
            if ((c.spent || 0) + cost >= (c.totalBudget || 0) - (c.refunded || 0) - 0.0001) { upd.status = 'completed'; upd.endedAt = now; }
            tx.update(campRef, upd);
            tx.set(db.collection('ad_daily').doc(dayKey), dayUpd, { merge: true });
            tx.set(dupRef, { ts: now, c: campaignId });
            return 'ok';
        });
        res.json({ ok: out === 'ok', result: out });
    } catch (err) { res.status(500).json({ error: 'event failed', detail: err.message }); }
});

// ── admin: list / review / stop campaigns, and the ad-revenue summary ─────────────────────
app.get('/api/admin/ads/campaigns', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;
    try {
        const status = String(req.query.status || '');
        let q = admin.firestore().collection('ad_campaigns');
        if (status) q = q.where('status', '==', status);
        const snap = await q.limit(300).get(), rows = [];
        snap.forEach(function (d) {
            const c = d.data() || {}, ts = c.createdAt && c.createdAt.toMillis ? c.createdAt.toMillis() : 0;
            c.createdAt = ts; delete c.daily; rows.push(c);
        });
        rows.sort(function (a, b) { return b.createdAt - a.createdAt; });
        res.json({ ok: true, campaigns: rows });
    } catch (err) { res.status(500).json({ error: 'Could not list campaigns', detail: err.message }); }
});

app.post('/api/admin/ads/campaigns/:id/review', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;
    const decision = String((req.body && req.body.decision) || ''), reason = String((req.body && req.body.reason) || '').slice(0, 300);
    if (['approve', 'reject', 'stop'].indexOf(decision) < 0) return res.status(400).json({ error: 'decision must be approve, reject or stop' });
    if (decision !== 'approve' && reason.length < 3) return res.status(400).json({ error: 'Give the advertiser a short reason.' });
    try {
        const db = admin.firestore(), campRef = db.collection('ad_campaigns').doc(String(req.params.id));
        const result = await db.runTransaction(async (tx) => {
            const s = await tx.get(campRef);
            if (!s.exists) return { code: 404, body: { error: 'Campaign not found.' } };
            const c = s.data(), userRef = db.collection('users').doc(c.ownerId), u = await tx.get(userRef);
            const meta = { reviewedBy: decoded.email || decoded.uid, reviewedAt: Date.now() };
            if (decision === 'approve') {
                if (c.status !== 'pending_review') return { code: 409, body: { error: 'Only a campaign awaiting review can be approved.' } };
                const now = Date.now();
                tx.update(campRef, Object.assign(meta, { status: 'active', startAt: now, endAt: now + c.durationDays * 86400000 }));
                return { code: 200, body: { ok: true, status: 'active' } };
            }
            if (['pending_review', 'active', 'paused'].indexOf(c.status) < 0) return { code: 409, body: { error: 'This campaign is already finished.' } };
            const refunded = u.exists ? _adsRefundInTx(tx, admin, db, campRef, c, userRef, decision === 'reject' ? 'rejected by review' : 'stopped by admin') : 0;
            tx.update(campRef, Object.assign(meta, { status: decision === 'reject' ? 'rejected' : 'cancelled', rejectReason: reason, refunded: _adsRound((c.refunded || 0) + refunded), endedAt: Date.now() }));
            return { code: 200, body: { ok: true, status: decision === 'reject' ? 'rejected' : 'cancelled', refunded } };
        });
        res.status(result.code).json(result.body);
    } catch (err) { res.status(500).json({ error: 'Review failed', detail: err.message }); }
});

app.get('/api/admin/ads/summary', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAdminForAdRevenue(req, res, admin);
    if (!decoded) return;
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    try {
        const db = admin.firestore(), keys = [];
        for (let i = days * 2 - 1; i >= 0; i--) keys.push(_adsLagosDay(i));
        const snaps = await Promise.all(keys.map(function (k) { return db.collection('ad_daily').doc(k).get(); }));
        const rows = keys.map(function (k, i) { const d = snaps[i].exists ? snaps[i].data() : {}; return { key: k, impressions: d.impressions || 0, clicks: d.clicks || 0, spend: _adsRound(d.spend || 0) }; });
        const prev = rows.slice(0, days), cur = rows.slice(days);
        const tot = function (a, f) { return _adsRound(a.reduce(function (s, r) { return s + r[f]; }, 0)); };
        const cs = await db.collection('ad_campaigns').limit(1000).get(), status = {}, top = []; let lifetimeSpend = 0;
        cs.forEach(function (d) { const c = d.data() || {}; status[c.status] = (status[c.status] || 0) + 1; lifetimeSpend += c.spent || 0; top.push({ id: c.id, name: c.name, advertiser: c.advertiserName, objective: c.objective, spent: _adsRound(c.spent || 0), impressions: c.impressions || 0, clicks: c.clicks || 0, status: c.status }); });
        top.sort(function (a, b) { return b.spent - a.spent; });
        // Post boosts / business-page campaigns are paid up front (promotions collection) — report them separately
        const fromKey = new Date(keys[days] + 'T00:00:00+01:00').getTime();
        const ps = await db.collection('promotions').limit(2000).get(); let boostNgn = 0, boostCount = 0, bizEmpy = 0, bizCount = 0;
        ps.forEach(function (d) {
            const p = d.data() || {}, c = p.createdAt; let t = 0;
            if (c && c.toMillis) t = c.toMillis(); else if (c && c._seconds) t = c._seconds * 1000; else if (c) t = new Date(c).getTime() || 0;
            if (!t || t < fromKey) return;
            if (p.budgetNGN) { boostNgn += Number(p.budgetNGN) || 0; boostCount++; } else if (p.totalBudget && p.ownerId) { bizEmpy += Number(p.totalBudget) || 0; bizCount++; }
        });
        res.json({
            ok: true, days, empyUsd: EMPY_RATE_USD, pricing: { cpm: AD_CPM_EMPY, cpc: AD_CPC_EMPY },
            cur: cur, prev: prev,
            totals: { spend: tot(cur, 'spend'), impressions: tot(cur, 'impressions'), clicks: tot(cur, 'clicks'), prevSpend: tot(prev, 'spend'), prevImpressions: tot(prev, 'impressions'), prevClicks: tot(prev, 'clicks'), lifetimeSpend: _adsRound(lifetimeSpend) },
            status, top: top.slice(0, 5),
            purchases: { boostNgn: Math.round(boostNgn), boostCount, boostUsd: _adsRound(boostNgn / USD_TO_NGN_RATE), bizEmpy: Math.round(bizEmpy), bizCount, bizUsd: _adsRound(bizEmpy * EMPY_RATE_USD) }
        });
    } catch (err) { res.status(500).json({ error: 'Could not build ad summary', detail: err.message }); }
});

// ── housekeeping: end expired campaigns (refund the unspent part) and prune dedupe docs ────
async function _adsSweep() {
    const admin = _getAdmin(); if (!admin) return;
    try {
        const db = admin.firestore(), now = Date.now(); let ended = 0;
        for (const st of ['active', 'paused']) {
            const snap = await db.collection('ad_campaigns').where('status', '==', st).limit(300).get();
            for (const d of snap.docs) {
                const c0 = d.data() || {}; if (!c0.endAt || c0.endAt > now) continue;
                await db.runTransaction(async (tx) => {
                    const s = await tx.get(d.ref); const c = s.data();
                    if (!c || (c.status !== 'active' && c.status !== 'paused') || c.endAt > now) return;
                    const userRef = db.collection('users').doc(c.ownerId), u = await tx.get(userRef);
                    const refunded = u.exists ? _adsRefundInTx(tx, admin, db, d.ref, c, userRef, 'campaign ended') : 0;
                    tx.update(d.ref, { status: 'completed', refunded: _adsRound((c.refunded || 0) + refunded), endedAt: now });
                });
                ended++;
            }
        }
        const old = await db.collection('ad_event_dedupe').where('ts', '<', now - 172800000).limit(300).get();
        if (!old.empty) { const batch = db.batch(); old.forEach(function (d) { batch.delete(d.ref); }); await batch.commit(); }
        if (ended) console.log('[Ads] sweep ended ' + ended + ' expired campaign(s)');
    } catch (err) { console.warn('[Ads] sweep failed:', err.message); }
}
setTimeout(function () { _adsSweep(); setInterval(_adsSweep, 600000); }, 45000);

// =============================================================================
// CREATOR SUBSCRIPTIONS (2026-11-07) — powers the "Subs" earnings tab.
//   creator_subscription_plans/{creatorId}   one plan per creator: priceEmpy per 30 days, perks text, active flag
//   creator_subscriptions/{creatorId}_{fanId} one row per fan: status, renewsAt, cancelAtPeriodEnd, totals
// Money moves ONLY here (Admin SDK, one transaction): the fan's EMPY balance is debited and the creator is credited
// the net amount on `giftTokenBalance` — the existing withdrawable earnings balance used for gifts/tips, so
// subscription income can be withdrawn exactly like gift income (earnings-routes.js is untouched).
// Platform fee: SUB_PLATFORM_FEE_PCT env var (default 0 = creator keeps 100%). Renewals run automatically every
// 10 minutes; if the fan's balance is too low the subscription lapses (status 'expired') — no negative balances.
// =============================================================================
const SUB_PERIOD_MS = 30 * 86400000, SUB_MIN_EMPY = 10, SUB_MAX_EMPY = 100000;
const SUB_FEE_PCT = Math.min(50, Math.max(0, Number(process.env.SUB_PLATFORM_FEE_PCT) || 0));
function _subNet(price) { return _adsRound(price * (1 - SUB_FEE_PCT / 100)); }

app.post('/api/subs/plan', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;
    if (decoded.firebase && decoded.firebase.sign_in_provider === 'anonymous') return res.status(403).json({ error: 'Create an account first.' });
    const price = Math.floor(Number(req.body && req.body.priceEmpy)), perks = String((req.body && req.body.perks) || '').trim().slice(0, 300), active = !(req.body && req.body.active === false);
    if (!(price >= SUB_MIN_EMPY && price <= SUB_MAX_EMPY)) return res.status(400).json({ error: 'Price must be between ' + SUB_MIN_EMPY + ' and ' + SUB_MAX_EMPY + ' EMPY per month.' });
    try {
        const db = admin.firestore(), u = await db.collection('users').doc(decoded.uid).get(), ud = u.exists ? u.data() : {};
        if (!ud.isVerified) return res.status(403).json({ error: 'Verify your account (KYC) before offering paid subscriptions.' });
        await db.collection('creator_subscription_plans').doc(decoded.uid).set({ creatorId: decoded.uid, creatorName: ud.fullName || ud.username || '', priceEmpy: price, perks, active, feePct: SUB_FEE_PCT, updatedAt: Date.now() }, { merge: true });
        res.json({ ok: true, priceEmpy: price, active, feePct: SUB_FEE_PCT });
    } catch (err) { res.status(500).json({ error: 'Could not save plan', detail: err.message }); }
});

app.post('/api/subs/subscribe', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;
    if (decoded.firebase && decoded.firebase.sign_in_provider === 'anonymous') return res.status(403).json({ error: 'Create an account to subscribe.' });
    const creatorId = String((req.body && req.body.creatorId) || ''), fanId = decoded.uid;
    if (!creatorId || creatorId === fanId) return res.status(400).json({ error: 'You cannot subscribe to yourself.' });
    try {
        const db = admin.firestore(), FV = admin.firestore.FieldValue;
        const planRef = db.collection('creator_subscription_plans').doc(creatorId), subRef = db.collection('creator_subscriptions').doc(creatorId + '_' + fanId);
        const fanRef = db.collection('users').doc(fanId), creRef = db.collection('users').doc(creatorId);
        const out = await db.runTransaction(async (tx) => {
            const [pl, sb, fan, cre] = await Promise.all([tx.get(planRef), tx.get(subRef), tx.get(fanRef), tx.get(creRef)]);
            if (!pl.exists || !pl.data().active) return { code: 404, body: { error: 'This creator is not offering subscriptions right now.' } };
            if (!fan.exists || !cre.exists) return { code: 404, body: { error: 'Account not found.' } };
            const now = Date.now(), s0 = sb.exists ? sb.data() : null, price = pl.data().priceEmpy, fd = fan.data() || {};
            if (s0 && s0.status === 'active' && s0.renewsAt > now && !s0.cancelAtPeriodEnd) return { code: 409, body: { error: 'You are already subscribed.' } };
            if (s0 && s0.status === 'active' && s0.renewsAt > now && s0.cancelAtPeriodEnd) { tx.update(subRef, { cancelAtPeriodEnd: false }); return { code: 200, body: { ok: true, resumed: true } }; }
            if (Number(fd.empyBalance || 0) < price) return { code: 402, body: { error: 'Not enough EMPY. This subscription costs ' + price + ' EMPY per 30 days.' } };
            const net = _subNet(price);
            tx.update(fanRef, { empyBalance: FV.increment(-price) });
            tx.update(creRef, { giftTokenBalance: FV.increment(net) });
            tx.set(subRef, { creatorId, subscriberId: fanId, subscriberName: fd.fullName || fd.username || 'Member', priceEmpy: price, feePct: SUB_FEE_PCT, status: 'active', startedAt: s0 ? (s0.startedAt || now) : now,
                renewsAt: now + SUB_PERIOD_MS, cancelAtPeriodEnd: false, periodsPaid: (s0 ? s0.periodsPaid || 0 : 0) + 1, totalPaid: _adsRound((s0 ? s0.totalPaid || 0 : 0) + price), totalNet: _adsRound((s0 ? s0.totalNet || 0 : 0) + net), updatedAt: now });
            tx.set(db.collection('transactions').doc(), { userId: fanId, type: 'creator_subscription', creatorId, amount: price, status: 'completed', createdAt: FV.serverTimestamp() });
            tx.set(db.collection('transactions').doc(), { userId: creatorId, type: 'creator_subscription_income', subscriberId: fanId, amount: net, status: 'completed', createdAt: FV.serverTimestamp() });
            return { code: 200, body: { ok: true, priceEmpy: price, renewsAt: now + SUB_PERIOD_MS } };
        });
        res.status(out.code).json(out.body);
    } catch (err) { console.error('[Subs] subscribe failed:', err.message); res.status(500).json({ error: 'Could not subscribe', detail: err.message }); }
});

app.post('/api/subs/cancel', async (req, res) => {
    const admin = _getAdmin();
    if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)' });
    const decoded = await _requireAuthForAdRevenue(req, res, admin);
    if (!decoded) return;
    const creatorId = String((req.body && req.body.creatorId) || '');
    try {
        const ref = admin.firestore().collection('creator_subscriptions').doc(creatorId + '_' + decoded.uid), s = await ref.get();
        if (!s.exists || s.data().status !== 'active') return res.status(404).json({ error: 'No active subscription found.' });
        await ref.update({ cancelAtPeriodEnd: true, updatedAt: Date.now() });
        res.json({ ok: true, accessUntil: s.data().renewsAt });
    } catch (err) { res.status(500).json({ error: 'Could not cancel', detail: err.message }); }
});

async function _subsSweep() {
    const admin = _getAdmin(); if (!admin) return;
    try {
        const db = admin.firestore(), FV = admin.firestore.FieldValue, now = Date.now(); let renewed = 0, lapsed = 0;
        const snap = await db.collection('creator_subscriptions').where('status', '==', 'active').limit(300).get();
        for (const d of snap.docs) {
            const s0 = d.data() || {}; if (!s0.renewsAt || s0.renewsAt > now) continue;
            await db.runTransaction(async (tx) => {
                const sb = await tx.get(d.ref), s = sb.data(); if (!s || s.status !== 'active' || s.renewsAt > now) return;
                if (s.cancelAtPeriodEnd) { tx.update(d.ref, { status: 'cancelled', endedAt: now, updatedAt: now }); lapsed++; return; }
                const fanRef = db.collection('users').doc(s.subscriberId), creRef = db.collection('users').doc(s.creatorId), planRef = db.collection('creator_subscription_plans').doc(s.creatorId);
                const [fan, cre, pl] = await Promise.all([tx.get(fanRef), tx.get(creRef), tx.get(planRef)]);
                const price = s.priceEmpy;
                if (!fan.exists || !cre.exists || !pl.exists || !pl.data().active || Number((fan.data() || {}).empyBalance || 0) < price) { tx.update(d.ref, { status: 'expired', endedAt: now, updatedAt: now }); lapsed++; return; }
                const net = _subNet(price);
                tx.update(fanRef, { empyBalance: FV.increment(-price) }); tx.update(creRef, { giftTokenBalance: FV.increment(net) });
                tx.update(d.ref, { renewsAt: s.renewsAt + SUB_PERIOD_MS, periodsPaid: (s.periodsPaid || 0) + 1, totalPaid: _adsRound((s.totalPaid || 0) + price), totalNet: _adsRound((s.totalNet || 0) + net), updatedAt: now });
                tx.set(db.collection('transactions').doc(), { userId: s.subscriberId, type: 'creator_subscription', creatorId: s.creatorId, amount: price, renewal: true, status: 'completed', createdAt: FV.serverTimestamp() });
                tx.set(db.collection('transactions').doc(), { userId: s.creatorId, type: 'creator_subscription_income', subscriberId: s.subscriberId, amount: net, renewal: true, status: 'completed', createdAt: FV.serverTimestamp() });
                renewed++;
            });
        }
        if (renewed || lapsed) console.log('[Subs] sweep: renewed ' + renewed + ', ended ' + lapsed);
    } catch (err) { console.warn('[Subs] sweep failed:', err.message); }
}
setTimeout(function () { _subsSweep(); setInterval(_subsSweep, 600000); }, 60000);

// ============================ END ADS MANAGER BLOCK ===========================================

app.listen(PORT, () => {
    console.log(`✅ Empyrean server running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    // Start listening for new posts/SOS/crisis docs so pushes go out even
    // when no client has the app open — see the comment above
    // startServerNotifyListeners() for the full explanation.
    startServerNotifyListeners();
    // NEW (2026-10-04) — Facebook Page sync (admin posts -> Page, Page posts -> app feed)
    startFacebookSync();
    // NEW (2026-08-15) — server-side like/comment mining rewards. Separate
    // from startServerNotifyListeners() (different concern: crediting
    // EMPY, not sending pushes) but started from the same boot hook for
    // the same reason — see that function's own comment.
    startLikeCommentRewardListeners();
    _startFreeTierKeepAlive();
});