/* =============================================================================
   EMPYREAN INTERNATIONAL — DONOR PROFILE & SPONSORSHIP PROPOSAL MODULE
   app-donors.js  |  v1.0
   =============================================================================

   PURPOSE
   ───────
   Lets a user register as a donor, browse open SOS requests / projects, and
   submit a sponsorship proposal (a pledge to fund one of them). Admins review
   proposals in a new admin queue tab, same approve/reject pattern already
   used for SOS requests. Approved proposals are funded through the existing
   Flutterwave flow already used for SOS donations — this module does not
   introduce a second payment integration.

   This is intentionally the "identity + proposal + matching" layer only.
   Grant disbursement (NGO applications, KYC, ledger, multi-sig, blockchain
   audit hash) already exists in app-ngo.js and is NOT duplicated here.

   Firestore collections (new)
   ────────────────────────────
     donor_profiles/{uid}
       { uid, name, orgName, donorType: 'individual'|'org'|'corporate'|'international',
         email, preferredCategories: [], preferredRegions: [], verified: bool,
         approvalStatus: 'pending'|'approved'|'rejected', decidedAt, decidedBy,
         createdAt, updatedAt }
       Donors must be approvalStatus === 'approved' before they can submit a
       sponsorship proposal (openProposalModal / _submitProposalForm both
       gate on this). approvalStatus/verified are admin-decided fields only —
       a donor editing their own profile never touches them (see
       _ensureDonorProfileDoc).

     sponsorship_proposals/{id}
       { id, donorId, donorName, targetType: 'sos'|'project', targetId,
         targetLabel, pledgedAmount, currency, notes, status:
         'pending'|'approved'|'rejected'|'funded'|'completed',
         amountFunded, createdAt, decidedAt, decidedBy }

   Suggested firestore.rules additions (apply alongside existing rules —
   not written here, since rules live outside this file's scope):
     match /donor_profiles/{uid} {
       allow read: if request.auth != null;
       allow write: if request.auth != null && request.auth.uid == uid;
     }
     match /sponsorship_proposals/{id} {
       allow read: if request.auth != null;
       allow create: if request.auth != null
                     && request.resource.data.donorId == request.auth.uid;
       allow update: if request.auth != null
                     && (resource.data.donorId == request.auth.uid
                         || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true);
     }

   LOAD ORDER
   ──────────
   Must come AFTER: firebase-init.js, app-state.js, app-auth.js, app-notifications.js,
                     app-sos.js, app-ngo.js, app-admin.js
   Must come BEFORE: app-startup.js

   DEPENDS ON
   ──────────
   • window.fbAuth / window.fbDb / window._firebaseLoaded
   • window.userState / window.isGuest / window.isAdmin
   • window.showNotification / window.pushNotification / window.notifyUser
   • window.rewardUserForAction        (app-helpers.js)
   • window.initiateFlutterwavePayment (app-admin.js) — falls back to a local
     FlutterwaveCheckout call if not present, same guarded pattern app-sos.js uses
   • window.mockAdminSosQueue          (app-sos.js — read-only, for matching)

   Exposes on window:
     window.renderSponsorTargets, window.renderDonorWall, window.renderMyProposals,
     window.renderDonorAdminQueue, window.getMatchedOpportunitiesForDonor,
     window.openProposalModal
   =============================================================================
*/

(function empyreanDonorsModule() {
    'use strict';

    // ── Wait for DOM ─────────────────────────────────────────────────────────
    function _ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    // ── Auth uid helper — always prefer live Firebase Auth uid over the
    //    app-local userState.id (recurring root cause of permission-denied
    //    errors elsewhere in this codebase; see app-sos.js / live-streaming). ──
    function _authUid() {
        try {
            if (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) {
                return window.fbAuth.currentUser.uid;
            }
        } catch (e) {}
        return (window.userState && window.userState.id) || null;
    }

    function _serverTimestamp() {
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                return firebase.firestore.FieldValue.serverTimestamp();
            }
        } catch (e) {}
        return new Date();
    }

    // ── Shared state refs ────────────────────────────────────────────────────
    function _state() {
        return {
            userState:      window.userState      || {},
            isGuest:        window.isGuest         !== false,
            isAdmin:        window.isAdmin          || false,
            fbDb:           window.fbDb,
            firebaseLoaded: window._firebaseLoaded  || false,
            uid:            _authUid()
        };
    }

    // ── Helper shortcuts ─────────────────────────────────────────────────────
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _push(msg, type) {
        if (typeof window.pushNotification === 'function') window.pushNotification(msg, type || 'info');
    }
    function _reward(action, userId) {
        if (typeof window.rewardUserForAction === 'function') window.rewardUserForAction(action, userId || null);
    }
    function _notifyUser(userId, msg, type) {
        if (typeof window.notifyUser === 'function') window.notifyUser(userId, msg, type);
    }
    function _requireLogin() {
        var S = _state();
        if (!S.isGuest && S.uid) return true;
        _notify('Please log in to continue.', 'info');
        var amh = document.getElementById('auth-modal-overlay');
        var lv  = document.getElementById('login-view');
        if (amh) { amh.style.display = 'flex'; amh.classList.add('show'); }
        if (lv)  lv.style.display = 'block';
        document.body.classList.add('modal-open');
        setTimeout(function () { if (typeof window.generateCaptcha === 'function') window.generateCaptcha(); }, 150);
        return false;
    }

    // ── Local caches (mirrors _allPagesCache pattern in app-admin.js) ────────
    var _myProposalsCache   = [];
    var _adminQueueCache    = [];
    var _openTargetsCache   = [];
    var _donorProfileCache  = null;
    var _donorWallCache     = [];
    var _donorWallStats     = { donors: 0, causes: 0 };   // 2026-11-05: real totals for the stats strip (no goal/target)
    var _donorGiftCounts    = {};                         // donorId -> number of funded gifts, shown on the donor card
    var _donorApprovalQueueCache = [];
    var _unsubMyProposals   = null;
    var _unsubAdminQueue    = null;
    var _unsubDonorProfile  = null;
    var _unsubDonorWall     = null;
    var _unsubDonorApprovalQueue = null;
    // Admin "Donors" tab (monitoring dashboard) — separate, unfiltered
    // listeners over ALL donor_profiles / ALL sponsorship_proposals docs.
    // Kept distinct from the two queue caches above (which only hold the
    // 'pending' subset) so the dashboard can show approved/rejected/funded
    // history too without re-shaping the queue logic.
    var _allDonorsCache     = [];
    var _allProposalsCache  = [];
    var _unsubAllDonors     = null;
    var _unsubAllProposals  = null;

    // Donor Messages — dedicated donor<->admin thread system (see §12),
    // kept entirely separate from app-chat.js's general 'messages'
    // collection and from marketplace_messages, mirroring the pattern
    // app-marketplace.js already uses to keep its own inbox distinct.
    var _donorMsgThreadsCache = [];   // admin-side: every donor's thread (for the message receiver portal)
    var _unsubDonorMsgThreads = null;
    var _unsubMyDonorThread   = null; // donor-side: just their own thread, for the unread badge

    // ============================================================
    // 1. Donor profile — create/update + live listener
    // ============================================================
    function _ensureDonorProfileDoc(fields) {
        var S = _state();
        if (!S.firebaseLoaded || !S.fbDb || !S.uid) {
            return Promise.reject(new Error('Not signed in or Firestore unavailable.'));
        }
        var ref = S.fbDb.collection('donor_profiles').doc(S.uid);
        return ref.get().then(function (doc) {
            var payload = Object.assign({
                uid: S.uid,
                updatedAt: _serverTimestamp()
            }, fields);

            if (!doc.exists) {
                // New profile — enters the admin approval queue.
                payload.createdAt = _serverTimestamp();
                payload.approvalStatus = 'pending';
                payload.verified = false;
            } else {
                // BUG FIX: this used to always merge in the caller's
                // verified:false, which meant every profile *edit* (not
                // just the initial registration) silently reset an
                // already-approved donor back to unverified. approvalStatus
                // and verified are now admin-decided fields only — a
                // profile edit must never touch them.
                delete payload.approvalStatus;
                delete payload.verified;
            }
            return ref.set(payload, { merge: true }).then(function () {
                return { isNew: !doc.exists };
            });
        });
    }

    // ── Approval-status helper — reads the cached donor profile.
    //    Falls back to the legacy `verified` bool for profiles created
    //    before approvalStatus existed. ──
    function _donorApprovalStatus() {
        if (!_donorProfileCache) return null;
        return _donorProfileCache.approvalStatus || (_donorProfileCache.verified ? 'approved' : 'pending');
    }

    function _submitDonorRegistrationForm(form) {
        if (!_requireLogin()) return;
        var name      = (form.querySelector('[name="donor-name"]')      || {}).value || '';
        var orgName   = (form.querySelector('[name="donor-org"]')       || {}).value || '';
        var donorType = (form.querySelector('[name="donor-type"]')      || {}).value || 'individual';
        var email     = (form.querySelector('[name="donor-email"]')     || {}).value || (window.userState && window.userState.email) || '';
        // NOTE: the form markup uses a checkbox-chip checklist
        // (<input type="checkbox" name="donor-category">), not a native
        // <select multiple><option> list — this used to read
        // '[name="donor-category"] option:checked', which never matched
        // anything against checkboxes, so preferred categories were
        // silently dropped on every save. Read the checked checkboxes instead.
        var catsEl    = form.querySelectorAll('input[name="donor-category"]:checked');
        var regionsRaw = (form.querySelector('[name="donor-region"]') || {}).value || '';
        var preferredCategories = Array.prototype.map.call(catsEl, function (o) { return o.value; });
        var preferredRegions    = regionsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var displayPubliclyEl   = form.querySelector('[name="donor-display-publicly"]');
        var displayPublicly     = !displayPubliclyEl || displayPubliclyEl.checked !== false;

        if (!name.trim()) { _notify('Please enter a name for your donor profile.', 'error'); return; }

        var submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.origText = submitBtn.innerHTML; submitBtn.innerHTML = 'Saving…'; }

        _ensureDonorProfileDoc({
            name: name.trim(),
            orgName: orgName.trim(),
            donorType: donorType,
            email: email,
            preferredCategories: preferredCategories,
            preferredRegions: preferredRegions,
            displayPublicly: displayPublicly
        }).then(function (result) {
            if (result && result.isNew) {
                _notify('Donor profile submitted. An admin will review it — you can submit sponsorship proposals once it\u2019s approved.', 'success');
                // Feed the shared admin audit log (window.empyreanAuditLog /
                // admin_audit_log, defined in app-live.js) so registrations
                // show up in Activity Log alongside approvals/rejections.
                if (typeof window.logAdminAction === 'function') {
                    window.logAdminAction('DONOR_REGISTERED', orgName.trim() || name.trim(), 'New donor profile submitted for approval');
                }
            } else {
                _notify('Donor profile updated.', 'success');
            }
            _reward('donor_register', _state().uid);
            if (typeof window.navigateTo === 'function') window.navigateTo('donor-dashboard');
        }).catch(function (err) {
            _notify('Could not save donor profile: ' + (err && err.message ? err.message : 'please try again.'), 'error');
        }).finally(function () {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtn.dataset.origText || 'Save'; }
        });
    }

    function _watchDonorProfile() {
        var S = _state();
        if (_unsubDonorProfile) { _unsubDonorProfile(); _unsubDonorProfile = null; }
        if (!S.firebaseLoaded || !S.fbDb || !S.uid) return;

        _unsubDonorProfile = S.fbDb.collection('donor_profiles').doc(S.uid)
            .onSnapshot(function (doc) {
                _donorProfileCache = doc.exists ? doc.data() : null;
                if (window.userState) window.userState.donorProfile = _donorProfileCache;
                _refreshDonorBadgeUI();
            }, function (err) {
                console.warn('[app-donors] donor_profiles listener error:', err.message);
            });
    }

    function _refreshDonorBadgeUI() {
        var badge = document.getElementById('donor-status-badge');
        if (!badge) return;
        if (!_donorProfileCache) { badge.textContent = 'Not registered as a donor'; return; }
        var status = _donorApprovalStatus();
        badge.textContent = (status === 'approved') ? 'Verified Donor'
            : (status === 'rejected') ? 'Donor profile not approved'
            : 'Donor (pending admin approval)';
    }

    // ============================================================
    // 1a2. Preferred-categories dropdown (donor registration form) —
    //      the checkboxes are unchanged (still <input name="donor-category">
    //      inside #donor-category-panel), so _submitDonorRegistrationForm's
    //      existing read of 'input[name="donor-category"]:checked' keeps
    //      working with no changes there. This just collapses the always-
    //      visible chip grid into a single dropdown trigger.
    // ============================================================
    function _categoryDropdownEls() {
        return {
            wrap:    document.getElementById('donor-category'),
            trigger: document.getElementById('donor-category-trigger'),
            panel:   document.getElementById('donor-category-panel'),
            text:    document.getElementById('donor-category-trigger-text')
        };
    }

    function _closeCategoryDropdown() {
        var els = _categoryDropdownEls();
        if (!els.wrap) return;
        els.wrap.classList.remove('open');
        if (els.trigger) els.trigger.setAttribute('aria-expanded', 'false');
    }

    function _toggleCategoryDropdown() {
        var els = _categoryDropdownEls();
        if (!els.wrap) return;
        var open = els.wrap.classList.toggle('open');
        if (els.trigger) els.trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function _refreshCategoryDropdownLabel() {
        var els = _categoryDropdownEls();
        if (!els.panel || !els.text) return;
        var checked = els.panel.querySelectorAll('input[name="donor-category"]:checked');
        if (!checked.length) {
            els.text.textContent = 'Select categories…';
            els.text.classList.add('placeholder');
            return;
        }
        els.text.classList.remove('placeholder');
        var labels = Array.prototype.map.call(checked, function (cb) {
            var span = cb.parentElement && cb.parentElement.querySelector('span');
            return span ? span.textContent : cb.value;
        });
        els.text.textContent = (checked.length <= 2)
            ? labels.join(', ')
            : (checked.length + ' categories selected');
    }

    function _bindCategoryDropdown() {
        document.addEventListener('click', function (e) {
            var els = _categoryDropdownEls();
            if (!els.wrap) return;
            var onTrigger = e.target.closest && e.target.closest('#donor-category-trigger');
            var onPanel    = e.target.closest && e.target.closest('#donor-category-panel');
            if (onTrigger) { e.preventDefault(); _toggleCategoryDropdown(); return; }
            if (onPanel)   { setTimeout(_refreshCategoryDropdownLabel, 0); return; }
            if (els.wrap.classList.contains('open') && !els.wrap.contains(e.target)) _closeCategoryDropdown();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' || e.key === 'Esc') _closeCategoryDropdown();
        });
        _refreshCategoryDropdownLabel();
    }

    // ============================================================
    // 1b. Donor Wall — public acknowledgement of donors who have funded
    //     an SOS request or project. Renders into every .donor-wall-list
    //     on the page (Dashboard card + Donor Hub card share the markup).
    // ============================================================
    function _tsSeconds(ts) {
        return (ts && typeof ts.seconds === 'number') ? ts.seconds : 0;
    }

    function _donorWallContainers() {
        return document.querySelectorAll('.donor-wall-list');
    }

    function _renderDonorWallMessage(msg) {
        var html = '<div class="donor-empty" style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">' + _esc(msg) + '</div>';
        _donorWallContainers().forEach(function (c) { c.innerHTML = html; });
    }

    // ============================================================
    // 1c. Live "raised so far" totals for the Open Requests & Projects
    //     cards. Piggybacks on the SAME funded/completed
    //     sponsorship_proposals snapshot the donor wall above already
    //     holds open (see _watchDonorWall) -- one listener, no extra
    //     reads. Only money that has actually moved counts (status
    //     'funded' / 'completed', the same signal the wall and the Grant
    //     Transparency Portal ledger use); pledges still waiting on admin
    //     review are NOT included. Totals are kept per currency so an
    //     NGN sponsorship can never inflate a USD-denominated target.
    // ============================================================
    var _raisedByTarget = {};   // 'sos:abc123' -> { NGN: 500000, USD: 100 }
    var _raisedReady    = false; // false until the first successful snapshot -- bars stay hidden rather than showing a false "0"

    function _recomputeRaisedTotals(docs) {
        var totals = {};
        docs.forEach(function (d) {
            var p = (d && typeof d.data === 'function' ? d.data() : d) || {};
            if (!p.targetType || !p.targetId) return;
            // Same amount rule the donor wall uses (amountFunded, else the pledge).
            var amt = Number(p.amountFunded || p.pledgedAmount) || 0;
            if (amt <= 0) return;
            var key  = p.targetType + ':' + p.targetId;
            var cur  = p.currency || 'USD'; // matches _loadOpenTargets' own currency fallback
            var slot = totals[key] || (totals[key] = {});
            slot[cur] = (slot[cur] || 0) + amt;
        });
        _raisedByTarget = totals;
        _raisedReady = true;
        _applyRaisedToCards();
    }

    function _raisedFor(targetType, targetId, currency) {
        var slot = _raisedByTarget[targetType + ':' + targetId];
        return (slot && slot[currency || 'USD']) || 0;
    }

    // Markup only -- values are filled (and kept live) by _applyRaisedToCards().
    // Starts hidden (.is-pending) so a card never flashes an empty bar.
    function _raiseBlockHTML(t) {
        var needed = Number(t.amountNeeded) || 0;
        return '' +
            '<div class="dh-raise is-pending" data-target-type="' + _escAttr(t.targetType) + '" data-target-id="' + _escAttr(t.targetId) + '" ' +
                 'data-needed="' + needed + '" data-currency="' + _escAttr(t.currency) + '" data-raised="">' +
                '<div class="dh-raise-bar" role="progressbar" aria-label="Funding progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="dh-raise-fill"></span></div>' +
                '<div class="dh-raise-row">' +
                    '<span class="dh-raise-text"><strong class="dh-raise-val"></strong> raised</span>' +
                    '<span class="dh-raise-pct"></span>' +
                '</div>' +
            '</div>';
    }

    function _applyRaisedToCards() {
        if (!_raisedReady) return;
        document.querySelectorAll('.dh-raise').forEach(function (el) {
            var needed = Number(el.getAttribute('data-needed')) || 0;
            if (needed <= 0) return; // nothing to measure against -- leave hidden
            var cur     = el.getAttribute('data-currency') || 'USD';
            var raised  = _raisedFor(el.getAttribute('data-target-type'), el.getAttribute('data-target-id'), cur);
            var prevStr = el.getAttribute('data-raised');
            var prev    = prevStr === '' ? null : Number(prevStr);
            if (prev === raised) { el.classList.remove('is-pending'); return; }

            var pct    = Math.min(100, (raised / needed) * 100);
            var fill   = el.querySelector('.dh-raise-fill');
            var bar    = el.querySelector('.dh-raise-bar');
            var val    = el.querySelector('.dh-raise-val');
            var pctEl  = el.querySelector('.dh-raise-pct');
            if (fill)  fill.style.width = (raised > 0 ? Math.max(pct, 2) : 0) + '%';
            if (bar)   bar.setAttribute('aria-valuenow', String(Math.round(pct)));
            if (val)   val.textContent = cur + ' ' + _fmtAmount(raised);
            if (pctEl) pctEl.textContent = raised >= needed ? 'Fully funded' : (raised > 0 && pct < 1 ? '<1%' : Math.round(pct) + '%');
            el.classList.toggle('is-complete', raised >= needed);
            el.setAttribute('data-raised', String(raised));
            el.classList.remove('is-pending');

            // A live increase (not the first paint) gets a short nudge so a
            // sponsorship landing while someone is looking at the card is noticed.
            if (prev !== null && raised > prev) {
                el.classList.remove('is-bump');
                void el.offsetWidth; // restart the animation if it was already running
                el.classList.add('is-bump');
                setTimeout(function () { el.classList.remove('is-bump'); }, 1000);
            }
        });
    }

    // ---- Dashboard "Donors who made an impact" rich card helpers (2026-10-18) ----
    // Only the Dashboard card (#dashboard-donor-wall-card) gets the rich markup;
    // the Donor Hub's own wall keeps the original compact rows untouched.
    function _donorInitials(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    function _fmtAmountCompact(n) {
        n = Number(n) || 0;
        function t(v, suf) { return (Math.round(v * 10) / 10).toString().replace(/\.0$/, '') + suf; }
        if (n >= 1e9) return t(n / 1e9, 'B');
        if (n >= 1e6) return t(n / 1e6, 'M');
        if (n >= 1e4) return t(n / 1e3, 'K');
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    function _donorSkeletonHTML() {
        return '<div class="dw-skel" aria-hidden="true"></div><div class="dw-skel" aria-hidden="true"></div>';
    }
    function _isDashboardWall(c) {
        /* 2026-10-18 (Donor Hub redesign): the Donor Hub's own Donor Wall now gets the same rich, swipeable
           donor cards as the Dashboard (gold-ringed avatar, rank badge, amount) instead of the compact rows. */
        return !!(c && c.closest && c.closest('#dashboard-donor-wall-card, #donor-hub-donor-wall-card'));
    }
    // ---- Donor photos (2026-11-05) ----
    // A donor's picture lives on donor_profiles/{uid}.photoURL (written by the donor from their own card). The wall reads it
    // for every PUBLIC donor on the list; anonymous donors never show a photo. If the profile can't be read (rules, offline)
    // the card simply keeps the initials avatar.
    var _donorPhotoCache = {};   // donorId -> url ('' = none)
    var _donorPhotoAsked = {};   // donorId -> true once a read was started
    function _donorPhotoFor(p) { return (p && p.donorId && _donorPhotoCache[p.donorId]) || ''; }
    function _loadDonorPhotos(list) {
        var S = _state();
        if (!S.firebaseLoaded || !S.fbDb) return;
        var ids = [];
        (list || []).forEach(function (p) {
            if (p && p.donorId && p.donorDisplayPublicly !== false && !_donorPhotoAsked[p.donorId] && ids.indexOf(p.donorId) < 0) ids.push(p.donorId);
        });
        if (!ids.length) return;
        var changed = false, pending = ids.length;
        ids.forEach(function (id) {
            _donorPhotoAsked[id] = true;
            S.fbDb.collection('donor_profiles').doc(id).get().then(function (doc) {
                var u = doc.exists && doc.data() && doc.data().photoURL;
                if (typeof u === 'string' && /^https?:\/\//.test(u)) { _donorPhotoCache[id] = u; changed = true; }
            }).catch(function (err) {
                if (!err || err.code !== 'permission-denied') delete _donorPhotoAsked[id];
            }).then(function () {
                if (--pending === 0 && changed) renderDonorWall();
            });
        });
    }
    function _donorRichItemHTML(p, i) {
        var isPublic    = p.donorDisplayPublicly !== false;
        var displayName = isPublic ? (p.donorName || 'A generous supporter') : 'Anonymous Supporter';
        var amount      = p.amountFunded || p.pledgedAmount || 0;
        var initials    = isPublic ? _donorInitials(p.donorName) : '';
        var photo       = isPublic ? _donorPhotoFor(p) : '';
        var uid         = _authUid();
        var isOwn       = isPublic && !!uid && p.donorId === uid;
        var avatarInner = (initials ||
            '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>') +
            (photo ? '<img class="dw-photo" src="' + _escAttr(photo) + '" alt="' + _escAttr(displayName) + '" loading="lazy" decoding="async" onerror="this.remove()">' : '');
        var badgeHTML = isOwn
            ? '<button type="button" class="dw-cam" data-dw-photo data-name="' + _escAttr(p.donorName || '') + '" aria-label="Add or change your donor photo"><svg viewBox="0 0 24 24" fill="none" stroke="#081543" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg></button>'
            : '<span class="dw-tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';
        var rankCls     = i < 3 ? (' dw-rank-' + (i + 1)) : '';
        return '' +
            '<div class="donor-wall-item dw-rich' + rankCls + ((isOwn && !photo) ? ' dw-own-nophoto' : '') + '">' +
                '<span class="dw-badge">' + (i === 0 ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z"/></svg>TOP DONOR' : 'No. ' + (i + 1)) + '</span>' +
                '<div class="dw-ring-wrap"><div class="dw-ring"><div class="dw-ring-gap"><div class="donor-wall-avatar">' + avatarInner + '</div></div></div>' + badgeHTML + '</div>' +
                '<div class="donor-wall-info">' +
                    '<div class="donor-wall-name">' + _esc(displayName) + '</div>' +
                    '<div class="donor-wall-detail">Sponsored ' + _esc(p.targetLabel || 'a cause') + (((_donorGiftCounts[p.donorId] || 0) > 1) ? ' \u00b7 ' + _donorGiftCounts[p.donorId] + ' gifts' : '') + '</div>' +
                '</div>' +
                '<div class="donor-wall-amount">' + _esc(p.currency || '') + ' ' + _fmtAmountCompact(amount) + '</div>' +
                '<span class="dw-verified"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Verified giving</span>' +
            '</div>';
    }

    // ---- Donor photo upload sheet (opened from the camera badge on the donor's OWN card) ----
    function _dwPhotoCss() {
        if (document.getElementById('dw-photo-css')) return;
        var G = 'conic-gradient(from 200deg,#fbeaa0,#d4af37,#9a7208,#f6dd8a,#d4af37,#fbeaa0)';
        var st = document.createElement('style');
        st.id = 'dw-photo-css';
        st.textContent = [
            '#dw-photo-overlay{position:fixed;inset:0;z-index:2147482500;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,21,67,.58);-webkit-tap-highlight-color:transparent;}',
            '#dw-photo-overlay .dwp-sheet{position:relative;width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:#fff;border-top:4px solid #d4af37;border-radius:22px;padding:24px 22px 22px;box-shadow:0 24px 60px rgba(0,0,0,.4);font-family:inherit;}',
            '#dw-photo-overlay .dwp-x{position:absolute;top:10px;right:10px;width:40px;height:40px;border:0;border-radius:50%;background:#f3f0e6;color:#0a1a4a;display:flex;align-items:center;justify-content:center;cursor:pointer;}',
            '#dw-photo-overlay .dwp-title{font-family:Lora,Georgia,serif;font-weight:700;font-size:1.45rem;color:#1a2a8a;line-height:1.15;padding-right:40px;}',
            '#dw-photo-overlay .dwp-sub{font-size:.82rem;color:#5b6275;margin-top:6px;line-height:1.45;}',
            '#dw-photo-overlay .dwp-stage{margin-top:16px;background:#081543;border-radius:18px;padding:26px 16px 18px;display:flex;flex-direction:column;align-items:center;gap:16px;outline:1.5px dashed rgba(232,199,90,.7);outline-offset:-9px;}',
            '#dw-photo-overlay .dwp-wrap{position:relative;width:150px;height:150px;}',
            '#dw-photo-overlay .dwp-wrap:before{content:"";position:absolute;inset:-10px;border-radius:50%;border:1.5px dotted rgba(232,199,90,.75);}',
            '#dw-photo-overlay .dwp-ring{width:100%;height:100%;box-sizing:border-box;padding:5px;border-radius:50%;background:' + G + ';box-shadow:0 8px 22px rgba(0,0,0,.45);}',
            '#dw-photo-overlay .dwp-gap{width:100%;height:100%;box-sizing:border-box;padding:4px;border-radius:50%;background:#081543;}',
            '#dw-photo-overlay .dwp-av{position:relative;width:100%;height:100%;border-radius:50%;overflow:hidden;background:linear-gradient(145deg,#1d3a8f,#0a1a4a);color:#f3d774;display:flex;align-items:center;justify-content:center;font-family:Lora,Georgia,serif;font-weight:700;font-size:3rem;}',
            '#dw-photo-overlay .dwp-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
            '#dw-photo-overlay .dwp-drop{font-size:.8rem;color:#dfe5fb;text-align:center;}',
            '#dw-photo-overlay .dwp-btns{display:flex;gap:10px;margin-top:16px;}',
            '#dw-photo-overlay button.dwp-btn{flex:1;min-height:46px;border-radius:12px;font-size:.9rem;font-weight:800;cursor:pointer;font-family:inherit;}',
            '#dw-photo-overlay .dwp-gold{border:0;background:' + G + ';color:#081543;}',
            '#dw-photo-overlay .dwp-outline{background:#fff;border:1.5px solid #1a2a8a;color:#1a2a8a;}',
            '#dw-photo-overlay .dwp-save{width:100%;margin-top:10px;border:0;background:#0a1a4a;color:#fff;}',
            '#dw-photo-overlay .dwp-save[disabled]{opacity:.4;cursor:not-allowed;}',
            '#dw-photo-overlay .dwp-remove{display:block;width:100%;margin-top:6px;border:0;background:none;color:#a3261c;font-size:.82rem;font-weight:700;min-height:40px;cursor:pointer;font-family:inherit;}',
            '#dw-photo-overlay .dwp-hint{margin-top:8px;font-size:.74rem;color:#5b6275;line-height:1.5;}',
            '#dw-photo-overlay .dwp-status{min-height:18px;margin-top:8px;font-size:.8rem;font-weight:700;color:#1a2a8a;text-align:center;}',
            '#dw-photo-overlay .dwp-status.err{color:#a3261c;}'
        ].join('');
        document.head.appendChild(st);
    }
    function _dwCropSquare(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            function draw(src, w, h) {
                var side = Math.min(w, h), out = Math.min(side, 640);
                var c = document.createElement('canvas'); c.width = out; c.height = out;
                var ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
                c.toBlob(function (blob) {
                    URL.revokeObjectURL(url);
                    blob ? resolve(blob) : reject(new Error('Could not process that photo.'));
                }, 'image/jpeg', 0.88);
            }
            function viaImage() {
                var im = new Image();
                im.onload = function () { draw(im, im.naturalWidth, im.naturalHeight); };
                im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')); };
                im.src = url;
            }
            if (window.createImageBitmap) {
                createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bm) { draw(bm, bm.width, bm.height); }).catch(viaImage);
            } else { viaImage(); }
        });
    }
    function _openDonorPhotoModal(donorName) {
        var uid = _authUid();
        if (!uid) { _notify('Please sign in to add your donor photo.', 'info'); return; }
        var old = document.getElementById('dw-photo-overlay'); if (old) old.remove();
        _dwPhotoCss();
        var current = _donorPhotoCache[uid] || '';
        var initials = _donorInitials(donorName) || '';
        var pendingBlob = null, previewUrl = null, busy = false;
        var ov = document.createElement('div');
        ov.id = 'dw-photo-overlay';
        ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'dwp-title');
        ov.innerHTML =
            '<div class="dwp-sheet">' +
                '<button type="button" class="dwp-x" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '<div class="dwp-title" id="dwp-title">Your donor photo</div>' +
                '<div class="dwp-sub">Shown on the Donor Wall beside your name, so people can see who is saving lives.</div>' +
                '<div class="dwp-stage"><div class="dwp-wrap"><div class="dwp-ring"><div class="dwp-gap"><div class="dwp-av" id="dwp-av"></div></div></div></div>' +
                    '<div class="dwp-drop">Choose a photo or take one now</div></div>' +
                '<div class="dwp-btns"><button type="button" class="dwp-btn dwp-gold" data-act="pick">Upload photo</button><button type="button" class="dwp-btn dwp-outline" data-act="cam">Take photo</button></div>' +
                '<button type="button" class="dwp-btn dwp-save" data-act="save" disabled>Save photo</button>' +
                '<button type="button" class="dwp-remove" data-act="remove"' + (current ? '' : ' style="display:none"') + '>Remove my photo</button>' +
                '<div class="dwp-status" id="dwp-status" role="status"></div>' +
                '<div class="dwp-hint">Square or centred face works best. JPG or PNG. You can change it any time.</div>' +
                '<input type="file" accept="image/*" id="dwp-file" hidden><input type="file" accept="image/*" capture="user" id="dwp-cam" hidden>' +
            '</div>';
        document.body.appendChild(ov);
        var av = ov.querySelector('#dwp-av'), statusEl = ov.querySelector('#dwp-status'), saveBtn = ov.querySelector('.dwp-save');
        function paint(src) {
            av.innerHTML = '';
            av.appendChild(document.createTextNode(initials));
            if (src) { var im = document.createElement('img'); im.alt = ''; im.src = src; im.onerror = function () { im.remove(); }; av.appendChild(im); }
        }
        function say(msg, isErr) { statusEl.textContent = msg || ''; statusEl.className = 'dwp-status' + (isErr ? ' err' : ''); }
        function close() {
            if (busy) return;
            if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch (e) {} }
            document.removeEventListener('keydown', onKey);
            ov.remove();
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        paint(current);
        function onPicked(file) {
            if (!file) return;
            if (!/^image\//.test(file.type || '')) { say('Please choose an image file.', true); return; }
            if (file.size > 15 * 1024 * 1024) { say('That photo is too large. Please pick one under 15 MB.', true); return; }
            say('Preparing photo\u2026');
            _dwCropSquare(file).then(function (blob) {
                pendingBlob = blob;
                if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch (e) {} }
                previewUrl = URL.createObjectURL(blob);
                paint(previewUrl);
                saveBtn.disabled = false;
                say('Looks good. Tap Save photo.');
            }).catch(function (err) { say((err && err.message) || 'Could not read that photo.', true); });
        }
        ov.querySelector('#dwp-file').addEventListener('change', function (e) { onPicked(e.target.files && e.target.files[0]); e.target.value = ''; });
        ov.querySelector('#dwp-cam').addEventListener('change', function (e) { onPicked(e.target.files && e.target.files[0]); e.target.value = ''; });
        ov.addEventListener('click', function (e) {
            if (e.target === ov) { close(); return; }
            var btn = e.target.closest && e.target.closest('[data-act]'); if (!btn || busy) return;
            var act = btn.getAttribute('data-act');
            if (act === 'close') close();
            else if (act === 'pick') ov.querySelector('#dwp-file').click();
            else if (act === 'cam') ov.querySelector('#dwp-cam').click();
            else if (act === 'save') {
                if (!pendingBlob) return;
                if (typeof window.uploadToCloudinary !== 'function') { say('Uploads are not ready yet. Please try again in a moment.', true); return; }
                busy = true; saveBtn.disabled = true; say('Uploading\u2026 0%');
                window.uploadToCloudinary(pendingBlob, function (pct) { say('Uploading\u2026 ' + Math.round(pct || 0) + '%'); })
                    .then(function (url) {
                        return _ensureDonorProfileDoc({ photoURL: url }).then(function () { return url; });
                    })
                    .then(function (url) {
                        _donorPhotoCache[uid] = url; _donorPhotoAsked[uid] = true;
                        busy = false; renderDonorWall(); close();
                        _notify('Your donor photo is saved.', 'success');
                    })
                    .catch(function (err) {
                        busy = false; saveBtn.disabled = false;
                        say((err && err.message) ? err.message : 'Could not save your photo. Please try again.', true);
                    });
            } else if (act === 'remove') {
                busy = true; say('Removing\u2026');
                _ensureDonorProfileDoc({ photoURL: '' }).then(function () {
                    _donorPhotoCache[uid] = ''; busy = false; renderDonorWall(); close();
                    _notify('Your donor photo was removed.', 'info');
                }).catch(function (err) { busy = false; say((err && err.message) || 'Could not remove your photo.', true); });
            }
        });
    }
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest && e.target.closest('[data-dw-photo]');
        if (!b) return;
        e.preventDefault(); e.stopPropagation();
        _openDonorPhotoModal(b.getAttribute('data-name') || '');
    });

    function _dwApplyStats(isEmpty) {
        try {
            var card = document.getElementById('dashboard-donor-wall-card');
            if (!card) return;
            card.classList.toggle('dw-empty', !!isEmpty);
            var box = document.getElementById('dwStats');
            if (!box) return;
            function put(el, n) {
                if (!el) return;
                var t = Number(n || 0).toLocaleString();
                if (el.firstChild && el.firstChild.nodeType === 3) { if (el.firstChild.nodeValue !== t) el.firstChild.nodeValue = t; }
                else el.textContent = t;
            }
            put(document.getElementById('dwStatDonors'), _donorWallStats.donors);
            put(document.getElementById('dwStatCauses'), _donorWallStats.causes);
            box.hidden = !!isEmpty || !_donorWallStats.donors;
        } catch (e) { /* decoration only */ }
    }
    function _donorFoundingHTML() {
        return '<div class="dw-founding">' +
            '<div class="dw-found-slots" aria-hidden="true">' +
                '<i class="s s1"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg></i>' +
                '<i class="m"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z"/></svg></i>' +
                '<i class="s s3"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg></i>' +
            '</div>' +
            '<div class="dw-found-title">Be among our first donors</div>' +
            '<div class="dw-found-text">Every movement starts with a few people who believed early. Your name could be the first on this wall.</div>' +
            '<button type="button" class="dw-found-cta" onclick="if(typeof window.navigateTo===\'function\'){window.navigateTo(\'donor-hub\');}">Become a founding donor</button>' +
        '</div>';
    }
    function renderDonorWall() {
        var containers = _donorWallContainers();
        if (!containers.length) return;
        _dwApplyStats(!_donorWallCache.length);
        if (!_donorWallCache.length) {
            /* 2026-11-05: Dashboard card gets the "Founding circle" invitation (no goal, nothing that looks desperate);
               the Donor Hub keeps its original message. Original single call kept below, commented out per the no-deletion rule. */
            containers.forEach(function (c) {
                if (c.closest && c.closest('#dashboard-donor-wall-card')) c.innerHTML = _donorFoundingHTML();
                else c.innerHTML = '<div class="donor-empty" style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">' + _esc('Be the first to sponsor a cause and appear here!') + '</div>';
            });
            // _renderDonorWallMessage('Be the first to sponsor a cause and appear here!');
            return;
        }
        var html = _donorWallCache.map(function (p) {
            var isPublic     = p.donorDisplayPublicly !== false;
            var displayName  = isPublic ? (p.donorName || 'A generous supporter') : 'Anonymous Supporter';
            var amount       = p.amountFunded || p.pledgedAmount || 0;
            return '' +
                '<div class="donor-wall-item">' +
                    '<div class="donor-wall-avatar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5"/></svg></div>' +
                    '<div class="donor-wall-info">' +
                        '<div class="donor-wall-name">' + _esc(displayName) + '</div>' +
                        '<div class="donor-wall-detail">Sponsored ' + _esc(p.targetLabel || 'a cause') + '</div>' +
                    '</div>' +
                    '<div class="donor-wall-amount">' + _esc(p.currency || '') + ' ' + _fmtAmount(amount) + '</div>' +
                '</div>';
        }).join('');
        // Dashboard card: ranked by amount, rich markup. Hub card: original rows.
        var richHtml = null;
        containers.forEach(function (c) {
            if (_isDashboardWall(c)) {
                if (richHtml === null) {
                    richHtml = _donorWallCache.slice().sort(function (a, b) {
                        return (Number(b.amountFunded || b.pledgedAmount) || 0) - (Number(a.amountFunded || a.pledgedAmount) || 0);
                    }).map(_donorRichItemHTML).join('');
                }
                c.innerHTML = richHtml;
            } else {
                c.innerHTML = html;
            }
        });
        if (richHtml !== null) _loadDonorPhotos(_donorWallCache);
    }

    /* FIX (2026-10-18 — "Donors Who Made an Impact" stuck on "Loading…" on a slow connection):
       three ways the wall could sit on "Loading…" forever or show a WRONG message:
         (a) no Firebase Auth user yet -> _watchDonorWall() returns silently and nothing ever replaces the
             placeholder if sign-in is slow;
         (b) Firestore's first snapshot on a weak link can be an EMPTY answer served from the local cache
             (snap.metadata.fromCache) -> the wall wrongly said "Be the first to sponsor a cause";
         (c) the listener simply never answers on a very slow/offline connection.
       Now: a cache-only empty snapshot is ignored (keep waiting for the server), and if nothing real has
       arrived after 12s the placeholder becomes "Couldn't load donors yet" with a Try again button that re-runs
       the same listener. Normal fast path is unchanged. */
    var _donorWallGotData = false, _donorWallTimer = null;
    function _renderDonorWallRetry() {
        var html = '<div class="donor-empty donor-wall-retry-box" style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">' +
            'Our donors are taking a moment to load.<br>Check your connection and try again.<br>' +
            '<button type="button" class="donor-wall-retry" style="margin-top:10px;border:1.5px solid #d4af37;border-radius:999px;background:#0a1a4a;color:#f3d774;font-weight:800;font-size:0.8rem;padding:10px 20px;cursor:pointer;">Try again</button></div>';
        _donorWallContainers().forEach(function (c) { c.innerHTML = html; });
    }
    function _armDonorWallTimeout() {
        if (_donorWallTimer) clearTimeout(_donorWallTimer);
        _donorWallGotData = false;
        _donorWallTimer = setTimeout(function () {
            if (!_donorWallGotData) _renderDonorWallRetry();
        }, 12000);
    }
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.donor-wall-retry')) {
            _donorWallContainers().forEach(function (c) { c.innerHTML = _isDashboardWall(c) ? _donorSkeletonHTML() : '<div class="donor-empty" style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">Loading\u2026</div>'; });
            _watchDonorWall();
        }
    });

    function _watchDonorWall() {
        var S = _state();
        if (_unsubDonorWall) { _unsubDonorWall(); _unsubDonorWall = null; }
        _armDonorWallTimeout();
        if (!S.firebaseLoaded || !S.fbDb) return;
        // FIX (2026-08-13 — "[app-donors] donor wall listener error:
        // Missing or insufficient permissions" for real, signed-in
        // accounts too, not just genuinely signed-out visitors): this
        // only checked that Firestore itself was initialized, not that a
        // real Firebase Auth session (anonymous or signed-in) actually
        // existed yet — sponsorship_proposals requires request.auth !=
        // null (firebase-rules.js). Both of this function's call sites
        // fire once, at 'empyrean:firebase-ready'/app init, which can
        // land before the app's own anonymous-sign-in fallback or a real
        // login finishes — so the wall permanently showed the "Sign in
        // to see..." message even for accounts that WERE signed in, just
        // not yet by that exact instant. Now it waits for a real auth
        // uid and re-arms itself via onAuthStateChanged the first time
        // one appears, instead of failing once and never trying again.
        if (!window.fbAuth || !window.fbAuth.currentUser) {
            if (!_watchDonorWall._authRearmed && window.fbAuth && typeof window.fbAuth.onAuthStateChanged === 'function') {
                _watchDonorWall._authRearmed = true;
                window.fbAuth.onAuthStateChanged(function (fbUser) {
                    if (fbUser) _watchDonorWall();
                });
            }
            return;
        }

        _unsubDonorWall = S.fbDb.collection('sponsorship_proposals')
            .where('status', 'in', ['funded', 'completed'])
            .onSnapshot(function (snap) {
                // Empty answer served only from the local cache = "don't know yet", not "no donors" — keep waiting.
                if (snap.empty && snap.metadata && snap.metadata.fromCache) return;
                _donorWallGotData = true;
                if (_donorWallTimer) { clearTimeout(_donorWallTimer); _donorWallTimer = null; }
                try {
                    var _dSet = {}, _cSet = {}, _gc = {};
                    snap.docs.forEach(function (d) {
                        var q = d.data() || {};
                        var dk = q.donorId || q.donorName || '';
                        var ck = q.targetId || q.targetLabel || '';
                        if (dk) { _dSet[dk] = 1; _gc[dk] = (_gc[dk] || 0) + 1; }
                        if (ck) _cSet[ck] = 1;
                    });
                    _donorWallStats = { donors: Object.keys(_dSet).length, causes: Object.keys(_cSet).length };
                    _donorGiftCounts = _gc;
                } catch (eStat) { /* stats are decoration; never block the wall */ }
                _donorWallCache = snap.docs.map(function (d) { return d.data(); })
                    .sort(function (a, b) {
                        return _tsSeconds(b.fundedAt || b.decidedAt) - _tsSeconds(a.fundedAt || a.decidedAt);
                    })
                    .slice(0, 25);
                renderDonorWall();
                // Same snapshot also drives the live "raised" bars on the
                // Open Requests & Projects cards (see 1c). Isolated so a
                // problem here can never affect the wall render above.
                try { _recomputeRaisedTotals(snap.docs); }
                catch (eRaise) { console.warn('[app-donors] raised totals update failed:', eRaise && eRaise.message); }
            }, function (err) {
                console.warn('[app-donors] donor wall listener error:', err.message);
                _donorWallGotData = true;
                if (_donorWallTimer) { clearTimeout(_donorWallTimer); _donorWallTimer = null; }
                // Most likely a signed-out visitor and rules require auth (see
                // suggested rules at the top of this file) — fail quietly with
                // a friendly message rather than leaving "Loading…" forever.
                _renderDonorWallMessage('Sign in to see the donors who\u2019ve made an impact.');
            });
    }

    // ============================================================
    // 2. Open targets — SOS requests + projects available to sponsor
    // ============================================================
    // FIX (bug: "Open Requests & Projects" permanently empty): this used
    // to read window.mockAdminSosQueue, which is (a) only ever populated
    // when the CURRENT VIEWER is an admin (app-fixes.js gates the whole
    // Firestore load on `if (isAdmin)`), so a donor session never
    // populates it at all, and (b) even for an admin, only ever holds
    // items with status 'pending_approval' (that array is the admin's OWN
    // review queue) — never 'approved'. So this could never match, for
    // anyone. The admin-approval moderation step itself is NOT being
    // bypassed here — we're just reading the SAME signal
    // (sos_queue/{id}.status == 'approved') that app-sos.js's own public
    // feed listener (startSosListeners) already treats as "admin cleared
    // this, safe to show publicly." A request a donor hasn't approved yet
    // still never reaches this query.
    function _loadOpenTargets() {
        var S = _state();

        var sosPromise = (S.firebaseLoaded && S.fbDb)
            ? S.fbDb.collection('sos_queue').where('status', '==', 'approved').limit(50).get().then(function (snap) {
                return snap.docs.map(function (d) {
                    var r = d.data() || {};
                    if (!r.id) r.id = d.id;
                    return {
                        targetType: 'sos',
                        targetId: r.id,
                        label: r.title || r.category || 'SOS Request',
                        category: r.category || 'other',
                        region: r.region || r.location || '',
                        amountNeeded: r.amount || 0,
                        currency: r.currency || 'USD'
                    };
                });
            }).catch(function (err) {
                console.warn('[app-donors] approved sos_queue query failed:', err && err.message);
                return [];
            })
            : Promise.resolve([]);

        // Projects — admin-published only (projects/{id}.status == 'open').
        // Publishing itself IS the admin's approval step (write-rule is
        // isAdmin()-only), so no separate pending state is needed here.
        var projectsPromise = (S.firebaseLoaded && S.fbDb)
            ? S.fbDb.collection('projects').where('status', '==', 'open').get().then(function (snap) {
                return snap.docs.map(function (d) {
                    var v = d.data();
                    return {
                        targetType: 'project',
                        targetId: d.id,
                        label: v.title || 'Project',
                        category: v.category || 'other',
                        projectType: v.projectType || '',
                        region: v.region || '',
                        amountNeeded: v.budget || 0,
                        currency: v.currency || 'USD',
                        timeframe: v.timeframe || '',
                        media: Array.isArray(v.media) ? v.media : []
                    };
                });
            }).catch(function (err) {
                console.warn('[app-donors] open projects query failed:', err && err.message);
                return [];
            })
            : Promise.resolve([]);

        return Promise.all([sosPromise, projectsPromise]).then(function (results) {
            _openTargetsCache = results[0].concat(results[1]);
            return _openTargetsCache;
        });
    }

    /* FIX (bug: "deleting an SOS request from the admin control panel does
       not remove it from the public dashboard"): _loadOpenTargets() above
       is a ONE-TIME .get() with no live Firestore listener of its own, so
       once fetched, _openTargetsCache and whatever's already rendered into
       #donor-open-targets never learn about a deletion that happens
       elsewhere. app-sos.js's admin delete handlers (_handleDeleteSos /
       _handleDeleteApprovedSos) now dispatch this event right after their
       Firestore delete succeeds — prune the cache and, if the donor
       dashboard is currently showing this card, remove it live instead of
       leaving it visible until a full page reload happens to re-fetch. */
    document.addEventListener('empyrean:sos-deleted', function (e) {
        var id = e && e.detail && e.detail.id;
        if (!id) return;

        if (_openTargetsCache && _openTargetsCache.length) {
            _openTargetsCache = _openTargetsCache.filter(function (t) {
                return !(t.targetType === 'sos' && t.targetId === id);
            });
        }

        var container = document.getElementById('donor-open-targets');
        if (!container) return;
        var card = container.querySelector('.donor-target-card[data-target-type="sos"][data-target-id="' + id + '"]');
        if (!card) return;
        card.remove();
        if (!container.querySelector('.donor-target-card')) {
            container.innerHTML = '<div class="donor-empty">No open requests or projects right now.</div>';
        }
    });

    // Category → watermark icon (SVG path only, stroke/fill inherited) and
    // human label. Shared by the donor-facing thumbnail cards below and the
    // admin projects table. Kept intentionally small/inline (no image
    // assets) so cards render instantly with zero network requests.
    var _CATEGORY_ICONS = {
        medical:                   '<path d="M12 21s-7-4.35-9.5-8.5C.7 8.9 2.3 5 6 5c2 0 3.3 1 4 2.2C10.7 6 12 5 14 5c3.7 0 5.3 3.9 3.5 7.5C19 16.65 12 21 12 21Z"/>',
        tuition:                   '<path d="M22 10L12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
        business_support:          '<path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z"/><path d="M8 9V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/>',
        disaster_relief:           '<path d="M12 2 2 20h20L12 2Z"/><path d="M12 9v5M12 17h.01"/>',
        education:                 '<path d="M22 10L12 5 2 10l10 5 10-5ZM6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
        water_sanitation:          '<path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z"/>',
        shelter_housing:           '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
        food_security:             '<path d="M6 3v7a3 3 0 0 0 6 0V3M9 10v11M17 3c-2 1-2 5 0 6v9"/>',
        healthcare_infrastructure: '<path d="M4 21V9l8-6 8 6v12"/><path d="M10 21v-6h4v6"/>',
        women_empowerment:         '<circle cx="12" cy="8" r="5"/><path d="M12 13v8M8.5 18h7"/>',
        youth_development:         '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        environment:               '<path d="M12 22c5-3 8-7 8-12A8 8 0 0 0 4 10c0 5 3 9 8 12Z"/>',
        other:                     '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
    };
    var _PROJECT_TYPE_LABELS = {
        one_time:               'One-Time Project',
        ongoing_program:        'Ongoing Program',
        grant_disbursement:     'Grant Disbursement',
        capital_infrastructure: 'Capital / Infrastructure',
        emergency_appeal:       'Emergency Appeal',
        recurring_initiative:   'Recurring Initiative'
    };
    function _categoryIconPath(category) { return _CATEGORY_ICONS[category] || _CATEGORY_ICONS.other; }
    function _categoryLabel(category) {
        return (category || 'other').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    function _projectTypeLabel(projectType) { return _PROJECT_TYPE_LABELS[projectType] || ''; }

    /* DASHBOARD PROJECTS RAIL (2026-11-05): admin-published projects (projects/{id}.status == 'open') are shown on the public
       dashboard too, as a horizontal rail, via a live listener -- so a newly published (or closed) project appears/disappears
       for everyone without a reload. Reuses the donor-hub card markup/helpers; "Sponsor this" is handled by the existing
       click delegation (it already requires login + an approved donor profile). */
    var _unsubDashProjects = null;

    function _renderDashboardProjects(list) {
        var card = document.getElementById('dashboard-projects-card');
        var rail = document.getElementById('dashboard-projects-rail');
        if (!card || !rail) return;
        if (!list.length) { card.style.display = 'none'; rail.innerHTML = ''; return; }

        var countEl = document.getElementById('dashboard-projects-count');
        if (countEl) countEl.textContent = String(list.length);

        var _svg = function (d, w) { return '<svg viewBox="0 0 24 24" width="' + (w || 14) + '" height="' + (w || 14) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
        var ICON_PIN   = '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>';
        var ICON_CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
        var ICON_CHECK = '<path d="M12 3l2.4 1.8 3-.2 1 2.8 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-1 2.8-3-.2L12 21l-2.4-1.8-3 .2-1-2.8-2.5-1.7.9-2.9-.9-2.9 2.5-1.7 1-2.8 3 .2L12 3Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>';
        var ICON_ARROW = '<path d="M7 17 17 7M9 7h8v8"/>';

        rail.innerHTML = list.map(function (t, idx) {
            var typeLabel = _projectTypeLabel(t.projectType) || 'Project';
            var iconPath  = _categoryIconPath(t.category);
            var m = t.media && t.media[0];
            var cover;
            if (m && m.url) {
                cover = (m.type === 'video'
                    ? '<video class="dpr-cover-media" src="' + _escAttr(m.url) + '" controls playsinline preload="metadata"></video>'
                    : '<img class="dpr-cover-media" src="' + _escAttr(m.url) + '" alt="' + _escAttr(t.label) + '" loading="lazy">');
            } else {
                cover = '<svg class="dpr-cover-art" viewBox="0 0 382 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
                    '<g transform="translate(300 54)" fill="none" stroke="#C9A66B"><circle r="130" stroke-width=".8" opacity=".2"/><circle r="100" stroke-width="5" stroke-dasharray=".8 7.4" opacity=".34"/><circle r="70" stroke-width=".8" opacity=".26"/><circle r="40" stroke-width=".8" opacity=".32"/></g>' +
                    '<path d="M0 150 C95 118 190 172 382 124 L382 200 L0 200Z" fill="#1B2B8B" opacity=".55"/>' +
                    '<path d="M0 172 C105 146 220 192 382 150 L382 200 L0 200Z" fill="#2563EB" opacity=".32"/>' +
                    '<g transform="translate(22 128) scale(2.2)" fill="none" stroke="#F3DFA8" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + iconPath + '</g></svg>';
            }
            var moreMedia = (t.media && t.media.length > 1) ? '<span class="dpr-media-count">1 / ' + t.media.length + '</span>' : '';
            return '' +
                '<article class="donor-target-card dpr-card" data-target-type="project" data-target-id="' + _escAttr(t.targetId) + '" style="animation-delay:' + Math.min(idx, 6) * 70 + 'ms">' +
                    '<div class="dpr-cover">' + cover +
                        '<span class="dpr-chip">' + _esc(_categoryLabel(t.category)) + '</span>' + moreMedia +
                    '</div>' +
                    '<div class="dpr-panel">' +
                        '<div class="dpr-source">' + _svg(ICON_CHECK, 13) + '<span>Empyrean &middot; Verified project</span></div>' +
                        '<h4 class="dpr-title">' + _esc(t.label) + '</h4>' +
                        '<div class="dpr-meta">' +
                            '<span>' + _esc(typeLabel) + '</span>' +
                            (t.region ? '<span>' + _svg(ICON_PIN, 12) + _esc(t.region) + '</span>' : '') +
                            (t.timeframe ? '<span>' + _svg(ICON_CLOCK, 12) + _esc(t.timeframe) + '</span>' : '') +
                        '</div>' +
                        _raiseBlockHTML(t) +
                        '<div class="dpr-foot">' +
                            '<div class="dpr-need">Goal<strong>' + _esc(t.currency) + ' ' + _fmtAmount(t.amountNeeded) + '</strong></div>' +
                            '<button type="button" class="sponsor-now-btn dpr-cta" ' +
                                'data-target-type="project" ' +
                                'data-target-id="' + _escAttr(t.targetId) + '" ' +
                                'data-target-label="' + _escAttr(t.label) + '" ' +
                                'data-amount-needed="' + t.amountNeeded + '" ' +
                                'data-currency="' + _escAttr(t.currency) + '">' +
                                '<span>Sponsor this project</span><i class="dpr-cta-dot">' + _svg(ICON_ARROW, 16) + '</i>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</article>';
        }).join('');
        card.style.display = '';
        _applyRaisedToCards();
    }

    function _watchDashboardProjects() {
        if (_unsubDashProjects) return; // already listening
        var S = _state();
        if (!S.firebaseLoaded || !S.fbDb) return; // retried by the 1.5s poll in _bindAuthHook / 'empyrean:firebase-ready'
        try {
            _unsubDashProjects = S.fbDb.collection('projects')
                .where('status', '==', 'open')
                .onSnapshot(function (snap) {
                    var list = snap.docs.map(function (d) {
                        var v = d.data() || {};
                        return {
                            targetType: 'project',
                            targetId: d.id,
                            label: v.title || 'Project',
                            category: v.category || 'other',
                            projectType: v.projectType || '',
                            region: v.region || '',
                            amountNeeded: v.budget || 0,
                            currency: v.currency || 'USD',
                            timeframe: v.timeframe || '',
                            media: Array.isArray(v.media) ? v.media : [],
                            _t: (v.createdAt && typeof v.createdAt.toMillis === 'function') ? v.createdAt.toMillis() : Date.now()
                        };
                    }).sort(function (a, b) { return b._t - a._t; }); // newest first
                    _renderDashboardProjects(list);
                }, function (err) {
                    console.warn('[app-donors] dashboard projects listener error:', err && err.message);
                    _unsubDashProjects = null; // allow the poll to retry (e.g. once auth is ready)
                });
        } catch (e) { _unsubDashProjects = null; }
    }

    function renderSponsorTargets(containerId) {
        var container = document.getElementById(containerId || 'donor-open-targets');
        if (!container) return;
        container.innerHTML = '<div class="donor-loading">Loading open requests and projects…</div>';

        _loadOpenTargets().then(function (targets) {
            if (!targets.length) {
                container.innerHTML = '<div class="donor-empty">No open requests or projects right now.</div>';
                return;
            }
            container.innerHTML = targets.map(function (t) {
                var isSos      = t.targetType === 'sos';
                var thumbBg    = isSos ? 'linear-gradient(135deg, #7C2D12, #EF4444 70%)' : 'linear-gradient(135deg, #0A0E27, #1B2B8B 70%)';
                var thumbLabel = isSos ? 'Urgent SOS Request' : (_projectTypeLabel(t.projectType) || 'Project');
                var iconPath   = _categoryIconPath(t.category);
                return '' +
                    '<div class="donor-target-card" data-target-type="' + t.targetType + '" data-target-id="' + t.targetId + '">' +
                        _targetMediaHTML(t) +
                        '<div class="dh-target-thumb" style="--dh-thumb-bg:' + thumbBg + ';">' +
                            '<svg class="dh-watermark" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPath + '</svg>' +
                            '<span class="dh-target-thumb-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPath + '</svg>' + _esc(thumbLabel) + '</span>' +
                        '</div>' +
                        '<div class="dh-target-body">' +
                            '<div class="donor-target-label">' + _esc(t.label) + '</div>' +
                            '<div class="donor-target-meta">' +
                                '<span class="dh-pill">' + _esc(_categoryLabel(t.category)) + '</span>' +
                                (t.region ? '<span class="dh-pill"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>' + _esc(t.region) + '</span>' : '') +
                                (t.timeframe ? '<span class="dh-pill"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>' + _esc(t.timeframe) + '</span>' : '') +
                            '</div>' +
                            _raiseBlockHTML(t) +
                            '<div class="dh-target-footer">' +
                                '<div class="donor-target-amount">Amount needed<strong>' + _esc(t.currency) + ' ' + _fmtAmount(t.amountNeeded) + '</strong></div>' +
                                '<button type="button" class="sponsor-now-btn" ' +
                                    'data-target-type="' + t.targetType + '" ' +
                                    'data-target-id="' + t.targetId + '" ' +
                                    'data-target-label="' + _escAttr(t.label) + '" ' +
                                    'data-amount-needed="' + t.amountNeeded + '" ' +
                                    'data-currency="' + t.currency + '">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 8.6c0 4.4-8.8 10.4-8.8 10.4S3.2 13 3.2 8.6a4.6 4.6 0 0 1 8.4-2.6 4.6 4.6 0 0 1 8.4 2.6Z"/></svg>' +
                                    'Sponsor this' +
                                '</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            }).join('');
            _applyRaisedToCards(); // fill bars from whatever totals have already arrived
        });
    }

    // ============================================================
    // 3. Matching — simple filter, not an automated engine (v1 scope)
    // ============================================================
    function getMatchedOpportunitiesForDonor() {
        var profile = _donorProfileCache;
        if (!profile) return Promise.resolve([]);
        return _loadOpenTargets().then(function (targets) {
            var cats    = profile.preferredCategories || [];
            var regions = profile.preferredRegions || [];
            if (!cats.length && !regions.length) return targets;
            return targets.filter(function (t) {
                var catMatch    = !cats.length    || cats.indexOf(t.category) !== -1;
                var regionMatch = !regions.length || regions.indexOf(t.region) !== -1;
                return catMatch && regionMatch;
            });
        });
    }

    // ============================================================
    // 4. Proposal submission
    // ============================================================
    function openProposalModal(targetType, targetId, targetLabel, amountNeeded, currency) {
        if (!_requireLogin()) return;

        if (!_donorProfileCache) {
            _notify('Please complete your donor profile before submitting a proposal.', 'info');
            if (typeof window.navigateTo === 'function') window.navigateTo('donor-registration');
            return;
        }
        var approvalStatus = _donorApprovalStatus();
        if (approvalStatus !== 'approved') {
            _notify(approvalStatus === 'rejected'
                ? 'Your donor profile was not approved, so proposals are unavailable. Please contact support.'
                : 'Your donor profile is pending admin approval. You can submit proposals once it\u2019s approved.', 'info');
            return;
        }

        var modal = document.getElementById('sponsorship-proposal-modal');
        if (!modal) { console.warn('[app-donors] #sponsorship-proposal-modal not found in DOM.'); return; }

        modal.querySelector('[name="proposal-target-type"]').value  = targetType;
        modal.querySelector('[name="proposal-target-id"]').value    = targetId;
        var labelEl = modal.querySelector('.proposal-target-label');
        if (labelEl) labelEl.textContent = targetLabel || '';
        var amountEl = modal.querySelector('[name="proposal-amount"]');
        if (amountEl) amountEl.placeholder = 'Up to ' + (currency || 'USD') + ' ' + _fmtAmount(amountNeeded || 0);

        modal.style.display = 'flex';
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }

    function _closeProposalModal() {
        var modal = document.getElementById('sponsorship-proposal-modal');
        if (!modal) return;
        modal.style.display = 'none';
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }

    function _submitProposalForm(form) {
        if (!_requireLogin()) return;
        var S = _state();
        if (!_donorProfileCache) {
            _notify('Please complete your donor profile before submitting a proposal.', 'info');
            if (typeof window.navigateTo === 'function') window.navigateTo('donor-registration');
            return;
        }
        var approvalStatus = _donorApprovalStatus();
        if (approvalStatus !== 'approved') {
            _notify(approvalStatus === 'rejected'
                ? 'Your donor profile was not approved, so proposals are unavailable. Please contact support.'
                : 'Your donor profile is pending admin approval. You can submit proposals once it\u2019s approved.', 'info');
            return;
        }

        var targetType    = (form.querySelector('[name="proposal-target-type"]') || {}).value;
        var targetId      = (form.querySelector('[name="proposal-target-id"]')   || {}).value;
        var pledgedAmount = parseFloat((form.querySelector('[name="proposal-amount"]') || {}).value);
        var currency      = (form.querySelector('[name="proposal-currency"]') || {}).value || 'USD';
        var notes         = (form.querySelector('[name="proposal-notes"]')    || {}).value || '';
        var targetLabel   = (form.querySelector('.proposal-target-label')     || {}).textContent || '';

        if (!targetType || !targetId) { _notify('No target selected for this proposal.', 'error'); return; }
        if (!pledgedAmount || pledgedAmount <= 0) { _notify('Please enter a valid pledge amount.', 'error'); return; }

        var submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.origText = submitBtn.innerHTML; submitBtn.innerHTML = 'Submitting…'; }

        if (!S.firebaseLoaded || !S.fbDb) {
            _notify('Not connected to the database — proposal not saved.', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtn.dataset.origText; }
            return;
        }

        var docRef = S.fbDb.collection('sponsorship_proposals').doc();
        docRef.set({
            id: docRef.id,
            donorId: S.uid,
            donorName: _donorProfileCache.orgName || _donorProfileCache.name || 'Anonymous Donor',
            donorDisplayPublicly: _donorProfileCache.displayPublicly !== false,
            targetType: targetType,
            targetId: targetId,
            targetLabel: targetLabel,
            pledgedAmount: pledgedAmount,
            currency: currency,
            notes: notes.trim(),
            status: 'pending',
            amountFunded: 0,
            createdAt: _serverTimestamp()
        }).then(function () {
            _notify('Proposal submitted — an admin will review it shortly.', 'success');
            form.reset();
            _closeProposalModal();
        }).catch(function (err) {
            _notify('Could not submit proposal: ' + (err && err.message ? err.message : 'please try again.'), 'error');
        }).finally(function () {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtn.dataset.origText || 'Submit Proposal'; }
        });
    }

    // ============================================================
    // 5. Donor's own proposals — live listener + render
    // ============================================================
    function _watchMyProposals() {
        var S = _state();
        if (_unsubMyProposals) { _unsubMyProposals(); _unsubMyProposals = null; }
        if (!S.firebaseLoaded || !S.fbDb || !S.uid) return;

        _unsubMyProposals = S.fbDb.collection('sponsorship_proposals')
            .where('donorId', '==', S.uid)
            .onSnapshot(function (snap) {
                _myProposalsCache = snap.docs.map(function (d) { return d.data(); });
                renderMyProposals();
            }, function (err) {
                console.warn('[app-donors] sponsorship_proposals (mine) listener error:', err.message);
            });
    }

    function renderMyProposals(containerId) {
        var container = document.getElementById(containerId || 'donor-my-proposals');
        if (!container) return;
        if (!_myProposalsCache.length) {
            container.innerHTML = '<div class="donor-empty">You have not submitted any sponsorship proposals yet.</div>';
            return;
        }
        container.innerHTML = _myProposalsCache
            .slice()
            .sort(function (a, b) { return (b.createdAt && b.createdAt.seconds || 0) - (a.createdAt && a.createdAt.seconds || 0); })
            .map(function (p) {
                var canFund = p.status === 'approved';
                return '' +
                    '<div class="donor-proposal-row" data-id="' + p.id + '">' +
                        '<div class="donor-proposal-label">' + _esc(p.targetLabel) + '</div>' +
                        '<div class="donor-proposal-amount">' + _esc(p.currency) + ' ' + _fmtAmount(p.pledgedAmount) + '</div>' +
                        '<div class="donor-proposal-status status-' + _esc(p.status) + '">' + _esc(p.status) + '</div>' +
                        (canFund ? '<button type="button" class="fund-proposal-btn" data-id="' + p.id + '">Fund Now</button>' : '') +
                    '</div>';
            }).join('');
    }

    // ============================================================
    // 5b. Admin queue — pending DONOR PROFILE approvals. Donors sit
    //     here first; only once approved can they reach the
    //     sponsorship-proposal queue below (enforced in
    //     openProposalModal / _submitProposalForm above).
    // ============================================================
    function _watchDonorApprovalQueue() {
        var S = _state();
        if (_unsubDonorApprovalQueue) { _unsubDonorApprovalQueue(); _unsubDonorApprovalQueue = null; }
        if (!S.isAdmin || !S.firebaseLoaded || !S.fbDb) return;

        _unsubDonorApprovalQueue = S.fbDb.collection('donor_profiles')
            .where('approvalStatus', '==', 'pending')
            .onSnapshot(function (snap) {
                _donorApprovalQueueCache = snap.docs.map(function (d) { return d.data(); });
                renderDonorApprovalQueue();
                var stat = document.getElementById('admin-stat-donor-approvals');
                if (stat) stat.textContent = _donorApprovalQueueCache.length;
            }, function (err) {
                console.warn('[app-donors] donor approval queue listener error:', err.message);
            });
    }

    function renderDonorApprovalQueue() {
        var container = document.getElementById('admin-donor-approvals-list');
        if (!container) return;
        if (!_donorApprovalQueueCache.length) {
            container.innerHTML = '<div class="admin-queue-empty">No donor profiles awaiting approval.</div>';
            return;
        }
        container.innerHTML = _donorApprovalQueueCache.map(function (p) {
            var interests = (p.preferredCategories || []).join(', ');
            return '' +
                '<div class="admin-queue-item admin-donor-approval-item" data-uid="' + _escAttr(p.uid) + '">' +
                    '<div class="admin-queue-donor">' + _esc(p.orgName || p.name || 'Unnamed donor') + '</div>' +
                    '<div class="admin-queue-target">' + _esc(p.donorType || 'individual') + (p.email ? ' \u00b7 ' + _esc(p.email) : '') + '</div>' +
                    (interests ? '<div class="admin-queue-notes">Interests: ' + _esc(interests) + '</div>' : '') +
                    '<div class="admin-queue-actions">' +
                        '<button type="button" class="approve-donor-btn">Approve</button>' +
                        '<button type="button" class="reject-donor-btn">Reject</button>' +
                    '</div>' +
                '</div>';
        }).join('');
    }

    function _decideDonorApproval(uid, newStatus) {
        var S = _state();
        if (!S.fbDb || !uid) return;
        var p = _donorApprovalQueueCache.find(function (i) { return i.uid === uid; });
        S.fbDb.collection('donor_profiles').doc(uid).update({
            approvalStatus: newStatus,
            verified: newStatus === 'approved',
            decidedAt: _serverTimestamp(),
            decidedBy: S.uid
        }).then(function () {
            _notifyUser(uid, newStatus === 'approved'
                ? 'Your donor profile has been approved. You can now submit sponsorship proposals.'
                : 'Your donor profile was not approved. Please contact support for details.',
                newStatus === 'approved' ? 'success' : 'info');
            _notify('Donor profile ' + newStatus + '.', 'success');
            if (typeof window.logAdminAction === 'function') {
                window.logAdminAction(
                    newStatus === 'approved' ? 'APPROVE_DONOR' : 'REJECT_DONOR',
                    (p && (p.orgName || p.name)) || uid,
                    'Donor profile ' + newStatus
                );
            }
        }).catch(function (err) {
            _notify('Could not update donor profile: ' + (err && err.message ? err.message : 'please try again.'), 'error');
        });
    }

    // ============================================================
    // 6. Admin queue — pending proposals, approve/reject
    // ============================================================
    function _watchAdminQueue() {
        var S = _state();
        if (_unsubAdminQueue) { _unsubAdminQueue(); _unsubAdminQueue = null; }
        if (!S.isAdmin || !S.firebaseLoaded || !S.fbDb) return;

        _unsubAdminQueue = S.fbDb.collection('sponsorship_proposals')
            .where('status', '==', 'pending')
            .onSnapshot(function (snap) {
                _adminQueueCache = snap.docs.map(function (d) { return d.data(); });
                renderDonorAdminQueue();
                var stat = document.getElementById('admin-stat-proposals');
                if (stat) stat.textContent = _adminQueueCache.length;
            }, function (err) {
                console.warn('[app-donors] admin queue listener error:', err.message);
            });
    }

    function renderDonorAdminQueue() {
        var container = document.getElementById('admin-donor-proposals-list');
        if (!container) return;
        if (!_adminQueueCache.length) {
            container.innerHTML = '<div class="admin-queue-empty">No pending sponsorship proposals.</div>';
            return;
        }
        container.innerHTML = _adminQueueCache.map(function (p) {
            return '' +
                '<div class="admin-queue-item" data-id="' + p.id + '">' +
                    '<div class="admin-queue-donor">' + _esc(p.donorName) + '</div>' +
                    '<div class="admin-queue-target">' + _esc(p.targetLabel) + ' (' + _esc(p.targetType) + ')</div>' +
                    '<div class="admin-queue-amount">' + _esc(p.currency) + ' ' + _fmtAmount(p.pledgedAmount) + '</div>' +
                    (p.notes ? '<div class="admin-queue-notes">' + _esc(p.notes) + '</div>' : '') +
                    '<div class="admin-queue-actions">' +
                        '<button type="button" class="approve-proposal-btn">Approve</button>' +
                        '<button type="button" class="reject-proposal-btn">Reject</button>' +
                    '</div>' +
                '</div>';
        }).join('');
    }

    function _decideProposal(id, newStatus) {
        var S = _state();
        if (!S.fbDb) return;
        S.fbDb.collection('sponsorship_proposals').doc(id).update({
            status: newStatus,
            decidedAt: _serverTimestamp(),
            decidedBy: S.uid
        }).then(function () {
            var p = _adminQueueCache.find(function (i) { return i.id === id; });
            if (p) {
                _notifyUser(p.donorId, 'Your sponsorship proposal for "' + p.targetLabel + '" was ' + newStatus + '.', newStatus === 'approved' ? 'success' : 'info');
            }
            _notify('Proposal ' + newStatus + '.', 'success');
            if (typeof window.logAdminAction === 'function') {
                window.logAdminAction(
                    newStatus === 'approved' ? 'APPROVE_PROPOSAL' : 'REJECT_PROPOSAL',
                    (p && p.donorName) || id,
                    'Sponsorship proposal ' + newStatus + (p ? ' for "' + p.targetLabel + '"' : '')
                );
            }
        }).catch(function (err) {
            _notify('Could not update proposal: ' + (err && err.message ? err.message : 'please try again.'), 'error');
        });
    }

    // The "Sponsorship Proposals" card lives as static markup inside
    // #admin-queues-tab (same tab as the SOS queue and withdrawal queue),
    // so there's no injection step — just start the listener.
    function _wireAdminQueue() {
        _watchAdminQueue();
        _watchDonorApprovalQueue();
        _watchAllDonorsForDashboard();
        _watchAllProposalsForDashboard();
        _watchDonorMessageThreads();
        _watchAdminProjects();
    }

    // ============================================================
    // 6a2. Admin — Project Publication (new)
    // ------------------------------------------------------------
    // Publishing a project IS the admin's approval step: only an admin
    // can write to `projects` (see firestore.rules), so there is no
    // separate pending/approve stage the way SOS requests have — filling
    // out and submitting this form is what makes a project appear in
    // donors' "Open Requests & Projects" (_loadOpenTargets reads
    // projects/{id}.status == 'open').
    // ============================================================
    var _unsubAdminProjects = null;
    var _adminProjectsCache = [];

    function _publishProjectForm(form) {
        var S = _state();
        if (!S.isAdmin) { _notify('Only admins can publish projects.', 'error'); return; }
        if (!S.firebaseLoaded || !S.fbDb) { _notify('Not connected to the database — project not saved.', 'error'); return; }

        var title      = (form.querySelector('[name="project-title"]')       || {}).value || '';
        var projectType= (form.querySelector('[name="project-type"]')        || {}).value || 'one_time';
        var category   = (form.querySelector('[name="project-category"]')    || {}).value || 'other';
        var region     = (form.querySelector('[name="project-region"]')      || {}).value || '';
        var budget     = parseFloat((form.querySelector('[name="project-budget"]')   || {}).value);
        var currency   = (form.querySelector('[name="project-currency"]')    || {}).value || 'USD';
        var timeframe  = (form.querySelector('[name="project-timeframe"]')   || {}).value || '';
        var monitoring = (form.querySelector('[name="project-monitoring"]')  || {}).value || '';
        var objectives = (form.querySelector('[name="project-objectives"]')  || {}).value || '';
        var description= (form.querySelector('[name="project-description"]')|| {}).value || '';

        if (!title.trim()) { _notify('Please enter a project title.', 'error'); return; }
        if (!budget || budget <= 0) { _notify('Please enter a valid budget.', 'error'); return; }

        var submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.origText = submitBtn.innerHTML; submitBtn.innerHTML = 'Publishing…'; }

        /* 2026-11-05: OPTIONAL media. No files chosen = exactly the old behaviour. Files are uploaded first, then their
           URLs are saved on the project as media:[{url,type}]. If an upload fails the project is still published (without
           that file) and the admin is told, so a flaky connection never blocks publishing. */
        var mediaInput = form.querySelector('[name="project-media"]');
        var chosen = mediaInput && mediaInput.files ? Array.prototype.slice.call(mediaInput.files, 0, 6) : [];
        if (mediaInput && mediaInput.files && mediaInput.files.length > 6) _notify('Only the first 6 files will be used.', 'info');

        var uploadP;
        if (chosen.length && typeof window.uploadMediaFilesToCloudinary === 'function') {
            if (submitBtn) submitBtn.innerHTML = 'Uploading media…';
            uploadP = window.uploadMediaFilesToCloudinary(chosen, function (idx, pct) {
                if (submitBtn) submitBtn.innerHTML = 'Uploading ' + (idx + 1) + '/' + chosen.length + ' · ' + pct + '%';
            }).catch(function () { return []; });
        } else {
            uploadP = Promise.resolve([]);
        }

        uploadP.then(function (urls) {
            var media = [];
            (urls || []).forEach(function (u, i) {
                if (!u || typeof u !== 'string') return;
                var f = chosen[i];
                media.push({ url: u, type: (f && f.type && f.type.indexOf('video') === 0) ? 'video' : 'image' });
            });
            if (chosen.length && media.length < chosen.length) {
                _notify((chosen.length - media.length) + ' file(s) could not be uploaded; publishing without ' + (media.length ? 'them' : 'media') + '.', 'warning');
            }
            if (submitBtn) submitBtn.innerHTML = 'Publishing…';
            var docRef = S.fbDb.collection('projects').doc();
            var data = {
                id: docRef.id,
                title: title.trim(),
                projectType: projectType,
                category: category,
                region: region.trim(),
                budget: budget,
                currency: currency,
                timeframe: timeframe.trim(),
                monitoringModalities: monitoring.trim(),
                objectives: objectives.trim(),
                description: description.trim(),
                status: 'open',
                createdBy: S.uid,
                createdAt: _serverTimestamp()
            };
            if (media.length) data.media = media; // only written when there is media
            return docRef.set(data);
        }).then(function () {
            _notify('Project published — donors can now find it under Open Requests & Projects.', 'success');
            form.reset();
            var pv = document.getElementById('project-media-preview'); if (pv) pv.innerHTML = '';
            if (typeof window.logAdminAction === 'function') {
                window.logAdminAction('PUBLISH_PROJECT', title.trim(), 'Published project "' + title.trim() + '" for donor sponsorship');
            }
        }).catch(function (err) {
            _notify('Could not publish project: ' + (err && err.message ? err.message : 'please try again.'), 'error');
        }).finally(function () {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtn.dataset.origText || 'Publish Project'; }
        });
    }

    /* local preview of chosen media in the publish form (nothing is uploaded until Publish) */
    function _bindProjectMediaPreview() {
        document.addEventListener('change', function (e) {
            var inp = e.target;
            if (!inp || inp.id !== 'project-media-input') return;
            var box = document.getElementById('project-media-preview');
            if (!box) return;
            box.innerHTML = '';
            Array.prototype.slice.call(inp.files || [], 0, 6).forEach(function (f) {
                var url = URL.createObjectURL(f);
                var isVid = f.type && f.type.indexOf('video') === 0;
                var el = document.createElement(isVid ? 'video' : 'img');
                el.src = url; el.muted = true;
                el.style.cssText = 'width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid rgba(10,14,39,0.1);';
                box.appendChild(el);
            });
        });
    }

    /* media cover for a project card (donor list); returns '' when the project has no media, so cards look as before */
    function _targetMediaHTML(t) {
        var m = t && t.media && t.media[0];
        if (!m || !m.url) return '';
        var more = t.media.length > 1 ? '<span style="position:absolute;right:8px;bottom:8px;background:rgba(10,14,39,0.7);color:#fff;font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:10px;">+' + (t.media.length - 1) + '</span>' : '';
        var inner = m.type === 'video'
            ? '<video src="' + _escAttr(m.url) + '" controls playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;background:#000;"></video>'
            : '<img src="' + _escAttr(m.url) + '" alt="' + _escAttr(t.label) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;">';
        return '<div class="dh-target-media" style="position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:#eef0f7;">' + inner + (m.type === 'video' ? '' : more) + '</div>';
    }

    function _closeProject(id) {
        var S = _state();
        if (!S.fbDb || !id) return;
        S.fbDb.collection('projects').doc(id).update({ status: 'closed', closedAt: _serverTimestamp() })
            .then(function () { _notify('Project closed — no longer shown to donors.', 'success'); })
            .catch(function (err) { _notify('Could not close project: ' + (err && err.message ? err.message : 'please try again.'), 'error'); });
    }

    function _watchAdminProjects() {
        var S = _state();
        if (_unsubAdminProjects) { _unsubAdminProjects(); _unsubAdminProjects = null; }
        if (!S.isAdmin || !S.firebaseLoaded || !S.fbDb) return;

        _unsubAdminProjects = S.fbDb.collection('projects')
            .where('status', '==', 'open')
            .onSnapshot(function (snap) {
                _adminProjectsCache = snap.docs.map(function (d) { return d.data(); });
                _renderAdminProjectsList();
            }, function (err) {
                console.warn('[app-donors] admin projects listener error:', err.message);
            });
    }

    function _renderAdminProjectsList() {
        var container = document.getElementById('admin-published-projects-list');
        if (!container) return;
        if (!_adminProjectsCache.length) {
            container.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No published projects yet — use the form above to publish one.</td></tr>';
            return;
        }
        container.innerHTML = _adminProjectsCache.map(function (p) {
            return '' +
                '<tr data-id="' + _escAttr(p.id) + '" style="border-bottom:1px solid rgba(10,14,39,0.06);">' +
                    '<td style="padding:12px 16px;font-weight:700;color:var(--primary);">' + _esc(p.title) + (p.media && p.media[0] ? ' <span style="font-weight:500;font-size:0.72rem;color:var(--text-muted);">· ' + p.media.length + ' media</span>' : '') + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;">' + _esc(_projectTypeLabel(p.projectType) || '\u2014') + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;text-transform:capitalize;">' + _esc(_categoryLabel(p.category)) + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;">' + _esc(p.region || '\u2014') + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;font-weight:700;">' + _esc(p.currency) + ' ' + _fmtAmount(p.budget) + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;">' + _esc(p.timeframe || '\u2014') + '</td>' +
                    '<td style="padding:12px 16px;">' +
                        '<button type="button" class="close-project-btn" data-id="' + _escAttr(p.id) + '" style="background:rgba(239,68,68,0.1);color:#B91C1C;border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;white-space:nowrap;">Close / Delist</button>' +
                    '</td>' +
                '</tr>';
        }).join('');
    }

    // ============================================================
    // 6b. Admin "Donors" tab — monitoring dashboard, full directories,
    //     comprehensive report export, and a message-donor action into
    //     the existing chat system (window.openChat, defined in
    //     app-chat.js). This is the reporting/tracking/communication
    //     layer that the two approval queues above don't cover — those
    //     stay untouched and keep living on the Queues tab. Markup target:
    //     #admin-donors-tab in index.html (stat cards + #admin-donors-table-body
    //     + #admin-proposals-table-body + #admin-donor-csv-btn).
    // ============================================================
    function _watchAllDonorsForDashboard() {
        var S = _state();
        if (_unsubAllDonors) { _unsubAllDonors(); _unsubAllDonors = null; }
        if (!S.isAdmin || !S.firebaseLoaded || !S.fbDb) return;

        _unsubAllDonors = S.fbDb.collection('donor_profiles')
            .onSnapshot(function (snap) {
                _allDonorsCache = snap.docs.map(function (d) { return d.data(); });
                _renderAdminDonorDashboard();
            }, function (err) {
                console.warn('[app-donors] all-donors dashboard listener error:', err.message);
            });
    }

    function _watchAllProposalsForDashboard() {
        var S = _state();
        if (_unsubAllProposals) { _unsubAllProposals(); _unsubAllProposals = null; }
        if (!S.isAdmin || !S.firebaseLoaded || !S.fbDb) return;

        _unsubAllProposals = S.fbDb.collection('sponsorship_proposals')
            .onSnapshot(function (snap) {
                _allProposalsCache = snap.docs.map(function (d) { return d.data(); });
                _renderAdminDonorDashboard();
            }, function (err) {
                console.warn('[app-donors] all-proposals dashboard listener error:', err.message);
            });
    }

    // Re-renders everything the Donors tab shows. Cheap to call from either
    // listener since both caches are already in memory — no re-fetch.
    function _renderAdminDonorDashboard() {
        _renderAdminDonorStats();
        _renderAdminDonorsTable();
        _renderAdminProposalsTable();
    }

    function _renderAdminDonorStats() {
        var totalEl    = document.getElementById('admin-donor-stat-total');
        var pendingEl  = document.getElementById('admin-donor-stat-pending');
        var approvedEl = document.getElementById('admin-donor-stat-approved');
        var activeEl   = document.getElementById('admin-proposal-stat-active');
        var pledgedEl  = document.getElementById('admin-proposal-stat-pledged');
        var fundedEl   = document.getElementById('admin-proposal-stat-funded');
        if (!totalEl && !pendingEl && !approvedEl && !activeEl && !pledgedEl && !fundedEl) return;

        var pendingCount = 0, approvedCount = 0;
        _allDonorsCache.forEach(function (p) {
            var status = p.approvalStatus || (p.verified ? 'approved' : 'pending');
            if (status === 'approved') approvedCount++;
            else if (status === 'pending') pendingCount++;
        });

        var activeCount = 0, pledgedTotal = 0, fundedTotal = 0;
        _allProposalsCache.forEach(function (p) {
            if (p.status === 'pending' || p.status === 'approved') activeCount++;
            pledgedTotal += Number(p.pledgedAmount) || 0;
            if (p.status === 'funded' || p.status === 'completed') fundedTotal += Number(p.amountFunded || p.pledgedAmount) || 0;
        });

        if (totalEl)    totalEl.textContent    = _allDonorsCache.length;
        if (pendingEl)  pendingEl.textContent  = pendingCount;
        if (approvedEl) approvedEl.textContent = approvedCount;
        if (activeEl)   activeEl.textContent   = activeCount;
        if (pledgedEl)  pledgedEl.textContent  = _fmtAmount(pledgedTotal);
        if (fundedEl)   fundedEl.textContent   = _fmtAmount(fundedTotal);
    }

    function _statusBadgeHtml(status) {
        var palette = {
            approved:  { bg: 'rgba(16,185,129,0.1)',  fg: '#059669' },
            funded:    { bg: 'rgba(16,185,129,0.1)',  fg: '#059669' },
            completed: { bg: 'rgba(16,185,129,0.1)',  fg: '#059669' },
            pending:   { bg: 'rgba(245,158,11,0.12)', fg: '#B45309' },
            rejected:  { bg: 'rgba(239,68,68,0.08)',  fg: '#DC2626' }
        };
        var c = palette[status] || palette.pending;
        return '<span style="font-size:0.75rem;padding:3px 10px;border-radius:20px;font-weight:600;background:' + c.bg + ';color:' + c.fg + ';white-space:nowrap;">' + _esc(status || 'pending') + '</span>';
    }

    function _fmtDate(ts) {
        var seconds = _tsSeconds(ts);
        if (!seconds) return '—';
        try { return new Date(seconds * 1000).toLocaleDateString(); } catch (e) { return '—'; }
    }

    function _renderAdminDonorsTable() {
        var tbody = document.getElementById('admin-donors-table-body');
        if (!tbody) return;
        if (!_allDonorsCache.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">No donors registered yet.</td></tr>';
            return;
        }
        var rows = _allDonorsCache.slice().sort(function (a, b) {
            return _tsSeconds(b.createdAt) - _tsSeconds(a.createdAt);
        });
        tbody.innerHTML = rows.map(function (p) {
            var status = p.approvalStatus || (p.verified ? 'approved' : 'pending');
            var interests = (p.preferredCategories || []).join(', ') || '—';
            var actions = '<button type="button" class="message-donor-btn" data-uid="' + _escAttr(p.uid) + '" style="background:rgba(27,43,139,0.08);color:var(--secondary-color,#1B2B8B);border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:6px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"/></svg> Message</button>';
            if (status === 'pending') {
                actions += '<button type="button" class="approve-donor-btn admin-dashboard-approve-donor-btn" data-uid="' + _escAttr(p.uid) + '" style="background:var(--success-color,#10B981);color:white;border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:6px;">Approve</button>' +
                    '<button type="button" class="reject-donor-btn admin-dashboard-reject-donor-btn" data-uid="' + _escAttr(p.uid) + '" style="background:rgba(239,68,68,0.08);color:var(--danger-color);border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;">Reject</button>';
            }
            return '' +
                '<tr class="admin-donor-approval-item" data-uid="' + _escAttr(p.uid) + '" style="border-bottom:1px solid rgba(10,14,39,0.05);">' +
                    '<td style="padding:12px 16px;">' +
                        '<div style="font-weight:600;font-size:0.85rem;color:var(--primary-color);">' + _esc(p.orgName || p.name || 'Unnamed donor') + '</div>' +
                        (p.email ? '<div style="font-size:0.76rem;color:var(--text-muted);">' + _esc(p.email) + '</div>' : '') +
                    '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;text-transform:capitalize;">' + _esc(p.donorType || 'individual') + '</td>' +
                    '<td style="padding:12px 16px;">' + _statusBadgeHtml(status) + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.8rem;color:var(--text-muted);max-width:220px;">' + _esc(interests) + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">' + _fmtDate(p.createdAt) + '</td>' +
                    '<td style="padding:12px 16px;white-space:nowrap;">' + actions + '</td>' +
                '</tr>';
        }).join('');
    }

    function _renderAdminProposalsTable() {
        var tbody = document.getElementById('admin-proposals-table-body');
        if (!tbody) return;
        if (!_allProposalsCache.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">No sponsorship proposals submitted yet.</td></tr>';
            return;
        }
        var rows = _allProposalsCache.slice().sort(function (a, b) {
            return _tsSeconds(b.createdAt) - _tsSeconds(a.createdAt);
        });
        tbody.innerHTML = rows.map(function (p) {
            var actions = '<button type="button" class="message-donor-btn" data-uid="' + _escAttr(p.donorId) + '" style="background:rgba(27,43,139,0.08);color:var(--secondary-color,#1B2B8B);border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:6px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"/></svg> Message</button>';
            if (p.status === 'pending') {
                actions += '<button type="button" class="approve-proposal-btn admin-dashboard-approve-proposal-btn" data-id="' + _escAttr(p.id) + '" style="background:var(--success-color,#10B981);color:white;border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:6px;">Approve</button>' +
                    '<button type="button" class="reject-proposal-btn admin-dashboard-reject-proposal-btn" data-id="' + _escAttr(p.id) + '" style="background:rgba(239,68,68,0.08);color:var(--danger-color);border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;">Reject</button>';
            }
            return '' +
                '<tr class="admin-queue-item" data-id="' + _escAttr(p.id) + '" style="border-bottom:1px solid rgba(10,14,39,0.05);">' +
                    '<td style="padding:12px 16px;font-weight:600;font-size:0.85rem;color:var(--primary-color);">' + _esc(p.donorName) + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;color:var(--text-muted);">' + _esc(p.targetLabel) + '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.5px;">' + _esc(p.targetType) + '</div></td>' +
                    '<td style="padding:12px 16px;font-size:0.85rem;font-weight:700;color:var(--accent-color);">' + _esc(p.currency) + ' ' + _fmtAmount(p.pledgedAmount) + '</td>' +
                    '<td style="padding:12px 16px;">' + _statusBadgeHtml(p.status) + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">' + _fmtDate(p.createdAt) + '</td>' +
                    '<td style="padding:12px 16px;white-space:nowrap;">' + actions + '</td>' +
                '</tr>';
        }).join('');
    }

    // Communication tools — opens the dedicated Donor Messages overlay
    // (§12 below), NOT the general chat system. Donor<->admin messages
    // used to go through window.openChat / app-chat.js and got mixed in
    // with every other conversation; this keeps them in their own
    // Firestore collection and their own inbox, the same way
    // app-marketplace.js keeps marketplace inquiries out of the general
    // Chats tab.
    function _messageDonor(uid) {
        if (!uid) return;
        var name = _donorDisplayNameFor(uid);
        _openDonorChatOverlay(uid, name);
    }

    // Look up a donor's display name from whichever cache already has it,
    // so the admin's overlay header shows something better than a raw uid.
    function _donorDisplayNameFor(uid) {
        var pools = [_allDonorsCache, _adminQueueCache, _donorApprovalQueueCache, _myProposalsCache, _donorMsgThreadsCache];
        for (var i = 0; i < pools.length; i++) {
            var hit = pools[i].find(function (p) { return p.uid === uid || p.donorId === uid; });
            if (hit) return hit.orgName || hit.name || hit.donorName || 'Donor';
        }
        return 'Donor';
    }

    // Comprehensive report export (CSV) — donors + proposals in one file,
    // covering the "System Reporting and Tracking" requirement without a
    // second reporting surface. Client-side only; no new Firestore reads.
    function _csvEscape(v) {
        var s = String(v == null ? '' : v);
        return '"' + s.replace(/"/g, '""') + '"';
    }

    function _exportDonorReportCsv() {
        var lines = [];
        lines.push('DONOR PROFILES');
        lines.push(['Name', 'Organization', 'Type', 'Email', 'Status', 'Preferred Categories', 'Preferred Regions', 'Registered'].map(_csvEscape).join(','));
        _allDonorsCache.forEach(function (p) {
            var status = p.approvalStatus || (p.verified ? 'approved' : 'pending');
            lines.push([
                p.name || '', p.orgName || '', p.donorType || 'individual', p.email || '',
                status, (p.preferredCategories || []).join('; '), (p.preferredRegions || []).join('; '),
                _fmtDate(p.createdAt)
            ].map(_csvEscape).join(','));
        });
        lines.push('');
        lines.push('SPONSORSHIP PROPOSALS');
        lines.push(['Donor', 'Target', 'Target Type', 'Pledged Amount', 'Currency', 'Status', 'Amount Funded', 'Notes', 'Submitted'].map(_csvEscape).join(','));
        _allProposalsCache.forEach(function (p) {
            lines.push([
                p.donorName || '', p.targetLabel || '', p.targetType || '', p.pledgedAmount || 0,
                p.currency || '', p.status || '', p.amountFunded || 0, p.notes || '', _fmtDate(p.createdAt)
            ].map(_csvEscape).join(','));
        });

        var csv = lines.join('\r\n');
        var filename = 'empyrean-donor-report-' + new Date().toISOString().slice(0, 10) + '.csv';
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

        function _logExport() {
            if (typeof window.logAdminAction === 'function') {
                window.logAdminAction('EXPORT_DONOR_REPORT', 'Donor Management', 'CSV report exported (' + _allDonorsCache.length + ' donors, ' + _allProposalsCache.length + ' proposals)');
            }
        }

        // BUG FIX: a hidden <a download> click on a blob URL is what desktop
        // browsers need, but most mobile browsers (iOS Safari in particular,
        // and in-app webviews) silently ignore the download attribute on
        // blob: URLs — the click "succeeds" with no visible effect and no
        // file ever reaches Downloads/Files, which is exactly what was
        // reported (success toast, no file on the phone). Prefer the Web
        // Share API, which gives the user an explicit Save-to-Files sheet;
        // fall back to opening the blob in a new tab on mobile so the
        // browser's own viewer/share button takes over; only use the old
        // anchor-click trick as the desktop fallback, where it does work.
        var file = null;
        try { file = new File([blob], filename, { type: 'text/csv' }); } catch (e) {}

        if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: filename }).then(function () {
                _notify('Donor & sponsorship report ready — saved via the share sheet.', 'success');
                _logExport();
            }).catch(function (err) {
                if (err && err.name !== 'AbortError') {
                    _notify('Could not share the report: ' + (err.message || 'please try again.'), 'error');
                }
            });
            return;
        }

        var url = URL.createObjectURL(blob);
        var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
        if (isMobile) {
            window.open(url, '_blank');
            _notify('Report opened in a new tab — use Share or Save to keep it.', 'success');
            setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
            _logExport();
            return;
        }

        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        _notify('Donor & sponsorship report downloaded.', 'success');
        _logExport();
    }

    // ============================================================
    // 7. Funding an approved proposal — reuses the existing
    //    Flutterwave flow (initiateFlutterwavePayment / FlutterwaveCheckout),
    //    same guarded-load pattern app-sos.js already uses for donations.
    // ============================================================
    function _fundProposal(id) {
        var S = _state();
        var p = _myProposalsCache.find(function (i) { return i.id === id; });
        if (!p) return;

        function _onSuccess(txRef) {
            S.fbDb.collection('sponsorship_proposals').doc(id).update({
                status: 'funded',
                amountFunded: p.pledgedAmount,
                fundedAt: _serverTimestamp(),
                txRef: txRef || null
            }).then(function () {
                _notify('Thank you — your pledge of ' + p.currency + ' ' + _fmtAmount(p.pledgedAmount) + ' is confirmed.', 'success');
                _reward('donor_fund', S.uid);
            }).catch(function (err) {
                _notify('Payment succeeded but recording it failed: ' + (err && err.message ? err.message : ''), 'error');
            });
        }

        if (typeof window.initiateFlutterwavePayment === 'function') {
            window.initiateFlutterwavePayment({
                amount: p.pledgedAmount,
                currency: p.currency,
                title: 'Sponsorship: ' + p.targetLabel,
                onSuccess: _onSuccess
            });
            return;
        }

        // Fallback: same guarded SDK-load pattern used in app-sos.js
        function _launch() {
            try {
                FlutterwaveCheckout({
                    tx_ref: 'sponsor-' + id + '-' + Date.now(),
                    amount: p.pledgedAmount,
                    currency: p.currency,
                    customer: { email: (window.userState && window.userState.email) || '' },
                    customizations: { title: 'Sponsorship: ' + p.targetLabel },
                    callback: function (resp) {
                        if (resp && (resp.status === 'successful' || resp.status === 'completed')) {
                            _onSuccess(resp.transaction_id || resp.tx_ref);
                        }
                    },
                    onclose: function () { _notify('Payment window closed.', 'info'); }
                });
            } catch (e) { _notify('Payment gateway error. Please try again.', 'error'); }
        }
        if (typeof window._ensureFlutterwaveSDK === 'function') window._ensureFlutterwaveSDK(_launch);
        else _launch();
    }

    // ============================================================
    // 12. Donor Messages — dedicated donor<->admin chat, kept OUT of the
    //     general Chats tab (app-chat.js) and out of Marketplace Messages
    //     (app-marketplace.js), mirroring the exact same isolation pattern
    //     app-marketplace.js uses for its own inbox:
    //       • its own Firestore collection (donor_messages/{donorUid} +
    //         msgs subcollection) instead of the shared 'messages' collection
    //       • its own floating overlay (#dnr-chat-overlay / .dnr-chat-*),
    //         entirely separate DOM/CSS from #mkt-chat-overlay
    //       • its own localStorage key (empyrean_donor_msgs) for offline
    //         fallback, separate from empyrean_market_msgs
    //     One thread per donor (thread id = donor uid) since the donor's
    //     counterpart is always "the org", not a specific individual —
    //     unlike marketplace where each buyer/seller pair gets its own tid.
    // ============================================================
    function _donorMsgLocalStore() {
        try { return JSON.parse(localStorage.getItem('empyrean_donor_msgs') || '{}'); } catch (e) { return {}; }
    }
    function _donorMsgSaveLocal(donorId, msg, meta) {
        var store = _donorMsgLocalStore();
        var entry = store[donorId] || { meta: {}, thread: [] };
        entry.meta = Object.assign({}, entry.meta, meta || {});
        if (msg) entry.thread.push(msg);
        store[donorId] = entry;
        try { localStorage.setItem('empyrean_donor_msgs', JSON.stringify(store)); } catch (e) {}
    }

    function _openDonorChatOverlay(donorId, donorName) {
        if (!donorId) return;
        var OVERLAY_ID = 'dnr-chat-overlay';
        var S = _state();
        if (!S.uid) { _requireLogin(); return; }
        var db = S.fbDb;
        var isAdminViewer = S.isAdmin && donorId !== S.uid;

        var existing = document.getElementById(OVERLAY_ID);
        if (existing) {
            // BUG FIX ("donor hub doesn't receive messages, only admin
            // does"): the close handler below unsubscribes the listener
            // (existing._dnrUnsub()) but only hides the DOM — it never
            // removes it. Reopening the SAME donor's thread used to just
            // flip display back to 'flex' and return here, reusing that
            // now-disconnected DOM without ever re-subscribing. The panel
            // looked fine (old messages still rendered) but was
            // permanently deaf to anything sent after the close — exactly
            // the symptom reported. Only reuse the existing overlay when
            // its listener is still actually live; otherwise fall through
            // and rebuild from scratch so a fresh subscription attaches.
            if (existing.dataset.donorId === donorId && existing._dnrUnsub) {
                existing.style.display = 'flex';
                var reopenInp = existing.querySelector('.dnr-chat-input');
                if (reopenInp) reopenInp.focus();
                return;
            }
            if (existing._dnrUnsub) { try { existing._dnrUnsub(); } catch (e) {} }
            existing.remove();
        }

        if (!document.getElementById('_dnr_chat_css')) {
            var css = document.createElement('style');
            css.id = '_dnr_chat_css';
            css.textContent = [
                '#dnr-chat-overlay{position:fixed;bottom:0;right:16px;width:320px;max-height:480px;display:flex;flex-direction:column;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -4px 32px rgba(10,14,39,0.22);z-index:99999;font-family:inherit;overflow:hidden;}',
                '@media(max-width:480px){#dnr-chat-overlay{right:0;left:0;width:100%;border-radius:16px 16px 0 0;}}',
                '#dnr-chat-overlay .dnr-chat-header{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#10B981,#0A0E27);color:#fff;cursor:default;}',
                '#dnr-chat-overlay .dnr-chat-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;}',
                '#dnr-chat-overlay .dnr-chat-title{flex:1;font-weight:700;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '#dnr-chat-overlay .dnr-chat-close{background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;padding:0 4px;opacity:0.8;line-height:1;flex-shrink:0;}',
                '#dnr-chat-overlay .dnr-chat-close:hover{opacity:1;}',
                '#dnr-chat-overlay .dnr-chat-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:160px;max-height:320px;background:#f7f8fc;}',
                '#dnr-chat-overlay .dnr-msg{max-width:82%;padding:8px 12px;border-radius:14px;font-size:0.84rem;line-height:1.4;word-break:break-word;}',
                '#dnr-chat-overlay .dnr-msg.sent{align-self:flex-end;background:#10B981;color:#fff;border-bottom-right-radius:4px;}',
                '#dnr-chat-overlay .dnr-msg.recv{align-self:flex-start;background:#fff;color:#0A0E27;border:1px solid rgba(10,14,39,0.10);border-bottom-left-radius:4px;}',
                '#dnr-chat-overlay .dnr-msg .dnr-msg-time{font-size:0.68rem;opacity:0.6;margin-top:3px;display:block;text-align:right;}',
                '#dnr-chat-overlay .dnr-chat-empty{color:#9CA3AF;font-size:0.82rem;text-align:center;margin:auto;padding:20px 0;}',
                '#dnr-chat-overlay .dnr-chat-composer{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid rgba(10,14,39,0.08);background:#fff;flex-shrink:0;}',
                '#dnr-chat-overlay .dnr-chat-input{flex:1;border:1px solid rgba(10,14,39,0.14);border-radius:20px;padding:8px 14px;font-size:0.85rem;outline:none;resize:none;line-height:1.3;max-height:80px;overflow-y:auto;font-family:inherit;}',
                '#dnr-chat-overlay .dnr-chat-input:focus{border-color:#10B981;}',
                '#dnr-chat-overlay .dnr-chat-send{flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#10B981;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.18s;}',
                '#dnr-chat-overlay .dnr-chat-send:hover{background:#0ea271;}',
                '#dnr-chat-overlay .dnr-chat-send svg{width:16px;height:16px;fill:#fff;}',
                '#dnr-chat-overlay .dnr-chat-send:disabled{background:#9CA3AF;cursor:not-allowed;}'
            ].join('');
            document.head.appendChild(css);
        }

        var headerName = isAdminViewer ? (donorName || 'Donor') : 'Empyrean Support Team';
        var overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.dataset.donorId = donorId;
        overlay.innerHTML = [
            '<div class="dnr-chat-header">',
            '  <div class="dnr-chat-avatar"><i class="fas fa-hand-holding-heart"></i></div>',
            '  <span class="dnr-chat-title">' + _esc(headerName) + '</span>',
            '  <button class="dnr-chat-close" title="Close">&times;</button>',
            '</div>',
            '<div class="dnr-chat-body" id="dnr-chat-body">',
            '  <span class="dnr-chat-empty">Say hello to ' + _esc(headerName) + '</span>',
            '</div>',
            '<div class="dnr-chat-composer">',
            '  <div class="dnr-chat-input" contenteditable="true" role="textbox" placeholder="Message ' + _esc(headerName) + '…"></div>',
            '  <button class="dnr-chat-send" title="Send">',
            '    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
            '  </button>',
            '</div>'
        ].join('');
        document.body.appendChild(overlay);

        var body = overlay.querySelector('#dnr-chat-body');
        var inp = overlay.querySelector('.dnr-chat-input');
        var sendBtn = overlay.querySelector('.dnr-chat-send');

        function _bubble(text, isSent, ts) {
            var empty = body.querySelector('.dnr-chat-empty');
            if (empty) empty.remove();
            var d = document.createElement('div');
            d.className = 'dnr-msg ' + (isSent ? 'sent' : 'recv');
            var t = document.createElement('span');
            t.textContent = text;
            var tm = document.createElement('span');
            tm.className = 'dnr-msg-time';
            tm.textContent = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';
            d.appendChild(t);
            d.appendChild(tm);
            body.appendChild(d);
            body.scrollTop = body.scrollHeight;
            return d;
        }

        var myRole = isAdminViewer ? 'admin' : 'donor';
        var _unsub = null;
        if (db) {
            try {
                _unsub = db.collection('donor_messages').doc(donorId).collection('msgs')
                    .orderBy('ts', 'asc')
                    .limit(100)
                    .onSnapshot(function (snap) {
                        if (!snap) return;
                        snap.docChanges().forEach(function (ch) {
                            if (ch.type !== 'added') return;
                            var msg = ch.doc.data();
                            var msgDocId = ch.doc.id;
                            if (body.querySelector('[data-msgid="' + msgDocId + '"]')) return;
                            var bubble = _bubble(msg.text || '', msg.fromRole === myRole, msg.ts);
                            bubble.dataset.msgid = msgDocId;
                        });
                    }, function (err) {
                        console.warn('[DonorChat] listener error:', err.message);
                    });
            } catch (e) {}

            // Viewer just opened this thread — clear the unread counter that
            // belongs to them (unreadAdmin for the admin, unreadDonor for
            // the donor), same increment/reset shape as marketplace_messages.
            try {
                var clearField = {};
                clearField[isAdminViewer ? 'unreadAdmin' : 'unreadDonor'] = 0;
                db.collection('donor_messages').doc(donorId).set(clearField, { merge: true }).catch(function () {});
            } catch (e) {}
        }

        function _registerThread(lastMessage, fromRole) {
            var meta = {
                donorId: donorId,
                donorName: isAdminViewer ? headerName : (donorName || headerName),
                lastMessage: lastMessage,
                lastFrom: fromRole,
                lastTs: new Date().toISOString()
            };
            _donorMsgSaveLocal(donorId, null, meta);
            if (db) {
                try {
                    var incField = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue
                        && window.firebase.firestore.FieldValue.increment) || null;
                    var unreadKey = fromRole === 'admin' ? 'unreadDonor' : 'unreadAdmin';
                    var payload = Object.assign({}, meta);
                    payload[unreadKey] = incField ? incField(1) : 1;
                    db.collection('donor_messages').doc(donorId).set(payload, { merge: true }).catch(function () {});
                } catch (e) {}
            }
        }

        function _post(text, fromRole) {
            var msgObj = { fromRole: fromRole, text: text, ts: new Date().toISOString(), read: false };
            var msgRef = null;
            if (db) {
                try { msgRef = db.collection('donor_messages').doc(donorId).collection('msgs').doc(); } catch (e) { msgRef = null; }
            }
            var bubble = _bubble(text, fromRole === myRole, msgObj.ts);
            if (msgRef) bubble.dataset.msgid = msgRef.id;
            _donorMsgSaveLocal(donorId, msgObj, {});
            _registerThread(text, fromRole);
            if (db) {
                try {
                    (msgRef ? msgRef.set(msgObj) : db.collection('donor_messages').doc(donorId).collection('msgs').add(msgObj))
                        .catch(function (err) {
                            console.warn('[DonorChat] send error:', err.message);
                            _notify('Message not saved — check connection.', 'warning');
                        });
                } catch (e) {}
            } else {
                _notify('You are offline — message saved on this device only.', 'warning');
            }
        }

        function _send() {
            var text = (inp.textContent || inp.innerText || '').trim();
            if (!text) return;
            inp.textContent = '';
            inp.innerText = '';
            _post(text, myRole);
        }

        sendBtn.addEventListener('click', _send);
        inp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); _send(); }
        });
        inp.addEventListener('input', function () {
            sendBtn.disabled = !(inp.textContent.trim() || inp.innerText.trim());
        });
        sendBtn.disabled = true;

        overlay._dnrUnsub = _unsub;
        overlay.querySelector('.dnr-chat-close').addEventListener('click', function () {
            overlay.style.display = 'none';
            if (_unsub) { try { _unsub(); } catch (e) {} }
            overlay._dnrUnsub = null;
        });

        inp.focus();
    }
    window.openDonorChatOverlay = _openDonorChatOverlay;

    // ── 12a. Admin-side message receiver portal — lists every donor's
    //     thread so an admin can see donor replies without hunting through
    //     the donor/proposal tables. Renders into
    //     #admin-donor-messages-table-body inside #admin-donors-tab.
    function _watchDonorMessageThreads() {
        var S = _state();
        if (_unsubDonorMsgThreads) { _unsubDonorMsgThreads(); _unsubDonorMsgThreads = null; }
        if (!S.isAdmin || !S.firebaseLoaded || !S.fbDb) return;

        _unsubDonorMsgThreads = S.fbDb.collection('donor_messages')
            .onSnapshot(function (snap) {
                _donorMsgThreadsCache = snap.docs.map(function (d) { return d.data(); });
                _renderAdminDonorMessagesTable();
            }, function (err) {
                console.warn('[app-donors] donor message threads listener error:', err.message);
            });
    }

    function _renderAdminDonorMessagesTable() {
        var tbody = document.getElementById('admin-donor-messages-table-body');
        if (!tbody) return;
        if (!_donorMsgThreadsCache.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted);">No donor conversations yet.</td></tr>';
            return;
        }
        var rows = _donorMsgThreadsCache.slice()
            .filter(function (r) { return r && r.lastMessage; })
            .sort(function (a, b) { return new Date(b.lastTs || 0).getTime() - new Date(a.lastTs || 0).getTime(); });
        tbody.innerHTML = rows.map(function (r) {
            var unread = r.unreadAdmin || 0;
            return '' +
                '<tr style="border-bottom:1px solid rgba(10,14,39,0.05);">' +
                    '<td style="padding:12px 16px;font-weight:600;font-size:0.85rem;color:var(--primary-color);">' + _esc(r.donorName || 'Donor') +
                        (unread > 0 ? ' <span style="background:#EF4444;color:#fff;font-size:0.68rem;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:6px;">' + (unread > 9 ? '9+' : unread) + ' new</span>' : '') +
                    '</td>' +
                    '<td style="padding:12px 16px;font-size:0.82rem;color:var(--text-muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.lastMessage || '') + '</td>' +
                    '<td style="padding:12px 16px;font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">' + _esc(r.lastFrom === 'admin' ? 'You' : 'Donor') + '</td>' +
                    '<td style="padding:12px 16px;white-space:nowrap;"><button type="button" class="view-donor-thread-btn" data-uid="' + _escAttr(r.donorId) + '" data-name="' + _escAttr(r.donorName || 'Donor') + '" style="background:rgba(16,185,129,0.1);color:var(--success-color,#10B981);border:none;padding:6px 12px;border-radius:10px;cursor:pointer;font-size:0.76rem;font-weight:600;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"/></svg> View / Reply</button></td>' +
                '</tr>';
        }).join('');
    }

    // ── 12b. Donor-side entry point — a donor only ever has ONE thread
    //     (with the org), so no multi-conversation inbox is needed; just
    //     an unread badge on a single "Messages" card in the Donor Hub.
    function _watchMyDonorThread() {
        var S = _state();
        if (_unsubMyDonorThread) { _unsubMyDonorThread(); _unsubMyDonorThread = null; }
        if (!S.firebaseLoaded || !S.fbDb || !S.uid || S.isGuest) return;

        _unsubMyDonorThread = S.fbDb.collection('donor_messages').doc(S.uid)
            .onSnapshot(function (doc) {
                var badge = document.getElementById('donor-messages-badge');
                if (!badge) return;
                var unread = (doc.exists && doc.data().unreadDonor) || 0;
                if (unread > 0) { badge.textContent = unread > 9 ? '9+' : unread; badge.style.display = 'inline-flex'; }
                else { badge.style.display = 'none'; }
            }, function (err) {
                console.warn('[app-donors] my donor thread listener error:', err.message);
            });
    }

    function openDonorMessages() {
        var S = _state();
        if (!_requireLogin()) return;
        var name = (_donorProfileCache && (_donorProfileCache.orgName || _donorProfileCache.name)) || 'Donor';
        _openDonorChatOverlay(S.uid, name);
    }
    window.openDonorMessages = openDonorMessages;

    // ── Small utilities ──────────────────────────────────────────────────────
    function _fmtAmount(n) {
        n = Number(n) || 0;
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function _escAttr(s) { return _esc(s); }

    // ============================================================
    // 8. Click delegation
    // ============================================================
    function _bindClickDelegation() {
        document.addEventListener('click', function (e) {
            var closest = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };

            var sponsorBtn = closest('.sponsor-now-btn');
            if (sponsorBtn) {
                openProposalModal(
                    sponsorBtn.dataset.targetType,
                    sponsorBtn.dataset.targetId,
                    sponsorBtn.dataset.targetLabel,
                    sponsorBtn.dataset.amountNeeded,
                    sponsorBtn.dataset.currency
                );
                return;
            }

            if (closest('.proposal-modal-close')) { _closeProposalModal(); return; }

            var fundBtn = closest('.fund-proposal-btn');
            if (fundBtn) { _fundProposal(fundBtn.dataset.id); return; }

            var approveBtn = closest('.approve-proposal-btn');
            if (approveBtn) {
                var itemEl = closest('.admin-queue-item');
                if (itemEl) _decideProposal(itemEl.dataset.id, 'approved');
                return;
            }
            var rejectBtn = closest('.reject-proposal-btn');
            if (rejectBtn) {
                var itemEl2 = closest('.admin-queue-item');
                if (itemEl2) _decideProposal(itemEl2.dataset.id, 'rejected');
                return;
            }

            var approveDonorBtn = closest('.approve-donor-btn');
            if (approveDonorBtn) {
                var donorItemEl = closest('.admin-donor-approval-item');
                if (donorItemEl) _decideDonorApproval(donorItemEl.dataset.uid, 'approved');
                return;
            }
            var rejectDonorBtn = closest('.reject-donor-btn');
            if (rejectDonorBtn) {
                var donorItemEl2 = closest('.admin-donor-approval-item');
                if (donorItemEl2) _decideDonorApproval(donorItemEl2.dataset.uid, 'rejected');
                return;
            }

            var messageDonorBtn = closest('.message-donor-btn');
            if (messageDonorBtn) { _messageDonor(messageDonorBtn.dataset.uid); return; }

            var viewThreadBtn = closest('.view-donor-thread-btn');
            if (viewThreadBtn) { _openDonorChatOverlay(viewThreadBtn.dataset.uid, viewThreadBtn.dataset.name); return; }

            if (closest('#donor-messages-btn')) { openDonorMessages(); return; }

            if (closest('#admin-donor-csv-btn')) { _exportDonorReportCsv(); return; }

            var closeProjectBtn = closest('.close-project-btn');
            if (closeProjectBtn) { _closeProject(closeProjectBtn.dataset.id); return; }
        });
    }

    // ============================================================
    // 9. Form submit delegation
    // ============================================================
    function _bindFormSubmit() {
        _bindProjectMediaPreview();
        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (!form) return;
            if (form.id === 'donor-registration-form') { e.preventDefault(); _submitDonorRegistrationForm(form); return; }
            if (form.id === 'sponsorship-proposal-form') { e.preventDefault(); _submitProposalForm(form); return; }
            if (form.id === 'project-publish-form') { e.preventDefault(); _publishProjectForm(form); return; }
        });
    }

    // ============================================================
    // 10. Auth-state hook — (re)start listeners on login/logout
    // ============================================================
    function _bindAuthHook() {
        document.addEventListener('empyrean:firebase-ready', function () { _watchDashboardProjects(); _watchDonorProfile(); _watchMyProposals(); _wireAdminQueue(); _watchDonorWall(); _watchMyDonorThread(); });
        // Re-run whenever the app's own auth state changes, if it dispatches one;
        // otherwise poll lightly since userState.id/isAdmin can flip after this
        // module has already initialised (recurring pattern in this codebase).
        var _lastUid = null, _lastIsAdmin = null;
        setInterval(function () {
            var S = _state();
            if (!_unsubDashProjects) _watchDashboardProjects();
            if (S.uid !== _lastUid) {
                _lastUid = S.uid;
                _watchDonorProfile();
                _watchMyProposals();
                _watchMyDonorThread();
            }
            if (S.isAdmin !== _lastIsAdmin) {
                _lastIsAdmin = S.isAdmin;
                if (S.isAdmin) _wireAdminQueue();
            }
        }, 1500);
    }

    // ============================================================
    // 10b. Section-change hook — refresh open targets whenever the
    //      donor-hub section becomes active. 'empyrean-section-change'
    //      (with e.detail.section) is the event app-nav.js actually
    //      dispatches on every navigateTo() call — the real, live event
    //      name used across app-fixes.js / app-nav.js / app-ngo.js.
    // ============================================================
    function _bindSectionChangeHook() {
        document.addEventListener('empyrean-section-change', function (e) {
            var section = e && e.detail && e.detail.section;
            if (section === 'donor-hub') renderSponsorTargets();
        });

        // Also cover a direct/refresh load where donor-hub is already the
        // active section before this listener was attached.
        var active = document.querySelector('.content-section.active');
        if (active && active.id === 'donor-hub') renderSponsorTargets();
    }

    // ============================================================
    // 11. Init
    // ============================================================
    _ready(function () {
        _bindClickDelegation();
        _bindFormSubmit();
        _bindCategoryDropdown();
        _bindAuthHook();
        _bindSectionChangeHook();
        _watchDashboardProjects();
        _watchDonorProfile();
        _watchMyProposals();
        _watchDonorWall();
        _watchMyDonorThread();
        if (_state().isAdmin) _wireAdminQueue();

        console.log('[Empyrean] ✅ app-donors.js loaded — Donor Profile & Sponsorship module active');
    });

    // ── Expose ──────────────────────────────────────────────────────────────
    window.renderSponsorTargets = renderSponsorTargets;
    window.renderDonorWall = renderDonorWall;
    window.renderMyProposals = renderMyProposals;
    window.renderDonorAdminQueue = renderDonorAdminQueue;
    window.renderDonorApprovalQueue = renderDonorApprovalQueue;
    window.getMatchedOpportunitiesForDonor = getMatchedOpportunitiesForDonor;
    window.openProposalModal = openProposalModal;

})();

/* DONORS CARD LOGO CYCLER (2026-11-05): the dashboard "Donors who made an impact" medallion (.dw-logo, markup in index.html)
   changes design every few seconds -- palette, texture, centre emblem and ring style -- by flipping data-t (1..5); all the
   looks themselves live in CSS (index.html). Tap the logo to jump to the next design. Auto-cycling pauses while the tab is
   hidden and is off for prefers-reduced-motion (tap still works). */
(function () {
    'use strict';
    var THEMES = 5, INTERVAL_MS = 4500;
    function setup() {
        var svg = document.querySelector('#dashboard-donor-wall-card .dw-logo');
        if (!svg) return false;
        if (svg._dwBound) return true;
        svg._dwBound = true;
        var t = 1, timer = null;
        var reduce = false;
        try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
        function next() { t = (t % THEMES) + 1; svg.setAttribute('data-t', String(t)); }
        function restart() {
            if (timer) clearInterval(timer);
            timer = reduce ? null : setInterval(function () { if (!document.hidden) next(); }, INTERVAL_MS);
        }
        var holder = svg.parentNode;
        if (holder) {
            holder.style.cursor = 'pointer';
            holder.addEventListener('click', function () { next(); restart(); });
        }
        restart();
        return true;
    }
    if (!setup()) {
        document.addEventListener('DOMContentLoaded', setup);
        setTimeout(setup, 1500);
        setTimeout(setup, 4000);
    }
})();

/* LIVE CLOCK HEADER (2026-11-05): drives the ticking clock band at the top of the dashboard "Donors who made an impact"
   section (markup + styles in index.html). Hands and the digital time follow the device's real time, once per second.
   The digital time is written by changing an existing text node's value (not replacing it) so the section's
   MutationObserver, which watches child-list changes, is not woken every second. Paused while the tab is hidden. */
(function () {
    'use strict';
    var h, m, s, dig, txt, timer = null, lastSecs = -1;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function tick() {
        var d = new Date();
        var secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
        /* Jump (no tick animation) on the first paint, at midnight, or after the tab was in the background, so the
           second hand never spins across a big angle. */
        if (s && (lastSecs < 0 || secs < lastSecs || secs - lastSecs > 2)) {
            s.style.transition = 'none';
            s.style.transform = 'rotate(' + (secs * 6) + 'deg)';
            void s.getBoundingClientRect();
            s.style.transition = '';
        }
        lastSecs = secs;
        if (h) h.style.transform = 'rotate(' + (secs / 120) + 'deg)';
        if (m) m.style.transform = 'rotate(' + (secs / 10) + 'deg)';
        if (s) s.style.transform = 'rotate(' + (secs * 6) + 'deg)';
        if (txt) txt.nodeValue = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    function loop() {
        if (timer) clearTimeout(timer);
        if (!document.hidden) tick();
        timer = setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    }
    function setup() {
        h = document.getElementById('dwClkH'); m = document.getElementById('dwClkM'); s = document.getElementById('dwClkS');
        dig = document.getElementById('dwClkDigital');
        if (!s || !dig) return false;
        txt = dig.firstChild;
        if (!txt || txt.nodeType !== 3) { dig.textContent = '00:00:00'; txt = dig.firstChild; }
        loop();
        document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
        return true;
    }
    if (!setup()) {
        document.addEventListener('DOMContentLoaded', setup);
        setTimeout(function () { if (!timer) setup(); }, 1500);
    }
})();