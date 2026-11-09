// =====================================================
        // FIREBASE — use globals set by head initialization
        // =====================================================
        // Re-attempt init in case SDK loaded after head script ran
        if (!window._firebaseLoaded && typeof firebase !== 'undefined') {
            window._initFirebase();
        }
        // Local aliases that always point to working implementations
        /* FIX: was `let fbAuth/fbDb/fbStorage` -- top-level let/const in a
           classic <script> tag binds to the page's shared global lexical
           scope. app-dom.js (loaded earlier) already declares `let fbAuth`,
           `let fbDb`, `let fbStorage` the same way, so this second
           declaration threw "SyntaxError: Identifier 'fbAuth' has already
           been declared" -- a parse-time error that killed this entire
           1630-line file, every load, for every user. `var` rebinds the
           existing global instead of fighting over it, so the rest of this
           file's `fbDb.collection(...)` calls keep working unchanged. */
        var fbAuth    = window.fbAuth;
        var fbDb      = window.fbDb;
        var fbStorage = window.fbStorage;

        // FIX (2026-08-08 — Advert/Announcement Edit+Delete silently not
        // working): the three lines above are a ONE-TIME snapshot, taken
        // the instant this script tag is parsed — which, per index.html's
        // own load sequence, happens well before `_initFirebase()` can
        // possibly have finished (that depends on an async /api/config
        // fetch + 5 external SDK <script> tags, all still in flight at
        // this point on anything but the fastest connection). So `fbDb`
        // here is captured as the pre-Firebase LOCAL STUB (index.html's
        // `_col()` mock) — a real, truthy object whose .update()/.delete()
        // calls always resolve SUCCESSFULLY without ever touching
        // Firestore, rather than rejecting. That's the exact shape of "Edit
        // shows a success toast but the change doesn't stick" and "Delete
        // does nothing, no error" — this file's own `if (!fbDb) return`
        // guards (e.g. _submitAdvert()) never catch it, because the stub
        // is never falsy, just fake.
        //
        // Same bug class app-patch-v26.js already had to fix for
        // window.fbAuth specifically ("re-arm" on firebase-ready, since
        // window.fbDb/fbAuth/fbStorage get reassigned WHOLESALE once
        // real Firebase loads — see index.html's _initFirebase()). That
        // fix never covered this file. Re-sync all three local aliases
        // the moment real Firebase actually comes up, so every feature in
        // this ~2300-line file that reads the bare `fbDb`/`fbAuth`/
        // `fbStorage` identifiers (not just adverts) starts using the real
        // instances instead of being stuck on the stub for the rest of
        // the session.
        function _reSyncFirebaseAliases() {
            fbAuth    = window.fbAuth;
            fbDb      = window.fbDb;
            fbStorage = window.fbStorage;
        }
        window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_reSyncFirebaseAliases, 50); });
        // Belt-and-suspenders in case this script finishes parsing AFTER
        // _initFirebase() already completed (fast connection) — the event
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
        // MEDIA UPLOAD — app-dom.js defines window.uploadToCloudinary,
        // already backed by Firebase Storage (name kept for the 80+ call
        // sites across other files — see app-dom.js's own comment).
        // app-admin.js MUST NOT overwrite it when app-dom.js already has.
        //
        // Safety net only: define it here if app-dom.js failed to load.
        //
        // FIX (dev note — "we are currently using firebase backend
        // storage and not cloudinary"): this fallback used to post
        // straight to Cloudinary's REST API (api.cloudinary.com) — a
        // real, live Cloudinary upload, not just a stale name. That was
        // the one remaining genuine Cloudinary call left in this app;
        // everywhere else (app-dom.js's own uploadToCloudinary) already
        // went through Firebase Storage. Now mirrors app-dom.js's own
        // Storage-based implementation (same fbStorage.ref().put(),
        // same uploads/<owner>/<file> path convention) so this safety
        // net never reaches Cloudinary either, even if it's the one that
        // ends up running.
        // =====================================================
        if (typeof window.uploadToCloudinary !== 'function') {
            window.uploadToCloudinary = async function uploadToCloudinary(file, onProgress) {
                if (!file || !(file instanceof File) && !(file instanceof Blob)) {
                    if (typeof file === 'string') return file;
                    return Promise.reject(new Error('uploadToCloudinary: expected a File or Blob'));
                }
                if (!fbStorage || typeof fbStorage.ref !== 'function') {
                    return Promise.reject(new Error('Firebase Storage is not available yet — please try again in a moment.'));
                }
                var _ownerSeg = (fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid) || 'anon';
                var _safeName = String((file && file.name) || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
                var path = 'uploads/' + _ownerSeg + '/' + Date.now() + '_' +
                    Math.random().toString(36).slice(2, 8) + '_' + _safeName;
                var fileRef = fbStorage.ref().child(path);
                return new Promise((resolve, reject) => {
                    const tid = setTimeout(() => { try { task.cancel(); } catch(e) {} reject(new Error('Upload timed out after 90 s')); }, 90000);
                    const task = fileRef.put(file, { contentType: file.type || 'application/octet-stream' });
                    task.on('state_changed',
                        (snap) => {
                            if (onProgress && snap.totalBytes) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
                        },
                        (err) => {
                            clearTimeout(tid);
                            console.error('[Storage] ❌ Upload failed (admin fallback):', err && err.message);
                            reject(err);
                        },
                        () => {
                            clearTimeout(tid);
                            task.snapshot.ref.getDownloadURL().then((url) => {
                                window._firebaseStorageUploads = (window._firebaseStorageUploads||0)+1;
                                resolve(url);
                            }).catch(reject);
                        }
                    );
                });
            };
            console.warn('[Empyrean] uploadToCloudinary safety-net activated — app-dom.js may not have run.');
        }

        // FIX (bug report: "the posting tab on the profile page is no longer
        // functional" — traced to actual post SUBMISSION failing, not the tab
        // switcher): this definition ran UNCONDITIONALLY, with no guard, unlike
        // its own sibling `uploadToCloudinary` seven lines above (which is
        // correctly wrapped in `if (typeof window.uploadToCloudinary !== 'function')`)
        // and unlike app-helper.js's own polyfill of this exact same function
        // (`if (typeof window.uploadMediaFilesToCloudinary !== 'function')`).
        // Since index.html loads app-admin.js LAST among the four files that
        // each define window.uploadMediaFilesToCloudinary (app-dom.js,
        // app-helper.js, app-fixes.js, then app-admin.js), this version always
        // won and silently replaced the canonical app-dom.js implementation on
        // every single page load, everywhere in the app — not just admin
        // screens.
        //
        // It also dropped the try/catch app-dom.js's version wraps around each
        // individual upload (see that file's own comment: "return ''; // return
        // empty string so the rest of the post can still proceed"). Without
        // that, `await window.uploadToCloudinary(file, ...)` rejecting for ANY
        // ONE file in a multi-file batch — a network blip, a Storage timeout,
        // anything transient — threw inside this map's async callback, which
        // made the surrounding `Promise.all(uploads)` reject the WHOLE batch
        // immediately. Every caller of uploadMediaFilesToCloudinary (the
        // profile page's own "Share a Moment" composer among them —
        // app-profile.js awaits this call inside a try/catch that shows
        // "Post failed. Please try again." on any rejection) then failed the
        // entire post over a single flaky file, instead of posting the files
        // that DID succeed and just leaving the failed one out — exactly what
        // "no longer functional" looks like on anything but a perfect connection.
        //
        // Fixed the same way its own sibling above already is: guarded so this
        // never overwrites an already-working implementation, and given the
        // same per-file try/catch resilience as app-dom.js's canonical version,
        // so even on a page where this fallback IS the one that ends up
        // installed, one bad file can no longer take down an entire post.
        if (typeof window.uploadMediaFilesToCloudinary !== 'function') {
            async function uploadMediaFilesToCloudinary(files, onProgress) {
                if (!files || files.length === 0) return [];
                const uploads = Array.from(files).map(async (file, idx) => {
                    if (!(file instanceof File)) {
                        return file._cloudUrl || (typeof file === 'string' ? file : (file.url || ''));
                    }
                    if (file.size > 100 * 1024 * 1024) {
                        if (typeof showNotification === 'function') showNotification(`"${file.name}" is too large (max 100MB).`, 'error');
                        return '';
                    }
                    try {
                        // Always use window.uploadToCloudinary — guaranteed to be the
                        // app-dom.js version with correct preset and proper reject on failure.
                        const url = await window.uploadToCloudinary(file, (pct) => {
                            if (onProgress) onProgress(idx, pct);
                        });
                        file._cloudUrl = url;
                        return url;
                    } catch (err) {
                        console.error('[uploadMedia] \u274c Upload failed (admin fallback) for "' + (file.name || 'file') + '":', err && err.message);
                        if (typeof showNotification === 'function') showNotification('Upload failed for "' + (file.name || 'file') + '": ' + (err && err.message || 'unknown error'), 'error');
                        return ''; // let the rest of the post/batch still proceed
                    }
                });
                return Promise.all(uploads);
            }
            window.uploadMediaFilesToCloudinary = uploadMediaFilesToCloudinary;
            console.warn('[Empyrean] uploadMediaFilesToCloudinary safety-net activated — app-dom.js may not have run.');
        }

        // =====================================================
        // FLUTTERWAVE PAYMENT GATEWAY — keys from /api/config
        // FLW_SECRET_KEY and FLW_ENCRYPTION_KEY live on the
        // server only — never sent to the browser.
        // =====================================================
        const _adminFlw = window._appConfig && window._appConfig.flutterwave;
        const FLW_PUBLIC_KEY_ADMIN = (_adminFlw && _adminFlw.publicKey) || '';

        // SDK queue — ensures callers never hit "FlutterwaveCheckout is not defined"
        window._flwSDKLoaded  = (typeof FlutterwaveCheckout !== 'undefined');
        window._flwSDKLoading = false;
        window._flwSDKQueue   = [];

        window._ensureFlutterwaveSDK = function(callback) {
            if (typeof FlutterwaveCheckout !== 'undefined') {
                window._flwSDKLoaded = true;
                callback();
                return;
            }
            window._flwSDKQueue.push(callback);
            if (window._flwSDKLoading) return; // already loading, will drain queue on load
            window._flwSDKLoading = true;
            const s = document.createElement('script');
            s.src = 'https://checkout.flutterwave.com/v3.js';
            s.onload = function() {
                window._flwSDKLoaded = true;
                window._flwSDKLoading = false;
                console.info('[FLW] ✅ SDK loaded');
                window._flwSDKQueue.forEach(function(fn) { try { fn(); } catch(e) {} });
                window._flwSDKQueue = [];
            };
            s.onerror = function() {
                window._flwSDKLoading = false;
                window._flwSDKQueue = [];
                if (typeof window.showNotification === 'function')
                    window.showNotification('Payment gateway unavailable. Please check your connection.', 'error');
            };
            document.head.appendChild(s);
        };

        // Pre-load SDK at startup so first payment click is instant
        if (!window._flwSDKLoaded) {
            window._ensureFlutterwaveSDK(function() {
                console.info('[FLW] Payment gateway ready');
            });
        }

        function initiateFlutterwavePayment(opts) {
            if (!opts || !opts.amount || parseFloat(opts.amount) < 1) {
                console.error('[FLW] Invalid payment options — amount required');
                if (opts && opts.onFailure) opts.onFailure({ status: 'error', message: 'Invalid payment amount' });
                return;
            }
            const txRef = 'EMPY-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

            window._ensureFlutterwaveSDK(function() {
                try {
                    FlutterwaveCheckout({
                        public_key: FLW_PUBLIC_KEY_ADMIN,
                        tx_ref: txRef,
                        amount: parseFloat(opts.amount),
                        currency: opts.currency || 'NGN',
                        payment_options: 'card,ussd,banktransfer,mobilemoney,barter,nqr',
                        customer: {
                            email:        opts.email || (window.userState && window.userState.email) || 'user@empyrean.com',
                            phone_number: opts.phone || (window.userState && window.userState.phone) || '',
                            name:         opts.name  || (window.userState && window.userState.fullName) || 'Empyrean User'
                        },
                        customizations: {
                            title:       'Empyrean Humanitarian Platform',
                            description: opts.description || 'Payment',
                            logo:        'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
                        },
                        meta: {
                            source:   'empyrean_app',
                            purpose:  opts.purpose || 'general',
                            userId:   (window.userState && window.userState.id) || 'guest'
                        },
                        callback: function(response) {
                            if (response.status === 'successful' || response.status === 'completed') {
                                // Persist transaction to Firestore
                                try {
                                    if (window.fbDb && window._firebaseLoaded) {
                                        window.fbDb.collection('flw_transactions').doc(txRef).set({
                                            txRef,
                                            flwRef:   response.flw_ref || response.transaction_id || '',
                                            amount:   parseFloat(opts.amount),
                                            currency: opts.currency || 'NGN',
                                            purpose:  opts.purpose || 'general',
                                            status:   'successful',
                                            userId:   (window.userState && window.userState.id) || 'guest',
                                            userEmail: opts.email || (window.userState && window.userState.email) || '',
                                            createdAt: _serverTimestamp()
                                        }).catch(function(e) { console.error('[FLW] Firestore save error:', e.message); });
                                    }
                                } catch(e) {}
                                if (opts.onSuccess) opts.onSuccess(response, txRef);
                            } else {
                                if (opts.onFailure) opts.onFailure(response);
                            }
                        },
                        onclose: function() { if (opts.onClose) opts.onClose(); }
                    });
                } catch(flwErr) {
                    console.error('[FLW] FlutterwaveCheckout error:', flwErr.message);
                    if (opts.onFailure) opts.onFailure({ status: 'error', message: flwErr.message });
                }
            });
        }

        // Expose globally for use by all scripts
        window.initiateFlutterwavePayment = initiateFlutterwavePayment;
        window._flwPublicKey = FLW_PUBLIC_KEY_ADMIN;

        // Firebase user helpers
        //
        // FIX (2026-08-06 — cover/profile save STILL crashing with
        // "Unsupported field value: a custom Set object (found in field
        // downloadedPostIds...)" even after app-auth.js's saveUserToFirestore
        // was fixed to convert every Set field, including this one): this
        // file has no IIFE/module wrapper around it (see the top-of-file
        // comment about `var fbAuth/fbDb/fbStorage` existing precisely
        // because top-level `let` here collided with app-dom.js's global
        // scope) — so this `function saveUserToFirestore(...)` is likewise
        // a plain top-level declaration, which JS auto-exposes as
        // `window.saveUserToFirestore`. Since index.html loads this file
        // AFTER app-auth.js, that auto-exposure silently overwrote
        // app-auth.js's already-fixed `window.saveUserToFirestore` with
        // THIS copy every single page load — and this copy's Set-key list
        // was still missing 'downloadedPostIds' and 'quotedPostIds', so the
        // exact same crash kept happening no matter what app-auth.js did.
        // Added the two missing keys AND a generic catch-all sweep (mirrors
        // app-auth.js's own fix) so any Set field, known or future, is
        // converted here too — since this is the copy that actually wins.
        async function saveUserToFirestore(uid, userData) {
            // Ensure real Firebase is ready before saving
            if (!window._firebaseLoaded) {
                console.warn('[saveUser] Firebase not ready — queuing retry in 2s');
                return new Promise((resolve) => {
                    setTimeout(async () => { try { await saveUserToFirestore(uid, userData); } catch(e){} resolve(); }, 2000);
                });
            }
            // FIX (2026-08-06 — cover/profile save keeps permission-denying
            // even for a single-field write, right after the Storage upload
            // of the same photo succeeded): Storage's rule only requires
            // request.auth != null, but every Firestore rule on /users/{id}
            // requires request.auth.uid == id specifically. On a slow
            // connection the UI can show a fully "logged in" user (from the
            // cached profile app-auth.js restores immediately) before
            // Firebase Auth's own session restore has actually finished —
            // window.fbAuth.currentUser is still null (or a leftover
            // anonymous session with a DIFFERENT uid) at the moment this
            // runs, so request.auth.uid can never match uid and the write
            // is denied — regardless of payload size or content, which is
            // why trimming the write down further didn't help. Give the
            // real session a few seconds to finish restoring (mirrors the
            // grace-window pattern app-auth.js's own auth watcher already
            // uses) before attempting the write, instead of firing a write
            // that's guaranteed to fail.
            var _authUser = fbAuth && fbAuth.currentUser;
            var _waited = 0;
            while ((!_authUser || _authUser.isAnonymous || _authUser.uid !== uid) && _waited < 15000) {
                await new Promise(function(r) { setTimeout(r, 400); });
                _waited += 400;
                _authUser = fbAuth && fbAuth.currentUser;
            }
            // FIX (2026-09-15 — "updating user name doesn't work, shows
            // updated but reverts"): this used to `return false` here,
            // WITHOUT ever attempting the write, whenever auth still hadn't
            // caught up to `uid` after the 15s wait above — on a real but
            // slow connection (e.g. Firebase Auth session restore still not
            // finished loading its own SDK scripts) this silently and
            // PERMANENTLY dropped the edit: the caller only ever saw the
            // "updated locally, couldn't reach server" toast, nothing ever
            // reached Firestore, and the field reverted on next load/refresh
            // since that's still the only source of truth. The wait itself
            // is still worth keeping (it avoids a near-certain
            // permission-denied in the common fast case), but giving up
            // afterward instead of just trying is what actually lost the
            // edit. Now it always attempts the write once the wait ends —
            // a genuine permission-denied still throws and is handled by
            // the try/catch below exactly as before, so this doesn't bring
            // back the crash the wait was added to avoid; it only stops a
            // slow-but-legitimate save from being thrown away silently.
            if (!_authUser || _authUser.isAnonymous || _authUser.uid !== uid) {
                console.warn('[saveUser] No matching signed-in session for uid ' + uid +
                    ' after waiting — attempting the write anyway (Firestore\'s own rules will reject it if truly unauthorized). Current auth uid: ' +
                    (_authUser ? _authUser.uid + (_authUser.isAnonymous ? ' (anonymous)' : '') : 'none'));
            }
            const safe = { ...userData };
            ['likedPostIds','followedUserIds','retweetedPostIds','downloadedPostIds','quotedPostIds','awardedRanks','completedTasks','viewedStatusUserIds']
                .forEach(k => { if (safe[k] instanceof Set) safe[k] = [...safe[k]]; });
            // Belt-and-braces: convert ANY remaining Set instance, whether or
            // not its key name is in the list above.
            Object.keys(safe).forEach(k => { if (safe[k] instanceof Set) safe[k] = [...safe[k]]; });
            delete safe.password;
            /* FIX (2026-10-28 — "profile picture missing in one browser, follows
               disappear after logging out and back in"): several callers (the
               profile-form Save, the avatar/cover autosave, signup, the auth
               watcher) hand this function the WHOLE in-memory userState. A browser
               that restored an OLD cached session therefore pushed its stale
               avatar, its stale followedUserIds array and its stale followerCount
               over what Firestore already held, silently erasing the newer data
               made in another browser. Three protections, all applied here since
               this is the copy of saveUserToFirestore that actually runs:
                 1. followedUserIds is only ever ADDED to (arrayUnion), never
                    overwritten with a possibly-stale array. Unfollows are written
                    by window._empPersistFollow (arrayRemove), which is the only
                    place that should remove an id.
                 2. followerCount is derived from who follows you (see
                    window._empRefreshFollowerCount in app-fix-final.js), never
                    pushed from a cached number.
                 3. A placeholder/empty avatar (or empty cover) never replaces a
                    real picture that is already stored. */
            try {
                var _FVs = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
                if (Array.isArray(safe.followedUserIds)) {
                    if (safe.followedUserIds.length && _FVs && typeof _FVs.arrayUnion === 'function') {
                        safe.followedUserIds = _FVs.arrayUnion.apply(_FVs, safe.followedUserIds);
                    } else { delete safe.followedUserIds; }
                }
                delete safe.followerCount;
                var _isPh = function (u) { return !u || typeof u !== 'string' || /ui-avatars\.com|source\.unsplash\.com/i.test(u); };
                if ('avatar' in safe && _isPh(safe.avatar)) {
                    var _cur = null;
                    try { var _cd = await fbDb.collection('users').doc(uid).get(); _cur = _cd && _cd.exists ? _cd.data() : null; } catch (_e) {}
                    if (_cur && !_isPh(_cur.avatar)) delete safe.avatar;
                }
                if ('coverPhoto' in safe && !safe.coverPhoto) delete safe.coverPhoto;
            } catch (_guardErr) { console.warn('[saveUser] stale-data guard skipped:', _guardErr && _guardErr.message); }
            safe.updatedAt = _serverTimestamp();
            try {
                await fbDb.collection('users').doc(uid).set(safe, { merge: true });
                console.log('[Firestore] ✅ User profile saved for uid:', uid);
                return true;
            } catch(err) {
                console.error('[Firestore] ❌ User save failed:', err.message);
                throw err;
            }
        }
        async function loadUserFromFirestore(uid) {
            const doc = await fbDb.collection('users').doc(uid).get();
            if (!doc.exists) return null;
            const data = doc.data();
            ['likedPostIds','followedUserIds','retweetedPostIds','awardedRanks','completedTasks','viewedStatusUserIds']
                .forEach(k => { data[k] = new Set(data[k] || []); });
            return data;
        }

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — TAB SWITCHING
        // Wires up all .admin-nav-tab buttons including the new Disbursements tab
        // ═══════════════════════════════════════════════════════════════════
        (function initAdminTabSwitching() {
            const adminSection = document.getElementById('admin');
            if (!adminSection) return;

            function switchAdminTab(targetId) {
                adminSection.querySelectorAll('.admin-nav-tab').forEach(function(b) {
                    const isActive = b.dataset.tab === targetId;
                    b.classList.toggle('active', isActive);
                    b.style.background = isActive ? 'var(--g-navy)' : 'transparent';
                    b.style.color      = isActive ? 'white' : 'var(--text-muted)';
                });
                adminSection.querySelectorAll('.admin-tab-content').forEach(function(panel) {
                    panel.style.display = panel.id === targetId ? 'block' : 'none';
                });
                if (targetId === 'admin-disburse-tab') {
                    _adminLoadNgoList();
                    _adminLoadRecentDisbursements();
                    /* Initialise panel visibility and method tabs on every tab open */
                    if (typeof window._adminDisbRecipChange === 'function') {
                        window._adminDisbRecipChange();
                    }
                    if (typeof window._selectDisbMethod === 'function') {
                        window._selectDisbMethod(window._currentDisbMethod || 'bank');
                    }
                }
                if (targetId === 'admin-media-migration-tab' && typeof window._adminResumeMediaMigrationPoll === 'function') {
                    // Re-attach to an in-progress job if the admin switched tabs
                    // and came back — the job keeps running server-side either way.
                    window._adminResumeMediaMigrationPoll();
                }
                if (targetId === 'admin-adverts-tab' && typeof window._adminLoadAdvertsList === 'function') {
                    window._adminLoadAdvertsList();
                }
                if (targetId === 'admin-branding-tab' && typeof window._adminRefreshBrandingPanel === 'function') {
                    window._adminRefreshBrandingPanel();
                }
                if (targetId === 'admin-election-tab' && typeof window._adminLoadElectionControl === 'function') {
                    window._adminLoadElectionControl();
                }
                if (targetId === 'admin-election-tab' && typeof window._adminLoadElectionFlags === 'function') {
                    window._adminLoadElectionFlags();
                }
                if (targetId === 'admin-election-tab' && typeof window._adminLoadElectionResultsPanel === 'function') {
                    window._adminLoadElectionResultsPanel();
                }
                if (targetId === 'admin-scholarship-tab' && typeof window._adminLoadScholarships === 'function') {
                    window._adminLoadScholarships();
                }
                if (targetId === 'admin-celebration-tab' && typeof window._adminLoadCelebrations === 'function') {
                    window._adminLoadCelebrations();
                }
                if (targetId === 'admin-facebook-tab' && typeof window._adminLoadFacebookSync === 'function') {
                    window._adminLoadFacebookSync();
                }
                if (targetId === 'admin-sos-donations-tab' && typeof window._adminLoadSosDonations === 'function') {
                    window._adminLoadSosDonations();
                }
            }

            adminSection.addEventListener('click', function(e) {
                const btn = e.target.closest('.admin-nav-tab');
                if (btn && btn.dataset.tab) switchAdminTab(btn.dataset.tab);
            });

            window._switchAdminTab = switchAdminTab;

            /* BUG FIX: Delegated change handler for disb-recip-type radios.
               Inline onchange may not fire if the function isn't yet defined
               at the moment the radio fires (script load ordering issue).
               This delegated listener is always live and overrides the inline. */
            document.addEventListener('change', function(e) {
                var t = e.target;
                if (t && t.name === 'disb-recip-type') {
                    if (typeof window._adminDisbRecipChange === 'function') {
                        window._adminDisbRecipChange();
                    }
                }
            });

            /* Also re-wire the Initiate Disbursement button via delegation
               so it works regardless of wrapper chain issues */
            document.addEventListener('click', function(e) {
                var btn = e.target.closest && e.target.closest(
                    'button[onclick*="_adminInitiateDisbursement"],' +
                    '#disb-initiate-btn'
                );
                if (btn && !btn._disbDelegated) {
                    btn._disbDelegated = true;
                    /* The onclick attribute still fires; delegation is a safety net */
                }
            });

            console.log('[Admin] ✅ Tab switching wired');
        })();

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — BRANDING (dashboard header logo)
        // Writes to app_config/branding.headerLogoDataUrl in Firestore. The
        // runtime side of this lives in app-nav.js: buildHeader() reads
        // window._empCurrentLogoSrc() (falls back to the shipped default
        // logo when no override is set), and a live onSnapshot listener
        // there keeps window._empBranding in sync and re-renders the header
        // the instant this doc changes — so every open tab/session across
        // every signed-in user picks up a new logo immediately, without a
        // reload, the moment an admin saves one here.
        // ═══════════════════════════════════════════════════════════════════
        (function initAdminBrandingPanel() {
            var MAX_DIM = 240;

            function _els() {
                return {
                    input:       document.getElementById('admin-branding-logo-input'),
                    currentImg:  document.getElementById('admin-branding-current-logo'),
                    previewImg:  document.getElementById('admin-branding-preview-logo'),
                    previewPlaceholder: document.getElementById('admin-branding-preview-placeholder'),
                    saveBtn:     document.getElementById('admin-branding-save-btn'),
                    resetBtn:    document.getElementById('admin-branding-reset-btn'),
                    feedback:    document.getElementById('admin-branding-feedback')
                };
            }

            function _feedback(msg, type) {
                var el = document.getElementById('admin-branding-feedback');
                if (!el) return;
                var color = type === 'error' ? 'var(--danger-color, #EF4444)' : type === 'success' ? 'var(--success-color, #10B981)' : 'var(--text-muted)';
                el.style.color = color;
                el.textContent = msg || '';
            }

            var _pendingDataUrl = null;

            function _resizeToSquareDataUrl(file, callback) {
                var reader = new FileReader();
                reader.onerror = function () { callback(null, 'Could not read that file.'); };
                reader.onload = function () {
                    var img = new Image();
                    img.onerror = function () { callback(null, 'That file isn\'t a readable image.'); };
                    img.onload = function () {
                        try {
                            var side = Math.min(img.naturalWidth, img.naturalHeight);
                            var sx = (img.naturalWidth  - side) / 2;
                            var sy = (img.naturalHeight - side) / 2;
                            var canvas = document.createElement('canvas');
                            canvas.width = MAX_DIM;
                            canvas.height = MAX_DIM;
                            var ctx = canvas.getContext('2d');
                            ctx.drawImage(img, sx, sy, side, side, 0, 0, MAX_DIM, MAX_DIM);
                            // PNG first (crisp on logos/text); if that comes out large
                            // (e.g. a busy photo), fall back to JPEG to keep the
                            // Firestore doc small — a header badge doesn't need
                            // lossless quality at 240x240.
                            var pngUrl = canvas.toDataURL('image/png');
                            if (pngUrl.length <= 260000) { callback(pngUrl, null); return; }
                            var jpgUrl = canvas.toDataURL('image/jpeg', 0.85);
                            callback(jpgUrl, null);
                        } catch (e) {
                            callback(null, 'Could not process that image.');
                        }
                    };
                    img.src = reader.result;
                };
                reader.readAsDataURL(file);
            }

            function _wireInput() {
                var els = _els();
                if (!els.input || els.input._brandingWired) return;
                els.input._brandingWired = true;
                els.input.addEventListener('change', function () {
                    var file = els.input.files && els.input.files[0];
                    if (!file) return;
                    if (!/^image\//.test(file.type)) {
                        _feedback('Please choose an image file.', 'error');
                        return;
                    }
                    _feedback('Processing…');
                    _resizeToSquareDataUrl(file, function (dataUrl, err) {
                        if (err) { _feedback(err, 'error'); return; }
                        _pendingDataUrl = dataUrl;
                        var e = _els();
                        if (e.previewImg) { e.previewImg.src = dataUrl; e.previewImg.style.display = ''; }
                        if (e.previewPlaceholder) e.previewPlaceholder.style.display = 'none';
                        if (e.saveBtn) e.saveBtn.disabled = false;
                        _feedback('Ready — click Save Logo to publish this everywhere.');
                    });
                });
            }

            function _wireSave() {
                var els = _els();
                if (!els.saveBtn || els.saveBtn._brandingWired) return;
                els.saveBtn._brandingWired = true;
                els.saveBtn.addEventListener('click', function () {
                    if (!_pendingDataUrl) return;
                    if (!window.fbDb || typeof window.fbDb.collection !== 'function') {
                        _feedback('Not connected — try again in a moment.', 'error');
                        return;
                    }
                    els.saveBtn.disabled = true;
                    _feedback('Saving…');
                    var uid = (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || null;
                    window.fbDb.collection('app_config').doc('branding').set({
                        headerLogoDataUrl: _pendingDataUrl,
                        updatedAt: window.fbDb.FieldValue ? window.fbDb.FieldValue.serverTimestamp() : new Date(),
                        updatedBy: uid
                    }, { merge: true }).then(function () {
                        _feedback('Saved — the new logo is now live for everyone.', 'success');
                        if (typeof window.showNotification === 'function') {
                            window.showNotification('Dashboard header logo updated', 'success');
                        }
                        _pendingDataUrl = null;
                        var e = _els();
                        if (e.saveBtn) e.saveBtn.disabled = true;
                        if (e.input) e.input.value = '';
                        // window._empBranding / the CURRENT preview will refresh on
                        // their own via app-nav.js's live onSnapshot listener — no
                        // need to touch them here.
                    }).catch(function (err) {
                        _feedback('Could not save: ' + (err && err.message ? err.message : err), 'error');
                        if (els.saveBtn) els.saveBtn.disabled = false;
                    });
                });
            }

            function _wireReset() {
                var els = _els();
                if (!els.resetBtn || els.resetBtn._brandingWired) return;
                els.resetBtn._brandingWired = true;
                els.resetBtn.addEventListener('click', function () {
                    if (els.resetBtn._confirming) {
                        if (!window.fbDb || typeof window.fbDb.collection !== 'function') return;
                        _feedback('Resetting…');
                        window.fbDb.collection('app_config').doc('branding').set({
                            headerLogoDataUrl: null,
                            updatedAt: window.fbDb.FieldValue ? window.fbDb.FieldValue.serverTimestamp() : new Date()
                        }, { merge: true }).then(function () {
                            _feedback('Reset — back to the default logo for everyone.', 'success');
                            _pendingDataUrl = null;
                            var e = _els();
                            if (e.saveBtn) e.saveBtn.disabled = true;
                            if (e.previewImg) e.previewImg.style.display = 'none';
                            if (e.previewPlaceholder) e.previewPlaceholder.style.display = '';
                            if (e.input) e.input.value = '';
                        }).catch(function (err) {
                            _feedback('Could not reset: ' + (err && err.message ? err.message : err), 'error');
                        });
                        els.resetBtn._confirming = false;
                        els.resetBtn.innerHTML = '<i class="fas fa-rotate-left"></i> Reset to Default';
                        return;
                    }
                    els.resetBtn._confirming = true;
                    els.resetBtn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Click again to confirm';
                    setTimeout(function () {
                        if (!els.resetBtn) return;
                        els.resetBtn._confirming = false;
                        els.resetBtn.innerHTML = '<i class="fas fa-rotate-left"></i> Reset to Default';
                    }, 4000);
                });
            }

            function refreshBrandingPanel() {
                _wireInput();
                _wireSave();
                _wireReset();
                var els = _els();
                var current = typeof window._empCurrentLogoSrc === 'function' ? window._empCurrentLogoSrc() : '';
                if (els.currentImg && current) els.currentImg.src = current;
            }

            window._adminRefreshBrandingPanel = refreshBrandingPanel;
        })();

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — ELECTION RESULTS (AUTO-TALLIED FROM POLLING UNITS)
        //
        // REWORKED (2026-09-24): admins no longer type results in. People at
        // polling units upload their own result (tally + photo of the sheet)
        // from the Election Hub; app-patch-v49-v50.js's submitPuResult()
        // writes election_pu_results/{unit} AND bumps the running totals in
        // election_results/current in the SAME transaction, so the public
        // Dashboard (app-news.js) updates the moment a result lands.
        //
        // What an admin does here:
        //   • watch the live tally (read-only),
        //   • review submissions (photo next to the typed numbers) and
        //     DECLINE any that don't tally — declining deletes the result,
        //     subtracts its numbers from the running totals in the same
        //     transaction, and frees that polling unit for a corrected upload,
        //   • APPROVE a flagged result once they've checked the photo.
        // Everything goes straight to Firestore (rules: isAdmin()) — no
        // server.js routes involved, so it works wherever the app is hosted.
        // "Recalculate totals" rebuilds election_results/current from the
        // submissions themselves (repair tool, and clears any old hand-typed
        // figures left in that doc).
        // ═══════════════════════════════════════════════════════════════════
        (function initElectionReviewPanel() {
            /* Candidates / election now come from the election selected in the Challenge Control cards above
               (initElectionChallengeAdmin): window._adminElectionCandidates() / window._adminElectionSelected(). */
            function _cands() { return (typeof window._adminElectionCandidates === 'function') ? window._adminElectionCandidates() : []; }
            function _ev() { return (typeof window._adminElectionSelected === 'function') ? window._adminElectionSelected() : { id: 'ng-president-2027', legacy: true }; }
            function _aggId(ev) { return (ev && !ev.legacy) ? ev.id : 'current'; }
            var _tallyUnsub = null;
            var _rows = [];
            var _filter = 'all';

            function _esc(s) {
                return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
                });
            }
            function _toast(msg, type) {
                if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
            }
            function _feedback(msg, type) {
                var el = document.getElementById('admin-election-feedback');
                if (!el) return;
                el.style.color = type === 'error' ? '#e53935' : (type === 'success' ? '#22c55e' : 'var(--text-muted)');
                el.textContent = msg;
            }
            function _adminEmail() { return (fbAuth && fbAuth.currentUser && fbAuth.currentUser.email) || null; }
            function _FV() { return firebase.firestore.FieldValue; }

            /* ── live tally (read-only) ─────────────────────────────────── */
            function loadLiveTally() {
                var host = document.getElementById('admin-election-live');
                if (!host) return;
                if (!fbDb) { host.innerHTML = '<div style="color:#e53935;font-size:0.85rem;">Not connected to the database.</div>'; return; }
                host.innerHTML = '<div style="text-align:center;padding:14px 0;color:var(--text-muted);font-size:0.85rem;">Loading\u2026</div>';
                if (_tallyUnsub) { try { _tallyUnsub(); } catch (e0) {} _tallyUnsub = null; }
                _tallyUnsub = fbDb.collection('election_results').doc(_aggId(_ev())).onSnapshot(function (doc) {
                    var d = doc.exists ? (doc.data() || {}) : {};
                    var cands = d.candidates || {};
                    var total = _cands().reduce(function (s, c) { return s + Number(cands[c.id] || 0); }, 0);
                    var units = Number(d.unitsReported || 0);
                    var su = d.stateUnits || {};
                    var states = Object.keys(su).filter(function (k) { return Number(su[k]) > 0; }).length;
                    var rows = _cands().map(function (c) {
                        var v = Number(cands[c.id] || 0);
                        var pct = total > 0 ? (v / total * 100) : 0;
                        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px;">' +
                            '<div style="flex:0 0 150px;font-size:0.82rem;font-weight:700;">' + _esc(c.name) + ' <span style="color:var(--text-muted);font-weight:500;">(' + _esc(c.party) + ')</span></div>' +
                            '<div style="flex:1;height:14px;border-radius:7px;background:rgba(10,14,39,0.06);overflow:hidden;"><div style="height:100%;width:' + pct.toFixed(1) + '%;background:' + c.color + ';"></div></div>' +
                            '<div style="flex:0 0 96px;text-align:right;font-size:0.8rem;font-weight:800;">' + v.toLocaleString() + ' <span style="color:var(--text-muted);font-weight:600;">(' + pct.toFixed(1) + '%)</span></div>' +
                            '</div>';
                    }).join('');
                    host.innerHTML =
                        '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:12px;">' +
                        '<strong>' + units.toLocaleString() + '</strong> polling unit' + (units === 1 ? '' : 's') + ' reported \u00B7 ' +
                        '<strong>' + states + '</strong> state' + (states === 1 ? '' : 's') + ' reporting \u00B7 ' +
                        '<strong>' + total.toLocaleString() + '</strong> total votes' +
                        (d.updatedAt ? (' \u00B7 updated ' + _esc(new Date(d.updatedAt).toLocaleString())) : '') +
                        '</div>' + rows;
                }, function (err) {
                    host.innerHTML = '<div style="color:#e53935;font-size:0.85rem;">Could not load the tally: ' + _esc(err && err.message) + '</div>';
                });
            }

            /* Rebuild election_results/current from the submissions. */
            async function recalcTotals(btn) {
                if (!fbDb) return;
                if (!btn._confirming) {
                    btn._confirming = true;
                    btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Click again to confirm';
                    setTimeout(function () { btn._confirming = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Recalculate totals'; }, 4000);
                    return;
                }
                btn._confirming = false;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Recalculating\u2026';
                _feedback('Reading all submissions\u2026', 'info');
                try {
                    var ev = _ev();
                    var cands = {}; _cands().forEach(function (c) { cands[c.id] = 0; });
                    var stateUnits = {}; var units = 0; var last = null;
                    for (;;) {
                        var q = fbDb.collection('election_pu_results');
                        if (!ev.legacy) q = q.where('electionId', '==', ev.id);
                        q = q.orderBy(firebase.firestore.FieldPath.documentId()).limit(500);
                        if (last) q = q.startAfter(last);
                        var snap = await q.get();
                        if (snap.empty) break;
                        snap.forEach(function (doc) {
                            var d = doc.data() || {}; var t = d.tally || {};
                            if (ev.legacy && d.electionId) return; // belongs to a different election
                            units++;
                            Object.keys(t).forEach(function (k) { cands[k] = (cands[k] || 0) + Number(t[k] || 0); });
                            if (d.state) stateUnits[d.state] = (stateUnits[d.state] || 0) + 1;
                        });
                        last = snap.docs[snap.docs.length - 1];
                        if (snap.size < 500) break;
                    }
                    await fbDb.collection('election_results').doc(_aggId(ev)).set({
                        candidates: cands, unitsReported: units, stateUnits: stateUnits,
                        updatedAt: new Date().toISOString(), recalculatedBy: _adminEmail()
                    });
                    _feedback('Totals rebuilt from ' + units.toLocaleString() + ' submission' + (units === 1 ? '' : 's') + '.', 'success');
                    loadLiveTally();
                } catch (err) {
                    _feedback('Recalculate failed: ' + (err && err.message ? err.message : 'try again.'), 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-rotate"></i> Recalculate totals';
                }
            }

            /* ── submissions review ─────────────────────────────────────── */
            function _tallyHtml(t) {
                t = t || {};
                return _cands().map(function (c) {
                    return '<span style="display:inline-block;margin:0 10px 4px 0;font-size:0.78rem;"><span style="color:' + c.color + ';font-weight:800;">' + _esc(c.party) + '</span> ' + Number(t[c.id] || 0).toLocaleString() + '</span>';
                }).join('');
            }

            function _render() {
                var host = document.getElementById('admin-election-flags-list');
                if (!host) return;
                var rows = _filter === 'flagged' ? _rows.filter(function (r) { return r.flagged; }) : _rows;
                if (!rows.length) {
                    host.innerHTML = '<div style="text-align:center;padding:18px 0;color:var(--text-muted);font-size:0.85rem;">' +
                        (_filter === 'flagged' ? 'No flagged results right now.' : 'No polling unit results uploaded yet.') + '</div>';
                    return;
                }
                host.innerHTML = rows.map(function (r) {
                    var when = r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
                    var photos = (r.images || []).slice(0, 4).map(function (u) {
                        return '<img src="' + _esc(u) + '" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;cursor:pointer;" onclick="window.open(this.src,\'_blank\')">';
                    }).join('');
                    return '<div class="admin-ef-card" data-key="' + _esc(r.key) + '" style="border:1.5px solid ' + (r.flagged ? '#e53935' : 'rgba(10,14,39,0.12)') + ';border-radius:14px;padding:12px 14px;margin-bottom:10px;">' +
                        '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
                        '<div><div style="font-weight:800;font-size:0.88rem;">' + _esc(r.pollingUnit || '') + '</div>' +
                        '<div style="font-size:0.74rem;color:var(--text-muted);">' + _esc(r.ward || '') + ', ' + _esc(r.lga || '') + ', ' + _esc(r.state || '') + '</div></div>' +
                        '<div style="font-size:0.74rem;color:var(--text-muted);text-align:right;white-space:nowrap;">' + _esc(r.uploaderName || '') + '<br>' + _esc(when) + '</div>' +
                        '</div>' +
                        '<div style="margin-bottom:8px;">' + _tallyHtml(r.tally) + '</div>' +
                        (r.flagged ? '<div style="font-size:0.78rem;color:#e53935;margin-bottom:8px;"><i class="fas fa-triangle-exclamation"></i> ' + _esc(r.flagReason || 'Typed tally didn\u2019t match the uploaded photo.') + '</div>' : '') +
                        (photos ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' + photos + '</div>' : '') +
                        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                        (r.flagged ? '<button type="button" class="btn admin-ef-dismiss-btn" style="padding:8px 14px;border-radius:10px;font-size:0.78rem;font-weight:700;"><i class="fas fa-check"></i> Approve</button>' : '') +
                        '<button type="button" class="btn admin-ef-remove-btn" style="padding:8px 14px;border-radius:10px;font-size:0.78rem;font-weight:700;background:#e53935;color:#fff;"><i class="fas fa-trash"></i> Decline</button>' +
                        '</div></div>';
                }).join('');

                host.querySelectorAll('.admin-ef-dismiss-btn').forEach(function (b) { b.addEventListener('click', function () { approve(b); }); });
                host.querySelectorAll('.admin-ef-remove-btn').forEach(function (b) { b.addEventListener('click', function () { decline(b); }); });
            }

            function _keyOf(btn) { var c = btn.closest('.admin-ef-card'); return c && c.dataset.key; }

            function approve(btn) {
                var key = _keyOf(btn); if (!key || !fbDb) return;
                btn.disabled = true;
                fbDb.collection('election_pu_results').doc(key).update({
                    flagged: false, reviewedAt: new Date().toISOString(), reviewedBy: _adminEmail()
                }).then(function () {
                    _rows.forEach(function (r) { if (r.key === key) r.flagged = false; });
                    _render(); _toast('Result approved', 'success');
                }).catch(function (err) {
                    btn.disabled = false; _toast('Could not approve: ' + (err && err.message), 'error');
                });
            }

            /* Decline = delete the result AND subtract it from the running
               totals, in one transaction, so the public numbers never drift. */
            function decline(btn) {
                if (!btn._confirming) {
                    btn._confirming = true;
                    btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Click again to decline';
                    setTimeout(function () { btn._confirming = false; btn.innerHTML = '<i class="fas fa-trash"></i> Decline'; }, 4000);
                    return;
                }
                var key = _keyOf(btn); if (!key || !fbDb) return;
                btn.disabled = true;
                var _row = _rows.filter(function (r) { return r.key === key; })[0];
                var ref = fbDb.collection('election_pu_results').doc(key);
                var agg = fbDb.collection('election_results').doc(_row && _row.electionId ? _row.electionId : 'current');
                fbDb.runTransaction(function (tx) {
                    return tx.get(ref).then(function (doc) {
                        if (!doc.exists) return; // already gone
                        var d = doc.data() || {}; var t = d.tally || {};
                        var dec = {};
                        Object.keys(t).forEach(function (k) { dec[k] = _FV().increment(-Number(t[k] || 0)); });
                        var upd = { candidates: dec, unitsReported: _FV().increment(-1), updatedAt: new Date().toISOString() };
                        if (d.state) { var s = {}; s[d.state] = _FV().increment(-1); upd.stateUnits = s; }
                        tx.delete(ref);
                        tx.set(agg, upd, { merge: true });
                    });
                }).then(function () {
                    _rows = _rows.filter(function (r) { return r.key !== key; });
                    _render(); loadLiveTally(); _toast('Result declined and removed from the totals', 'success');
                }).catch(function (err) {
                    btn.disabled = false; btn._confirming = false; btn.innerHTML = '<i class="fas fa-trash"></i> Decline';
                    _toast('Could not decline: ' + (err && err.message), 'error');
                });
            }

            function loadSubmissions() {
                var host = document.getElementById('admin-election-flags-list');
                if (!host) return;
                if (!fbDb) { host.innerHTML = '<div style="color:#e53935;font-size:0.85rem;">Not connected to the database.</div>'; return; }
                host.innerHTML = '<div style="text-align:center;padding:18px 0;color:var(--text-muted);font-size:0.85rem;">Loading\u2026</div>';
                var _ev0 = _ev();
                var _q = _ev0.legacy
                    ? fbDb.collection('election_pu_results').orderBy('createdAt', 'desc').limit(120)
                    : fbDb.collection('election_pu_results').where('electionId', '==', _ev0.id).limit(200);
                _q.get().then(function (snap) {
                    _rows = [];
                    snap.forEach(function (doc) { var d = doc.data() || {}; if (_ev0.legacy && d.electionId) return; d.key = doc.id; _rows.push(d); });
                    _rows.sort(function (x, y) { return String(y.createdAt || '').localeCompare(String(x.createdAt || '')); });
                    _render();
                }).catch(function (err) {
                    host.innerHTML = '<div style="text-align:center;padding:18px 0;color:#e53935;font-size:0.85rem;">Could not load submissions: ' + _esc(err && err.message) + '</div>';
                });
            }

            /* ── wiring ─────────────────────────────────────────────────── */
            var refreshBtn = document.getElementById('admin-election-flags-refresh-btn');
            if (refreshBtn) refreshBtn.addEventListener('click', function () { loadSubmissions(); loadLiveTally(); });
            var recalcBtn = document.getElementById('admin-election-recalc-btn');
            if (recalcBtn) recalcBtn.addEventListener('click', function () { recalcTotals(recalcBtn); });
            document.querySelectorAll('.admin-election-filter').forEach(function (chip) {
                chip.addEventListener('click', function () {
                    _filter = chip.getAttribute('data-filter') || 'all';
                    document.querySelectorAll('.admin-election-filter').forEach(function (c) {
                        var on = c === chip;
                        c.style.background = on ? 'var(--primary, #1B2B8B)' : 'rgba(10,14,39,0.06)';
                        c.style.color = on ? '#fff' : '#374151';
                    });
                    _render();
                });
            });

            document.addEventListener('admin-election-selection-change', function () { loadSubmissions(); loadLiveTally(); });
            window._adminLoadElectionFlags = loadSubmissions;
            window._adminLoadElectionResultsPanel = loadLiveTally;
        })();

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — ELECTION CHALLENGE CONTROL (2026-11-05)
        //
        // • Master switch for the "I Support My Candidate" challenge portal
        //   (election_config/active.portalActive) — ON when an election season
        //   approaches, OFF when it ends. Read live by app-patch-v49-v50.js.
        // • Elections the admin adds by hand: any year, any office
        //   (presidential, governorship, ...) and any country
        //   (election_events/{id}); each can be opened or closed.
        // • Candidate uploader + manifesto composer for the selected election
        //   (election_candidates/{id}); photo goes to Cloudinary via the app's
        //   existing uploadToCloudinary(). The built-in 2027 Nigeria
        //   presidential line-up can be edited / removed / restored too —
        //   changes are stored as small override docs, never by touching code.
        // Results are never entered here: they stream in from polling-unit
        // uploads (see the tally and submissions panels).
        // ═══════════════════════════════════════════════════════════════════
        (function initElectionChallengeAdmin() {
            var LEGACY_ID = 'ng-president-2027';
            var BUILTIN_EVENT = { id: LEGACY_ID, legacy: true, country: 'NG', countryName: 'Nigeria', office: 'president', officeLabel: 'Presidential',
                year: 2027, region: '', label: 'Nigeria Presidential Election 2027', hashtag: '#Vote2027', open: true, createdAt: '' };
            var BUILTIN_CANDS = [
                { id: 'tinubu',  name: 'Bola Ahmed Tinubu', party: 'APC', partyFull: 'All Progressives Congress',   color: '#00853F' },
                { id: 'atiku',   name: 'Atiku Abubakar',    party: 'ADC', partyFull: 'African Democratic Congress', color: '#1E7A3D' },
                { id: 'obi',     name: 'Peter Obi',         party: 'NDC', partyFull: 'Nigeria Democratic Congress', color: '#1B2260' },
                { id: 'sowore',  name: 'Omoyele Sowore',    party: 'AAC', partyFull: 'African Action Congress',     color: '#5C4033' },
                { id: 'makinde', name: 'Seyi Makinde',      party: 'APM', partyFull: 'Allied Peoples Movement',     color: '#0F2A5C' },
                { id: 'duke',    name: 'Donald Duke',       party: 'PRP', partyFull: 'Peoples Redemption Party',    color: '#B3202A' }
            ];
            var COUNTRIES = [['NG', 'Nigeria'], ['GH', 'Ghana'], ['KE', 'Kenya'], ['ZA', 'South Africa'], ['UG', 'Uganda'], ['TZ', 'Tanzania'],
                ['SN', 'Senegal'], ['CM', 'Cameroon'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['IN', 'India']];
            var OFFICES = [['president', 'Presidential'], ['governor', 'Governorship'], ['senator', 'Senatorial'],
                ['house', 'House of Representatives'], ['mayor', 'Mayoral']];

            var _config = {}, _eventDocs = [], _candDocs = [], _events = [BUILTIN_EVENT];
            var _tpl = {};
            var _selId = LEGACY_ID, _editId = null, _photoFile = null, _logoFile = null, _photoObj = '', _logoObj = '', _alt = null, _started = false, _lastSig = null, _populated = false;

            function _$(id) { return document.getElementById(id); }
            function _esc(v) {
                return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
                    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
                });
            }
            function _toast(m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info'); }
            function _email() { return (fbAuth && fbAuth.currentUser && fbAuth.currentUser.email) || null; }
            function _now() { return new Date().toISOString(); }
            function _say(id, msg, type) {
                var el = _$(id); if (!el) return;
                el.style.color = type === 'error' ? '#e53935' : (type === 'success' ? '#22c55e' : 'var(--text-muted)');
                el.textContent = msg || '';
            }
            function _slug(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, ''); }
            function _tagPart(v) { return String(v || '').replace(/[^A-Za-z0-9]/g, ''); }
            function _title(e) { return e.label || [e.countryName, e.region, e.officeLabel, 'Election', e.year || ''].filter(Boolean).join(' '); }

            /* ── data merge (mirrors the registry in app-patch-v49-v50.js) ── */
            function computeEvents() {
                var leg = Object.assign({}, BUILTIN_EVENT), others = [];
                _eventDocs.forEach(function (d) {
                    if (d.id === LEGACY_ID) { leg.open = d.open !== false; return; }
                    var yr = Number(d.year) || 0;
                    others.push({ id: d.id, legacy: false, country: d.country || '', countryName: d.countryName || d.country || '', office: d.office || '',
                        officeLabel: d.officeLabel || '', year: yr, region: d.region || '', label: d.label || '', hashtag: d.hashtag || ('#Vote' + yr),
                        open: d.open !== false, createdAt: d.createdAt || '' });
                });
                _events = [leg].concat(others).sort(function (a, b) { return (b.year - a.year) || String(a.createdAt).localeCompare(String(b.createdAt)); });
                if (!_events.some(function (e) { return e.id === _selId; })) _selId = LEGACY_ID;
            }
            function selected() {
                for (var i = 0; i < _events.length; i++) if (_events[i].id === _selId) return _events[i];
                return _events[0];
            }
            function candidatesFor(ev) {
                var out = [], used = {}, byId = {};
                var docs = _candDocs.filter(function (d) { return d.electionId === ev.id; });
                docs.forEach(function (d) { byId[d.slot || d.id] = d; });
                if (ev.legacy) {
                    BUILTIN_CANDS.forEach(function (b) {
                        var o = byId[b.id]; used[b.id] = true;
                        var c = Object.assign({}, b, { builtin: true, removed: false, photoUrl: '', logoUrl: '', manifesto: '', docId: b.id });
                        if (o) {
                            ['name', 'party', 'partyFull', 'color', 'photoUrl', 'logoUrl', 'manifesto'].forEach(function (k) { if (o[k]) c[k] = o[k]; });
                            c.removed = !!o.removed;
                        }
                        out.push(c);
                    });
                }
                docs.slice().sort(function (x, y) { return Number(x.order || 0) - Number(y.order || 0); }).forEach(function (d) {
                    if (used[d.slot || d.id] || !d.name) return;
                    out.push({ id: d.slot || d.id, docId: d.id, slot: d.slot || '', name: d.name, party: d.party || '', partyFull: d.partyFull || '', color: d.color || '#1B2B8B',
                        photoUrl: d.photoUrl || '', logoUrl: d.logoUrl || '', manifesto: d.manifesto || '', removed: !!d.removed, builtin: false });
                });
                return out;
            }
            window._adminElectionSelected = selected;
            window._adminElectionCandidates = function () { return candidatesFor(selected()).filter(function (c) { return !c.removed; }); };

            function _maybeEmit() {
                var sig = _selId + '|' + JSON.stringify(candidatesFor(selected()).map(function (c) { return [c.id, c.removed, c.party]; }));
                if (sig !== _lastSig) { _lastSig = sig; document.dispatchEvent(new CustomEvent('admin-election-selection-change')); }
            }

            /* effective portal state: election_config/active, or the app_config/branding fallback when the former is refused by the rules
               (the most recently written wins - mirrors portalOpen() in app-patch-v49-v50.js) */
            function _portalOn() {
                if (_alt && typeof _alt.active === 'boolean' && (typeof _config.portalActive !== 'boolean' || String(_alt.at || '') >= String(_config.updatedAt || ''))) return _alt.active;
                return _config.portalActive !== false;
            }

            /* ── live previews: the SAME markup/inline styles the public dashboard uses (index.html #dashboard-election-support-container
               and app-patch-v49-v50.js refreshEntryCards), so what is filled in here is what appears there ── */
            function _shortName(n) { var w = String(n || '').trim().split(/\s+/); return w[w.length - 1] || n; }
            function _previewCand() {
                var nm = ((_$('admin-ec-name') || {}).value || '').trim();
                var pt = ((_$('admin-ec-party') || {}).value || '').trim().toUpperCase();
                var list = candidatesFor(selected()).filter(function (c) { return !c.removed; });
                var base = _editId ? (list.filter(function (c) { return c.docId === _editId; })[0] || null) : null;
                if (nm && pt) {
                    return { name: nm, party: pt, color: (_$('admin-ec-color') || {}).value || '#1B2B8B',
                        photoUrl: _photoObj || (base && base.photoUrl) || '', logoUrl: _logoObj || (base && base.logoUrl) || '' };
                }
                return list[0] || null;
            }
            function _homePreview() {
                var host = _$('admin-ec-home-preview'); if (!host) return;
                var ev = selected();
                var list = candidatesFor(ev).filter(function (c) { return !c.removed; }).map(function (c) { return { docId: c.docId, name: c.name, party: c.party }; });
                var nm = ((_$('admin-ec-name') || {}).value || '').trim();
                var pt = ((_$('admin-ec-party') || {}).value || '').trim().toUpperCase();
                if (nm && pt) {
                    if (_editId) { list = list.map(function (c) { return c.docId === _editId ? { docId: c.docId, name: nm, party: pt } : c; }); }
                    else { list.push({ docId: '', name: nm, party: pt }); }
                }
                var chipStyle = 'flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;font-family:inherit;pointer-events:none;';
                var chips = list.map(function (c) {
                    return '<button type="button" tabindex="-1" style="' + chipStyle + '">' + _esc(_shortName(c.name)) +
                        '<br><span style="font-weight:500;color:#0a1a4a;">' + _esc(c.party) + '</span></button>';
                }).join('');
                if (!chips) chips = '<div style="grid-column:1/-1;font-size:0.74rem;color:#6b7280;padding:4px 0;">No candidates yet.</div>';
                host.innerHTML =
                    '<div style="border:1px solid rgba(10,14,39,0.12);border-radius:14px;overflow:hidden;background:#ffffff;">' +
                    '<div style="display:flex;align-items:center;gap:12px;padding:14px 14px 12px;background:#ffffff;color:#0a1a4a;border-bottom:2px solid #d4af37;">' +
                        '<div aria-hidden="true" style="flex-shrink:0;width:42px;height:42px;border-radius:50%;background:#ffffff;border:1.5px solid #0a1a4a;box-sizing:border-box;display:flex;align-items:center;justify-content:center;">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0a1a4a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:22px;height:22px;display:block;"><path d="m9 12 2 2 4-4"/><path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z"/><path d="M22 19H2"/></svg></div>' +
                        '<div style="flex:1;min-width:0;"><div style="font-family:Georgia,\'Times New Roman\',serif;font-size:1.05rem;font-weight:700;line-height:1.15;">Support Your ' + _esc(ev.officeLabel || 'Presidential') + ' Candidate</div>' +
                        '<div style="font-size:0.66rem;font-weight:800;letter-spacing:1.6px;color:#0a1a4a;text-transform:uppercase;margin-top:3px;">' + _esc(ev.hashtag) + ' &middot; Challenge</div></div>' +
                        '<div style="flex-shrink:0;display:flex;align-items:center;min-height:44px;padding:0 18px;border-radius:999px;background:#ffffff;color:#0a1a4a;border:1.5px solid #0a1a4a;box-sizing:border-box;font-weight:800;font-size:0.82rem;">Join</div>' +
                    '</div>' +
                    '<div style="padding:12px 14px 6px;font-size:0.66rem;font-weight:800;letter-spacing:1.2px;color:#0a1a4a;">PICK YOUR CANDIDATE</div>' +
                    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 14px 12px;">' + chips + '</div>' +
                    '</div>';
            }

            /* ── render ── */
            function renderPortal() {
                var tg = _$('admin-election-portal-toggle'), pill = _$('admin-election-portal-pill');
                var on = _portalOn();
                if (tg) tg.checked = on;
                if (pill) {
                    pill.textContent = on ? 'Portal ON \u2014 election season' : 'Portal OFF \u2014 closed';
                    pill.style.background = on ? 'rgba(34,197,94,0.15)' : 'rgba(10,14,39,0.08)';
                    pill.style.color = on ? '#15803d' : '#374151';
                }
            }
            function renderEvents() {
                var sel = _$('admin-election-event-select'), host = _$('admin-election-events-list');
                if (sel) {
                    sel.innerHTML = _events.map(function (e) {
                        return '<option value="' + _esc(e.id) + '"' + (e.id === _selId ? ' selected' : '') + '>' + _esc(_title(e)) + (e.open ? '' : ' (closed)') + '</option>';
                    }).join('');
                }
                if (!host) return;
                host.innerHTML = _events.map(function (e) {
                    var btn = 'padding:6px 11px;border-radius:9px;font-size:0.74rem;font-weight:700;';
                    return '<div class="admin-ee-row" data-id="' + _esc(e.id) + '" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 10px;border:1.5px solid ' +
                        (e.id === _selId ? 'var(--primary,#1B2B8B)' : 'rgba(10,14,39,0.12)') + ';border-radius:12px;margin-bottom:8px;">' +
                        '<div style="flex:1;min-width:150px;"><div style="font-weight:800;font-size:0.84rem;">' + _esc(_title(e)) + '</div>' +
                        '<div style="font-size:0.72rem;color:var(--text-muted);">' + _esc(e.hashtag) + ' &middot; ' + (e.open ? 'Open' : 'Closed') + '</div></div>' +
                        '<button type="button" class="btn admin-ee-manage" style="' + btn + '">Manage</button>' +
                        '<button type="button" class="btn admin-ee-toggle" style="' + btn + '">' + (e.open ? 'Close' : 'Open') + '</button>' +
                        (e.legacy ? '' : '<button type="button" class="btn admin-ee-del" style="' + btn + 'background:#e53935;color:#fff;"><i class="fas fa-trash"></i></button>') +
                        '</div>';
                }).join('');
            }
            function renderRoster() {
                var host = _$('admin-ec-roster'), lab = _$('admin-ec-for');
                var ev = selected();
                if (lab) lab.textContent = '\u2014 ' + _title(ev);
                if (!host) return;
                var list = candidatesFor(ev);
                if (!list.length) { host.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);padding:6px 0;">No candidates yet for this election \u2014 add the first one below.</div>'; return; }
                var btn = 'padding:6px 11px;border-radius:9px;font-size:0.74rem;font-weight:700;';
                host.innerHTML = list.map(function (c) {
                    var av = c.photoUrl
                        ? '<img src="' + _esc(c.photoUrl) + '" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                        : '<div style="width:40px;height:40px;border-radius:50%;flex-shrink:0;background:' + _esc(c.color) + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.62rem;font-weight:800;">' + _esc(String(c.party).slice(0, 4)) + '</div>';
                    var lg = c.logoUrl ? '<img src="' + _esc(c.logoUrl) + '" alt="" title="Party logo" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid rgba(10,14,39,0.14);background:#fff;">' : '';
                    return '<div class="admin-ec-row" data-id="' + _esc(c.id) + '" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border:1px solid rgba(10,14,39,0.12);border-radius:12px;margin-bottom:8px;' + (c.removed ? 'opacity:0.55;' : '') + '">' +
                        av + lg + '<div style="flex:1;min-width:130px;"><div style="font-weight:800;font-size:0.84rem;">' + _esc(c.name) + '</div>' +
                        '<div style="font-size:0.72rem;color:var(--text-muted);">' + _esc(c.party) + (c.partyFull && c.partyFull !== c.party ? ' &middot; ' + _esc(c.partyFull) : '') + (c.removed ? ' &middot; removed' : '') + '</div></div>' +
                        (c.removed
                            ? '<button type="button" class="btn admin-ec-restore" style="' + btn + '">Restore</button>'
                            : '<button type="button" class="btn admin-ec-edit" style="' + btn + '">Edit</button>' +
                              '<button type="button" class="btn admin-ec-remove" style="' + btn + 'background:#e53935;color:#fff;"><i class="fas fa-trash"></i></button>') +
                        '</div>';
                }).join('');
            }
            function renderAll() { computeEvents(); renderPortal(); renderEvents(); renderRoster(); _maybeEmit(); _homePreview(); _tplPreview(); }

            /* ── Firestore subscriptions (started the first time the Election tab opens) ── */
            function start() {
                if (_started || typeof fbDb === 'undefined' || !fbDb) return;
                _started = true;
                function toList(snap) { var o = []; snap.forEach(function (d) { var v = d.data() || {}; v.id = d.id; o.push(v); }); return o; }
                function bad(err) { _say('admin-ee-feedback', 'Could not read election settings: ' + (err && err.message) + ' (the Firestore rules for election_config / election_events / election_candidates may not be deployed yet).', 'error'); }
                fbDb.collection('election_config').doc('active').onSnapshot(function (d) { _config = d.exists ? (d.data() || {}) : {}; renderPortal(); }, bad);
                fbDb.collection('election_events').onSnapshot(function (s2) { _eventDocs = toList(s2); renderAll(); }, bad);
                fbDb.collection('election_candidates').onSnapshot(function (s2) { _candDocs = toList(s2); renderAll(); }, bad);
                fbDb.collection('election_template').doc('active').onSnapshot(function (d) { _tpl = d.exists ? (d.data() || {}) : {}; fillTemplateForm(false); }, bad);
                /* fallback copy of the portal switch (used when election_config/active is refused by the Firestore rules) */
                fbDb.collection('app_config').doc('branding').onSnapshot(function (d) {
                    var v = d.exists ? (d.data() || {}) : {};
                    _alt = (typeof v.electionPortalActive === 'boolean') ? { active: v.electionPortalActive, at: v.electionPortalAt || '' } : null;
                    renderPortal();
                }, function () {});
            }

            function populate() {
                if (_populated) return; _populated = true;
                var c = _$('admin-ee-country'), o = _$('admin-ee-office');
                if (c) c.innerHTML = COUNTRIES.map(function (x) { return '<option value="' + x[0] + '">' + _esc(x[1]) + '</option>'; }).join('') + '<option value="__other">Other country\u2026</option>';
                if (o) o.innerHTML = OFFICES.map(function (x) { return '<option value="' + x[0] + '">' + _esc(x[1]) + '</option>'; }).join('') + '<option value="__other">Other office\u2026</option>';
                if (c) c.addEventListener('change', function () { var i = _$('admin-ee-country-custom'); if (i) i.style.display = c.value === '__other' ? 'block' : 'none'; });
                if (o) o.addEventListener('change', function () { var i = _$('admin-ee-office-custom'); if (i) i.style.display = o.value === '__other' ? 'block' : 'none'; });
            }

            /* ── master switch ── */
            var tg = _$('admin-election-portal-toggle');
            if (tg) tg.addEventListener('change', function () {
                if (!fbDb) { tg.checked = !tg.checked; return; }
                /* FIX (2026-11-06 - "OFF works but ON doesn't respond to taps"): the switch used to be disabled until Firestore confirmed the save,
                   and on a slow connection that confirmation can take very long (or never come), so the switch stayed locked after the first tap.
                   It is never locked now: every tap saves immediately (writes to the same docs apply in order, so the latest tap wins), and only
                   the most recent tap may revert the switch if its save is refused. */
                var on = tg.checked, stamp = _now();
                var _seq = (window._empPortalTapSeq = (window._empPortalTapSeq || 0) + 1);
                /* FIX (2026-11-06): always save BOTH copies. The public home page can only be sure to read app_config/branding, so the old
                   "only write it if election_config fails" left visitors on a stale value whenever election_config accepted the write. */
                var _lastErr = null;
                var _w1 = fbDb.collection('election_config').doc('active').set({ portalActive: on, updatedAt: stamp, updatedBy: _email() }, { merge: true })
                    .then(function () { return true; }, function (err) { _lastErr = err; console.warn('[ElectionAdmin] election_config write refused (' + (err && err.code) + ')'); return false; });
                var _w2 = fbDb.collection('app_config').doc('branding').set({ electionPortalActive: on, electionPortalAt: stamp, electionPortalBy: _email() }, { merge: true })
                    .then(function () { return true; }, function (err) { _lastErr = err; console.warn('[ElectionAdmin] app_config write refused (' + (err && err.code) + ')'); return false; });
                Promise.all([_w1, _w2])
                    .then(function (r) { if (!r[0] && !r[1]) throw _lastErr || new Error('Write refused'); })
                    .then(function () { _toast(on ? 'Challenge portal switched ON' : 'Challenge portal switched OFF', 'success'); })
                    .catch(function (err) {
                        if (_seq !== window._empPortalTapSeq) return; /* a newer tap already took over */
                        tg.checked = !on;
                        /* both writes were refused = Firestore does not see this session as an admin (firebase-rules.js isAdmin()): say which session it sees */
                        var u = fbAuth && fbAuth.currentUser, who;
                        if (!u) who = 'This device is not signed in to Firebase (the admin session is local-only).';
                        else if (u.isAnonymous) who = 'This is an anonymous Firebase session, not an admin account.';
                        else who = 'Firebase sees you as ' + (u.email || u.uid) + ', which the rules do not accept as an admin.';
                        console.warn('[ElectionAdmin] portal switch refused:', err && err.code, who);
                        _toast('Could not change the portal switch: ' + (err && err.message) + ' ' + who + ' Sign out, log in again through the admin login with the chief-admin email, and make sure the updated firebase-rules.js is published.', 'error');
                    });
            });

            /* ── elections ── */
            var evSel = _$('admin-election-event-select');
            if (evSel) evSel.addEventListener('change', function () { _selId = evSel.value; cancelEdit(); renderEvents(); renderRoster(); _maybeEmit(); });

            var evList = _$('admin-election-events-list');
            if (evList) evList.addEventListener('click', function (e) {
                var t = e.target.closest ? e.target.closest('button') : null;
                var row = e.target.closest ? e.target.closest('.admin-ee-row') : null;
                if (!t || !row || !fbDb) return;
                var id = row.getAttribute('data-id');
                var ev = _events.filter(function (x) { return x.id === id; })[0];
                if (!ev) return;
                if (t.classList.contains('admin-ee-manage')) { _selId = id; cancelEdit(); renderEvents(); renderRoster(); _maybeEmit(); return; }
                if (t.classList.contains('admin-ee-toggle')) {
                    t.disabled = true;
                    fbDb.collection('election_events').doc(id).set({ open: !ev.open, updatedAt: _now(), updatedBy: _email() }, { merge: true })
                        .then(function () { _toast(_title(ev) + (ev.open ? ' closed' : ' opened'), 'success'); })
                        .catch(function (err) { t.disabled = false; _toast('Could not update: ' + (err && err.message), 'error'); });
                    return;
                }
                if (t.classList.contains('admin-ee-del')) {
                    if (!t._confirming) {
                        t._confirming = true; t.innerHTML = 'Click again to delete';
                        setTimeout(function () { t._confirming = false; t.innerHTML = '<i class="fas fa-trash"></i>'; }, 4000);
                        return;
                    }
                    t.disabled = true;
                    var batch = fbDb.batch();
                    batch.delete(fbDb.collection('election_events').doc(id));
                    _candDocs.filter(function (d) { return d.electionId === id; }).forEach(function (d) { batch.delete(fbDb.collection('election_candidates').doc(d.id)); });
                    batch.commit()
                        .then(function () { _toast('Election removed (uploaded polling-unit results are kept)', 'success'); })
                        .catch(function (err) { t.disabled = false; _toast('Could not delete: ' + (err && err.message), 'error'); });
                }
            });

            var addBtn = _$('admin-ee-add-btn');
            if (addBtn) addBtn.addEventListener('click', function () {
                if (!fbDb) return;
                var cSel = _$('admin-ee-country').value, oSel = _$('admin-ee-office').value;
                var cc, cname, off, offLabel;
                if (cSel === '__other') {
                    cname = (_$('admin-ee-country-custom').value || '').trim();
                    if (!cname) { _say('admin-ee-feedback', 'Enter the country name.', 'error'); return; }
                    cc = (cname.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()) || 'XX';
                } else {
                    cc = cSel; cname = (COUNTRIES.filter(function (x) { return x[0] === cSel; })[0] || [cSel, cSel])[1];
                }
                if (oSel === '__other') {
                    offLabel = (_$('admin-ee-office-custom').value || '').trim();
                    if (!offLabel) { _say('admin-ee-feedback', 'Enter the office name.', 'error'); return; }
                    off = _slug(offLabel);
                } else {
                    off = oSel; offLabel = (OFFICES.filter(function (x) { return x[0] === oSel; })[0] || [oSel, oSel])[1];
                }
                var yr = parseInt(_$('admin-ee-year').value, 10);
                if (!yr || yr < 2000 || yr > 2100) { _say('admin-ee-feedback', 'Enter a valid election year (2000\u20132100).', 'error'); return; }
                var region = (_$('admin-ee-region').value || '').trim();
                if (off === 'governor' && !region) { _say('admin-ee-feedback', 'A governorship election needs its state / region.', 'error'); return; }
                var label = (_$('admin-ee-label').value || '').trim();
                var id = _slug([cc, off, region, yr].filter(Boolean).join('-'));
                if (_events.some(function (e) { return e.id === id; })) { _say('admin-ee-feedback', 'That election already exists.', 'error'); return; }
                var hashtag = '#Vote' + yr + (cc !== 'NG' ? _tagPart(cc) : '') + (off !== 'president' ? _tagPart(offLabel) : '') + _tagPart(region);
                addBtn.disabled = true;
                fbDb.collection('election_events').doc(id).set({
                    country: cc, countryName: cname, office: off, officeLabel: offLabel, year: yr, region: region, label: label,
                    hashtag: hashtag, open: true, createdAt: _now(), createdBy: _email()
                }).then(function () {
                    _selId = id;
                    ['admin-ee-year', 'admin-ee-region', 'admin-ee-label', 'admin-ee-country-custom', 'admin-ee-office-custom'].forEach(function (x) { var el = _$(x); if (el) el.value = ''; });
                    _say('admin-ee-feedback', 'Election added and opened. Now add its candidates below.', 'success');
                }).catch(function (err) {
                    _say('admin-ee-feedback', 'Could not add the election: ' + (err && err.message), 'error');
                }).finally(function () { addBtn.disabled = false; });
            });

            /* ── candidates ── */
            function cancelEdit() {
                _editId = null; _photoFile = null; _logoFile = null;
                try { if (_photoObj) URL.revokeObjectURL(_photoObj); if (_logoObj) URL.revokeObjectURL(_logoObj); } catch (eR) {}
                _photoObj = ''; _logoObj = '';
                ['admin-ec-name', 'admin-ec-party', 'admin-ec-partyfull', 'admin-ec-manifesto'].forEach(function (x) { var el = _$(x); if (el) el.value = ''; });
                var col = _$('admin-ec-color'); if (col) col.value = '#1B2B8B';
                var pf = _$('admin-ec-photo'); if (pf) pf.value = '';
                var pv = _$('admin-ec-photo-preview'); if (pv) { pv.style.display = 'none'; pv.removeAttribute('src'); }
                var lf = _$('admin-ec-logo'); if (lf) lf.value = '';
                var lv = _$('admin-ec-logo-preview'); if (lv) { lv.style.display = 'none'; lv.removeAttribute('src'); }
                var ttl = _$('admin-ec-form-title'); if (ttl) ttl.textContent = 'Add a candidate';
                var lab = _$('admin-ec-save-label'); if (lab) lab.textContent = 'Save candidate';
                var cb = _$('admin-ec-cancel-btn'); if (cb) cb.style.display = 'none';
                _say('admin-ec-feedback', '');
                _homePreview(); _tplPreview();
            }

            var photoIn = _$('admin-ec-photo');
            if (photoIn) photoIn.addEventListener('change', function () {
                _photoFile = (photoIn.files && photoIn.files[0]) || null;
                try { if (_photoObj) URL.revokeObjectURL(_photoObj); } catch (eR) {}
                _photoObj = _photoFile ? URL.createObjectURL(_photoFile) : '';
                var pv = _$('admin-ec-photo-preview');
                if (pv) { if (_photoFile) { pv.src = _photoObj; pv.style.display = 'block'; } else { pv.style.display = 'none'; } }
                _tplPreview();
            });

            /* party logo uploader (stored as logoUrl - the support-card generator already draws it, see _mergeCand in app-patch-v49-v50.js) */
            var logoIn = _$('admin-ec-logo');
            if (logoIn) logoIn.addEventListener('change', function () {
                _logoFile = (logoIn.files && logoIn.files[0]) || null;
                try { if (_logoObj) URL.revokeObjectURL(_logoObj); } catch (eR) {}
                _logoObj = _logoFile ? URL.createObjectURL(_logoFile) : '';
                var lv = _$('admin-ec-logo-preview');
                if (lv) { if (_logoFile) { lv.src = _logoObj; lv.style.display = 'block'; } else { lv.style.display = 'none'; } }
                _tplPreview();
            });
            ['admin-ec-name', 'admin-ec-party', 'admin-ec-color'].forEach(function (id) {
                var el = _$(id); if (el) el.addEventListener('input', function () { _homePreview(); _tplPreview(); });
            });

            var cancelBtn = _$('admin-ec-cancel-btn');
            if (cancelBtn) cancelBtn.addEventListener('click', cancelEdit);

            var saveBtn = _$('admin-ec-save-btn');
            if (saveBtn) saveBtn.addEventListener('click', async function () {
                if (!fbDb) return;
                var ev = selected();
                var name = (_$('admin-ec-name').value || '').trim();
                var party = (_$('admin-ec-party').value || '').trim().toUpperCase();
                if (!name || !party) { _say('admin-ec-feedback', 'Candidate name and party are required.', 'error'); return; }
                saveBtn.disabled = true;
                _say('admin-ec-feedback', (_photoFile || _logoFile) ? 'Uploading images\u2026' : 'Saving\u2026', 'info');
                try {
                    var photoUrl = null;
                    if (_photoFile) {
                        if (typeof window.uploadToCloudinary !== 'function') throw new Error('Photo upload is not available right now.');
                        photoUrl = await window.uploadToCloudinary(_photoFile);
                    }
                    var logoUrl = null;
                    if (_logoFile) {
                        if (typeof window.uploadToCloudinary !== 'function') throw new Error('Logo upload is not available right now.');
                        logoUrl = await window.uploadToCloudinary(_logoFile);
                    }
                    /* New candidates are tallied under a fixed slot key (s01..s16) — firebase-rules.js can only validate a known key list.
                       Removed candidates keep their slot, so votes already counted are never handed to someone new. */
                    var docId = _editId, slot = null;
                    if (!docId) {
                        var taken = {}; candidatesFor(ev).forEach(function (x) { taken[x.id] = true; });
                        for (var n = 1; n <= 16; n++) { var k = 's' + (n < 10 ? '0' : '') + n; if (!taken[k]) { slot = k; break; } }
                        if (!slot) throw new Error('All 16 candidate slots for this election are in use (removed candidates keep theirs).');
                        docId = ev.id + '__' + slot;
                    }
                    var ref = fbDb.collection('election_candidates').doc(docId);
                    var data = {
                        electionId: ev.id, name: name, party: party,
                        partyFull: (_$('admin-ec-partyfull').value || '').trim() || party,
                        color: _$('admin-ec-color').value || '#1B2B8B', accent: '#D4AF37',
                        manifesto: (_$('admin-ec-manifesto').value || '').trim(),
                        initials: party.slice(0, 4), removed: false, updatedAt: _now(), updatedBy: _email()
                    };
                    if (photoUrl) data.photoUrl = photoUrl;
                    if (logoUrl) data.logoUrl = logoUrl;
                    if (!_editId) { data.order = Date.now(); data.createdAt = _now(); data.slot = slot; }
                    await ref.set(data, { merge: true });
                    _toast(_editId ? 'Candidate updated' : 'Candidate added', 'success');
                    cancelEdit();
                    _say('admin-ec-feedback', 'Saved \u2014 it is live on the challenge now.', 'success');
                } catch (err) {
                    _say('admin-ec-feedback', 'Could not save: ' + (err && err.message ? err.message : 'try again.'), 'error');
                } finally {
                    saveBtn.disabled = false;
                }
            });

            var roster = _$('admin-ec-roster');
            if (roster) roster.addEventListener('click', function (e) {
                var t = e.target.closest ? e.target.closest('button') : null;
                var row = e.target.closest ? e.target.closest('.admin-ec-row') : null;
                if (!t || !row || !fbDb) return;
                var id = row.getAttribute('data-id'), ev = selected();
                var c = candidatesFor(ev).filter(function (x) { return x.id === id; })[0];
                if (!c) return;
                if (t.classList.contains('admin-ec-edit')) {
                    cancelEdit(); _editId = c.docId;
                    _$('admin-ec-name').value = c.name; _$('admin-ec-party').value = c.party;
                    _$('admin-ec-partyfull').value = c.partyFull || ''; _$('admin-ec-color').value = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#1B2B8B';
                    _$('admin-ec-manifesto').value = c.manifesto || '';
                    var pv = _$('admin-ec-photo-preview'); if (pv && c.photoUrl) { pv.src = c.photoUrl; pv.style.display = 'block'; }
                    var lv = _$('admin-ec-logo-preview'); if (lv && c.logoUrl) { lv.src = c.logoUrl; lv.style.display = 'block'; }
                    _$('admin-ec-form-title').textContent = 'Edit candidate';
                    _$('admin-ec-save-label').textContent = 'Save changes';
                    _$('admin-ec-cancel-btn').style.display = '';
                    _homePreview(); _tplPreview();
                    _$('admin-ec-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
                if (t.classList.contains('admin-ec-restore')) {
                    fbDb.collection('election_candidates').doc(c.docId).set({ electionId: ev.id, removed: false, updatedAt: _now(), updatedBy: _email() }, { merge: true })
                        .catch(function (err) { _toast('Could not restore: ' + (err && err.message), 'error'); });
                    return;
                }
                if (t.classList.contains('admin-ec-remove')) {
                    if (!t._confirming) {
                        t._confirming = true; t.innerHTML = 'Click again';
                        setTimeout(function () { t._confirming = false; t.innerHTML = '<i class="fas fa-trash"></i>'; }, 4000);
                        return;
                    }
                    t.disabled = true;
                    /* hide, never delete: the candidate keeps its tally slot so votes already counted stay attributed correctly; Restore brings them back */
                    var op = fbDb.collection('election_candidates').doc(c.docId).set({ electionId: ev.id, removed: true, updatedAt: _now(), updatedBy: _email() }, { merge: true });
                    op.then(function () { _toast('Candidate hidden (votes already counted are kept; use Restore to bring them back)', 'success'); })
                      .catch(function (err) { t.disabled = false; _toast('Could not remove: ' + (err && err.message), 'error'); });
                }
            });


            /* ── support-card TEMPLATE (election_template/active) — edits the wording / accent of the generated
               "I'm proud to support …" card, the spinning ring text and the default share caption. Empty = original wording. ── */
            var TPL_FIELDS = [['bannerText', 'admin-et-banner'], ['ringText', 'admin-et-ring'], ['brandText', 'admin-et-brand'],
                ['tagline', 'admin-et-tagline'], ['captionTemplate', 'admin-et-caption']];
            var TPL_DEFAULTS = { bannerText: 'I\u2019M PROUD TO SUPPORT', ringText: 'I AM PROUD TO SUPPORT', brandText: 'EMPYREAN',
                tagline: '', captionTemplate: 'I\u2019m proud to support {name} {hashtag}', accentColor: '#d4af37' };
            function _tplVal(k, id) { var el = _$(id); var v = el ? (el.value || '').trim() : ''; return v || TPL_DEFAULTS[k]; }
            function _tplFill(str) {
                var ev = selected();
                return String(str).replace(/\{(name|party|hashtag|office|year|country)\}/gi, function (m, k) {
                    k = k.toLowerCase();
                    var pc = _previewCand() || {};
                    return ({ name: pc.name || 'Jane Doe', party: pc.party || 'ABC', hashtag: ev.hashtag, office: ev.officeLabel, year: ev.year, country: ev.countryName })[k] || '';
                });
            }
            function _tplPreview() {
                var el = _$('admin-et-preview'); if (!el) return;
                var pc = _previewCand() || { name: 'Jane Doe', party: 'ABC', color: '#1B2B8B', photoUrl: '', logoUrl: '' };
                var tag = _tplFill(_tplVal('tagline', 'admin-et-tagline'));
                var acc = (_$('admin-et-accent') || {}).value || '#d4af37';
                var last = _shortName(pc.name).toUpperCase();
                var portrait = pc.photoUrl
                    ? '<img src="' + _esc(pc.photoUrl) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">'
                    : '<div style="width:100%;height:100%;border-radius:50%;background:rgba(255,255,255,0.14);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.62rem;font-weight:800;text-align:center;">Add photo</div>';
                var badge = pc.logoUrl
                    ? '<img src="' + _esc(pc.logoUrl) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">'
                    : '<span style="font-size:0.5rem;font-weight:800;color:#0a1a4a;">' + _esc(String(pc.party).slice(0, 4)) + '</span>';
                el.style.background = 'linear-gradient(160deg,#0a1a4a,' + (/^#[0-9a-f]{6}$/i.test(pc.color || '') ? pc.color : '#1B2B8B') + ')';
                el.innerHTML =
                    '<div style="display:flex;align-items:center;gap:12px;">' +
                    '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:0.7rem;letter-spacing:1px;color:' + _esc(acc) + ';font-weight:800;">' + _esc(_tplFill(_tplVal('brandText', 'admin-et-brand')).toUpperCase()) + '</div>' +
                    '<div style="font-size:0.78rem;font-weight:800;margin-top:4px;color:' + _esc(acc) + ';">' + _esc(_tplFill(_tplVal('bannerText', 'admin-et-banner')).toUpperCase()) + '</div>' +
                    '<div style="font-size:1rem;font-weight:800;color:#fff;margin:2px 0;">' + _esc(String(pc.name).toUpperCase()) + '</div>' +
                    '<div style="font-size:0.7rem;color:rgba(255,255,255,0.8);">' + _esc(selected().hashtag) + ' &middot; ' + _esc(pc.party) + '</div>' +
                    (/^\s*$/.test((_$('admin-et-tagline') || {}).value || '') ? '' : '<div style="font-size:0.66rem;font-weight:700;margin-top:4px;color:' + _esc(acc) + ';">' + _esc(tag.toUpperCase()) + '</div>') +
                    '</div>' +
                    '<div style="position:relative;flex-shrink:0;width:74px;height:74px;">' +
                    '<div style="width:74px;height:74px;border-radius:50%;padding:3px;box-sizing:border-box;border:2px solid ' + _esc(acc) + ';">' + portrait + '</div>' +
                    '<div style="position:absolute;right:-6px;bottom:-4px;width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid ' + _esc(acc) + ';box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;">' + badge + '</div>' +
                    '</div></div>' +
                    '<div style="font-size:0.7rem;color:rgba(255,255,255,0.65);margin-top:8px;border-top:1px solid rgba(255,255,255,0.2);padding-top:6px;">Ring: \u2605 ' + _esc(_tplFill(_tplVal('ringText', 'admin-et-ring')).toUpperCase()) + ' ' + _esc(last) + ' \u2605</div>' +
                    '<div style="font-size:0.7rem;color:rgba(255,255,255,0.65);margin-top:4px;">Caption: ' + _esc(_tplFill(_tplVal('captionTemplate', 'admin-et-caption'))) + '</div>';
            }
            function fillTemplateForm(force) {
                TPL_FIELDS.forEach(function (f) {
                    var el = _$(f[1]); if (!el) return;
                    if (!force && w_active() === el) return;
                    el.value = _tpl[f[0]] || '';
                });
                var ac = _$('admin-et-accent'); if (ac && (force || w_active() !== ac)) ac.value = /^#[0-9a-f]{6}$/i.test(_tpl.accentColor || '') ? _tpl.accentColor : '#d4af37';
                _tplPreview();
            }
            function w_active() { return document.activeElement; }
            TPL_FIELDS.forEach(function (f) { var el = _$(f[1]); if (el) el.addEventListener('input', _tplPreview); });
            var accIn = _$('admin-et-accent'); if (accIn) accIn.addEventListener('input', _tplPreview);

            var tplSave = _$('admin-et-save-btn');
            if (tplSave) tplSave.addEventListener('click', function () {
                if (!fbDb) return;
                var data = { updatedAt: _now(), updatedBy: _email() };
                TPL_FIELDS.forEach(function (f) { data[f[0]] = ((_$(f[1]) || {}).value || '').trim(); });
                var acc = (_$('admin-et-accent') || {}).value || '';
                data.accentColor = /^#[0-9a-f]{6}$/i.test(acc) ? acc : '#d4af37';
                tplSave.disabled = true;
                fbDb.collection('election_template').doc('active').set(data, { merge: true })
                    .then(function () { _say('admin-et-feedback', 'Template saved \u2014 new cards use it straight away.', 'success'); })
                    .catch(function (err) { _say('admin-et-feedback', 'Could not save the template: ' + (err && err.message), 'error'); })
                    .finally(function () { tplSave.disabled = false; });
            });
            var tplReset = _$('admin-et-reset-btn');
            if (tplReset) tplReset.addEventListener('click', function () {
                if (!fbDb) return;
                if (!tplReset._confirming) {
                    tplReset._confirming = true; tplReset.textContent = 'Click again to reset';
                    setTimeout(function () { tplReset._confirming = false; tplReset.textContent = 'Reset to default'; }, 4000);
                    return;
                }
                tplReset._confirming = false; tplReset.textContent = 'Reset to default';
                fbDb.collection('election_template').doc('active').delete()
                    .then(function () { _tpl = {}; fillTemplateForm(true); _say('admin-et-feedback', 'Template reset to the original design.', 'success'); })
                    .catch(function (err) { _say('admin-et-feedback', 'Could not reset: ' + (err && err.message), 'error'); });
            });

            populate();
            window._adminLoadElectionControl = function () { populate(); start(); renderAll(); };
        })();

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — MEDIA MIGRATION (Cloudinary -> Firebase Storage)
        // Drives server.js's already-built /api/admin/media-migration/start
        // and /:id/status routes. Both routes require a Firebase ID token
        // from an admin account (see _requireAdminForMediaMigration in
        // server.js), so this reads fbAuth.currentUser.getIdToken() the same
        // way the client already authenticates against Firestore elsewhere
        // in this file — no new auth mechanism introduced.
        // ═══════════════════════════════════════════════════════════════════
        (function initMediaMigrationPanel() {
            var _mmPollTimer = null;
            var _mmCurrentJobId = null;

            function _mmEl(id) { return document.getElementById(id); }

            async function _mmAuthHeader() {
                if (!fbAuth || !fbAuth.currentUser) {
                    throw new Error('Not signed in as admin.');
                }
                var token = await fbAuth.currentUser.getIdToken();
                return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
            }

            function _mmRenderStatus(job) {
                var wrap = _mmEl('mm-progress-wrap');
                if (wrap) wrap.style.display = 'block';

                var total = job.urlsFound || 0;
                var done  = job.urlsProcessed || 0;
                var pct   = total > 0 ? Math.round((done / total) * 100) : (job.status === 'completed' ? 100 : 0);

                var label = _mmEl('mm-status-label');
                if (label) {
                    label.textContent = job.status === 'completed' ? (job.dryRun ? 'Dry run complete' : 'Migration complete')
                        : job.status === 'error' ? ('Job crashed: ' + (job.error || 'unknown error'))
                        : (job.dryRun ? 'Checking links…' : 'Migrating media…');
                }
                var countEl = _mmEl('mm-status-count');
                if (countEl) countEl.textContent = done + ' / ' + total;
                var bar = _mmEl('mm-progress-bar');
                if (bar) bar.style.width = pct + '%';

                if (_mmEl('mm-stat-docs'))     _mmEl('mm-stat-docs').textContent = job.docsWithMedia || 0;
                if (_mmEl('mm-stat-updated'))  _mmEl('mm-stat-updated').textContent = job.docsUpdated || 0;
                if (_mmEl('mm-stat-migrated')) _mmEl('mm-stat-migrated').textContent = job.urlsMigrated || 0;
                if (_mmEl('mm-stat-failed'))   _mmEl('mm-stat-failed').textContent = job.urlsFailed || 0;

                var failWrap = _mmEl('mm-failures-wrap');
                var failList = _mmEl('mm-failures-list');
                if (failWrap && failList) {
                    var items = (job.failures || []).concat(
                        (job.scanErrors || []).map(function(s) { return { url: s.target, error: s.error }; })
                    );
                    if (items.length) {
                        failWrap.style.display = 'block';
                        failList.innerHTML = items.map(function(f) {
                            var where = f.url || f.docPath || '—';
                            return '<div style="padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.05);word-break:break-all;">' +
                                '<strong>' + where.replace(/</g, '&lt;') + '</strong><br>' +
                                (f.error || '').replace(/</g, '&lt;') + '</div>';
                        }).join('');
                    } else {
                        failWrap.style.display = 'none';
                    }
                }

                var startBtn = _mmEl('mm-start-btn');
                if (startBtn) {
                    var running = job.status === 'running';
                    startBtn.disabled = running;
                    startBtn.style.opacity = running ? '0.6' : '1';
                    startBtn.innerHTML = running
                        ? '<i class="fas fa-spinner fa-spin"></i> ' + (job.dryRun ? 'Checking…' : 'Migrating…')
                        : '<i class="fas fa-play"></i> Start Migration';
                }
            }

            async function _mmPollOnce() {
                if (!_mmCurrentJobId) return;
                try {
                    var headers = await _mmAuthHeader();
                    var res = await fetch('/api/admin/media-migration/' + _mmCurrentJobId + '/status', { headers: headers });
                    var job = await res.json();
                    if (!res.ok) throw new Error(job.error || ('HTTP ' + res.status));
                    _mmRenderStatus(job);
                    if (job.status === 'completed' || job.status === 'error') {
                        clearInterval(_mmPollTimer);
                        _mmPollTimer = null;
                        if (typeof window.showNotification === 'function') {
                            window.showNotification(
                                job.status === 'completed'
                                    ? (job.dryRun
                                        ? 'Dry run finished — ' + job.urlsMigrated + ' link(s) OK, ' + job.urlsFailed + ' failed.'
                                        : 'Migration finished — ' + job.urlsMigrated + ' file(s) moved to Firebase Storage, ' + job.docsUpdated + ' doc(s) updated.')
                                    : 'Media migration job crashed — check server logs.',
                                job.status === 'completed' ? 'success' : 'error'
                            );
                        }
                    }
                } catch (err) {
                    console.error('[MediaMigration] poll failed:', err.message);
                }
            }

            window._adminStartMediaMigration = async function() {
                var dryRunEl = _mmEl('mm-dry-run');
                var dryRun = !dryRunEl || dryRunEl.checked;
                var startBtn = _mmEl('mm-start-btn');
                if (startBtn) startBtn.disabled = true;
                try {
                    var headers = await _mmAuthHeader();
                    var res = await fetch('/api/admin/media-migration/start', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ dryRun: dryRun })
                    });
                    var data = await res.json();
                    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
                    _mmCurrentJobId = data.jobId;
                    window._mmLastJobId = data.jobId; // survives tab switches within this session
                    if (_mmPollTimer) clearInterval(_mmPollTimer);
                    _mmPollTimer = setInterval(_mmPollOnce, 2000);
                    _mmPollOnce();
                } catch (err) {
                    if (startBtn) startBtn.disabled = false;
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('Could not start migration: ' + err.message, 'error');
                    }
                    // ALWAYS also show a native alert for this button specifically:
                    // the toast above can be visually hidden behind the admin
                    // panel's own overlay (z-index), which is exactly why this
                    // error was happening silently -- alert() cannot be hidden
                    // by any CSS on the page, so this guarantees it's seen.
                    alert('Could not start migration: ' + err.message);
                }
            };

            // Called when the Media Migration tab is (re)opened — resumes
            // polling an already-running job instead of starting a new one.
            window._adminResumeMediaMigrationPoll = function() {
                if (window._mmLastJobId && !_mmPollTimer) {
                    _mmCurrentJobId = window._mmLastJobId;
                    _mmPollTimer = setInterval(_mmPollOnce, 2000);
                    _mmPollOnce();
                }
            };
        })();

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — SYSTEM RESET
        // Logic is now fully inline in index.html (inline <script> tag).
        // This stub exists only as a fallback safety net.
        // ═══════════════════════════════════════════════════════════════════
        window._adminMasterDelete = function() {
            var btn = document.getElementById('master-delete-btn');
            if (btn) { btn.click(); return; }
            console.warn('[Reset] Trigger button not found in DOM.');
        };

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — DISBURSEMENTS
        // Vault connect, NGO loading, fiat + crypto disbursement
        //
        // CRYPTO_HIDDEN_FOR_PLAY_STORE (verified, no code change needed here):
        // every UI entry point into the MetaMask/on-chain code below is
        // already hidden in index.html — the "Empy Distribution Vault"
        // (MetaMask connect) card is wrapped in a CRYPTO_HIDDEN_FOR_PLAY_STORE
        // comment block (never renders), and the "Initiate Disbursement" card
        // containing the fiat/crypto mode select, the USDT/BNB/BTC method
        // tabs, and the Send button is itself display:none (retired in favor
        // of the Grant Disbursement Control Panel in app-ngo.js, which is
        // fiat/EMPY-only — see that file's own CRYPTO_HIDDEN_FOR_PLAY_STORE
        // notes). window._adminConnectVault / window._adminInitiateDisbursement
        // / window._selectDisbMethod therefore cannot be reached from any
        // visible screen. Left in place, unreachable, rather than deleted —
        // restore the index.html markup when crypto disbursement is ready to
        // ship, and this code is ready to go with it.
        // ═══════════════════════════════════════════════════════════════════

        // Contract addresses (mirrors contractAddresses in app-fixes.js)
        const _DISBURSE = {
            registryAddr:  '0xc861e3ae9a35336c9735692d788065c4a0e37ebb',
            empyTokenAddr: '0x624ca3Db53adb41944EbF2BcB015f68C7BAB0c02',
            usdtAddr:      '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            provider:      null,
            signer:        null,
            walletAddr:    null,
            connected:     false
        };

        const _REGISTRY_ABI = [
            'function recordOffChainGrant(address _recipient, uint256 _amount, string _currency, string _projectId, string _transactionReference) external',
            'function recordOnChainGrant(address _recipient, address _tokenAddress, uint256 _amount, string _projectId) external',
            'function getVerifiedNgoCount() external view returns (uint256)'
        ];
        const _ERC20_ABI = [
            'function transfer(address to, uint256 amount) external returns (bool)',
            'function balanceOf(address account) external view returns (uint256)',
            'function decimals() external view returns (uint8)'
        ];

        // Helper: update vault status badge
        function _setVaultBadge(connected, label) {
            const badge = document.getElementById('vault-status-badge');
            if (!badge) return;
            badge.textContent   = connected ? '● CONNECTED' : ('● ' + (label || 'DISCONNECTED'));
            badge.style.background = connected ? 'rgba(0,137,123,0.1)' : 'rgba(239,68,68,0.1)';
            badge.style.color      = connected ? 'var(--success-color, #22c55e)' : 'var(--danger-color)';
        }

        // Connect MetaMask → Ethers provider → read vault balances
        window._adminConnectVault = async function() {
            var _cvBtn = document.querySelector('button[onclick="window._adminConnectVault()"]');
            function _cvBtn2(lbl,icon,dis,bg){if(_cvBtn){_cvBtn.disabled=dis;_cvBtn.innerHTML='<i class="fas '+icon+'"></i> '+lbl;_cvBtn.style.background=bg||'';}}
            if (typeof window.ethereum === 'undefined') {
                _setVaultBadge(false,'NO METAMASK');
                _cvBtn2('No MetaMask','fa-exclamation-triangle',false,'var(--danger-color)');
                if (typeof showNotification === 'function')
                    showNotification('MetaMask not installed. Install MetaMask to use vault.', 'error');
                return;
            }
            if (typeof ethers === 'undefined' || !ethers) {
                _setVaultBadge(false,'LIB ERROR');
                _cvBtn2('Library Error','fa-exclamation-triangle',false,'var(--danger-color)');
                if (typeof showNotification === 'function')
                    showNotification('Blockchain library not loaded. Please refresh.', 'error');
                return;
            }
            _setVaultBadge(false, 'CONNECTING…');
            _cvBtn2('Connecting…','fa-spinner fa-spin',true,'');
            try {
                await window.ethereum.request({ method: 'eth_requestAccounts' });
                const provider = new ethers.providers.Web3Provider(window.ethereum);
                const signer   = provider.getSigner();
                const addr     = await signer.getAddress();

                _DISBURSE.provider   = provider;
                _DISBURSE.signer     = signer;
                _DISBURSE.walletAddr = addr;
                _DISBURSE.connected  = true;

                // Read EMPY balance
                let empyBal = '—', usdtBal = '—';
                try {
                    const empyC = new ethers.Contract(_DISBURSE.empyTokenAddr, _ERC20_ABI, provider);
                    const rawEmpy = await empyC.balanceOf(addr);
                    const decEmpy = await empyC.decimals();
                    empyBal = parseFloat(ethers.utils.formatUnits(rawEmpy, decEmpy)).toLocaleString('en-NG', { maximumFractionDigits: 2 }) + ' EMPY';
                } catch(e) { empyBal = 'N/A'; }
                try {
                    const usdtC = new ethers.Contract(_DISBURSE.usdtAddr, _ERC20_ABI, provider);
                    const rawUsdt = await usdtC.balanceOf(addr);
                    usdtBal = parseFloat(ethers.utils.formatUnits(rawUsdt, 6)).toLocaleString('en-NG', { maximumFractionDigits: 2 }) + ' USDT';
                } catch(e) { usdtBal = 'N/A'; }

                _setVaultBadge(true);
                const infoRow = document.getElementById('vault-info-row');
                if (infoRow) infoRow.style.display = 'block';
                const elEmpy = document.getElementById('vault-bal-empy');
                const elUsdt = document.getElementById('vault-bal-usdt');
                const elAddr = document.getElementById('vault-wallet-addr');
                if (elEmpy) elEmpy.textContent = empyBal;
                if (elUsdt) elUsdt.textContent = usdtBal;
                if (elAddr) elAddr.textContent = addr.slice(0, 6) + '…' + addr.slice(-4);

                _cvBtn2('Vault Connected','fa-check-circle',false,'var(--success-color,#22c55e)');
                if (typeof showNotification === 'function') showNotification('Vault connected: ' + addr.slice(0,6) + '…' + addr.slice(-4), 'success');
            } catch(err) {
                _setVaultBadge(false, 'FAILED');
                _cvBtn2('Connect Vault','fa-plug',false,'');
                if (typeof showNotification === 'function') showNotification('Vault connection failed: ' + (err.message||'User rejected'), 'error');
                console.error('[Vault] Connect error:', err);
            }
        };

        // Toggle crypto token row visibility
        window._adminDisbModeChange = function() {
            const mode = document.getElementById('disb-mode')?.value;
            const cryptoRow = document.getElementById('disb-crypto-row');
            if (cryptoRow) cryptoRow.style.display = mode === 'crypto' ? 'block' : 'none';
        };

        // Toggle NGO / Individual panels
        // BUG FIX: Made robust against optional-chaining absence and wrapper chain breakage.
        // Also initialises the method tabs whenever the individual panel becomes visible.
        window._adminDisbRecipChange = function() {
            var checked = document.querySelector('input[name="disb-recip-type"]:checked');
            var val = checked ? checked.value : 'ngo';
            var ngoPanel = document.getElementById('disb-ngo-panel');
            var indPanel = document.getElementById('disb-individual-panel');
            if (ngoPanel) ngoPanel.style.display = (val === 'ngo')        ? 'block' : 'none';
            if (indPanel) indPanel.style.display = (val === 'individual') ? 'block' : 'none';
            /* When individual panel becomes visible, ensure method tabs are initialised */
            if (val === 'individual' && typeof window._selectDisbMethod === 'function') {
                window._selectDisbMethod(window._currentDisbMethod || 'bank');
            }
        };

        // Switch disbursement method tabs (bank / empy / usdt / bnb / btc)
        window._selectDisbMethod = function(method) {
            ['bank','empy','usdt','bnb','btc'].forEach(function(m) {
                var panel = document.getElementById('disb-method-' + m);
                if (panel) panel.style.display = m === method ? 'block' : 'none';
            });
            document.querySelectorAll('#disb-method-tabs button[data-method]').forEach(function(btn) {
                var active = btn.dataset.method === method;
                btn.style.background = active ? '#0A0E27' : 'white';
                btn.style.color      = active ? 'white'   : '#0A0E27';
            });
            window._currentDisbMethod = method;
        };

        // Load NGO partners into the multi-select list
        window._adminLoadNgoList = async function() {
            const list = document.getElementById('disb-ngo-list');
            if (!list) return;
            list.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;padding:10px;">Loading…</div>';

            // Try Firestore ngo_partners collection first, fall back to mockNgoPartners
            let ngos = [];
            try {
                if (window._firebaseLoaded) {
                    const snap = await fbDb.collection('ngo_partners').limit(60).get();
                    snap.forEach(function(doc) {
                        const d = doc.data();
                        ngos.push({ id: doc.id, name: d.name || d.orgName || doc.id, wallet: d.walletAddress || d.wallet || '', email: d.email || '' });
                    });
                }
            } catch(e) {}

            // Merge with mockNgoPartners if available
            if (window.mockNgoPartners && typeof window.mockNgoPartners === 'object') {
                Object.values(window.mockNgoPartners).forEach(function(ngo) {
                    if (!ngos.find(function(n) { return n.id === ngo.id; })) {
                        ngos.push({ id: ngo.id, name: ngo.name || ngo.id, wallet: ngo.wallet || ngo.walletAddress || '', email: ngo.email || '' });
                    }
                });
            }

            if (!ngos.length) {
                list.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;padding:10px;">No NGO partners found. Register partners via the Publish → NGO Partners section.</div>';
                return;
            }

            list.innerHTML = ngos.map(function(ngo) {
                return '<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1.5px solid rgba(10,14,39,0.08);border-radius:12px;cursor:pointer;font-size:0.88rem;background:white;">' +
                    '<input type="checkbox" class="disb-ngo-chk" data-id="' + ngo.id + '" data-name="' + (ngo.name).replace(/"/g,'&quot;') + '" data-wallet="' + (ngo.wallet||'') + '" data-email="' + (ngo.email||'') + '" style="width:15px;height:15px;accent-color:var(--secondary);flex-shrink:0;">' +
                    '<span><strong>' + ngo.name + '</strong>' + (ngo.wallet ? '<br><span style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;">' + ngo.wallet.slice(0,10) + '…</span>' : '') + '</span>' +
                    '</label>';
            }).join('');
        };

        // Load recent disbursements from Firestore
        window._adminLoadRecentDisbursements = async function() {
            const tbody = document.getElementById('disb-history-body');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Loading…</td></tr>';
            if (!window._firebaseLoaded) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Firebase not connected.</td></tr>';
                return;
            }
            try {
                const snap = await fbDb.collection('disbursements').orderBy('createdAt', 'desc').limit(30).get();
                if (snap.empty) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-muted);">No disbursements recorded yet.</td></tr>';
                    return;
                }
                let rows = '';
                snap.forEach(function(doc) {
                    const d  = doc.data();
                    const dt = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '—';
                    const statusColor = d.status === 'completed' ? 'var(--success-color,#22c55e)' : d.status === 'failed' ? 'var(--danger-color)' : '#F59E0B';
                    rows += '<tr style="border-bottom:1px solid rgba(10,14,39,0.06);">' +
                        '<td style="padding:10px 14px;white-space:nowrap;">' + dt + '</td>' +
                        '<td style="padding:10px 14px;">' + (d.recipientName || d.recipientId || '—') + '</td>' +
                        '<td style="padding:10px 14px;font-weight:700;">' + (d.amountFormatted || d.amount || '—') + '</td>' +
                        '<td style="padding:10px 14px;">' + (d.mode || '—') + '</td>' +
                        '<td style="padding:10px 14px;">' + (d.purpose || '—') + '</td>' +
                        '<td style="padding:10px 14px;"><span style="font-weight:700;color:' + statusColor + ';">' + (d.status || 'pending') + '</span></td>' +
                        '</tr>';
                });
                tbody.innerHTML = rows;
            } catch(err) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger-color);">Error: ' + err.message + '</td></tr>';
            }
        };

        // Append a live row to the Grant Transparency Portal after disbursement
        function _appendGrantLedgerRow(rec) {
            var tbody = document.getElementById('grant-ledger-body');
            if (!tbody) return;
            var empty = tbody.querySelector('td[colspan]');
            if (empty) empty.closest('tr').remove();
            var gid  = 'G-' + Date.now().toString(36).toUpperCase().slice(-6);
            var dt   = new Date().toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
            var txTxt = rec.txHash ? rec.txHash.slice(0,16)+'..' : rec.txRef ? rec.txRef.slice(0,16)+'..' : 'pending';
            var txUrl = rec.txHash ? 'https://polygonscan.com/tx/'+rec.txHash : '#';
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>'+gid+'</td>'+
                '<td>'+(rec.recipientName||'—')+'</td>'+
                '<td>'+(rec.purpose||'—')+'</td>'+
                '<td>'+(rec.amountFormatted||rec.amount||'—')+'</td>'+
                '<td><a href="'+txUrl+'" target="_blank" style="color:var(--secondary);font-family:monospace;font-size:0.82rem;">'+txTxt+'</a></td>'+
                '<td style="color:var(--success-color,#22c55e);font-weight:700;">completed</td>'+
                '<td>'+dt+'</td>';
            tbody.prepend(tr);
        }

                // Show feedback inside disbursement form
        function _disbFeedback(msg, type) {
            const el = document.getElementById('disb-feedback');
            if (!el) return;
            el.style.display    = 'block';
            el.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : type === 'success' ? 'rgba(0,137,123,0.1)' : 'rgba(245,158,11,0.1)';
            el.style.color      = type === 'error' ? 'var(--danger-color)' : type === 'success' ? 'var(--success-color,#22c55e)' : '#d97706';
            el.style.border     = '1.5px solid currentColor';
            el.textContent      = msg;
        }

        // Main disbursement initiator
        window._adminInitiateDisbursement = async function() {
            const amount    = parseFloat(document.getElementById('disb-amount')?.value || '0');
            const mode      = document.getElementById('disb-mode')?.value;
            const purpose   = document.getElementById('disb-purpose')?.value?.trim();
            const recipType = document.querySelector('input[name="disb-recip-type"]:checked')?.value || 'ngo';
            const token     = document.querySelector('input[name="disb-token"]:checked')?.value || 'empy';
            const _dBtn     = document.querySelector('button[onclick="window._adminInitiateDisbursement()"]');
            const _lock   = function(){if(_dBtn){_dBtn.disabled=true; _dBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Processing…';}};
            const _unlock = function(){if(_dBtn){_dBtn.disabled=false;_dBtn.innerHTML='<i class="fas fa-paper-plane"></i> Initiate Disbursement';}};

            // Validate
            if (!amount || amount < 1) return _disbFeedback('Please enter a valid amount.', 'error');
            if (!mode)                 return _disbFeedback('Please select a disbursement mode.', 'error');
            if (!purpose)              return _disbFeedback('Please enter a purpose / project ID.', 'error');

            // Gather recipients
            const recipients = [];
            if (recipType === 'ngo') {
                document.querySelectorAll('.disb-ngo-chk:checked').forEach(function(chk) {
                    recipients.push({ id: chk.dataset.id, name: chk.dataset.name, wallet: chk.dataset.wallet, email: chk.dataset.email });
                });
                if (!recipients.length) return _disbFeedback('Please select at least one NGO partner.', 'error');
            } else {
                /* Individual disbursement — read from method-specific fields */
                const method = window._currentDisbMethod || 'bank';
                let addr = '', walletType = method;

                if (method === 'bank') {
                    const accNum  = document.getElementById('disb-bank-acc-number')?.value?.trim();
                    const accName = document.getElementById('disb-bank-acc-name')?.value?.trim();
                    const bank    = document.getElementById('disb-bank-name')?.value?.trim();
                    if (!accNum) return _disbFeedback('Please enter the recipient account number.', 'error');
                    addr = accNum + (bank ? ' — ' + bank : '') + (accName ? ' (' + accName + ')' : '');
                    walletType = 'bank';
                } else if (method === 'usdt') {
                    const network = document.getElementById('disb-usdt-network')?.value || 'erc20';
                    addr = document.getElementById('disb-usdt-addr')?.value?.trim();
                    if (!addr) return _disbFeedback('Please enter the USDT wallet address.', 'error');
                    walletType = 'usdt-' + network;
                } else if (method === 'empy') {
                    addr = document.getElementById('disb-individual-addr')?.value?.trim();
                    if (!addr) return _disbFeedback('Please enter the EMPY wallet address.', 'error');
                } else if (method === 'bnb') {
                    addr = document.getElementById('disb-bnb-addr')?.value?.trim();
                    if (!addr) return _disbFeedback('Please enter the BNB wallet address.', 'error');
                } else if (method === 'btc') {
                    addr = document.getElementById('disb-btc-addr')?.value?.trim();
                    if (!addr) return _disbFeedback('Please enter the BTC wallet address.', 'error');
                }

                const name = document.getElementById('disb-individual-name')?.value?.trim() || 'Individual Recipient';
                if (!addr) return _disbFeedback('Please fill in the recipient details.', 'error');
                recipients.push({ id: addr, name: name, wallet: addr, email: '', walletType: walletType });
            }

            _lock();
            _disbFeedback('Processing disbursement…', 'info');

            if (mode === 'fiat') {
                // Fiat via Flutterwave — disburse to each selected recipient
                let processed = 0;
                let lastErr = '';
                const perRecipient = Math.floor(amount / recipients.length);

                for (const recip of recipients) {
                    try {
                        await new Promise(function(resolve, reject) {
                            window.initiateFlutterwavePayment({
                                amount:      perRecipient,
                                currency:    'NGN',
                                email:       recip.email || (window.userState && window.userState.email) || 'admin@empyrean.com',
                                name:        recip.name,
                                description: purpose,
                                purpose:     purpose,
                                onSuccess: async function(response, txRef) {
                                    // Record in Firestore
                                    try {
                                        await fbDb.collection('disbursements').add({
                                            recipientId:     recip.id,
                                            recipientName:   recip.name,
                                            recipientWallet: recip.wallet || '',
                                            amount:          perRecipient,
                                            amountFormatted: '₦' + perRecipient.toLocaleString('en-NG'),
                                            mode:            'fiat-ngn',
                                            token:           'NGN',
                                            purpose:         purpose,
                                            txRef:           txRef,
                                            flwRef:          response.flw_ref || '',
                                            status:          'completed',
                                            adminId:         (window.userState && window.userState.id) || '',
                                            createdAt:       _serverTimestamp()
                                        });
                                        // Record off-chain on the registry contract if vault is connected
                                        if (_DISBURSE.connected && _DISBURSE.signer && recip.wallet && recip.wallet.startsWith('0x')) {
                                            try {
                                                const registry = new ethers.Contract(_DISBURSE.registryAddr, _REGISTRY_ABI, _DISBURSE.signer);
                                                await registry.recordOffChainGrant(
                                                    recip.wallet,
                                                    ethers.utils.parseUnits(String(perRecipient), 18),
                                                    'NGN',
                                                    purpose,
                                                    txRef
                                                );
                                            } catch(chainErr) { console.warn('[Disburse] Off-chain record error:', chainErr.message); }
                                        }
                                    } catch(e) { console.warn('[Disburse] Firestore save error:', e.message); }
                                    _appendGrantLedgerRow({recipientName:recip.name,purpose:purpose,amountFormatted:'₦'+perRecipient.toLocaleString('en-NG'),txRef:txRef});
                                    processed++;
                                    resolve();
                                },
                                onFailure: function(res) { reject(new Error(res.message || 'Payment failed')); },
                                onClose:   function()    { reject(new Error('Payment window closed')); }
                            });
                        });
                    } catch(flwErr) {
                        lastErr = flwErr.message || String(flwErr);
                        console.warn('[Disburse] FLW error for', recip.name, ':', lastErr);
                        _disbFeedback('⚠ Error for '+recip.name+': '+lastErr,'error');
                    }
                }
                _unlock();
                if (processed === recipients.length && processed > 0) {
                    _disbFeedback('✅ Fiat disbursement completed for ' + processed + ' recipient(s). Ledger updated.', 'success');
                    window._adminLoadRecentDisbursements();
                } else if (processed > 0) {
                    _disbFeedback('⚠ Partial: ' + processed + ' of ' + recipients.length + ' completed.', 'warning');
                    window._adminLoadRecentDisbursements();
                } else {
                    _disbFeedback('❌ No disbursements completed.' + (lastErr ? ' Reason: ' + lastErr : ' Check payment gateway connection.'), 'error');
                }

            } else if (mode === 'crypto') {
                // Crypto — requires vault connection
                if (!_DISBURSE.connected || !_DISBURSE.signer) {
                    _unlock();
                    return _disbFeedback('Please connect the vault (MetaMask) before sending crypto.', 'error');
                }
                if (typeof ethers === 'undefined' || !ethers) {
                    _unlock();
                    return _disbFeedback('Blockchain library not loaded. Please refresh.', 'error');
                }
                const tokenAddr = token === 'usdt' ? _DISBURSE.usdtAddr : _DISBURSE.empyTokenAddr;
                const decimals  = token === 'usdt' ? 6 : 18;
                const perRecipient = amount / recipients.length;
                const amtUnits  = ethers.utils.parseUnits(perRecipient.toFixed(decimals > 6 ? 6 : decimals), decimals);
                const tokenLabel = token === 'usdt' ? 'USDT' : 'EMPY';

                let processed = 0;
                const tokenContract  = new ethers.Contract(tokenAddr, _ERC20_ABI, _DISBURSE.signer);
                const registryContract = new ethers.Contract(_DISBURSE.registryAddr, _REGISTRY_ABI, _DISBURSE.signer);

                for (const recip of recipients) {
                    if (!recip.wallet || !recip.wallet.startsWith('0x')) {
                        console.warn('[Disburse] No valid wallet for', recip.name, '— skipping');
                        continue;
                    }
                    try {
                        _disbFeedback('Sending ' + tokenLabel + ' to ' + recip.name + '…', 'info');
                        // ERC-20 transfer
                        const tx = await tokenContract.transfer(recip.wallet, amtUnits);
                        await tx.wait();
                        // Record on-chain in registry
                        try {
                            const regTx = await registryContract.recordOnChainGrant(recip.wallet, tokenAddr, amtUnits, purpose);
                            await regTx.wait();
                        } catch(regErr) { console.warn('[Disburse] Registry record error:', regErr.message); }
                        // Persist to Firestore
                        try {
                            await fbDb.collection('disbursements').add({
                                recipientId:     recip.id,
                                recipientName:   recip.name,
                                recipientWallet: recip.wallet,
                                amount:          perRecipient,
                                amountFormatted: perRecipient.toLocaleString('en', { maximumFractionDigits: 4 }) + ' ' + tokenLabel,
                                mode:            'crypto',
                                token:           tokenLabel,
                                tokenAddress:    tokenAddr,
                                txHash:          tx.hash,
                                purpose:         purpose,
                                status:          'completed',
                                adminId:         (window.userState && window.userState.id) || '',
                                createdAt:       _serverTimestamp()
                            });
                        } catch(firestoreErr) { console.warn('[Disburse] Firestore error:', firestoreErr.message); }
                        _appendGrantLedgerRow({recipientName:recip.name,purpose:purpose,amountFormatted:perRecipient.toLocaleString('en',{maximumFractionDigits:4})+' '+tokenLabel,txHash:tx.hash});
                        processed++;
                    } catch(txErr) {
                        console.error('[Disburse] TX error for', recip.name, ':', txErr.message);
                        _disbFeedback('❌ Failed for ' + recip.name + ': ' + txErr.message, 'error');
                    }
                }
                _unlock();
                if (processed > 0) {
                    _disbFeedback('✅ ' + tokenLabel + ' sent to ' + processed + ' of ' + recipients.length + ' recipient(s). Ledger updated.', 'success');
                    window._adminLoadRecentDisbursements();
                } else {
                    _disbFeedback('❌ No transactions completed. Check wallet addresses and vault.', 'error');
                }
            } else {
                _unlock();
                _disbFeedback('Unknown disbursement mode.', 'error');
            }
        };

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — NEWS ARTICLE PUBLISH FORM
        // Wires the #admin-news-form submit, toolbar formatting buttons,
        // media upload preview, and the published articles table.
        // Root cause of Bug 1: no submit handler was ever wired to this form.
        // ═══════════════════════════════════════════════════════════════════
        (function _wireAdminNewsForm() {

            // EXPANDED NEWS CATEGORIES (2026-10-23): the category <select>
            // (#admin-news-category) is hard-coded in index.html with 12
            // options. Rather than editing that markup, any category below
            // that isn't already an <option> is appended here (idempotent —
            // safe to run repeatedly). To add more later, just add a line to
            // this list AND the matching key/label to _NEWS_CATS in
            // app-news.js so the public News chips show the same label.
            var _EXTRA_NEWS_CATS = [
                ['security',      'Security'],
                ['international', 'International News'],
                ['national',      'National News'],
                ['local',         'Local News'],
                ['education',     'Education'],
                ['environment',   'Environment & Climate'],
                ['agriculture',   'Agriculture'],
                ['business',      'Business'],
                ['crime',         'Crime & Justice'],
                ['lifestyle',     'Lifestyle'],
                ['religion',      'Religion & Faith'],
                ['opinion',       'Opinion & Editorial'],
                ['breaking',      'Breaking News']
            ];
            function _expandNewsCategories() {
                var sel = document.getElementById('admin-news-category');
                if (!sel) return;
                var have = {};
                Array.prototype.forEach.call(sel.options, function (o) { have[o.value] = true; });
                _EXTRA_NEWS_CATS.forEach(function (c) {
                    if (have[c[0]]) return;
                    var o = document.createElement('option');
                    o.value = c[0]; o.textContent = c[1];
                    sel.appendChild(o);
                });
            }
            _expandNewsCategories();
            document.addEventListener('empyrean-section-change', function () { setTimeout(_expandNewsCategories, 0); });
            document.addEventListener('click', function (e) {
                if (e.target && e.target.closest && e.target.closest('#admin-news-category, [data-admin-tab], .admin-tab')) setTimeout(_expandNewsCategories, 0);
            }, true);

            // FIX (bug report: "Edit and Delete buttons in the News
            // Publication section produce no action"): _newsRowHTML() below
            // (used by BOTH _refreshNewsTable() — which renders the
            // Published Articles table straight from Firestore — and
            // _optimisticAddRow() — which renders the row immediately after
            // a successful publish) calls _esc() on every field, but no
            // _esc() was ever defined inside THIS closure. Every other
            // admin-panel section in this file (initAdminUserManagement,
            // initAdminUrgentSafetyReports, initAdminLivePolls,
            // initAdminBusinessPageManager, etc.) defines its own local
            // _esc() for exactly this reason — each is its own separate
            // IIFE, so nothing leaks in from a sibling section or from
            // window. This one was simply missed. The bare `_esc` reference
            // threw "ReferenceError: _esc is not defined" the instant a row
            // was built, which _refreshNewsTable() only ever caught with a
            // console.warn (no visible error) — so admins saw either an
            // unpopulated/stuck table or an existing row whose Edit/Delete
            // buttons had never actually been (re)written by this file,
            // while every click on them silently did nothing. Restoring
            // this table's own row-rendering (instead of relying on
            // whatever row app-news.js's separate listener happened to
            // have already drawn) is what makes Edit/Delete work again.
            function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

            // FIX (2026-08-14 — bug report: "Edit and delete options are not
            // available" for published news): Delete already existed here;
            // Edit genuinely did not — there was no code path anywhere that
            // loaded an existing article back into this form for editing.
            // Tracks which article (if any) is currently being edited, so
            // the ONE existing form/submit handler can serve both "publish
            // new" and "save edits" without a second form or a new file.
            // null = normal create mode.
            // FIX (2026-08-14 — Edit was populating the form but "Save
            // Changes" silently published a brand-new article instead of
            // updating the original — see the submit handler below for the
            // root cause and full fix): these three companion vars capture
            // the article's existing media/createdAt/publishedBy the moment
            // Edit is opened, so the submit handler can (a) keep the
            // original publish date instead of bumping the article to the
            // top of the feed on every edit, and (b) keep the existing
            // photo/video attached when the admin edits text only, without
            // re-uploading anything.
            var _editingArticleId = null;
            var _editingArticleMedia = [];
            var _editingArticleCreatedAt = null;
            var _editingArticlePublishedBy = null;

            function _feedbackNews(msg, type) {
                var el = document.getElementById('admin-news-feedback');
                if (!el) return;
                var colors = {
                    success: { bg: 'rgba(34,197,94,0.12)', color: 'var(--success-color,#22c55e)' },
                    error:   { bg: 'rgba(239,68,68,0.12)', color: 'var(--danger-color,#ef4444)' },
                    info:    { bg: 'rgba(27,43,139,0.08)', color: 'var(--secondary,#1B2B8B)' }
                };
                var c = colors[type] || colors.info;
                el.style.display    = 'block';
                el.style.background = c.bg;
                el.style.color      = c.color;
                el.style.border     = '1.5px solid currentColor';
                el.style.padding    = '12px 16px';
                el.style.borderRadius = '10px';
                el.style.fontWeight = '600';
                el.style.fontSize   = '0.88rem';
                el.textContent = msg;
            }

            function _newsRowHTML(id, d) {
                var dt = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '—';
                return '<td style="padding:10px 16px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+_esc(d.title||'')+'">'+_esc(d.title||'—')+'</td>'+
                    '<td style="padding:10px 16px;">'+_esc(d.writer||'—')+'</td>'+
                    '<td style="padding:10px 16px;"><span style="background:rgba(27,43,139,0.08);color:var(--secondary);padding:2px 9px;border-radius:10px;font-size:0.78rem;font-weight:600;">'+_esc(d.category||'—')+'</span></td>'+
                    '<td style="padding:10px 16px;white-space:nowrap;">'+dt+'</td>'+
                    // ADDED — view count. The reader UI (app-news.js's
                    // _openArticleDetail) already displayed d.views but
                    // nothing wrote to it until now (see that file's own
                    // _bumpArticleViewCount); this surfaces the same field
                    // here so admins can actually see how many people have
                    // viewed each published article.
                    '<td style="padding:10px 16px;white-space:nowrap;color:var(--text-muted);"><i class="fas fa-eye" style="margin-right:5px;opacity:0.6;"></i>'+(Number(d.views)||0).toLocaleString()+'</td>'+
                    '<td style="padding:10px 16px;white-space:nowrap;">'+
                        '<button onclick="window._adminEditNewsArticle(\''+id+'\')" style="background:rgba(27,43,139,0.08);color:var(--secondary,#1B2B8B);border:none;border-radius:8px;padding:5px 10px;font-size:0.78rem;font-weight:700;cursor:pointer;margin-right:6px;"><i class="fas fa-pen"></i> Edit</button>'+
                        '<button onclick="window._adminDeleteNewsArticle(\''+id+'\')" style="background:rgba(239,68,68,0.1);color:#ef4444;border:none;border-radius:8px;padding:5px 10px;font-size:0.78rem;font-weight:700;cursor:pointer;"><i class="fas fa-trash"></i> Delete</button>'+
                    '</td>';
            }

            // FIX (2026-08-14 — bug report: "News Published section does not
            // store entries in the store log" / "immediately after posting,
            // the item is hidden"): this used to unconditionally do
            // `tbody.innerHTML = ''` and rebuild the ENTIRE table from
            // whatever this one query returned. That's fine when the query
            // is complete and up to date, but two things could make a
            // freshly-published article briefly (or permanently) missing
            // from it: (a) app-fixes.js's separate "quick post -> News"
            // composer wrote only to news_posts and never to this
            // news_articles archive at all (fixed at the source in that
            // file this session), and (b) even a fully-awaited archive
            // write can occasionally still be settling relative to a
            // `.get()` fired immediately after it on a weak connection
            // (the same class of race app-patch-v26/v31/v35 already
            // document elsewhere in this app). Either way, a query that
            // simply doesn't (yet) include the newest article used to
            // silently ERASE the optimistic row that addNewsPost()'s
            // _syncAdminTable() (app-news.js) had already inserted the
            // moment the article was published — which is exactly what
            // "hidden immediately after posting" looks like from the
            // admin's side. Now this merges by article id instead of
            // wiping: existing rows are updated in place, new ones from
            // the query are added, and a row is only ever REMOVED here if
            // it's missing from the query AND wasn't just added within the
            // last 30s (same "still probably in flight" grace window
            // app-news.js's own listener already uses for its own
            // prepend-vs-append decision) — so a genuinely deleted article
            // still disappears, just not a split-second-old one still
            // catching up to this query.
            var RECENT_GRACE_MS = 30000;
            function _refreshNewsTable() {
                var tbody = document.getElementById('admin-news-table-body');
                var badge = document.getElementById('admin-news-count-badge');
                if (!tbody) return;
                if (!window._firebaseLoaded || !window.fbDb) return;
                window.fbDb.collection('news_articles').orderBy('createdAt', 'desc').limit(30).get()
                    .then(function(snap) {
                        var emptyRow = document.getElementById('admin-news-empty-row');
                        var seenIds = {};

                        if (!snap.empty) {
                            if (emptyRow) emptyRow.remove();
                            // Walk newest-first so re-inserted/moved rows end up in the right order.
                            var prevEl = null;
                            snap.forEach(function(doc) {
                                seenIds[doc.id] = true;
                                var d = doc.data();
                                var row = tbody.querySelector('tr[data-post-id="' + doc.id + '"]');
                                if (row) {
                                    row.innerHTML = _newsRowHTML(doc.id, d);
                                } else {
                                    row = document.createElement('tr');
                                    row.dataset.postId = doc.id;
                                    row.style.borderBottom = '1px solid rgba(10,14,39,0.06)';
                                    row.innerHTML = _newsRowHTML(doc.id, d);
                                }
                                if (prevEl) prevEl.after(row); else tbody.prepend(row);
                                prevEl = row;
                            });
                        }

                        // Drop rows that are no longer in the query result —
                        // unless they were only just added (grace window above).
                        Array.prototype.slice.call(tbody.querySelectorAll('tr[data-post-id]')).forEach(function (row) {
                            var id = row.dataset.postId;
                            if (seenIds[id]) return;
                            var addedAt = parseInt(row.dataset.addedAt || '0', 10);
                            if (addedAt && (Date.now() - addedAt) < RECENT_GRACE_MS) return; // still in grace window — keep it
                            row.remove();
                        });

                        var remaining = tbody.querySelectorAll('tr[data-post-id]').length;
                        if (badge) badge.textContent = remaining;
                        if (remaining === 0 && !tbody.querySelector('#admin-news-empty-row')) {
                            tbody.innerHTML = '<tr id="admin-news-empty-row"><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">No articles published yet.</td></tr>';
                        }
                    })
                    .catch(function(e) { console.warn('[AdminNews] Table refresh error:', e.message); });
            }

            // Optimistic insert used right after a successful publish (see
            // the submit handler below) — same idea as app-news.js's own
            // _syncAdminTable(), kept local to this file since it also needs
            // to stamp data-added-at for the grace window above.
            function _optimisticAddRow(id, d) {
                var tbody = document.getElementById('admin-news-table-body');
                var badge = document.getElementById('admin-news-count-badge');
                if (!tbody) return;
                var emptyRow = document.getElementById('admin-news-empty-row');
                if (emptyRow) emptyRow.remove();
                var row = tbody.querySelector('tr[data-post-id="' + id + '"]');
                if (!row) {
                    row = document.createElement('tr');
                    row.dataset.postId = id;
                    row.style.borderBottom = '1px solid rgba(10,14,39,0.06)';
                    tbody.prepend(row);
                }
                row.dataset.addedAt = String(Date.now());
                row.innerHTML = _newsRowHTML(id, d);
                if (badge) badge.textContent = tbody.querySelectorAll('tr[data-post-id]').length;
            }

            // FIX (2026-10-23 — bug report: "clicking Edit/Delete in the news publishing portal
            // does nothing"): Delete used the native confirm(), which the Android in-app
            // WebView / HTML previewer silently answers with "false" — so the handler returned
            // before doing anything (same reason the Advert section already uses its own
            // in-app confirm banner). Delete now asks with an in-app banner instead.
            function _confirmNewsDelete(docId, onYes) {
                var old = document.getElementById('_empNewsDeleteConfirm'); if (old) old.remove();
                var row = document.querySelector('#admin-news-table-body tr[data-post-id="' + docId + '"]');
                var cell = row && row.querySelector('td');
                var title = cell ? (cell.getAttribute('title') || cell.textContent || '').trim() : '';
                var banner = document.createElement('div');
                banner.id = '_empNewsDeleteConfirm';
                banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:92px;z-index:2147483000;background:#0A0E27;color:#fff;border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;box-shadow:0 12px 32px rgba(0,0,0,0.4);font-family:Inter,Arial,sans-serif;';
                var msg = document.createElement('div');
                msg.style.cssText = 'font-size:0.9rem;font-weight:600;line-height:1.4;';
                msg.textContent = 'Delete ' + (title ? '\u201C' + title.slice(0, 90) + '\u201D' : 'this article') + ' permanently? This cannot be undone.';
                var btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
                var no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancel';
                no.style.cssText = 'min-height:44px;padding:0 18px;border-radius:10px;border:none;background:rgba(255,255,255,0.14);color:#fff;font-weight:700;cursor:pointer;';
                var yes = document.createElement('button'); yes.type = 'button'; yes.textContent = 'Delete';
                yes.style.cssText = 'min-height:44px;padding:0 20px;border-radius:10px;border:none;background:#e53935;color:#fff;font-weight:700;cursor:pointer;';
                btns.appendChild(no); btns.appendChild(yes); banner.appendChild(msg); banner.appendChild(btns);
                document.body.appendChild(banner);
                var t = setTimeout(function () { banner.remove(); }, 12000);
                no.addEventListener('click', function () { clearTimeout(t); banner.remove(); });
                yes.addEventListener('click', function () { clearTimeout(t); banner.remove(); onYes(); });
            }
            window._adminDeleteNewsArticle = function (docId) { _confirmNewsDelete(docId, function () { _deleteNewsNow(docId); }); };
            function _deleteNewsNow(docId) {
                var row = document.querySelector('#admin-news-table-body tr[data-post-id="' + docId + '"]');
                if (row) row.remove(); // optimistic — don't wait on the network to feel responsive
                if (_editingArticleId === docId) _cancelEdit();
                /* PERMANENT DELETE (2026-10-23): app-news.js's deleteNewsPost() now removes BOTH the live copy
                   (news_posts) and the archive copy (news_articles) and returns a Promise. The table is only
                   re-read AFTER both deletes finish — it used to re-query news_articles immediately, before
                   the archive delete had landed, which put the row straight back. */
                if (typeof window.deleteNewsPost === 'function') {
                    Promise.resolve(window.deleteNewsPost(docId)).then(function () { _refreshNewsTable(); });
                    return;
                }
                /* Fallback if app-news.js not loaded */
                if (!window._firebaseLoaded || !window.fbDb) return;
                Promise.all([
                    window.fbDb.collection('news_posts').doc(docId).delete(),
                    window.fbDb.collection('news_articles').doc(docId).delete()
                ]).then(function () {
                        if (typeof window.showNotification === 'function') window.showNotification('Article deleted permanently.', 'success');
                        _refreshNewsTable();
                    })
                    .catch(function(e) { if (typeof window.showNotification === 'function') window.showNotification('Delete failed: '+e.message, 'error'); });
            }

            // FIX (2026-08-14 — bug report: "Edit... options are not
            // available" for published news): genuinely new — nothing in
            // this codebase previously loaded a published article back into
            // the form for editing. Loads the archived copy (news_articles
            // has the full body/summary/category/pubdate — news_posts only
            // ever stored a trimmed-down `content` copy for the public
            // feed), populates every #admin-news-form field, and flips the
            // form into "edit mode" so the existing submit handler updates
            // the SAME article id in both collections instead of publishing
            // a new one. See _wireNewsFormSubmit()'s edit-mode branch below.
            function _cancelEdit() {
                _editingArticleId = null;
                _editingArticleMedia = [];
                _editingArticleCreatedAt = null;
                _editingArticlePublishedBy = null;
                var form = document.getElementById('admin-news-form');
                var submitBtn = form && form.querySelector('button[type="submit"]');
                var cancelBtn = document.getElementById('admin-news-cancel-edit-btn');
                if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Publish Article';
                if (cancelBtn) cancelBtn.style.display = 'none';
                if (form) form.reset();
                var prev = document.getElementById('admin-news-media-preview');
                if (prev) prev.innerHTML = '';
            }
            window._adminCancelEditNewsArticle = _cancelEdit;

            /* FIX (request — "multiple pictures can be placed... at the
               middle of the article"): builds one clickable, numbered
               thumbnail for the media preview strip. Tapping it inserts
               a `[img:N]` token at the current cursor position in
               #admin-news-body — app-news.js's _renderArticleBody()
               (reader side) expands that exact token into a real inline
               image/video at that position, reading from the same
               media list this index refers to (mediaInput.files order on
               a fresh upload, or _editingArticleMedia order when editing
               without picking new files — both cases match what the
               submit handler actually saves as article.media, so the
               index a thumbnail is tapped at is always correct). The
               numbered badge is what tells the admin which token maps to
               which picture. Shared by both places a media preview gets
               built: a fresh file selection (_wireNewsMediaInput) and
               loading an existing article for editing
               (window._adminEditNewsArticle), so a token typed in either
               flow behaves identically. */
            function _insertImgTokenAtCursor(idx) {
                var body = document.getElementById('admin-news-body');
                if (!body) return;
                var token = '[img:' + idx + ']';
                var start = (typeof body.selectionStart === 'number') ? body.selectionStart : body.value.length;
                var end   = (typeof body.selectionEnd   === 'number') ? body.selectionEnd   : start;
                body.value = body.value.slice(0, start) + token + body.value.slice(end);
                var caret = start + token.length;
                body.focus();
                try { body.selectionStart = body.selectionEnd = caret; } catch (e) {}
                _feedbackNews('Inserted ' + token + ' into the article — it\u2019ll render as an inline picture at that exact spot.', 'success');
            }

            function _buildMediaPreviewThumb(url, idx, isVid) {
                var box = document.createElement('div');
                box.className = 'admin-news-media-thumb';
                box.title = 'Tap to insert this image into the article body at the cursor';
                box.style.cssText = 'position:relative;width:90px;height:70px;cursor:pointer;';
                var el = document.createElement(isVid ? 'video' : 'img');
                el.src = url;
                if (isVid) { el.muted = true; el.controls = false; }
                el.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:2px solid rgba(27,43,139,0.15);display:block;pointer-events:none;';
                var badge = document.createElement('span');
                badge.textContent = idx + 1;
                badge.style.cssText = 'position:absolute;top:-6px;left:-6px;background:var(--secondary,#1B2B8B);color:#fff;font-size:0.68rem;font-weight:700;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.25);pointer-events:none;';
                box.appendChild(el);
                box.appendChild(badge);
                box.addEventListener('click', function () { _insertImgTokenAtCursor(idx); });
                return box;
            }

            window._adminEditNewsArticle = function (docId) {
                if (!window._firebaseLoaded || !window.fbDb) {
                    if (typeof window.showNotification === 'function') window.showNotification('Not connected — try again in a moment.', 'error');
                    return;
                }
                window.fbDb.collection('news_articles').doc(docId).get().then(function (doc) {
                    if (!doc.exists) {
                        if (typeof window.showNotification === 'function') window.showNotification('Could not find that article — it may have just been deleted.', 'error');
                        return;
                    }
                    var d = doc.data() || {};
                    _editingArticleId = docId;
                    _editingArticleMedia = Array.isArray(d.media) ? d.media : (d.image ? [d.image] : []);
                    _editingArticleCreatedAt = d.createdAt || null;
                    _editingArticlePublishedBy = d.publishedBy || null;

                    var titleEl    = document.getElementById('admin-news-title');
                    var writerEl   = document.getElementById('admin-news-writer');
                    var categoryEl = document.getElementById('admin-news-category');
                    var pubdateEl  = document.getElementById('admin-news-pubdate');
                    var summaryEl  = document.getElementById('admin-news-summary');
                    var bodyEl     = document.getElementById('admin-news-body');
                    var displayAsEl = document.getElementById('admin-news-display-as');

                    if (titleEl)    titleEl.value    = d.title    || '';
                    if (writerEl)   writerEl.value   = d.writer   || '';
                    if (categoryEl) categoryEl.value = d.category || 'impact';
                    if (pubdateEl)  pubdateEl.value  = d.pubdate  || '';
                    if (summaryEl)  summaryEl.value  = d.summary  || '';
                    if (bodyEl)     bodyEl.value     = d.body     || '';
                    if (displayAsEl) displayAsEl.value = d.displayAs || 'writer';

                    var preview = document.getElementById('admin-news-media-preview');
                    if (preview) {
                        preview.innerHTML = '';
                        // FIX (request — inline mid-article images): this used
                        // to only ever show d.image (a single cover shot), so
                        // an admin editing an article with multiple uploaded
                        // pictures couldn't see or reference any but the
                        // first — no way to insert the others into the body.
                        // _editingArticleMedia (set just above) already holds
                        // the FULL list; render every item as a numbered,
                        // clickable thumbnail so [img:N] tokens can be
                        // inserted for any of them, the same as a fresh
                        // upload.
                        _editingArticleMedia.forEach(function (url, idx) {
                            var isVid = /\.(mp4|webm|mov)(\?|$)/i.test(url) || /\/video\/upload\//i.test(url);
                            preview.appendChild(_buildMediaPreviewThumb(url, idx, isVid));
                        });
                    }

                    var form = document.getElementById('admin-news-form');
                    var submitBtn = form && form.querySelector('button[type="submit"]');
                    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';

                    var cancelBtn = document.getElementById('admin-news-cancel-edit-btn');
                    if (!cancelBtn && form) {
                        cancelBtn = document.createElement('button');
                        cancelBtn.type = 'button';
                        cancelBtn.id = 'admin-news-cancel-edit-btn';
                        cancelBtn.className = 'btn';
                        cancelBtn.style.cssText = 'margin-left:10px;';
                        cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Edit';
                        cancelBtn.addEventListener('click', _cancelEdit);
                        if (submitBtn && submitBtn.parentNode) submitBtn.parentNode.appendChild(cancelBtn);
                    }
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';

                    if (form && typeof form.scrollIntoView === 'function') { try { form.scrollIntoView({ block: 'start' }); } catch (e) { form.scrollIntoView(); } }
                    if (typeof window.showNotification === 'function') window.showNotification('Editing \u201C' + (d.title || 'article') + '\u201D \u2014 change it above, then tap Save Changes.', 'info');
                    _feedbackNews('Editing "' + (d.title || 'article') + '" — make your changes and tap Save Changes.', 'info');
                }).catch(function (e) {
                    if (typeof window.showNotification === 'function') window.showNotification('Could not load article: ' + (e && e.message || 'try again.'), 'error');
                });
            };

            // Delegated, capture-phase click handling for the table's Edit / Delete buttons. Rows can be
            // drawn by this file OR by app-news.js's own listener; either way the row carries data-post-id,
            // so route the tap here (and stop it, so an inline onclick can't fire a second time).
            if (!window._adminNewsTableDelegated) {
                window._adminNewsTableDelegated = true;
                document.addEventListener('click', function (e) {
                    var b = e.target && e.target.closest ? e.target.closest('#admin-news-table-body button') : null;
                    if (!b) return;
                    var tr = b.closest('tr[data-post-id]'); if (!tr) return;
                    var label = (b.textContent || '').trim().toLowerCase();
                    var isDel = /delete/.test(label) || /Delete/.test(b.getAttribute('onclick') || '');
                    var isEdit = !isDel && (/edit/.test(label) || /Edit/.test(b.getAttribute('onclick') || ''));
                    if (!isDel && !isEdit) return;
                    e.preventDefault(); e.stopPropagation();
                    if (isDel) window._adminDeleteNewsArticle(tr.dataset.postId); else window._adminEditNewsArticle(tr.dataset.postId);
                }, true);
            }

            /* ── Wire toolbar formatting buttons ── */
            function _wireToolbar() {
                var toolbar = document.getElementById('admin-news-toolbar');
                var body    = document.getElementById('admin-news-body');
                if (!toolbar || !body || toolbar._newsToolbarWired) return;
                toolbar._newsToolbarWired = true;
                toolbar.addEventListener('click', function(e) {
                    var btn = e.target.closest('.admin-news-fmt-btn');
                    if (!btn) return;
                    var fmt = btn.dataset.fmt;
                    var start = body.selectionStart;
                    var end   = body.selectionEnd;
                    var sel   = body.value.substring(start, end);
                    var before = body.value.substring(0, start);
                    var after  = body.value.substring(end);
                    var insert = sel;
                    if (fmt === 'bold')   insert = '**' + (sel || 'bold text') + '**';
                    if (fmt === 'italic') insert = '_' + (sel || 'italic text') + '_';
                    if (fmt === 'h2')     insert = '\n## ' + (sel || 'Heading') + '\n';
                    if (fmt === 'quote')  insert = '\n> ' + (sel || 'quote') + '\n';
                    if (fmt === 'bullet') insert = '\n- ' + (sel || 'list item') + '\n';
                    body.value = before + insert + after;
                    body.focus();
                    body.selectionStart = body.selectionEnd = before.length + insert.length;
                    e.preventDefault();
                });
            }

            /* ── Wire media preview for news upload ── */
            function _wireNewsMediaInput() {
                var input = document.getElementById('admin-news-media');
                if (!input || input._newsMediaWired) return;
                input._newsMediaWired = true;
                input.addEventListener('change', function() {
                    var preview = document.getElementById('admin-news-media-preview');
                    if (!preview) return;
                    preview.innerHTML = '';
                    // FIX (request — inline mid-article images): each thumb
                    // is now numbered + clickable (_buildMediaPreviewThumb)
                    // instead of a plain, inert preview — tapping one
                    // inserts that file's [img:N] token into the article
                    // body at the cursor. Picking new files here always
                    // matches what the submit handler will actually save
                    // (files.length loop -> mediaUrls, in this same order),
                    // so index N here is guaranteed correct.
                    Array.from(input.files || []).forEach(function(file, idx) {
                        var url = URL.createObjectURL(file);
                        var isVid = file.type.startsWith('video/');
                        preview.appendChild(_buildMediaPreviewThumb(url, idx, isVid));
                    });
                });
            }

            /* ── Wire the form submit ── */
            function _wireNewsFormSubmit() {
                var form = document.getElementById('admin-news-form');
                if (!form || form._newsFormWired) return;
                form._newsFormWired = true;

                form.addEventListener('submit', async function(e) {
                    e.preventDefault();
                    e.stopImmediatePropagation();

                    var titleEl    = document.getElementById('admin-news-title');
                    var writerEl   = document.getElementById('admin-news-writer');
                    var categoryEl = document.getElementById('admin-news-category');
                    var pubdateEl  = document.getElementById('admin-news-pubdate');
                    var summaryEl  = document.getElementById('admin-news-summary');
                    var bodyEl     = document.getElementById('admin-news-body');
                    var mediaInput = document.getElementById('admin-news-media');
                    var displayAsEl = document.getElementById('admin-news-display-as');
                    var submitBtn  = form.querySelector('button[type="submit"]');

                    var title  = titleEl  ? titleEl.value.trim()  : '';
                    var writer = writerEl ? writerEl.value.trim() : '';
                    var body   = bodyEl   ? bodyEl.value.trim()   : '';
                    // FIX (bug: "news section always shows 'admin' as the author in the
                    // public dashboard feed, regardless of who wrote it"): this used to be
                    // hardcoded below to the logged-in admin account's own username (or the
                    // literal string 'admin'), completely ignoring the "Writer's Name" field
                    // above even though it's a required field the admin fills in every time.
                    // #admin-news-display-as (added alongside this fix, see index.html) lets
                    // the admin choose per-article whether the public feed should show the
                    // writer's name or "Admin" — defaults to the writer's name, since that's
                    // what the required field is FOR and what was actually expected.
                    var displayAs   = displayAsEl ? displayAsEl.value : 'writer';
                    var displayName = (displayAs === 'admin') ? 'Admin' : (writer || 'Admin');

                    if (!title)  { _feedbackNews('Article title is required.', 'error'); return; }
                    if (!writer) { _feedbackNews('Writer name is required.', 'error'); return; }
                    if (!body)   { _feedbackNews('Article body is required.', 'error'); return; }

                    // FIX (2026-08-14 — "Edit and delete options are not
                    // available" / Edit populated the form but silently
                    // published a duplicate instead of saving): everything
                    // below this point used to build a brand-new article
                    // (new id, new createdAt, publishedBy reset to the
                    // CURRENTLY logged-in admin) on every submit, whether
                    // this form was opened via "Publish Article" or via
                    // Edit -> "Save Changes". _editingArticleId (set by
                    // window._adminEditNewsArticle above) was tracked but
                    // never actually read here, so "Save Changes" always
                    // took the create path: it minted a second, separate
                    // article doc, left the original untouched, and the
                    // admin's edits appeared to vanish (they were saved —
                    // just under a new id the admin never asked for).
                    // isEditing/articleId below make the rest of this
                    // handler branch correctly for both modes.
                    var isEditing  = !!_editingArticleId;
                    var articleId  = _editingArticleId || ('news-' + Date.now());

                    var origText = submitBtn ? submitBtn.innerHTML : '';
                    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (isEditing ? 'Saving…' : 'Publishing…'); }
                    _feedbackNews(isEditing ? 'Saving changes…' : 'Publishing article…', 'info');

                    try {
                        /* Upload media files */
                        var mediaUrls = [];
                        var files = Array.from((mediaInput && mediaInput.files) || []);
                        // ADDED (2026-08-10 — upload progress tracker)
                        var _adminNewsBar = (typeof window.empUploadProgress === 'object')
                            ? window.empUploadProgress.attach(document.getElementById('admin-news-feedback') ? document.getElementById('admin-news-feedback').parentElement : form, files.length > 1 ? 'Media' : 'Upload')
                            : { update: function () {}, done: function () {}, fail: function () {} };
                        for (var i = 0; i < files.length; i++) {
                            try {
                                var url = await window.uploadToCloudinary(files[i], function (pct) {
                                    var overall = Math.round(((i + (pct / 100)) / files.length) * 100);
                                    _adminNewsBar.update(overall, files.length > 1 ? ('File ' + (i + 1) + '/' + files.length) : null);
                                });
                                if (url) mediaUrls.push(url);
                            } catch(ue) { console.warn('[AdminNews] Media upload error:', ue.message); }
                        }
                        if (files.length) _adminNewsBar.done();

                        // FIX (2026-08-14, same edit-mode fix as above): if this is
                        // an edit and the admin didn't pick a new file, keep the
                        // article's existing photo/video (captured by
                        // window._adminEditNewsArticle into _editingArticleMedia)
                        // instead of wiping it — an untouched file input means
                        // "leave the media as it was," not "remove it."
                        if (!mediaUrls.length && isEditing && _editingArticleMedia.length) {
                            mediaUrls = _editingArticleMedia.slice();
                        }

                        var article = {
                            id:        articleId,
                            title:     title,
                            writer:    writer,
                            category:  categoryEl ? categoryEl.value : 'impact',
                            pubdate:   pubdateEl  ? pubdateEl.value  : '',
                            summary:   summaryEl  ? summaryEl.value.trim() : '',
                            body:      body,
                            media:     mediaUrls,
                            image:     mediaUrls[0] || '',
                            // Editing keeps the ORIGINAL publish date so a text/typo
                            // fix doesn't bump the article back to the top of the
                            // public feed as if it were brand new.
                            createdAt: (isEditing && _editingArticleCreatedAt) ? _editingArticleCreatedAt : new Date().toISOString(),
                            publishedBy: (isEditing && _editingArticlePublishedBy) ? _editingArticlePublishedBy : ((window.userState && window.userState.id) || 'admin'),
                            displayAs: displayAs
                        };

                        /* Save to Firestore — write to news_posts so the real-time
                           listener in app-news.js propagates it to all devices and
                           also populates the dashboard strip via _newsCache.
                           Also archive a copy in news_articles for admin history. */
                        if (window._firebaseLoaded && window.fbDb) {
                            // FIX (2026-08-14, same edit-mode fix as above): was a bare
                            // .set(...) (full overwrite). On a first publish that's
                            // identical to merge:true since there's nothing to
                            // preserve — but on an EDIT save it would have wiped this
                            // doc's likes/views/commentCount back to whatever this
                            // payload doesn't mention (i.e. gone), since those fields
                            // are only ever written by separate engagement code paths,
                            // never by this form. merge:true keeps this write scoped to
                            // exactly the fields the admin can actually edit here.
                            await window.fbDb.collection('news_posts').doc(article.id).set({
                                id:          article.id,
                                title:       article.title,
                                content:     article.body,
                                writer:      article.writer,
                                category:    article.category,
                                summary:     article.summary,
                                pubdate:     article.pubdate,
                                mediaUrl:    article.image  || null,
                                mediaType:   (article.image && files[0]) ? (files[0].type || null) : null,
                                media:       article.media,
                                userId:      article.publishedBy,
                                // FIX: was (window.userState && window.userState.username) ||
                                // 'admin' — always the logged-in admin's own handle, never the
                                // writer typed into the required "Writer's Name" field above.
                                // app-news.js's public renderer shows this `username` field
                                // as-is (see its _buildNewsItem: n.username || 'Empyrean News'),
                                // so that's exactly why "admin" was showing regardless of who
                                // actually wrote the piece. Now driven by the Display Author As
                                // choice (defaults to the writer's name).
                                username:    displayName,
                                displayAs:   displayAs,
                                createdAt:   article.createdAt,
                                publishedBy: article.publishedBy
                            }, { merge: true });
                            /* Archive copy.
                               FIX (bug: "published article does not register in the news
                               log"): this write used to be fire-and-forget — not awaited,
                               and any failure silently swallowed by an empty .catch(). The
                               very next thing this handler does is call _refreshNewsTable()
                               (a few lines below), which queries THIS SAME news_articles
                               collection and then unconditionally replaces the whole table's
                               innerHTML with whatever that query returned. If the query
                               resolved before this write had actually reached the backend —
                               easy to hit on this app's already-documented weak-connection
                               conditions (see app-patch-v26/v31/v35's own notes on this same
                               device) — the just-published article was simply absent from
                               that query's results, and the optimistic row addNewsPost()
                               already inserted via _syncAdminTable() got wiped out along with
                               it by that same innerHTML replace. Net effect: the article
                               published fine (news_posts + the public feed were unaffected —
                               different collection, different code path) but never appeared
                               in the admin's own "Published Articles" log. Awaiting this
                               write closes that race: _refreshNewsTable() now can't run until
                               the archive doc is actually committed, so its query is
                               guaranteed to include it. A real failure now also surfaces in
                               the console (and no longer looks identical to "worked fine")
                               instead of vanishing silently. */
                            await window.fbDb.collection('news_articles').doc(article.id).set(article, { merge: true })
                                .catch(function(archErr) {
                                    console.warn('[AdminNews] Archive write to news_articles failed — article will not appear in the Published Articles log until this succeeds:', archErr && archErr.message);
                                });
                        }

                        /* Immediately inject into app-news.js cache so dashboard
                           strip and news section update even before Firestore fires */
                        if (typeof window.addNewsPost === 'function') {
                            window.addNewsPost({
                                id:        article.id,
                                title:     article.title,
                                content:   article.body,
                                category:  article.category,
                                mediaUrl:  article.image  || null,
                                mediaType: (article.image && files[0]) ? (files[0].type || null) : null,
                                // FIX (request — inline mid-article images /
                                // multi-picture gallery): this optimistic
                                // pre-Firestore cache entry was missing the
                                // full media array (only mediaUrl, the
                                // single cover shot, was ever passed) — so
                                // right after publishing, before the real
                                // news_posts onSnapshot delivers the full
                                // doc, the gallery/thumbnail strip and any
                                // [img:N] tokens beyond the first picture
                                // would briefly render as missing. The
                                // Firestore doc already carries this field
                                // (see the news_posts .set() call above);
                                // this just stops the optimistic copy from
                                // being incomplete for those few seconds.
                                media:     article.media,
                                userId:    article.publishedBy,
                                username:  displayName,
                                createdAt: article.createdAt
                            });
                        }

                        _feedbackNews(isEditing
                            ? ('✅ Article "' + title + '" updated successfully!')
                            : ('✅ Article "' + title + '" published successfully!'), 'success');
                        if (typeof window.showNotification === 'function') {
                            window.showNotification(isEditing ? '✅ Article updated!' : '✅ Article published!', 'success');
                        }

                        // FIX (2026-08-14, same edit-mode fix as above): was a plain
                        // form.reset() that cleared the FIELDS but left _editingArticleId
                        // set and the button still reading "Save Changes" — so the very
                        // next thing typed into the now-blank form would itself have been
                        // saved OVER the just-edited article on the next submit.
                        // _cancelEdit() resets the fields AND returns the form to normal
                        // create mode (clears _editingArticleId/_editingArticleMedia/etc.,
                        // restores the "Publish Article" button, hides Cancel Edit).
                        _cancelEdit();

                        /* Refresh the published articles table — now safe to run
                           immediately since the news_articles write above is awaited. */
                        _refreshNewsTable();

                    } catch(err) {
                        console.error('[AdminNews] Publish error:', err);
                        _feedbackNews('❌ Failed to publish: ' + (err.message || 'Please try again.'), 'error');
                    } finally {
                        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = origText; }
                    }
                });

                /* Preview button */
                var previewBtn = document.getElementById('admin-news-preview-btn');
                if (previewBtn && !previewBtn._newsPreviewWired) {
                    previewBtn._newsPreviewWired = true;
                    previewBtn.addEventListener('click', function() {
                        var titleEl = document.getElementById('admin-news-title');
                        var bodyEl  = document.getElementById('admin-news-body');
                        var t = titleEl ? titleEl.value : '';
                        var b = bodyEl  ? bodyEl.value  : '';
                        if (!t && !b) { if (typeof window.showNotification === 'function') window.showNotification('Fill in title and body to preview.', 'warning'); return; }
                        var win = window.open('', '_blank', 'width=800,height=600');
                        if (win) {
                            win.document.write('<html><head><title>Preview: '+t+'</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.8;color:#222;}h1{font-size:2rem;}h2{font-size:1.4rem;}blockquote{border-left:4px solid #1B2B8B;margin:0;padding:0 20px;color:#555;}</style></head><body><h1>'+t+'</h1><hr><pre style="white-space:pre-wrap;font-family:inherit;">'+b+'</pre></body></html>');
                            win.document.close();
                        }
                    });
                }
            }

            /* Run wiring now and after admin tab switches */
            function _tryWire() {
                _wireToolbar();
                _wireNewsMediaInput();
                _wireNewsFormSubmit();
            }

            if (document.readyState !== 'loading') _tryWire();
            else document.addEventListener('DOMContentLoaded', _tryWire);
            document.addEventListener('empyrean-init-done', function() { setTimeout(_tryWire, 400); });

            /* Re-wire when admin publish tab is clicked */
            document.addEventListener('click', function(e) {
                var btn = e.target.closest && e.target.closest('[data-tab="admin-publish-tab"]');
                if (btn) { setTimeout(_tryWire, 200); setTimeout(_refreshNewsTable, 300); }
            });

            console.log('[Admin] ✅ News form wired — publish, preview, toolbar, media, and table.');
        }());


        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — USER MANAGEMENT
        // Wires the existing #admin-users-tab markup (search, results list,
        // detail panel, "All Registered Users" table). Supports:
        //   • Listing all users from Firestore `users` collection
        //   • Searching by Unique ID (uid), username, or email
        //   • Viewing a user's profile + their business page(s)
        //   • Deleting a user: removes their `users/{uid}` Firestore doc and
        //     any `business_pages` (+ associated `business_posts`) they own.
        //
        // NOTE: This removes the user's data/profile from the app entirely.
        // It does NOT delete their Firebase Authentication account (that
        // requires a server-side Admin SDK, which this app does not have) —
        // their login credentials remain, but they will have no profile and
        // will be treated as a new user on next login.
        // ═══════════════════════════════════════════════════════════════════
        (function initAdminUserManagement() {

            function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
            function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); else console.log('[Admin]', msg); }

            var _allUsersCache = [];

            function _fmtDate(ts) {
                try {
                    if (!ts) return '—';
                    var d = ts.toDate ? ts.toDate() : new Date(ts);
                    if (isNaN(d.getTime())) return '—';
                    return d.toLocaleDateString();
                } catch (e) { return '—'; }
            }

            function _kycLabel(u) {
                var k = u.kycStatus || (u.kyc && u.kyc.status) || '';
                if (!k) return '<span style="color:#9CA3AF;">Not Submitted</span>';
                if (k === 'verified' || k === 'approved') return '<span style="color:#16A34A;font-weight:700;">Verified</span>';
                if (k === 'pending') return '<span style="color:#F59E0B;font-weight:700;">Pending</span>';
                if (k === 'rejected') return '<span style="color:#EF4444;font-weight:700;">Rejected</span>';
                return _esc(k);
            }

            function _statusLabel(u) {
                if (u.isAdmin) return '<span style="color:#1B2B8B;font-weight:700;"><i class="fas fa-user-shield"></i> Admin</span>';
                if (u.banned) return '<span style="color:#EF4444;font-weight:700;">Banned</span>';
                if (u.disabled || u.suspended) return '<span style="color:#F59E0B;font-weight:700;">Suspended</span>';
                return '<span style="color:#16A34A;font-weight:700;">Active</span>';
            }

            function _avatarHTML(u) {
                var av = u.avatar || u.profilePhoto || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || u.username || 'U') + '&background=1B2B8B&color=fff&size=64');
                return '<img src="' + _esc(av) + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=64\'">';
            }

            /* ── Render one row of the "All Registered Users" table ── */
            function _userRowHTML(u) {
                return '<tr data-uid="' + _esc(u.id) + '" style="border-bottom:1px solid rgba(10,14,39,0.06);">'
                    + '<td style="padding:10px 16px;font-size:0.8rem;font-family:monospace;color:#6B7280;">' + _esc(u.id) + '</td>'
                    + '<td style="padding:10px 16px;"><div style="display:flex;align-items:center;gap:8px;">' + _avatarHTML(u)
                        + '<div><div style="font-weight:700;font-size:0.85rem;color:#0A0E27;">' + _esc(u.fullName || u.username || 'Unnamed') + '</div>'
                        + '<div style="font-size:0.72rem;color:#9CA3AF;">@' + _esc(u.username || '—') + '</div></div></div></td>'
                    + '<td style="padding:10px 16px;font-size:0.82rem;color:#374151;">' + _esc(u.email || '—') + '</td>'
                    + '<td style="padding:10px 16px;font-size:0.82rem;color:#374151;">' + (Number(u.empyBalance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>'
                    + '<td style="padding:10px 16px;font-size:0.8rem;">' + _kycLabel(u) + '</td>'
                    + '<td style="padding:10px 16px;font-size:0.8rem;">' + _statusLabel(u) + '</td>'
                    + '<td style="padding:10px 16px;white-space:nowrap;">'
                        + '<button class="admin-user-view-btn" data-uid="' + _esc(u.id) + '" style="padding:6px 12px;border-radius:8px;background:rgba(27,43,139,0.08);color:#1B2B8B;border:1px solid rgba(27,43,139,0.18);font-size:0.76rem;font-weight:700;cursor:pointer;margin-right:6px;"><i class="fas fa-eye"></i> View</button>'
                        + '<button class="admin-user-delete-btn" data-uid="' + _esc(u.id) + '" style="padding:6px 12px;border-radius:8px;background:rgba(239,68,68,0.08);color:#EF4444;border:1px solid rgba(239,68,68,0.2);font-size:0.76rem;font-weight:700;cursor:pointer;"><i class="fas fa-trash"></i> Delete</button>'
                    + '</td></tr>';
            }

            function _renderAllUsersTable(list) {
                var tbody = document.getElementById('admin-all-users-table');
                var badge = document.getElementById('admin-total-users-badge');
                if (badge) badge.textContent = list.length + (list.length === 1 ? ' user' : ' users');
                if (!tbody) return;
                if (!list.length) {
                    tbody.innerHTML = '<tr><td colspan="7" style="padding:30px;text-align:center;color:#9CA3AF;font-size:0.88rem;">No users found.</td></tr>';
                    return;
                }
                tbody.innerHTML = list.map(_userRowHTML).join('');
            }

            function _loadAllUsers() {
                if (!fbDb) return Promise.resolve([]);
                var tbody = document.getElementById('admin-all-users-table');
                if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:30px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading users…</td></tr>';
                return fbDb.collection('users').limit(200).get().then(function (snap) {
                    var list = [];
                    snap.forEach(function (doc) {
                        var d = doc.data();
                        d.id = doc.id;
                        list.push(d);
                    });
                    _allUsersCache = list;
                    _renderAllUsersTable(list);
                    return list;
                }).catch(function (err) {
                    console.warn('[Admin Users] load failed:', err && err.message);
                    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:30px;text-align:center;color:#EF4444;">Could not load users: ' + _esc(err && err.message) + '</td></tr>';
                    return [];
                });
            }

            /* ── Detail panel: shows full profile + business page(s) + delete action ── */
            function _showUserDetail(u) {
                var panel = document.getElementById('admin-user-detail-panel');
                var content = document.getElementById('admin-user-detail-content');
                if (!panel || !content) return;

                var html = ''
                    + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px;">'
                    + '<div style="display:flex;align-items:center;gap:14px;">'
                    + '<img src="' + _esc(u.avatar || u.profilePhoto || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || u.username || 'U') + '&background=1B2B8B&color=fff&size=100')) + '" style="width:64px;height:64px;border-radius:50%;object-fit:cover;" onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=100\'">'
                    + '<div><h3 style="margin:0 0 2px;font-size:1.05rem;font-weight:900;color:#0A0E27;">' + _esc(u.fullName || u.username || 'Unnamed User') + '</h3>'
                    + '<div style="font-size:0.8rem;color:#6B7280;">@' + _esc(u.username || '—') + ' &middot; ' + _esc(u.email || '—') + '</div>'
                    + '<div style="font-size:0.74rem;color:#9CA3AF;margin-top:2px;font-family:monospace;">UID: ' + _esc(u.id) + '</div></div>'
                    + '</div>'
                    + '<button id="admin-user-detail-close" style="background:rgba(10,14,39,0.07);border:none;width:32px;height:32px;border-radius:50%;font-size:0.95rem;cursor:pointer;color:#6B7280;"><i class="fas fa-times"></i></button>'
                    + '</div>'
                    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;">'
                    + '<div style="background:rgba(27,43,139,0.05);border-radius:12px;padding:12px;"><div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;font-weight:700;">EMPY Balance</div><div style="font-size:1.05rem;font-weight:800;color:#0A0E27;">' + (Number(u.empyBalance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</div></div>'
                    + '<div style="background:rgba(27,43,139,0.05);border-radius:12px;padding:12px;"><div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;font-weight:700;">KYC Status</div><div style="font-size:0.92rem;font-weight:800;margin-top:2px;">' + _kycLabel(u) + '</div></div>'
                    + '<div style="background:rgba(27,43,139,0.05);border-radius:12px;padding:12px;"><div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;font-weight:700;">Account Status</div><div style="font-size:0.92rem;font-weight:800;margin-top:2px;">' + _statusLabel(u) + '</div></div>'
                    + '<div style="background:rgba(27,43,139,0.05);border-radius:12px;padding:12px;"><div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;font-weight:700;">Joined</div><div style="font-size:0.92rem;font-weight:800;color:#0A0E27;">' + _fmtDate(u.createdAt) + '</div></div>'
                    + '</div>'
                    + '<div id="admin-user-biz-pages" style="margin-bottom:16px;"><div style="font-size:0.78rem;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">Business Page(s)</div><div style="color:#9CA3AF;font-size:0.85rem;"><i class="fas fa-spinner fa-spin"></i> Checking…</div></div>'
                    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
                    + (u.banned
                        ? '<button id="admin-user-reactivate-btn" data-uid="' + _esc(u.id) + '" style="flex:1;min-width:150px;padding:12px;border-radius:14px;background:rgba(22,163,74,0.08);color:#16A34A;border:2px solid rgba(22,163,74,0.25);font-weight:800;font-size:0.85rem;cursor:pointer;"><i class="fas fa-user-check" style="margin-right:7px;"></i>Reactivate Account</button>'
                        : (u.suspended
                            ? '<button id="admin-user-reactivate-btn" data-uid="' + _esc(u.id) + '" style="flex:1;min-width:150px;padding:12px;border-radius:14px;background:rgba(22,163,74,0.08);color:#16A34A;border:2px solid rgba(22,163,74,0.25);font-weight:800;font-size:0.85rem;cursor:pointer;"><i class="fas fa-user-check" style="margin-right:7px;"></i>Lift Suspension</button>'
                            : '<button id="admin-user-suspend-btn" data-uid="' + _esc(u.id) + '" style="flex:1;min-width:150px;padding:12px;border-radius:14px;background:rgba(245,158,11,0.08);color:#B45309;border:2px solid rgba(245,158,11,0.25);font-weight:800;font-size:0.85rem;cursor:pointer;"><i class="fas fa-user-clock" style="margin-right:7px;"></i>Suspend Account</button>')
                      )
                    + (u.banned ? '' : '<button id="admin-user-ban-btn" data-uid="' + _esc(u.id) + '" style="flex:1;min-width:150px;padding:12px;border-radius:14px;background:rgba(239,68,68,0.08);color:#EF4444;border:2px solid rgba(239,68,68,0.25);font-weight:800;font-size:0.85rem;cursor:pointer;"><i class="fas fa-ban" style="margin-right:7px;"></i>Ban User</button>')
                    + '</div>'
                    + '<button id="admin-user-delete-detail-btn" data-uid="' + _esc(u.id) + '" style="width:100%;padding:13px;border-radius:14px;background:rgba(239,68,68,0.08);color:#EF4444;border:2px solid rgba(239,68,68,0.25);font-weight:800;font-size:0.9rem;cursor:pointer;"><i class="fas fa-user-times" style="margin-right:7px;"></i>Delete This User</button>';

                content.innerHTML = html;
                panel.style.display = 'block';
                panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

                document.getElementById('admin-user-detail-close').addEventListener('click', function () {
                    panel.style.display = 'none';
                });

                /* Load this user's business page(s) */
                var bizContainer = document.getElementById('admin-user-biz-pages').querySelector('div:last-child');
                if (fbDb) {
                    fbDb.collection('business_pages').where('ownerId', '==', u.id).get().then(function (snap) {
                        if (snap.empty) { bizContainer.innerHTML = '<div style="color:#9CA3AF;font-size:0.85rem;">No business page.</div>'; return; }
                        var rows = [];
                        snap.forEach(function (doc) {
                            var b = doc.data(); b.id = doc.id;
                            rows.push('<div style="display:flex;align-items:center;justify-content:between;gap:10px;padding:10px 12px;border:1px solid rgba(10,14,39,0.08);border-radius:10px;margin-bottom:6px;">'
                                + '<div style="flex:1;min-width:0;"><strong style="font-size:0.85rem;color:#0A0E27;">' + _esc(b.name || b.businessName || 'Business') + '</strong>'
                                + '<div style="font-size:0.72rem;color:#9CA3AF;font-family:monospace;">' + _esc(b.id) + '</div></div>'
                                + '<button class="admin-bizpage-delete-btn" data-bizid="' + _esc(b.id) + '" style="padding:5px 10px;border-radius:8px;background:rgba(239,68,68,0.08);color:#EF4444;border:1px solid rgba(239,68,68,0.2);font-size:0.74rem;font-weight:700;cursor:pointer;"><i class="fas fa-trash"></i> Delete Page</button>'
                                + '</div>');
                        });
                        bizContainer.innerHTML = rows.join('');
                        bizContainer.querySelectorAll('.admin-bizpage-delete-btn').forEach(function (btn) {
                            btn.addEventListener('click', function () { _deleteBusinessPage(btn.dataset.bizid, btn); });
                        });
                    }).catch(function () {
                        bizContainer.innerHTML = '<div style="color:#9CA3AF;font-size:0.85rem;">Could not check business pages.</div>';
                    });
                } else {
                    bizContainer.innerHTML = '<div style="color:#9CA3AF;font-size:0.85rem;">Not connected.</div>';
                }

                document.getElementById('admin-user-delete-detail-btn').addEventListener('click', function () {
                    _deleteUser(u.id, this, function () { panel.style.display = 'none'; });
                });

                function _runModerationAction(btn, action, confirmMsg) {
                    if (typeof window._empGovModerateUser !== 'function') {
                        _notify('Moderation module not loaded yet — please try again in a moment.', 'error');
                        return;
                    }
                    if (!btn._confirming) {
                        btn._confirming = true;
                        var original = btn.innerHTML;
                        btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Confirm — ' + confirmMsg;
                        setTimeout(function () { btn._confirming = false; btn.innerHTML = original; }, 4000);
                        return;
                    }
                    btn._confirming = false;
                    btn.disabled = true;
                    window._empGovModerateUser(u.id, action).then(function () {
                        _notify('Account updated.', 'success');
                        panel.style.display = 'none';
                        _loadAllUsers();
                    }).catch(function (err) {
                        _notify('Could not update this account: ' + (err && err.message || 'unknown error'), 'error');
                        btn.disabled = false;
                    });
                }

                var suspendBtn = document.getElementById('admin-user-suspend-btn');
                if (suspendBtn) suspendBtn.addEventListener('click', function () { _runModerationAction(this, 'suspend', 'Suspend?'); });

                var banBtn = document.getElementById('admin-user-ban-btn');
                if (banBtn) banBtn.addEventListener('click', function () { _runModerationAction(this, 'ban', 'Ban?'); });

                var reactivateBtn = document.getElementById('admin-user-reactivate-btn');
                if (reactivateBtn) reactivateBtn.addEventListener('click', function () { _runModerationAction(this, 'reactivate', 'Reactivate?'); });
            }

            /* ── Delete a business page (+ its posts) ── */
            function _deleteBusinessPage(bizId, btn) {
                if (!bizId) return;
                if (!btn._confirming) {
                    btn._confirming = true;
                    btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Confirm';
                    setTimeout(function () { btn._confirming = false; btn.innerHTML = '<i class="fas fa-trash"></i> Delete Page'; }, 4000);
                    return;
                }
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting…';
                if (!fbDb) { _notify('Not connected.', 'error'); return; }
                fbDb.collection('business_posts').where('pageId', '==', bizId).get()
                    .then(function (snap) {
                        var dels = [];
                        snap.forEach(function (doc) { dels.push(doc.ref.delete().catch(function () {})); });
                        return Promise.all(dels);
                    })
                    .then(function () { return fbDb.collection('business_pages').doc(bizId).delete(); })
                    .then(function () {
                        _notify('Business page deleted.', 'success');
                        var row = btn.closest('div');
                        if (row && row.parentNode) row.parentNode.removeChild(row);
                        /* Remove from dashboard if present */
                        document.querySelectorAll('[data-biz-id="' + bizId + '"],[data-page-id="' + bizId + '"]').forEach(function (c) { c.remove(); });
                    })
                    .catch(function (err) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-trash"></i> Delete Page';
                        _notify('Failed to delete page: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            }

            /* ── Delete a user's Firestore profile + their business page(s)/post(s) ──
               Does NOT remove their Firebase Auth credentials (requires Admin SDK). */
            function _deleteUser(uid, btn, onDone) {
                if (!uid) return;
                if (!btn._confirming) {
                    btn._confirming = true;
                    btn.innerHTML = '<i class="fas fa-exclamation-triangle" style="margin-right:7px;"></i>Tap again to permanently delete this user';
                    setTimeout(function () {
                        if (btn._confirming) {
                            btn._confirming = false;
                            btn.innerHTML = btn.dataset.origLabel || '<i class="fas fa-trash"></i> Delete';
                        }
                    }, 4000);
                    if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.innerHTML;
                    return;
                }
                if (!fbDb) { _notify('Not connected.', 'error'); return; }
                btn._confirming = false;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:7px;"></i>Deleting…';

                /* 1. Find + delete this user's business pages and their posts */
                fbDb.collection('business_pages').where('ownerId', '==', uid).get()
                    .then(function (pagesSnap) {
                        var pageDeletes = [];
                        pagesSnap.forEach(function (pageDoc) {
                            var pid = pageDoc.id;
                            pageDeletes.push(
                                fbDb.collection('business_posts').where('pageId', '==', pid).get().then(function (postsSnap) {
                                    var postDels = [];
                                    postsSnap.forEach(function (pd) { postDels.push(pd.ref.delete().catch(function () {})); });
                                    return Promise.all(postDels);
                                }).then(function () { return pageDoc.ref.delete().catch(function () {}); })
                            );
                        });
                        return Promise.all(pageDeletes);
                    })
                    /* 2. Delete the user's own posts in business_posts (authored, even if pageless) */
                    .then(function () {
                        return fbDb.collection('business_posts').where('userId', '==', uid).get().then(function (snap) {
                            var dels = [];
                            snap.forEach(function (doc) { dels.push(doc.ref.delete().catch(function () {})); });
                            return Promise.all(dels);
                        });
                    })
                    /* 3. Delete the user's Firestore profile */
                    .then(function () { return fbDb.collection('users').doc(uid).delete(); })
                    .then(function () {
                        _notify('User deleted from the platform.', 'success');
                        _allUsersCache = _allUsersCache.filter(function (u) { return u.id !== uid; });
                        _renderAllUsersTable(_allUsersCache);
                        var row = document.querySelector('#admin-all-users-table tr[data-uid="' + uid + '"]');
                        if (row) row.remove();
                        if (typeof onDone === 'function') onDone();
                    })
                    .catch(function (err) {
                        btn.disabled = false;
                        btn.innerHTML = btn.dataset.origLabel || '<i class="fas fa-trash"></i> Delete';
                        _notify('Failed to delete user: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            }

            /* ── Search ── */
            function _runSearch() {
                var input = document.getElementById('admin-user-search-input');
                var typeSel = document.getElementById('admin-user-search-type');
                var resultsEl = document.getElementById('admin-user-search-results');
                if (!input || !resultsEl) return;
                var q = (input.value || '').trim();
                var type = typeSel ? typeSel.value : 'all';
                if (!q) { resultsEl.innerHTML = ''; return; }
                resultsEl.innerHTML = '<div style="padding:14px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Searching…</div>';

                var qLower = q.toLowerCase();
                function _matches(u) {
                    if (type === 'id' || type === 'all') { if ((u.id || '').toLowerCase() === qLower || (u.id || '').toLowerCase().indexOf(qLower) > -1) return true; }
                    if (type === 'username' || type === 'all') { if ((u.username || '').toLowerCase().indexOf(qLower.replace(/^@/, '')) > -1) return true; }
                    if (type === 'email' || type === 'all') { if ((u.email || '').toLowerCase().indexOf(qLower) > -1) return true; }
                    return false;
                }

                function _renderMatches(list) {
                    var matches = list.filter(_matches);
                    if (!matches.length) {
                        resultsEl.innerHTML = '<div style="padding:14px;text-align:center;color:#9CA3AF;font-size:0.88rem;">No users found matching "' + _esc(q) + '".</div>';
                        return;
                    }
                    resultsEl.innerHTML = matches.map(function (u) {
                        return '<div class="admin-user-result-item" data-uid="' + _esc(u.id) + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(10,14,39,0.08);border-radius:12px;margin-bottom:8px;cursor:pointer;">'
                            + _avatarHTML(u)
                            + '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:0.88rem;color:#0A0E27;">' + _esc(u.fullName || u.username || 'Unnamed') + '</div>'
                            + '<div style="font-size:0.76rem;color:#9CA3AF;">' + _esc(u.email || '') + ' &middot; ' + _esc(u.id) + '</div></div>'
                            + '<i class="fas fa-chevron-right" style="color:#bbb;"></i></div>';
                    }).join('');
                    resultsEl.querySelectorAll('.admin-user-result-item').forEach(function (item) {
                        item.addEventListener('click', function () {
                            var u = _allUsersCache.find(function (x) { return x.id === item.dataset.uid; });
                            if (u) _showUserDetail(u);
                        });
                    });
                }

                if (_allUsersCache.length) {
                    _renderMatches(_allUsersCache);
                } else {
                    _loadAllUsers().then(_renderMatches);
                }
            }

            /* ── Wire everything ── */
            function _wire() {
                var searchBtn = document.getElementById('admin-user-search-btn');
                var searchInput = document.getElementById('admin-user-search-input');
                if (searchBtn && !searchBtn._wired) {
                    searchBtn._wired = true;
                    searchBtn.addEventListener('click', _runSearch);
                }
                if (searchInput && !searchInput._wired) {
                    searchInput._wired = true;
                    searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') _runSearch(); });
                }

                /* Delegate clicks on the All Users table (View / Delete buttons) */
                var table = document.getElementById('admin-all-users-table');
                if (table && !table._wired) {
                    table._wired = true;
                    table.addEventListener('click', function (e) {
                        var viewBtn = e.target.closest('.admin-user-view-btn');
                        if (viewBtn) {
                            var u = _allUsersCache.find(function (x) { return x.id === viewBtn.dataset.uid; });
                            if (u) _showUserDetail(u);
                            return;
                        }
                        var delBtn = e.target.closest('.admin-user-delete-btn');
                        if (delBtn) { _deleteUser(delBtn.dataset.uid, delBtn); }
                    });
                }

                /* Load users when the Users tab is opened */
                document.addEventListener('click', function (e) {
                    var tabBtn = e.target.closest && e.target.closest('[data-tab="admin-users-tab"]');
                    if (tabBtn) setTimeout(_loadAllUsers, 150);
                });
            }

            if (document.readyState !== 'loading') _wire();
            else document.addEventListener('DOMContentLoaded', _wire);
            document.addEventListener('empyrean-init-done', function () { setTimeout(_wire, 400); });

            console.log('[Admin] ✅ User Management — search, list, view detail, delete user (+ business pages/posts).');
        }());


        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — URGENT SAFETY REPORTS (child safety / CSAE)
        // Self-contained card injected into #admin-users-tab, same pattern as
        // the Business Page Manager card just above. Surfaces
        // moderation_flags docs with severity:'urgent' — written by
        // app-reel.js's _submitReelReport() and app-marketplace-
        // governance.js's _submitReport() whenever a user picks "Child
        // sexual abuse or exploitation" as their report reason (see both
        // files' own comments at their moderation_flags.add() call), plus
        // app-fixes.js's pre-existing auto-moderation writer for explicit
        // content. Nothing previously read this collection back — these
        // reports were being written but never shown to anyone. Real-time
        // (onSnapshot), so a new urgent report appears here the moment it's
        // filed, no manual refresh needed.
        // ═══════════════════════════════════════════════════════════════════
        (function initAdminUrgentSafetyReports() {

            function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
            function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); else console.log('[Admin]', msg); }
            function _fmtWhen(v) {
                try {
                    var d = v && v.toDate ? v.toDate() : new Date(v);
                    if (isNaN(d.getTime())) return '—';
                    return d.toLocaleString();
                } catch (e) { return '—'; }
            }

            /* Walks an arbitrary Firestore doc's data recursively and
               collects every URL that points at one of this app's own
               media hosts (Cloudinary or Firebase/GCS Storage — same
               ALLOWED_HOSTS media-download-routes.js's proxy already
               trusts). Generic on purpose: reel/listing/business-page/
               business-post docs each use different field names for their
               media (videoUrl, images[], coverPhoto, media[], etc.) — this
               finds them all without needing to hardcode every collection's
               schema, the same approach migrate-once.js's own
               _collectCloudinaryUrls already takes for its Cloudinary-only
               case. */
            function _extractMediaUrls(value, into) {
                if (typeof value === 'string') {
                    if (/^https:\/\/(res\.cloudinary\.com|firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(value)) into.add(value);
                    return;
                }
                if (Array.isArray(value)) { value.forEach(function (v) { _extractMediaUrls(v, into); }); return; }
                if (value && typeof value === 'object') {
                    for (var k in value) { if (Object.prototype.hasOwnProperty.call(value, k)) _extractMediaUrls(value[k], into); }
                }
            }

            /* Best-effort call to server.js's new admin-only
               POST /api/media/purge (media-download-routes.js) — actually
               deletes the underlying file(s) from Cloudinary/Storage, not
               just the Firestore doc referencing them. Never throws: a
               purge failure (e.g. CLOUDINARY_API_KEY not yet configured —
               see render.yaml's own note) shouldn't undo or block the
               content takedown that already succeeded by the time this
               runs. */
            function _purgeMediaUrls(urls) {
                if (!urls || !urls.length) return Promise.resolve();
                if (!window.fbAuth || !window.fbAuth.currentUser || typeof window._empApiBase !== 'function') return Promise.resolve();
                return window.fbAuth.currentUser.getIdToken().then(function (token) {
                    return fetch(window._empApiBase() + '/api/media/purge', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ urls: urls.slice(0, 100) })
                    });
                }).catch(function (err) {
                    console.warn('[Admin] media purge call failed (content doc was already deleted — this cleanup step is best-effort):', err && err.message);
                });
            }

            var _unsub = null;

            function _injectCard() {
                if (document.getElementById('admin-urgent-safety-card')) return true;
                var tab = document.getElementById('admin-users-tab');
                if (!tab) return false;

                var card = document.createElement('div');
                card.className = 'card';
                card.id = 'admin-urgent-safety-card';
                card.style.cssText = 'margin-bottom:20px;border:1.5px solid rgba(239,68,68,0.35);';
                card.innerHTML =
                    '<h3 style="padding:20px 24px 0;display:flex;align-items:center;gap:10px;">'
                    + '<span style="background:#EF4444;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-shield-halved" style="color:#fff;font-size:0.9rem;"></i></span>'
                    + '<span>Urgent Safety Reports</span>'
                    + '<span id="admin-urgent-safety-badge" style="font-size:0.78rem;background:rgba(239,68,68,0.12);color:#EF4444;padding:3px 10px;border-radius:12px;margin-left:8px;font-weight:800;">0</span>'
                    + '</h3>'
                    + '<div class="card-content">'
                    + '<p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:16px;">Reports flagged "Child sexual abuse or exploitation" from any Report menu across the app (reels, marketplace) — reviewed here first, ahead of the normal report queues.</p>'
                    + '<div id="admin-urgent-safety-list"><div style="padding:20px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading…</div></div>'
                    + '</div>';

                tab.insertBefore(card, tab.firstChild);
                return true;
            }

            function _rowHTML(doc) {
                var d = doc.data();
                var contentBtn = '';
                if (d.type === 'reel') {
                    contentBtn = '<button class="admin-urgent-safety-remove-btn" data-id="' + _esc(doc.id) + '" data-type="reel" data-content-id="' + _esc(d.reelId || '') + '" style="padding:8px 14px;border-radius:10px;background:rgba(239,68,68,0.08);color:#EF4444;border:1.5px solid rgba(239,68,68,0.3);font-size:0.8rem;font-weight:800;cursor:pointer;"><i class="fas fa-trash"></i> Remove Content</button>';
                } else if (d.type === 'listing') {
                    contentBtn = '<button class="admin-urgent-safety-remove-btn" data-id="' + _esc(doc.id) + '" data-type="listing" data-content-id="' + _esc(d.targetId || '') + '" style="padding:8px 14px;border-radius:10px;background:rgba(239,68,68,0.08);color:#EF4444;border:1.5px solid rgba(239,68,68,0.3);font-size:0.8rem;font-weight:800;cursor:pointer;"><i class="fas fa-trash"></i> Remove Content</button>';
                } else if (d.type === 'seller') {
                    /* A seller-profile report has no single content doc to
                       delete — reuses app-marketplace-governance.js's own
                       window._empGovModerateUser('ban'), the exact same
                       function/effect (bans the account, cascades to
                       delisting every active listing they own) as the
                       "Ban Seller" button on its own Reports queue. */
                    contentBtn = '<button class="admin-urgent-safety-remove-btn" data-id="' + _esc(doc.id) + '" data-type="seller" data-content-id="' + _esc(d.targetId || d.sellerId || '') + '" style="padding:8px 14px;border-radius:10px;background:rgba(239,68,68,0.08);color:#EF4444;border:1.5px solid rgba(239,68,68,0.3);font-size:0.8rem;font-weight:800;cursor:pointer;"><i class="fas fa-user-slash"></i> Ban Seller</button>';
                }
                return '<div class="admin-urgent-safety-row" data-id="' + _esc(doc.id) + '" style="padding:14px;border:1.5px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.03);border-radius:14px;margin-bottom:10px;">'
                    + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
                        + '<div style="font-weight:800;font-size:0.88rem;color:#0A0E27;text-transform:capitalize;">' + _esc(d.type || 'content') + ' report</div>'
                        + '<div style="font-size:0.76rem;color:#9CA3AF;">' + _esc(_fmtWhen(d.flaggedAt)) + '</div>'
                    + '</div>'
                    + '<div style="font-size:0.82rem;color:#374151;margin-top:6px;">' + _esc(d.reason || 'Unspecified') + '</div>'
                    + '<div style="font-size:0.76rem;color:#9CA3AF;margin-top:4px;">Target ID: <span style="font-family:monospace;">' + _esc(d.reelId || d.targetId || '—') + '</span>'
                        + (d.sellerId ? ' &middot; Seller: <span style="font-family:monospace;">' + _esc(d.sellerId) + '</span>' : '')
                    + '</div>'
                    + '<div style="font-size:0.76rem;color:#9CA3AF;">Reported by: <span style="font-family:monospace;">' + _esc(d.reporterId || 'unknown') + '</span></div>'
                    + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">'
                        + '<button class="admin-urgent-safety-reviewed-btn" data-id="' + _esc(doc.id) + '" style="padding:8px 14px;border-radius:10px;background:#EF4444;color:#fff;border:none;font-size:0.8rem;font-weight:800;cursor:pointer;"><i class="fas fa-check"></i> Mark Reviewed</button>'
                        + contentBtn
                    + '</div>'
                    + '</div>';
            }

            /* Marks the moderation_flags doc reviewed with an audit trail of
               WHAT was done (kept separate from the plain "Mark Reviewed"
               button's write above only by the extra `action` field, so
               existing readers of `reviewed` keep working unchanged). */
            function _markReviewed(flagId, action) {
                if (!fbDb || !flagId) return Promise.reject(new Error('Not connected'));
                var us = (window.userState || {});
                return fbDb.collection('moderation_flags').doc(flagId).set({
                    reviewed: true,
                    reviewedAt: new Date().toISOString(),
                    reviewedBy: us.id || 'admin',
                    action: action || 'reviewed_only'
                }, { merge: true });
            }

            /* ── Remove the reported content itself (or ban the seller for
               a seller-type report), then mark the flag reviewed. Same
               tap-to-confirm pattern as the Business Page Manager's own
               _deletePage above — one tap arms it, a second tap within 4s
               actually deletes, so a stray tap can't remove content by
               accident. Hard delete (not the softer "Delist Listing" the
               ordinary marketplace Reports queue offers) — appropriate for
               a report already confirmed urgent enough to reach this
               panel. */
            function _removeContent(btn) {
                var type = btn.dataset.type;
                var contentId = btn.dataset.contentId;
                var flagId = btn.dataset.id;

                if (!btn._confirming) {
                    btn._confirming = true;
                    var label = type === 'seller' ? 'Tap again to ban' : 'Tap again to delete';
                    btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + label;
                    setTimeout(function () {
                        if (btn._confirming) {
                            btn._confirming = false;
                            btn.innerHTML = type === 'seller'
                                ? '<i class="fas fa-user-slash"></i> Ban Seller'
                                : '<i class="fas fa-trash"></i> Remove Content';
                        }
                    }, 4000);
                    return;
                }
                if (!fbDb || !contentId) { _notify('Missing content reference — cannot proceed.', 'error'); return; }
                btn._confirming = false;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

                var collectionName = type === 'reel' ? 'reels' : (type === 'listing' ? 'marketplace_listings' : null);
                var work;

                if (collectionName) {
                    /* Read the doc FIRST (before deleting it) so its media
                       URLs are still available to purge afterwards — once
                       the doc is gone, so is the only record of which
                       file(s) it pointed at. */
                    var docRef = fbDb.collection(collectionName).doc(contentId);
                    work = docRef.get().then(function (snap) {
                        var mediaUrls = new Set();
                        if (snap.exists) _extractMediaUrls(snap.data(), mediaUrls);
                        return docRef.delete().then(function () {
                            /* Best-effort, doesn't block/fail the takedown
                               that already succeeded above. */
                            return _purgeMediaUrls(Array.from(mediaUrls));
                        });
                    });
                } else if (type === 'seller') {
                    if (typeof window._empGovModerateUser !== 'function') {
                        _notify('Seller moderation isn\u2019t available right now — try again once the page finishes loading.', 'error');
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-user-slash"></i> Ban Seller';
                        return;
                    }
                    work = window._empGovModerateUser(contentId, 'ban');
                } else {
                    _notify('Unknown report type — nothing to remove.', 'error');
                    btn.disabled = false;
                    return;
                }

                work.then(function () {
                    return _markReviewed(flagId, type === 'seller' ? 'seller_banned' : 'content_removed');
                }).then(function () {
                    _notify(type === 'seller' ? 'Seller banned.' : 'Content removed.', 'success');
                }).catch(function (err) {
                    btn.disabled = false;
                    btn.innerHTML = type === 'seller' ? '<i class="fas fa-user-slash"></i> Ban Seller' : '<i class="fas fa-trash"></i> Remove Content';
                    _notify('Could not complete this action: ' + (err && err.message ? err.message : 'please try again.'), 'error');
                });
            }

            function _renderList(docs) {
                var container = document.getElementById('admin-urgent-safety-list');
                var badge = document.getElementById('admin-urgent-safety-badge');
                if (badge) badge.textContent = String(docs.length);
                if (!container) return;
                if (!docs.length) {
                    container.innerHTML = '<div style="padding:20px;text-align:center;color:#9CA3AF;font-size:0.86rem;"><i class="fas fa-circle-check" style="color:#22c55e;margin-right:6px;"></i>No open urgent reports.</div>';
                    return;
                }
                container.innerHTML = docs.map(_rowHTML).join('');
                container.querySelectorAll('.admin-urgent-safety-reviewed-btn').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        var id = btn.dataset.id;
                        if (!fbDb || !id) return;
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                        _markReviewed(id, 'reviewed_only').then(function () {
                            _notify('Marked reviewed.', 'success');
                        }).catch(function (err) {
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fas fa-check"></i> Mark Reviewed';
                            _notify('Could not update: ' + (err && err.message ? err.message : 'please try again.'), 'error');
                        });
                    });
                });
                container.querySelectorAll('.admin-urgent-safety-remove-btn').forEach(function (btn) {
                    btn.addEventListener('click', function () { _removeContent(btn); });
                });
            }

            function _startListener() {
                if (_unsub || !fbDb) return;
                /* No orderBy — avoids requiring a composite index just for

                   this one admin-only panel; sorted client-side instead,
                   which is plenty for a queue capped at 50 open items. */
                _unsub = fbDb.collection('moderation_flags')
                    .where('severity', '==', 'urgent')
                    .limit(50)
                    .onSnapshot(function (snap) {
                        var docs = [];
                        snap.forEach(function (doc) {
                            var d = doc.data();
                            if (!d.reviewed) docs.push(doc);
                        });
                        docs.sort(function (a, b) {
                            var av = a.data().flaggedAt || '', bv = b.data().flaggedAt || '';
                            return av < bv ? 1 : (av > bv ? -1 : 0);
                        });
                        _renderList(docs);
                    }, function (err) {
                        console.warn('[Admin] urgent safety reports listener error:', err && err.message);
                    });
            }

            function _boot() {
                if (!_injectCard()) return;
                _startListener();
            }

            document.addEventListener('empyrean-section-change', function (e) {
                if (e && e.detail && e.detail.section === 'admin') setTimeout(_boot, 300);
            });
            setTimeout(_boot, 1500);

            console.log('[Admin] ✅ Urgent Safety Reports panel wired — surfaces moderation_flags where severity:"urgent" in real time.');
        }());

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — LIVE POLLS
        // Self-contained card injected into #admin-users-tab, same pattern as
        // the Urgent Safety Reports / Business Page Manager cards. Lets an
        // admin raise a poll ticket (question + multiple-choice options,
        // tagged by topic) and see live results (click-to-vote progress bars,
        // percentages, total count) update in real time as participants vote
        // — participant voting itself is app-feed.js's job (the widget
        // injected above the community feed); this panel is create/monitor/
        // close/export only.
        //
        // Firestore model:
        //   polls/{id}: { question, topic, options:[{id,text,votes}],
        //                 totalVotes, status:'open'|'closed', createdBy,
        //                 createdByName, createdAt, closedAt }
        //   polls/{id}/voters/{voterId}: { optionId, votedAt, method }
        //
        // Vote integrity is enforced at the two places that actually cast a
        // vote (app-feed.js's client-side Firestore transaction for signed-in
        // voters; server.js's new POST /api/polls/:id/vote-guest, IP-gated,
        // for guests) — this panel only ever READS poll docs and flips
        // status, so it needs no vote-integrity logic of its own.
        // ═══════════════════════════════════════════════════════════════════
        (function initAdminLivePolls() {

            var TOPICS = ['politics', 'music', 'medicine', 'science', 'epidemic', 'disaster', 'general'];
            var BAR_COLORS = ['#00D4AA', '#3B82F6', '#C9A66B', '#8B5CF6', '#ef4444', '#f97316', '#22c55e', '#eab308'];

            function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
            function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); else console.log('[Admin]', msg); }
            function _pct(n, total) { return total > 0 ? Math.round((n / total) * 1000) / 10 : 0; }

            var _pollsUnsub = null;

            function _injectCard() {
                if (document.getElementById('admin-live-polls-card')) return true;
                var tab = document.getElementById('admin-users-tab');
                if (!tab) return false;

                var card = document.createElement('div');
                card.className = 'card';
                card.id = 'admin-live-polls-card';
                card.style.cssText = 'margin-bottom:20px;';
                card.innerHTML =
                    '<h3 style="padding:20px 24px 0;display:flex;align-items:center;gap:10px;">'
                    + '<span style="background:var(--nav-accent,#00D4AA);width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-square-poll-vertical" style="color:#fff;font-size:0.9rem;"></i></span>'
                    + '<span>Live Polls</span>'
                    + '</h3>'
                    + '<div class="card-content">'
                    + '<p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:16px;">Raise a poll ticket with a question and multiple-choice options. Participants click an option to vote; results update live below as votes come in.</p>'
                    + '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;padding:14px;border:1px solid rgba(10,14,39,0.1);border-radius:12px;background:rgba(10,14,39,0.02);">'
                    + '<input type="text" id="admin-poll-question-input" placeholder="Poll question, e.g. What\u2019s the most pressing issue today?" style="padding:10px 12px;border-radius:8px;border:1px solid rgba(10,14,39,0.15);font-size:0.88rem;">'
                    + '<select id="admin-poll-topic-select" style="padding:10px 12px;border-radius:8px;border:1px solid rgba(10,14,39,0.15);font-size:0.88rem;">'
                    + TOPICS.map(function (t) { return '<option value="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'; }).join('')
                    + '</select>'
                    + '<div id="admin-poll-options-inputs" style="display:flex;flex-direction:column;gap:6px;"></div>'
                    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
                    + '<button class="btn btn-small" id="admin-poll-add-option-btn" type="button"><i class="fas fa-plus"></i> Add option</button>'
                    + '<button class="btn btn-small btn-accent" id="admin-poll-create-btn" type="button"><i class="fas fa-bullhorn"></i> Raise Poll Ticket</button>'
                    + '</div>'
                    + '</div>'
                    + '<div id="admin-live-polls-list"><div style="padding:20px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading…</div></div>'
                    + '</div>';

                tab.insertBefore(card, tab.firstChild);
                _wireCreateForm();
                return true;
            }

            function _wireCreateForm() {
                var optWrap = document.getElementById('admin-poll-options-inputs');
                if (!optWrap || optWrap._pollsWired) return;
                optWrap._pollsWired = true;

                function addOptionInput(value) {
                    var row = document.createElement('input');
                    row.type = 'text';
                    row.className = 'admin-poll-opt-input';
                    row.placeholder = 'Option ' + (optWrap.children.length + 1);
                    row.value = value || '';
                    row.style.cssText = 'padding:9px 12px;border-radius:8px;border:1px solid rgba(10,14,39,0.15);font-size:0.85rem;';
                    optWrap.appendChild(row);
                }
                addOptionInput(); addOptionInput(); addOptionInput(); addOptionInput();

                document.getElementById('admin-poll-add-option-btn').addEventListener('click', function () { addOptionInput(); });

                document.getElementById('admin-poll-create-btn').addEventListener('click', function () {
                    var btn = this;
                    if (!fbDb) { _notify('Not connected to the database — please refresh and try again.', 'error'); return; }

                    var question = (document.getElementById('admin-poll-question-input').value || '').trim();
                    var topic = document.getElementById('admin-poll-topic-select').value;
                    var opts = Array.prototype.map.call(optWrap.querySelectorAll('.admin-poll-opt-input'), function (i) { return (i.value || '').trim(); })
                        .filter(Boolean);

                    if (!question) { _notify('Enter a poll question first.', 'error'); return; }
                    if (opts.length < 2) { _notify('Add at least two options.', 'error'); return; }

                    var options = opts.map(function (text, i) { return { id: 'opt_' + i + '_' + Date.now().toString(36), text: text, votes: 0 }; });
                    var us = (window.userState || {});

                    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Creating\u2026';
                    fbDb.collection('polls').add({
                        question: question,
                        topic: TOPICS.indexOf(topic) !== -1 ? topic : 'general',
                        options: options,
                        totalVotes: 0,
                        status: 'open',
                        createdBy: us.id || null,
                        createdByName: us.fullName || us.username || 'Admin',
                        createdByUid: (window.fbAuth && window.fbAuth.currentUser) ? window.fbAuth.currentUser.uid : null,
                        createdAt: _serverTimestamp(),
                        closedAt: null
                    }).then(function () {
                        _notify('Poll ticket raised — now live for participants.', 'success');
                        document.getElementById('admin-poll-question-input').value = '';
                        optWrap.innerHTML = '';
                        addOptionInput(); addOptionInput(); addOptionInput(); addOptionInput();
                    }).catch(function (err) {
                        _notify('Could not create poll: ' + (err && err.message || 'unknown error'), 'error');
                    }).finally(function () {
                        btn.disabled = false; btn.innerHTML = '<i class="fas fa-bullhorn"></i> Raise Poll Ticket';
                    });
                });
            }

            function _optionsHtml(data) {
                var total = data.totalVotes || 0;
                return (data.options || []).map(function (opt, i) {
                    var pct = _pct(opt.votes || 0, total);
                    var color = BAR_COLORS[i % BAR_COLORS.length];
                    return '<div style="position:relative;border-radius:8px;overflow:hidden;margin-bottom:6px;border:1px solid rgba(10,14,39,0.1);background:rgba(10,14,39,0.02);">'
                        + '<div style="position:absolute;inset:0;width:' + pct + '%;background:' + color + ';opacity:0.18;transition:width .5s ease;"></div>'
                        + '<div style="position:relative;display:flex;justify-content:space-between;padding:7px 12px;font-size:0.82rem;">'
                        + '<span style="font-weight:700;">' + _esc(opt.text) + '</span>'
                        + '<span style="font-weight:800;color:' + color + ';white-space:nowrap;">' + pct + '% <span style="color:var(--text-muted);font-weight:600;">(' + (opt.votes || 0) + ')</span></span>'
                        + '</div></div>';
                }).join('');
            }

            function _renderList(docs) {
                var listEl = document.getElementById('admin-live-polls-list');
                if (!listEl) return;
                if (!docs.length) { listEl.innerHTML = '<div style="padding:14px;color:var(--text-muted);">No polls yet — raise one above.</div>'; return; }

                listEl.innerHTML = '';
                docs.forEach(function (doc) {
                    var data = doc.data();
                    var closed = data.status !== 'open';
                    var total = data.totalVotes || 0;
                    var row = document.createElement('div');
                    row.style.cssText = 'padding:14px;border:1px solid rgba(10,14,39,0.1);border-radius:12px;margin-bottom:10px;';
                    row.innerHTML =
                        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">'
                        + '<div style="min-width:0;flex:1;"><div style="font-weight:800;font-size:0.9rem;">' + _esc(data.question) + '</div>'
                        + '<div style="font-size:0.76rem;color:var(--text-muted);margin-top:2px;">' + _esc(data.topic || 'general') + ' \u2022 ' + total + ' vote' + (total === 1 ? '' : 's') + ' \u2022 ' + (closed ? '<span style="color:#991b1b;font-weight:700;">closed</span>' : '<span style="color:#22c55e;font-weight:700;">\u25CF live</span>') + '</div></div>'
                        + '<div style="display:flex;gap:6px;flex-shrink:0;">'
                        + '<button class="btn btn-small" data-act="toggle" data-id="' + _esc(doc.id) + '">' + (closed ? '<i class="fas fa-play"></i> Reopen' : '<i class="fas fa-stop"></i> Close') + '</button>'
                        + '<button class="btn btn-small" data-act="export" data-id="' + _esc(doc.id) + '"><i class="fas fa-download"></i> Export</button>'
                        + '<button class="btn btn-small" data-act="delete" data-id="' + _esc(doc.id) + '" style="background:rgba(229,57,53,0.12);color:#c62828;"><i class="fas fa-trash"></i> Delete</button>'
                        + '</div></div>'
                        + '<div style="margin-top:10px;">' + _optionsHtml(data) + '</div>';
                    listEl.appendChild(row);
                });

                Array.prototype.forEach.call(listEl.querySelectorAll('[data-act="toggle"]'), function (btn) {
                    btn.addEventListener('click', function () {
                        if (!fbDb) return;
                        var id = btn.getAttribute('data-id');
                        var wasClosed = btn.innerHTML.indexOf('Reopen') !== -1;
                        btn.disabled = true;
                        fbDb.collection('polls').doc(id).update(
                            wasClosed ? { status: 'open', closedAt: null } : { status: 'closed', closedAt: _serverTimestamp() }
                        ).then(function () {
                            _notify(wasClosed ? 'Poll reopened.' : 'Poll closed.', 'success');
                        }).catch(function (err) {
                            _notify('Could not update poll: ' + (err && err.message || ''), 'error');
                        }).finally(function () { btn.disabled = false; });
                    });
                });
                Array.prototype.forEach.call(listEl.querySelectorAll('[data-act="delete"]'), function (btn) {
                    btn.addEventListener('click', function () {
                        if (!fbDb) return;
                        if (!btn._armed) {
                            btn._armed = true;
                            btn.innerHTML = '<i class="fas fa-trash"></i> Tap again';
                            setTimeout(function () { btn._armed = false; btn.innerHTML = '<i class="fas fa-trash"></i> Delete'; }, 4000);
                            return;
                        }
                        var id = btn.getAttribute('data-id');
                        btn.disabled = true;
                        fbDb.collection('polls').doc(id).delete()
                            .then(function () { _notify('Poll deleted.', 'success'); })
                            .catch(function (err) {
                                btn.disabled = false; btn._armed = false; btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
                                _notify('Could not delete poll: ' + (err && err.message || ''), 'error');
                            });
                    });
                });
                Array.prototype.forEach.call(listEl.querySelectorAll('[data-act="export"]'), function (btn) {
                    btn.addEventListener('click', function () {
                        if (!window.fbAuth || !window.fbAuth.currentUser || typeof window._empApiBase !== 'function') {
                            _notify('Not signed in — please refresh and try again.', 'error');
                            return;
                        }
                        var id = btn.getAttribute('data-id');
                        _notify('Preparing export\u2026', 'info');
                        window.fbAuth.currentUser.getIdToken().then(function (token) {
                            return fetch(window._empApiBase() + '/api/admin/polls/' + id + '/export-csv', {
                                headers: { 'Authorization': 'Bearer ' + token }
                            });
                        }).then(function (r) {
                            if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || ('HTTP ' + r.status)); });
                            return r.blob();
                        }).then(function (blob) {
                            var url = URL.createObjectURL(blob);
                            var a = document.createElement('a');
                            a.href = url; a.download = 'poll-' + id + '-results.csv';
                            document.body.appendChild(a); a.click(); a.remove();
                            URL.revokeObjectURL(url);
                        }).catch(function (err) {
                            _notify('Export failed: ' + (err && err.message || 'unknown error'), 'error');
                        });
                    });
                });
            }

            function _startListener() {
                if (!fbDb || _pollsUnsub) return;
                _pollsUnsub = fbDb.collection('polls').orderBy('createdAt', 'desc').limit(50)
                    .onSnapshot(function (snap) {
                        _renderList(snap.docs);
                    }, function (err) {
                        console.warn('[Admin] live polls listener error:', err && err.message);
                    });
            }

            function _boot() {
                if (!_injectCard()) return;
                _startListener();
            }

            document.addEventListener('empyrean-section-change', function (e) {
                if (e && e.detail && e.detail.section === 'admin') setTimeout(_boot, 300);
            });
            setTimeout(_boot, 1500);

            console.log('[Admin] ✅ Live Polls panel wired — create/close/export, live results via onSnapshot.');
        }());

        // ═══════════════════════════════════════════════════════════════════
        // ADMIN PANEL — BUSINESS PAGE MANAGER
        // Self-contained card injected into #admin-users-tab. Lets the admin
        // browse / search ALL business pages on the platform and delete any
        // of them (+ their business_posts) directly — independent of any
        // other user-detail view.
        // ═══════════════════════════════════════════════════════════════════
        (function initAdminBusinessPageManager() {

            function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
            function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); else console.log('[Admin]', msg); }

            /* Same generic media-URL walker + purge call as the Urgent
               Safety Reports panel above (initAdminUrgentSafetyReports) —
               duplicated rather than shared across these two self-
               contained IIFEs, matching this file's own established
               per-feature-card convention. See that panel's copy for the
               full explanation of why this is generic (recursive scan)
               rather than hardcoded per collection's field names. */
            function _extractMediaUrls(value, into) {
                if (typeof value === 'string') {
                    if (/^https:\/\/(res\.cloudinary\.com|firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(value)) into.add(value);
                    return;
                }
                if (Array.isArray(value)) { value.forEach(function (v) { _extractMediaUrls(v, into); }); return; }
                if (value && typeof value === 'object') {
                    for (var k in value) { if (Object.prototype.hasOwnProperty.call(value, k)) _extractMediaUrls(value[k], into); }
                }
            }
            function _purgeMediaUrls(urls) {
                if (!urls || !urls.length) return Promise.resolve();
                if (!window.fbAuth || !window.fbAuth.currentUser || typeof window._empApiBase !== 'function') return Promise.resolve();
                return window.fbAuth.currentUser.getIdToken().then(function (token) {
                    return fetch(window._empApiBase() + '/api/media/purge', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ urls: urls.slice(0, 100) })
                    });
                }).catch(function (err) {
                    console.warn('[Admin BizPages] media purge call failed (docs were already deleted — this cleanup step is best-effort):', err && err.message);
                });
            }

            var _allPagesCache = [];

            function _injectCard() {
                if (document.getElementById('admin-bizpages-card')) return true;
                var tab = document.getElementById('admin-users-tab');
                if (!tab) return false;

                var card = document.createElement('div');
                card.className = 'card';
                card.id = 'admin-bizpages-card';
                card.style.marginBottom = '20px';
                card.innerHTML =
                    '<h3 style="padding:20px 24px 0;display:flex;align-items:center;gap:10px;">'
                    + '<span style="background:var(--g-navy);width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-store" style="color:#F5C518;font-size:0.9rem;"></i></span>'
                    + '<span>Business Page Manager</span>'
                    + '<span id="admin-total-bizpages-badge" style="font-size:0.78rem;background:rgba(27,43,139,0.1);color:var(--secondary);padding:3px 10px;border-radius:12px;margin-left:8px;">0 pages</span>'
                    + '</h3>'
                    + '<div class="card-content">'
                    + '<p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:16px;">Search by page name, owner Unique ID, or page ID. Deleting a page also deletes all of its posts.</p>'
                    + '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">'
                    + '<input type="text" id="admin-bizpage-search-input" placeholder="Page name, owner UID, or page ID..." style="flex:1;min-width:200px;padding:12px 16px;border:1.5px solid rgba(10,14,39,0.12);border-radius:14px;font-size:0.9rem;outline:none;font-family:inherit;">'
                    + '<button id="admin-bizpage-search-btn" class="btn btn-accent" style="padding:12px 24px;border-radius:14px;font-weight:700;"><i class="fas fa-search"></i> Search</button>'
                    + '<button id="admin-bizpage-refresh-btn" style="padding:12px 18px;border-radius:14px;font-weight:700;background:rgba(10,14,39,0.06);border:none;color:#374151;cursor:pointer;"><i class="fas fa-rotate"></i></button>'
                    + '</div>'
                    + '<div id="admin-bizpages-list"><div style="padding:20px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading business pages…</div></div>'
                    + '<div style="margin-top:18px;padding:16px;border:1.5px dashed rgba(239,68,68,0.3);border-radius:14px;background:rgba(239,68,68,0.03);">'
                    + '<div style="font-size:0.76rem;font-weight:800;color:#EF4444;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;"><i class="fas fa-triangle-exclamation"></i> Danger Zone</div>'
                    + '<p style="color:var(--text-muted);font-size:0.8rem;margin:0 0 12px;">Permanently deletes every business page and every business post, for every user on the platform. Cannot be undone.</p>'
                    + '<button id="admin-bizpages-wipeall-btn" style="width:100%;padding:12px;border-radius:12px;background:rgba(239,68,68,0.08);color:#EF4444;border:2px solid rgba(239,68,68,0.25);font-weight:800;font-size:0.86rem;cursor:pointer;"><i class="fas fa-radiation" style="margin-right:7px;"></i>Wipe ALL Business Pages</button>'
                    + '</div>'
                    + '</div>';

                /* Insert at the top of the tab, above the User Search card */
                tab.insertBefore(card, tab.firstChild);
                return true;
            }

            function _pageRowHTML(p) {
                var cover = p.coverPhoto || p.profilePhoto || '';
                var avatar = p.profilePhoto || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(p.name || p.businessName || 'B') + '&background=1B2B8B&color=fff&size=64');
                return '<div class="admin-bizpage-row" data-pageid="' + _esc(p.id) + '" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid rgba(10,14,39,0.08);border-radius:14px;margin-bottom:10px;flex-wrap:wrap;">'
                    + '<img src="' + _esc(avatar) + '" style="width:42px;height:42px;border-radius:10px;object-fit:cover;flex-shrink:0;" onerror="this.src=\'https://ui-avatars.com/api/?name=B&background=1B2B8B&color=fff&size=64\'">'
                    + '<div style="flex:1;min-width:160px;">'
                        + '<div style="font-weight:800;font-size:0.9rem;color:#0A0E27;display:flex;align-items:center;gap:6px;">' + _esc(p.name || p.businessName || 'Unnamed Business')
                            + (p.verified ? '<span title="Verified" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#1B9AF5;flex-shrink:0;"><i class="fas fa-check" style="color:#fff;font-size:0.5rem;"></i></span>' : '')
                        + '</div>'
                        + '<div style="font-size:0.74rem;color:#9CA3AF;">Page ID: <span style="font-family:monospace;">' + _esc(p.id) + '</span>' + (p.industry ? ' &middot; ' + _esc(p.industry) : '') + '</div>'
                        + '<div style="font-size:0.74rem;color:#9CA3AF;">Owner: <span style="font-family:monospace;">' + _esc(p.ownerId || '—') + '</span>' + (p.email ? ' &middot; ' + _esc(p.email) : '') + '</div>'
                        + (p.postCount != null ? '<div style="font-size:0.74rem;color:#9CA3AF;">' + p.postCount + ' post' + (p.postCount === 1 ? '' : 's') + '</div>' : '')
                    + '</div>'
                    + '<button class="admin-bizpage-verify-btn" data-pageid="' + _esc(p.id) + '" data-verified="' + (p.verified ? '1' : '0') + '"'
                        + ' style="padding:8px 14px;border-radius:10px;font-size:0.8rem;font-weight:800;cursor:pointer;white-space:nowrap;'
                        + (p.verified
                            ? 'background:rgba(10,14,39,0.05);color:#374151;border:1.5px solid rgba(10,14,39,0.12);'
                            : 'background:rgba(27,154,245,0.08);color:#1B9AF5;border:1.5px solid rgba(27,154,245,0.25);')
                        + '"><i class="fas ' + (p.verified ? 'fa-circle-xmark' : 'fa-check') + '"></i> ' + (p.verified ? 'Unverify' : 'Verify') + '</button>'
                    + '<button class="admin-bizpage-delete-btn2" data-pageid="' + _esc(p.id) + '" style="padding:8px 14px;border-radius:10px;background:rgba(239,68,68,0.08);color:#EF4444;border:1.5px solid rgba(239,68,68,0.2);font-size:0.8rem;font-weight:800;cursor:pointer;white-space:nowrap;"><i class="fas fa-trash"></i> Delete Page</button>'
                    + '</div>';
            }

            /* Universal feature: Verified badge — admin-only toggle. Writes
               business_pages/{id}.verified, which app-business.js's live
               page renderer reads to show/hide the blue checkmark next to
               the page name (see that file's _renderBizPageFull). */
            function _toggleVerified(pageId, btn) {
                if (!pageId || !fbDb) return;
                var nextVerified = btn.dataset.verified !== '1';
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                fbDb.collection('business_pages').doc(pageId).update({ verified: nextVerified })
                    .then(function () {
                        var p = (_allPagesCache || []).find(function (pg) { return pg.id === pageId; });
                        if (p) p.verified = nextVerified;
                        _notify(nextVerified ? 'Page verified.' : 'Verification removed.', 'success');
                        _renderList(_allPagesCache);
                    })
                    .catch(function (err) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas ' + (nextVerified ? 'fa-check' : 'fa-circle-xmark') + '"></i> ' + (nextVerified ? 'Verify' : 'Unverify');
                        _notify('Could not update verification: ' + (err && err.message ? err.message : 'please try again.'), 'error');
                    });
            }

            function _renderList(list) {
                var container = document.getElementById('admin-bizpages-list');
                var badge = document.getElementById('admin-total-bizpages-badge');
                if (badge) badge.textContent = list.length + (list.length === 1 ? ' page' : ' pages');
                if (!container) return;
                if (!list.length) {
                    container.innerHTML = '<div style="padding:24px;text-align:center;color:#9CA3AF;font-size:0.88rem;">No business pages found.</div>';
                    return;
                }
                container.innerHTML = list.map(_pageRowHTML).join('');
                container.querySelectorAll('.admin-bizpage-delete-btn2').forEach(function (btn) {
                    btn.addEventListener('click', function () { _deletePage(btn.dataset.pageid, btn); });
                });
                container.querySelectorAll('.admin-bizpage-verify-btn').forEach(function (btn) {
                    btn.addEventListener('click', function () { _toggleVerified(btn.dataset.pageid, btn); });
                });
            }

            /* Load all business pages, then count posts per page */
            function _loadAllPages() {
                if (!fbDb) return Promise.resolve([]);
                var container = document.getElementById('admin-bizpages-list');
                if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading business pages…</div>';

                return fbDb.collection('business_pages').limit(200).get().then(function (snap) {
                    var pages = [];
                    snap.forEach(function (doc) {
                        var d = doc.data();
                        d.id = doc.id;
                        pages.push(d);
                    });

                    /* Attach post counts (best-effort, parallel) */
                    return Promise.all(pages.map(function (p) {
                        return fbDb.collection('business_posts').where('pageId', '==', p.id).get()
                            .then(function (postsSnap) { p.postCount = postsSnap.size; })
                            .catch(function () { p.postCount = null; });
                    })).then(function () {
                        _allPagesCache = pages;
                        _renderList(pages);
                        return pages;
                    });
                }).catch(function (err) {
                    console.warn('[Admin BizPages] load failed:', err && err.message);
                    if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:#EF4444;">Could not load business pages: ' + _esc(err && err.message) + '</div>';
                    return [];
                });
            }

            function _runSearch() {
                var input = document.getElementById('admin-bizpage-search-input');
                if (!input) return;
                var q = (input.value || '').trim().toLowerCase();
                if (!q) { _renderList(_allPagesCache); return; }
                var matches = _allPagesCache.filter(function (p) {
                    return (p.name || p.businessName || '').toLowerCase().indexOf(q) > -1
                        || (p.id || '').toLowerCase().indexOf(q) > -1
                        || (p.ownerId || '').toLowerCase().indexOf(q) > -1
                        || (p.email || '').toLowerCase().indexOf(q) > -1;
                });
                _renderList(matches);
            }

            /* ── Delete a business page + all its posts ── */
            function _deletePage(pageId, btn) {
                if (!pageId) return;
                if (!btn._confirming) {
                    btn._confirming = true;
                    btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Tap again to confirm';
                    setTimeout(function () {
                        if (btn._confirming) {
                            btn._confirming = false;
                            btn.innerHTML = '<i class="fas fa-trash"></i> Delete Page';
                        }
                    }, 4000);
                    return;
                }
                if (!fbDb) { _notify('Not connected.', 'error'); return; }
                btn._confirming = false;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting…';

                var mediaUrls = new Set();
                var pageRef = fbDb.collection('business_pages').doc(pageId);

                pageRef.get()
                    .then(function (pageSnap) {
                        if (pageSnap.exists) _extractMediaUrls(pageSnap.data(), mediaUrls);
                        return fbDb.collection('business_posts').where('pageId', '==', pageId).get();
                    })
                    .then(function (snap) {
                        var dels = [];
                        snap.forEach(function (doc) {
                            _extractMediaUrls(doc.data(), mediaUrls);
                            dels.push(doc.ref.delete().catch(function () {}));
                        });
                        return Promise.all(dels);
                    })
                    .then(function () { return pageRef.delete(); })
                    .then(function () {
                        /* Best-effort — the takedown (Firestore docs already
                           gone) doesn't wait on or fail because of this. */
                        _purgeMediaUrls(Array.from(mediaUrls));
                        _notify('Business page deleted.', 'success');
                        _allPagesCache = _allPagesCache.filter(function (p) { return p.id !== pageId; });
                        _renderList(_allPagesCache);
                        /* If the deleted page belongs to the currently logged-in
                           admin/user, clear local references + dashboard card */
                        var us = (window.EmpState && window.EmpState.userState) || window.userState || {};
                        if (us && us.businessPage && (us.businessPage.id === pageId || us.businessPage === pageId)) {
                            us.businessPage = null;
                            if (fbDb && us.id) fbDb.collection('users').doc(us.id).update({ businessPage: null }).catch(function () {});
                        }
                        document.querySelectorAll('[data-biz-id="' + pageId + '"],[data-page-id="' + pageId + '"]').forEach(function (c) { c.remove(); });
                        if (typeof window.renderDashboardBusinesses === 'function') {
                            try { window.renderDashboardBusinesses(); } catch (e) {}
                        }
                    })
                    .catch(function (err) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-trash"></i> Delete Page';
                        _notify('Failed to delete page: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            }

            /* ── Wipe every business page + post platform-wide ──
               FIX (bulk deletes via a one-off console script left dashboard
               cards behind): deleting the Firestore docs alone never removed
               anything already rendered into the DOM. Cards on the dashboard
               are pure additive renders (renderDashboardBusinesses only adds
               or skips existing cards, it never checks whether a card's
               backing page still exists) and the real-time listener that
               feeds #dashboard-bizposts-slider only reacts to docChanges()
               of type 'added' — a 'removed' change from a deleted doc is
               silently ignored. So a bulk delete anywhere else in the app
               will always leave stale cards on screen until this function's
               explicit querySelectorAll(...).remove() sweep runs (same
               pattern _deletePage already uses per-page, just applied to
               every business-tagged element on the page instead of one id). */
            function _wipeAllPages(btn) {
                if (!fbDb) { _notify('Not connected.', 'error'); return; }
                if (!btn._confirming) {
                    btn._confirming = true;
                    btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Tap again to confirm — deletes ALL pages';
                    setTimeout(function () {
                        if (btn._confirming) {
                            btn._confirming = false;
                            btn.innerHTML = '<i class="fas fa-radiation" style="margin-right:7px;"></i>Wipe ALL Business Pages';
                        }
                    }, 4000);
                    return;
                }
                btn._confirming = false;
                if (!confirm('This permanently deletes EVERY business page and post for EVERY user on the platform. This cannot be undone. Continue?')) {
                    btn.innerHTML = '<i class="fas fa-radiation" style="margin-right:7px;"></i>Wipe ALL Business Pages';
                    return;
                }
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wiping…';

                var BATCH = 400;
                function _deleteAllIn(collectionName) {
                    return fbDb.collection(collectionName).get().then(function (snap) {
                        var docs = snap.docs, chains = [];
                        for (var i = 0; i < docs.length; i += BATCH) {
                            var chunk = docs.slice(i, i + BATCH);
                            var batch = fbDb.batch();
                            chunk.forEach(function (d) { batch.delete(d.ref); });
                            chains.push(batch.commit());
                        }
                        return Promise.all(chains).then(function () { return docs.length; });
                    });
                }

                var postsDeleted = 0, pagesDeleted = 0;

                _deleteAllIn('business_posts')
                    .then(function (n) { postsDeleted = n; return _deleteAllIn('business_pages'); })
                    .then(function (n) { pagesDeleted = n; return fbDb.collection('users').get(); })
                    .then(function (usersSnap) {
                        var docs = usersSnap.docs.filter(function (d) {
                            var v = d.data();
                            return v.businessPage || (v.businessPages && v.businessPages.length);
                        });
                        var chains = [];
                        for (var i = 0; i < docs.length; i += BATCH) {
                            var chunk = docs.slice(i, i + BATCH);
                            var batch = fbDb.batch();
                            chunk.forEach(function (d) { batch.update(d.ref, { businessPage: null, businessPages: [] }); });
                            chains.push(batch.commit());
                        }
                        return Promise.all(chains);
                    })
                    .then(function () {
                        /* In-memory caches */
                        window._firestoreBusinessPages = [];
                        window._activeBizData   = null;
                        window._activeBizPageId = '';
                        window._bizPagesFetchDone = false;
                        var us = (window.EmpState && window.EmpState.userState) || window.userState || {};
                        if (us) { us.businessPage = null; us.businessPages = []; }

                        /* Every rendered business card/tile, anywhere in the app —
                           dashboard slider, product-card slider, profile links, etc. */
                        document.querySelectorAll('[data-biz-id],[data-page-id]').forEach(function (c) { c.remove(); });

                        /* Reset the admin list itself */
                        _allPagesCache = [];
                        _renderList([]);

                        /* Re-render the dashboard slider(s) so they settle into
                           their correct empty/demo state instead of just being
                           left blank where cards used to be */
                        if (typeof window.renderDashboardBusinesses === 'function') {
                            try { window.renderDashboardBusinesses(); } catch (e) {}
                        }

                        _notify('Wiped ' + pagesDeleted + ' business page(s) and ' + postsDeleted + ' post(s).', 'success');
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-radiation" style="margin-right:7px;"></i>Wipe ALL Business Pages';
                    })
                    .catch(function (err) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-radiation" style="margin-right:7px;"></i>Wipe ALL Business Pages';
                        _notify('Wipe failed: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            }

            function _wire() {
                if (!_injectCard()) return;

                var searchBtn = document.getElementById('admin-bizpage-search-btn');
                var searchInput = document.getElementById('admin-bizpage-search-input');
                var refreshBtn = document.getElementById('admin-bizpage-refresh-btn');
                var wipeAllBtn = document.getElementById('admin-bizpages-wipeall-btn');

                if (searchBtn && !searchBtn._wired) { searchBtn._wired = true; searchBtn.addEventListener('click', _runSearch); }
                if (searchInput && !searchInput._wired) {
                    searchInput._wired = true;
                    searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') _runSearch(); });
                    searchInput.addEventListener('input', function () { if (!searchInput.value) _renderList(_allPagesCache); });
                }
                if (refreshBtn && !refreshBtn._wired) { refreshBtn._wired = true; refreshBtn.addEventListener('click', _loadAllPages); }
                if (wipeAllBtn && !wipeAllBtn._wired) { wipeAllBtn._wired = true; wipeAllBtn.addEventListener('click', function () { _wipeAllPages(wipeAllBtn); }); }

                if (!_allPagesCache.length) _loadAllPages();
            }

            if (document.readyState !== 'loading') _wire();
            else document.addEventListener('DOMContentLoaded', _wire);
            document.addEventListener('empyrean-init-done', function () { setTimeout(_wire, 400); });

            /* Load/refresh when the Users tab is clicked */
            document.addEventListener('click', function (e) {
                var tabBtn = e.target.closest && e.target.closest('[data-tab="admin-users-tab"]');
                if (tabBtn) setTimeout(function () { _wire(); _loadAllPages(); }, 150);
            });

            /* ── Robust retry: the admin panel markup is often injected into
               the DOM dynamically (e.g. after "Exit/Enter Admin" toggle),
               and the Users tab may already be active by default with no
               click event ever firing. Poll until the card is injected. ── */
            (function _retryUntilInjected() {
                var attempts = 0;
                var iv = setInterval(function () {
                    attempts++;
                    if (document.getElementById('admin-bizpages-card')) { clearInterval(iv); return; }
                    _wire();
                    if (attempts >= 40) clearInterval(iv); /* ~20s max */
                }, 500);
            })();

            /* Also watch for the admin-users-tab being added/shown dynamically */
            if (typeof MutationObserver !== 'undefined') {
                var _bizMo = new MutationObserver(function () {
                    if (!document.getElementById('admin-bizpages-card') && document.getElementById('admin-users-tab')) {
                        _wire();
                    }
                });
                _bizMo.observe(document.body, { childList: true, subtree: true });
            }

            console.log('[Admin] ✅ Business Page Manager — search/list/delete any business page (+ posts).');
        }());

        // ═══════════════════════════════════════════════════════════════════
        // ADVERT CONTROL ROOM — push image/video adverts (multiple
        // companies/organizations) into a new `adverts` Firestore collection.
        // The feed side of this feature (rotating sponsored cards into
        // #feed-container / #profile-dash-feed / #profile-posts-feed) lives
        // in app-feed.js's own empyreanAdvertsFeedInjector() — this file only
        // owns the admin CRUD: push/edit/pause/delete + impression/click
        // counters. Markup lives in index.html's #admin-adverts-tab (static
        // skeleton — form + list container only, everything dynamic is here).
        //
        // Media upload reuses window.uploadToCloudinary (Firebase-Storage-
        // backed despite the legacy name), the same function every other
        // upload path in this app already goes through — so adverts get the
        // same owner-segmented path, auth, retry, AND the app-wide client-
        // side image-compression wrap (app-startup.js) automatically, with
        // no separate upload logic to maintain here.
        // ═══════════════════════════════════════════════════════════════════
        (function initAdvertManager() {
            var ADVERTS_COL = 'adverts';
            var _advertsCache = [];
            var _editingAdvertId = null;
            var _pendingMediaFile = null;
            var _pendingMediaType = null;
            var _pendingLogoFile  = null;

            function _notifyAdmin(msg, type) {
                if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
            }
            function _escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
            function _escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }
            function _fmtNum(n) { return Number(n || 0).toLocaleString(); }
            function _val(id) { var el = document.getElementById(id); return (el && el.value.trim()) || ''; }
            function _setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; }

            /* Premium line icons (inline SVG — no emoji, no icon-font dependency) */
            var _AI = {
                pause: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
                play:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
                edit:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
                trash: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
                arrow: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
                image: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>',
                users: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M18 14.5a6 6 0 0 1 3 5.5"/></svg>'
            };
            function _hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

            /* Advertiser logo picker preview (empty = placeholder icon) */
            function _setLogoPreview(url) {
                var el = document.getElementById('admin-advert-logo-preview');
                if (!el) return;
                el.innerHTML = url
                    ? '<img src="' + _escAttr(url) + '" alt="Advertiser logo">'
                    : '<i class="fas fa-image" aria-hidden="true"></i>';
            }
            function _wireLogoPreview() {
                var input = document.getElementById('admin-advert-logo-input');
                if (!input || input._wired) return;
                input._wired = true;
                input.addEventListener('change', function () {
                    var file = input.files && input.files[0];
                    if (!file) return;
                    if (file.type && file.type.indexOf('image/') !== 0) { _notifyAdmin('Logo must be an image file.', 'warning'); input.value = ''; return; }
                    if (file.size > 5 * 1024 * 1024) { _notifyAdmin('Logo is too large — please use an image under 5 MB.', 'warning'); input.value = ''; return; }
                    _pendingLogoFile = file;
                    _setLogoPreview(URL.createObjectURL(file));
                });
            }

            function _resetForm() {
                _editingAdvertId  = null;
                _pendingMediaFile = null;
                _pendingMediaType = null;
                _pendingLogoFile  = null;
                _setLogoPreview('');
                var allEl0 = document.getElementById('admin-advert-all-members-checkbox');
                var f = document.getElementById('admin-advert-form');
                if (f) f.reset();
                var prev = document.getElementById('admin-advert-media-preview');
                if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
                var priorityEl = document.getElementById('admin-advert-priority-input');
                if (priorityEl) priorityEl.value = 1;
                if (allEl0) allEl0.checked = true;
                var activeEl = document.getElementById('admin-advert-active-checkbox');
                if (activeEl) activeEl.checked = true;
                var submitBtn = document.getElementById('admin-advert-submit-btn');
                if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-bullhorn"></i> Push Advert';
                var cancelBtn = document.getElementById('admin-advert-cancel-edit-btn');
                if (cancelBtn) cancelBtn.style.display = 'none';
            }

            /* ── media preview: shows the chosen file immediately, before
               upload — same "pick, preview, then submit" pattern the create-
               business-page modal already uses (app-business.js §4). ── */
            function _wireMediaPreview() {
                var input = document.getElementById('admin-advert-media-input');
                if (!input || input._wired) return;
                input._wired = true;
                input.addEventListener('change', function () {
                    var file = input.files && input.files[0];
                    var prev = document.getElementById('admin-advert-media-preview');
                    if (!file || !prev) return;
                    _pendingMediaFile = file;
                    _pendingMediaType = (file.type && file.type.indexOf('video/') === 0) ? 'video' : 'image';
                    var url = URL.createObjectURL(file);
                    prev.style.display = 'block';
                    prev.innerHTML = _pendingMediaType === 'video'
                        ? '<video src="' + url + '" muted playsinline controls style="width:100%;max-height:220px;border-radius:12px;object-fit:cover;"></video>'
                        : '<img src="' + url + '" style="width:100%;max-height:220px;border-radius:12px;object-fit:cover;">';
                });
            }

            function _wireFormSubmit() {
                var form = document.getElementById('admin-advert-form');
                if (!form || form._wired) return;
                form._wired = true;
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    _submitAdvert();
                });
            }

            function _submitAdvert() {
                var nameEl     = document.getElementById('admin-advert-name-input');
                var captionEl  = document.getElementById('admin-advert-caption-input');
                var linkEl     = document.getElementById('admin-advert-link-input');
                var ctaEl      = document.getElementById('admin-advert-cta-input');
                var priorityEl = document.getElementById('admin-advert-priority-input');
                var activeEl   = document.getElementById('admin-advert-active-checkbox');
                var submitBtn  = document.getElementById('admin-advert-submit-btn');

                var advertiserName = nameEl && nameEl.value.trim();
                if (!advertiserName) { _notifyAdmin('Advertiser / company name is required.', 'warning'); return; }
                if (!_editingAdvertId && !_pendingMediaFile) { _notifyAdmin('Choose an image or video for this advert.', 'warning'); return; }
                if (!fbDb) { _notifyAdmin('Not connected — try again in a moment.', 'error'); return; }

                if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Pushing…'; }
                // ADDED (2026-08-10 — upload progress tracker)
                var _advertBar = (typeof window.empUploadProgress === 'object')
                    ? window.empUploadProgress.attach(submitBtn ? submitBtn.parentElement : document.body, 'Advert media')
                    : { update: function () {}, done: function () {}, fail: function () {} };

                var payload = {
                    advertiserName: advertiserName,
                    caption:  (captionEl  && captionEl.value.trim())  || '',
                    linkUrl:  (linkEl     && linkEl.value.trim())     || '',
                    ctaLabel: (ctaEl      && ctaEl.value.trim())      || 'Learn More',
                    headline:   _val('admin-advert-headline-input'),
                    tagLabel:   _val('admin-advert-tag-input'),
                    subLabel:   _val('admin-advert-sublabel-input'),
                    ctaEyebrow: _val('admin-advert-eyebrow-input'),
                    placement:  _val('admin-advert-placement-input') || 'all',
                    verified:   (function () { var v = document.getElementById('admin-advert-verified-checkbox'); return v ? !!v.checked : false; })(),
                    priority: Math.max(1, Math.min(10, parseInt(priorityEl && priorityEl.value, 10) || 1)),
                    active:   activeEl ? !!activeEl.checked : true,
                    /* true = shown beside ANY member's content; false = only beside monetized creators (old rule) */
                    showToAll: (function () { var a = document.getElementById('admin-advert-all-members-checkbox'); return a ? !!a.checked : true; })(),
                    updatedAt: _serverTimestamp()
                };

                var _mediaUpload = _pendingMediaFile
                    ? window.uploadToCloudinary(_pendingMediaFile, function (pct) { _advertBar.update(pct); }).then(function (url) {
                        _advertBar.done();
                        payload.mediaUrl  = url;
                        payload.mediaType = _pendingMediaType;
                    }).catch(function (err) { _advertBar.fail('Upload failed'); throw err; })
                    : Promise.resolve();
                var _logoUpload = _pendingLogoFile
                    ? window.uploadToCloudinary(_pendingLogoFile, function () {}).then(function (url) { payload.advertiserLogoUrl = url; })
                    : Promise.resolve();
                var uploadStep = Promise.all([_mediaUpload, _logoUpload]);

                uploadStep.then(function () {
                    if (_editingAdvertId) {
                        return fbDb.collection(ADVERTS_COL).doc(_editingAdvertId).update(payload)
                            .then(function () { _notifyAdmin('Advert updated.', 'success'); });
                    }
                    payload.impressions = 0;
                    payload.clicks      = 0;
                    payload.createdAt   = _serverTimestamp();
                    payload.createdBy   = (window.userState && window.userState.id) || 'admin';
                    return fbDb.collection(ADVERTS_COL).add(payload)
                        .then(function () { _notifyAdmin('Advert pushed — it will start rotating into the feed.', 'success'); });
                }).then(function () {
                    _resetForm();
                    _loadAdvertsList();
                }).catch(function (err) {
                    _notifyAdmin('Could not save advert: ' + (err && err.message ? err.message : 'unknown error'), 'error');
                }).finally(function () {
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = _editingAdvertId ? '<i class="fas fa-save"></i> Save Changes' : '<i class="fas fa-bullhorn"></i> Push Advert'; }
                });
            }

            function _loadAdvertsList() {
                var listEl  = document.getElementById('admin-adverts-list');
                var badgeEl = document.getElementById('admin-advert-count-badge');
                if (!listEl || !fbDb) return;
                listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading adverts…</div>';
                fbDb.collection(ADVERTS_COL).orderBy('createdAt', 'desc').limit(50).get()
                    .then(function (snap) {
                        _advertsCache = [];
                        snap.forEach(function (doc) {
                            var d = doc.data(); d.id = doc.id; _advertsCache.push(d);
                        });
                        if (badgeEl) badgeEl.textContent = _advertsCache.length;
                        _renderAdvertsList();
                    })
                    .catch(function (err) {
                        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#EF4444;">Could not load adverts: ' + _escHtml(err && err.message) + '</div>';
                    });
            }
            window._adminLoadAdvertsList = _loadAdvertsList;

            function _renderAdvertsList() {
                var listEl = document.getElementById('admin-adverts-list');
                if (!listEl) return;
                if (!_advertsCache.length) {
                    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#9CA3AF;">No adverts yet — push your first one above.</div>';
                    return;
                }
                listEl.innerHTML = _advertsCache.map(function (ad) {
                    var views  = Number(ad.impressions || 0), clicks = Number(ad.clicks || 0);
                    var rate   = views ? (clicks / views * 100).toFixed(1) + '%' : '\u2014';
                    var isVid  = ad.mediaType === 'video';
                    var host   = ad.linkUrl ? _hostOf(ad.linkUrl) : '';
                    var thumb  = isVid
                        ? '<video src="' + _escAttr(ad.mediaUrl) + '#t=0.1" muted playsinline preload="metadata" tabindex="-1" disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" onerror="this.style.display=\'none\'"></video>'
                        : '<img src="' + _escAttr(ad.mediaUrl) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
                    var logo   = ad.advertiserLogoUrl ? '<img class="adm-ad-logo" src="' + _escAttr(ad.advertiserLogoUrl) + '" alt="">' : '';
                    var id     = _escAttr(ad.id);
                    return '<article class="admin-advert-row adm-ad-card' + (ad.active ? '' : ' is-paused') + '" data-id="' + id + '">'
                        + '<div class="adm-ad-top">'
                        +   '<div class="adm-ad-thumb">' + thumb
                        +     '<span class="adm-ad-type">' + (isVid ? _AI.play : _AI.image) + (isVid ? 'Video' : 'Image') + '</span>'
                        +   '</div>'
                        +   '<div class="adm-ad-info">'
                        +     '<div class="adm-ad-namerow">' + logo + '<span class="adm-ad-name">' + _escHtml(ad.advertiserName) + '</span>'
                        +       '<span class="adm-ad-pill ' + (ad.active ? 'is-active' : 'is-paused') + '"><i></i>' + (ad.active ? 'Active' : 'Paused') + '</span></div>'
                        +     '<div class="adm-ad-chips"><span class="adm-ad-prio">Priority ' + (ad.priority || 1) + '</span>' + (ad.placement && ad.placement !== 'all' ? '<span class="adm-ad-chip adm-ad-chip-soft">' + ({ card: 'Feed card', popup: 'Video pop-up', slide: 'Reel slide' }[ad.placement] || ad.placement) + '</span>' : '') + (ad.showToAll !== false ? '<span class="adm-ad-chip adm-ad-chip-soft">' + _AI.users + 'All members</span>' : '') + '</div>'
                        +     (ad.headline ? '<div class="adm-ad-hd">' + _escHtml(ad.headline) + '</div>' : '')
                        +     (ad.caption ? '<p class="adm-ad-cap">' + _escHtml(ad.caption) + '</p>' : '')
                        +     '<div class="adm-ad-chips">'
                        +       (ad.linkUrl ? '<span class="adm-ad-chip">' + _escHtml(ad.ctaLabel || 'Learn More') + _AI.arrow + '</span><span class="adm-ad-host">' + _escHtml(host) + '</span>' : '')
                        +     '</div>'
                        +   '</div>'
                        + '</div>'
                        + '<div class="adm-ad-stats">'
                        +   '<div><span>VIEWS</span><b>' + _fmtNum(views) + '</b></div>'
                        +   '<div><span>CLICKS</span><b>' + _fmtNum(clicks) + '</b></div>'
                        +   '<div><span>CTR</span><b class="is-blue">' + rate + '</b></div>'
                        +   '<div class="adm-ad-bar"><i style="width:' + (views ? Math.min(100, clicks / views * 100).toFixed(1) : 0) + '%"></i></div>'
                        + '</div>'
                        + '<div class="adm-ad-actions">'
                        +   '<button type="button" class="admin-advert-toggle-btn adm-ad-btn ' + (ad.active ? 'adm-ad-btn-ghost' : 'adm-ad-btn-primary') + '" data-id="' + id + '" data-active="' + (!!ad.active) + '" title="' + (ad.active ? 'Pause' : 'Activate') + '">' + (ad.active ? _AI.pause + 'Pause' : _AI.play + 'Activate') + '</button>'
                        +   '<button type="button" class="admin-advert-edit-btn adm-ad-btn adm-ad-btn-soft" data-id="' + id + '" title="Edit">' + _AI.edit + 'Edit</button>'
                        +   '<button type="button" class="admin-advert-delete-btn adm-ad-btn adm-ad-btn-danger" data-id="' + id + '" title="Delete" aria-label="Delete advert">' + _AI.trash + '</button>'
                        + '</div>'
                        + '</article>';
                }).join('');
            }

            function _findAd(id) { return _advertsCache.find(function (a) { return a.id === id; }); }

            document.addEventListener('click', function (e) {
                var t = e.target.closest ? e.target.closest('.admin-advert-toggle-btn, .admin-advert-edit-btn, .admin-advert-delete-btn') : null;
                if (!t) return;
                var id = t.dataset.id;
                var ad = _findAd(id);
                // FIX (2026-08-08 — silent no-op): this used to just `return`
                // here with zero feedback if either lookup failed — which,
                // combined with the stale-fbDb bug fixed above, is exactly
                // what "the button doesn't work" looks like from the admin's
                // side: a click that visibly does nothing at all. Now every
                // failure path says why.
                if (!ad) { _notifyAdmin('Could not find that advert (list may be out of date — try reopening the Adverts tab).', 'error'); return; }
                if (!fbDb) { _notifyAdmin('Not connected to the database — please refresh and try again.', 'error'); return; }

                if (t.classList.contains('admin-advert-toggle-btn')) {
                    var newActive = t.dataset.active !== 'true';
                    fbDb.collection(ADVERTS_COL).doc(id).update({ active: newActive, updatedAt: _serverTimestamp() })
                        .then(function () { ad.active = newActive; _renderAdvertsList(); _notifyAdmin(newActive ? 'Advert activated.' : 'Advert paused.', 'success'); })
                        .catch(function (err) { _notifyAdmin('Could not update: ' + (err && err.message || ''), 'error'); });
                } else if (t.classList.contains('admin-advert-edit-btn')) {
                    _editingAdvertId = id;
                    var nameEl = document.getElementById('admin-advert-name-input');
                    var captionEl = document.getElementById('admin-advert-caption-input');
                    var linkEl = document.getElementById('admin-advert-link-input');
                    var ctaEl = document.getElementById('admin-advert-cta-input');
                    var priorityEl = document.getElementById('admin-advert-priority-input');
                    var activeEl = document.getElementById('admin-advert-active-checkbox');
                    if (nameEl) nameEl.value = ad.advertiserName || '';
                    if (captionEl) captionEl.value = ad.caption || '';
                    if (linkEl) linkEl.value = ad.linkUrl || '';
                    if (ctaEl) ctaEl.value = ad.ctaLabel || '';
                    _setVal('admin-advert-headline-input', ad.headline);
                    _setVal('admin-advert-tag-input', ad.tagLabel);
                    _setVal('admin-advert-sublabel-input', ad.subLabel);
                    _setVal('admin-advert-eyebrow-input', ad.ctaEyebrow);
                    _setVal('admin-advert-placement-input', ad.placement || 'all');
                    var _vfEl = document.getElementById('admin-advert-verified-checkbox');
                    if (_vfEl) _vfEl.checked = !!ad.verified;
                    if (priorityEl) priorityEl.value = ad.priority || 1;
                    if (activeEl) activeEl.checked = !!ad.active;
                    var allEl = document.getElementById('admin-advert-all-members-checkbox');
                    if (allEl) allEl.checked = ad.showToAll !== false;
                    _pendingLogoFile = null;
                    _setLogoPreview(ad.advertiserLogoUrl || '');
                    var prev = document.getElementById('admin-advert-media-preview');
                    if (prev && ad.mediaUrl) {
                        prev.style.display = 'block';
                        prev.innerHTML = ad.mediaType === 'video'
                            ? '<video src="' + _escAttr(ad.mediaUrl) + '" muted playsinline controls style="width:100%;max-height:220px;border-radius:12px;object-fit:cover;"></video>'
                            : '<img src="' + _escAttr(ad.mediaUrl) + '" style="width:100%;max-height:220px;border-radius:12px;object-fit:cover;">';
                    }
                    var submitBtn = document.getElementById('admin-advert-submit-btn');
                    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
                    var cancelBtn = document.getElementById('admin-advert-cancel-edit-btn');
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                    var form = document.getElementById('admin-advert-form');
                    if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else if (t.classList.contains('admin-advert-delete-btn')) {
                    // FIX (2026-08-08 — native confirm() unreliable on mobile):
                    // same class of issue app-fixes.js's _deletePostCapture
                    // already had to work around for post deletion ("avoids
                    // native confirm() mobile issues") — some mobile
                    // webviews/PWA contexts suppress or auto-dismiss a
                    // blocking window.confirm(), which silently returns
                    // false/undefined and makes Delete look completely
                    // inert. Reusing that same proven custom in-page banner
                    // here instead of window.confirm().
                    _confirmAdvertDelete(id, ad);
                }
            });

            // FIX (2026-08-08): custom in-page confirmation banner, replacing
            // window.confirm() for the same mobile-reliability reason
            // app-fixes.js's post-delete flow already switched away from it.
            // Mirrors that pattern: a dismissable bottom banner with
            // Cancel/Delete, auto-dismisses after 7s if ignored.
            function _confirmAdvertDelete(id, ad) {
                var existing = document.getElementById('_empAdvertDeleteConfirm');
                if (existing) existing.remove();
                var banner = document.createElement('div');
                banner.id = '_empAdvertDeleteConfirm';
                banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;background:#0A0E27;color:white;border-radius:16px;padding:14px 20px;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:280px;max-width:92vw;font-family:inherit;';
                banner.innerHTML = '<span style="flex:1;font-size:0.88rem;font-weight:600;">Delete this advert permanently? This cannot be undone.</span>'
                    + '<button id="_advDelCancel" style="background:rgba(255,255,255,0.12);border:none;color:white;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:0.82rem;">Cancel</button>'
                    + '<button id="_advDelConfirm" style="background:#e53935;border:none;color:white;padding:7px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.82rem;">Delete</button>';
                document.body.appendChild(banner);
                var timeout = setTimeout(function () { banner.remove(); }, 7000);
                document.getElementById('_advDelCancel').onclick = function () { clearTimeout(timeout); banner.remove(); };
                document.getElementById('_advDelConfirm').onclick = function () {
                    clearTimeout(timeout); banner.remove();
                    if (!fbDb) { _notifyAdmin('Not connected to the database — please refresh and try again.', 'error'); return; }
                    fbDb.collection(ADVERTS_COL).doc(id).delete()
                        .then(function () { _advertsCache = _advertsCache.filter(function (a) { return a.id !== id; }); _renderAdvertsList(); _notifyAdmin('Advert deleted.', 'success'); })
                        .catch(function (err) { _notifyAdmin('Could not delete: ' + (err && err.message || ''), 'error'); });
                };
            }

            document.addEventListener('click', function (e) {
                var t = e.target.closest ? e.target.closest('#admin-advert-cancel-edit-btn') : null;
                if (t) _resetForm();
            });

            function _wireAll() {
                _wireMediaPreview();
                _wireLogoPreview();
                _wireFormSubmit();
            }
            if (document.readyState !== 'loading') _wireAll();
            else document.addEventListener('DOMContentLoaded', _wireAll);
            document.addEventListener('empyrean-init-done', function () { setTimeout(_wireAll, 400); });

            console.log('[Admin] \u2705 Advert Control Room wired — push/edit/pause/delete image or video adverts for multiple companies/organizations; feed rotation handled by app-feed.js.');
        }());

        // ═══════════════════════════════════════════════════════════════
        // FACEBOOK PAGE SYNC CONTROL (2026-10-04) — Admin Panel -> Facebook tab.
        // Talks to server.js's /api/admin/facebook/* routes (Bearer ID token of an
        // admin account, same gate as the other admin routes). Lets the admin check
        // the connection, choose Automatic / Ask me first / Off, approve or reject
        // queued posts, retry failures, push one existing post, and pull from Facebook.
        // ═══════════════════════════════════════════════════════════════
        (function initFacebookSyncPanel() {
            var _busy = false;
            function _g(id) { return document.getElementById(id); }
            function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
            function _say(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
            var LABEL = { posts: 'Post', reels: 'Reel', marketplace_listings: 'Marketplace', sos_queue: 'SOS', crisis_reports: 'Crisis', news_posts: 'News', statuses: 'Status' };

            async function _api(path, body, opts) {
                opts = opts || {};   // 2026-10-04: { timeout (ms), tries } — pulling from Facebook can legitimately take minutes (video re-hosting)
                if (!window.fbAuth || !window.fbAuth.currentUser) throw new Error('Not signed in as admin.');
                var token = await window.fbAuth.currentUser.getIdToken();
                var base = (typeof window._empApiBase === 'function') ? window._empApiBase() : '';
                // var r = await fetch(base + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });   // superseded 2026-10-04: one dropped connection = "Failed to fetch" and the button could hang on "Working..." forever
                var r = null, lastErr = null;
                for (var attempt = 0; attempt < (opts.tries || 3) && !r; attempt++) {
                    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
                    var timer = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || 45000) : null;
                    try {
                        r = await fetch(base + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctl ? ctl.signal : undefined });
                    } catch (e) {
                        lastErr = e;
                        if (attempt < (opts.tries || 3) - 1) await new Promise(function (res) { setTimeout(res, 1500 * (attempt + 1)); });
                    }
                    if (timer) clearTimeout(timer);
                }
                if (!r) throw new Error('Could not reach the Empyrean server (' + ((lastErr && lastErr.name === 'AbortError') ? 'timed out' : 'connection dropped') + '). Check your data connection and try again.');
                var j = await r.json().catch(function () { return {}; });
                if (!r.ok) throw new Error(j.error || ('Server error ' + r.status));
                return j;
            }

            function _setSettings(s) {
                if (!s) return;
                var radios = document.querySelectorAll('input[name="fbs-mode"]');
                for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === s.mode);
                var cb = _g('fbs-inbound'); if (cb) cb.checked = !!s.inbound;
            }

            function _row(x, buttons) {
                var thumb = x.thumb ? '<img src="' + _esc(x.thumb) + '" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:8px;flex-shrink:0;">' : '<div style="width:54px;height:54px;border-radius:8px;background:var(--bg-secondary,#eee);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="fas fa-file-alt"></i></div>';
                return '<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border-color,#e5e7eb);">' + thumb +
                    '<div style="flex:1;min-width:0;"><div style="font-weight:600;color:var(--text-primary,inherit);">' + _esc(LABEL[x.col] || x.col) + (x.kind ? ' &middot; ' + _esc(x.kind) : '') + '</div>' +
                    '<div style="word-break:break-word;">' + _esc(x.preview || '(no text)') + '</div>' +
                    (x.error ? '<div style="color:#c0392b;margin-top:2px;">' + _esc(x.error) + '</div>' : '') +
                    (buttons ? '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">' + buttons + '</div>' : '') + '</div></div>';
            }
            function _btn(label, act, key, cls) { return '<button type="button" class="btn ' + cls + ' btn-sm" data-fbs-act="' + act + '" data-fbs-key="' + _esc(key) + '">' + label + '</button>'; }

            async function _loadQueue() {
                var aw = _g('fbs-awaiting'), rc = _g('fbs-recent');
                try {
                    var q = await _api('/api/admin/facebook/queue');
                    if (aw) aw.innerHTML = q.awaiting.length ? q.awaiting.map(function (x) { return _row(x, _btn('Approve &amp; post', 'approve', x.key, 'btn-primary') + _btn('Reject', 'reject', x.key, 'btn-secondary')); }).join('') : 'Nothing is waiting.';
                    var html = '';
                    q.failed.forEach(function (x) { html += _row(x, _btn('Retry', 'retry', x.key, 'btn-primary') + _btn('Dismiss', 'reject', x.key, 'btn-secondary')); });
                    q.recent.forEach(function (x) { html += _row(x, '<span style="color:#27ae60;">Posted to Facebook</span>'); });
                    if (rc) rc.innerHTML = html || 'No activity yet.';
                } catch (e) {
                    if (aw) aw.textContent = 'Could not load: ' + e.message;
                }
            }

            async function _check() {
                var box = _g('fbs-conn'); if (!box) return;
                box.textContent = 'Checking\u2026';
                try {
                    var s = await _api('/api/admin/facebook/status');
                    _setSettings(s.settings);
                    var ok = s.tokenFound && s.page;
                    box.innerHTML = (ok ? '<span style="color:#27ae60;">\u25CF Connected</span> to <strong>' + _esc(s.page.name) + '</strong>' :
                        '<span style="color:#c0392b;">\u25CF Not connected</span> &mdash; ' + _esc(!s.tokenFound ? 'the server cannot find the Facebook Page token.' : (s.pageError || 'Facebook rejected the token.'))) +
                        '<br>Admin accounts sent: ' + s.adminUids.length + (s.adminUids.length ? '' : ' <span style="color:#c0392b;">(none found &mdash; nothing will be posted)</span>') +
                        '<br>Sent: ' + s.stats.sent + ' &middot; Imported: ' + s.stats.imported + ' &middot; Failed: ' + s.stats.failed +
                        (s.stats.lastError ? '<br><span style="color:#c0392b;">Last error: ' + _esc(s.stats.lastError) + '</span>' : '') +
                        (s.stats.lastSkip ? '<br><span style="color:#b9770e;">Last post not sent: ' + _esc(s.stats.lastSkip) + '</span>' : '');
                } catch (e) { box.innerHTML = '<span style="color:#c0392b;">' + _esc(e.message) + '</span>'; }
            }

            async function _guard(btn, fn) {
                if (_busy) return; _busy = true;
                var old = btn ? btn.innerHTML : '';
                if (btn) { btn.disabled = true; btn.innerHTML = 'Working\u2026'; }
                try { await fn(); } catch (e) { _say(e.message || 'Something went wrong.', 'error'); }
                if (btn) { btn.disabled = false; btn.innerHTML = old; }
                _busy = false;
            }

            function _wire() {
                var tab = _g('admin-facebook-tab');
                if (!tab || tab._fbsWired) return;
                tab._fbsWired = true;
                // Choosing Automatic / Ask me first / Off now applies at once (Save settings still works too).
                tab.addEventListener('change', function (e) {
                    var el = e.target;
                    if (!el || !(el.name === 'fbs-mode' || el.id === 'fbs-inbound')) return;
                    _guard(null, async function () {
                        var m = document.querySelector('input[name="fbs-mode"]:checked');
                        var r = await _api('/api/admin/facebook/settings', { mode: m ? m.value : undefined, inbound: !!(_g('fbs-inbound') || {}).checked });
                        _setSettings(r.settings);
                        _say(el.id === 'fbs-inbound' ? 'Facebook settings saved.' : ('Posting to Facebook: ' + ({ auto: 'Automatic', approve: 'Ask me first', off: 'Off' }[r.settings.mode] || r.settings.mode) + '.'), 'success');
                        _loadQueue();
                    });
                });
                setInterval(function () { if (tab.offsetParent !== null && !_busy) _loadQueue(); }, 15000);
                tab.addEventListener('click', function (e) {
                    var t = e.target.closest('button'); if (!t) return;
                    if (t.id === 'fbs-check') return _guard(t, _check);
                    if (t.id === 'fbs-pull') return _guard(t, async function () {
                        var r = await _api('/api/admin/facebook/pull', {}, { timeout: 300000, tries: 1 });   // import path: long timeout, never re-run
                        _say(r.error ? r.error : ('Imported ' + r.imported + ' new Facebook post(s).'), r.error ? 'error' : 'success');
                    });
                    if (t.id === 'fbs-save') return _guard(t, async function () {
                        var m = document.querySelector('input[name="fbs-mode"]:checked');
                        var r = await _api('/api/admin/facebook/settings', { mode: m ? m.value : undefined, inbound: !!(_g('fbs-inbound') || {}).checked });
                        _setSettings(r.settings); _say('Facebook settings saved.', 'success'); _loadQueue();
                    });
                    if (t.id === 'fbs-push') return _guard(t, async function () {
                        var id = ((_g('fbs-docid') || {}).value || '').trim();
                        if (!id) { _say('Enter the post ID first.', 'warning'); return; }
                        var r = await _api('/api/admin/facebook/push', { collection: _g('fbs-col').value, id: id, force: false });
                        _say('Posted to Facebook.', 'success'); _g('fbs-docid').value = ''; _loadQueue();
                    });
                    var act = t.getAttribute('data-fbs-act');
                    if (act) return _guard(t, async function () {
                        await _api('/api/admin/facebook/decide', { key: t.getAttribute('data-fbs-key'), action: act });
                        _say(act === 'reject' ? 'Dismissed.' : 'Posted to Facebook.', 'success'); _loadQueue();
                    });
                });
            }

            window._adminLoadFacebookSync = function () { _wire(); _check(); _loadQueue(); };
            if (document.readyState !== 'loading') _wire(); else document.addEventListener('DOMContentLoaded', _wire);
            console.log('[Admin] \u2705 Facebook Page Sync control panel wired.');
        }());

        // ═══════════════════════════════════════════════════════════════
        // SCHOLARSHIP MANAGER (2026-09-28) — Admin Panel → Scholarships tab.
        // "Push Scholarship" writes to the `scholarship_adverts` collection;
        // app-feed.js's empyreanScholarshipRail() listens to active==true docs
        // in real time and shows each as a card in the dashboard's horizontal
        // scholarship rail, so a push is live for every member immediately.
        // Also: edit / pause-resume / delete, per-scholarship applicant list
        // (scholarship_applications) and a PDF master list via jsPDF.
        // ═══════════════════════════════════════════════════════════════
        (function initScholarshipManager() {
            var COL = 'scholarship_adverts';
            var COL_APP = 'scholarship_applications';
            var _cache = [];
            var _editingId = null;
            var _appl = { ad: null, rows: [] };

            function _$(id) { return document.getElementById(id); }
            function _notifyAdmin(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
            function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
            function _pad(n) { return (n < 10 ? '0' : '') + n; }
            function _dstr(d) { return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()); }
            function _val(id) { var el = _$(id); return el ? String(el.value || '').trim() : ''; }
            function _num(id) { var n = parseFloat(_val(id)); return isNaN(n) ? 0 : n; }
            function _ms(v) { try { if (v && typeof v.toMillis === 'function') return v.toMillis(); if (v) return new Date(v).getTime() || 0; } catch (e) {} return 0; }
            function _money(n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); }

            function _isFull() { return _val('admin-sch-funding') === 'Fully Funded'; }
            // Fully Funded: the sponsor covers the whole fee (field is filled automatically and locked),
            // so the student balance is 0. Partial: the sponsor amount is OPTIONAL — blank counts as 0.
            function _calc() {
                var sp = _$('admin-sch-sponsorpays'), el = _$('admin-sch-studentpays');
                if (sp) {
                    if (_isFull()) { sp.value = _num('admin-sch-total'); sp.readOnly = true; sp.style.background = 'rgba(10,14,39,0.05)'; }
                    else { sp.readOnly = false; sp.style.background = ''; }
                }
                if (el) el.value = _isFull() ? 0 : Math.max(0, _num('admin-sch-total') - _num('admin-sch-sponsorpays'));
            }
            function _defaultDates() {
                var s = new Date(), e = new Date(); e.setDate(e.getDate() + 30);
                if (_$('admin-sch-start')) _$('admin-sch-start').value = _dstr(s);
                if (_$('admin-sch-end')) _$('admin-sch-end').value = _dstr(e);
            }
            function _resetForm() {
                _editingId = null;
                var f = _$('admin-sch-form'); if (f) f.reset();
                _showImgPrev('');
                _defaultDates(); _calc();
                var a = _$('admin-sch-active'); if (a) a.checked = true;
                var nt = _$('admin-sch-notify'); if (nt) nt.checked = true;
                var b = _$('admin-sch-submit-btn'); if (b) b.innerHTML = '<i class="fas fa-bullhorn"></i> Push Scholarship';
                var c = _$('admin-sch-cancel-btn'); if (c) c.style.display = 'none';
                var t = _$('admin-sch-form-title'); if (t) t.textContent = 'Push New Scholarship';
            }

            function _adState(ad) {
                var t = _dstr(new Date());
                if (ad.active === false) return { cls: 'paused', label: 'Paused' };
                if (ad.endDate && t > ad.endDate) return { cls: 'closed', label: 'Closed' };
                return { cls: 'live', label: 'Live' };
            }

            // (2026-09-29) Scholarship image: preview + downscale (keeps the file small enough for
            // WhatsApp/Facebook link-preview crawlers) + upload to Firebase Storage via the app's
            // existing window.uploadToCloudinary (Storage-backed) helper.
            function _showImgPrev(url) {
                var p = _$('admin-sch-image-prev'); if (!p) return;
                p.innerHTML = url ? '<img src="' + _esc(url) + '" alt="Scholarship image" style="max-width:100%;max-height:150px;border-radius:10px;display:block;"><div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Current image \u2014 choose a file to replace it.</div>' : '';
            }
            function _shrinkImage(file) {
                return new Promise(function (resolve) {
                    try {
                        var url = URL.createObjectURL(file), im = new Image();
                        im.onload = function () {
                            try {
                                var max = 1200, r = Math.min(1, max / Math.max(im.width, im.height));
                                var c = document.createElement('canvas');
                                c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
                                c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
                                URL.revokeObjectURL(url);
                                c.toBlob(function (b) { resolve(b ? new File([b], 'scholarship.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
                            } catch (e) { resolve(file); }
                        };
                        im.onerror = function () { resolve(file); };
                        im.src = url;
                    } catch (e) { resolve(file); }
                });
            }

            function _submit(_imgUrl) {
                var submitBtn = _$('admin-sch-submit-btn');
                if (!fbDb) { _notifyAdmin('Not connected — try again in a moment.', 'error'); return; }
                var total = _num('admin-sch-total'), sponsor = _isFull() ? _num('admin-sch-total') : _num('admin-sch-sponsorpays');
                var start = _val('admin-sch-start'), end = _val('admin-sch-end');
                var slots = Math.max(1, Math.floor(_num('admin-sch-slots')));
                if (!_val('admin-sch-title') || !_val('admin-sch-sponsor') || !_val('admin-sch-affiliate') || !_val('admin-sch-inst')) { _notifyAdmin('Title, sponsor, partner and institution are required.', 'warning'); return; }
                if (sponsor > total) { _notifyAdmin('Sponsor contribution cannot exceed the total fee.', 'warning'); return; }
                if (!start || !end || end < start) { _notifyAdmin('Closing date must be on or after the opening date.', 'warning'); return; }
                var _imgInput = _$('admin-sch-image'), _imgFile = _imgInput && _imgInput.files && _imgInput.files[0];
                if (_imgFile && typeof _imgUrl !== 'string') {
                    if (typeof window.uploadToCloudinary !== 'function') { _notifyAdmin('Image upload is not ready yet \u2014 try again in a moment.', 'error'); return; }
                    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Uploading image\u2026'; }
                    _shrinkImage(_imgFile).then(function (f) { return window.uploadToCloudinary(f); }).then(function (url) {
                        _submit(String(url || ''));
                    }).catch(function (err) {
                        _notifyAdmin('Could not upload the image: ' + (err && err.message ? err.message : 'unknown error'), 'error');
                        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = _editingId ? '<i class="fas fa-save"></i> Save Changes' : '<i class="fas fa-bullhorn"></i> Push Scholarship'; }
                    });
                    return;
                }
                _calc();

                var payload = {
                    title: _val('admin-sch-title'), sponsor: _val('admin-sch-sponsor'), affiliate: _val('admin-sch-affiliate'),
                    institution: _val('admin-sch-inst'), fundingType: _val('admin-sch-funding') || 'Partial Scholarship',
                    totalFee: total, sponsorPays: sponsor, studentPays: _isFull() ? 0 : Math.max(0, total - sponsor),
                    req1: _val('admin-sch-req1'), req2: _val('admin-sch-req2'), slots: slots,
                    regLabel: _val('admin-sch-reglabel') || 'Registration Number',
                    startDate: start, endDate: end,
                    active: !!(_$('admin-sch-active') && _$('admin-sch-active').checked),
                    // server.js's _watchScholarships() reads this: when false, the card still
                    // goes live on the Dashboard but no push notification is sent.
                    notifyPush: !(_$('admin-sch-notify') && !_$('admin-sch-notify').checked),
                    updatedAt: _serverTimestamp()
                };
                // Only written when a new image was uploaded, so editing without picking a file keeps the existing one.
                if (typeof _imgUrl === 'string' && _imgUrl) payload.imageUrl = _imgUrl;
                if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Pushing\u2026'; }

                var wasEditing = !!_editingId, p;
                if (wasEditing) {
                    p = fbDb.collection(COL).doc(_editingId).update(payload).then(function () { _notifyAdmin('Scholarship updated.', 'success'); });
                } else {
                    payload.applicantCount = 0;
                    payload.createdAt = _serverTimestamp();
                    payload.pushedAt = _serverTimestamp();
                    payload.createdBy = (window.userState && window.userState.id) || 'admin';
                    p = fbDb.collection(COL).add(payload).then(function () {
                        _notifyAdmin(payload.active ? ('Scholarship pushed — it is now live on every member\u2019s Dashboard' + (payload.notifyPush ? ' and a push notification is on its way.' : '.')) : 'Scholarship saved as paused — not visible until you resume it.', 'success');
                    });
                }
                p.then(function () { _resetForm(); _load(); })
                 .catch(function (err) { _notifyAdmin('Could not save scholarship: ' + (err && err.message ? err.message : 'unknown error'), 'error'); })
                 .then(function () { if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = _editingId ? '<i class="fas fa-save"></i> Save Changes' : '<i class="fas fa-bullhorn"></i> Push Scholarship'; } });
            }

            function _load() {
                var listEl = _$('admin-sch-list'), badge = _$('admin-sch-count-badge');
                if (!listEl) return;
                if (!fbDb) { listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#9CA3AF;">Not connected yet.</div>'; return; }
                listEl.innerHTML = '<div style="padding:18px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading\u2026</div>';
                fbDb.collection(COL).get().then(function (snap) {
                    _cache = [];
                    snap.forEach(function (doc) { var d = doc.data() || {}; d.id = doc.id; _cache.push(d); });
                    _cache.sort(function (a, b) { return _ms(b.createdAt) - _ms(a.createdAt); });
                    if (badge) badge.textContent = _cache.length;
                    _renderList();
                }).catch(function (err) {
                    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#EF4444;">Could not load scholarships: ' + _esc(err && err.message) + '</div>';
                });
            }

            function _renderList() {
                var listEl = _$('admin-sch-list');
                if (!listEl) return;
                if (!_cache.length) { listEl.innerHTML = '<div style="padding:22px;text-align:center;color:#9CA3AF;">No scholarships yet — push your first one above.</div>'; return; }
                listEl.innerHTML = _cache.map(function (ad) {
                    var st = _adState(ad), cnt = Number(ad.applicantCount) || 0;
                    return '<div class="emp-sch-row" data-id="' + _esc(ad.id) + '">'
                        + '<div style="min-width:0;flex:1 1 220px;">'
                        +   '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><strong style="font-size:0.9rem;">' + _esc(ad.title) + '</strong><span class="emp-sch-pill ' + st.cls + '">' + st.label + '</span></div>'
                        +   '<div style="font-size:0.76rem;color:var(--text-muted);margin-top:3px;">' + _esc(ad.sponsor) + ' &middot; ' + _esc(ad.institution) + '</div>'
                        +   '<div style="font-size:0.74rem;color:var(--text-muted);margin-top:2px;">' + cnt + ' / ' + (ad.slots || 0) + ' applicants &middot; ' + _esc(ad.startDate || '?') + ' \u2192 ' + _esc(ad.endDate || '?') + ' &middot; ' + _money(ad.studentPays) + ' student balance</div>'
                        + '</div>'
                        + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
                        +   '<button type="button" class="emp-sch-mini" data-act="applicants">Applicants (' + cnt + ')</button>'
                        +   '<button type="button" class="emp-sch-mini" data-act="edit">Edit</button>'
                        +   (ad.active === false ? '' : '<button type="button" class="emp-sch-mini" data-act="repush">Re-push</button>')
                        +   '<button type="button" class="emp-sch-mini" data-act="toggle">' + (ad.active === false ? 'Resume' : 'Pause') + '</button>'
                        +   '<button type="button" class="emp-sch-mini danger" data-act="delete">Delete</button>'
                        + '</div></div>';
                }).join('');
            }

            function _find(id) { for (var i = 0; i < _cache.length; i++) if (_cache[i].id === id) return _cache[i]; return null; }

            function _edit(ad) {
                _editingId = ad.id;
                var map = { 'admin-sch-title': ad.title, 'admin-sch-sponsor': ad.sponsor, 'admin-sch-affiliate': ad.affiliate, 'admin-sch-inst': ad.institution,
                    'admin-sch-funding': ad.fundingType, 'admin-sch-total': ad.totalFee, 'admin-sch-sponsorpays': ad.sponsorPays, 'admin-sch-req1': ad.req1,
                    'admin-sch-req2': ad.req2, 'admin-sch-slots': ad.slots, 'admin-sch-reglabel': ad.regLabel, 'admin-sch-start': ad.startDate, 'admin-sch-end': ad.endDate };
                Object.keys(map).forEach(function (k) { var el = _$(k); if (el && map[k] != null) el.value = map[k]; });
                var a = _$('admin-sch-active'); if (a) a.checked = ad.active !== false;
                var nt = _$('admin-sch-notify'); if (nt) nt.checked = ad.notifyPush !== false;
                var _fi = _$('admin-sch-image'); if (_fi) _fi.value = '';
                _showImgPrev(ad.imageUrl || '');
                _calc();
                var b = _$('admin-sch-submit-btn'); if (b) b.innerHTML = '<i class="fas fa-save"></i> Save Changes';
                var c = _$('admin-sch-cancel-btn'); if (c) c.style.display = '';
                var t = _$('admin-sch-form-title'); if (t) t.textContent = 'Edit Scholarship';
                var f = _$('admin-sch-form'); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            function _toggle(ad) {
                var resume = ad.active === false;
                var upd = { active: resume, updatedAt: _serverTimestamp() };
                if (resume) upd.pushedAt = _serverTimestamp();
                fbDb.collection(COL).doc(ad.id).update(upd).then(function () {
                    _notifyAdmin(resume ? ('Scholarship is live again' + (ad.notifyPush !== false ? ' and members are being notified.' : '.')) : 'Scholarship paused — hidden from the Dashboard.', 'success');
                    _load();
                }).catch(function (err) { _notifyAdmin('Could not update: ' + (err && err.message), 'error'); });
            }

            // Re-announce a scholarship that is already live: a fresh pushedAt moves it to the
            // front of the Dashboard rail AND makes server.js send the push notification again.
            function _repush(ad) {
                if (ad.active === false) { _notifyAdmin('Resume this scholarship first — a paused one can\u2019t be pushed.', 'warning'); return; }
                if (!window.confirm('Re-push \"' + ad.title + '\"? It moves to the front of the Dashboard' + (ad.notifyPush !== false ? ' and every member gets another push notification.' : '.'))) return;
                fbDb.collection(COL).doc(ad.id).update({ pushedAt: _serverTimestamp(), updatedAt: _serverTimestamp() }).then(function () {
                    _notifyAdmin('Scholarship re-pushed.', 'success');
                    _load();
                }).catch(function (err) { _notifyAdmin('Could not re-push: ' + (err && err.message), 'error'); });
            }

            function _delete(ad) {
                if (!window.confirm('Delete "' + ad.title + '"? It disappears from the Dashboard immediately. Existing applications are kept.')) return;
                fbDb.collection(COL).doc(ad.id).delete().then(function () {
                    _cache = _cache.filter(function (a) { return a.id !== ad.id; });
                    var badge = _$('admin-sch-count-badge'); if (badge) badge.textContent = _cache.length;
                    _renderList();
                    _notifyAdmin('Scholarship deleted.', 'success');
                }).catch(function (err) { _notifyAdmin('Could not delete: ' + (err && err.message), 'error'); });
            }

            function _dob(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }

            function _openApplicants(ad) {
                var card = _$('admin-sch-applicants-card'), body = _$('admin-sch-applicants-body'), title = _$('admin-sch-applicants-title');
                if (!card || !body) return;
                card.style.display = '';
                if (title) title.textContent = 'Applicants — ' + ad.title;
                body.innerHTML = '<div style="padding:18px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading applicants\u2026</div>';
                if (card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                fbDb.collection(COL_APP).where('advertId', '==', ad.id).get().then(function (snap) {
                    var rows = [];
                    snap.forEach(function (doc) { var d = doc.data() || {}; d.id = doc.id; rows.push(d); });
                    rows.sort(function (a, b) { return _ms(a.createdAt) - _ms(b.createdAt); });
                    _appl = { ad: ad, rows: rows };
                    if (!rows.length) { body.innerHTML = '<div style="padding:18px;text-align:center;color:#9CA3AF;">No applications yet.</div>'; return; }
                    // (2026-09-29) bio-data columns from the new application form (blank for older applications)
                    body.innerHTML = '<table class="emp-sch-tbl"><thead><tr><th>#</th><th>Full name</th><th>Sex</th><th>Date of birth</th><th>Email</th><th>Phone (WhatsApp)</th><th>Residential state</th><th>Youth province</th><th>ND / HND</th><th>Mode</th><th>Intended course</th><th>' + _esc(ad.regLabel || 'Reg. no.') + '</th><th>Date</th></tr></thead><tbody>'
                        + rows.map(function (r, i) {
                            var d = _ms(r.createdAt); var ds = d ? new Date(d).toLocaleDateString('en-GB') : '';
                            return '<tr><td>' + (i + 1) + '</td><td>' + _esc(r.name) + '</td><td>' + _esc(r.sex || '') + '</td><td>' + _esc(_dob(r.dob)) + '</td><td>' + _esc(r.email) + '</td><td>' + _esc(r.phone) + '</td><td>' + _esc(r.state || '') + '</td><td>' + _esc(r.province || '') + '</td><td>' + _esc(r.level || '') + '</td><td>' + _esc(r.studyMode || '') + '</td><td>' + _esc(r.course || '') + '</td><td>' + _esc(r.regNo) + '</td><td>' + ds + '</td></tr>';
                        }).join('') + '</tbody></table>';
                }).catch(function (err) {
                    body.innerHTML = '<div style="padding:16px;text-align:center;color:#EF4444;">Could not load applicants: ' + _esc(err && err.message) + '</div>';
                });
            }

            function _exportPdf() {
                var ad = _appl.ad, rows = _appl.rows;
                if (!ad || !rows.length) { _notifyAdmin('No applications to export yet.', 'warning'); return; }
                var Ctor = window.jspdf && window.jspdf.jsPDF;
                if (typeof Ctor !== 'function') { _notifyAdmin('PDF export isn\u2019t available right now — try again in a moment.', 'warning'); return; }
                // landscape A4 (2026-09-29) so the bio-data columns fit
                var doc = new Ctor({ unit: 'pt', format: 'a4', orientation: 'landscape' });
                var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 30;
                var cols = [], _cx = M;
                [['#', 18], ['Full name', 96], ['Sex', 30], ['DOB', 56], ['Email', 110], ['Phone', 72], ['State', 56], ['Province', 56], ['ND/HND', 34], ['Mode', 44], ['Intended course', 100], [(ad.regLabel || 'Reg. no.'), 60], ['Date', 50]].forEach(function (c) {
                    cols.push({ t: c[0], x: _cx, w: c[1] - 4 }); _cx += c[1];
                });
                function fit(s, w) { var a = doc.splitTextToSize(String(s == null ? '' : s), w); return a.length ? a[0] : ''; }
                function head(y) {
                    doc.setFillColor(27, 43, 139); doc.rect(M - 4, y - 12, W - 2 * M + 8, 18, 'F');
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
                    cols.forEach(function (c) { doc.text(fit(c.t, c.w), c.x, y); });
                    doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
                }
                doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(27, 43, 139);
                doc.text('Empyrean — Scholarship Applicants Report', M, 46);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
                doc.text('Program: ' + fit(ad.title, W - 2 * M - 60), M, 66);
                doc.text('Institution: ' + (ad.institution || '') + '   |   Sponsor: ' + (ad.sponsor || ''), M, 80);
                doc.text('Total applicants: ' + rows.length + ' / ' + (ad.slots || 0) + ' slots   |   Generated: ' + new Date().toLocaleString('en-GB'), M, 94);
                var y = 122; head(y); y += 20;
                rows.forEach(function (r, i) {
                    if (y > H - 40) { doc.addPage(); y = 50; head(y); y += 20; }
                    if (i % 2 === 0) { doc.setFillColor(244, 246, 251); doc.rect(M - 4, y - 11, W - 2 * M + 8, 16, 'F'); }
                    doc.setFontSize(8.5);
                    var d = _ms(r.createdAt); var ds = d ? new Date(d).toLocaleDateString('en-GB') : '';
                    var cells = [String(i + 1), r.name, r.sex || '', _dob(r.dob), r.email, r.phone, r.state || '', r.province || '', r.level || '', r.studyMode || '', r.course || '', r.regNo, ds];
                    cols.forEach(function (c, k) { doc.text(fit(cells[k], c.w), c.x, y); });
                    y += 16;
                });
                var slug = String(ad.title || 'scholarship').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'scholarship';
                doc.save('Applicants_' + slug + '.pdf');
            }

            function _wire() {
                var form = _$('admin-sch-form');
                if (form && !form._wired) {
                    form._wired = true;
                    form.addEventListener('submit', function (e) { e.preventDefault(); _submit(); });
                    ['admin-sch-total', 'admin-sch-sponsorpays'].forEach(function (id) { var el = _$(id); if (el) el.addEventListener('input', _calc); });
                    var fs = _$('admin-sch-funding'); if (fs) fs.addEventListener('change', _calc);
                    _defaultDates(); _calc();
                }
                var list = _$('admin-sch-list');
                if (list && !list._wired) {
                    list._wired = true;
                    list.addEventListener('click', function (e) {
                        var b = e.target.closest ? e.target.closest('[data-act]') : null;
                        var row = e.target.closest ? e.target.closest('.emp-sch-row') : null;
                        if (!b || !row) return;
                        var ad = _find(row.getAttribute('data-id')); if (!ad) return;
                        var act = b.getAttribute('data-act');
                        if (act === 'edit') _edit(ad); else if (act === 'repush') _repush(ad); else if (act === 'toggle') _toggle(ad); else if (act === 'delete') _delete(ad); else if (act === 'applicants') _openApplicants(ad);
                    });
                }
                var map = { 'admin-sch-cancel-btn': _resetForm, 'admin-sch-refresh-btn': _load, 'admin-sch-pdf-btn': _exportPdf,
                    'admin-sch-applicants-close-btn': function () { var c = _$('admin-sch-applicants-card'); if (c) c.style.display = 'none'; } };
                Object.keys(map).forEach(function (id) { var el = _$(id); if (el && !el._wired) { el._wired = true; el.addEventListener('click', map[id]); } });
            }

            window._adminLoadScholarships = function () { _wire(); _load(); };

            if (document.readyState !== 'loading') _wire(); else document.addEventListener('DOMContentLoaded', _wire);
            document.addEventListener('empyrean-init-done', function () { setTimeout(_wire, 400); });

            console.log('[Admin] \u2705 Scholarship manager wired — push/edit/pause/delete scholarships, applicant list + PDF export.');
        })();
        // ═══════════════════════════════════════════════════════════════
        // CELEBRATION MANAGER (2026-10-09) — Admin Panel → Celebrations tab.
        // Publishes graduate (convocation) / new-student (matriculation)
        // cards to the `celebrations` collection; app-feed.js's
        // empyreanCelebrationRail() listens to active==true docs and shows
        // them on the dashboard grouped by institution. Edit / pause /
        // delete supported; photos are downscaled then uploaded through the
        // app's existing window.uploadToCloudinary (Storage-backed) helper.
        // ═══════════════════════════════════════════════════════════════
        (function initCelebrationManager() {
            var COL = 'celebrations';
            var MAX_IMGS = 8;
            var _cache = [];
            var _editingId = null;
            var _keep = [];   // already-uploaded image URLs retained while editing
            var _fresh = [];  // newly chosen files: { file, url(objectURL) }
            var _vidKeep = null;  // existing video retained while editing: { url, poster }
            var _vidFresh = null; // newly chosen video: { file, poster(Blob), url(poster objectURL) }
            var MAX_VIDEO_BYTES = 60 * 1024 * 1024, MAX_VIDEO_SEC = 90;
            function _videoPoster(file) {
        // Grabs a JPEG frame from the chosen video (Storage URLs have no server-made thumbnail).
        // Always resolves: if the browser can't decode the clip, a branded play-button card is used.
        return new Promise(function (resolve) {
            var url = null, done = false, v = document.createElement('video');
            function finish(blob, dur) {
                if (done) return; done = true;
                v.onerror = v.onseeked = v.onloadedmetadata = null;
                try { URL.revokeObjectURL(url); } catch (e) {}
                try { v.removeAttribute('src'); } catch (e) {}
                resolve({ blob: blob, duration: dur || 0 });
            }
            function placeholder(dur) {
                try {
                    var c = document.createElement('canvas'); c.width = 720; c.height = 900;
                    var x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 720, 900);
                    g.addColorStop(0, '#283aaa'); g.addColorStop(1, '#0e1438');
                    x.fillStyle = g; x.fillRect(0, 0, 720, 900);
                    x.fillStyle = 'rgba(255,255,255,0.92)'; x.beginPath(); x.arc(360, 450, 90, 0, Math.PI * 2); x.fill();
                    x.fillStyle = '#0e1438'; x.beginPath(); x.moveTo(335, 405); x.lineTo(335, 495); x.lineTo(415, 450); x.closePath(); x.fill();
                    c.toBlob(function (b) { finish(b, dur); }, 'image/jpeg', 0.85);
                } catch (e) { finish(null, dur); }
            }
            try {
                url = URL.createObjectURL(file);
                v.muted = true; v.playsInline = true; v.preload = 'metadata';
                v.onloadedmetadata = function () { var d = v.duration; try { v.currentTime = Math.min(0.6, (d || 1) / 3); } catch (e) { placeholder(d); } };
                v.onseeked = function () {
                    try {
                        var w = v.videoWidth, h = v.videoHeight, dur = v.duration;
                        if (!w || !h) return placeholder(dur);
                        var r = Math.min(1, 1280 / Math.max(w, h)), c = document.createElement('canvas');
                        c.width = Math.round(w * r); c.height = Math.round(h * r);
                        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                        c.toBlob(function (b) { if (b) finish(b, dur); else placeholder(dur); }, 'image/jpeg', 0.86);
                    } catch (e) { placeholder(v.duration); }
                };
                v.onerror = function () { placeholder(0); };
                setTimeout(function () { if (!done) placeholder(0); }, 8000);
                v.src = url;
            } catch (e) { placeholder(0); }
        });
    }
            function _clearVid() { if (_vidFresh && _vidFresh.url) { try { URL.revokeObjectURL(_vidFresh.url); } catch (e) {} } _vidFresh = null; _vidKeep = null; _renderVidPrev(); }
            function _renderVidPrev() {
                var p = _$('admin-cel-video-prev'); if (!p) return;
                var u = _vidFresh ? _vidFresh.url : (_vidKeep ? _vidKeep.poster : '');
                p.innerHTML = (_vidFresh || _vidKeep) ? '<div class="emp-cel-prev vid"><img src="' + _esc(u) + '" alt=""><button type="button" data-rmv="1" aria-label="Remove video">&times;</button></div>' : '';
            }

            function _$(id) { return document.getElementById(id); }
            function _notifyAdmin(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
            function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
            function _val(id) { var el = _$(id); return el ? String(el.value || '').trim() : ''; }
            function _ms(v) { try { if (v && typeof v.toMillis === 'function') return v.toMillis(); if (v) return new Date(v).getTime() || 0; } catch (e) {} return 0; }
            function _btnLabel() { return _editingId ? '<i class="fas fa-save"></i> Save Changes' : '<i class="fas fa-bullhorn"></i> Publish Celebration'; }

            function _shrink(file) {
                return new Promise(function (resolve) {
                    try {
                        var url = URL.createObjectURL(file), im = new Image();
                        im.onload = function () {
                            try {
                                var max = 1600, r = Math.min(1, max / Math.max(im.width, im.height));
                                var c = document.createElement('canvas');
                                c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
                                c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
                                URL.revokeObjectURL(url);
                                c.toBlob(function (b) { resolve(b ? new File([b], 'celebration.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.86);
                            } catch (e) { resolve(file); }
                        };
                        im.onerror = function () { resolve(file); };
                        im.src = url;
                    } catch (e) { resolve(file); }
                });
            }

            function _renderPrev() {
                var p = _$('admin-cel-image-prev'); if (!p) return;
                var html = '';
                _keep.forEach(function (u, i) {
                    html += '<div class="emp-cel-prev"><img src="' + _esc(u) + '" alt=""><button type="button" data-rm="keep" data-i="' + i + '" aria-label="Remove photo">&times;</button></div>';
                });
                _fresh.forEach(function (f, i) {
                    html += '<div class="emp-cel-prev"><img src="' + _esc(f.url) + '" alt=""><button type="button" data-rm="new" data-i="' + i + '" aria-label="Remove photo">&times;</button></div>';
                });
                p.innerHTML = html;
            }
            function _clearFresh() { _fresh.forEach(function (f) { try { URL.revokeObjectURL(f.url); } catch (e) {} }); _fresh = []; }

            function _resetForm() {
                _editingId = null; _keep = []; _clearFresh(); _clearVid();
                var f = _$('admin-cel-form'); if (f) f.reset();
                _renderPrev();
                var a = _$('admin-cel-active'); if (a) a.checked = true;
                var b = _$('admin-cel-submit-btn'); if (b) { b.disabled = false; b.innerHTML = _btnLabel(); }
                var c = _$('admin-cel-cancel-btn'); if (c) c.style.display = 'none';
                var t = _$('admin-cel-form-title'); if (t) t.innerHTML = '&#127891; Add a Graduate / New Student';
            }

            function _submit() {
                var btn = _$('admin-cel-submit-btn');
                if (!fbDb) { _notifyAdmin('Not connected \u2014 try again in a moment.', 'error'); return; }
                if (!_val('admin-cel-inst') || !_val('admin-cel-name') || !_val('admin-cel-course')) { _notifyAdmin('Institution, student name and course of study are required.', 'warning'); return; }
                if (!_keep.length && !_fresh.length && !_vidKeep && !_vidFresh) { _notifyAdmin('Add at least one photo or a video.', 'warning'); return; }
                if ((_fresh.length || _vidFresh) && typeof window.uploadToCloudinary !== 'function') { _notifyAdmin('Photo upload is not ready yet \u2014 try again in a moment.', 'error'); return; }

                if (btn) btn.disabled = true;
                var uploaded = [];
                var vOut = _vidKeep ? { url: _vidKeep.url, poster: _vidKeep.poster } : null, vSnap = _vidFresh;
                var chain = Promise.resolve();
                if (vSnap) {
                    chain = chain.then(function () {
                        if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Uploading video\u2026';
                        if (!vSnap.poster) throw new Error('could not prepare the video thumbnail');
                        return window.uploadToCloudinary(new File([vSnap.poster], 'celebration-poster.jpg', { type: 'image/jpeg' })).then(function (pu) {
                            return window.uploadToCloudinary(vSnap.file).then(function (vu) {
                                if (!pu || !vu) throw new Error('video upload returned no URL');
                                vOut = { url: String(vu), poster: String(pu) };
                            });
                        });
                    });
                }
                _fresh.forEach(function (item, idx) {
                    chain = chain.then(function () {
                        if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Uploading photo ' + (idx + 1) + ' of ' + _fresh.length + '\u2026';
                        return _shrink(item.file).then(function (f) { return window.uploadToCloudinary(f); }).then(function (url) {
                            if (!url) throw new Error('upload returned no URL');
                            uploaded.push(String(url));
                        });
                    });
                });
                chain.then(function () {
                    if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Publishing\u2026';
                    var inst = _val('admin-cel-inst');
                    var payload = {
                        type: _val('admin-cel-type') === 'matriculation' ? 'matriculation' : 'convocation',
                        institution: inst, institutionKey: inst.toLowerCase().replace(/\s+/g, ' '),
                        studentName: _val('admin-cel-name'), course: _val('admin-cel-course'), department: _val('admin-cel-dept'),
                        classYear: (function () { var y = parseInt(_val('admin-cel-year'), 10); return (y >= 1950 && y <= 2100) ? y : null; })(),
                        images: _keep.concat(uploaded).length ? _keep.concat(uploaded) : (vOut ? [vOut.poster] : []),
                        videoUrl: vOut ? vOut.url : '', videoPoster: vOut ? vOut.poster : '',
                        active: !!(_$('admin-cel-active') && _$('admin-cel-active').checked),
                        updatedAt: _serverTimestamp()
                    };
                    // Admin-published cards are approved; editing a member's pending submission keeps it pending unless made Live.
                    var _ex = _editingId ? _find(_editingId) : null;
                    payload.status = payload.active ? 'approved' : ((_ex && _ex.status) || 'approved');
                    var wasEditing = !!_editingId;
                    if (wasEditing) return fbDb.collection(COL).doc(_editingId).update(payload).then(function () { _notifyAdmin('Celebration updated.', 'success'); });
                    payload.createdAt = _serverTimestamp(); payload.pushedAt = _serverTimestamp();
                    payload.createdBy = (window.userState && window.userState.id) || 'admin';
                    return fbDb.collection(COL).add(payload).then(function () {
                        _notifyAdmin(payload.active ? 'Celebration published \u2014 it is now live on every member\u2019s Dashboard.' : 'Celebration saved (paused \u2014 not on the Dashboard).', 'success');
                    });
                }).then(function () { _resetForm(); _load(); })
                  .catch(function (err) {
                      _notifyAdmin('Could not save celebration: ' + (err && err.message ? err.message : 'unknown error'), 'error');
                      if (btn) { btn.disabled = false; btn.innerHTML = _btnLabel(); }
                  });
            }

            function _load() {
                var listEl = _$('admin-cel-list'), badge = _$('admin-cel-count-badge');
                if (!listEl) return;
                if (!fbDb) { listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#9CA3AF;">Not connected yet.</div>'; return; }
                listEl.innerHTML = '<div style="padding:18px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i> Loading\u2026</div>';
                fbDb.collection(COL).get().then(function (snap) {
                    _cache = [];
                    snap.forEach(function (doc) { var d = doc.data() || {}; d.id = doc.id; _cache.push(d); });
                    _cache.sort(function (a, b) { return _ms(b.createdAt) - _ms(a.createdAt); });
                    if (badge) badge.textContent = _cache.length;
                    var dl = _$('admin-cel-inst-list');
                    if (dl) {
                        var seen = {}, opts = '';
                        _cache.forEach(function (c) { var k = String(c.institution || '').trim(); if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = 1; opts += '<option value="' + _esc(k) + '"></option>'; } });
                        dl.innerHTML = opts;
                    }
                    _renderList();
                }).catch(function (err) {
                    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#EF4444;">Could not load celebrations: ' + _esc(err && err.message) + '</div>';
                });
            }

            function _renderList() {
                var listEl = _$('admin-cel-list'); if (!listEl) return;
                var _pendN = _cache.filter(function (x) { return x.status === 'pending' && x.active !== true; }).length;
                var _bd = _$('admin-cel-count-badge'); if (_bd) _bd.textContent = _cache.length + (_pendN ? ' \u00B7 ' + _pendN + ' pending' : '');
                if (!_cache.length) { listEl.innerHTML = '<div style="padding:22px;text-align:center;color:#9CA3AF;">No celebrations yet \u2014 publish the first one above.</div>'; return; }
                var _rows = _cache.slice().sort(function (x, y) {
                    var px = (x.status === 'pending' && x.active !== true) ? 1 : 0, py = (y.status === 'pending' && y.active !== true) ? 1 : 0;
                    return (py - px) || (_ms(y.createdAt) - _ms(x.createdAt)); // pending submissions first
                });
                listEl.innerHTML = _rows.map(function (c) {
                    var live = c.active !== false, imgs = Array.isArray(c.images) ? c.images : [];
                    var pend = c.status === 'pending' && c.active !== true;
                    return '<div class="emp-sch-row" data-id="' + _esc(c.id) + '">'
                        + '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 220px;">'
                        +   (imgs[0] ? '<img src="' + _esc(imgs[0]) + '" alt="" style="width:46px;height:58px;object-fit:cover;border-radius:10px;flex-shrink:0;">' : '')
                        +   '<div style="min-width:0;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><strong style="font-size:0.9rem;">' + _esc(c.studentName) + '</strong>'
                        +   '<span class="emp-sch-pill ' + (pend ? 'pending' : (live ? 'live' : 'paused')) + '">' + (pend ? 'Pending review' : (live ? 'Live' : 'Paused')) + '</span></div>'
                        +   '<div style="font-size:0.76rem;color:var(--text-muted);margin-top:3px;">' + (c.type === 'matriculation' ? 'Matriculation' : 'Convocation') + ' &middot; ' + _esc(c.institution) + '</div>'
                        +   '<div style="font-size:0.74rem;color:var(--text-muted);margin-top:2px;">' + _esc(c.course) + (c.department ? ' &middot; ' + _esc(c.department) : '') + ' &middot; ' + ((c.videoUrl && imgs[0] === c.videoPoster) ? 0 : imgs.length) + ' photo' + ((((c.videoUrl && imgs[0] === c.videoPoster) ? 0 : imgs.length) === 1) ? '' : 's') + (c.videoUrl ? ' &middot; \uD83C\uDFA5 video' : '') + '</div></div></div>'
                        + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
                        +   (pend ? '<button type="button" class="emp-sch-mini" data-act="approve" style="background:rgba(34,197,94,0.16);color:#15803d;">Approve</button>' : '')
                        +   '<button type="button" class="emp-sch-mini" data-act="edit">Edit</button>'
                        +   (pend ? '' : '<button type="button" class="emp-sch-mini" data-act="toggle">' + (live ? 'Pause' : 'Resume') + '</button>')
                        +   '<button type="button" class="emp-sch-mini danger" data-act="delete">' + (pend ? 'Reject' : 'Delete') + '</button></div></div>';
                }).join('');
            }

            function _find(id) { for (var i = 0; i < _cache.length; i++) if (_cache[i].id === id) return _cache[i]; return null; }

            function _edit(c) {
                _editingId = c.id; _clearFresh();
                _keep = (Array.isArray(c.images) ? c.images : []).slice();
                _clearVid();
                if (c.videoUrl) { if (_keep.length && _keep[0] === c.videoPoster) _keep.shift(); _vidKeep = { url: c.videoUrl, poster: c.videoPoster || '' }; _renderVidPrev(); }
                var map = { 'admin-cel-type': c.type || 'convocation', 'admin-cel-inst': c.institution, 'admin-cel-name': c.studentName, 'admin-cel-course': c.course, 'admin-cel-dept': c.department, 'admin-cel-year': c.classYear };
                Object.keys(map).forEach(function (k) { var el = _$(k); if (el && map[k] != null) el.value = map[k]; });
                var a = _$('admin-cel-active'); if (a) a.checked = c.active !== false;
                var fi = _$('admin-cel-image'); if (fi) fi.value = '';
                _renderPrev();
                var b = _$('admin-cel-submit-btn'); if (b) b.innerHTML = _btnLabel();
                var cb = _$('admin-cel-cancel-btn'); if (cb) cb.style.display = '';
                var t = _$('admin-cel-form-title'); if (t) t.innerHTML = '&#9998; Edit Celebration';
                var f = _$('admin-cel-form'); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            function _toggle(c) {
                var resume = c.active === false;
                fbDb.collection(COL).doc(c.id).update({ active: resume, updatedAt: _serverTimestamp() }).then(function () {
                    _notifyAdmin(resume ? 'Celebration is live again.' : 'Celebration paused \u2014 hidden from the Dashboard.', 'success'); _load();
                }).catch(function (err) { _notifyAdmin('Could not update: ' + (err && err.message), 'error'); });
            }
            function _approve(c) {
                fbDb.collection(COL).doc(c.id).update({ active: true, status: 'approved', pushedAt: _serverTimestamp(), updatedAt: _serverTimestamp() }).then(function () {
                    _notifyAdmin('Approved \u2014 ' + c.studentName + '\u2019s celebration is now live on the Dashboard.', 'success'); _load();
                }).catch(function (err) { _notifyAdmin('Could not approve: ' + (err && err.message), 'error'); });
            }
            function _delete(c) {
                if (!window.confirm('Delete the celebration for "' + c.studentName + '"? It disappears from the Dashboard immediately.')) return;
                fbDb.collection(COL).doc(c.id).delete().then(function () {
                    _cache = _cache.filter(function (x) { return x.id !== c.id; });
                    var badge = _$('admin-cel-count-badge'); if (badge) badge.textContent = _cache.length;
                    _renderList(); _notifyAdmin('Celebration deleted.', 'success');
                }).catch(function (err) { _notifyAdmin('Could not delete: ' + (err && err.message), 'error'); });
            }

            function _wire() {
                var form = _$('admin-cel-form');
                if (form && !form._wired) {
                    form._wired = true;
                    form.addEventListener('submit', function (e) { e.preventDefault(); _submit(); });
                }
                var fi = _$('admin-cel-image');
                if (fi && !fi._wired) {
                    fi._wired = true;
                    fi.addEventListener('change', function () {
                        var files = Array.prototype.slice.call(fi.files || []);
                        var room = MAX_IMGS - _keep.length - _fresh.length;
                        if (files.length > room) _notifyAdmin('Up to ' + MAX_IMGS + ' photos per celebration \u2014 extra photos were skipped.', 'warning');
                        files.slice(0, Math.max(0, room)).forEach(function (f) { if (/^image\//.test(f.type)) _fresh.push({ file: f, url: URL.createObjectURL(f) }); });
                        fi.value = '';
                        _renderPrev();
                    });
                }
                var vi = _$('admin-cel-video');
                if (vi && !vi._wired) {
                    vi._wired = true;
                    vi.addEventListener('change', function () {
                        var fl = vi.files && vi.files[0]; vi.value = '';
                        if (!fl) return;
                        if (!/^video\//.test(fl.type)) { _notifyAdmin('Please choose a video file.', 'warning'); return; }
                        if (fl.size > MAX_VIDEO_BYTES) { _notifyAdmin('That video is larger than 60 MB \u2014 trim or compress it first.', 'warning'); return; }
                        _videoPoster(fl).then(function (r) {
                            if (r.duration && r.duration > MAX_VIDEO_SEC) { _notifyAdmin('That video is longer than 90 seconds \u2014 trim it first.', 'warning'); return; }
                            _clearVid();
                            _vidFresh = { file: fl, poster: r.blob, url: r.blob ? URL.createObjectURL(r.blob) : '' };
                            _renderVidPrev();
                        });
                    });
                }
                var vp = _$('admin-cel-video-prev');
                if (vp && !vp._wired) { vp._wired = true; vp.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-rmv]')) _clearVid(); }); }
                var pv = _$('admin-cel-image-prev');
                if (pv && !pv._wired) {
                    pv._wired = true;
                    pv.addEventListener('click', function (e) {
                        var b = e.target.closest ? e.target.closest('[data-rm]') : null; if (!b) return;
                        var i = parseInt(b.getAttribute('data-i'), 10);
                        if (b.getAttribute('data-rm') === 'keep') _keep.splice(i, 1);
                        else { var x = _fresh.splice(i, 1)[0]; if (x) { try { URL.revokeObjectURL(x.url); } catch (er) {} } }
                        _renderPrev();
                    });
                }
                var list = _$('admin-cel-list');
                if (list && !list._wired) {
                    list._wired = true;
                    list.addEventListener('click', function (e) {
                        var b = e.target.closest ? e.target.closest('[data-act]') : null;
                        var row = e.target.closest ? e.target.closest('.emp-sch-row') : null;
                        if (!b || !row) return;
                        var c = _find(row.getAttribute('data-id')); if (!c) return;
                        var act = b.getAttribute('data-act');
                        if (act === 'edit') _edit(c); else if (act === 'toggle') _toggle(c); else if (act === 'approve') _approve(c); else if (act === 'delete') _delete(c);
                    });
                }
                var map = { 'admin-cel-cancel-btn': _resetForm, 'admin-cel-refresh-btn': _load };
                Object.keys(map).forEach(function (id) { var el = _$(id); if (el && !el._wired) { el._wired = true; el.addEventListener('click', map[id]); } });
            }

            window._adminLoadCelebrations = function () { _wire(); _load(); };

            if (document.readyState !== 'loading') _wire(); else document.addEventListener('DOMContentLoaded', _wire);
            document.addEventListener('empyrean-init-done', function () { setTimeout(_wire, 400); });

            console.log('[Admin] \u2705 Celebration manager wired \u2014 publish/edit/pause/delete graduate & matriculation cards.');
        })();


        /* ═══════════════════════════════════════════════════════════════════════════════════════════════
           SOS DONATIONS — ADMIN VISIBILITY  (added 2026-10-19)
           "Admin should be able to see the details of those donating to an SOS ticket."

           Every SOS donation is already saved by app-sos.js (_submitDonationForm) to `flw_transactions` with
           purpose 'sos_donation', the donor, the beneficiary's user id and the SOS post id. This panel reads
           those records: Admin Panel → "SOS Donations" shows totals, a per-ticket summary, a searchable donor
           list (name, email, phone, amount, status, reference) and CSV export.
           Firestore rule needed: admins must be allowed to READ flw_transactions.
           ═══════════════════════════════════════════════════════════════════════════════════════════════ */
        (function sosDonationsAdmin() {
            'use strict';

            function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

            var _rows = [];
            function _$(id) { return document.getElementById(id); }
            function _toDate(v) {
                if (!v) return null;
                if (typeof v.toDate === 'function') return v.toDate();
                if (v.seconds) return new Date(v.seconds * 1000);
                var d = new Date(v); return isNaN(d) ? null : d;
            }
            function _fmtMoney(n, cur) {
                try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: cur || 'NGN', maximumFractionDigits: 2 }).format(n || 0); }
                catch (e) { return (cur || 'NGN') + ' ' + (n || 0).toLocaleString(); }
            }
            function _fmtDate(d) {
                if (!d) return '—';
                return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            }
            function _ticketKey(r) { return r.postId || r.beneficiaryId || ('name:' + (r.beneficiaryName || '')); }
            function _ticketLabel(r) {
                if (!r.postId && !r.beneficiaryId && !r.beneficiaryName) return 'Ticket not recorded';
                return (r.beneficiaryName ? r.beneficiaryName : 'SOS ticket') + (r.postId ? ' · #' + String(r.postId).slice(0, 6) : '');
            }

            async function _load() {
                var body = _$('admin-sosd-body');
                if (body) body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">Loading donations…</td></tr>';
                try {
                    var db = window.fbDb || (typeof fbDb !== 'undefined' ? fbDb : null);
                    if (!db || !db.collection) throw new Error('Database not ready yet — try again in a moment.');
                    var snap = await db.collection('flw_transactions').where('purpose', '==', 'sos_donation').limit(500).get();
                    var rows = [], ids = {};
                    snap.forEach(function (doc) {
                        var d = doc.data() || {};
                        var rid = d.recipientUserId || '';
                        if (rid) ids[rid] = 1;
                        rows.push({ id: doc.id, date: _toDate(d.createdAt), postId: d.sosPostId || '', beneficiaryId: rid, beneficiaryName: d.recipientName || '',
                            donorName: d.donorName || '', donorEmail: d.donorEmail || '', donorPhone: d.donorPhone || '', donorId: d.donorUserId || '',
                            amount: Number(d.amount) || 0, currency: d.currency || 'NGN', ref: d.txRef || doc.id, status: d.status || 'held' });
                    });
                    /* Older records have no beneficiary name saved — look the names up (best effort, max 30 people). */
                    var need = Object.keys(ids).slice(0, 30), names = {};
                    await Promise.all(need.map(function (uid) {
                        return db.collection('users').doc(uid).get().then(function (u) {
                            if (u && u.exists) { var x = u.data() || {}; names[uid] = x.fullName || x.username || x.name || ''; }
                        }).catch(function () {});
                    }));
                    rows.forEach(function (r) { if (!r.beneficiaryName && r.beneficiaryId && names[r.beneficiaryId]) r.beneficiaryName = names[r.beneficiaryId]; });
                    rows.sort(function (x, y) { return (y.date ? y.date.getTime() : 0) - (x.date ? x.date.getTime() : 0); });
                    _rows = rows;
                    _populateTickets(); _render();
                } catch (err) {
                    var msg = (err && err.message) || 'Could not load donations.';
                    if (/permission|insufficient/i.test(msg)) msg = 'Permission denied — allow admins to read flw_transactions in the Firestore rules.';
                    if (body) body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger,#c0392b);">' + _esc(msg) + '</td></tr>';
                }
            }

            function _populateTickets() {
                var sel = _$('admin-sosd-ticket'); if (!sel) return;
                var cur = sel.value, seen = {}, html = '<option value="">All SOS tickets</option>';
                _rows.forEach(function (r) { var k = _ticketKey(r); if (seen[k]) return; seen[k] = 1; html += '<option value="' + _esc(k) + '">' + _esc(_ticketLabel(r)) + '</option>'; });
                sel.innerHTML = html; sel.value = cur && seen[cur] ? cur : '';
            }

            function _filtered() {
                var q = ((_$('admin-sosd-search') || {}).value || '').trim().toLowerCase();
                var t = (_$('admin-sosd-ticket') || {}).value || '';
                return _rows.filter(function (r) {
                    if (t && _ticketKey(r) !== t) return false;
                    if (!q) return true;
                    return [r.donorName, r.donorEmail, r.donorPhone, r.beneficiaryName, r.ref, r.postId, r.donorId].join(' ').toLowerCase().indexOf(q) !== -1;
                });
            }

            function _render() {
                var list = _filtered();
                var total = 0, donors = {}, tickets = {}, byTicket = {};
                list.forEach(function (r) {
                    total += r.amount; donors[(r.donorEmail || r.donorId || r.ref)] = 1; var k = _ticketKey(r); tickets[k] = 1;
                    var b = byTicket[k] || (byTicket[k] = { label: _ticketLabel(r), count: 0, sum: 0, cur: r.currency }); b.count++; b.sum += r.amount;
                });
                var set = function (id, v) { var el = _$(id); if (el) el.textContent = v; };
                set('admin-sosd-stat-total', _fmtMoney(total, 'NGN'));
                set('admin-sosd-stat-count', list.length);
                set('admin-sosd-stat-donors', Object.keys(donors).length);
                set('admin-sosd-stat-tickets', Object.keys(tickets).length);

                var sb = _$('admin-sosd-summary');
                if (sb) {
                    var keys = Object.keys(byTicket).sort(function (a, b) { return byTicket[b].sum - byTicket[a].sum; });
                    sb.innerHTML = keys.length ? keys.map(function (k) {
                        var b = byTicket[k];
                        return '<tr style="border-bottom:1px solid var(--border-color,#eee);"><td style="padding:10px 16px;font-weight:600;">' + _esc(b.label) + '</td><td style="padding:10px 16px;">' + b.count + '</td><td style="padding:10px 16px;font-weight:700;color:var(--success-color);">' + _esc(_fmtMoney(b.sum, b.cur)) + '</td></tr>';
                    }).join('') : '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-muted);">No SOS donations yet.</td></tr>';
                }
                var body = _$('admin-sosd-body');
                if (body) {
                    body.innerHTML = list.length ? list.map(function (r) {
                        var donor = r.donorName || 'Unnamed';
                        var contact = [r.donorEmail, r.donorPhone].filter(Boolean).map(_esc).join('<br>') || (r.donorId && r.donorId !== 'guest' ? 'User ID: ' + _esc(String(r.donorId).slice(0, 10)) + '…' : '—');
                        return '<tr style="border-bottom:1px solid var(--border-color,#eee);">'
                            + '<td style="padding:10px 16px;white-space:nowrap;">' + _esc(_fmtDate(r.date)) + '</td>'
                            + '<td style="padding:10px 16px;font-weight:600;">' + _esc(_ticketLabel(r))  + '</td>'
                            + '<td style="padding:10px 16px;">' + _esc(donor) + '</td>'
                            + '<td style="padding:10px 16px;font-size:var(--text-sm);">' + contact + '</td>'
                            + '<td style="padding:10px 16px;font-weight:700;color:var(--success-color);white-space:nowrap;">' + _esc(_fmtMoney(r.amount, r.currency)) + '</td>'
                            + '<td style="padding:10px 16px;">' + _esc(r.status === 'held' ? 'Held in escrow' : r.status) + '</td>'
                            + '<td style="padding:10px 16px;font-size:var(--text-xs);word-break:break-all;color:var(--text-muted);">' + _esc(r.ref) + '</td></tr>';
                    }).join('') : '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">No donations match.</td></tr>';
                }
            }

            function _csv() {
                var list = _filtered();
                var esc = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
                var lines = [['Date', 'SOS ticket', 'Ticket ID', 'Donor name', 'Donor email', 'Donor phone', 'Donor user ID', 'Amount', 'Currency', 'Status', 'Reference'].join(',')];
                list.forEach(function (r) {
                    lines.push([_fmtDate(r.date), _ticketLabel(r), r.postId, r.donorName, r.donorEmail, r.donorPhone, r.donorId, r.amount, r.currency, r.status, r.ref].map(esc).join(','));
                });
                try {
                    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
                    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                    a.download = 'sos-donations-' + new Date().toISOString().slice(0, 10) + '.csv';
                    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
                } catch (e) { alert('Could not create the CSV on this device.'); }
            }

            function _wire() {
                var map = { 'admin-sosd-refresh': _load, 'admin-sosd-csv': _csv };
                Object.keys(map).forEach(function (id) { var el = _$(id); if (el && !el._wired) { el._wired = true; el.addEventListener('click', map[id]); } });
                ['admin-sosd-search', 'admin-sosd-ticket'].forEach(function (id) {
                    var el = _$(id); if (el && !el._wired) { el._wired = true; el.addEventListener(id === 'admin-sosd-search' ? 'input' : 'change', _render); }
                });
            }
            /* ── "View donors" button on each SOS card (admins only) ─────────────────────────────────── */
            function _isAdminNow() { return window.isAdmin === true || !!(window.EmpState && window.EmpState.isAdmin === true); }

            function _ensureSosdStyle() {
                if (document.getElementById('sosd-style')) return;
                var st = document.createElement('style'); st.id = 'sosd-style';
                st.textContent =
                    '.sosd-view-btn{grid-column:1 / -1;grid-row:auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:10px;padding:11px 14px;border-radius:14px;' +
                    'border:1.5px solid rgba(27,43,139,.35);background:rgba(27,43,139,.07);color:#1B2B8B;font-weight:700;font-size:.85rem;cursor:pointer;font-family:inherit;}' +
                    '.sosd-view-btn:active{transform:scale(.98);}' +
                    '#sosd-overlay{position:fixed;inset:0;z-index:100000;background:rgba(10,14,39,.55);display:flex;align-items:flex-end;justify-content:center;}' +
                    '#sosd-sheet{background:#fff;color:#1f2937;width:100%;max-width:560px;max-height:86vh;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -10px 40px rgba(0,0,0,.25);}' +
                    '#sosd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 10px;}' +
                    '#sosd-head h3{margin:0;font-size:1.05rem;color:#1B2B8B;line-height:1.3;}' +
                    '#sosd-head p{margin:3px 0 0;font-size:.8rem;color:#6b7280;}' +
                    '#sosd-close{border:none;background:#f1f3f9;width:34px;height:34px;border-radius:50%;font-size:1rem;cursor:pointer;flex:none;color:#1B2B8B;}' +
                    '#sosd-total{margin:0 18px 8px;padding:12px 14px;border-radius:14px;background:rgba(16,122,87,.08);color:#0b6b4b;font-weight:800;font-size:1.1rem;display:flex;justify-content:space-between;align-items:baseline;}' +
                    '#sosd-total span{font-size:.75rem;font-weight:600;}' +
                    '#sosd-list{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 18px 22px;}' +
                    '.sosd-item{border:1px solid #e5e7eb;border-radius:14px;padding:12px 14px;margin-top:10px;}' +
                    '.sosd-row{display:flex;justify-content:space-between;gap:10px;align-items:baseline;}' +
                    '.sosd-name{font-weight:700;color:#111827;}' +
                    '.sosd-amt{font-weight:800;color:#0b6b4b;white-space:nowrap;}' +
                    '.sosd-sub{font-size:.8rem;color:#6b7280;margin-top:4px;line-height:1.5;word-break:break-word;}' +
                    '.sosd-sub a{color:#1B2B8B;text-decoration:none;font-weight:600;}' +
                    '.sosd-empty{text-align:center;color:#6b7280;padding:30px 10px;font-size:.9rem;}';
                document.head.appendChild(st);
            }

            function _closeSosd() { var o = document.getElementById('sosd-overlay'); if (o) o.remove(); document.body.style.overflow = ''; }

            async function _openSosd(postId, userId, username) {
                _ensureSosdStyle(); _closeSosd();
                var o = document.createElement('div'); o.id = 'sosd-overlay';
                o.innerHTML = '<div id="sosd-sheet" role="dialog" aria-modal="true"><div id="sosd-head"><div><h3>Donors \u2014 ' + _esc(username || 'SOS ticket') + '</h3><p>Visible to admins only</p></div>' +
                    '<button type="button" id="sosd-close" aria-label="Close">\u2715</button></div><div id="sosd-total" style="display:none"></div>' +
                    '<div id="sosd-list"><div class="sosd-empty">Loading donors\u2026</div></div></div>';
                o.addEventListener('click', function (e) { if (e.target === o || (e.target.closest && e.target.closest('#sosd-close'))) _closeSosd(); });
                document.body.appendChild(o); document.body.style.overflow = 'hidden';
                var list = document.getElementById('sosd-list'), tot = document.getElementById('sosd-total');
                try {
                    var db = window.fbDb || (typeof fbDb !== 'undefined' ? fbDb : null);
                    if (!db || !db.collection) throw new Error('Database not ready yet — try again in a moment.');
                    var q = db.collection('flw_transactions').where('purpose', '==', 'sos_donation');
                    q = postId ? q.where('sosPostId', '==', postId) : q.where('recipientUserId', '==', userId || '__none__');
                    var snap = await q.limit(200).get();
                    var rows = [];
                    snap.forEach(function (doc) { var d = doc.data() || {}; rows.push({ date: _toDate(d.createdAt), name: d.donorName || 'Unnamed', email: d.donorEmail || '', phone: d.donorPhone || '', amount: Number(d.amount) || 0, cur: d.currency || 'NGN', status: d.status || 'held', ref: d.txRef || doc.id }); });
                    rows.sort(function (a, b) { return (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0); });
                    if (!rows.length) { list.innerHTML = '<div class="sosd-empty">No donations have been made to this ticket yet.</div>'; return; }
                    var sum = rows.reduce(function (n, r) { return n + r.amount; }, 0);
                    tot.style.display = 'flex'; tot.innerHTML = _esc(_fmtMoney(sum, rows[0].cur)) + '<span>' + rows.length + (rows.length === 1 ? ' donation' : ' donations') + '</span>';
                    list.innerHTML = rows.map(function (r) {
                        var contact = [r.email ? '<a href="mailto:' + _esc(r.email) + '">' + _esc(r.email) + '</a>' : '', r.phone ? '<a href="tel:' + _esc(r.phone) + '">' + _esc(r.phone) + '</a>' : ''].filter(Boolean).join(' \u00b7 ');
                        return '<div class="sosd-item"><div class="sosd-row"><span class="sosd-name">' + _esc(r.name) + '</span><span class="sosd-amt">' + _esc(_fmtMoney(r.amount, r.cur)) + '</span></div>' +
                            (contact ? '<div class="sosd-sub">' + contact + '</div>' : '') +
                            '<div class="sosd-sub">' + _esc(_fmtDate(r.date)) + ' \u00b7 ' + _esc(r.status === 'held' ? 'Held in escrow' : r.status) + '<br>Ref: ' + _esc(r.ref) + '</div></div>';
                    }).join('');
                } catch (err) {
                    var msg = (err && err.message) || 'Could not load donors.';
                    if (/permission|insufficient/i.test(msg)) msg = 'Permission denied \u2014 allow admins to read flw_transactions in the Firestore rules.';
                    list.innerHTML = '<div class="sosd-empty" style="color:#c0392b;">' + _esc(msg) + '</div>';
                }
            }

            function _addDonorBtns() {
                if (!_isAdminNow()) return;
                _ensureSosdStyle();
                document.querySelectorAll('.impact-story.sos-request').forEach(function (card) {
                    if (card.querySelector('.sosd-view-btn')) return;
                    var btn = document.createElement('button');
                    btn.type = 'button'; btn.className = 'sosd-view-btn';
                    btn.innerHTML = '<i class="fas fa-users"></i> View donors <span style="font-weight:500;font-size:.72rem;opacity:.7;">(admin)</span>';
                    var host = card.querySelector('.sos-appeal') || card;
                    host.appendChild(btn);
                });
            }
            document.addEventListener('click', function (e) {
                var b = e.target.closest && e.target.closest('.sosd-view-btn');
                if (!b) return;
                e.preventDefault(); e.stopPropagation();
                var card = b.closest('.impact-story');
                if (!card || !_isAdminNow()) return;
                _openSosd(card.dataset.postId || '', card.dataset.userId || '', card.dataset.username || '');
            }, true);
            var _sosdTimer = null;
            function _scheduleSweep() { clearTimeout(_sosdTimer); _sosdTimer = setTimeout(_addDonorBtns, 350); }
            try { new MutationObserver(_scheduleSweep).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
            setInterval(_addDonorBtns, 4000);
            document.addEventListener('empyrean-init-done', function () { setTimeout(_addDonorBtns, 600); });

            window._adminLoadSosDonations = function () { _wire(); _load(); };
            if (document.readyState !== 'loading') _wire(); else document.addEventListener('DOMContentLoaded', _wire);
            console.log('[Admin] \u2705 SOS donations admin tab ready.');
        })();
