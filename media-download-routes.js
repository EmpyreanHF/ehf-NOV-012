/* =============================================================================
   EMPYREAN INTERNATIONAL — MEDIA DOWNLOAD PROXY
   media-download-routes.js  |  Node/Express router. Mount in server.js.

   WHY THIS EXISTS
   ────────────────────────────────────────────────────────────────────────
   "Download" buttons across the app (reels, feed/news/marketplace posts,
   the fullscreen video viewer) work by fetching the media as a Blob in the
   browser (window._fetchWithProgress, app-fixes.js) and then either
   watermarking it or saving it directly via a same-origin blob: URL. That
   requires the browser to be allowed to READ the response bytes, which
   means the source host has to send CORS headers permitting this app's
   origin.

   Cloudinary (this app's original media host) sends permissive CORS
   headers on every delivery URL by default — that's why downloads worked
   before. Firebase Storage / Google Cloud Storage (the host this app
   migrated media uploads to — see media-uploads.md / migrate-once.js) do
   NOT send CORS headers unless a bucket owner explicitly runs
   `gsutil cors set cors.json gs://<bucket>` — a one-time infrastructure
   step outside this codebase, not something any amount of app code can
   configure from here. Until/unless that's done, EVERY browser-side fetch
   of a Firebase Storage media URL from this app's origin fails with a CORS
   error — which is exactly what was happening: the primary fetch+blob
   path silently failed, and the old last-resort fallback
   (_cloudinaryAttachmentUrl in app-fixes.js) only knew how to force a real
   attachment download for Cloudinary URLs, so anything else fell through
   to `target="_blank"` — a new tab that just plays the video instead of
   saving it.

   THE FIX: this route fetches the source media SERVER-SIDE (a plain
   Node-to-GCS/Cloudinary HTTP request — CORS is a BROWSER enforcement
   mechanism, it does not apply to server-to-server requests at all) and
   streams the bytes straight back to the browser with a real
   `Content-Disposition: attachment` header. From the browser's point of
   view this URL is same-origin (it's this app's own server), so it can
   always read the response and the `download` attribute / native
   save-file behavior always works — independent of whatever CORS policy
   the actual storage bucket does or doesn't have configured. This makes
   downloads work regardless of storage host, and stops depending on
   infrastructure this codebase can't control.

   GET /api/media/download?url=<encoded source URL>&filename=<save-as name>
     No auth required — this proxies media that's already directly,
     publicly linkable (the exact same URL the app already puts in
     <img>/<video> src attributes); it grants no access beyond what the
     source URL itself already grants. Same posture as the plain-download
     path this replaces, which also never required a token.

   SSRF NOTE: `url` is only ever fetched if its hostname is on
   ALLOWED_HOSTS below — the same three hosts every media URL this app
   actually produces already lives on (see watermark-routes.js's own
   identical allowlist and comment). An open host allowlist here would let
   this route be used to fetch arbitrary internal/external URLs on the
   server's behalf; restricting it to hosts this app itself uploads to
   closes that off without excluding anything legitimate.
   ============================================================================= */

'use strict';

const express = require('express');
const crypto = require('crypto');

const ALLOWED_HOSTS = new Set([
    'res.cloudinary.com',
    'firebasestorage.googleapis.com',
    'storage.googleapis.com'
]);

const MAX_BYTES = 300 * 1024 * 1024;      // 300MB — generous for a reel/short video or a full-res image
const FETCH_TIMEOUT_MS = 60 * 1000;

function _isAllowedUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.protocol !== 'https:') return false;
        return ALLOWED_HOSTS.has(u.hostname);
    } catch (e) {
        return false;
    }
}

// Strips anything that isn't safe inside a Content-Disposition filename
// param (CRLF header-injection guard first and foremost, then just a
// conservative safe charset — this only affects the suggested save-as
// name, never the actual bytes served).
function _sanitizeFilename(raw, fallbackExt) {
    let s = String(raw || '').replace(/[\r\n"]/g, '').trim();
    s = s.replace(/[^A-Za-z0-9 ._\-@]/g, '');
    if (!s) s = 'empyrean-download' + (fallbackExt || '');
    if (s.length > 150) s = s.slice(0, 150);
    return s;
}

function _extFromContentType(ct) {
    const map = {
        'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'
    };
    return map[(ct || '').split(';')[0].trim()] || '';
}

// ── Admin-only media deletion (child-safety content removal) ───────────────
// Same admin-identity check firebase-rules.js's isAdmin() trusts and
// bulk-disburse-routes.js's own _requireAdmin() already uses — mirrored
// here (not imported) since these are separate router modules with no
// shared middleware file; keeping the two checks in lockstep is a
// deliberate convention already established by bulk-disburse-routes.js's
// own comment on this exact duplication.
const ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];

async function _requireAdmin(req, res, getAdmin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }

    const admin = getAdmin();
    if (!admin) { res.status(500).json({ error: 'Firebase Admin not configured on server (FIREBASE_SERVICE_ACCOUNT_JSON missing)' }); return null; }

    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        const isAdmin = decoded.admin === true || ADMIN_EMAILS.includes(decoded.email);
        if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

// BUG FIX (2026-09-03 — "media upload in marketplace section doesn't
// delete completely when a delete button is clicked"): traced to
// app-marketplace.js's delete-listing handler, which only ever ran
// `marketplace_listings/{id}.delete()` — the Firestore doc — and never
// called this file's own /purge route for the listing's uploaded
// photos/videos/documents, because /purge was (correctly, for its
// original child-safety-takedown purpose) admin-only, and a normal
// seller deleting their own listing isn't an admin. Cloudinary deletion
// needs a signed Admin-API call this app's secret is only ever known to
// the server for, and Firebase Storage deletion needs the Admin SDK —
// neither can be done directly from the browser, so there was no way for
// a seller's own delete to reach the actual files at all. Rather than
// duplicate _deleteCloudinaryAsset/_deleteFirebaseStorageAsset in a
// second route, /purge below now also accepts a non-admin caller who
// owns the specific listing being purged — see _verifyToken +
// _ownListingUrls, used only by /purge; _requireAdmin above is untouched
// and still fully admin-only for its existing app-admin.js callers.

// Same token check as _requireAdmin, but does not reject a non-admin
// caller outright — the caller's own admin status is left on the
// decoded token (._isAdmin) for the route to branch on.
async function _verifyToken(req, res, getAdmin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }

    const admin = getAdmin();
    if (!admin) { res.status(500).json({ error: 'Firebase Admin not configured on server (FIREBASE_SERVICE_ACCOUNT_JSON missing)' }); return null; }

    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        decoded._isAdmin = decoded.admin === true || ADMIN_EMAILS.includes(decoded.email);
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

// Narrows a purge request's URLs down to only the ones that actually
// belong to a marketplace listing the caller (decoded.uid) themself owns
// (sellerId match) — so a non-admin can never use /purge to delete media
// from anyone else's content, or anything not part of that one listing.
// Returns the narrowed array, or null if unauthorized/no match (an error
// response has already been sent in that case).
async function _ownListingUrls(req, res, getAdmin, decoded, requestedUrls) {
    const listingId = req.body && req.body.listingId;
    if (!listingId || typeof listingId !== 'string') {
        res.status(403).json({ error: 'Admin access required' });
        return null;
    }
    const admin = getAdmin();
    let listingSnap;
    try {
        listingSnap = await admin.firestore().collection('marketplace_listings').doc(listingId).get();
    } catch (err) {
        res.status(500).json({ error: 'Could not verify listing ownership: ' + err.message });
        return null;
    }
    if (!listingSnap.exists || listingSnap.data().sellerId !== decoded.uid) {
        res.status(403).json({ error: 'You can only delete media from your own listings' });
        return null;
    }
    const listing = listingSnap.data() || {};
    const owned = new Set(
        [].concat(
            listing.media || [],
            (listing.documents || []).map((d) => d && d.url).filter(Boolean)
        )
    );
    const narrowed = requestedUrls.filter((u) => owned.has(u));
    if (!narrowed.length) {
        res.status(403).json({ error: 'None of the given URLs belong to your own listing' });
        return null;
    }
    return narrowed;
}

// Parses a Cloudinary delivery URL into what the Admin API's destroy
// endpoint needs: resource_type (image/video/raw) + public_id (no version
// prefix, no file extension).
function _cloudinaryPublicId(url) {
    const m = /^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\/(?:[a-z0-9_,]+\/)*(?:v\d+\/)?([^?]+)$/i.exec(url);
    if (!m) return null;
    return { resourceType: m[1], publicId: m[2].replace(/\.[a-zA-Z0-9]+$/, '') };
}

// Deletes one Cloudinary asset via the signed Admin API (Cloudinary has no
// unsigned-delete option — CLOUDINARY_PRESET/CLOUDINARY_CLOUD, already
// configured for uploads, are NOT enough on their own). Requires
// CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (the secret is already in
// render.yaml for other purposes; API_KEY needs adding — see this file's
// own header comment / the accompanying render.yaml diff). Skips cleanly
// (does not throw) when those aren't configured, so a deployment that
// hasn't added the key yet still deletes the Firestore doc + any
// Firebase-Storage-hosted media, it just can't reach back to old
// Cloudinary-hosted assets until the key is added.
async function _deleteCloudinaryAsset(url) {
    if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_CLOUD) {
        return { url, deleted: false, reason: 'CLOUDINARY_API_KEY not configured on server — this asset was left in place' };
    }
    const parsed = _cloudinaryPublicId(url);
    if (!parsed) return { url, deleted: false, reason: 'could not parse a Cloudinary public_id from this URL' };

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1')
        .update('public_id=' + parsed.publicId + '&timestamp=' + timestamp + process.env.CLOUDINARY_API_SECRET)
        .digest('hex');

    try {
        const resp = await fetch(
            'https://api.cloudinary.com/v1_1/' + process.env.CLOUDINARY_CLOUD + '/' + parsed.resourceType + '/destroy',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    public_id: parsed.publicId,
                    timestamp: String(timestamp),
                    api_key: process.env.CLOUDINARY_API_KEY,
                    signature
                })
            }
        );
        const data = await resp.json().catch(() => ({}));
        // Cloudinary reports 'not found' (already gone) as a normal result,
        // not an error — treated as success so a re-run/duplicate purge
        // request isn't reported as a failure.
        const ok = resp.ok && (data.result === 'ok' || data.result === 'not found');
        return { url, deleted: ok, reason: ok ? undefined : ('Cloudinary: ' + (data.result || 'destroy failed')) };
    } catch (err) {
        return { url, deleted: false, reason: err.message };
    }
}

// Deletes one Firebase Storage / Google Cloud Storage object, parsing
// whichever of the two public URL shapes this app actually produces
// (see migrate-once.js's own _migrateOneCloudinaryUrl for the
// firebasestorage.googleapis.com shape it writes).
async function _deleteFirebaseStorageAsset(url, admin) {
    let bucketName, objectPath;
    let m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/.exec(url);
    if (m) { bucketName = m[1]; objectPath = decodeURIComponent(m[2]); }
    else {
        m = /^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/.exec(url);
        if (m) { bucketName = m[1]; objectPath = decodeURIComponent(m[2].split('?')[0]); }
    }
    if (!bucketName || !objectPath) return { url, deleted: false, reason: 'could not parse a Storage object path from this URL' };

    try {
        // ignoreNotFound so re-running a purge (or a URL that's already been
        // cleaned up) reports success rather than a spurious failure.
        await admin.storage().bucket(bucketName).file(objectPath).delete({ ignoreNotFound: true });
        return { url, deleted: true };
    } catch (err) {
        return { url, deleted: false, reason: err.message };
    }
}

module.exports = function createMediaDownloadRouter(getAdmin) {
    const router = express.Router();

    router.get('/download', async (req, res) => {
        const rawUrl = req.query.url;
        if (!rawUrl || typeof rawUrl !== 'string') {
            return res.status(400).json({ error: 'url is required' });
        }
        if (!_isAllowedUrl(rawUrl)) {
            return res.status(400).json({ error: 'url must be an https URL from Cloudinary, Firebase Storage, or Google Cloud Storage' });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
            const upstream = await fetch(rawUrl, { signal: controller.signal });
            clearTimeout(timer);

            if (!upstream.ok || !upstream.body) {
                return res.status(502).json({ error: 'Could not fetch source media (upstream HTTP ' + upstream.status + ')' });
            }

            const declaredLen = Number(upstream.headers.get('content-length') || 0);
            if (declaredLen && declaredLen > MAX_BYTES) {
                return res.status(413).json({ error: 'File exceeds the ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB download limit' });
            }

            const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
            const ext = _extFromContentType(contentType);
            const filename = _sanitizeFilename(req.query.filename, ext);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
            if (declaredLen) res.setHeader('Content-Length', String(declaredLen));
            // Downloads are one-shot and shouldn't be cached by an intermediary
            // as if this were a normal page resource.
            res.setHeader('Cache-Control', 'no-store');

            const reader = upstream.body.getReader();
            let received = 0;
            let aborted = false;
            req.on('close', () => { aborted = true; });

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (aborted) { try { reader.cancel(); } catch (e) {} break; }
                received += value.byteLength;
                if (received > MAX_BYTES) {
                    try { reader.cancel(); } catch (e) {}
                    if (!res.headersSent) {
                        res.status(413).json({ error: 'File exceeds the ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB download limit' });
                    } else {
                        res.end();
                    }
                    return;
                }
                const ok = res.write(Buffer.from(value));
                if (!ok) {
                    // Respect backpressure so a slow client connection doesn't
                    // balloon this process's memory buffering the whole file.
                    await new Promise((resolve) => res.once('drain', resolve));
                }
            }
            res.end();
        } catch (err) {
            clearTimeout(timer);
            console.error('[MediaDownload] proxy failed:', err.message);
            if (!res.headersSent) {
                const timedOut = err.name === 'AbortError';
                res.status(timedOut ? 504 : 500).json({ error: timedOut ? 'Source media took too long to respond' : ('Download failed: ' + err.message) });
            } else {
                try { res.end(); } catch (e) {}
            }
        }
    });

    // POST /api/media/purge  { urls: [...], listingId? }  — admin, OR the
    // owning seller purging their own marketplace listing's media (see
    // _ownListingUrls above for the ownership check + narrowing that
    // applies in that case; listingId is required and every URL not
    // actually part of that listing is silently dropped).
    // Permanently deletes each URL's underlying file from wherever it's
    // actually hosted (Cloudinary or Firebase/GCS Storage — same
    // ALLOWED_HOSTS this router's own download proxy already trusts).
    // Originally written for content-removal moderation (app-admin.js's
    // Urgent Safety Reports "Remove Content" button, and the Business Page
    // Manager's "Delete Page" button) and now also called by
    // app-marketplace.js's own delete-listing flow — deleting a Firestore
    // doc alone leaves the actual video/image file sitting in storage
    // indefinitely; this is the other half of an actual delete. Best-effort
    // per URL: one failure (e.g. a Cloudinary asset with no
    // CLOUDINARY_API_KEY configured yet) never blocks the others — the
    // caller gets a per-URL result array and decides what to tell the user.
    router.post('/purge', async (req, res) => {
        const decoded = await _verifyToken(req, res, getAdmin);
        if (!decoded) return;

        let urls = Array.isArray(req.body && req.body.urls)
            ? req.body.urls.filter((u) => typeof u === 'string' && u)
            : [];
        if (!urls.length) return res.status(400).json({ error: 'urls (non-empty array) is required' });
        if (urls.length > 100) return res.status(400).json({ error: 'Too many URLs in one request (max 100)' });

        // Non-admin callers (a seller deleting their own marketplace
        // listing) may only purge media that actually belongs to a
        // listing they own — see _ownListingUrls above. Admin callers
        // (app-admin.js's content-removal tools) are unaffected: urls
        // passes through unchanged, exactly as before this fix.
        if (!decoded._isAdmin) {
            urls = await _ownListingUrls(req, res, getAdmin, decoded, urls);
            if (!urls) return; // response already sent
        }

        const admin = getAdmin();
        const results = [];
        for (const url of urls) {
            let hostname;
            try { hostname = new URL(url).hostname; } catch (e) { results.push({ url, deleted: false, reason: 'invalid URL' }); continue; }

            if (!ALLOWED_HOSTS.has(hostname)) {
                results.push({ url, deleted: false, reason: 'unsupported host — only Cloudinary/Firebase Storage/GCS URLs are handled' });
            } else if (hostname === 'res.cloudinary.com') {
                results.push(await _deleteCloudinaryAsset(url));
            } else {
                results.push(await _deleteFirebaseStorageAsset(url, admin));
            }
        }

        const failed = results.filter((r) => !r.deleted);
        res.json({ results, deletedCount: results.length - failed.length, failedCount: failed.length });
    });

    return router;
};