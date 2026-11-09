/* =============================================================================
   EMPYREAN — app-patch-v48.js
   REAL withdrawal persistence + admin approve/decline wiring.

   BACKGROUND: the withdrawal-form submit handler in app-fixes.js (case
   'withdrawal-form', plus a second dedicated listener further down the same
   file) never wrote a withdrawal request anywhere — it just deducted
   userState.empyBalance locally and showed a toast. The admin "withdrawal
   queue" (mockAdminWithdrawalQueue) was populated the same way: a local
   mock array, never loaded from or written back to Firestore. Net effect:
   withdrawal requests didn't survive a refresh, no admin device other than
   the one that approved/rejected ever saw the action, and — the reason
   this file exists — there was no real Firestore document for
   server.js's new email listener (_watchWithdrawalsForEmail) to react to.

   FIX: this file is the single source of truth for withdrawal-form submit
   AND for .approve-withdrawal-btn / .reject-withdrawal-btn, using the same
   "duplicate-handler race condition" fix already applied to SOS approve/
   hold/reject (see the comment above the `if (closest('.approve-sos-btn')...)
   return;` guard in app-fixes.js): a CAPTURE-phase listener on `document`
   fires and calls stopImmediatePropagation() before any of the three older
   bubble-phase handlers (app-fixes.js's switch-case at ~L8687, its second
   dedicated `withdrawalForm.addEventListener` at ~L12980, and its
   admin-queue click handler at ~L6971) ever run. Those older handlers are
   left completely untouched in app-fixes.js — same "purely additive,
   doesn't edit the file it's patching" approach as app-patch-v46/v47.

   New Firestore collection this introduces: withdrawal_requests/{id}
     { userId, username, fullName, email, amount, currency, method,
       accountDetails: {...method-specific fields...},
       status: 'pending' | 'processed' | 'declined',
       createdAt, updatedAt }

   Firestore security rules note (see bottom of this file — NOT auto-applied,
   add manually wherever firebase-rules.js / the Firestore console rules
   live): this collection needs create-by-owner + read/update-by-admin rules,
   same shape as the existing sos_queue rules.
   ============================================================================= */

(function empyreanWithdrawalPatchV48() {
    'use strict';

    if (window._empWithdrawalPatchV48Loaded) return;
    window._empWithdrawalPatchV48Loaded = true;

    // Same two admin identities bulk-disburse-routes.js's _requireAdmin and
    // app-auth.js's ADMIN_EMAILS trust — duplicated here on purpose, exactly
    // like every other file in this codebase that needs to know "is this
    // user an admin" client-side (see the comment on bulk-disburse-routes.js's
    // own ADMIN_EMAILS for why this isn't centralized).
    const ADMIN_EMAILS = new Set(['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com']);

    function _us() {
        return (window.EmpState && window.EmpState.userState) || window.userState || {};
    }
    function _isAdmin() {
        const u = _us();
        return !!(u && u.email && ADMIN_EMAILS.has(u.email));
    }
    function _fbOk() {
        return !!(window._firebaseLoaded && window.fbDb);
    }
    function _fv() {
        return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type);
    }
    function _closest(el, sel) { return el && el.closest ? el.closest(sel) : null; }

    /* =========================================================================
       1) WITHDRAWAL-FORM SUBMIT — real Firestore persistence
       ========================================================================= */
    function _readWithdrawalForm(form) {
        const amountInput = form.querySelector('#withdrawal-amount');
        const methodSelect = form.querySelector('#withdrawal-method');
        const amount = parseFloat(amountInput && amountInput.value);
        const method = methodSelect ? methodSelect.value : '';

        const accountDetails = {};
        /* CRYPTO_HIDDEN_FOR_PLAY_STORE: 'empyrean-card' and 'usdt' can no
           longer be selected — index.html's #withdrawal-method only offers
           'bank' now, and the '#empyrean-card-number' / '#usdt-address'
           fields those branches read are gone from the DOM along with it.
           Left in place, unreachable, to restore together when crypto
           withdrawal goes live. */
        if (method === 'empyrean-card') {
            const v = form.querySelector('#empyrean-card-number');
            accountDetails.cardNumber = v ? v.value.trim() : '';
        } else if (method === 'usdt') {
            const v = form.querySelector('#usdt-address');
            accountDetails.usdtAddress = v ? v.value.trim() : '';
        } else if (method === 'bank') {
            const bn = form.querySelector('#bank-name');
            const an = form.querySelector('#account-number');
            accountDetails.bankName = bn ? bn.value.trim() : '';
            accountDetails.accountNumber = an ? an.value.trim() : '';
        }
        return { amount, method, accountDetails };
    }

    async function _submitWithdrawal(form) {
        const us = _us();
        if (!us.id) { _notify('Please log in to request a withdrawal.', 'error'); return; }

        const { amount, method, accountDetails } = _readWithdrawalForm(form);
        if (!amount || isNaN(amount) || amount < 5) {
            _notify('Minimum withdrawal is 5 EMPY.', 'error');
            return;
        }
        if (!method) {
            _notify('Please select a withdrawal method.', 'error');
            return;
        }
        const currentBalance = Number(us.empyBalance || 0);
        if (currentBalance < amount) {
            _notify('Insufficient EMPY balance for withdrawal.', 'error');
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        // Optimistic local deduction so the wallet UI updates immediately —
        // rolled back below if the Firestore write fails.
        us.empyBalance = currentBalance - amount;
        if (window.userState) window.userState.empyBalance = us.empyBalance;
        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

        const payload = {
            userId: us.id,
            username: us.username || '',
            fullName: us.fullName || us.username || 'Empyrean Member',
            email: us.email || '',
            amount, currency: 'EMPY', method, accountDetails,
            status: 'pending'
        };

        try {
            if (!_fbOk()) throw new Error('Offline — Firestore not available');
            const fv = _fv();
            payload.createdAt = fv ? fv.serverTimestamp() : new Date().toISOString();
            payload.updatedAt = payload.createdAt;

            const ref = await window.fbDb.collection('withdrawal_requests').add(payload);

            // Authoritative balance lives on the users doc — decrement there
            // too so a refresh / another device sees the same balance the
            // optimistic local update already shows.
            try {
                await window.fbDb.collection('users').doc(us.id).update({
                    empyBalance: fv ? fv.increment(-amount) : (currentBalance - amount)
                });
            } catch (balErr) {
                console.warn('[Patch v48] Balance sync to Firestore failed (non-fatal, local balance still updated):', balErr.message);
            }

            _notify('Withdrawal request submitted for review. You\u2019ll get an email confirmation shortly.', 'info');
            form.reset();
            if (typeof window.handleWithdrawalMethodChange === 'function') window.handleWithdrawalMethodChange();
            if (typeof window.updateWithdrawalPreview === 'function') window.updateWithdrawalPreview();
            console.log('[Patch v48] Withdrawal request created:', ref.id);
        } catch (err) {
            // Roll back the optimistic deduction — the request never actually
            // got recorded, so the user shouldn't lose the balance either.
            us.empyBalance = currentBalance;
            if (window.userState) window.userState.empyBalance = currentBalance;
            if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
            console.error('[Patch v48] Withdrawal submission failed:', err.message);
            _notify('Could not submit withdrawal request — please try again.', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    document.addEventListener('submit', function (e) {
        const form = e.target;
        if (!form || form.id !== 'withdrawal-form') return;
        // Capture-phase stop: pre-empts app-fixes.js's switch-case handler
        // AND its second dedicated withdrawalForm listener (both bubble-
        // phase, both still present and untouched in that file) — see file
        // header comment for why this is the correct fix pattern here.
        e.preventDefault();
        e.stopImmediatePropagation();
        _submitWithdrawal(form);
    }, true);

    /* =========================================================================
       2) ADMIN APPROVE / DECLINE — real Firestore status updates
       ========================================================================= */
    // Real NGN bank payouts go through server.js's
    // /api/admin/withdrawals/:id/payout route (actual Flutterwave transfer —
    // see that route's own header comment). Everything else (EMPY via
    // empyrean-card/usdt/bank) has no real fiat behind it, so approving it
    // has only ever meant "flip Firestore status" — that path is completely
    // unchanged below.
    function _withdrawalPayoutApiBase() {
        // Same Render backend host every other admin fetch in this codebase
        // already talks to (see _agoraApiBase() in app-fixes.js, and
        // app-bulk-disburse.js's _apiBase(), for the sibling pattern).
        return window._empApiBase() + '/api/admin/withdrawals';
    }

    function _isRealNgnBankPayout(wd) {
        return !!wd && String(wd.currency || '').toUpperCase() === 'NGN' && wd.method === 'bank';
    }

    async function _approveWithdrawal(itemEl, id) {
        if (!_fbOk()) { _notify('Offline — cannot approve right now.', 'error'); return; }

        let wd = null;
        try {
            const snap = await window.fbDb.collection('withdrawal_requests').doc(id).get();
            wd = snap.exists ? snap.data() : null;
        } catch (err) {
            console.error('[Patch v48] Could not load withdrawal before approve:', err.message);
            _notify('Could not load withdrawal request — please try again.', 'error');
            return;
        }

        if (_isRealNgnBankPayout(wd)) {
            // Real money movement — hit the server route instead of just
            // flipping status locally. The route itself updates Firestore
            // (status: 'processed', txRef, flwRef, ...) on success, so we
            // don't duplicate that write here — just react to the result.
            if (!window.fbAuth || !window.fbAuth.currentUser) {
                _notify('Not signed in as admin — cannot authorize a real payout.', 'error');
                return;
            }
            try {
                const token = await window.fbAuth.currentUser.getIdToken();
                const res = await fetch(_withdrawalPayoutApiBase() + '/' + id + '/payout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json().catch(function () { return {}; });
                if (!res.ok || !data.ok) {
                    throw new Error(data.error || ('HTTP ' + res.status));
                }
                _logAudit('Withdrawal Approved (NGN bank transfer sent)', id);
                _removeFromLocalQueue(id);
                if (itemEl) { itemEl.style.opacity = '0'; setTimeout(function () { itemEl.remove(); if (typeof window.renderAdminQueues === 'function') window.renderAdminQueues(); }, 300); }
                _notify('Bank transfer sent to ' + (data.resolvedName || 'the recipient') + '. The member will receive an email confirmation.', 'success');
            } catch (err) {
                console.error('[Patch v48] Real payout failed:', err.message);
                _notify('Payout failed: ' + (err.message || 'Unknown error') + ' — request stays pending, safe to retry.', 'error');
            }
            return;
        }

        // Original path — unchanged. EMPY (or any non-NGN-bank) withdrawal:
        // there's no real fiat transfer to make, so approving just marks it
        // processed.
        try {
            const fv = _fv();
            await window.fbDb.collection('withdrawal_requests').doc(id).update({
                status: 'processed',
                updatedAt: fv ? fv.serverTimestamp() : new Date().toISOString()
            });
            _logAudit('Withdrawal Approved', id);
            _removeFromLocalQueue(id);
            if (itemEl) { itemEl.style.opacity = '0'; setTimeout(function () { itemEl.remove(); if (typeof window.renderAdminQueues === 'function') window.renderAdminQueues(); }, 300); }
            _notify('Withdrawal approved. The member will receive an email confirmation.', 'success');
        } catch (err) {
            console.error('[Patch v48] Approve failed:', err.message);
            _notify('Could not approve withdrawal — please try again.', 'error');
        }
    }

    async function _declineWithdrawal(itemEl, id) {
        if (!_fbOk()) { _notify('Offline — cannot decline right now.', 'error'); return; }
        try {
            const fv = _fv();
            const snap = await window.fbDb.collection('withdrawal_requests').doc(id).get();
            const wd = snap.exists ? snap.data() : null;

            await window.fbDb.collection('withdrawal_requests').doc(id).update({
                status: 'declined',
                updatedAt: fv ? fv.serverTimestamp() : new Date().toISOString()
            });

            // Refund the held amount back onto the user's balance — into
            // whichever field it was actually held from. Real NGN bank
            // withdrawals hold fiatBalance.NGN (see app-marketplace-sellers.js's
            // submit flow); everything else has only ever held empyBalance.
            // Refunding the wrong field here would silently drop the money —
            // e.g. crediting empyBalance while the naira stays "missing" from
            // fiatBalance.NGN forever.
            if (wd && wd.userId && wd.amount) {
                const isNgnBank = _isRealNgnBankPayout(wd);
                const balanceField = isNgnBank ? 'fiatBalance.NGN' : 'empyBalance';
                try {
                    if (fv && typeof fv.increment === 'function') {
                        await window.fbDb.collection('users').doc(wd.userId).update({
                            [balanceField]: fv.increment(wd.amount)
                        });
                    } else {
                        // Fallback for a Firebase SDK build without FieldValue —
                        // read-then-write instead of a blind increment.
                        const uSnap = await window.fbDb.collection('users').doc(wd.userId).get();
                        const uData = uSnap.exists ? (uSnap.data() || {}) : {};
                        const prevBal = isNgnBank
                            ? Number((uData.fiatBalance && uData.fiatBalance.NGN) || 0)
                            : Number(uData.empyBalance || 0);
                        const update = isNgnBank
                            ? { fiatBalance: Object.assign({}, uData.fiatBalance || {}, { NGN: prevBal + Number(wd.amount) }) }
                            : { empyBalance: prevBal + Number(wd.amount) };
                        await window.fbDb.collection('users').doc(wd.userId).update(update);
                    }
                    // If this admin IS looking at their own withdrawal somehow,
                    // or the affected user is the current session, reflect it
                    // immediately rather than waiting for their own reload.
                    const us = _us();
                    if (us && us.id === wd.userId) {
                        if (isNgnBank) {
                            us.fiatBalance = us.fiatBalance || {};
                            us.fiatBalance.NGN = Number(us.fiatBalance.NGN || 0) + Number(wd.amount || 0);
                            if (window.userState) {
                                window.userState.fiatBalance = window.userState.fiatBalance || {};
                                window.userState.fiatBalance.NGN = us.fiatBalance.NGN;
                            }
                        } else {
                            us.empyBalance = Number(us.empyBalance || 0) + Number(wd.amount || 0);
                            if (window.userState) window.userState.empyBalance = us.empyBalance;
                        }
                        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
                        // Best-effort refresh of the seller-profile Earnings block
                        // if it happens to be open — this only runs on the rare
                        // admin-decline path, so a wasted re-fetch when the page
                        // isn't visible is harmless.
                        if (isNgnBank && typeof window._openSellerProfile === 'function' && document.getElementById('seller-profile-page-body')) {
                            window._openSellerProfile(wd.userId);
                        }
                    }
                } catch (refundErr) {
                    console.warn('[Patch v48] Refund on decline failed (non-fatal):', refundErr.message);
                }
            }

            _logAudit('Withdrawal Rejected', id);
            _removeFromLocalQueue(id);
            if (itemEl) { itemEl.style.opacity = '0'; setTimeout(function () { itemEl.remove(); if (typeof window.renderAdminQueues === 'function') window.renderAdminQueues(); }, 300); }
            _notify('Withdrawal declined and refunded. The member will receive an email.', 'info');
        } catch (err) {
            console.error('[Patch v48] Decline failed:', err.message);
            _notify('Could not decline withdrawal — please try again.', 'error');
        }
    }

    function _removeFromLocalQueue(id) {
        try {
            const q = window.mockAdminWithdrawalQueue || [];
            window.mockAdminWithdrawalQueue = q.filter(function (i) { return i.id !== id; });
        } catch (e) {}
    }

    function _logAudit(action, id) {
        try {
            if (!window.empyreanAuditLog) window.empyreanAuditLog = [];
            window.empyreanAuditLog.unshift({
                timestamp: new Date().toLocaleString(),
                admin: (_us().username) || 'admin',
                action, targetUser: id, details: 'Withdrawal request ' + id,
                id: 'audit-' + Date.now()
            });
        } catch (e) {}
        // Best-effort Firestore audit trail too, matching the shape
        // app-fixes.js's local logAuditAction otherwise only kept in memory.
        try {
            if (_fbOk()) {
                window.fbDb.collection('admin_audit_log').add({
                    action, targetId: id, admin: (_us().email) || 'admin',
                    createdAt: new Date().toISOString()
                }).catch(function () {});
            }
        } catch (e) {}
    }

    document.addEventListener('click', function (e) {
        const approveBtn = _closest(e.target, '.approve-withdrawal-btn');
        const rejectBtn = _closest(e.target, '.reject-withdrawal-btn');
        if (!approveBtn && !rejectBtn) return;

        const itemEl = _closest(e.target, '.admin-queue-item');
        if (!itemEl) return;
        const actionType = itemEl.parentElement ? itemEl.parentElement.id : '';
        if (actionType !== 'admin-withdrawal-queue') return; // not our concern — let app-fixes.js's handler run (e.g. SOS uses a different container)

        // Capture-phase stop: pre-empts app-fixes.js's admin-queue click
        // handler (~L6971), which only ever mutated the local mock array.
        e.preventDefault();
        e.stopImmediatePropagation();

        const id = itemEl.dataset.id;
        if (!id) return;
        if (approveBtn) _approveWithdrawal(itemEl, id);
        else _declineWithdrawal(itemEl, id);
    }, true);

    /* =========================================================================
       3) LIVE ADMIN QUEUE — loads real pending withdrawal_requests into
          mockAdminWithdrawalQueue (admin-only), same pattern as the existing
          _sosListener/_usersListener realtime listeners elsewhere in the app.
       ========================================================================= */
    function _startWithdrawalQueueListener() {
        if (!_isAdmin() || !_fbOk() || window._withdrawalQueueListener) return;
        window._withdrawalQueueListener = window.fbDb.collection('withdrawal_requests')
            .where('status', '==', 'pending')
            .onSnapshot(function (snap) {
                if (!snap) return;
                const q = window.mockAdminWithdrawalQueue || [];
                snap.docChanges().forEach(function (change) {
                    const d = change.doc.data() || {};
                    d.id = change.doc.id;
                    if (change.type === 'removed') {
                        window.mockAdminWithdrawalQueue = (window.mockAdminWithdrawalQueue || []).filter(function (i) { return i.id !== d.id; });
                        return;
                    }
                    const existingIdx = q.findIndex(function (i) { return i.id === d.id; });
                    if (existingIdx === -1) q.push(d); else q[existingIdx] = d;
                });
                window.mockAdminWithdrawalQueue = q;
                if (typeof window.renderAdminQueues === 'function') window.renderAdminQueues();
            }, function (err) {
                console.warn('[Patch v48] withdrawal_requests listener error:', err.message);
                window._withdrawalQueueListener = null;
            });
        console.log('[Patch v48] \u2705 withdrawal_requests admin listener active');
    }

    document.addEventListener('empyrean-init-done', _startWithdrawalQueueListener);
    // Also try shortly after boot in case init-done already fired before this
    // script attached (same fallback timing app-startup.js uses elsewhere).
    setTimeout(_startWithdrawalQueueListener, 4000);

    console.log('[Patch v48] Withdrawal persistence + admin approve/decline wiring loaded.');
})();

/* ---------------------------------------------------------------------------
   FIRESTORE SECURITY RULES — add wherever the project's other rules live
   (not applied automatically by this file):

   match /withdrawal_requests/{requestId} {
     allow create: if request.auth != null
                   && request.resource.data.userId == request.auth.uid;
     allow read:   if request.auth != null
                   && (resource.data.userId == request.auth.uid || isAdmin());
     allow update: if request.auth != null && isAdmin(); // only admin flips status
     allow delete: if request.auth != null && isAdmin();
   }
   ============================================================================= */