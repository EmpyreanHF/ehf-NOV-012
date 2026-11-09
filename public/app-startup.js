(function empyreanStartupSync() {
    'use strict';

    // 1. Re-run Firebase init if it hasn't loaded yet (handles slow CDN)
    var _fbRetry = 0;
    var _fbRetryTimer = setInterval(function() {
        _fbRetry++;
        if (window._firebaseLoaded) {
            clearInterval(_fbRetryTimer);
            console.log('[Empyrean] ✅ Firebase confirmed loaded on retry ' + _fbRetry);
            return;
        }
        if (typeof firebase !== 'undefined' && typeof window._initFirebase === 'function') {
            var ok = window._initFirebase();
            if (ok) { clearInterval(_fbRetryTimer); console.log('[Empyrean] ✅ Firebase initialized on retry ' + _fbRetry); }
        }
        if (_fbRetry >= 10) {
            clearInterval(_fbRetryTimer);
            console.warn('[Empyrean] Firebase did not load after 10 retries — running offline mode.');
        }
    }, 500);

    // 1b. FIX ("Missing or insufficient permissions" on messages/chats/presence,
    // chat thread stuck on "No messages yet"): firestore.rules allow messaging
    // for any request.auth != null, so these errors mean the tab has NO Firebase
    // Auth session at all — typical when the app restores a saved local login
    // (localStorage) but Firebase Auth can't restore its own session (on-device
    // "Preview" from a file path, blocked IndexedDB, expired token). Every
    // Firestore call then goes out unauthenticated and is denied. If the person
    // is logged in locally but Firebase has nobody signed in, fall back to an
    // anonymous Firebase session so those requests are authenticated. The rest
    // of the app already ignores anonymous sessions when resolving the real user
    // id (see _authUid in app-patch-openchat.js / app-fixes.js), so this never
    // replaces the person's own account. Runs at most once per page load and
    // needs Anonymous sign-in enabled in the Firebase console.
    var _anonTried = false;
    function _ensureFirebaseSession() {
        if (_anonTried) return;
        var auth = window.fbAuth;
        if (!window._firebaseLoaded || !auth || typeof auth.signInAnonymously !== 'function') return;
        if (auth.currentUser) { _anonTried = true; return; }
        if (window.isGuest !== false && !(window.EmpState && window.EmpState.isGuest === false)) return; // only for a logged-in local session
        _anonTried = true;
        auth.signInAnonymously().then(function () {
            console.log('[Empyrean] No Firebase session found — started an anonymous one so chat/Firestore requests are authenticated.');
        }).catch(function (e) {
            console.warn('[Empyrean] Could not start a Firebase session (is Anonymous sign-in enabled?):', e && (e.code || e.message));
        });
    }
    var _sessTries = 0;
    var _sessTimer = setInterval(function () {
        _sessTries++;
        _ensureFirebaseSession();
        if (_anonTried || _sessTries >= 20) clearInterval(_sessTimer);
    }, 1500);

    // 2. On page load, generate captcha if auth modal is visible or login view is open
    window.addEventListener('load', function() {
        var loginView = document.getElementById('login-view');
        var authModal = document.getElementById('auth-modal-overlay');
        if (loginView && authModal && authModal.classList.contains('show') && loginView.style.display !== 'none') {
            if (typeof window.generateCaptcha === 'function') window.generateCaptcha();
        }

        // 3. Re-register Google auth buttons after full page load (ensures no stale handlers)
        // The secondary Google auth patch already runs this, but we ensure one more time
        setTimeout(function() {
            if (!document.querySelector('.btn-google[data-gcl]')) {
                document.querySelectorAll('.btn-google').forEach(function(btn) {
                    if (btn._gcl) return; // already patched
                    btn._gcl = true;
                    btn.dataset.gcl = '1';
                    // The existing handler in the fix-pack IIFE handles clicks — this just marks them
                });
            }
        }, 300);

        // 4. Ensure Agora SDK availability flag is current
        window._agoraAvailable = (typeof AgoraRTC !== 'undefined');
        console.log('[Empyrean] Agora SDK available:', window._agoraAvailable);

        // 5. Fix any stale liveStreamData.isLive = true on fresh page load
        if (window.liveStreamData && window.liveStreamData.isLive && !window.liveStreamData._localStream) {
            window.liveStreamData.isLive = false;
            console.log('[Empyrean] Cleared stale live stream state on startup.');
        }
    });

    // 6. Expose debug helper
    window._empyreanDebug = function() {
        return {
            firebaseLoaded: window._firebaseLoaded,
            agoraAvailable: window._agoraAvailable,
            isGuest: window.isGuest,
            userState: window.userState ? { id: window.userState.id, email: window.userState.email, name: window.userState.fullName } : null,
            liveState: window.liveStreamData ? { isLive: window.liveStreamData.isLive, channel: window.liveStreamData._agoraChannel } : null,
            agoraStatus: window._agora ? window._agora.status() : 'not loaded'
        };
    };
    console.log('[Empyrean] 🚀 Platform startup sync complete. Debug: window._empyreanDebug()');

    // 7. Deep-link a shared post/reel URL to the actual content, for real
    // visitors — not just crawlers. server.js's OGP route already gives
    // link-preview bots (WhatsApp/Facebook/etc.) the right title/image for
    // a `?post=<id>` URL, but a *human* who taps that link was, until now,
    // just served the plain app with nothing reading the `post` param —
    // they landed on whichever section/loading state the app defaults to,
    // never the specific post. window.openPostById (app-thread.js) and
    // window.openReelViewer (app-reel.js) already do the hard part of
    // finding-or-waiting-for the right card; this just wires the URL to them
    // once, on boot, without touching either of those existing functions.
    (function _empyreanDeepLinkOnBoot() {
        var params;
        try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
        var postId = params.get('post');
        if (!postId) return;

        function _openReelById(id) {
            // FIX (2026-08-07 — shared reel links opened the wrong reel, or
            // nothing): app-feed.js's own reels-grid renderer stamps each
            // card as `.reel-card` with `dataset.postId = reel.id` (see its
            // "Main reels grid" block) — there is no `.reel-item` class
            // anywhere in this codebase (that half of the old selector
            // could never match), and `[data-reel-id="id"]` was instead
            // matching the SMALL dashboard-slider thumbnail
            // (`.dashboard-reel-card`, which also carries a `data-reel-id`)
            // or one of the reel-viewer's own action buttons — never the
            // actual `#reels-grid-container .reel-card` element
            // window.openReelViewer() needs. Passing that wrong element
            // through as `clickedCard` meant openReelViewer's own
            // `card === clickedCard` match (used to pick which reel to
            // scroll to) could never succeed, so it silently opened
            // whichever reel happened to be first in the grid instead of
            // the one that was actually shared. Matching the SAME selector
            // app-feed.js renders to (`.reel-card`/`.reel-preview-card` +
            // `data-post-id` — the same pair openReelViewer's own
            // `allCards` query already looks for) fixes both the
            // wrong-reel mismatch and the dead `.reel-item` clause in one
            // pass, without touching app-feed.js or app-reel.js.
            function _findEl() {
                return document.querySelector(
                    '.reel-card[data-post-id="' + id + '"], .reel-preview-card[data-post-id="' + id + '"]'
                );
            }
            var existing = _findEl();
            if (existing) {
                setTimeout(function () { window.openReelViewer(existing); }, 250);
                return;
            }
            if (typeof window.navigateTo === 'function') window.navigateTo('reels');
            var attempts = 0, maxAttempts = 20; // ~10s at 500ms, matches openPostById's own timeout
            var poll = setInterval(function () {
                attempts++;
                var el = _findEl();
                if (el) {
                    clearInterval(poll);
                    setTimeout(function () { window.openReelViewer(el); }, 250);
                    return;
                }
                if (attempts >= maxAttempts) {
                    clearInterval(poll);
                    if (typeof window.showNotification === 'function') {
                        window.showNotification("That reel couldn't be found — it may have been deleted.", 'info');
                    }
                }
            }, 500);
        }

        function _go() {
            try { document.dispatchEvent(new CustomEvent('empyrean:deep-link-handled')); } catch (e) {}
            _routeSharedPost(postId);
        }

        /* FIX (2026-10-28 — tapping an Empyrean share link inside a chat reloaded the whole app in a new tab,
           waited for full init, then landed on the dashboard): the prefix routing below is now a standalone
           function, also exposed as window._empOpenSharedPost(id) so app-link-preview.js can open the shared
           photo/video/reel/status/listing/article directly inside the running app — no reload, no dashboard. */
        function _routeSharedPost(postId) {
            if (!postId) return;
            // FIX (share-link "redirects to the general dashboard first"
            // for a real human tapping a shared post/reel/listing/article/
            // status link): index.html's splash screen used to hide itself
            // on the generic 'empyrean-init-done' event alone — the exact
            // moment FINAL BOOT restores whatever section localStorage
            // says (often 'dashboard', or the last section visited),
            // which is BEFORE this function has even started looking for
            // the actual shared content ?post= points to. That unrelated
            // section was what got revealed first, with the real content
            // only swapping in a beat later once openPostById/
            // openReelViewer/etc. actually found it — exactly the
            // "redirected to the dashboard" symptom. Dispatching this the
            // instant hand-off happens lets index.html's splash wait for
            // THIS signal instead when a ?post= id is present, so the
            // person goes straight from splash to the shared content
            // without the unrelated section ever being shown in between.
            if (/^reel-/i.test(postId)) {
                if (typeof window.openReelViewer === 'function') _openReelById(postId);
            } else if (/^mkt-/i.test(postId)) {
                /* FIX (request — shared marketplace links, e.g. from the
                   WhatsApp auto-reply message, should open the actual
                   product listing for a human tapping the link, the same
                   way server.js's OGP route now resolves it for a
                   link-preview crawler — see app-marketplace.js's/
                   server.js's matching '?post=' comments). */
                if (typeof window._openListingDetailPage === 'function') window._openListingDetailPage(postId);
            } else if (/^news-/i.test(postId)) {
                /* FIX (2026-08-07 — news article links landed on the
                   dashboard instead of the article): openPostById
                   (app-thread.js) only ever searches `.impact-story`
                   elements, which news cards (`.news-list-item`, built by
                   app-news.js) never are, so a news- id could never
                   resolve through that path. app-news.js's own
                   openNewsArticleById() — added this session — knows how
                   to find/open its own card type, including falling back
                   to a direct Firestore read for an article older than
                   the 30-article in-memory cache. Same '?post=' server.js/
                   app-marketplace.js convention as the mkt- branch above. */
                if (typeof window.openNewsArticleById === 'function') window.openNewsArticleById(postId);
            } else if (/^status-/i.test(postId)) {
                /* FIX (2026-08-07 — "fix the status link"): statuses had no
                   opener AND no way to even generate a shareable link
                   before this session — app-status.js's openStatusById()
                   (added alongside a new Share button in the status
                   viewer) resolves the SAME id server.js's
                   _collectionForId() already maps to the 'statuses'
                   collection: the status doc's own id, 'status-<userId>' —
                   matching every existing Firestore write call site in
                   app-status.js. Falls back to a direct read for a status
                   older than the 60-doc listener cache, same shape as the
                   mkt-/news- branches above. */
                if (typeof window.openStatusById === 'function') window.openStatusById(postId);
            } else if (/^profile-/i.test(postId)) {
                /* FIX (request, 2026-08-11 — reel avatar tap should open the
                   author's profile in a brand-new tab): app-reel.js now
                   opens '?post=profile-<uid>' in a new tab instead of its
                   old in-app quick-preview sheet — a new tab has none of
                   this app's existing in-memory state, so it needs its own
                   bootstrap hook here, same '<prefix>-<id>' shape as every
                   other branch on this page. Strips the prefix back off to
                   get the plain uid renderUserProfile() already expects
                   (see app-profile.js's own renderUserProfile(userId)),
                   then routes to the Profile section the normal way. */
                var profileUid = postId.replace(/^profile-/i, '');
                if (profileUid && typeof window.renderUserProfile === 'function') {
                    window.renderUserProfile(profileUid);
                }
                if (typeof window.navigateTo === 'function') window.navigateTo('profile');
            } else if (typeof window.openPostById === 'function') {
                window.openPostById(postId);
            }
        }
        window._empOpenSharedPost = _routeSharedPost;

        // Wait for the app's real boot-complete signal (data listeners
        // attached, userState resolved) rather than firing on raw page
        // load — otherwise openPostById/openReelViewer poll against a DOM
        // that hasn't rendered anything yet. If the event already fired
        // before this listener attached (script load order), the short
        // fallback timer below still catches it.
        var _fired = false;
        function _runOnce() {
            if (_fired) return;
            _fired = true;
            _go();
        }
        document.addEventListener('empyrean-init-done', _runOnce);
        setTimeout(_runOnce, 6000); // soft ceiling in case the event never fires
    })();

    // 8. Deep-link straight to the Danger Zone's Delete Account control.
    // FEATURE (Google Play Console requires a public "account deletion"
    // URL in its Data Safety section — see joinempyrean.com's own listing).
    // This wires that exact URL, https://joinempyrean.com/?section=
    // settings&action=delete-account, to actually land on the real control
    // (#delete-account-btn, Settings > Security > Danger Zone) instead of
    // just opening the app to whatever section it defaults to.
    //
    // Deliberately drives the UI via the SAME synthetic click the person's
    // own tap would produce (.settings-tab[data-target="settings-security"]
    // .click()) rather than re-implementing tab-switching here — matches
    // this file's own convention just above (openPostById/openReelViewer
    // are called, never duplicated) and means this can never drift out of
    // sync with app-fixes.js's actual tab-switch handler.
    //
    // Never auto-clicks the delete button itself — only scrolls it into
    // view. Auto-triggering deletion (or even the tap-to-arm confirmation
    // state) from a URL a person could tap by accident, or that a crawler
    // could pre-fetch, would be a real safety hazard; landing them exactly
    // where the control is, with nothing armed yet, is the correct amount
    // of "deep link."
    (function _empyreanDeepLinkDeleteAccount() {
        var params;
        try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
        if (params.get('section') !== 'settings' || params.get('action') !== 'delete-account') return;

        function _reveal() {
            var tab = document.querySelector('.settings-tab[data-target="settings-security"]');
            var btn = document.getElementById('delete-account-btn');
            if (!tab || !btn) return false;
            tab.click(); // reuses app-fixes.js's own delegated settings-tab handler
            setTimeout(function () {
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);
            return true;
        }

        function _go() {
            if (window.isGuest) {
                // Deletion requires a real session — send them to log in
                // first rather than landing on a settings page that can't
                // do anything for them yet.
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Please log in to manage or delete your account.', 'info');
                }
                if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
                return;
            }
            if (typeof window.navigateTo === 'function') window.navigateTo('settings');
            if (_reveal()) return;
            // Settings markup may not be attached yet on a cold load —
            // short poll, same ~10s ceiling _openReelById above already uses.
            var attempts = 0;
            var poll = setInterval(function () {
                attempts++;
                if (_reveal() || attempts >= 20) clearInterval(poll);
            }, 500);
        }

        var _fired = false;
        function _runOnce() { if (_fired) return; _fired = true; _go(); }
        document.addEventListener('empyrean-init-done', _runOnce);
        setTimeout(_runOnce, 6000);
    })();

    // 9. SPEED — compress images before every upload, app-wide.
    // FIX (2026-08-06 — "uploads are very slow"): every upload path in this
    // app (avatar, cover/profile photo, posts, reels, marketplace/business
    // listings, chat attachments, KYC selfies, news…) funnels through the
    // ONE shared window.uploadToCloudinary(file, folder) function (Firebase-
    // Storage-backed despite the legacy name — see Store_firebase.js /
    // app-fixes.js's own comments on it). Wrapping it ONCE, here, means
    // every one of those call sites gets faster uploads automatically and
    // consistently, instead of needing the same compression logic copy-
    // pasted into each feature file individually.
    //
    // A raw phone-camera photo is routinely 3-4MB+. Resizing to a sane max
    // dimension and re-encoding as JPEG before the network request cuts
    // that by roughly 70-90% in most cases — on a weak mobile connection
    // (the exact condition this device already shows — see app-patch-v26/
    // v31/v35's own throughput diagnostics) a smaller payload is the single
    // biggest lever available, regardless of which backend it's going to.
    // Videos are NOT re-encoded client-side (no cheap/lossless way to do
    // that in-browser) and upload unchanged, same as before this wrap.
    (function wrapUploadToCloudinaryWithCompression() {
        var MAX_DIM = 1600, QUALITY = 0.82;

        function compressIfImage(file) {
            return new Promise(function (resolve) {
                if (!file || !(file instanceof File) || !file.type ||
                    file.type.indexOf('image/') !== 0 || file.type === 'image/gif') {
                    resolve(file); return; // pass through videos, gifs (would lose animation), non-images
                }
                var img = new Image();
                var url = URL.createObjectURL(file);
                img.onload = function () {
                    URL.revokeObjectURL(url);
                    var w = img.naturalWidth, h = img.naturalHeight;
                    if (!w || !h) { resolve(file); return; }
                    if (w <= MAX_DIM && h <= MAX_DIM && file.size < 900 * 1024) { resolve(file); return; } // already small enough
                    var scale = Math.min(1, MAX_DIM / Math.max(w, h));
                    var cw = Math.round(w * scale), ch = Math.round(h * scale);
                    var canvas = document.createElement('canvas');
                    canvas.width = cw; canvas.height = ch;
                    canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
                    canvas.toBlob(function (blob) {
                        if (!blob || blob.size >= file.size) { resolve(file); return; } // didn't actually help — keep original
                        resolve(new File([blob], file.name || 'image.jpg', { type: 'image/jpeg' }));
                    }, 'image/jpeg', QUALITY);
                };
                img.onerror = function () { URL.revokeObjectURL(url); resolve(file); }; // can't decode — pass original through untouched
                img.src = url;
            });
        }

        function armWrap() {
            var target = window.uploadToCloudinary;
            if (typeof target !== 'function' || target._empCompressWrapped) return;
            var wrapped = function (file, folder) {
                return compressIfImage(file).then(function (optimized) {
                    return target.call(this, optimized, folder);
                }.bind(this));
            };
            wrapped._empCompressWrapped = true;
            window.uploadToCloudinary = wrapped;
            console.log('[Empyrean] ✅ uploadToCloudinary wrapped with client-side image compression — applies to every upload path app-wide.');
        }

        // window.uploadToCloudinary is defined by app-dom.js (or app-fixes.js's
        // fallback if that never loads) at DOMContentLoaded — poll briefly
        // rather than assuming it already exists at this point in the script
        // order, same retry-loop convention as this file's own Firebase check
        // above. Re-armed a couple more times afterward in case something
        // later reassigns window.uploadToCloudinary wholesale.
        var _tries = 0;
        var _armTimer = setInterval(function () {
            _tries++;
            if (typeof window.uploadToCloudinary === 'function' && !window.uploadToCloudinary._empCompressWrapped) {
                armWrap();
            }
            if (window.uploadToCloudinary && window.uploadToCloudinary._empCompressWrapped) {
                clearInterval(_armTimer);
            } else if (_tries >= 20) { // ~10s
                clearInterval(_armTimer);
                console.warn('[Empyrean] uploadToCloudinary never became available — image-compression wrap not applied.');
            }
        }, 500);
    })();
})();