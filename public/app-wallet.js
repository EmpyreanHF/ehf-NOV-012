/* =============================================================================
   EMPYREAN INTERNATIONAL — WALLET & STAKING
   app-wallet.js  |  Step 0.11  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Complete EMPY wallet and staking system extracted from app-fixes.js.  Covers:

     • updateWalletUI()              — EMPY balance, USD equivalent, live chip
     • updateStakingUI()             — staking panel: APY, balances, lock status
     • renderClaimedRewardsHistory() — reward/claim history list
     • simulateRewardAccrual()       — cosmetic per-second display tick only;
                                        real accrual/lock-release is server-side
                                        now (see FIX 2026-07-31 at §4 below)
     • syncStakingState()            — pulls authoritative staking state from
                                        /api/staking/sync (server.js)
     • handleWithdrawalMethodChange()— show/hide withdrawal method fields
     • updateWithdrawalPreview()     — fee calculation + receive amount display
     • updateTransferPreview()       — P2P EMPY transfer preview
     • updateCrossChainTransferPreview() — cross-chain bridge preview
     • checkAndAwardRank(user)       — milestone rank rewards from ranking pool
     • Buy EMPY modal flow (Flutterwave, now server-verified — see §7/§8)
     • Form submit handlers: stake, unstake, withdrawal, buy-empy (stake/
       unstake/buy-empy now call server.js's /api/staking/* and
       /api/wallet/confirm-purchase instead of writing Firestore directly)
     • Claim reward button handler (now calls /api/staking/claim-rewards)
     • Wallet tab payment-tab switching
     • Copy wallet address to clipboard
     • Reward accrual interval bootstrap + staking sync interval

   LOAD ORDER
   ──────────
   Must come AFTER: firebase-init, app-state, app-helpers, app-contracts,
   app-notifications, app-tags, app-auth, app-feed, app-marketplace.

   DEPENDS ON
   ──────────
   • window.EmpState / window.userState / window.isGuest
   • window.userManualStakedBalance / userLockedStakedBalance / userEarnedRewards
   • window.userStakedBalance / userLockedStakingEndTime / userClaimedRewardsHistory
     (as of 2026-07-31, these five are DISPLAY MIRRORS of server.js's
     manualStakedBalance / lockedStakedBalance / stakingEarnedRewards /
     lockedStakingEndTime fields on the user's own Firestore doc — set ONLY
     by _applyStakingState() from a /api/staking/* response, never computed
     or persisted locally anymore)
   • window.impactMiningState / window.RANKING_REWARDS_POOL
   • window.EMPY_RATE_USD / window.USD_TO_NGN_RATE / window.CRYPTO_FEE_PERCENT
   • window.STAKING_APY_ESTIMATE
   • window.formatUsdPrice / window.formatNgnPrice (app-helpers.js)
   • window.showNotification          (app-helpers.js)
   • window.renderMonetizationTab     (app-profile.js)
   • window.fbDb / window._firebaseLoaded
   • server.js's /api/staking/{stake,unstake,claim-rewards,sync} and
     /api/wallet/confirm-purchase (Render backend, hardcoded base URL —
     same convention as app-p2p-trading.js/app-impactmining.js)

   PUBLIC API
   ──────────
   window.updateWalletUI()
   window.updateStakingUI()
   window.renderClaimedRewardsHistory()
   window.simulateRewardAccrual()
   window.syncStakingState()
   window.handleWithdrawalMethodChange()
   window.updateWithdrawalPreview()
   window.updateTransferPreview()
   window.updateCrossChainTransferPreview()
   window.checkAndAwardRank(user)

   SECTION MAP
   ───────────
   §1  State accessors
   §2  updateWalletUI
   §3  updateStakingUI + renderClaimedRewardsHistory
   §4  simulateRewardAccrual (cosmetic tick) + syncStakingState (authoritative)
   §5  Withdrawal helpers — method change, preview, transfer, cross-chain
   §6  checkAndAwardRank
   §7  Buy EMPY preview + Flutterwave handler (server-verified confirm-purchase)
   §8  Form submit handlers — stake, unstake, withdrawal, buy-empy
   §9  Claim reward button
   §10 Wallet payment-tab switching
   §11 Copy wallet address
   §12 Bootstrap

   ============================================================================= */

(function empyreanWalletModule() {
    'use strict';

    if (window._empyreanWalletLoaded) {
        console.warn('[EmpWallet] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanWalletLoaded = true;


    /* =========================================================================
       §1  STATE ACCESSORS
       All reads go through these helpers so the module works both with EmpState
       (new) and the flat window.* globals (legacy fallback).
       ========================================================================= */

    function _S()    { return window.EmpState || {}; }
    function _us()   { return _S().userState  || window.userState  || {}; }
    function _guest(){ var s = _S(); return s.isGuest != null ? s.isGuest : !!window.isGuest; }

    function _get(key) {
        var s = _S();
        return (s[key] != null) ? s[key] : window[key];
    }
    function _set(key, val) {
        if (window.EmpState && window.EmpState[key] != null) window.EmpState[key] = val;
        else window[key] = val;
    }

    /* Last successful GET /api/earnings/summary/:userId response — populated
       by renderEarningsSummary() below. Lets the withdrawal form (§5/§8)
       show/validate against the person's REAL, follower-tiered minimum
       (earnings-routes.js's GIFTING_WITHDRAWAL_TIERS) instead of a stale
       flat figure, without a second network round-trip on every keystroke.
       null until the first successful fetch completes. */
    var _lastEarningsSummary = null;

    function _rate()       { return _get('EMPY_RATE_USD')        || 0.10;        }
    function _ngn()        { return _get('USD_TO_NGN_RATE')       || 1500;        }
    function _fee()        { return _get('CRYPTO_FEE_PERCENT')    || 1.5;         }
    function _apy()        { return _get('STAKING_APY_ESTIMATE')  || 0.157;       }
    function _pool()       { return _get('RANKING_REWARDS_POOL')  || 3_500_000;   }
    function _manualStk()  { return _get('userManualStakedBalance') || 0;         }
    function _lockedStk()  { return _get('userLockedStakedBalance') || 0;         }
    function _lockEnd()    { return _get('userLockedStakingEndTime') || 0;        }
    function _earned()     { return _get('userEarnedRewards')       || 0;         }
    function _history()    { return _get('userClaimedRewardsHistory') || [];      }
    function _mining()     { return _get('impactMiningState')         || {};      }

    /* Ranking tiers — SINGLE SOURCE OF TRUTH, mirrored for display only in
       app-profile.js's own RANKS (must stay byte-for-byte identical to
       this list — see that file's own comment).

       REDUCED + RECONCILED (2026-08-15 — token-allocation review): this
       used to be a 5-tier list capped at 50,000 followers / 1,000 EMPY,
       while app-profile.js's DISPLAY copy independently listed 6
       different tiers with DIFFERENT reward amounts (up to 50,000 EMPY at
       the same 50,000-follower mark) and app-fixes.js additionally ran its
       own disconnected 9-tier copy (up to 25,000 EMPY at 1,000,000
       followers) as the version that was ACTUALLY live on every follow
       action (see that file's own note at its old local `ranks` array).
       Three divergent tables meant the reward a user was shown could
       differ from what they were actually paid. Consolidated here to one
       9-tier ladder (the fullest of the three, extended out to 1,000,000
       followers) at drastically reduced amounts, and app-fixes.js's local
       duplicate now delegates to window.checkAndAwardRank (this function)
       instead of paying out its own copy — see that file's own note. */
    var RANKS = [
        { id: 'rank-1', name: 'Rising Star',     followers: 500,      reward: 5    },
        { id: 'rank-2', name: 'Community Voice',  followers: 1000,     reward: 10   },
        { id: 'rank-3', name: 'Influencer',       followers: 5000,     reward: 25   },
        { id: 'rank-4', name: 'Advocate',         followers: 10000,    reward: 50   },
        { id: 'rank-5', name: 'Leader',           followers: 50000,    reward: 100  },
        { id: 'rank-6', name: 'Beacon',           followers: 100000,   reward: 250  },
        { id: 'rank-7', name: 'Champion',         followers: 250000,   reward: 500  },
        { id: 'rank-8', name: 'Ambassador',       followers: 500000,   reward: 1000 },
        { id: 'rank-9', name: 'Legend',           followers: 1000000,  reward: 2500 }
    ];


    /* =========================================================================
       §2  updateWalletUI
       Refreshes the wallet balance chip, USD equivalent, and the live-stream
       EMPY balance display.  Also triggers monetization tab and staking panel.
       ========================================================================= */

    function updateWalletUI() {
        if (_guest()) return;

        var us          = _us();
        var empyBalance = us.empyBalance || 0;

        var balEl  = document.getElementById('wallet-empy-balance');
        var usdEl  = document.getElementById('wallet-usd-equivalent');
        var liveEl = document.getElementById('live-user-empy-balance');

        if (balEl) {
            balEl.innerHTML = '<i class="fa-solid fa-coins"></i> '
                + empyBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (usdEl) {
            usdEl.textContent = '~ ' + (typeof window.formatUsdPrice === 'function'
                ? window.formatUsdPrice(empyBalance * _rate())
                : '$' + (empyBalance * _rate()).toFixed(2));
        }
        if (liveEl) {
            liveEl.innerHTML = '(Your Balance: ' + Math.floor(empyBalance).toLocaleString()
                + ' <i class="fa-solid fa-coins" style="font-size:0.8rem;"></i>)';
        }

        /* Sidebar EMPY chip */
        var sideChip = document.getElementById('sidebar-empy-balance');
        if (sideChip) {
            sideChip.textContent = Math.floor(empyBalance).toLocaleString() + ' EMPY';
        }

        /* Dashboard stat card (profile tab) */
        var dashEmpy = document.getElementById('profile-dash-empy');
        if (dashEmpy) dashEmpy.textContent = empyBalance.toLocaleString();

        /* Monetization tab and staking panel */
        if (typeof window.renderMonetizationTab === 'function') window.renderMonetizationTab();
        updateStakingUI();
        renderEarningsSummary(); // fire-and-forget, same as the other async panels this function already kicks off
    }
    window.updateWalletUI = updateWalletUI;


    /* =========================================================================
       §2b  EARNINGS SEGMENTATION SUMMARY (Payment System Restructuring)
       Read-only render of the three independently-gated streams via GET
       /api/earnings/summary/:userId (earnings-routes.js) — never moves
       money itself; the withdrawal-form handler in §8 below does that,
       using the SAME giftTokenBalance this summary displays. Renders into
       #earnings-summary-container (index.html, My Wallet section, right
       under Wallet Overview) and is a no-op if that container isn't in
       the DOM — same "not on this section right now" guard
       updateStakingUI() already uses for #staking-apy.
       ========================================================================= */
    function renderEarningsSummary() {
        if (_guest()) return;
        var container = document.getElementById('earnings-summary-container');
        if (!container) return;

        var us = _us();
        if (!us.id) return;

        _earningsIdToken().then(function (token) {
            return fetch(EARNINGS_API() + '/summary/' + encodeURIComponent(us.id), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
        }).then(function (r) {
            return r.json().then(function (d) {
                if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
                return d;
            });
        }).then(function (d) {
            _lastEarningsSummary = d;
            _paintEarningsSummary(container, d);
            updateWithdrawalPreview(); // real per-tier minimum may have just become known — refresh the preview/hint if the form is open
        }).catch(function (err) {
            container.innerHTML = '<p style="color:var(--color-neutral-600);font-size:var(--text-sm);">'
                + '<i class="fas fa-triangle-exclamation"></i> Could not load earnings summary'
                + (err && err.message ? (': ' + _esc(err.message)) : '.') + '</p>';
        });
    }
    window.renderEarningsSummary = renderEarningsSummary;

    function _paintEarningsSummary(container, d) {
        var fmtUsd = typeof window.formatUsdPrice === 'function'
            ? window.formatUsdPrice
            : function (v) { return '$' + (v || 0).toFixed(2); };
        var rewards = d.rewards        || {};
        var gifting = d.gifting        || {};
        var adRev   = d.advertRevenue  || {};
        var liveStr = d.liveStreaming  || {};
        var rate    = d.empyRateUsd    || 0.10;

        var html = '<div class="grid-3">';

        /* Rewards System — locked pre-launch */
        html += '<div class="wallet-card" style="padding:18px;">'
            + '<p><i class="fas fa-seedling"></i> Rewards System</p>'
            + '<h3 class="empy-balance" style="font-size:var(--text-2xl);">'
            + (Number(rewards.balanceEmpy) || 0).toLocaleString() + ' <span style="font-size:var(--text-sm);font-weight:400;">EMPY</span></h3>'
            + '<p style="color:var(--color-neutral-600);font-size:var(--text-sm);">~ ' + fmtUsd((Number(rewards.balanceEmpy) || 0) * rate) + '</p>'
            + (rewards.withdrawable
                ? '<p style="color:#22c55e;font-size:var(--text-xs);margin-top:8px;"><i class="fas fa-unlock"></i> Withdrawable</p>'
                : '<p style="color:var(--color-neutral-500);font-size:var(--text-xs);margin-top:8px;"><i class="fas fa-lock"></i> ' + _esc(rewards.lockedReason || 'Locked until launch') + '</p>')
            + '</div>';

        /* Gifting & Tipping — tiered by followers */
        html += '<div class="wallet-card" style="padding:18px;">'
            + '<p><i class="fas fa-gift"></i> Gifting &amp; Tipping</p>'
            + '<h3 class="empy-balance" style="font-size:var(--text-2xl);">'
            + (Number(gifting.balanceEmpy) || 0).toLocaleString() + ' <span style="font-size:var(--text-sm);font-weight:400;">EMPY</span></h3>'
            + '<p style="color:var(--color-neutral-600);font-size:var(--text-sm);">~ ' + fmtUsd((Number(gifting.balanceEmpy) || 0) * rate) + '</p>'
            + (gifting.eligible
                ? '<p style="color:#22c55e;font-size:var(--text-xs);margin-top:8px;"><i class="fas fa-unlock"></i> Min withdrawal $'
                    + gifting.minWithdrawUsd + ' (~' + (Number(gifting.minWithdrawEmpy) || 0).toLocaleString() + ' EMPY)</p>'
                : '<p style="color:var(--color-neutral-500);font-size:var(--text-xs);margin-top:8px;"><i class="fas fa-lock"></i> Unlocks at '
                    + (gifting.nextTier ? Number(gifting.nextTier.minFollowers).toLocaleString() : '500') + '+ followers ('
                    + (Number(d.followerCount) || 0).toLocaleString() + ' now)</p>')
            + '</div>';

        /* Advert Revenue — already server-authoritative elsewhere; shown read-only here */
        html += '<div class="wallet-card" style="padding:18px;">'
            + '<p><i class="fas fa-bullhorn"></i> Advert Revenue</p>'
            + '<h3 class="empy-balance" style="font-size:var(--text-2xl);">' + fmtUsd(Number(adRev.availableUsd) || 0) + '</h3>'
            + '<p style="color:var(--color-neutral-600);font-size:var(--text-sm);">Total earned: ' + fmtUsd(Number(adRev.totalEarnedUsd) || 0) + '</p>'
            + (adRev.availableUsd > 0
                ? '<p style="color:#22c55e;font-size:var(--text-xs);margin-top:8px;"><i class="fas fa-unlock"></i> Available to request</p>'
                : '<p style="color:var(--color-neutral-500);font-size:var(--text-xs);margin-top:8px;">No earnings yet</p>')
            + '</div>';

        /* Live Streaming Income — gift income earned while hosting a live
           stream (users/{uid}.liveStreamIncome). Consolidated here
           (dashboard update) instead of its own separate card elsewhere on
           the page — see app-patch-v9.js, which now just keeps this data
           fresh in real time rather than rendering its own card. KYC-gated,
           same as before; withdraws through its OWN endpoint since this is
           a separate ledger from Gifting & Tipping's giftTokenBalance. */
        html += '<div class="wallet-card" style="padding:18px;">'
            + '<p><i class="fas fa-video"></i> Live Streaming Income</p>'
            + '<h3 class="empy-balance" style="font-size:var(--text-2xl);">'
            + (Number(liveStr.balanceEmpy) || 0).toLocaleString() + ' <span style="font-size:var(--text-sm);font-weight:400;">EMPY</span></h3>'
            + '<p style="color:var(--color-neutral-600);font-size:var(--text-sm);">~ ' + fmtUsd((Number(liveStr.balanceEmpy) || 0) * rate) + '</p>'
            + (liveStr.kycVerified
                ? '<p style="color:#22c55e;font-size:var(--text-xs);margin-top:8px;"><i class="fas fa-unlock"></i> Min withdrawal $'
                    + (liveStr.minWithdrawUsd != null ? liveStr.minWithdrawUsd : 10) + ' (~' + (Number(liveStr.minWithdrawEmpy) || 0).toLocaleString() + ' EMPY)</p>'
                : '<p style="color:var(--color-neutral-500);font-size:var(--text-xs);margin-top:8px;"><i class="fas fa-lock"></i> Complete KYC to withdraw</p>')
            + '<button type="button" class="btn btn-small btn-accent" style="margin-top:10px;" onclick="window._empWithdrawLiveStreamIncome()"><i class="fas fa-wallet"></i> Withdraw</button>'
            + '</div>';

        html += '</div>';
        container.innerHTML = html;
    }

    /* Withdraw button for the Live Streaming Income card above. Calls
       /api/earnings/live-streaming/request-withdrawal directly — this
       balance (liveStreamIncome) is a different Firestore field from the
       one the shared #withdrawal-form submits against (giftTokenBalance),
       so reusing that form here (as the old, now-removed separate card in
       app-patch-v9.js used to, by prefilling its amount field) would have
       withdrawn from the wrong balance. A simple prompt() is used instead
       of building a second full form for a single-field flow. */
    window._empWithdrawLiveStreamIncome = function () {
        if (_guest()) { _openAuth(); return; }
        var d = _lastEarningsSummary;
        var liveStr = (d && d.liveStreaming) || {};
        var us = _us();

        if (!liveStr.kycVerified) {
            _notify('Complete KYC verification before withdrawing live streaming income.', 'error');
            if (typeof window.navigateTo === 'function') {
                window.navigateTo('profile');
                setTimeout(function () {
                    var kycTabBtn = document.querySelector('.profile-tab[data-target="profile-kyc-tab"]');
                    if (kycTabBtn) kycTabBtn.click();
                }, 200);
            }
            return;
        }
        var balance = Number(liveStr.balanceEmpy) || 0;
        if (balance <= 0) { _notify('No live streaming income to withdraw yet.', 'info'); return; }

        var minEmpy = Number(liveStr.minWithdrawEmpy) || 0;
        var amountStr = window.prompt('Amount to withdraw (EMPY). Balance: ' + balance.toLocaleString() + ', minimum: ' + minEmpy.toLocaleString() + '.', String(Math.min(balance, Math.max(minEmpy, balance))));
        if (amountStr == null) return; // cancelled
        var amount = parseFloat(amountStr);
        if (!amount || amount <= 0) { _notify('Enter a valid amount.', 'error'); return; }
        if (amount > balance) { _notify('Amount exceeds your live streaming balance.', 'error'); return; }

        var bankName      = window.prompt('Bank name for payout:', '') || '';
        var accountNumber = window.prompt('Account number:', '') || '';
        if (!bankName || !accountNumber) { _notify('Bank details are required to withdraw.', 'error'); return; }

        _earningsIdToken().then(function (token) {
            return fetch(EARNINGS_API() + '/live-streaming/request-withdrawal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({
                    userId: us.id,
                    amountEmpy: amount,
                    method: 'bank',
                    accountDetails: { bankName: bankName, accountNumber: accountNumber }
                })
            });
        }).then(function (r) {
            return r.json().then(function (d2) {
                if (!r.ok) throw new Error(d2.error || ('HTTP ' + r.status));
                return d2;
            });
        }).then(function (d2) {
            _notify('Withdrawal request submitted for approval — ' +
                (typeof d2.netAmountEmpy === 'number' ? d2.netAmountEmpy.toLocaleString() : amount.toLocaleString()) +
                ' EMPY after fee.', 'success');
            renderEarningsSummary();
        }).catch(function (err) {
            _notify((err && err.message) || 'Could not submit withdrawal request.', 'error');
        });
    };


    /* =========================================================================
       §3  updateStakingUI + renderClaimedRewardsHistory
       ========================================================================= */

    function updateStakingUI() {
        if (_guest()) return;
        if (!document.getElementById('staking-apy')) return;

        var us      = _us();
        var manual  = _manualStk();
        var locked  = _lockedStk();
        var lockEnd = _lockEnd();
        var earned  = _earned();

        /* APY label */
        var apyEl = document.getElementById('staking-apy');
        if (apyEl) apyEl.textContent = '~' + (_apy() * 100).toFixed(1) + '%';

        /* Balance displays */
        _setText('user-manual-staked-balance', manual);
        _setText('user-locked-staked-balance', locked);
        _setText('user-earned-rewards',        earned);
        _setText('stake-available-balance',    us.empyBalance || 0);
        _setText('unstake-available-manual-balance', manual);

        /* Claim button */
        var claimBtn = document.getElementById('claim-reward-btn');
        if (claimBtn) claimBtn.disabled = earned <= 0;

        /* Manual staking status */
        var manualStatus = document.getElementById('manual-staking-status');
        if (manualStatus) {
            if (manual > 0) {
                manualStatus.textContent = 'Active (Manual)';
                manualStatus.className   = 'staking-status active';
            } else {
                manualStatus.textContent = 'Inactive';
                manualStatus.className   = 'staking-status inactive';
            }
        }

        /* Locked staking status */
        var lockedStatus = document.getElementById('locked-staking-status');
        if (lockedStatus) {
            if (locked > 0) {
                var now = Date.now();
                if (now < lockEnd) {
                    var daysLeft = Math.ceil((lockEnd - now) / 86_400_000);
                    lockedStatus.textContent = 'Locked (' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left)';
                    lockedStatus.className   = 'staking-status locked';
                } else {
                    lockedStatus.textContent = 'Unlocked';
                    lockedStatus.className   = 'staking-status unlocked';
                }
            } else {
                lockedStatus.textContent = 'Inactive';
                lockedStatus.className   = 'staking-status inactive';
            }
        }

        /* Unstake button */
        var unstakeBtn = document.querySelector('#unstake-form button[type="submit"]');
        if (unstakeBtn) unstakeBtn.disabled = manual <= 0;

        renderClaimedRewardsHistory();
    }
    window.updateStakingUI = updateStakingUI;

    /**
     * Render the reward/claim history list inside #claimed-rewards-history.
     */
    function renderClaimedRewardsHistory() {
        var historyList = document.getElementById('claimed-rewards-history');
        if (!historyList) return;

        var history = _history();
        if (!history.length) {
            historyList.innerHTML =
                '<p style="text-align:center;color:var(--text-muted);padding:16px;">No claimed rewards yet.</p>';
            return;
        }

        historyList.innerHTML = '<ul class="claimed-history-list">'
            + history.slice().reverse().map(function (item) {
                var statusText = '';
                if (item.lockExpiry) {
                    var lockDate = new Date(item.lockExpiry);
                    if (new Date() < lockDate) {
                        var days = Math.ceil((lockDate.getTime() - Date.now()) / 86_400_000);
                        statusText = ' (Locked, ' + days + ' day' + (days !== 1 ? 's' : '') + ' left)';
                    } else {
                        statusText = ' (Unlocked)';
                    }
                }
                var amt = (item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return '<li class="claimed-history-item">'
                    + '<span>' + _esc(item.type || '') + '</span>'
                    + '<span class="amount">' + amt + ' EMPY</span>'
                    + '<span class="date">' + _esc(item.date || '') + statusText + '</span>'
                    + '</li>';
            }).join('')
            + '</ul>';
    }
    window.renderClaimedRewardsHistory = renderClaimedRewardsHistory;

    /* Helper: set element text as a formatted EMPY number */
    function _setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = parseFloat(val || 0)
            .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }


    /* =========================================================================
       §4  simulateRewardAccrual + interval
       Per-second APY tick — only runs when user has a staked balance.
       Also handles auto-release of unlocked locked-staking balance.
       ========================================================================= */

    /* =========================================================================
       §4  STAKING SYNC (server-authoritative) + cosmetic local tick
       =========================================================================
       FIX (2026-07-31 — real server-side staking): this used to compute
       AND persist its own stakingEarnedRewards/lockedStakedBalance numbers
       from nothing but elapsed wall-clock time and a client-side
       manualStakedBalance value — see firebase-rules.js's
       touchesServerOnlyStakingFields comment for why writing those fields
       directly is now blocked outright. The real accrual math and lock-
       release live server-side now, in server.js's computeStakingAccrual()
       — reached via the four /api/staking/* endpoints below. This
       function keeps its old name/signature (still window.
       simulateRewardAccrual(), same public API) but is now PURELY a local
       display tick: it estimates the earned-rewards counter climbing
       between real syncs so it doesn't sit visibly frozen for up to a
       whole sync interval, and never persists anything anywhere — every
       real sync response (syncStakingState() below, or the result of a
       stake/unstake/claim call) simply overwrites whatever this guessed.
       Lock-release no longer happens here at all; the server decides that
       the moment any staking endpoint is next called, and the next sync
       picks it up.
       ========================================================================= */

    function simulateRewardAccrual() {
        if (_guest()) return;

        var manual = _manualStk();
        var locked = _lockedStk();

        if (manual > 0 || locked > 0) {
            var totalStaked  = manual + locked;
            var rewardPerSec = totalStaked * (_apy() / 31_536_000);
            _set('userEarnedRewards', _earned() + rewardPerSec);

            /* Only update DOM if wallet section is visible */
            var walletSection = document.getElementById('my-wallet');
            if (walletSection && walletSection.classList.contains('active')) {
                updateStakingUI();
            }
        }
    }
    window.simulateRewardAccrual = simulateRewardAccrual;

    /* Base URL for the four server-authoritative staking endpoints —
       mirrors the fixed Render backend URL every other module in this app
       already hardcodes per call (app-p2p-trading.js, app-impactmining.js,
       the buy-empy-form fix above). */
    var STAKING_API = function () { return window._empApiBase() + '/api/staking'; };
    var _stakingSyncInFlight = false;

    /* ADDED (Payment System Restructuring — earnings segmentation): base
       URL for earnings-routes.js's endpoints, same fixed-Render-backend
       convention as STAKING_API() just above. Unlike the staking/
       confirm-purchase calls in this file (which only ever send userId in
       the body and trust it), every earnings-routes.js endpoint requires a
       real Firebase ID token (Authorization: Bearer <token>) — it moves
       withdrawable money out of the platform, not just an internal
       balance move — so _earningsIdToken() below is new, not reused from
       elsewhere in this file. Same window.fbAuth.currentUser.getIdToken()
       pattern app-bulk-disburse.js already uses for its own admin-authed
       calls. */
    var EARNINGS_API = function () { return window._empApiBase() + '/api/earnings'; };
    function _earningsIdToken() {
        if (!window.fbAuth || !window.fbAuth.currentUser) {
            return Promise.reject(new Error('Not signed in.'));
        }
        return window.fbAuth.currentUser.getIdToken();
    }

    /* FIX (2026-08-01 — "staking sync failed... Unexpected token '<'...
       is not valid JSON"): server.js's /api/staking/sync route always
       responds with res.json(...), on every path including its own error
       branches — it is not capable of producing that message. A response
       starting with '<' is HTML, not JSON, which only happens when the
       request never reached that route handler at all (an HTTP error
       page from the host/proxy in front of it, or a stale deploy that
       doesn't have this route yet). r.json() doesn't distinguish "reached
       the route, got JSON back" from "never reached it, got an HTML error
       page" — it just throws the same unhelpful SyntaxError either way.
       Shared by all four staking endpoints (sync/stake/unstake/
       claim-rewards) below so a deploy/routing problem shows up as one
       clear, actionable message instead of the raw parser error, and so
       a genuine HTTP error status is caught before .json() ever runs on
       it (r.json() on a non-2xx response can still "succeed" and parse
       an error body as if it were a normal result). */
    function _readStakingJson(r) {
        var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
        if (ct.indexOf('application/json') === -1) {
            return r.text().then(function (t) {
                throw new Error('Staking API returned ' + r.status + ' ' +
                    (r.ok ? '(non-JSON response' : '(not OK') +
                    ') — endpoint may not be deployed yet: ' +
                    (t || '').replace(/\s+/g, ' ').slice(0, 100));
            });
        }
        return r.json().then(function (data) {
            if (!r.ok) throw new Error((data && data.error) || ('Staking API error ' + r.status));
            return data;
        });
    }

    /* Apply a staking-state response — /sync, /stake, /unstake, and
       /claim-rewards all return this same shape — to local display state
       and refresh the UI. This is the ONLY place these five window/
       EmpState values get set from here on; nothing computes them locally
       anymore, only this function copying down whatever the server said. */
    function _applyStakingState(data) {
        var us = _us();
        if (typeof data.newBalance === 'number')           us.empyBalance = data.newBalance;
        if (typeof data.manualStakedBalance === 'number')  _set('userManualStakedBalance',  data.manualStakedBalance);
        if (typeof data.lockedStakedBalance === 'number')  _set('userLockedStakedBalance',  data.lockedStakedBalance);
        if (typeof data.lockedStakingEndTime === 'number') _set('userLockedStakingEndTime', data.lockedStakingEndTime);
        if (typeof data.stakingEarnedRewards === 'number') _set('userEarnedRewards',        data.stakingEarnedRewards);
        _set('userStakedBalance', _manualStk() + _lockedStk());
        updateWalletUI();
    }

    /* Ask the server for the current, authoritative staking state (accrual
       + any matured lock release applied server-side first). Called on
       wallet-tab open/init and on a periodic interval below; also safe to
       call any time the wallet UI is shown, since it's a no-op write
       server-side when nothing's actually changed (see /api/staking/sync's
       own comment). */
    function syncStakingState() {
        if (_guest()) return;
        var us = _us();
        if (!us.id || _stakingSyncInFlight) return;
        _stakingSyncInFlight = true;

        fetch(STAKING_API() + '/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: us.id })
        }).then(_readStakingJson).then(function (data) {
            if (data && data.ok) _applyStakingState(data);
        }).catch(function (err) {
            console.warn('[EmpWallet] staking sync failed (will retry on the next interval):', err && err.message);
        }).finally(function () { _stakingSyncInFlight = false; });
    }
    window.syncStakingState = syncStakingState;

    /* Local cosmetic tick — every 1s, purely for a smooth-looking counter. */
    if (!window._rewardAccrualInterval) {
        window._rewardAccrualInterval = setInterval(simulateRewardAccrual, 1000);
    }
    /* Real server sync — every 30s, corrects any cosmetic drift from the
       tick above and picks up a matured lock release without the person
       needing to stake/unstake/claim first. */
    if (!window._stakingSyncInterval) {
        window._stakingSyncInterval = setInterval(syncStakingState, 30000);
    }


    /* =========================================================================
       §5  WITHDRAWAL HELPERS
       ========================================================================= */

    /**
     * Show/hide withdrawal method-specific fields and reset required attributes.
     */
    function handleWithdrawalMethodChange() {
        var methodSelect = document.getElementById('withdrawal-method');
        if (!methodSelect) return;
        var method          = methodSelect.value;
        var fieldsContainer = document.getElementById('withdrawal-method-fields');
        if (!fieldsContainer) return;

        Array.from(fieldsContainer.children).forEach(function (child) {
            child.style.display = 'none';
        });
        fieldsContainer.querySelectorAll('input').forEach(function (inp) {
            inp.required = false;
        });

        if (method) {
            var toShow = document.getElementById(method + '-fields');
            if (toShow) {
                toShow.style.display = 'block';
                toShow.querySelectorAll('input').forEach(function (inp) {
                    inp.required = true;
                });
            }
        }
        updateWithdrawalPreview();
    }
    window.handleWithdrawalMethodChange = handleWithdrawalMethodChange;

    /**
     * Calculate and display withdrawal amounts including fee.
     */
    function updateWithdrawalPreview() {
        var amountInput = document.getElementById('withdrawal-amount');
        var methodEl    = document.getElementById('withdrawal-method');
        var previewEl   = document.getElementById('withdrawal-preview');
        if (!amountInput || !methodEl || !previewEl) return;

        var amountEmpy = parseFloat(amountInput.value);
        var method     = methodEl.value;

        /* FIX (dashboard update — stale "min 5 EMPY" hint): this form has
           actually submitted to the follower-tiered
           /api/earnings/gifting/request-withdrawal since the earnings-
           segmentation restructuring (see the submit handler in §8 below),
           so the real minimum is whatever earnings-routes.js's
           GIFTING_WITHDRAWAL_TIERS says for the person's own follower
           count — not a flat number. Read from the cached summary
           (renderEarningsSummary() populates _lastEarningsSummary) rather
           than guessing; if it hasn't loaded yet, don't claim a minimum at
           all — the actual amount check still happens server-side either
           way, so this is purely about not showing a wrong number. */
        var giftingInfo   = (_lastEarningsSummary && _lastEarningsSummary.gifting) || null;
        var minWithdrawEmpy = giftingInfo && typeof giftingInfo.minWithdrawEmpy === 'number' ? giftingInfo.minWithdrawEmpy : null;
        var minHint = minWithdrawEmpy != null
            ? ('min ' + minWithdrawEmpy.toLocaleString() + ' EMPY for your follower tier')
            : 'minimum depends on your follower tier — see Earnings Breakdown above';

        if (!amountEmpy || (minWithdrawEmpy != null && amountEmpy < minWithdrawEmpy) || !method) {
            previewEl.innerHTML = '<p>Enter an amount (' + minHint + ') and select a method.</p>';
            return;
        }

        /* FIX (Payment System Restructuring — earnings segmentation): this
           used to price the fee off _fee()/CRYPTO_FEE_PERCENT (1.5%
           default) — a leftover from the old crypto-withdrawal path
           (CRYPTO_HIDDEN_FOR_PLAY_STORE, see below), unrelated to what a
           withdrawal actually costs now that this form submits to
           /api/earnings/gifting/request-withdrawal. That endpoint deducts
           WITHDRAWAL_FEE_PCT (earnings-routes.js, 5% default,
           EARNINGS_WITHDRAWAL_FEE_PCT env-overridable) — showing 1.5%
           here while the server charges 5% would preview a smaller
           deduction than what the request actually submits. Not fetched
           from the server (no /api/config field for it yet) — hardcoded
           to match that file's own default, same "same fixed value in two
           files" tradeoff EMPY_RATE_USD already accepts across this
           codebase (server.js, earnings-routes.js, app-wallet.js's own
           _rate() all separately hardcode 0.10). Also: the fee is now
           deducted FROM the withdrawal amount server-side (net payout),
           not added on top of it — "Total Deduction" below reflects that
           (equals the amount entered; the fee comes out of it, it isn't
           extra). */
        var GIFTING_WITHDRAWAL_FEE_PCT = 5; // mirrors earnings-routes.js's WITHDRAWAL_FEE_PCT default (0.05)
        var amountUsd       = amountEmpy * _rate();
        var feeInEmpy       = amountEmpy * (GIFTING_WITHDRAWAL_FEE_PCT / 100);
        var netEmpy         = amountEmpy - feeInEmpy;
        var finalReceive    = method === 'bank' ? (netEmpy * _rate()) * _ngn() : (netEmpy * _rate());

        var fmtUsd = typeof window.formatUsdPrice  === 'function' ? window.formatUsdPrice  : function (v) { return '$' + v.toFixed(2); };
        var fmtNgn = typeof window.formatNgnPrice  === 'function' ? window.formatNgnPrice  : function (v) { return '₦' + v.toFixed(2); };

        var html = '<p>Withdrawal Amount: <strong>' + amountEmpy.toLocaleString() + ' EMPY</strong> (' + fmtUsd(amountUsd) + ')</p>';
        html += '<p>Fee (' + GIFTING_WITHDRAWAL_FEE_PCT + '%): <strong>' + feeInEmpy.toLocaleString() + ' EMPY</strong></p>';
        html += '<p>Net Amount (' + netEmpy.toLocaleString() + ' EMPY): sent after the fee is deducted</p>';
        /* CRYPTO_HIDDEN_FOR_PLAY_STORE: the withdrawal-method select in
           index.html no longer offers 'usdt' (or 'empyrean-card') as an
           option — bank transfer only for now — so this branch can no
           longer be reached. Left in place, unreachable, to restore
           alongside those options when crypto withdrawal goes live. */
        if (method === 'bank')          html += '<p>You will receive ~<strong>' + fmtNgn(finalReceive) + '</strong></p>';
        else if (method === 'intl-wire') html += '<p>You will receive ~<strong>' + fmtUsd(netEmpy * _rate()) + '</strong> via international wire (bank/intermediary fees may apply on their end).</p>';
        else if (method === 'usdt')     html += '<p>You will receive: <strong>' + fmtUsd(finalReceive) + ' (USDT)</strong></p>';
        else                             html += '<p>You will receive: <strong>' + fmtUsd(finalReceive) + '</strong> on your card</p>';

        previewEl.innerHTML = html;
    }
    window.updateWithdrawalPreview = updateWithdrawalPreview;

    /**
     * P2P EMPY transfer preview.
     * CRYPTO_HIDDEN_FOR_PLAY_STORE (2026-08): this used to describe a
     * "Network Fee (Polygon)" — EMPY transfers are an internal Firestore
     * balance move (see app-patch-v49.js's real transfer implementation),
     * not an on-chain transaction, so there's no network/gas fee and no
     * blockchain name to show. Wording brought in line with v49's own
     * "internal transfers are free" preview text so both agree regardless
     * of which one a given code path happens to call.
     */
    function updateTransferPreview() {
        var amountInput = document.getElementById('transfer-amount');
        var previewEl   = document.getElementById('transfer-preview');
        if (!amountInput || !previewEl) return;

        var amountEmpy = parseFloat(amountInput.value) || 0;

        if (!amountEmpy || amountEmpy <= 0) {
            previewEl.innerHTML = '<p>Enter an amount to see transaction details.</p>';
            return;
        }
        previewEl.innerHTML =
            '<p>Amount to Send: <strong>' + amountEmpy.toLocaleString() + ' EMPY</strong></p>'
            + '<p>Fee: <strong>None</strong> — internal transfers are free.</p>'
            + '<p>Recipient Receives: <strong>' + amountEmpy.toLocaleString() + ' EMPY</strong></p>';
    }
    window.updateTransferPreview = updateTransferPreview;

    /**
     * Cross-chain bridge transfer preview.
     * Fee is read from the selected <option data-fee=""> attribute.
     */
    function updateCrossChainTransferPreview() {
        var amountInput   = document.getElementById('cross-chain-amount');
        var networkSelect = document.getElementById('cross-chain-network');
        var previewEl     = document.getElementById('cross-chain-transfer-preview');
        if (!amountInput || !networkSelect || !previewEl) return;

        var amountEmpy  = parseFloat(amountInput.value) || 0;
        var selectedOpt = networkSelect.options[networkSelect.selectedIndex];
        var networkFee  = parseFloat(selectedOpt ? selectedOpt.dataset.fee : 0) || 0;
        var networkName = selectedOpt
            ? selectedOpt.textContent.split('(')[0].trim()
            : 'Selected network';

        if (!amountEmpy || amountEmpy <= 0) {
            previewEl.innerHTML = '<p>Enter an amount to see transaction details.</p>';
            return;
        }
        previewEl.innerHTML =
            '<p>Amount to Send: <strong>' + amountEmpy.toLocaleString() + ' EMPY</strong></p>'
            + '<p>Network Fee (' + _esc(networkName) + '): <strong>' + networkFee.toLocaleString() + ' EMPY</strong></p>'
            + '<p>Total to be Deducted: <strong>' + (amountEmpy + networkFee).toLocaleString() + ' EMPY</strong></p>';
    }
    window.updateCrossChainTransferPreview = updateCrossChainTransferPreview;


    /* =========================================================================
       §6  checkAndAwardRank
       ========================================================================= */

    /**
     * Check whether user has crossed any ranking milestone and award EMPY
     * from the ranking pool.  Idempotent — uses user.awardedRanks Set.
     * @param {Object} user — userState or any mockUsers entry
     */
    function checkAndAwardRank(user) {
        if (!user || (user.followerCount || 0) < 500) return;

        // FIX (root cause of "[Empyrean Promise] user.awardedRanks.has is
        // not a function", thrown every time someone follows an account
        // whose followerCount is already >= 500): this function is
        // documented above as using a Set, which is true for the current
        // session's own userState — normalized to a Set at login/session-
        // restore elsewhere in this codebase — but this function is ALSO
        // called with OTHER users' plain objects (app-fixes.js's follow-btn
        // handler calls this on the person just followed, to check whether
        // their new follower count just crossed a rank threshold). Those
        // objects come straight from mockUsers/Firestore, where
        // awardedRanks — if present at all — is a plain array, never a
        // Set, so .has()/.add() below threw. Normalizing once here keeps
        // every existing .has()/.add() call in this function working
        // unchanged for every caller, current-user or not.
        if (!(user.awardedRanks instanceof Set)) {
            user.awardedRanks = new Set(Array.isArray(user.awardedRanks) ? user.awardedRanks : []);
        }

        var mining = _mining();
        var pool   = _pool();

        RANKS.forEach(function (rank) {
            if ((user.followerCount || 0) >= rank.followers
                && !user.awardedRanks.has(rank.id)) {
                if ((mining.rankingPoolSpent || 0) + rank.reward <= pool) {
                    user.empyBalance = (user.empyBalance || 0) + rank.reward;
                    user.awardedRanks.add(rank.id);
                    mining.rankingPoolSpent = (mining.rankingPoolSpent || 0) + rank.reward;
                    _set('impactMiningState', mining);

                    if (user.id === (_us().id)) {
                        if (typeof window.showNotification === 'function') {
                            window.showNotification(
                                'Congratulations! You have reached the rank of '
                                + rank.name + ' and earned ' + rank.reward + ' EMPY!',
                                'success'
                            );
                        }
                        updateWalletUI();
                        /* Persist to Firestore */
                        var uid = user.id;
                        if (uid && window.fbDb && window._firebaseLoaded) {
                            window.fbDb.collection('users').doc(uid).update({
                                empyBalance: user.empyBalance,
                                awardedRanks: Array.from(user.awardedRanks)
                            }).catch(function () {});
                        }
                    }
                }
            }
        });
    }
    window.checkAndAwardRank = checkAndAwardRank;


    /* =========================================================================
       §7  BUY EMPY PREVIEW (live input feedback)
       ========================================================================= */

    /**
     * Show live "You will receive X EMPY" preview while the user types
     * in the buy-empy amount field.
     */
    function _updateBuyEmpyPreview() {
        var amountInput = document.getElementById('buy-empy-amount-usd');
        var previewEl   = document.getElementById('empy-to-receive-preview');
        if (!amountInput || !previewEl) return;
        var amountNgn = parseFloat(amountInput.value) || 0;
        if (amountNgn > 0) {
            var empyAmt = (amountNgn / _ngn()) / _rate();
            previewEl.textContent = 'You will receive: ' + Math.floor(empyAmt).toLocaleString() + ' EMPY';
        } else {
            previewEl.textContent = '';
        }
    }


    /* =========================================================================
       §8  FORM SUBMIT HANDLERS
       ========================================================================= */

    /**
     * Handle stake-form, unstake-form, withdrawal-form, buy-empy-form.
     * Delegated through a submit listener on document.
     */
    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form) return;
        var formId = form.id;

        /* ── Stake ── */
        if (formId === 'stake-form') {
            e.preventDefault();
            if (_guest()) { _openAuth(); return; }
            var stakeInput = document.getElementById('stake-amount');
            if (!stakeInput) return;
            var amt = parseFloat(stakeInput.value);
            var us  = _us();
            if (!amt || amt <= 0) {
                _notify('Please enter a valid amount to stake.', 'error'); return;
            }
            if ((us.empyBalance || 0) < amt) {
                _notify('Insufficient EMPY balance for staking.', 'error'); return;
            }
            // FIX (2026-07-31 — real server-side staking): this used to
            // move the amount between empyBalance and
            // userManualStakedBalance entirely in local memory (two tabs
            // staking concurrently could each pass this same stale-balance
            // check and jointly over-stake). Now goes through
            // /api/staking/stake, which re-checks the balance inside its
            // own Admin SDK transaction and is the only thing that can
            // move either field from here on (see firebase-rules.js's
            // touchesServerOnlyStakingFields).
            var stakeBtn = form.querySelector('button[type="submit"]');
            if (stakeBtn) stakeBtn.disabled = true;
            fetch(STAKING_API() + '/stake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: us.id, amount: amt })
            }).then(_readStakingJson).then(function (data) {
                _applyStakingState(data);
                _notify(amt.toLocaleString() + ' EMPY staked successfully!', 'success');
                form.reset();
            }).catch(function (err) {
                _notify('Could not stake: ' + (err && err.message || 'Unknown error'), 'error');
            }).finally(function () {
                if (stakeBtn) stakeBtn.disabled = false;
            });
            return;
        }

        /* ── Unstake ── */
        if (formId === 'unstake-form') {
            e.preventDefault();
            if (_guest()) { _openAuth(); return; }
            var unstakeInput = document.getElementById('unstake-amount');
            if (!unstakeInput) return;
            var uAmt = parseFloat(unstakeInput.value);
            var us   = _us();
            if (!uAmt || uAmt <= 0) {
                _notify('Please enter a valid amount to unstake.', 'error'); return;
            }
            if (_manualStk() < uAmt) {
                _notify("You don't have enough manual staked EMPY to unstake.", 'error'); return;
            }
            // FIX (2026-07-31 — real server-side staking): same gap as
            // stake above, plus this is where the app previously had NO
            // server involvement at all in moving staked EMPY back to a
            // withdrawable balance. Now goes through /api/staking/unstake.
            var unstakeBtn2 = form.querySelector('button[type="submit"]');
            if (unstakeBtn2) unstakeBtn2.disabled = true;
            fetch(STAKING_API() + '/unstake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: us.id, amount: uAmt })
            }).then(_readStakingJson).then(function (data) {
                _applyStakingState(data);
                var hist = _history();
                hist.push({ type: 'Manual Staking Unstaked', amount: uAmt, date: new Date().toLocaleDateString() });
                _set('userClaimedRewardsHistory', hist);
                _notify(uAmt.toLocaleString() + ' EMPY unstaked successfully!', 'success');
                form.reset();
            }).catch(function (err) {
                _notify('Could not unstake: ' + (err && err.message || 'Unknown error'), 'error');
            }).finally(function () {
                if (unstakeBtn2) unstakeBtn2.disabled = false;
            });
            return;
        }

        /* ── Withdrawal ── */
        if (formId === 'withdrawal-form') {
            e.preventDefault();
            if (_guest()) { _openAuth(); return; }
            var wInput = document.getElementById('withdrawal-amount');
            if (!wInput) return;
            var wAmt = parseFloat(wInput.value);
            var us   = _us();
            if (!wAmt || wAmt <= 0) {
                _notify('Enter an amount to withdraw.', 'error'); return;
            }
            var method = (document.getElementById('withdrawal-method') || {}).value || '';
            if (!method) { _notify('Please select a withdrawal method.', 'error'); return; }

            /* FIX (Payment System Restructuring — earnings segmentation):
               this form used to draw straight from empyBalance — the
               general SPENDABLE balance every gift/stake/purchase also
               touches — with NO server-side gate at all: it wrote directly
               to withdrawal_queue itself, so nothing ever checked a
               follower threshold, a per-tier minimum, or even that the
               claimed amount was real (same "client fully trusted" class
               of hole already closed for staking/purchases/rank-rewards —
               see those fixes' own comments in this file). Per the
               restructuring spec, purchased/gifted EMPY is what's
               withdrawable here — "since these tokens are purchased
               directly, users may withdraw them" — tracked separately in
               giftTokenBalance, NOT empyBalance (which stays fully
               spendable on gifts/staking/etc. and is untouched by a
               withdrawal now). Routed through
               /api/earnings/gifting/request-withdrawal (earnings-routes.js),
               which independently re-checks the follower tier, the
               per-tier minimum, and the real giftTokenBalance server-side
               (Admin SDK transaction) before moving anything — this
               client-side amount is only ever used to decide whether to
               bother making the call. Reward-origin EMPY
               (rewardsBalance) is a separate, launch-gated stream this
               form does not touch — see /api/earnings/rewards/request-
               withdrawal for that path once it unlocks. */
            var accountDetails =
                method === 'bank' ? {
                    bankName:      (document.getElementById('bank-name')      || {}).value || '',
                    accountNumber: (document.getElementById('account-number') || {}).value || ''
                } :
                method === 'intl-wire' ? {
                    bankName:      (document.getElementById('intl-wire-bank-name')  || {}).value || '',
                    accountName:   (document.getElementById('intl-wire-account-name') || {}).value || '',
                    iban:          (document.getElementById('intl-wire-iban')       || {}).value || '',
                    swift:         (document.getElementById('intl-wire-swift')      || {}).value || '',
                    country:       (document.getElementById('intl-wire-country')    || {}).value || ''
                } : null;

            var wBtn = form.querySelector('button[type="submit"]');
            if (wBtn) wBtn.disabled = true;

            _earningsIdToken().then(function (token) {
                return fetch(EARNINGS_API() + '/gifting/request-withdrawal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({
                        userId: us.id,
                        amountEmpy: wAmt,
                        method: method,
                        accountDetails: accountDetails
                    })
                });
            }).then(function (r) {
                return r.json().then(function (d) {
                    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
                    return d;
                });
            }).then(function (d) {
                if (typeof d.newBalance === 'number') us.giftTokenBalance = d.newBalance;
                _notify('Withdrawal request submitted for approval — ' +
                    (typeof d.netAmountEmpy === 'number' ? d.netAmountEmpy.toLocaleString() : wAmt.toLocaleString()) +
                    ' EMPY after fee.', 'success');
                form.reset();
                handleWithdrawalMethodChange();
                updateWithdrawalPreview();
                updateWalletUI();
            }).catch(function (err) {
                _notify((err && err.message) || 'Could not submit withdrawal request.', 'error');
            }).finally(function () {
                if (wBtn) wBtn.disabled = false;
            });
            return;
        }

        /* ── Buy EMPY (Flutterwave) ── */
        if (formId === 'buy-empy-form') {
            e.preventDefault();
            if (_guest()) { _openAuth(); return; }
            var buyInput = document.getElementById('buy-empy-amount-usd');
            if (!buyInput) return;
            var amountNgn = parseFloat(buyInput.value);
            if (isNaN(amountNgn) || amountNgn < 500) {
                _notify('Minimum purchase is ₦500.', 'error'); return;
            }
            var empyReceived = (amountNgn / _ngn()) / _rate();
            var us = _us();
            var _buyTxRef = 'EMPY-BUY-' + Date.now();

            if (typeof FlutterwaveCheckout !== 'undefined') {
                FlutterwaveCheckout({
                    public_key: (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '',
                    tx_ref:     _buyTxRef,
                    amount:     amountNgn,
                    currency:   'NGN',
                    payment_options: 'card,banktransfer,ussd',
                    customer: {
                        email:        us.email     || 'user@empyrean.com',
                        phone_number: us.phone     || '',
                        name:         us.fullName  || 'Empyrean Member'
                    },
                    customizations: {
                        title:       'Buy EMPY Tokens',
                        description: 'Purchase ' + Math.floor(empyReceived).toLocaleString() + ' EMPY Tokens',
                        logo:        'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
                    },
                    callback: function (data) {
                        if (data.status === 'successful') {
                            form.reset();
                            var modal = document.getElementById('buy-empy-modal');
                            if (modal) modal.classList.remove('show');
                            _notify('Confirming your payment…', 'info');

                            /* FIX (2026-07-31 — token-ecosystem security review): this
                               used to trust Flutterwave's own client-side callback
                               alone and self-credit empyBalance directly here — that
                               callback is just JS running in this same page, trivially
                               invokable from devtools with a fabricated
                               {status:'successful'} object, with nothing server-side
                               ever confirming a real charge happened. Now goes through
                               the already-built /api/wallet/confirm-purchase
                               (server.js), which re-verifies this exact tx_ref against
                               Flutterwave's own API server-side (FLW_SECRET_KEY never
                               leaves the server) and computes the EMPY amount from the
                               VERIFIED charge amount, never from this client's own
                               amountNgn input, before crediting anything. Idempotent
                               server-side on tx_ref, so a retry here can't double-credit. */
                            fetch(window._empApiBase() + '/api/wallet/confirm-purchase', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ txRef: _buyTxRef, userId: us.id })
                            }).then(function (r) {
                                return r.json().then(function (d) {
                                    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
                                    return d;
                                });
                            }).then(function (d) {
                                if (typeof d.newBalance === 'number') us.empyBalance = d.newBalance;
                                updateWalletUI();
                                _notify(Math.floor(d.empyAmount || empyReceived).toLocaleString() + ' EMPY purchased successfully!', 'success');
                            }).catch(function (err) {
                                _notify('Payment received but confirmation failed — contact support if your balance doesn\u2019t update shortly (' + (err && err.message || 'unknown error') + ').', 'warning');
                            });
                        } else {
                            _notify('Payment was not completed. Please try again.', 'error');
                        }
                    },
                    onclose: function () {}
                });
            } else {
                _notify('Payment system not available. Please try again shortly.', 'error');
            }
            return;
        }
    });


    /* =========================================================================
       §9  CLAIM REWARD BUTTON
       ========================================================================= */

    /**
     * Wire the claim-reward-btn.  Uses event delegation + a one-time
     * addEventListener so it works even when the wallet section is rendered
     * after page load.
     */
    document.addEventListener('click', function (e) {
        var t = e.target;

        /* ── Claim rewards ── */
        if (t.id === 'claim-reward-btn' || t.closest('#claim-reward-btn')) {
            e.preventDefault();
            var earned = _earned();
            if (earned > 0) {
                var us = _us();
                // FIX (2026-07-31 — real server-side staking): THE actual
                // live exploit found during the earlier completion pass —
                // this used to persist straight to empyBalance from
                // userEarnedRewards, a pure client-side number with no
                // Firestore-backed accrual anywhere, trivially settable to
                // anything via devtools before tapping Claim. Now goes
                // through /api/staking/claim-rewards, which computes the
                // claimable amount ONLY from the user's OWN stored
                // manualStakedBalance/stakingLastAccrualAt server-side —
                // the client submits nothing but userId, and this button's
                // own `earned` value above is used only to decide whether
                // to bother making the call, never as the credited amount.
                var claimBtn = t.id === 'claim-reward-btn' ? t : t.closest('#claim-reward-btn');
                if (claimBtn) claimBtn.disabled = true;
                fetch(STAKING_API() + '/claim-rewards', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: us.id })
                }).then(_readStakingJson).then(function (data) {
                    _applyStakingState(data);
                    if (data.claimed > 0) {
                        var hist = _history();
                        hist.push({ type: 'Claimed Rewards', amount: data.claimed, date: new Date().toLocaleDateString() });
                        _set('userClaimedRewardsHistory', hist);
                        _notify('Rewards claimed successfully!', 'success');
                    } else {
                        _notify('No rewards to claim.', 'info');
                    }
                }).catch(function (err) {
                    _notify('Could not claim rewards: ' + (err && err.message || 'Unknown error'), 'error');
                }).finally(function () {
                    if (claimBtn) claimBtn.disabled = (_earned() <= 0);
                });
            } else {
                _notify('No rewards to claim.', 'info');
            }
        }

        /* ── Open buy-empy modal ── */
        if (t.id === 'buy-empy-btn' || t.closest('#buy-empy-btn, #buy-empy-wallet-btn')) {
            var modal = document.getElementById('buy-empy-modal');
            if (modal) {
                modal.classList.add('show');
                document.body.classList.add('modal-open');
            }
        }
    });


    /* =========================================================================
       §10  WALLET PAYMENT-TAB SWITCHING
       ========================================================================= */

    document.addEventListener('click', function (e) {
        var tab = e.target.closest('.payment-tab');
        if (!tab) return;
        var targetId = tab.dataset.target;
        if (!targetId) return;

        var container = tab.closest('.payment-tabs');
        if (!container) return;

        container.querySelectorAll('.payment-tab').forEach(function (t) {
            t.classList.remove('active');
        });
        tab.classList.add('active');

        /* Show matching .payment-method-content panel */
        var form = tab.closest('form, .modal-card, .card-content');
        if (form) {
            form.querySelectorAll('.payment-method-content').forEach(function (p) {
                p.classList.remove('active');
                p.style.display = 'none';
            });
            var target = form.querySelector('#' + targetId);
            if (target) {
                target.classList.add('active');
                target.style.display = 'block';
            }
        }
    });


    /* =========================================================================
       §11  COPY WALLET ADDRESS
       ========================================================================= */

    document.addEventListener('click', function (e) {
        var copyBtn = e.target.closest('.copy-wallet-address-btn, #copy-wallet-address-btn');
        if (!copyBtn) return;
        e.preventDefault();
        var addrEl  = document.getElementById('user-wallet-address')
            || document.querySelector('.wallet-address-text');
        var address = (addrEl ? addrEl.textContent : '') || (copyBtn.dataset.address || '');
        if (!address.trim()) {
            _notify('No wallet address found.', 'warning'); return;
        }
        if (navigator.clipboard) {
            navigator.clipboard.writeText(address.trim()).then(function () {
                _notify('Wallet address copied!', 'success');
            }).catch(function () {
                _legacyCopy(address.trim());
            });
        } else {
            _legacyCopy(address.trim());
        }
    });

    function _legacyCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); _notify('Address copied!', 'success'); } catch (e) {}
        document.body.removeChild(ta);
    }


    /* =========================================================================
       §12  BOOTSTRAP — live input listeners + init-done hook
       ========================================================================= */

    /* Wire live preview inputs */
    document.addEventListener('input', function (e) {
        var id = e.target && e.target.id;
        if (!id) return;
        if (id === 'withdrawal-amount' || id === 'withdrawal-method') updateWithdrawalPreview();
        if (id === 'transfer-amount')                                  updateTransferPreview();
        if (id === 'cross-chain-amount' || id === 'cross-chain-network') updateCrossChainTransferPreview();
        if (id === 'buy-empy-amount-usd')                              _updateBuyEmpyPreview();
    });

    document.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'withdrawal-method') handleWithdrawalMethodChange();
        if (e.target && e.target.id === 'cross-chain-network') updateCrossChainTransferPreview();
    });

    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () {
            updateWalletUI();
            updateStakingUI();
            syncStakingState();
        }, 300);
    });

    /* ADDED (Payment System Restructuring — earnings segmentation):
       re-fetch the summary whenever the person navigates back to My
       Wallet, not just once at boot — a gift/withdrawal/rank-reward
       elsewhere in the app since the last visit should show up without
       needing a full page reload. Scoped to my-wallet only; every other
       section change is a no-op here since renderEarningsSummary()
       itself already bails out if #earnings-summary-container isn't in
       the DOM. */
    document.addEventListener('empyrean-section-change', function (e) {
        if (e && e.detail && e.detail.section === 'my-wallet') {
            setTimeout(renderEarningsSummary, 150);
        }
    });


    /* ── Private utilities ── */
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type);
    }
    function _openAuth() {
        if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
    }
    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }


    console.log('[EmpWallet] ✅ Wallet & staking module ready.');

})();