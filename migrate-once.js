/* =============================================================================
   EMPYREAN — migrate-once.js
   Standalone, one-off Cloudinary -> Firebase Storage migration script.

   WHY THIS EXISTS: the browser-based version of this (admin panel button ->
   /api/admin/media-migration/start) kept failing silently in production with
   no error captured anywhere (CORS was ruled out, the route itself was
   confirmed live and correctly guarded, Anonymous auth was ruled out) —
   most likely an invisible overlapping element swallowing the tap before it
   ever reached the click handler, a known recurring bug class in this
   codebase. Rather than keep chasing a frontend ghost, this runs the exact
   same, already-correct scan/download/upload/patch logic directly on the
   server with no browser, no button, no fetch(), no bearer token — so any
   failure prints straight to your terminal instead of disappearing.

   HOW TO RUN (on Render):
     1. Render Dashboard -> your service -> "Shell" tab (gives you a real
        terminal inside the live deployment, with FIREBASE_SERVICE_ACCOUNT_JSON
        and FIREBASE_STORAGE_BUCKET already loaded as env vars -- nothing to
        configure).
     2. First do a dry run (checks every Cloudinary URL is reachable,
        migrates NOTHING, just reports):
          node migrate-once.js --dry-run
     3. Review the summary. If it looks right, run for real:
          node migrate-once.js
     4. Optional: migrate just one collection first as a safer first pass:
          node migrate-once.js --dry-run --targets=posts
          node migrate-once.js --targets=posts
   ============================================================================= */

'use strict';

const crypto = require('crypto');

// ---- CLI flags -------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const targetsArg = args.find(a => a.startsWith('--targets='));
const targetFilter = targetsArg ? targetsArg.split('=')[1].split(',').map(s => s.trim()) : null;

// ---- Same constants as server.js's route -----------------------------------
const CLOUDINARY_URL_RE = /https?:\/\/res\.cloudinary\.com\/[^\s"'\\<>]+/g;
const MEDIA_MIGRATION_CONCURRENCY = 4;

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
    { type: 'collection', name: 'users' },
    { type: 'collection', name: 'comments' },
    { type: 'collectionGroup', name: 'comments' },
    { type: 'collectionGroup', name: 'replies' },
    { type: 'collectionGroup', name: 'msgs' }
];

const targets = targetFilter
    ? MEDIA_MIGRATION_DEFAULT_TARGETS.filter(t => targetFilter.includes(t.name))
    : MEDIA_MIGRATION_DEFAULT_TARGETS;

// ---- Firebase Admin init (identical pattern to server.js's _getAdmin) ------
function initAdmin() {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        console.error('[migrate-once] FIREBASE_SERVICE_ACCOUNT_JSON is not set in this environment. Aborting.');
        process.exit(1);
    }
    if (!process.env.FIREBASE_STORAGE_BUCKET) {
        console.error('[migrate-once] FIREBASE_STORAGE_BUCKET is not set in this environment. Aborting.');
        process.exit(1);
    }
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
    return admin;
}

// ---- Same helpers as server.js's route (unchanged logic) -------------------
function _isOpaqueFirestoreValue(v) {
    return !!v && typeof v === 'object' && (
        typeof v.toDate === 'function' ||
        (typeof v.latitude === 'number' && typeof v.longitude === 'number')
    );
}

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

// ---- Main (console.log progress instead of job-object/HTTP polling) -------
async function main() {
    console.log('========================================================');
    console.log('  Empyrean media migration — ' + (DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE RUN'));
    console.log('  Targets: ' + targets.map(t => t.type + ':' + t.name).join(', '));
    console.log('========================================================\n');

    const admin = initAdmin();
    const db = admin.firestore();
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

    const stats = {
        docsScanned: 0, docsWithMedia: 0, docsUpdated: 0,
        urlsFound: 0, urlsProcessed: 0, urlsMigrated: 0, urlsFailed: 0,
        scanErrors: [], failures: []
    };

    // ---- Phase 1: scan --------------------------------------------------
    console.log('[Phase 1/3] Scanning collections for Cloudinary URLs...');
    const docEntries = [];
    const allUrls = new Set();

    for (const target of targets) {
        let snap;
        try {
            snap = target.type === 'collectionGroup'
                ? await db.collectionGroup(target.name).get()
                : await db.collection(target.name).get();
        } catch (err) {
            stats.scanErrors.push({ target: target.type + ':' + target.name, error: err.message });
            console.warn('  ⚠ Failed to scan ' + target.type + ':' + target.name + ' — ' + err.message);
            continue;
        }
        let foundInThisTarget = 0;
        snap.forEach(doc => {
            stats.docsScanned++;
            const data = doc.data();
            const found = new Set();
            _collectCloudinaryUrls(data, found);
            if (found.size) {
                docEntries.push({ ref: doc.ref, data });
                found.forEach(u => allUrls.add(u));
                foundInThisTarget++;
            }
        });
        console.log('  ' + target.type + ':' + target.name + ' — ' + snap.size + ' docs scanned, ' + foundInThisTarget + ' with Cloudinary media');
    }
    stats.urlsFound = allUrls.size;
    stats.docsWithMedia = docEntries.length;
    console.log('\n  Total: ' + stats.docsScanned + ' docs scanned, ' + stats.docsWithMedia + ' contain Cloudinary URLs, ' + stats.urlsFound + ' distinct URLs to process.\n');

    if (stats.urlsFound === 0) {
        console.log('Nothing to migrate. Done.');
        process.exit(0);
    }

    // ---- Phase 2: migrate/check each distinct URL ------------------------
    console.log('[Phase 2/3] ' + (DRY_RUN ? 'Checking' : 'Migrating') + ' ' + stats.urlsFound + ' distinct URL(s), ' + MEDIA_MIGRATION_CONCURRENCY + ' at a time...');
    const urlMap = new Map();
    const urlList = Array.from(allUrls);
    let lastPrintedPct = -1;

    await _runWithConcurrency(urlList, MEDIA_MIGRATION_CONCURRENCY, async (url) => {
        try {
            if (DRY_RUN) {
                const resp = await fetch(url, { method: 'HEAD' });
                if (!resp.ok) throw new Error('HEAD check failed: HTTP ' + resp.status);
                stats.urlsMigrated++;
            } else {
                const newUrl = await _migrateOneCloudinaryUrl(admin, bucketName, url);
                urlMap.set(url, newUrl);
                stats.urlsMigrated++;
            }
        } catch (err) {
            stats.urlsFailed++;
            stats.failures.push({ url, error: err.message });
        }
        stats.urlsProcessed++;
        const pct = Math.floor((stats.urlsProcessed / stats.urlsFound) * 100);
        if (pct !== lastPrintedPct && pct % 10 === 0) {
            lastPrintedPct = pct;
            console.log('  ' + pct + '% — ' + stats.urlsProcessed + '/' + stats.urlsFound + ' (' + stats.urlsMigrated + ' ok, ' + stats.urlsFailed + ' failed)');
        }
    });
    console.log('  Done: ' + stats.urlsMigrated + ' ok, ' + stats.urlsFailed + ' failed.\n');

    // ---- Phase 3: patch Firestore docs ------------------------------------
    if (!DRY_RUN) {
        console.log('[Phase 3/3] Writing updated URLs back to Firestore...');
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
                    stats.docsUpdated++;
                } catch (err) {
                    stats.failures.push({ docPath: entry.ref.path, error: 'Firestore update failed: ' + err.message });
                    console.warn('  ⚠ Failed to update ' + entry.ref.path + ' — ' + err.message);
                }
            }
        }
        console.log('  Updated ' + stats.docsUpdated + ' document(s).\n');
    } else {
        console.log('[Phase 3/3] Skipped (dry run — no Firestore writes).\n');
    }

    // ---- Summary ------------------------------------------------------------
    console.log('========================================================');
    console.log('  SUMMARY');
    console.log('========================================================');
    console.log('  Docs scanned:      ' + stats.docsScanned);
    console.log('  Docs with media:   ' + stats.docsWithMedia);
    console.log('  Docs updated:      ' + stats.docsUpdated);
    console.log('  URLs found:        ' + stats.urlsFound);
    console.log('  URLs migrated OK:  ' + stats.urlsMigrated);
    console.log('  URLs failed:       ' + stats.urlsFailed);
    if (stats.failures.length) {
        console.log('\n  FAILURES:');
        stats.failures.forEach(f => {
            console.log('    - ' + (f.url || f.docPath) + ' :: ' + f.error);
        });
    }
    if (stats.scanErrors.length) {
        console.log('\n  SCAN ERRORS:');
        stats.scanErrors.forEach(e => {
            console.log('    - ' + e.target + ' :: ' + e.error);
        });
    }
    console.log('\nDone.');
    process.exit(0);
}

main().catch(err => {
    console.error('\n[migrate-once] FATAL ERROR:', err);
    process.exit(1);
});