/* =============================================================================
   EMPYREAN INTERNATIONAL — P2P TOKEN TRADING (frontend + escrow logic)
   app-p2p-trading.js  |  standalone module, mounts into #p2p-trading-panel

   BACKGROUND: none of this existed anywhere in the codebase. The design
   spec calls for "users can sell their EMPY tokens directly to other
   users... exchanged for cash or naira equivalent" — a genuine peer-to-
   peer market, distinct from the platform-run cash-out queue
   (app-patch-v48.js) and from wallet-to-wallet transfers (app-patch-v49.js,
   which move EMPY with no cash changing hands).

   MODEL CHOSEN (listing board + escrow, the standard safe pattern for this
   kind of feature — same shape as most P2P crypto-trading products):
     1. Seller posts a listing: amount of EMPY, price per token in NGN, and
        how a buyer should pay them (bank details / other instructions).
        The instant a listing is created, that EMPY amount is moved OUT of
        the seller's spendable empyBalance and held on the listing doc
        itself — a seller can never oversell the same tokens across two
        listings, and can't spend tokens that are actively listed.
     2. A buyer reserves some or all of a listing, creating a `trade` doc.
        The reserved amount is removed from the listing's remaining pool
        atomically (Firestore transaction — two buyers reserving the same
        moment can't both succeed on tokens that only exist once).
     3. The buyer pays the seller OFF-PLATFORM (bank transfer, cash, etc,
        using the details the seller posted) and marks the trade "I've
        Paid". This app never touches real naira for this flow — same
        trust boundary as the SOS "Bank Transfer" donation tab already
        does (a static account number, no automatic confirmation).
     4. The seller confirms they received payment, which releases the
        escrowed EMPY into the buyer's empyBalance.
     5. Either side can flag a trade as disputed at any point after
        reservation, if something goes wrong. Disputed trades are NOT
        auto-resolved by this file — they sit in Firestore with
        status:'disputed' for an admin to manually investigate and decide
        (refund the buyer's escrow claim vs. release to seller). No admin
        UI ships with this file yet; the data model supports one being
        added on top later exactly the way the withdrawal queue's
        admin-approve UI was added on top of its own collection.

   Firestore rules this depends on (already added to firebase-rules.js):
     - p2p_listings / p2p_trades match blocks
     - isEmpyBalanceCreditOnlyUpdate — lets a seller's release (or, later,
       an admin's dispute resolution) credit the BUYER's empyBalance, a
       doc they don't own.

   LOAD ORDER: after firebase-init, app-wallet.js (uses window.updateWalletUI,
   _rate()-style formatting helpers). Mounts into #p2p-trading-panel-container,
   which lives in the wallet section of index.html, right after the
   Internal Transfer card.
   ============================================================================= */

(function empyreanP2PTradingModule() {
    'use strict';

    if (window._empyreanP2PLoaded) {
        console.warn('[P2P] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanP2PLoaded = true;

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _us()    { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _guest() { var s = window.EmpState || {}; return s.isGuest != null ? s.isGuest : !!window.isGuest; }
    function _fbOk()  { return !!(window._firebaseLoaded && window.fbDb); }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); }
    function _openAuth() {
        var m = document.getElementById('auth-modal-overlay');
        if (m) { m.style.display = 'flex'; m.classList.add('show'); document.body.classList.add('modal-open'); }
    }
    function _fmtNgn(v) {
        return typeof window.formatNgnPrice === 'function' ? window.formatNgnPrice(v) : ('\u20a6' + Number(v || 0).toLocaleString());
    }

    /* =========================================================================
       Rendering
       ========================================================================= */
    function renderP2PPanel() {
        var container = document.getElementById('p2p-trading-panel-container');
        if (!container) return;

        container.innerHTML =
            '<div class="card" style="margin-bottom:16px;">'
            + '<div class="card-content">'
            + '<h3><i class="fas fa-people-arrows"></i> P2P Trading — Sell EMPY for Cash</h3>'
            + '<p style="font-size:var(--text-md);margin-bottom:15px;">List EMPY tokens for sale to other Empyrean members. Your tokens are held safely in escrow the moment you list them, and only released once you confirm you\u2019ve been paid.</p>'
            + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">'
            + '<button class="btn btn-small btn-accent" id="p2p-new-listing-btn"><i class="fas fa-plus"></i> Sell EMPY</button>'
            + '<button class="btn btn-small" id="p2p-refresh-btn"><i class="fas fa-rotate"></i> Refresh</button>'
            + '</div>'
            + '<div id="p2p-new-listing-form-wrap" style="display:none;margin-bottom:16px;"></div>'
            + '<div id="p2p-my-activity"></div>'
            + '<hr style="border:1px solid var(--color-neutral-100);margin:16px 0;">'
            + '<h4 style="margin-bottom:10px;">Open Listings</h4>'
            + '<div id="p2p-listings-list"><p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p></div>'
            + '</div></div>';

        _loadListings();
        _loadMyActivity();
    }
    window.renderP2PPanel = renderP2PPanel;

    /* ---- new-listing form ---- */
    function _showNewListingForm() {
        var wrap = document.getElementById('p2p-new-listing-form-wrap');
        if (!wrap) return;
        wrap.style.display = 'block';
        wrap.innerHTML =
            '<div style="background:rgba(0,0,0,0.03);border-radius:12px;padding:14px;">'
            + '<div class="form-group"><label>Amount of EMPY to Sell</label><input type="number" id="p2p-listing-amount" min="1" placeholder="e.g., 500"></div>'
            + '<div class="form-group"><label>Price per EMPY (NGN)</label><input type="number" id="p2p-listing-price" min="1" placeholder="e.g., 150"></div>'
            + '<div class="form-group"><label>How should a buyer pay you?</label><textarea id="p2p-listing-payment-details" rows="2" placeholder="e.g., Bank: GTBank, Acct: 0123456789, Name: Jane Doe"></textarea></div>'
            + '<div style="display:flex;gap:10px;">'
            + '<button class="btn btn-small btn-accent" id="p2p-submit-listing-btn"><i class="fas fa-check"></i> Create Listing</button>'
            + '<button class="btn btn-small" id="p2p-cancel-new-listing-btn">Cancel</button>'
            + '</div></div>';
    }

    function _closeNewListingForm() {
        var wrap = document.getElementById('p2p-new-listing-form-wrap');
        if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
    }

    function _submitNewListing() {
        if (_guest()) { _openAuth(); return; }
        if (!_fbOk()) { _notify('Offline — cannot create a listing right now.', 'error'); return; }
        var us = _us();

        var amount = parseFloat((document.getElementById('p2p-listing-amount') || {}).value || 0);
        var price  = parseFloat((document.getElementById('p2p-listing-price')  || {}).value || 0);
        var details = ((document.getElementById('p2p-listing-payment-details') || {}).value || '').trim();

        if (!amount || amount <= 0) { _notify('Enter a valid amount of EMPY to sell.', 'error'); return; }
        if (!price  || price  <= 0) { _notify('Enter a valid price per EMPY.', 'error'); return; }
        if (!details) { _notify('Tell buyers how to pay you.', 'error'); return; }
        if (Number(us.empyBalance || 0) < amount) { _notify('Insufficient EMPY balance to list that amount.', 'error'); return; }

        var btn = document.getElementById('p2p-submit-listing-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Creating…'; }

        var userRef = window.fbDb.collection('users').doc(us.id);
        // Escrow the tokens out of the seller's spendable balance the
        // moment the listing is created — a single transaction so this
        // can't race against another spend (gift, transfer, withdrawal)
        // happening in the same instant.
        window.fbDb.runTransaction(function (tx) {
            return tx.get(userRef).then(function (snap) {
                var bal = Number((snap.data() || {}).empyBalance || 0);
                if (bal < amount) throw new Error('INSUFFICIENT_BALANCE');
                tx.update(userRef, { empyBalance: bal - amount });
            });
        }).then(function () {
            us.empyBalance = Number(us.empyBalance || 0) - amount;
            if (window.userState) window.userState.empyBalance = us.empyBalance;
            if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

            return window.fbDb.collection('p2p_listings').add({
                sellerUserId:     us.id,
                sellerUsername:   us.username || us.fullName || 'Anonymous',
                amountEmpy:       amount,
                amountRemaining:  amount,
                priceNgnPerEmpy:  price,
                paymentDetails:   details,
                status:           'open',
                createdAt:        new Date().toISOString()
            });
        }).then(function () {
            _notify('\u2705 Listing created — ' + amount.toLocaleString() + ' EMPY held in escrow.', 'success');
            _closeNewListingForm();
            _loadListings();
        }).catch(function (err) {
            var msg = err && err.message;
            if (msg === 'INSUFFICIENT_BALANCE') _notify('Insufficient EMPY balance to list that amount.', 'error');
            else { console.error('[P2P] Listing creation failed:', msg); _notify('Could not create listing: ' + (msg || 'Unknown error'), 'error'); }
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Create Listing'; }
        });
    }

    /* ---- listings list ---- */
    function _loadListings() {
        var el = document.getElementById('p2p-listings-list');
        if (!el) return;
        if (!_fbOk()) { el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Offline — cannot load listings.</p>'; return; }

        window.fbDb.collection('p2p_listings').where('status', '==', 'open').limit(50).get()
            .then(function (snap) {
                var us = _us();
                var rows = [];
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    if (Number(d.amountRemaining || 0) <= 0) return;
                    rows.push(Object.assign({ id: doc.id }, d));
                });
                if (!rows.length) {
                    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No open listings right now.</p>';
                    return;
                }
                el.innerHTML = rows.map(function (r) {
                    var isMine = r.sellerUserId === us.id;
                    return '<div style="border:1px solid rgba(10,14,39,0.08);border-radius:12px;padding:12px 14px;margin-bottom:10px;">'
                        + '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">'
                        + '<div><strong>' + _esc(r.amountRemaining.toLocaleString()) + ' EMPY</strong> available'
                        + '<div style="font-size:0.78rem;color:var(--text-muted);">Seller: ' + _esc(r.sellerUsername) + (isMine ? ' (you)' : '') + '</div></div>'
                        + '<div style="text-align:right;"><strong>' + _esc(_fmtNgn(r.priceNgnPerEmpy)) + '</strong> / EMPY'
                        + '<div style="font-size:0.78rem;color:var(--text-muted);">Total: ' + _esc(_fmtNgn(r.priceNgnPerEmpy * r.amountRemaining)) + '</div></div>'
                        + '</div>'
                        + (isMine
                            ? '<div style="margin-top:8px;"><button class="btn btn-small" style="background:#ef4444;color:#fff;" onclick="window._p2pCancelListing(\'' + r.id + '\')"><i class="fas fa-ban"></i> Cancel Listing</button></div>'
                            : '<div style="margin-top:8px;"><button class="btn btn-small btn-accent" onclick="window._p2pOpenBuyForm(\'' + r.id + '\')"><i class="fas fa-hand-holding-usd"></i> Buy</button></div>')
                        + '<div id="p2p-buy-form-' + r.id + '"></div>'
                        + '</div>';
                }).join('');
            })
            .catch(function (err) {
                el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Could not load listings: ' + _esc(err.message || '') + '</p>';
            });
    }

    window._p2pOpenBuyForm = function (listingId) {
        var wrap = document.getElementById('p2p-buy-form-' + listingId);
        if (!wrap) return;
        if (wrap.innerHTML) { wrap.innerHTML = ''; return; } // toggle closed
        wrap.innerHTML =
            '<div style="margin-top:10px;background:rgba(0,0,0,0.03);border-radius:10px;padding:10px;">'
            + '<div class="form-group"><label>Amount of EMPY to Buy</label><input type="number" id="p2p-buy-amount-' + listingId + '" min="1"></div>'
            + '<button class="btn btn-small btn-accent" onclick="window._p2pReserve(\'' + listingId + '\')"><i class="fas fa-check"></i> Reserve &amp; See Payment Details</button>'
            + '</div>';
    };

    window._p2pReserve = function (listingId) {
        if (_guest()) { _openAuth(); return; }
        if (!_fbOk()) { _notify('Offline — cannot reserve right now.', 'error'); return; }
        var us = _us();
        var input = document.getElementById('p2p-buy-amount-' + listingId);
        var amount = parseFloat((input && input.value) || 0);
        if (!amount || amount <= 0) { _notify('Enter a valid amount to buy.', 'error'); return; }

        var listingRef = window.fbDb.collection('p2p_listings').doc(listingId);
        var listingData = null;

        window.fbDb.runTransaction(function (tx) {
            return tx.get(listingRef).then(function (snap) {
                if (!snap.exists) throw new Error('LISTING_GONE');
                var d = snap.data() || {};
                if (d.status !== 'open') throw new Error('LISTING_CLOSED');
                if (d.sellerUserId === us.id) throw new Error('OWN_LISTING');
                var remaining = Number(d.amountRemaining || 0);
                if (remaining < amount) throw new Error('NOT_ENOUGH_REMAINING');
                listingData = d;
                tx.update(listingRef, {
                    amountRemaining: remaining - amount,
                    status: (remaining - amount) <= 0 ? 'closed' : 'open'
                });
            });
        }).then(function () {
            return window.fbDb.collection('p2p_trades').add({
                listingId:      listingId,
                sellerUserId:   listingData.sellerUserId,
                sellerUsername: listingData.sellerUsername,
                buyerUserId:    us.id,
                buyerUsername:  us.username || us.fullName || 'Anonymous',
                amountEmpy:     amount,
                priceNgnTotal:  amount * Number(listingData.priceNgnPerEmpy || 0),
                paymentDetails: listingData.paymentDetails,
                status:         'awaiting_payment',
                createdAt:      new Date().toISOString(),
                updatedAt:      new Date().toISOString()
            });
        }).then(function () {
            _notify('\u2705 Reserved ' + amount.toLocaleString() + ' EMPY. Pay the seller using their posted details, then mark the trade as paid.', 'success');
            _loadListings();
            _loadMyActivity();
        }).catch(function (err) {
            var msg = err && err.message;
            var human = {
                LISTING_GONE: 'That listing no longer exists.',
                LISTING_CLOSED: 'That listing is no longer open.',
                OWN_LISTING: 'You can\u2019t buy your own listing.',
                NOT_ENOUGH_REMAINING: 'Not enough EMPY remaining on that listing — try a smaller amount.'
            }[msg];
            _notify(human || ('Could not reserve: ' + (msg || 'Unknown error')), 'error');
        });
    };

    window._p2pCancelListing = function (listingId) {
        if (_guest()) { _openAuth(); return; }
        var us = _us();
        if (!us.id) { _notify('Could not identify your account — please sign in again.', 'error'); return; }

        // FIX (2026-07-31 — token-ecosystem security review): this used to
        // run a raw client Firestore transaction that read the listing's
        // own amountRemaining and credited it straight to empyBalance via
        // the general owner-write rule — a legitimate self-credit, but one
        // that rule can't distinguish from an arbitrary self-mint. Now goes
        // through /api/p2p/cancel-listing (server.js), which re-reads
        // amountRemaining server-side inside its own Admin SDK transaction
        // and is the only thing that can credit empyBalance for this flow
        // now (see firebase-rules.js's isSelfEmpyBalanceNonIncreasing).
        fetch(window._empApiBase() + '/api/p2p/cancel-listing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: us.id, listingId: listingId })
        }).then(function (r) {
            return r.json().then(function (data) {
                if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                return data;
            });
        }).then(function (data) {
            if (typeof data.newBalance === 'number') us.empyBalance = data.newBalance;
            if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
            _notify(data.alreadyCancelled
                ? 'That listing was already cancelled.'
                : 'Listing cancelled — any unsold EMPY has been refunded to your balance.', 'success');
            _loadListings();
        }).catch(function (err) {
            var human = {
                LISTING_GONE: 'That listing no longer exists.',
                NOT_YOURS: 'That listing isn\u2019t yours to cancel.'
            }[err && err.message];
            _notify(human || ('Could not cancel listing: ' + (err && err.message || 'Unknown error')), 'error');
        });
    };

    /* ---- my active trades (as buyer or seller) ---- */
    function _loadMyActivity() {
        var el = document.getElementById('p2p-my-activity');
        if (!el || !_fbOk() || _guest()) { if (el) el.innerHTML = ''; return; }
        var us = _us();

        Promise.all([
            window.fbDb.collection('p2p_trades').where('buyerUserId', '==', us.id).get(),
            window.fbDb.collection('p2p_trades').where('sellerUserId', '==', us.id).get()
        ]).then(function (results) {
            var rows = [];
            results[0].forEach(function (d) { rows.push(Object.assign({ id: d.id, role: 'buyer' }, d.data())); });
            results[1].forEach(function (d) { rows.push(Object.assign({ id: d.id, role: 'seller' }, d.data())); });
            rows = rows.filter(function (r) { return r.status !== 'released' && r.status !== 'cancelled'; });

            if (!rows.length) { el.innerHTML = ''; return; }

            el.innerHTML = '<h4 style="margin-bottom:10px;">Your Active Trades</h4>' + rows.map(function (r) {
                var counterparty = r.role === 'buyer' ? r.sellerUsername : r.buyerUsername;
                var actions = '';
                if (r.role === 'buyer' && r.status === 'awaiting_payment') {
                    actions = '<button class="btn btn-small btn-accent" onclick="window._p2pMarkPaid(\'' + r.id + '\')">I\u2019ve Paid</button>'
                        + '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px;">Pay using: ' + _esc(r.paymentDetails || '') + '</p>';
                } else if (r.role === 'seller' && r.status === 'payment_claimed') {
                    actions = '<button class="btn btn-small" style="background:#22c55e;color:#fff;" onclick="window._p2pReleaseEscrow(\'' + r.id + '\')">Confirm Received &amp; Release</button>';
                }
                var disputeBtn = (r.status !== 'disputed')
                    ? ' <button class="btn btn-small" style="background:#f59e0b;color:#fff;" onclick="window._p2pDispute(\'' + r.id + '\')">Report Issue</button>'
                    : '';
                return '<div style="border:1px solid rgba(10,14,39,0.08);border-radius:12px;padding:12px 14px;margin-bottom:10px;">'
                    + '<div><strong>' + _esc(r.amountEmpy.toLocaleString()) + ' EMPY</strong> \u2014 ' + _esc(_fmtNgn(r.priceNgnTotal)) + '</div>'
                    + '<div style="font-size:0.78rem;color:var(--text-muted);">You are the ' + r.role + ' \u00b7 counterparty: ' + _esc(counterparty) + ' \u00b7 status: ' + _esc(r.status) + '</div>'
                    + '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' + actions + disputeBtn + '</div>'
                    + '</div>';
            }).join('');
        }).catch(function (err) {
            el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Could not load your trades: ' + _esc(err.message || '') + '</p>';
        });
    }

    window._p2pMarkPaid = function (tradeId) {
        if (!_fbOk()) return;
        window.fbDb.collection('p2p_trades').doc(tradeId).update({
            status: 'payment_claimed', updatedAt: new Date().toISOString()
        }).then(function () {
            _notify('Marked as paid — waiting for the seller to confirm and release your EMPY.', 'success');
            _loadMyActivity();
        }).catch(function (err) { _notify('Could not update trade: ' + (err && err.message || ''), 'error'); });
    };

    window._p2pReleaseEscrow = function (tradeId) {
        if (_guest()) { _openAuth(); return; }
        var us = _us();
        if (!us.id) { _notify('Could not identify your account — please sign in again.', 'error'); return; }

        // FIX (2026-07-31 — token-ecosystem security review): this used to
        // read the trade doc client-side and credit the BUYER's empyBalance
        // directly via two separate, un-transacted writes, with no check
        // that the buyer had even marked the trade paid yet. Now goes
        // through /api/p2p/release-escrow (server.js), one Admin SDK
        // transaction that also requires status === 'payment_claimed' first.
        fetch(window._empApiBase() + '/api/p2p/release-escrow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: us.id, tradeId: tradeId })
        }).then(function (r) {
            return r.json().then(function (data) {
                if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                return data;
            });
        }).then(function (data) {
            _notify(data.alreadyReleased
                ? 'That trade was already released.'
                : '\u2705 EMPY released to the buyer. Trade complete.', 'success');
            _loadMyActivity();
        }).catch(function (err) {
            var human = {
                'Trade not found.': 'That trade could not be found.',
                'Only the seller can release this trade.': 'Only the seller can release this trade.',
                'The buyer hasn\u2019t marked this trade as paid yet.': 'The buyer hasn\u2019t marked this trade as paid yet.'
            }[err && err.message];
            _notify(human || ('Could not release escrow: ' + (err && err.message || 'Unknown error')), 'error');
        });
    };

    window._p2pDispute = function (tradeId) {
        if (!_fbOk()) return;
        var ok = window.confirm ? window.confirm('Flag this trade for admin review? Only do this if something went wrong.') : true;
        if (!ok) return;
        window.fbDb.collection('p2p_trades').doc(tradeId).update({
            status: 'disputed', updatedAt: new Date().toISOString()
        }).then(function () {
            _notify('Trade flagged for admin review.', 'info');
            _loadMyActivity();
        }).catch(function (err) { _notify('Could not flag trade: ' + (err && err.message || ''), 'error'); });
    };

    /* ---- wiring ---- */
    document.addEventListener('click', function (e) {
        if (e.target.closest('#p2p-new-listing-btn')) { _showNewListingForm(); return; }
        if (e.target.closest('#p2p-cancel-new-listing-btn')) { _closeNewListingForm(); return; }
        if (e.target.closest('#p2p-submit-listing-btn')) { _submitNewListing(); return; }
        if (e.target.closest('#p2p-refresh-btn')) { _loadListings(); _loadMyActivity(); return; }
    });

    document.addEventListener('empyrean-init-done', function () {
        setTimeout(renderP2PPanel, 300);
    });

    console.log('[EmpyreanP2PTrading] \u2705 P2P listing board + escrow wired.');

})();