/* =============================================================================
   EMPYREAN INTERNATIONAL — DEBIT CARD EMPY TOKEN PURCHASE
   app-token-purchase.js  |  Step 0.16  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Handles all debit-card / Flutterwave token purchase flows. This section
   was MISSING from the slimmed app-fix refactor. Covers:

     • Buy EMPY with debit card via Flutterwave (NGN → EMPY)
     • Buy EMPY preview (amount input → EMPY calculation display)
     • Buy EMPY with EMPY balance (internal wallet transfer)
     • updateWalletUI()             — refreshes all wallet balance displays
     • updateWithdrawalPreview()    — live withdrawal amount preview
     • updateTransferPreview()      — live P2P transfer preview
     • updateCrossChainTransferPreview() — cross-chain amount preview
     • handleWithdrawalMethodChange()    — show/hide withdrawal form fields
     • Referral link display + copy in wallet / settings
     • Marketplace escrow checkout (FlutterwaveCheckout for cart)
     • Promotion card payment (card flow for boosted posts)

   FLUTTERWAVE INTEGRATION
   ───────────────────────
   Public key read from: window._appConfig.flutterwave.publicKey
   The FlutterwaveCheckout global is loaded from Flutterwave's CDN script tag
   (must be present in the HTML before this script runs):
     <script src="https://checkout.flutterwave.com/v3.js"></script>

   LOAD ORDER
   ──────────
   Must come AFTER: firebase-init, app-state, app-helpers, app-impact-mining.

   DEPENDS ON
   ──────────
   • window.EmpState.*               — userState, cart, EMPY_RATE_USD, USD_TO_NGN_RATE
   • window.showNotification         (app-helpers.js)
   • window.rewardUserForAction      (app-impact-mining.js)
   • window.FlutterwaveCheckout      (Flutterwave CDN)

   PUBLIC API
   ──────────
   window.updateWalletUI()
   window.updateWithdrawalPreview()
   window.updateTransferPreview()
   window.updateCrossChainTransferPreview()
   window.handleWithdrawalMethodChange()
   window.initBuyEmpyModal()

   SECTION MAP
   ───────────
   §1  updateWalletUI()                — refresh wallet balance displays
   §2  Buy EMPY with debit card        — Flutterwave modal + NGN → EMPY calc
   §3  Buy EMPY amount input preview   — live "You will receive X EMPY" display
   §4  Withdrawal preview + method change
   §5  P2P transfer preview
   §6  Cross-chain transfer preview
   §7  Marketplace escrow checkout     — FlutterwaveCheckout for cart items
   §8  Promotion card payment          — promo-finalize-form card branch
   §9  Referral link in wallet / settings
   §10 Bootstrap + event wiring

   ============================================================================= */

(function empyreanTokenPurchaseModule() {
    'use strict';

    if (window._empyreanTokenPurchaseLoaded) {
        console.warn('[EmpTokenPurchase] Already loaded — skipping.');
        return;
    }
    window._empyreanTokenPurchaseLoaded = true;

    /* ── State helpers ── */
    function _S()   { return window.EmpState || {}; }
    function _us()  { return _S().userState  || window.userState  || {}; }

    function _getConst(name, fallback) {
        var s = _S();
        return (s[name] != null) ? s[name] : (window[name] != null ? window[name] : fallback);
    }

    var _EMPY_RATE   = function () { return _getConst('EMPY_RATE_USD',   0.10); };
    var _NGN_RATE    = function () { return _getConst('USD_TO_NGN_RATE', 1500); };
    var _FEE_PCT     = function () { return _getConst('CRYPTO_FEE_PERCENT', 1.5); };

    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type);
    }
    function _reward(action) {
        if (typeof window.rewardUserForAction === 'function') window.rewardUserForAction(action);
    }
    function _fmt(n, dec) {
        return parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: dec || 0, maximumFractionDigits: dec != null ? dec : 2 });
    }
    function _fmtNgn(usd) {
        return '₦' + Math.round((parseFloat(usd) || 0) * _NGN_RATE()).toLocaleString();
    }


    /* =========================================================================
       §1  updateWalletUI
       Refreshes all EMPY balance displays across the page.
       Call after any balance change.
       ========================================================================= */

    function updateWalletUI() {
        var us = _us();
        var bal = parseFloat(us.empyBalance || 0);
        var usdVal = bal * _EMPY_RATE();
        var ngnVal = usdVal * _NGN_RATE();

        /* Primary balance displays */
        var selectors = [
            '#wallet-empy-balance',
            '#dashboard-empy-balance',
            '#nav-empy-balance',
            '.empy-balance-display',
            '.wallet-empy-amount'
        ];
        selectors.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (el) {
                el.textContent = _fmt(bal, 2);
            });
        });

        /* USD equivalent */
        document.querySelectorAll('#wallet-usd-value, .wallet-usd-value').forEach(function (el) {
            el.textContent = '$' + _fmt(usdVal, 2);
        });

        /* NGN equivalent */
        document.querySelectorAll('#wallet-ngn-value, .wallet-ngn-value').forEach(function (el) {
            el.textContent = '₦' + _fmt(ngnVal, 0);
        });

        /* Staking balances */
        var locked  = _getConst('userLockedStakedBalance',  0);
        var manual  = _getConst('userManualStakedBalance',  0);
        var earned  = _getConst('userEarnedRewards',         0);
        document.querySelectorAll('#wallet-locked-balance, .locked-balance-display').forEach(function (el) {
            el.textContent = _fmt(locked, 2) + ' EMPY';
        });
        document.querySelectorAll('#wallet-staked-balance, .staked-balance-display').forEach(function (el) {
            el.textContent = _fmt(manual, 2) + ' EMPY';
        });
        document.querySelectorAll('#wallet-earned-rewards, .earned-rewards-display').forEach(function (el) {
            el.textContent = _fmt(earned, 2) + ' EMPY';
        });

        /* Impact mining pool pct */
        if (typeof window.getImpactMiningStats === 'function') {
            var stats = window.getImpactMiningStats();
            document.querySelectorAll('#impact-pool-pct').forEach(function (el) {
                el.textContent = stats.pct.toFixed(1) + '%';
            });
        }
    }
    window.updateWalletUI = updateWalletUI;


    /* =========================================================================
       §2  BUY EMPY WITH DEBIT CARD
       Opens Flutterwave checkout for NGN → EMPY purchase.
       Wired to #buy-empy-card-btn and the buy-empy-modal submit.
       ========================================================================= */

    /**
     * Initiates a Flutterwave card payment to purchase EMPY tokens.
     * @param {number} amountNgn  — NGN amount the user wants to spend
     */
    function buyEmpyWithCard(amountNgn) {
        amountNgn = parseFloat(amountNgn) || 0;
        if (amountNgn < 100) {
            _notify('Minimum purchase is ₦100.', 'error');
            return;
        }

        var us = _us();
        var empyToReceive = Math.floor((amountNgn / _NGN_RATE()) / _EMPY_RATE());

        if (typeof window.FlutterwaveCheckout !== 'function') {
            _notify('Payment gateway not loaded. Please refresh and try again.', 'error');
            return;
        }

        var buyTxRef = 'EMPY-BUY-' + Date.now();

        window.FlutterwaveCheckout({
            public_key: (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '',
            tx_ref:     buyTxRef,
            amount:     amountNgn,
            currency:   'NGN',
            payment_options: 'card,ussd,banktransfer',
            customer: {
                email:        us.email        || 'user@empyrean.app',
                phone_number: us.phone        || '',
                name:         us.fullName     || us.username || 'Empyrean User'
            },
            customizations: {
                title:       'Buy EMPY Tokens',
                description: 'Purchase ' + empyToReceive.toLocaleString() + ' EMPY tokens on Empyrean International.',
                logo:        'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
            },
            callback: function (data) {
                if (data.status !== 'successful') {
                    _notify('Payment was not completed. Please try again.', 'error');
                    return;
                }

                /* SECURITY: EMPY is credited server-side ONLY, from here on —
                   /api/wallet/confirm-purchase independently re-verifies this
                   tx_ref against Flutterwave's own API (using the server-only
                   secret key) and computes the EMPY amount itself from the
                   confirmed charge, rather than trusting this client callback
                   or the `empyToReceive` this file already calculated. That
                   client-trust gap (this callback used to credit empyBalance
                   directly) is exactly what let anyone mint free EMPY by
                   invoking this callback from the browser console. */
                _notify('Payment received — confirming with the server…', 'info');

                fetch('/api/wallet/confirm-purchase', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ txRef: data.tx_ref || buyTxRef, userId: us.id })
                })
                    .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
                    .then(function (res) {
                        if (!res.ok) {
                            _notify('Payment received but could not be confirmed: ' + (res.body && res.body.error ? res.body.error : 'unknown error') + '. Contact support with your reference: ' + (data.tx_ref || buyTxRef), 'error');
                            return;
                        }
                        var credited = res.body.empyAmount;
                        if (typeof res.body.newBalance === 'number') us.empyBalance = res.body.newBalance;
                        updateWalletUI();
                        _notify('✅ ' + credited.toLocaleString() + ' EMPY credited to your wallet!', 'success');

                        var modal = document.getElementById('buy-empy-modal');
                        if (modal) modal.classList.remove('show');
                        document.body.classList.remove('modal-open');
                    })
                    .catch(function (err) {
                        _notify('Payment received but the confirmation request failed: ' + (err && err.message ? err.message : 'network error') + '. Contact support with your reference: ' + (data.tx_ref || buyTxRef), 'error');
                    });
            },
            onclose: function () {}
        });
    }
    window.buyEmpyWithCard = buyEmpyWithCard;


    /**
     * Initialises the buy-EMPY modal — amount preview + submit handler.
     * Safe to call multiple times (guards with data attribute).
     */
    function initBuyEmpyModal() {
        var modal = document.getElementById('buy-empy-modal');
        if (!modal || modal.dataset.buyEmpyWired === '1') return;
        modal.dataset.buyEmpyWired = '1';

        /* Live preview: NGN amount → EMPY to receive */
        var amountInput = document.getElementById('buy-empy-amount-usd'); /* field contains NGN despite ID */
        var previewEl   = document.getElementById('empy-to-receive-preview');

        function _updatePreview() {
            if (!amountInput || !previewEl) return;
            var ngn = parseFloat(amountInput.value) || 0;
            if (ngn > 0) {
                var empy = Math.floor((ngn / _NGN_RATE()) / _EMPY_RATE());
                previewEl.textContent = 'You will receive: ' + empy.toLocaleString() + ' EMPY';
            } else {
                previewEl.textContent = '';
            }
        }
        if (amountInput) amountInput.addEventListener('input', _updatePreview);

        /* Confirm / submit button */
        var confirmBtn = document.getElementById('buy-empy-confirm-btn')
            || modal.querySelector('button[type="submit"], .buy-empy-submit-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', function (e) {
                e.preventDefault();
                var ngn = parseFloat((amountInput && amountInput.value) || 0);
                buyEmpyWithCard(ngn);
            });
        }

        /* Also wire form submit if wrapped in a <form> */
        var form = modal.querySelector('form');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var ngn = parseFloat((amountInput && amountInput.value) || 0);
                buyEmpyWithCard(ngn);
            });
        }
    }
    window.initBuyEmpyModal = initBuyEmpyModal;


    /* =========================================================================
       §3  BUY EMPY AMOUNT INPUT — live preview (delegated for late-injected modals)
       ========================================================================= */

    document.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'buy-empy-amount-usd') {
            var ngn = parseFloat(e.target.value) || 0;
            var preview = document.getElementById('empy-to-receive-preview');
            if (preview) {
                if (ngn > 0) {
                    var empy = Math.floor((ngn / _NGN_RATE()) / _EMPY_RATE());
                    preview.textContent = 'You will receive: ' + empy.toLocaleString() + ' EMPY';
                } else {
                    preview.textContent = '';
                }
            }
        }
    });


    /* =========================================================================
       §4  WITHDRAWAL PREVIEW + METHOD CHANGE
       ========================================================================= */

    function updateWithdrawalPreview() {
        var amountInput = document.getElementById('withdrawal-amount');
        if (!amountInput) return;
        var amountEmpy = parseFloat(amountInput.value) || 0;
        var amountUsd  = amountEmpy * _EMPY_RATE();
        var fee        = amountUsd * (_FEE_PCT() / 100);
        var net        = amountUsd - fee;
        var amountNgn  = net * _NGN_RATE();

        var selectors = {
            '#withdrawal-empy-amount':   amountEmpy.toFixed(2) + ' EMPY',
            '#withdrawal-usd-amount':    '$' + amountUsd.toFixed(2),
            '#withdrawal-fee-amount':    '$' + fee.toFixed(2) + ' (' + _FEE_PCT() + '%)',
            '#withdrawal-net-amount':    '$' + net.toFixed(2),
            '#withdrawal-ngn-amount':    '₦' + Math.round(amountNgn).toLocaleString()
        };
        Object.entries(selectors).forEach(function (kv) {
            var el = document.querySelector(kv[0]);
            if (el) el.textContent = kv[1];
        });
    }
    window.updateWithdrawalPreview = updateWithdrawalPreview;

    function handleWithdrawalMethodChange() {
        var methodSelect = document.getElementById('withdrawal-method');
        if (!methodSelect) return;
        var method = methodSelect.value;
        var bankFields   = document.getElementById('withdrawal-bank-fields');
        /* CRYPTO_HIDDEN_FOR_PLAY_STORE: 'withdrawal-crypto-fields' no longer
           exists in index.html's withdrawal form (crypto withdrawal options
           removed there — bank transfer only for now), and the method
           select can no longer produce value 'crypto' either, so this is
           a harmless no-op lookup. Left in place to restore alongside the
           form fields when crypto withdrawal goes live. */
        var cryptoFields = document.getElementById('withdrawal-crypto-fields');
        if (bankFields)   bankFields.style.display   = (method === 'bank')   ? 'block' : 'none';
        if (cryptoFields) cryptoFields.style.display = (method === 'crypto')  ? 'block' : 'none';
    }
    window.handleWithdrawalMethodChange = handleWithdrawalMethodChange;


    /* =========================================================================
       §5  P2P TRANSFER PREVIEW
       ========================================================================= */

    function updateTransferPreview() {
        var amountInput = document.getElementById('transfer-amount');
        if (!amountInput) return;
        var amountEmpy = parseFloat(amountInput.value) || 0;
        var amountUsd  = amountEmpy * _EMPY_RATE();
        var previewEl  = document.getElementById('transfer-usd-preview');
        if (previewEl) previewEl.textContent = '≈ $' + amountUsd.toFixed(2);
    }
    window.updateTransferPreview = updateTransferPreview;


    /* =========================================================================
       §6  CROSS-CHAIN TRANSFER PREVIEW
       ========================================================================= */

    function updateCrossChainTransferPreview() {
        var amountInput = document.getElementById('cross-chain-amount');
        var feeEl       = document.getElementById('cross-chain-fee');
        var netEl       = document.getElementById('cross-chain-net');
        if (!amountInput) return;
        var amountEmpy = parseFloat(amountInput.value) || 0;
        var fee        = amountEmpy * (_FEE_PCT() / 100);
        var net        = amountEmpy - fee;
        if (feeEl) feeEl.textContent = fee.toFixed(2) + ' EMPY (' + _FEE_PCT() + '%)';
        if (netEl) netEl.textContent = net.toFixed(2) + ' EMPY';
    }
    window.updateCrossChainTransferPreview = updateCrossChainTransferPreview;


    /* =========================================================================
       §7  MARKETPLACE ESCROW CHECKOUT
       Handles the checkout-form submit → Flutterwave card payment for cart items.
       ========================================================================= */

    function processEscrowCheckout(formEl) {
        var cart = _S().cart || window.cart || [];
        if (!cart.length) { _notify('Your cart is empty.', 'error'); return; }

        var nameEl    = document.getElementById('checkout-name');
        var addrEl    = document.getElementById('checkout-address');
        var emailEl   = document.getElementById('checkout-buyer-email');
        var phoneEl   = document.getElementById('checkout-buyer-phone');

        if (!nameEl || !nameEl.value || !addrEl || !addrEl.value) {
            _notify('Please fill in your shipping name and address.', 'error');
            if (nameEl && !nameEl.value) nameEl.style.borderColor = 'var(--danger-color)';
            if (addrEl && !addrEl.value) addrEl.style.borderColor = 'var(--danger-color)';
            return;
        }

        var currentPaymentMethod = document.querySelector('#checkout-form .payment-tabs .payment-tab.active');
        var method = currentPaymentMethod ? currentPaymentMethod.dataset.target : 'direct';

        if (method === 'escrow-payment') {
            var total    = cart.reduce(function (sum, item) { return sum + parseFloat(item.price || 0); }, 0);
            var totalNgn = Math.round(total * _NGN_RATE());
            var us       = _us();

            if (typeof window.FlutterwaveCheckout !== 'function') {
                _notify('Payment gateway not loaded.', 'error'); return;
            }

            window.FlutterwaveCheckout({
                public_key:      (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '',
                tx_ref:          'EMPY-ESCROW-' + Date.now(),
                amount:          totalNgn,
                currency:        'NGN',
                payment_options: 'card,banktransfer,ussd',
                customer: {
                    email:        (emailEl && emailEl.value) || us.email || 'buyer@empyrean.app',
                    phone_number: (phoneEl && phoneEl.value) || '',
                    name:         nameEl.value
                },
                customizations: {
                    title:       'Empyrean Marketplace — Escrow Payment',
                    description: 'Secure escrow for ' + cart.length + ' item(s). Funds held until delivery confirmed.',
                    logo:        'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
                },
                callback: function (data) {
                    if (data.status === 'successful') {
                        _notify('✅ Escrow payment received! Seller has been notified. You have 48hrs to confirm delivery.', 'success');
                        if (_S().cart != null) _S().cart = [];
                        else window.cart = [];
                        if (typeof window.updateCartUI === 'function') window.updateCartUI();
                        var cartModal = document.getElementById('cart-modal-overlay');
                        if (cartModal) cartModal.classList.remove('show');
                        document.body.classList.remove('modal-open');
                        _reward('SUCCESSFUL_ESCROW_BUYER');
                    } else {
                        _notify('Payment not completed. Please try again.', 'error');
                    }
                },
                onclose: function () {}
            });
        } else {
            _notify('Direct purchase initiated! Please contact the seller to arrange payment.', 'success');
            if (_S().cart != null) _S().cart = [];
            else window.cart = [];
            if (typeof window.updateCartUI === 'function') window.updateCartUI();
            var cartModal2 = document.getElementById('cart-modal-overlay');
            if (cartModal2) cartModal2.classList.remove('show');
            document.body.classList.remove('modal-open');
        }
    }
    window.processEscrowCheckout = processEscrowCheckout;


    /* =========================================================================
       §8  PROMOTION CARD PAYMENT
       Handles promo-finalize-form card branch.
       ========================================================================= */

    function processPromoCardPayment(budget) {
        /* budget is in NGN */
        var us = _us();
        if (typeof window.FlutterwaveCheckout !== 'function') {
            _notify('Payment gateway not loaded.', 'error'); return;
        }
        window.FlutterwaveCheckout({
            public_key:      (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '',
            tx_ref:          'EMPY-PROMO-' + Date.now(),
            amount:          budget,
            currency:        'NGN',
            payment_options: 'card',
            customer: {
                email:        us.email    || 'user@empyrean.app',
                phone_number: us.phone    || '',
                name:         us.fullName || 'Empyrean User'
            },
            customizations: {
                title:       'Empyrean Post Promotion',
                description: 'Pay ₦' + Math.round(budget).toLocaleString() + ' to promote your post.',
                logo:        'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
            },
            callback: function (data) {
                if (data.status === 'successful') {
                    _notify('✅ Your promotion is now active!', 'success');
                } else {
                    _notify('Payment not completed.', 'error');
                }
            },
            onclose: function () {}
        });
    }
    window.processPromoCardPayment = processPromoCardPayment;


    /* =========================================================================
       §9  REFERRAL LINK IN WALLET / SETTINGS
       Renders the referral link and wires the copy button.
       ========================================================================= */

    function renderReferralLink() {
        var containers = document.querySelectorAll('.referral-link-container, #referral-link-display');
        if (!containers.length) return;

        var link = typeof window.getReferralLink === 'function'
            ? window.getReferralLink()
            : window.location.href;

        containers.forEach(function (container) {
            if (container.dataset.referralWired === '1') return;
            container.dataset.referralWired = '1';

            var input = container.querySelector('input, .referral-link-input');
            var copyBtn = container.querySelector('button, .referral-copy-btn');

            if (input) {
                input.value = link;
                input.readOnly = true;
            } else {
                container.textContent = link;
            }

            if (copyBtn) {
                copyBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(link).then(function () {
                            _notify('Referral link copied!', 'success');
                        }).catch(function () {
                            _notify('Could not copy link.', 'error');
                        });
                    } else {
                        if (input) {
                            input.select();
                            document.execCommand('copy');
                            _notify('Referral link copied!', 'success');
                        }
                    }
                });
            }
        });
    }
    window.renderReferralLink = renderReferralLink;


    /* =========================================================================
       §10  BOOTSTRAP + EVENT WIRING
       ========================================================================= */

    /* Wire input events for withdrawal/transfer previews */
    document.addEventListener('input', function (e) {
        if (!e.target) return;
        var id = e.target.id;
        if (id === 'withdrawal-amount')   updateWithdrawalPreview();
        if (id === 'transfer-amount')     updateTransferPreview();
        if (id === 'cross-chain-amount')  updateCrossChainTransferPreview();
    });

    /* Wire withdrawal method change */
    document.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'withdrawal-method') {
            handleWithdrawalMethodChange();
        }
    });

    /* Wire buy-empy-modal open → init */
    document.addEventListener('click', function (e) {
        var buyBtn = e.target.closest('#buy-empy-btn, #buy-empy-wallet-btn, #buy-empy-wallet-btn-2');
        if (buyBtn) {
            e.preventDefault();
            var modal = document.getElementById('buy-empy-modal');
            if (modal) {
                modal.classList.add('show');
                document.body.classList.add('modal-open');
                initBuyEmpyModal();
            }
        }
    });

    /* Wire checkout-form submit */
    document.addEventListener('submit', function (e) {
        if (!e.target) return;
        var formId = e.target.id || (e.target.getAttribute && e.target.getAttribute('id'));
        if (formId === 'checkout-form') {
            e.preventDefault();
            processEscrowCheckout(e.target);
        }
    });

    /* Bootstrap */
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () {
            initBuyEmpyModal();
            handleWithdrawalMethodChange();
            renderReferralLink();
            updateWalletUI();
        }, 600);
    });

    document.addEventListener('empyrean-user-ready', function () {
        setTimeout(function () {
            updateWalletUI();
            renderReferralLink();
        }, 700);
    });

    console.log('[EmpTokenPurchase] ✅ Debit card token purchase module ready.');

})();