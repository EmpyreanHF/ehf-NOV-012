// =====================================================
        // FIREBASE — use globals set by head initialization
        // =====================================================
        // Re-attempt init in case SDK loaded after head script ran
        if (!window._firebaseLoaded && typeof firebase !== 'undefined') {
            window._initFirebase();
        }
        // Local aliases that always point to working implementations
        var fbAuth    = window.fbAuth;
        var fbDb      = window.fbDb;
        var fbStorage = window.fbStorage;

        // FIX (2026-08-08 — "upload fails unless the user logs out and logs
        // back in"): the three lines above are a ONE-TIME snapshot, taken
        // the instant this script tag is parsed (index.html loads
        // app-dom.js near the very bottom of the page, but real Firebase
        // still depends on an ASYNC /api/config fetch + 5 external SDK
        // <script> tags — see index.html's _initFirebase() — which on a
        // cold/uncached page load can easily still be in flight at this
        // point). Until that resolves, window.fbStorage is the PRE-
        // FIREBASE STUB (index.html's `{ ref: () => ({ put: _noop,
        // getDownloadURL: _noop }) }`), and — critically — that stub's
        // put()/getDownloadURL() both RESOLVE SUCCESSFULLY with fake data
        // instead of rejecting, rather than throwing an catchable error.
        // Whatever this file's actual upload function does with that fake
        // resolution (expecting a real UploadTaskSnapshot / download URL)
        // breaks downstream — which is exactly "upload fails" with no
        // useful error for the person to act on.
        //
        // This is the SAME snapshot-once bug already fixed for
        // window.fbAuth specifically in app-patch-v26.js ("re-arm" on
        // firebase-ready, since window.fbDb/fbAuth/fbStorage get
        // reassigned WHOLESALE once real Firebase loads) and, just now,
        // for app-admin.js's advert/announcement edit+delete — this file
        // is the actual upload code path those Storage rules govern, so
        // it's the most consequential place this exact bug could live.
        //
        // It also explains why "log out, log in again" was the only thing
        // that worked: that's effectively a full page reload on an
        // already-warm browser cache (SDK scripts + config already
        // cached), which resolves the timing race in Firebase's favor
        // almost every time — not because logging out does anything
        // special, just because the SECOND load is fast enough that real
        // Firebase is ready before this line runs. A returning visitor's
        // FIRST load of a session — the exact case in the report — is the
        // one most likely to still be racing a cold cache.
        //
        // Re-sync all three local aliases the moment real Firebase
        // actually comes up, so every upload attempted after that point
        // uses the real fbStorage/fbAuth/fbDb, regardless of how early
        // (or late) in the page's life it's attempted.
        function _reSyncFirebaseAliases() {
            fbAuth    = window.fbAuth;
            fbDb      = window.fbDb;
            fbStorage = window.fbStorage;
        }
        window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_reSyncFirebaseAliases, 50); });
        // Belt-and-suspenders in case this script finishes parsing AFTER
        // _initFirebase() already completed (warm cache) — the event
        // above would already have fired and been missed.
        setTimeout(_reSyncFirebaseAliases, 800);
        setTimeout(_reSyncFirebaseAliases, 2500);

        function _serverTimestamp() {
            try {
                if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
                    return firebase.firestore.FieldValue.serverTimestamp();
            } catch(e) {}
            return new Date();
        }

        // =====================================================
        // FIREBASE STORAGE CONFIG (Primary media storage)
        // ─────────────────────────────────────────────────────
        // MIGRATED (2026-08-03) from Cloudinary. window.fbStorage is
        // already initialized by firebase-init.js's _initFirebase()
        // (same pattern fbAuth/fbDb above already rely on), backed by
        // the bucket in FIREBASE_STORAGE_BUCKET (render.yaml) via the
        // Storage compat SDK index.html already loads — no new script
        // tag or server change needed for this half of the migration.
        //
        // Cloudinary is NOT removed from the app — server.js still uses
        // it (as a transform-only "fetch" layer, not storage) to build
        // video-poster/avatar-badge share cards. This file no longer
        // sends any bytes to Cloudinary itself.
        //
        // Objects are written under uploads/{uid|'guest'}/... so a
        // later Storage security-rules pass can scope write access
        // per-user without this file needing another edit.
        // =====================================================
        function _uploadOwnerSegment() {
            try {
                if (window.userState && window.userState.id && !window.isGuest) return String(window.userState.id);
            } catch (e) {}
            return 'guest';
        }
        function _safeFileName(name) {
            var base = String(name || 'file').split('/').pop().split('\\').pop();
            base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
            return base.slice(-120) || 'file'; // keep it short; extension survives since it's at the end
        }

        // Compress images before upload — reduces upload size by 60-80%
        // Videos and non-image files are passed through unchanged.
        async function _compressImage(file, maxW, maxH, quality) {
            if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
            maxW = maxW || 1920; maxH = maxH || 1920; quality = quality || 0.95;
            return new Promise(function(resolve) {
                var img = new Image();
                var url = URL.createObjectURL(file);
                img.onload = function() {
                    URL.revokeObjectURL(url);
                    var w = img.width, h = img.height;
                    /* SPEED FIX (uploads very slow): a photo whose pixel dimensions already
                       fit under maxW/maxH used to be uploaded byte-for-byte, however large
                       (a 3-4MB JPEG at 1600x1200 sailed straight through). Big JPEGs are now
                       re-encoded at their existing size too. Scoped to image/jpeg only, so a
                       PNG with transparency is never flattened; the existing
                       `blob.size >= file.size` guard below still keeps the original whenever
                       re-encoding wouldn't actually make it smaller. */
                    var _fits = (w <= maxW && h <= maxH);
                    if (_fits && (file.type !== 'image/jpeg' || file.size < 600 * 1024)) { resolve(file); return; }
                    var scale = Math.min(1, maxW / w, maxH / h);
                    var canvas = document.createElement('canvas');
                    canvas.width  = Math.round(w * scale);
                    canvas.height = Math.round(h * scale);
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob(function(blob) {
                        if (!blob || blob.size >= file.size) { resolve(file); return; }
                        var compressed = new File([blob], file.name || 'image.jpg', { type: 'image/jpeg', lastModified: Date.now() });
                        console.info('[Cloudinary] 🗜 Compressed image: ' + Math.round(file.size/1024) + 'KB → ' + Math.round(compressed.size/1024) + 'KB');
                        resolve(compressed);
                    }, 'image/jpeg', quality);
                };
                img.onerror = function() { URL.revokeObjectURL(url); resolve(file); };
                img.src = url;
            });
        }

        // FIX (2026-08-18 — "make uploads work on very poor rural
        // connectivity"): _compressImage() always compressed to the same
        // 1920x1920 @ 0.95-quality target regardless of connection, which
        // is a fairly light compression (0.95 is near-lossless) tuned for a
        // normal connection, not a rural 2G/3G one. The Network Information
        // API (navigator.connection — supported on Chrome/Android, which is
        // this app's primary tested platform per this codebase's own
        // conventions; unsupported browsers just fall through to the
        // existing 1920/1920/0.95 default, so nothing regresses for them)
        // reports the browser's own live read of connection quality
        // (effectiveType: 'slow-2g'|'2g'|'3g'|'4g', saveData, downlink in
        // Mbps). Used here to shrink the compression target harder on a
        // detected slow connection — a smaller, more-compressed image is
        // dramatically less data to actually push over a weak link, which
        // matters far more there than preserving near-lossless quality.
        // Videos are unaffected (still pass through _compressImage
        // unchanged) — client-side video re-encoding is a much bigger,
        // separate lift and deliberately not attempted here.
        // UPDATE (2026-08-18): video compression is now handled below by
        // _compressVideo() — see that function's own header for what
        // changed and why this comment is now historical, not current.
        function _adaptiveCompressionParams() {
            var conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
            /* SPEED FIX: 0.95 JPEG quality is roughly 2-3x the bytes of 0.85 for a difference
               nobody can see on a phone screen. Resolution (1920) is unchanged. */
            if (!conn) return { maxW: 1920, maxH: 1920, quality: 0.85 }; // unsupported browser
            var slowest = conn.saveData === true || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g';
            var slow = conn.effectiveType === '3g' || (typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 1.5);
            if (slowest) return { maxW: 800,  maxH: 800,  quality: 0.55 };
            if (slow)    return { maxW: 1280, maxH: 1280, quality: 0.72 };
            return { maxW: 1920, maxH: 1920, quality: 0.85 }; // good connection
        }

        // =====================================================
        // VIDEO COMPRESSION BEFORE UPLOAD (2026-08-18)
        // ─────────────────────────────────────────────────────
        // Requested as the video-side follow-up to _compressImage()/
        // _adaptiveCompressionParams() above, for the same reason: on a
        // poor/rural connection, a phone-recorded video (routinely
        // 1080p-4K, tens of MB) is by far the heaviest thing this app ever
        // asks someone to upload, and it was passing through completely
        // untouched. This shrinks it BEFORE upload when doing so actually
        // helps, using only browser-native APIs (<video> + <canvas> +
        // MediaRecorder) — no new library, no WASM download, nothing that
        // costs bandwidth or adds a heavy dependency for a low-end device.
        //
        // WHEN IT DOES NOTHING (fails safe to the original file, untouched):
        //   - Browser lacks canvas.captureStream()/MediaRecorder support,
        //     or no MediaRecorder mimeType is supported at all.
        //   - The source is already at or below the target resolution
        //     (TARGET_MAX_DIM below) — this app's own video players
        //     (app-feed.js's .story-video etc.) are always rendered at
        //     `width:100%` of a phone-width container, so a source already
        //     at or under that never benefits from being re-encoded, and
        //     re-encoding an already-small file would just add a
        //     pointless quality-losing extra generation for no size win.
        //   - The clip is longer than MAX_DURATION_S. This technique
        //     re-encodes in REAL TIME (it plays the video while re-
        //     recording it — MediaRecorder has no faster-than-realtime
        //     mode in-browser), so compressing a long video would cost
        //     roughly its own runtime in CPU time on the person's device
        //     before the upload even starts. Fine for short-form content
        //     (reels/status clips); not worth it for a longer upload,
        //     which now just uploads at original size/quality instead.
        //   - The compressed result somehow ends up LARGER than the
        //     original (rare, but possible for an already-efficient short
        //     clip) — same "never make it worse" rule _compressImage()
        //     already follows.
        //   - Anything throws, or the whole attempt exceeds a hard safety
        //     timeout (duration-based, capped) — always resolves with the
        //     ORIGINAL file rather than rejecting, so a compression bug
        //     can never be the reason an upload fails outright.
        //
        // QUALITY: only ever downscales resolution DOWN to what this app's
        // own player actually renders (never up, never past the source's
        // own resolution), and only re-encodes when that downscale is
        // real. Audio is passed through as its own untouched track (not
        // re-encoded from a lossy decode — captured directly from the
        // source <video> element's own audio track), so there's no audio
        // quality loss at all, only ever a video one, and only when the
        // source was larger than what anyone actually sees.
        //
        // FIX (2026-08-18 follow-up — "don't let video go blank on iOS"):
        // the trade-off flagged directly above turned out to be a real
        // problem, not a hypothetical one — this technique's output is
        // WebM (VP8/VP9), and Safari/iOS (including Chrome-on-iOS, which
        // is still WebKit under the hood — Apple's App Store rules require
        // every iOS browser to use WebKit, regardless of what it's branded
        // as) cannot play WebM in a plain <video> tag at all: the player
        // renders as a blank black box with no error surfaced anywhere.
        // Since _compressVideo() only ever runs in the uploading person's
        // OWN browser — it re-encodes before the file leaves their device —
        // an iOS visitor uploading a video would be compressing it into a
        // format their OWN device (and every other iOS viewer later
        // watching it back) can't play. That's strictly worse than doing
        // nothing, so this is detected up front and treated exactly like
        // any other "can't compress here" case already handled below
        // (canCompress/mimeType): skip straight to Promise.resolve(file),
        // upload proceeds with the original, untouched, always-playable
        // file. Nothing else about the flow changes for an iOS visitor —
        // same upload path, same progress bar, same everything — the file
        // just isn't re-encoded first.
        function _isIOS() {
            var ua = navigator.userAgent || '';
            if (/iPad|iPhone|iPod/.test(ua)) return true;
            // iPadOS 13+ masquerades as "Macintosh" in its UA string by
            // default (desktop-class Safari) — the standard way to still
            // catch it is a touch-capable "Mac".
            return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        }

        // KNOWN TRADE-OFF (Chrome/Android only, by design — see FIX note
        // above): MediaRecorder's browser-native output for this technique
        // is WebM (VP8/VP9), which Chrome/Android (this app's primary
        // tested platform) plays natively in a plain <video> tag with no
        // issue. iOS is excluded entirely (_isIOS() check below) rather
        // than risk that unplayable-output case.
        function _compressVideo(file) {
            var TARGET_MAX_DIM   = 960;   // longer side, in px — headroom above the 720-ish rendered size in app-feed.js's players
            var TARGET_VIDEO_BPS = 1500000; // ~1.5 Mbps — clean at TARGET_MAX_DIM for typical phone-recorded content
            var MAX_DURATION_S   = 180;   // 3 minutes — beyond this, real-time re-encode cost isn't worth it; upload original instead
            var MIN_SIZE_TO_BOTHER = 3 * 1024 * 1024; // 3MB — don't bother re-encoding something already small

            if (!file.type.startsWith('video/')) return Promise.resolve(file);
            if (file.size < MIN_SIZE_TO_BOTHER) return Promise.resolve(file);
            if (_isIOS()) return Promise.resolve(file); // see FIX note above — WebM output would be unplayable on the uploader's own device

            var canCompress = typeof MediaRecorder !== 'undefined' &&
                document.createElement('canvas').captureStream;
            if (!canCompress) return Promise.resolve(file);

            var mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
                .find(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); });
            if (!mimeType) return Promise.resolve(file);

            return new Promise(function (resolve) {
                var settled = false;
                var srcUrl = URL.createObjectURL(file);
                var video = document.createElement('video');
                // Muted only silences LOCAL playback — it does NOT remove
                // the audio track from what video.captureStream() exposes
                // below, so the captured/uploaded audio is unaffected. This
                // avoids two real problems with leaving it unmuted: (1) the
                // person would hear their own video play out loud while it
                // silently compresses in the background, and (2) unmuted
                // autoplay can be blocked by the browser's own autoplay
                // policy on a `.play()` call this many promise-ticks removed
                // from the original tap — which would silently skip
                // compression (safely — see the .catch below — but skip it
                // every time, defeating the point).
                video.muted = true;
                video.playsInline = true;
                video.preload = 'auto';
                video.src = srcUrl;

                var safetyTimer = null;
                function finish(result) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(safetyTimer);
                    try { video.pause(); } catch (e) {}
                    URL.revokeObjectURL(srcUrl);
                    resolve(result);
                }

                video.onloadedmetadata = function () {
                    var w = video.videoWidth, h = video.videoHeight, dur = video.duration || 0;
                    if (!w || !h) { finish(file); return; } // couldn't read dimensions — don't guess, just upload as-is
                    if (Math.max(w, h) <= TARGET_MAX_DIM) { finish(file); return; } // already small enough — nothing to gain
                    if (dur > MAX_DURATION_S) { finish(file); return; } // too long to re-encode in real time — upload original

                    /* SPEED FIX (video uploads very slow): this re-encode runs in REAL TIME
                       (the clip is played through a canvas into MediaRecorder), so a 60s video
                       spends a full 60s here before the first byte uploads, with the progress
                       bar sitting at 0%. That only pays off when the bytes saved would take
                       longer to upload than the encode takes. On a fast link it never does, so
                       it was pure added delay. Estimate both sides from the browser's own
                       measured downlink (Mbps; assume uploads run at half of it) and skip the
                       re-encode when it isn't a net win. No Network Information API (or no
                       usable estimate) keeps the previous always-compress behavior. */
                    try {
                        var _c = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
                        if (_c && typeof _c.downlink === 'number' && _c.downlink > 0 && dur > 0) {
                            var _upBytesPerSec = _c.downlink * 125000 * 0.5;
                            var _bytesSaved = file.size - (dur * TARGET_VIDEO_BPS / 8);
                            var _secsSaved = _bytesSaved / _upBytesPerSec;
                            if (_bytesSaved <= 0 || _secsSaved < dur * 1.2) {
                                console.info('[VideoCompress] skipped — re-encoding (~' + Math.round(dur) + 's) would cost more than the ~' + Math.max(0, Math.round(_secsSaved)) + 's it saves on this connection.');
                                finish(file); return;
                            }
                        }
                    } catch (eBenefit) { /* estimate failed — fall through to the original behavior */ }

                    var scale = TARGET_MAX_DIM / Math.max(w, h);
                    var outW = Math.round(w * scale / 2) * 2; // even dimensions — some encoders reject odd ones
                    var outH = Math.round(h * scale / 2) * 2;

                    var canvas = document.createElement('canvas');
                    canvas.width = outW; canvas.height = outH;
                    var ctx = canvas.getContext('2d');

                    // Safety timeout: real-time re-encode should take roughly
                    // `dur` seconds — allow generous headroom (2x + 8s) for a
                    // slow/loaded device, then give up and upload the
                    // original rather than risk hanging the whole flow.
                    safetyTimer = setTimeout(function () {
                        console.warn('[VideoCompress] \u26a0 Exceeded safety timeout — uploading original file instead.');
                        try { recorder && recorder.state !== 'inactive' && recorder.stop(); } catch (e) {}
                        finish(file);
                    }, Math.min(dur * 2000 + 8000, 5 * 60 * 1000));

                    var canvasStream = canvas.captureStream(30);
                    var audioTracks = [];
                    try { audioTracks = video.captureStream ? video.captureStream().getAudioTracks() : []; } catch (e) {}
                    var outStream = new MediaStream(canvasStream.getVideoTracks().concat(audioTracks));

                    var recorder;
                    try {
                        recorder = new MediaRecorder(outStream, { mimeType: mimeType, videoBitsPerSecond: TARGET_VIDEO_BPS });
                    } catch (e) {
                        finish(file); return; // couldn't construct a recorder for this stream — upload original, don't guess further
                    }

                    var chunks = [];
                    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
                    recorder.onerror = function () { finish(file); };
                    recorder.onstop = function () {
                        var blob = new Blob(chunks, { type: 'video/webm' });
                        if (!blob.size || blob.size >= file.size) { finish(file); return; } // never make it worse
                        var newName = (file.name || 'video').replace(/\.[^.]+$/, '') + '.webm';
                        var compressed = new File([blob], newName, { type: 'video/webm', lastModified: Date.now() });
                        console.info('[VideoCompress] \ud83c\udfa5 Compressed video: ' + Math.round(file.size / 1024) + 'KB \u2192 ' + Math.round(compressed.size / 1024) + 'KB (' + w + 'x' + h + ' \u2192 ' + outW + 'x' + outH + ')');
                        finish(compressed);
                    };

                    var drawing = true;
                    function drawFrame() {
                        if (!drawing) return;
                        if (video.paused || video.ended) return;
                        ctx.drawImage(video, 0, 0, outW, outH);
                        (video.requestVideoFrameCallback ? video.requestVideoFrameCallback.bind(video) : requestAnimationFrame)(drawFrame);
                    }

                    video.onended = function () {
                        drawing = false;
                        try { recorder.stop(); } catch (e) { finish(file); }
                    };
                    video.onerror = function () { drawing = false; try { recorder.state !== 'inactive' && recorder.stop(); } catch (e) {} finish(file); };

                    recorder.start();
                    video.play().then(function () {
                        drawFrame();
                    }).catch(function () { finish(file); });
                };
                video.onerror = function () { finish(file); };
            });
        }

        // =====================================================
        // SHARED UPLOAD PROGRESS BAR UI (2026-08-10)
        // ─────────────────────────────────────────────────────
        // ADDED per request: a visible progress bar + live percentage for
        // every upload surface (reel, status, SOS, crisis reporting,
        // business page, profile/quick post, admin portal, news, and
        // marketplace). Rather than each of those ~8 call sites building
        // and styling its own bar, this is the ONE shared widget — a call
        // site just does:
        //   var bar = window.empUploadProgress.attach(containerEl, label);
        //   ...pass onProgress: function(pct){ bar.update(pct); } into
        //   uploadToCloudinary()/uploadMediaFilesToCloudinary()...
        //   bar.done(); // or bar.fail(msg) on error
        // containerEl is whatever element the bar should render inside —
        // typically the form itself, right below the file input/submit
        // button. Safe to call attach() multiple times on the same
        // container (e.g. multi-file loops) — each call reuses the same
        // bar node for that container rather than stacking duplicates.
        // =====================================================
        (function _installUploadProgressUI() {
            if (document.getElementById('_emp_upload_progress_css')) return;
            var css = document.createElement('style');
            css.id = '_emp_upload_progress_css';
            css.textContent = [
                '.emp-upload-progress-wrap{margin:8px 0;display:flex;align-items:center;gap:8px;animation:empUploadFadeIn .15s ease;}',
                '@keyframes empUploadFadeIn{from{opacity:0;transform:translateY(-2px);}to{opacity:1;transform:translateY(0);}}',
                '.emp-upload-progress-track{flex:1;height:6px;border-radius:5px;background:rgba(10,14,39,0.08);overflow:hidden;}',
                '.emp-upload-progress-fill{height:100%;width:0%;background:linear-gradient(90deg,#00897B,#4CAF50);transition:width .18s ease;border-radius:5px;}',
                '.emp-upload-progress-fill.emp-upload-progress-fail{background:linear-gradient(90deg,#e53935,#ef5350);}',
                '.emp-upload-progress-label{font-size:0.72rem;font-weight:700;color:var(--text-muted,#64748b);white-space:nowrap;min-width:38px;text-align:right;}'
            ].join('\n');
            document.head.appendChild(css);
        })();

        window.empUploadProgress = {
            _map: (typeof WeakMap !== 'undefined') ? new WeakMap() : null,
            _plain: [], // fallback store {el, entry} pairs if WeakMap unavailable

            _find: function (containerEl) {
                if (this._map) return this._map.get(containerEl);
                for (var i = 0; i < this._plain.length; i++) if (this._plain[i].el === containerEl) return this._plain[i].entry;
                return undefined;
            },
            _store: function (containerEl, entry) {
                if (this._map) { this._map.set(containerEl, entry); return; }
                this._plain.push({ el: containerEl, entry: entry });
            },
            _clear: function (containerEl) {
                if (this._map) { this._map.delete(containerEl); return; }
                this._plain = this._plain.filter(function (p) { return p.el !== containerEl; });
            },

            // containerEl: element to render the bar inside (appended as
            // its last child). label: optional short text, e.g. "Video 1/3".
            // Returns { update(pct[, label]), done(), fail(msg) }.
            attach: function (containerEl, label) {
                if (!containerEl) {
                    // No container available — degrade to a no-op object so
                    // call sites never need their own null-checks.
                    return { update: function () {}, done: function () {}, fail: function () {} };
                }
                var existing = this._find(containerEl);
                if (!existing) {
                    var wrap = document.createElement('div');
                    wrap.className = 'emp-upload-progress-wrap';
                    wrap.innerHTML = '<div class="emp-upload-progress-track"><div class="emp-upload-progress-fill"></div></div><div class="emp-upload-progress-label">0%</div>';
                    containerEl.appendChild(wrap);
                    existing = { wrap: wrap, fill: wrap.querySelector('.emp-upload-progress-fill'), labelEl: wrap.querySelector('.emp-upload-progress-label') };
                    this._store(containerEl, existing);
                }
                var self = this;
                return {
                    update: function (pct, lbl) {
                        pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
                        existing.fill.classList.remove('emp-upload-progress-fail');
                        existing.fill.style.width = pct + '%';
                        existing.labelEl.textContent = (lbl || label ? (lbl || label) + ' — ' : '') + pct + '%';
                    },
                    done: function () {
                        existing.fill.style.width = '100%';
                        existing.labelEl.textContent = 'Done';
                        setTimeout(function () {
                            if (existing.wrap && existing.wrap.parentNode) existing.wrap.parentNode.removeChild(existing.wrap);
                            self._clear(containerEl);
                        }, 600);
                    },
                    fail: function (msg) {
                        existing.fill.classList.add('emp-upload-progress-fail');
                        existing.labelEl.textContent = msg || 'Failed';
                        setTimeout(function () {
                            if (existing.wrap && existing.wrap.parentNode) existing.wrap.parentNode.removeChild(existing.wrap);
                            self._clear(containerEl);
                        }, 2200);
                    }
                };
            },
            // Immediately remove any bar attached to containerEl (e.g. form reset).
            remove: function (containerEl) {
                var existing = this._find(containerEl);
                if (existing && existing.wrap && existing.wrap.parentNode) existing.wrap.parentNode.removeChild(existing.wrap);
                this._clear(containerEl);
            }
        };

        // =====================================================
        // UPLOAD NETWORK WATCHER + BANNER (2026-10-09)
        // ─────────────────────────────────────────────────────
        // ADDED per report: uploads (photos/videos) sat frozen with zero
        // indication of WHY — offline vs. just a weak connection vs. a real
        // failure — and on a weak link the old watchdog eventually gave up
        // instead of waiting for the network to recover. This is the ONE
        // shared place that (a) shows a plain-language banner whenever an
        // upload is offline/stuck, and (b) decides when the network is good
        // enough to resume (2 consecutive fast probes of our own server,
        // not just the browser's "online" flag, which stays true on a
        // 4G-bars-but-nothing-moves connection). Used only by
        // uploadToCloudinary() below; no call site needs to change.
        // =====================================================
        window.empUploadNet = window.empUploadNet || {
            _s: {},
            _flashMsg: '',
            _flashTimer: null,
            _hideTimer: null,
            _lastSig: '',

            // (2026-10-09 redesign) compact top toast: red = offline/poor
            // network, green = restored. Auto-dismisses (red after 6s, green
            // after 2.8s), tap to dismiss early, and a red one is NOT
            // re-shown every poll — only when the situation changes.
            _css: function () {
                if (document.getElementById('_emp_upload_net_css')) return;
                var st = document.createElement('style');
                st.id = '_emp_upload_net_css';
                st.textContent = [
                    '#_emp_upload_net_banner{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:2147483000;',
                    'display:flex;align-items:center;gap:11px;width:max-content;max-width:min(92vw,360px);padding:10px 14px 10px 11px;',
                    'border-radius:14px;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22),0 1px 0 rgba(255,255,255,.18) inset;',
                    'font-family:inherit;opacity:0;pointer-events:none;transform:translate(-50%,-14px);',
                    'transition:opacity .25s ease,transform .25s ease;-webkit-tap-highlight-color:transparent;}',
                    '#_emp_upload_net_banner.show{opacity:1;pointer-events:auto;transform:translate(-50%,0);}',
                    '#_emp_upload_net_banner.red{background:linear-gradient(135deg,#E5484D,#B42318);}',
                    '#_emp_upload_net_banner.green{background:linear-gradient(135deg,#22A455,#15803D);}',
                    '#_emp_upload_net_banner .ic{flex:0 0 32px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;}',
                    '#_emp_upload_net_banner .ic svg{width:18px;height:18px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;}',
                    '#_emp_upload_net_banner .t{font-size:.86rem;font-weight:800;line-height:1.2;letter-spacing:.01em;}',
                    '#_emp_upload_net_banner .s{font-size:.74rem;font-weight:500;line-height:1.3;opacity:.92;margin-top:2px;}'
                ].join('');
                document.head.appendChild(st);
            },
            _el: function () {
                var el = document.getElementById('_emp_upload_net_banner');
                if (el) return el;
                this._css();
                el = document.createElement('div');
                el.id = '_emp_upload_net_banner';
                el.setAttribute('role', 'status');
                el.setAttribute('aria-live', 'polite');
                el.innerHTML = '<div class="ic"></div><div><div class="t"></div><div class="s"></div></div>';
                el.addEventListener('click', function () { el.classList.remove('show'); });
                (document.body || document.documentElement).appendChild(el);
                return el;
            },
            _ICONS: {
                poor: '<svg viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5.5 12.4a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r=".9" fill="#fff"/></svg>',
                offline: '<svg viewBox="0 0 24 24"><path d="M2 2l20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 3-1.9"/><path d="M10.7 5.1A15 15 0 0 1 22 8.8"/><circle cx="12" cy="19.5" r=".9" fill="#fff"/></svg>',
                ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
            },
            _show: function (cls, icon, title, sub, autoHideMs) {
                var el = this._el();
                el.className = cls;
                el.firstChild.innerHTML = this._ICONS[icon];
                el.querySelector('.t').textContent = title;
                el.querySelector('.s').textContent = sub;
                void el.offsetWidth; // let the transition replay when re-shown
                el.classList.add('show');
                clearTimeout(this._hideTimer);
                this._hideTimer = setTimeout(function () { el.classList.remove('show'); }, autoHideMs);
            },
            _hide: function () {
                var el = document.getElementById('_emp_upload_net_banner');
                if (el) el.classList.remove('show');
                clearTimeout(this._hideTimer);
            },
            _render: function () {
                var ids = Object.keys(this._s);
                if (ids.length) {
                    var self = this;
                    var offline = ids.some(function (k) { return self._s[k] === 'offline'; });
                    var n = ids.length;
                    var sig = (offline ? 'offline' : 'poor') + n;
                    if (sig === this._lastSig) return; // same situation already shown once — don't nag
                    this._lastSig = sig;
                    var what = n > 1 ? (n + ' uploads') : 'Upload';
                    if (offline) this._show('red show', 'offline', 'You\u2019re offline', what + ' paused \u2014 resumes automatically when you\u2019re back online.', 6000);
                    else this._show('red show', 'poor', 'Poor network', what + (n > 1 ? ' are' : ' is') + ' slow or stuck \u2014 will resume automatically.', 6000);
                    return;
                }
                this._lastSig = '';
                if (this._flashMsg) this._show('green show', 'ok', 'Network restored', 'Resuming your upload\u2026', 2800);
                else this._hide();
            },
            set: function (id, state) {
                if (this._s[id] === state) return;
                this._s[id] = state;
                this._flashMsg = '';
                this._render();
            },
            // restored=true: if this was the last warned upload, show the green banner.
            clear: function (id, restored) {
                if (!(id in this._s)) return;
                delete this._s[id];
                if (restored && !Object.keys(this._s).length) { this.flash(); return; }
                this._render();
            },
            flash: function () {
                var self = this;
                this._flashMsg = 'restored';
                this._render();
                clearTimeout(this._flashTimer);
                this._flashTimer = setTimeout(function () { self._flashMsg = ''; self._render(); }, 2800);
            },
            // One quick health check against our own server. "Good" = answered
            // OK in under 3s and the browser isn't reporting a 2g-class link.
            probe: function () {
                return new Promise(function (resolve) {
                    try {
                        var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                        var et = c && c.effectiveType;
                        if (et === 'slow-2g' || et === '2g') { resolve(false); return; }
                        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                        var t0 = Date.now();
                        var to = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } resolve(false); }, 6000);
                        fetch('/api/config?_np=' + t0, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
                            .then(function (r) { clearTimeout(to); resolve(!!r.ok && (Date.now() - t0) < 3000); })
                            .catch(function () { clearTimeout(to); resolve(false); });
                    } catch (e) { resolve(false); }
                });
            },
            // Resolves true once 2 consecutive probes are good; false if
            // isAborted() turns true or capMs elapses first.
            waitForGood: function (id, isAborted, capMs) {
                var self = this;
                var start = Date.now();
                var goodStreak = 0;
                return new Promise(function (resolve) {
                    var timer = null, done = false;
                    function finish(v) {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        window.removeEventListener('online', kick);
                        resolve(v);
                    }
                    function tick() {
                        if (done) return;
                        if (isAborted && isAborted()) { finish(false); return; }
                        if (Date.now() - start > capMs) { finish(false); return; }
                        if (navigator.onLine === false) {
                            goodStreak = 0;
                            self.set(id, 'offline');
                            timer = setTimeout(tick, 2000);
                            return;
                        }
                        self.set(id, 'poor');
                        self.probe().then(function (good) {
                            if (done) return;
                            if (isAborted && isAborted()) { finish(false); return; }
                            goodStreak = good ? goodStreak + 1 : 0;
                            if (goodStreak >= 2) { finish(true); return; }
                            timer = setTimeout(tick, good ? 800 : 4000);
                        });
                    }
                    function kick() { clearTimeout(timer); tick(); }
                    window.addEventListener('online', kick);
                    tick();
                });
            }
        };

        // Expose uploadToCloudinary globally so secondary scripts can call it.
        // NAME KEPT AS-IS ON PURPOSE: 82+ call sites across 14 other files
        // (app-fixes.js, app-chat.js, app-status.js, app-sos.js, app-thread.js,
        // app-kyc.js, app-live.js, app-admin.js, app-profile.js, app-ngo.js,
        // app-marketplace-sellers.js, app-helper.js, and two patch files) call
        // window.uploadToCloudinary()/window.uploadMediaFilesToCloudinary()
        // expecting exactly this signature and return contract. Renaming it
        // would mean editing every one of those call sites for zero behavior
        // change — this migration only needed to change what's INSIDE the
        // function, not its name.
        //
        // NOTE: app-thread.js has its OWN separate, private
        // _uploadToCloudinary() for comment-media attachments that does
        // NOT call this function — it still uploads straight to Cloudinary
        // and is unaffected by this change. Same for app-admin.js's inline
        // fallback definition, which only ever runs if THIS function fails
        // to load at all. Flagging both as a possible follow-up, not fixed
        // here to keep this edit to the one call path that was asked for.
        //
        // CRITICAL RULE (unchanged from the Cloudinary version): this function
        // MUST either resolve with a real, permanent https:// URL or reject.
        // It must NEVER resolve with a blob:// URL — those are tab-local and
        // invisible to every other device/user when stored in Firestore.
        window.uploadToCloudinary = async function uploadToCloudinary(file, onProgress) {
            // If already a URL string (e.g. existing post being re-saved), pass through unchanged
            if (!file) {
                return Promise.reject(new Error('uploadToCloudinary: invalid argument — expected a File or Blob'));
            }
            if (typeof file === 'string') return file;
            // A Blob has everything this function actually needs (size/type,
            // and Storage's put() accepts it directly) — kept from the
            // Cloudinary version's own v16 fix; same reasoning applies here
            // (canvas.toBlob() crop/resize UIs produce a Blob, not a File).
            if (!(file instanceof File) && !(file instanceof Blob)) {
                return Promise.reject(new Error('uploadToCloudinary: invalid argument — expected a File or Blob'));
            }

            if (!fbStorage || typeof fbStorage.ref !== 'function') {
                return Promise.reject(new Error('Firebase Storage is not available yet — please try again in a moment.'));
            }

            // Compress images before upload (videos/gifs pass through unchanged).
            // Params now adapt to detected connection quality — see
            // _adaptiveCompressionParams() above.
            var _compParams = _adaptiveCompressionParams();
            file = await _compressImage(file, _compParams.maxW, _compParams.maxH, _compParams.quality);

            // Compress video before upload — see _compressVideo() above for
            // exactly when this does/doesn't touch the file. Runs after the
            // image step above on purpose (they're mutually exclusive by
            // file.type, so order doesn't matter functionally — kept in the
            // same visual order as this function's other before-upload
            // steps for readability).
            file = await _compressVideo(file);

            // (2026-10-09) per-upload id for the shared network banner above.
            var net = window.empUploadNet;
            var _netId = 'up' + Date.now() + Math.random().toString(36).slice(2, 6);
            var NET_WAIT_CAP_MS = 10 * 60 * 1000; // give a weak/offline connection up to 10 min to recover before giving up

            // FIX (2026-08-05 — reel/video uploads failing with
            // "storage/unauthorized" despite a genuinely valid, signed-in
            // session — confirmed via console log and cross-checked against
            // the live Storage rules, which already allow any
            // authenticated request.auth != null to create/update under
            // uploads/**). The one condition that error can still mean is
            // that the ID token attached to a particular Storage request
            // had gone stale (tokens expire hourly, and this codebase
            // already has a documented history — see app-patch-v31.js —
            // of Auth/token state getting confused on weak/dropping mobile
            // connections, exactly what these reports show: 832 B/s-5.3
            // K/s throughput). One attempt refreshes the token upfront;
            // if a request still comes back storage/unauthorized (e.g. the
            // refresh itself raced a reconnect), ONE retry is made with a
            // second forced token refresh before giving up for good — a
            // genuine permissions problem still fails after that, it just
            // isn't mistaken for a transient blip.
            async function _attemptUpload(isRetry) {
                if (fbAuth && fbAuth.currentUser && typeof fbAuth.currentUser.getIdToken === 'function') {
                    /* SPEED FIX: this forced a network round trip to refresh the ID token before
                       EVERY upload (seconds on a weak link). getIdToken(false) returns the cached
                       token instantly and still refreshes it automatically if it has expired; the
                       forced refresh is kept for the retry attempt, which is the case the
                       2026-08-05 storage/unauthorized fix actually needed it for. */
                    try { await fbAuth.currentUser.getIdToken(!!isRetry); } catch (tokenErr) {
                        console.warn('[Storage] Token refresh before upload failed (continuing anyway):', tokenErr && tokenErr.message);
                    }
                }

                const path = 'uploads/' + _uploadOwnerSegment() + '/' + Date.now() + '_' +
                    Math.random().toString(36).slice(2, 8) + '_' + _safeFileName(file.name || 'file');
                const fileRef = fbStorage.ref().child(path);

                return new Promise((resolve, reject) => {
                    const task = fileRef.put(file, { contentType: file.type || 'application/octet-stream' });

                    // FIX (2026-08-10 — "reel/status/quick-post uploads keep
                    // rotating and never complete"): a Firebase Storage
                    // UploadTask can end up sitting in 'running' state
                    // forever on a dropped/flaky mobile connection — the
                    // underlying XHR simply never fires another progress
                    // event, an error, OR a completion, so
                    // task.on('state_changed', ...) never calls ANY of its
                    // three callbacks again and this Promise was left
                    // permanently unsettled. Every call site awaits this
                    // promise before it can clear its own "Uploading…"
                    // spinner/disabled-button state, so from the person's
                    // side that reads exactly as "keeps rotating without
                    // completing" — no crash, no error toast, nothing,
                    // because nothing downstream ever runs.
                    // FIX: track the last time ANY activity happened
                    // (progress/error/completion) and, if none has happened
                    // for STALL_MS, actively cancel the stuck task and
                    // reject with a clear, actionable message instead of
                    // leaving the caller waiting forever. A genuinely
                    // slow-but-alive upload keeps resetting this timer via
                    // its own progress events, so this only fires on a
                    // real stall — never on a large file that's just slow.
                    //
                    // FIX (2026-08-18 — "make uploads work on very poor rural
                    // connectivity"): the original response to a stall here
                    // was task.cancel() — which discards every byte already
                    // transferred, so on a genuinely slow connection each
                    // retry (see _attemptWithStallRetry below) restarted a
                    // large video from 0% again, and could keep doing that
                    // indefinitely without ever finishing. UploadTask has a
                    // cheaper, non-destructive option first: task.pause()
                    // stops network activity WITHOUT losing progress (it's
                    // the same resumable-upload session Firebase Storage
                    // already keeps server-side), and task.resume() picks
                    // that exact session back up. So a stall now tries
                    // pause -> short breather -> resume, up to
                    // MAX_PAUSE_RESUME times, and only falls through to the
                    // old destructive cancel+reject (which the outer retry
                    // wrapper turns into a fresh attempt) once that's been
                    // tried and still isn't recovering — e.g. the task
                    // genuinely died, not just a slow/dropped chunk.
                    var STALL_MS = 25000;
                    var SLOW_HINT_MS = 8000; // (2026-10-09) show the "poor network" banner this early, long before the watchdog acts
                    var MAX_PAUSE_RESUME = 3;
                    var _pauseResumeAttempts = 0;
                    var _lastActivity = Date.now();
                    var _lastBytes = 0;
                    var _settled = false;
                    var _waiting = false; // true while paused waiting for the network to recover
                    function _bytesNow() { return (task.snapshot && task.snapshot.bytesTransferred) || 0; }
                    function _failStall() {
                        clearInterval(_stallTimer);
                        _settled = true;
                        try { task.cancel(); } catch (e) {}
                        // 0 bytes moved: a fresh task (via _attemptWithStallRetry, which now waits for good network first) is the right recovery.
                        reject(new Error('Upload stalled — no progress for ' + Math.round(STALL_MS / 1000) + 's. Check your connection and try again.'));
                    }
                    // Keep every byte already sent: pause the session, show why, and
                    // resume the SAME session once the network is genuinely good.
                    function _enterWait() {
                        if (_waiting || _settled) return;
                        _waiting = true;
                        try { task.pause(); } catch (e) {}
                        console.warn('[Storage] \u23F8 Upload paused (' + (navigator.onLine === false ? 'offline' : 'poor network') + ') at ' + Math.round(_bytesNow() / 1024) + 'KB — will resume automatically when the connection is good: ' + path);
                        net.waitForGood(_netId, function () { return _settled; }, NET_WAIT_CAP_MS).then(function (ok) {
                            if (_settled) return;
                            if (!ok) {
                                clearInterval(_stallTimer);
                                _settled = true;
                                try { task.cancel(); } catch (e) {}
                                reject(new Error('Network too weak to finish this upload after waiting 10 minutes. Please try again on a better connection.'));
                                return;
                            }
                            net.clear(_netId);
                            net.flash('\u2713 Connection restored \u2014 upload resuming');
                            _waiting = false;
                            _pauseResumeAttempts = 0;
                            _lastActivity = Date.now();
                            try { task.resume(); } catch (e) {}
                        });
                    }
                    var _stallTimer = setInterval(function () {
                        if (_settled) { clearInterval(_stallTimer); return; }
                        if (_waiting) return;

                        if (navigator.onLine === false) {
                            net.set(_netId, 'offline');
                            if (_bytesNow() > 0) _enterWait(); else _failStall();
                            return;
                        }

                        var idle = Date.now() - _lastActivity;
                        if (idle > SLOW_HINT_MS) net.set(_netId, 'poor');
                        if (idle <= STALL_MS) return;

                        var bytesSoFar = _bytesNow();
                        if (bytesSoFar > 0 && _pauseResumeAttempts < MAX_PAUSE_RESUME) {
                            _pauseResumeAttempts++;
                            console.warn('[Storage] \u26a0 Upload stalled — pausing/resuming (attempt ' + _pauseResumeAttempts + '/' + MAX_PAUSE_RESUME + ', ' + Math.round(bytesSoFar / 1024) + 'KB already transferred, keeping it): ' + path);
                            var _paused = false;
                            try { _paused = task.pause(); } catch (e) {}
                            setTimeout(function () {
                                if (_settled || _waiting) return; // completed/errored/entered wait while we were waiting — nothing to resume
                                try { task.resume(); } catch (e) {}
                                _lastActivity = Date.now(); // fresh stall window to let the resumed session show activity
                            }, _paused ? 1500 : 0);
                            return; // do NOT cancel/reject — give the resumed session its own STALL_MS window
                        }
                        if (bytesSoFar > 0) { _enterWait(); return; }
                        console.warn('[Storage] \u26a0 Upload stalled — 0KB transferred after ' + Math.round(STALL_MS / 1000) + 's, restarting once the network is good: ' + path);
                        _failStall();
                    }, 2000);
                    function _settle(fn) {
                        if (_settled) return; // stall timer already rejected this — ignore any late callback
                        _settled = true;
                        clearInterval(_stallTimer);
                        fn();
                    }

                    task.on('state_changed',
                        (snapshot) => {
                            _lastActivity = Date.now();
                            // (2026-10-09) bytes actually moving again => network is fine, drop the warning banner.
                            if (snapshot.bytesTransferred > _lastBytes) {
                                _lastBytes = snapshot.bytesTransferred;
                                net.clear(_netId, true);
                            }
                            if (snapshot.totalBytes) {
                                const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                                if (onProgress) onProgress(pct);
                                document.querySelectorAll('.upload-progress-bar').forEach(bar => {
                                    bar.style.width = pct + '%';
                                    bar.style.background = 'linear-gradient(90deg,#00897B,#4CAF50)';
                                });
                            }
                        },
                        (err) => {
                            _settle(function () {
                                // Common actionable errors — mirrors the old Cloudinary
                                // console guidance so debugging habits carry over.
                                if (err && err.code === 'storage/unauthorized') {
                                    console.error('[Storage] ❌ Unauthorized' + (isRetry ? ' (after retry + token refresh — this is a real permissions problem, not a transient blip)' : ' — retrying once with a fresh token') + '. Check that Storage security rules allow this write — see storage.rules.');
                                } else if (err && err.code === 'storage/unauthenticated') {
                                    console.error('[Storage] ❌ Not signed in — Storage rules likely require request.auth for this path.');
                                }
                                reject(err);
                            });
                        },
                        async () => {
                            try {
                                const url = await task.snapshot.ref.getDownloadURL();
                                _settle(function () {
                                    console.info('[Storage] ✅ Upload successful:', {
                                        path: path,
                                        size_kb: Math.round((task.snapshot.totalBytes || 0) / 1024),
                                        url: url.substring(0, 80) + '...'
                                    });
                                    window._cloudinaryUploads = (window._cloudinaryUploads || 0) + 1; // kept: harmless counter app-admin.js also increments; now counts Storage uploads instead
                                    if (onProgress) onProgress(100);
                                    resolve(url);
                                });
                            } catch (err) {
                                _settle(function () { reject(err); });
                            }
                        }
                    );
                });
            }

            // FIX (2026-08-15 — status/reel/video uploads on a weak connection
            // failing outright after one stall, with no automatic recovery):
            // the 2026-08-10 stall watchdog above (STALL_MS/_stallTimer) is
            // working exactly as designed — cancelling a genuinely stuck
            // UploadTask instead of leaving the caller waiting forever — but
            // the retry layer that used to be here only ever retried on
            // `storage/unauthorized`. A stall/timeout rejection went straight
            // to the caller as a FINAL failure with zero retries. On the
            // throughput this device already has a documented history of
            // (13-19 K/s, bouncing 4G — see app-patch-v26.js/v31.js/v35.js's
            // own diagnosis of the same device/connection), a single 25s
            // window can genuinely not be enough for one video chunk to
            // transfer even though the connection is still up — exactly what
            // the console screenshots show (a stall, not a permission or auth
            // error). Added a bounded stall-retry: up to 2 extra attempts,
            // each starting a brand-new upload task (a fresh task is
            // required — this SDK's UploadTask has no "resume after stall"
            // primitive once its own state_changed stream has gone silent),
            // with a short backoff between attempts (2s, then 4s — same
            // shape as app-patch-v26.js's existing auth-retry backoff) so a
            // genuinely dead connection isn't hammered. A real, sustained
            // outage (all 3 attempts stall) still fails with the same clear,
            // honest error as before — this only removes the zero-retry gap
            // for a transient stall.
            var STALL_RETRY_DELAYS_MS = [2000, 4000];
            function _isStallError(e) {
                return !!(e && typeof e.message === 'string' && e.message.indexOf('Upload stalled') !== -1);
            }
            // (2026-10-09) STALL_RETRY_DELAYS_MS above is no longer used for the
            // retry count/backoff (kept, not deleted, per codebase convention):
            // instead of 2 blind retries then failure, a stalled attempt now
            // waits (with a visible banner) until the network passes 2
            // consecutive health probes, then starts a fresh task — up to
            // STALL_RETRY_MAX times / NET_WAIT_CAP_MS per wait.
            var STALL_RETRY_MAX = 20;
            async function _attemptWithStallRetry(authRetry, stallAttempt) {
                try {
                    return await _attemptUpload(authRetry);
                } catch (err) {
                    if (_isStallError(err) && stallAttempt < STALL_RETRY_MAX) {
                        console.warn('[Storage] Upload stalled — waiting for a good connection before restarting (' + (stallAttempt + 1) + '/' + STALL_RETRY_MAX + ').');
                        var ok = await net.waitForGood(_netId, function () { return false; }, NET_WAIT_CAP_MS);
                        if (!ok) throw new Error('Network too weak to finish this upload after waiting 10 minutes. Please try again on a better connection.');
                        net.clear(_netId);
                        net.flash('\u2713 Connection restored \u2014 upload resuming');
                        return _attemptWithStallRetry(authRetry, stallAttempt + 1);
                    }
                    throw err;
                }
            }

            try {
                return await _attemptWithStallRetry(false, 0);
            } catch (err) {
                if (err && err.code === 'storage/unauthorized') {
                    try {
                        return await _attemptWithStallRetry(true, 0);
                    } catch (retryErr) {
                        console.error('[Storage] ❌ Upload failed after retry:', retryErr && retryErr.message);
                        if (typeof showNotification === 'function') showNotification('Media upload failed: ' + (retryErr && retryErr.message || 'unknown error'), 'error');
                        throw new Error('Firebase Storage upload failed: ' + (retryErr && retryErr.message || 'unknown error'));
                    }
                }
                console.error('[Storage] ❌ Upload failed:', err && err.message);
                if (typeof showNotification === 'function') showNotification('Media upload failed: ' + (err && err.message || 'unknown error'), 'error');
                throw new Error('Firebase Storage upload failed: ' + (err && err.message || 'unknown error'));
            } finally {
                net.clear(_netId); // (2026-10-09) never leave a stale banner behind on success/failure
            }
        };
        const uploadToCloudinary = window.uploadToCloudinary;

        async function uploadMediaFilesToCloudinary(files, onProgress) {
            if (!files || files.length === 0) return [];
            /* FIX (2026-10-07 — multi-file progress bar jumping 100% -> 55% -> 78% -> 50%):
               every file below uploads IN PARALLEL (Promise.all), and each one used to
               call onProgress(its own idx, its own pct) directly. Callers turn that into
               an overall % with (idx + pct/100) / total, which only gives a sensible
               number when files upload one at a time. With parallel uploads, file #7
               finishing (idx 6, 100%) reads as ~100% overall, then file #5 reporting
               58% reads as ~58% -- the bar visibly slid backwards. Now each file's pct
               is stored, the TRUE overall % is computed once (average across all
               files), never allowed to go down, and handed to the caller re-encoded as
               an (idx, pct) pair that satisfies the callers' existing formula exactly,
               so no caller needs to change. */
            const _fileCount = files.length;
            const _perFilePct = new Array(_fileCount).fill(0);
            let _lastOverall = 0;
            const _origOnProgress = onProgress;
            if (typeof _origOnProgress === 'function') {
                onProgress = function (idx, pct) {
                    _perFilePct[idx] = Math.max(_perFilePct[idx] || 0, Math.min(100, pct || 0));
                    let sum = 0;
                    for (let k = 0; k < _fileCount; k++) sum += _perFilePct[k];
                    const overall = Math.max(_lastOverall, sum / _fileCount); // 0..100, monotonic
                    _lastOverall = overall;
                    const scaled = (overall / 100) * _fileCount;              // 0.._fileCount
                    const encIdx = Math.min(_fileCount - 1, Math.floor(scaled));
                    const encPct = (scaled - encIdx) * 100;
                    _origOnProgress(encIdx, encPct);
                };
            }
            /* SPEED/RELIABILITY FIX: every file used to start at once, so N videos meant N
               simultaneous real-time re-encodes AND N uploads splitting one weak connection,
               none finishing until nearly all did, and each starved enough to trip the 25s
               stall watchdog (cancel + restart). Now at most 2 run at a time; the rest wait
               their turn. Results keep their original order (Promise.all over the same
               index-ordered array), and the progress averaging above is unchanged. */
            const _MAX_CONCURRENT = 2;
            let _activeUploads = 0;
            const _waiting = [];
            const _acquire = () => new Promise(function (res) {
                if (_activeUploads < _MAX_CONCURRENT) { _activeUploads++; res(); } else { _waiting.push(res); }
            });
            const _release = () => { const next = _waiting.shift(); if (next) next(); else _activeUploads--; };
            const _uploadOne = async (file, idx) => {
                // Already a URL string (e.g. existing media being re-saved)
                if (typeof file === 'string') {
                    if (file.startsWith('blob:')) {
                        // Blob URLs stored from a previous bug — reject so the post is blocked
                        console.error('[uploadMedia] ❌ Refusing to re-save a blob:// URL — this file was never actually uploaded to Cloudinary.');
                        throw new Error('Media was not properly uploaded. Please re-attach the file and try again.');
                    }
                    return file;
                }
                // Non-File object with a cached cloud URL
                if (!(file instanceof File)) {
                    const cached = file._cloudUrl || file.url || '';
                    if (cached.startsWith('blob:')) {
                        throw new Error('Cached media URL is a blob — re-attach the file and try again.');
                    }
                    return cached;
                }
                // FIX (2026-10-30 — "quick post can't upload more than 100 MB, a 7-minute video is too poor; Empyrean should take 1-hour videos"):
                // the cap was 100 MB for every file. Uploads go to Firebase Storage's resumable uploader (see window.uploadToCloudinary above),
                // which streams the file from disk in chunks, pauses/resumes on a weak network and has no practical object limit (5 TB),
                // so the old cap was purely this check. Videos now allow up to 5 GB (about 1 hour of 1080p phone footage with headroom);
                // images and everything else keep the original 100 MB.
                var _isVideoFile = (file.type && file.type.indexOf('video/') === 0) || /\.(mp4|mov|m4v|webm|mkv|3gp|avi)$/i.test(file.name || '');
                var _maxBytes = _isVideoFile ? 5 * 1024 * 1024 * 1024 : 100 * 1024 * 1024;
                if (file.size > _maxBytes) {
                    const msg = '"' + file.name + '" is too large (max ' + (_isVideoFile ? '5 GB' : '100 MB') + ').';
                    if (typeof showNotification === 'function') showNotification(msg, 'error');
                    throw new Error(msg);
                }
                try {
                    const url = await uploadToCloudinary(file, (pct) => {
                        if (onProgress) onProgress(idx, pct);
                    });
                    // url is guaranteed to be https://res.cloudinary.com/... at this point
                    file._cloudUrl = url;
                    if (onProgress) onProgress(idx, 100); // make sure a finished file always counts as 100%
                    return url;
                } catch(err) {
                    console.error('[uploadMedia] ❌ Upload failed for "' + file.name + '":', err.message);
                    if (typeof showNotification === 'function')
                        showNotification('Upload failed for "' + file.name + '": ' + err.message, 'error');
                    return ''; // return empty string so the rest of the post can still proceed
                }
            };
            const uploads = Array.from(files).map(async (file, idx) => {
                await _acquire();
                try { return await _uploadOne(file, idx); } finally { _release(); }
            });
            return Promise.all(uploads);
        }
        window.uploadMediaFilesToCloudinary = uploadMediaFilesToCloudinary;

        // =====================================================
        // FLUTTERWAVE PAYMENT GATEWAY — keys from /api/config
        // =====================================================
        const _flw = window._appConfig && window._appConfig.flutterwave;
        const FLW_PUBLIC_KEY = (_flw && _flw.publicKey) || '';
        // FLW_SECRET_KEY and FLW_ENCRYPTION_KEY live only on the server.
        // Transaction verification is proxied through /api/flw/verify.
        function initiateFlutterwavePayment(opts) {
            const txRef = 'EMPY-' + Date.now() + '-' + Math.floor(Math.random()*10000);
            if (typeof FlutterwaveCheckout === 'undefined') {
                console.warn('Flutterwave not loaded — retrying...');
                // Dynamically load if missed on page load
                const s = document.createElement('script');
                s.src = 'https://checkout.flutterwave.com/v3.js';
                s.onload = function() { initiateFlutterwavePayment(opts); };
                s.onerror = function() { if (opts.onFailure) opts.onFailure({ status: 'error', message: 'Payment gateway unavailable' }); };
                document.body.appendChild(s);
                return;
            }
            FlutterwaveCheckout({
                public_key: FLW_PUBLIC_KEY,
                tx_ref: txRef,
                amount: opts.amount,
                currency: opts.currency || 'NGN',
                payment_options: 'card,ussd,banktransfer,mobilemoney',
                customer: {
                    email: opts.email || (window.userState && window.userState.email) || 'user@empyrean.com',
                    phone_number: opts.phone || (window.userState && window.userState.phone) || '',
                    name: opts.name || (window.userState && window.userState.fullName) || 'Empyrean User'
                },
                customizations: {
                    title: 'Empyrean Humanitarian Platform',
                    description: opts.description || 'Payment',
                    logo: window._empyreanLogoSrc || ''
                },
                meta: { verified_server_side: true },   // verification via /api/flw/verify
                callback: function(response) {
                    if (response.status === 'successful') {
                        fbDb.collection('flw_transactions').doc(txRef).set({
                            txRef, amount: opts.amount, currency: opts.currency || 'NGN',
                            purpose: opts.purpose || 'general', status: 'held',
                            createdAt: _serverTimestamp()
                        }).catch(e => console.error('FLW tx save error:', e));
                        if (opts.onSuccess) opts.onSuccess(response, txRef);
                    } else {
                        if (opts.onFailure) opts.onFailure(response);
                    }
                },
                onclose: function() { if (opts.onClose) opts.onClose(); }
            });
        }

        // Firebase user helpers
        async function saveUserToFirestore(uid, userData) {
            // Wait up to 6 s for the real Firebase SDK to be ready
            if (!window._firebaseLoaded || !fbDb || !fbDb.collection) {
                await new Promise(function(resolve) {
                    var waited = 0;
                    var t = setInterval(function() {
                        waited += 300;
                        if ((window._firebaseLoaded && fbDb && fbDb.collection) || waited >= 6000) {
                            clearInterval(t); resolve();
                        }
                    }, 300);
                });
            }
            if (!fbDb || !fbDb.collection) {
                console.error('[saveUser] Firebase unavailable — cannot save uid:', uid);
                return;
            }
            const safe = { ...userData };
            // FIX (2026-08-05 — "cover/profile photo upload disappears after
            // save, cloud sync failed" — confirmed via console: "Unsupported
            // field value: a custom Set object (found in field
            // downloadedPostIds...)"): this whitelist converts Set fields to
            // arrays before the Firestore write, since Firestore rejects raw
            // Set objects outright. downloadedPostIds and quotedPostIds are
            // both genuine Set fields on userState (see app-fixes.js's own
            // guestState/demo-user declarations: `downloadedPostIds: new
            // Set(), quotedPostIds: new Set()`) but were missing from this
            // list, so ANY profile save while either field held a Set threw
            // here — aborting the whole write, which is what the outer
            // catch in app-fixes.js's profile-save handler then reported as
            // "cloud sync failed." Added both missing fields.
            ['likedPostIds','followedUserIds','retweetedPostIds','downloadedPostIds','quotedPostIds','awardedRanks','completedTasks','viewedStatusUserIds','blockedUserIds','restrictedMediaUserIds']
                .forEach(k => { if (safe[k] instanceof Set) safe[k] = [...safe[k]]; });
            delete safe.password;
            safe.updatedAt = _serverTimestamp();
            try {
                await fbDb.collection('users').doc(uid).set(safe, { merge: true });
                console.log('[Firestore] ✅ User profile saved for uid:', uid);
                // FIX (2026-08-06): this fell off the end with no return value,
                // so callers doing `_cloudSaved = await saveUserToFirestore(...)`
                // (e.g. app-fixes.js's autoSaveProfileMedia) always got `undefined`
                // -- a falsy value -- even on a fully successful save, and showed
                // "saved locally -- will sync when back online" instead of the
                // correct success message.
                return true;
            } catch(err) {
                console.error('[Firestore] ❌ User save failed:', err.message);
                throw err;
            }
        }
        async function loadUserFromFirestore(uid) {
            // Wait up to 6 s for the real Firebase SDK to be ready
            if (!window._firebaseLoaded || !fbDb || !fbDb.collection) {
                await new Promise(function(resolve) {
                    var waited = 0;
                    var t = setInterval(function() {
                        waited += 300;
                        if ((window._firebaseLoaded && fbDb && fbDb.collection) || waited >= 6000) {
                            clearInterval(t); resolve();
                        }
                    }, 300);
                });
            }
            if (!fbDb || !fbDb.collection) {
                console.error('[loadUser] Firebase unavailable — cannot load uid:', uid);
                return null;
            }
            const doc = await fbDb.collection('users').doc(uid).get();
            if (!doc.exists) return null;
            const data = doc.data();
            /* FEATURE (2026-09-12 — Content Control: block + restrict media):
               blockedUserIds/restrictedMediaUserIds are new Set fields on
               userState, added to the exact same conversion list every other
               Set field on this doc already goes through — same reasoning
               as the downloadedPostIds/quotedPostIds fix documented just
               above saveUserToFirestore: any array field read back from
               Firestore needs converting to a Set here for userState.has()/
               .add()/.delete() call sites (blockUser/unblockUser/
               restrictMediaFromUser/unrestrictMediaFromUser below) to work
               against it consistently with every other membership set in
               this app. */
            ['likedPostIds','followedUserIds','retweetedPostIds','awardedRanks','completedTasks','viewedStatusUserIds','blockedUserIds','restrictedMediaUserIds']
                .forEach(k => { data[k] = new Set(data[k] || []); });
            return data;
        }

        /* =========================================================================
           FEATURE (2026-09-12) — CONTENT CONTROL: BLOCK + RESTRICT MEDIA
           =========================================================================
           "Post restrictions" (block/filter posts from selected contacts) and
           "Media restrictions" (WhatsApp-style: hide a contact's media by
           default without fully blocking them) from this session's project
           spec. Two independent per-viewer lists, both stored ONLY on the
           viewer's own users/{uid} doc (arrayUnion/arrayRemove — the exact
           same Firestore write pattern already used everywhere else in this
           codebase, e.g. retweetedBy in app-fixes.js) so this is purely a
           "what I don't want to see" setting, never a moderation action
           against the other account and never written to THEIR doc:
             • blockedUserIds       — that contact's posts/status are hidden
               from my feed/status bar entirely (checked in app-feed.js's
               posts onSnapshot listener and app-status.js's renderStatusBar).
             • restrictedMediaUserIds — that contact's posts/status still
               show (text, likes, etc.) but their MEDIA is hidden behind a
               tap-to-reveal placeholder (checked in
               createNewPostElement's mediaHTML build and app-status.js's
               status-bar thumbnail).
           Both lists live on userState as Sets (see the loadUserFromFirestore
           conversion just above) for fast, synchronous .has() checks from
           render code — exactly how likedPostIds/followedUserIds etc.
           already work — and are mirrored to Firestore in the background so
           they survive reload/other devices. Exposed on window so every
           module (app-feed.js, app-status.js, app-fixes.js's delegated
           click handler, the Settings > Privacy panel) can call them without
           a new shared-state file. */
        function _ccUs() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
        function _ccEnsureSet(field) {
            var us = _ccUs();
            if (!(us[field] instanceof Set)) us[field] = new Set(us[field] || []);
            return us[field];
        }
        function _ccPersist(field, targetId, add) {
            try {
                var uid = _ccUs().id;
                if (!uid || !window._firebaseLoaded || !window.fbDb) return;
                var Fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
                if (!Fv) return;
                var upd = {}; upd[field] = add ? Fv.arrayUnion(targetId) : Fv.arrayRemove(targetId);
                window.fbDb.collection('users').doc(uid).update(upd).catch(function(){});
            } catch (e) {}
        }
        function isUserBlocked(targetId) {
            if (!targetId) return false;
            return _ccEnsureSet('blockedUserIds').has(targetId);
        }
        function blockUser(targetId, targetName) {
            if (!targetId || targetId === _ccUs().id) return;
            _ccEnsureSet('blockedUserIds').add(targetId);
            _ccPersist('blockedUserIds', targetId, true);
            /* Blocking implies restricting too, so a later unblock alone
               doesn't silently leave media hidden with no visible setting
               that explains why — unrestrict is a separate explicit action. */
            _ccEnsureSet('restrictedMediaUserIds').add(targetId);
            _ccPersist('restrictedMediaUserIds', targetId, true);
            if (typeof window.showNotification === 'function') {
                window.showNotification((targetName ? targetName : 'This user') + ' has been blocked. Their posts and status won\u2019t appear for you anymore.', 'success');
            }
            document.dispatchEvent(new CustomEvent('empyrean-content-control-changed', { detail: { type: 'block', targetId: targetId, active: true } }));
        }
        function unblockUser(targetId, targetName) {
            if (!targetId) return;
            _ccEnsureSet('blockedUserIds').delete(targetId);
            _ccPersist('blockedUserIds', targetId, false);
            if (typeof window.showNotification === 'function') {
                window.showNotification((targetName ? targetName : 'User') + ' unblocked.', 'info');
            }
            document.dispatchEvent(new CustomEvent('empyrean-content-control-changed', { detail: { type: 'block', targetId: targetId, active: false } }));
        }
        function isUserMediaRestricted(targetId) {
            if (!targetId) return false;
            return _ccEnsureSet('restrictedMediaUserIds').has(targetId);
        }
        function restrictMediaFromUser(targetId, targetName) {
            if (!targetId || targetId === _ccUs().id) return;
            _ccEnsureSet('restrictedMediaUserIds').add(targetId);
            _ccPersist('restrictedMediaUserIds', targetId, true);
            if (typeof window.showNotification === 'function') {
                window.showNotification('Media from ' + (targetName ? targetName : 'this user') + ' is now hidden by default for you.', 'success');
            }
            document.dispatchEvent(new CustomEvent('empyrean-content-control-changed', { detail: { type: 'restrict', targetId: targetId, active: true } }));
        }
        function unrestrictMediaFromUser(targetId, targetName) {
            if (!targetId) return;
            _ccEnsureSet('restrictedMediaUserIds').delete(targetId);
            _ccPersist('restrictedMediaUserIds', targetId, false);
            if (typeof window.showNotification === 'function') {
                window.showNotification('Media from ' + (targetName ? targetName : 'this user') + ' will show normally again.', 'info');
            }
            document.dispatchEvent(new CustomEvent('empyrean-content-control-changed', { detail: { type: 'restrict', targetId: targetId, active: false } }));
        }
        window.isUserBlocked = isUserBlocked;
        window.blockUser = blockUser;
        window.unblockUser = unblockUser;
        window.isUserMediaRestricted = isUserMediaRestricted;
        window.restrictMediaFromUser = restrictMediaFromUser;
        window.unrestrictMediaFromUser = unrestrictMediaFromUser;