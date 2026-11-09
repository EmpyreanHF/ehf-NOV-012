/* =============================================================================
   EMPYREAN INTERNATIONAL — SERVER-SIDE VIDEO WATERMARK (backend)
   watermark-routes.js  |  Node/Express router. Mount in server.js.

   WHY THIS EXISTS
   The watermark feature already shipped this session (app-fixes.js's
   _canWatermarkVideo / _watermarkVideoBlob / _drawEmpyreanWatermark /
   _scheduleBrandJingle, called from app-reel.js and app-video-fullscreen.js)
   is 100% client-side: canvas.captureStream() + MediaRecorder, entirely in
   the visitor's browser. That's real and stays in place as the fallback —
   see FALLBACK BEHAVIOR below. This file adds the SERVER-side counterpart
   asked for directly: a real .mp4 (not .webm), produced consistently
   regardless of the visitor's browser/device, via ffmpeg.

   This is the ONLY server-side piece of the watermark feature. It does not
   replace app-fixes.js's client engine — see the client integration note
   at the bottom of this file for how the two are meant to compose.

   ═══════════════════════════════════════════════════════════════════════
   WHAT IT DOES
   ═══════════════════════════════════════════════════════════════════════
   POST /api/watermark/video   { videoUrl, posterUsername }  (Bearer token
                                required — any logged-in user, not admin-only;
                                downloading is a normal user action, not an
                                admin one, so this intentionally does NOT
                                reuse bulk-disburse-routes.js's ADMIN_EMAILS
                                gate — it uses the same "any authenticated
                                user" gate earnings-routes.js already uses
                                for its own non-admin routes.)
                                Streams back a real .mp4 with the Empyrean
                                watermark burned in: an animated logo mark
                                (entrance flourish, breathing pulse, corner-
                                hopping with a slide-in on each hop — same
                                choreography as the client canvas version),
                                the "Empyrean" wordmark in this app's exact
                                brand yellow (#FFD500, token.css), the
                                poster's @username, and the same synthesized
                                four-note rising chime (C5-E5-G5-C6) mixed
                                into the audio track, ducking the original
                                audio under it exactly like the client
                                version does. A silent source video still
                                gets the chime — same "always play" choice
                                the client engine already made.

   GET  /api/watermark/health  No auth. Reports whether ffmpeg/ffprobe and
                                the logo asset are actually available on
                                this deployment, so the client can decide
                                whether to attempt the server path at all
                                instead of discovering it 500s per download.

   ═══════════════════════════════════════════════════════════════════════
   WHAT IT DELIBERATELY DOES NOT DO (documented tradeoffs, not oversights)
   ═══════════════════════════════════════════════════════════════════════
   - No per-frame text shimmer sweep (the client canvas version's shimmer-
     on-the-wordmark flourish). ffmpeg's drawtext has no clean equivalent
     without a much heavier filter graph (per-pixel gradient masking), and
     it's a small enough visual detail that it isn't worth the extra
     processing cost/fragility on every download. Logo entrance, breathing
     pulse, and corner-hop-with-slide-in — the three flourishes that
     actually read as "this app has an identity" — are all present.
   - The chime's "triangle overtone" partial is approximated with a second
     sine wave an octave up (ffmpeg's `sine` source filter only produces
     sine waves; there's no built-in triangle-wave audio source). Still a
     bright bell-like four-note arpeggio, just not bit-identical to the
     Web Audio version's timbre.
   - Only Cloudinary / Firebase Storage / Google Cloud Storage source URLs
     are accepted (ALLOWED_HOSTS below) — this endpoint fetches a URL on
     the server's behalf, so an open host allowlist would be a server-side
     request forgery (SSRF) hole. Every media URL this app actually
     produces already lives on one of those three hosts (see
     migrate-once.js's own CLOUDINARY_URL_RE and the Firebase Storage URLs
     server.js already builds elsewhere) — nothing legitimate is excluded.
   - Duration/size caps (MAX_DURATION_S / MAX_DOWNLOAD_BYTES below) exist
     because this runs on the same single Render dyno as the rest of the
     app (render.yaml — one `starter` web service, no separate worker).
     ffmpeg's libx264 encode is CPU-bound; an uncapped job could starve
     that dyno for every other request. A concurrency gate
     (MAX_CONCURRENT_JOBS) backs this up so at most a couple of encodes
     ever run at once, returning 429 rather than queuing indefinitely.
   - Single-request/response, not a job+poll pattern like bulk-disburse's
     upload/execute/status/failed-csv flow. Reels and feed videos are
     short-form by design (MAX_DURATION_S below is generous for that), so
     a synchronous response is simpler and the job-store machinery
     bulk-disburse-routes.js needed for genuinely long-running batches
     isn't warranted here. If this is ever pointed at long-form video, this
     is the piece to revisit first — see FALLBACK BEHAVIOR just below for
     what happens today when a video is too long.

   ═══════════════════════════════════════════════════════════════════════
   FALLBACK BEHAVIOR (why this can be added without risking any download)
   ═══════════════════════════════════════════════════════════════════════
   Every failure mode here (ffmpeg/logo missing, source video too long/
   large, download failed, encode error, server at its concurrency cap)
   responds with a normal JSON error and a 4xx/5xx status — it never hangs
   and never partially streams a broken file (headers aren't sent until
   ffmpeg has already produced real output). The intended client wiring
   (see the note at the very bottom of this file) is: try this endpoint
   first; on ANY failure, fall back to app-fixes.js's existing client-side
   _watermarkVideoBlob(); if THAT also fails, fall back to the plain
   un-watermarked download that already existed before any of this. A
   download must never be lost over a watermarking hiccup, same principle
   app-fixes.js's own comments already state for the client path.

   REQUIRES (see package.json diff shipped alongside this file):
     "ffmpeg-static": "^5.2.0",
     "ffprobe-static": "^3.1.0"
   Pure npm installs — static prebuilt binaries, no apt/system package step
   needed on Render, no API key, nothing in render.yaml to add.
   ============================================================================= */

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');
const { spawn } = require('child_process');

/* ---- locate the ffmpeg/ffprobe binaries + logo asset, once ---------------
   Wrapped in try/catch the same way every other optional feature in this
   codebase (ElevenLabs TTS, Agora Cloud Recording) checks its own
   dependency lazily rather than crashing the whole server if a package
   failed to install or an asset hasn't been deployed yet. */
let FFMPEG_PATH = null;
let FFPROBE_PATH = null;
try { FFMPEG_PATH = require('ffmpeg-static'); } catch (e) { /* not installed */ }
try { FFPROBE_PATH = require('ffprobe-static').path; } catch (e) { /* not installed */ }

// Same asset app-fixes.js's client watermark engine already uses
// (_getWatermarkLogoImg → '/app_icon_512_white.png'), so the server and
// client marks are drawn from the identical source image — same-origin
// static file under public/, deployed alongside icon-192.png/icon-512.png.
const LOGO_ASSET_PATH = path.join(__dirname, 'public', 'app_icon_512_white.png');

// Common Debian/Ubuntu bold sans-serif font paths — Render's Node
// buildpack image is Debian-based and typically ships DejaVu or Liberation
// fonts. First one found wins; if NONE are found, the watermark still
// renders (logo + chime), just without the "Empyrean"/@username text —
// documented in _buildFilterGraph below. ffmpeg-static's binaries are
// built without fontconfig, so a `fontfile=` path is required either way;
// there's no "just use the system default" option here.
const FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'
];
let FONT_PATH = null;
for (const c of FONT_CANDIDATES) { if (fs.existsSync(c)) { FONT_PATH = c; break; } }

function watermarkAvailable() {
    return !!(FFMPEG_PATH && FFPROBE_PATH && fs.existsSync(LOGO_ASSET_PATH));
}

/* ---- limits ----------------------------------------------------------- */

const ALLOWED_HOSTS = new Set([
    'res.cloudinary.com',
    'firebasestorage.googleapis.com',
    'storage.googleapis.com'
]);
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;  // 200MB source cap
const MAX_DURATION_S     = 240;                // 4 min source cap
const DOWNLOAD_TIMEOUT_MS = 60 * 1000;
const FFMPEG_TIMEOUT_MS   = 5 * 60 * 1000;      // hard kill switch — never hang a worker forever
const MAX_CONCURRENT_JOBS = 2;                  // shared single Render dyno — see header note
let _activeJobs = 0;

/* ---- brand constants (mirrors _drawEmpyreanWatermark / _scheduleBrandJingle
   in app-fixes.js — see that file for the values these were copied from) --- */

const BRAND_YELLOW = '0xFFD500';
const CHIME_NOTES  = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
const CHIME_NOTE_GAP = 0.16;
const CHIME_NOTE_LEN = 0.42;
const CHIME_START_S  = 0.05; // small lead-in, mirrors the client's `currentTime + 0.03`
const ENTRANCE_FADE_S = 0.54; // client: min(1, entranceP/0.6) with entranceP over 0.9s ≈ 0.54s to full alpha
const CORNER_HOLD_S  = 5;
const SLIDE_IN_S     = 0.5;
const BREATHE_PERIOD_S = 2.4;
const BREATHE_AMPL     = 0.035;
const EASE_C1 = 1.70158, EASE_C3 = 2.70158; // easeOutBack constants, same as _easeOutBack in app-fixes.js

/* ---- small helpers ------------------------------------------------------ */

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _tmpPath(ext) {
    return path.join(os.tmpdir(), 'emp-wm-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
}

async function _cleanup(paths) {
    for (const p of paths) {
        try { if (p && fs.existsSync(p)) await fs.promises.unlink(p); } catch (e) { /* best-effort */ }
    }
}

// Sanitizes the poster username down to a safe, small charset. Two
// reasons, not one: (1) this string gets concatenated directly into an
// ffmpeg filtergraph string below — an unsanitized value containing `:`,
// `'`, `,`, `[`, `]`, or `\` could corrupt or, worse, manipulate the
// filtergraph; (2) it mirrors the client engine's own 22-char truncation
// (_wmUname.length > 22 → slice + ellipsis) so a name that's fine on the
// client doesn't suddenly look different from the server. Anything
// outside [A-Za-z0-9_.] is dropped rather than escaped — simpler and
// closes the injection surface completely instead of trying to enumerate
// every character ffmpeg's filtergraph parser treats specially.
function _sanitizeUsername(raw) {
    let s = String(raw || '').replace(/^@/, '').replace(/[^A-Za-z0-9_.]/g, '');
    if (s.length > 21) s = s.slice(0, 21) + '\u2026';
    return s;
}

function _isAllowedMediaUrl(u) {
    try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'https:') return false;
        return ALLOWED_HOSTS.has(parsed.hostname);
    } catch (e) {
        return false;
    }
}

/* ---- step 1: download the source video, with a hard byte cap enforced
   while streaming (not just trusting a Content-Length header, which can
   be absent or wrong) ------------------------------------------------- */

async function _downloadCapped(url, destPath) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let resp;
    try {
        resp = await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!resp.ok) throw new Error('source fetch failed: HTTP ' + resp.status);
    const declared = Number(resp.headers.get('content-length') || 0);
    if (declared && declared > MAX_DOWNLOAD_BYTES) {
        throw new Error('source video exceeds the ' + Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024) + 'MB limit');
    }
    if (!resp.body) throw new Error('source fetch returned no body');

    const writeStream = fs.createWriteStream(destPath);
    const reader = resp.body.getReader();
    let received = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_DOWNLOAD_BYTES) {
                throw new Error('source video exceeds the ' + Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024) + 'MB limit (stopped mid-download)');
            }
            await new Promise((resolve, reject) => {
                writeStream.write(Buffer.from(value), (err) => err ? reject(err) : resolve());
            });
        }
    } finally {
        await new Promise((resolve) => writeStream.end(resolve));
    }
}

/* ---- step 2: probe the downloaded file for duration/dimensions/audio --- */

function _runCapture(bin, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args);
        let stdout = '', stderr = '';
        const killer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} reject(new Error('process timed out')); }, timeoutMs);
        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('error', (err) => { clearTimeout(killer); reject(err); });
        proc.on('close', (code) => {
            clearTimeout(killer);
            if (code !== 0) { reject(new Error((stderr || ('exit code ' + code)).slice(-2000))); return; }
            resolve({ stdout, stderr });
        });
    });
}

async function _probeVideo(filePath) {
    const { stdout } = await _runCapture(FFPROBE_PATH, [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
    ], 20000);
    const data = JSON.parse(stdout);
    const vStream = (data.streams || []).find(s => s.codec_type === 'video');
    const aStream = (data.streams || []).find(s => s.codec_type === 'audio');
    if (!vStream) throw new Error('no video stream found in source file');
    const duration = Number((data.format && data.format.duration) || vStream.duration || 0);
    return {
        width: Number(vStream.width) || 0,
        height: Number(vStream.height) || 0,
        duration: duration,
        hasAudio: !!aStream
    };
}

/* ---- step 3: build the ffmpeg filtergraph -------------------------------
   All size-dependent numbers below are baked in as concrete pixel values
   from the ffprobe result (width/height), rather than left as ffmpeg
   runtime expressions referencing main_w/main_h/overlay_w/overlay_h — this
   keeps every expression a function of `t` only, which is far less prone
   to the kind of filtergraph-variable-scoping mistakes that are easy to
   make (and hard to debug) once scale2ref / chained scale filters are
   involved. Position math mirrors _drawEmpyreanWatermark's corner-hop +
   slide-in exactly; see that function in app-fixes.js for the values these
   constants and formulas were copied from. ------------------------------- */

function _buildFilterGraph({ width, height, hasAudio, posterUsername }) {
    const pad   = Math.max(16, width * 0.02);
    const logoR = Math.max(17, height * 0.036);
    const logoD = Math.round(logoR * 2);
    const textGap = logoR * 1.55;
    const nameFontPx = Math.max(10, Math.round(logoR * 1.2));
    const unameFontPx = Math.max(8, Math.round(logoR * 0.76));

    // mod(t,20) has 4 five-second segments in CORNER order
    // [bottom-left, bottom-right, top-right, top-left] — identical order
    // to the client's own CORNERS array.
    const CYC = 'mod(t,20)';
    const CT5 = 'mod(t,5)';
    const slideP = `if(lt(${CYC},5),1,min(1,${CT5}/${SLIDE_IN_S}))`;
    const ease = `(1-pow(1-(${slideP}),3))`;
    const slideDist = `(${logoD}*3*(1-(${ease})))`;

    const xBL = `(${pad})`;
    const xRight = `(${width}-${pad}-${logoD})`;
    const yBottom = `(${height}-${pad}-${logoD})`;
    const yTop = `(${pad})`;

    const xExpr = `if(lt(${CYC},5),${xBL}-${slideDist},if(lt(${CYC},10),${xRight}+${slideDist},if(lt(${CYC},15),${xRight}+${slideDist},${xBL}-${slideDist})))`;
    const yExpr = `if(lt(${CYC},5),${yBottom},if(lt(${CYC},10),${yBottom},if(lt(${CYC},15),${yTop},${yTop})))`;
    const isRightExpr = `if(lt(${CYC},5),0,if(lt(${CYC},10),1,if(lt(${CYC},15),1,0)))`;

    const centerX = `(${xExpr}+${logoD}/2)`;
    const centerY = `(${yExpr}+${logoD}/2)`;
    const nameY = `(${centerY}-${(logoR * 0.30).toFixed(2)})`;
    const unameY = `(${centerY}+${(logoR * 0.62).toFixed(2)})`;
    // Right corners: text ENDS at (center - gap) — subtract the rendered
    // text width so it right-aligns instead of overrunning the frame edge.
    // Left corners: text STARTS at (center + gap).
    const textX = `if(${isRightExpr},(${centerX}-${textGap.toFixed(2)}-text_w),(${centerX}+${textGap.toFixed(2)}))`;

    // Entrance (easeOutBack over 0.9s, matching _easeOutBack/ENTRANCE_DUR)
    // settling into the continuous ±3.5% breathing pulse — same formula as
    // app-fixes.js's logoScale calculation, just written in ffmpeg's
    // expression syntax.
    const xN = `min(1,t/0.9)`;
    const easeOutBack = `(1+${EASE_C3}*pow((${xN})-1,3)+${EASE_C1}*pow((${xN})-1,2))`;
    const entranceScale = `(0.55+0.45*(${easeOutBack}))`;
    const breathe = `(1+${BREATHE_AMPL}*sin(t*2*PI/${BREATHE_PERIOD_S}))`;
    const sizeFactor = `if(lte(t,0.9),${entranceScale},${breathe})`;

    const videoParts = [];
    videoParts.push(
        `[1:v]scale=${logoD}:${logoD},format=rgba,fade=t=in:st=0:d=${ENTRANCE_FADE_S}:alpha=1,` +
        `scale=w='${logoD}*(${sizeFactor})':h='${logoD}*(${sizeFactor})':eval=frame[logo]`
    );
    videoParts.push(`[0:v][logo]overlay=x='${xExpr}':y='${yExpr}'[vlogo]`);

    let lastLabel = '[vlogo]';
    if (FONT_PATH) {
        const safeName = _sanitizeUsername(posterUsername);
        const unameText = safeName ? ('@' + safeName) : 'empyrean.app';
        videoParts.push(
            `${lastLabel}drawtext=fontfile='${FONT_PATH}':text='Empyrean':fontsize=${nameFontPx}:` +
            `fontcolor=${BRAND_YELLOW}:x='${textX}':y='${nameY}':alpha='min(1,t/${ENTRANCE_FADE_S})'[vtext1]`
        );
        videoParts.push(
            `[vtext1]drawtext=fontfile='${FONT_PATH}':text='${unameText}':fontsize=${unameFontPx}:` +
            `fontcolor=white@0.88:x='${textX}':y='${unameY}':alpha='min(1,t/${ENTRANCE_FADE_S})'[vout]`
        );
        lastLabel = '[vout]';
    } else {
        // No usable font found on this deployment — ship the logo + chime
        // without text rather than failing the whole watermark. Rename the
        // overlay output to the label the -map call always expects.
        videoParts.push(`${lastLabel}null[vout]`);
        lastLabel = '[vout]';
    }

    // ── audio: synthesized chime, ducking the original track (if any) ──
    const audioParts = [];
    const chimeLabels = [];
    CHIME_NOTES.forEach((freq, noteIdx) => {
        const t0 = CHIME_START_S + noteIdx * CHIME_NOTE_GAP;
        const ms = Math.round(t0 * 1000);
        [{ mult: 1, gain: 0.16 }, { mult: 2, gain: 0.05 }].forEach((partial, pIdx) => {
            const label = `n${noteIdx}p${pIdx}`;
            const freqHz = (freq * partial.mult).toFixed(2);
            const fadeOutStart = Math.max(0.02, CHIME_NOTE_LEN - 0.06);
            audioParts.push(
                `sine=frequency=${freqHz}:duration=${CHIME_NOTE_LEN}:sample_rate=44100,` +
                `aformat=channel_layouts=stereo,` +
                `afade=t=in:st=0:d=0.012,` +
                `afade=t=out:st=${fadeOutStart}:d=0.06:curve=exp,` +
                `volume=${partial.gain},` +
                `adelay=${ms}|${ms}[${label}]`
            );
            chimeLabels.push(`[${label}]`);
        });
    });

    let aOutLabel;
    if (hasAudio) {
        // Duck the original content to 35% for the chime's ~1s, then it's
        // back to full — same shape as the client's contentGain ramps in
        // _watermarkVideoBlob (1 → 0.35 → back to 1 across ~jingleStart to
        // +1.05s).
        audioParts.push(`[0:a]volume=eval=frame:volume='if(between(t,0,1.05),0.35,1)'[duck]`);
        const mixInputs = ['[duck]'].concat(chimeLabels);
        audioParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first,volume=${mixInputs.length}[aout]`);
        aOutLabel = '[aout]';
    } else {
        // Silent source — chime still plays (the client engine's own
        // "plays regardless" choice, mirrored here).
        audioParts.push(`${chimeLabels.join('')}amix=inputs=${chimeLabels.length}:duration=longest,volume=${chimeLabels.length}[aout]`);
        aOutLabel = '[aout]';
    }

    const filterComplex = videoParts.concat(audioParts).join(';');
    return { filterComplex, vMap: lastLabel, aMap: aOutLabel };
}

/* ---- step 4: run ffmpeg -------------------------------------------------- */

function _runFfmpeg(args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const proc = spawn(FFMPEG_PATH, args);
        let stderrTail = '';
        const killer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (e) {}
            reject(new Error('encode timed out after ' + Math.round(timeoutMs / 1000) + 's'));
        }, timeoutMs);
        proc.stderr.on('data', (d) => {
            stderrTail = (stderrTail + d.toString()).slice(-4000); // keep last chunk only, for error messages
        });
        proc.on('error', (err) => { clearTimeout(killer); reject(err); });
        proc.on('close', (code) => {
            clearTimeout(killer);
            if (code !== 0) { reject(new Error('ffmpeg exited ' + code + ': ' + stderrTail.slice(-500))); return; }
            resolve();
        });
    });
}

async function _watermarkToFile(inputPath, outputPath, probe, posterUsername) {
    const { filterComplex, vMap, aMap } = _buildFilterGraph({
        width: probe.width,
        height: probe.height,
        hasAudio: probe.hasAudio,
        posterUsername
    });

    const args = [
        '-y',
        '-i', inputPath,
        '-loop', '1', '-i', LOGO_ASSET_PATH,
        '-filter_complex', filterComplex,
        '-map', vMap,
        '-map', aMap,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        '-shortest',
        outputPath
    ];
    await _runFfmpeg(args, FFMPEG_TIMEOUT_MS);
}

/* ---- auth: any authenticated user (mirrors earnings-routes.js's
   _requireAuthedUid — this is a normal user action, not an admin one) --- */

async function _requireAuthedUid(req, res, getAdmin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
    const admin = getAdmin();
    if (!admin) { res.status(500).json({ error: 'Firebase Admin not configured on server' }); return null; }
    try {
        return await admin.auth().verifyIdToken(m[1]);
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

/* ---- router --------------------------------------------------------------
   Exported as a factory so server.js can hand it the same lazy Firebase
   Admin getter every other route file here already uses (see
   bulk-disburse-routes.js / earnings-routes.js's own identical pattern),
   instead of this file initializing a second Admin SDK instance.
   ============================================================================= */

module.exports = function createWatermarkRouter(getAdmin) {
    const router = express.Router();

    router.get('/health', (req, res) => {
        res.json({
            available: watermarkAvailable(),
            hasFfmpeg: !!FFMPEG_PATH,
            hasFfprobe: !!FFPROBE_PATH,
            hasLogo: fs.existsSync(LOGO_ASSET_PATH),
            hasFont: !!FONT_PATH, // false just means text is skipped, logo+chime still work
            maxDurationSeconds: MAX_DURATION_S,
            maxSourceMB: Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)
        });
    });

    router.post('/video', async (req, res) => {
        const decoded = await _requireAuthedUid(req, res, getAdmin);
        if (!decoded) return;

        if (!watermarkAvailable()) {
            return res.status(503).json({ error: 'Server-side watermarking is not available on this deployment (missing ffmpeg or the logo asset).' });
        }

        const { videoUrl, posterUsername } = req.body || {};
        if (!videoUrl || typeof videoUrl !== 'string') {
            return res.status(400).json({ error: 'videoUrl is required' });
        }
        if (!_isAllowedMediaUrl(videoUrl)) {
            return res.status(400).json({ error: 'videoUrl must be an https URL from Cloudinary or Firebase/Google Cloud Storage' });
        }

        if (_activeJobs >= MAX_CONCURRENT_JOBS) {
            return res.status(429).json({ error: 'Server is busy watermarking other downloads right now — please try again in a moment.' });
        }
        _activeJobs++;

        const inputPath = _tmpPath('.src');
        const outputPath = _tmpPath('.mp4');

        try {
            await _downloadCapped(videoUrl, inputPath);

            const probe = await _probeVideo(inputPath);
            if (probe.duration > MAX_DURATION_S) {
                return res.status(413).json({ error: 'Video is longer than the ' + MAX_DURATION_S + 's server-watermark limit.' });
            }
            if (!probe.width || !probe.height) {
                return res.status(422).json({ error: 'Could not read video dimensions from the source file.' });
            }

            await _watermarkToFile(inputPath, outputPath, probe, posterUsername);

            const stat = await fs.promises.stat(outputPath);
            const safeName = _sanitizeUsername(posterUsername) || 'empyrean';
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', stat.size);
            res.setHeader('Content-Disposition', 'attachment; filename="' + safeName + '-empyrean.mp4"');

            const readStream = fs.createReadStream(outputPath);
            readStream.on('error', () => { try { res.end(); } catch (e) {} });
            readStream.pipe(res);
            res.on('close', () => { _cleanup([inputPath, outputPath]); });
            res.on('finish', () => { _cleanup([inputPath, outputPath]); });
            return; // cleanup happens on stream end above, not in finally

        } catch (err) {
            console.error('[Watermark] job failed:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Watermarking failed: ' + err.message });
            }
            await _cleanup([inputPath, outputPath]);
        } finally {
            _activeJobs--;
        }
    });

    return router;
};

/* =============================================================================
   SERVER.JS INTEGRATION (paste both lines near the existing bulk-disburse /
   earnings mount points — server.js ~line 3784-3793):

       const createWatermarkRouter = require('./watermark-routes');
       app.use('/api/watermark', createWatermarkRouter(_getAdmin));

   _getAdmin is the same lazy Firebase Admin getter already defined in
   server.js (~line 4765) and already passed to bulk-disburse-routes.js /
   earnings-routes.js above it — nothing new to configure.

   PACKAGE.JSON: add "ffmpeg-static": "^5.2.0" and "ffprobe-static": "^3.1.0"
   to dependencies (see the package.json shipped alongside this file).

   ═══════════════════════════════════════════════════════════════════════
   CLIENT INTEGRATION (not part of this file — flagging where it plugs in)
   ═══════════════════════════════════════════════════════════════════════
   app-reel.js and app-video-fullscreen.js currently call straight into
   app-fixes.js's client engine (window._canWatermarkVideo /
   window._watermarkVideoBlob). To prefer this server endpoint (real .mp4,
   consistent across browsers) with the existing client engine as a
   fallback — never a regression, per FALLBACK BEHAVIOR above — a small
   additive patch file (in this codebase's own convention: a new
   app-patch-vNN.js, never editing app-reel.js/app-video-fullscreen.js
   directly) should:
     1. On load, GET /api/watermark/health once and cache the result.
     2. Expose window._watermarkVideoServer(blob, videoUrl, posterUsername)
        that POSTs to /api/watermark/video with the SAME Authorization
        bearer pattern app-bulk-disburse.js's _authedFetch already
        demonstrates, and resolves with the returned .mp4 Blob.
     3. In app-reel.js / app-video-fullscreen.js's download handlers,
        try the server path first when the health check reported
        available:true; on any rejection (network error, 413/429/503/500),
        fall through to the existing window._watermarkVideoBlob() call
        exactly as already wired; on ITS failure, fall through to the
        existing plain-download path exactly as already wired. No existing
        fallback branch needs to change — this only adds one new branch
        ahead of the two that already exist.
   Said explicitly rather than built here because "build the server
   backend side" was the request this session — this note exists so the
   next patch that wires the client up isn't guessing at the contract.
   ============================================================================= */