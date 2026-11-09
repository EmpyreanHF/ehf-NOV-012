/* =============================================================================
   EMPYREAN INTERNATIONAL — EARNINGS SEGMENTATION (backend)
   earnings-routes.js  |  Node/Express router. Mount in server.js.

   Implements "Payment System Restructuring" — the three earning streams are
   kept as three INDEPENDENTLY-GATED balances instead of one combined
   empyBalance, so a withdrawal from one stream can never accidentally draw
   down another:

     1. REWARDS SYSTEM (formerly "Impact Mining")
        Ledger field: users/{uid}.rewardsBalance
        Credited by:  server.js's /api/wallet/claim-mining-reward and
                      /api/wallet/claim-rank-reward (Admin SDK, additive —
                      see those endpoints' own comments).
        Withdrawal:   LOCKED outright until official platform launch — engagement
                      activities keep generating rewards (empyBalance is
                      untouched, so they still SPEND normally: gifts, staking,
                      etc.), but this specific balance cannot be cashed out
                      pre-launch. Gate is a single Firestore flag
                      (platform_config/launch.rewardsWithdrawalsLive) so it can
                      be flipped at real launch without a redeploy.

     2. GIFTING & TIPPING WITHDRAWALS
        Ledger field: users/{uid}.giftTokenBalance
        Credited by:  server.js's /api/wallet/confirm-purchase (a card-verified
                      EMPY purchase — these are real-money-backed tokens), and
                      client-side by app-gifts.js when a gift/tip is RECEIVED
                      (a capped, increase-only cross-user credit — see
                      firebase-rules.js's isGiftTokenBalanceCreditOnlyUpdate).
        Withdrawal:   gated on the TIERED follower-threshold model below —
                      this file is the single source of truth for that ladder;
                      nothing about the money moves without going through
                      /gifting/request-withdrawal.

     3. ADVERT REVENUE EARNINGS
        Already fully implemented server-side — see the "AD REVENUE SHARE"
        block further down in server.js (ad_revenue_shares ledger,
        /api/admin/ad-revenue/compute-payouts, /api/ad-revenue/request-payout).
        This file does NOT duplicate that logic — /summary below just reads
        the same ad_revenue_shares/{uid} doc read-only so the wallet UI can
        show all three streams in one place.

   TOKEN RATE
   The restructuring proposal's "Token Rate = Total Fiat Paid / Total Tokens
   Issued" formula is already what EMPY_RATE_USD encodes on the purchase side
   (server.js: amountNgn / USD_TO_NGN_RATE / EMPY_RATE_USD = empyToReceive,
   i.e. a fixed $0.10/EMPY peg — the proposal's own "Fixed Base Rate: start
   with a stable peg" best practice). Reused here, not recomputed, so a
   withdrawal always converts at the exact same rate a purchase would have
   paid. Overridable via EMPY_RATE_USD env var, matching the existing
   /api/ad-revenue/request-payout convention (server.js).

   AUTH
   Every endpoint that moves money requires a Firebase ID token (Authorization:
   Bearer <token>) whose uid matches the userId being acted on — same bearer-
   token pattern as the AD REVENUE SHARE block. The admin launch-toggle
   endpoint additionally requires one of ADMIN_EMAILS (or the admin custom
   claim) — same identities firebase-rules.js's isAdmin() and
   bulk-disburse-routes.js's ADMIN_EMAILS already trust.
   ============================================================================= */

'use strict';

const express = require('express');

const ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];

const EMPY_RATE_USD = Number(process.env.EMPY_RATE_USD) || 0.10; // $ per EMPY — mirrors server.js's own constant

// System charge deducted from every withdrawal (Gifting & Tipping stream).
// Proposal range was 5–10%; picked the low end so the fee is never the
// reason a legitimate cash-out looks unattractive. Env-overridable for a
// later tuning pass without a code change.
const WITHDRAWAL_FEE_PCT = Number(process.env.EARNINGS_WITHDRAWAL_FEE_PCT) || 0.05;

// ── Live Streaming Income (gift income received while hosting a live
// stream — see app-fixes.js's _empySendGiftNow, which credits this onto
// users/{uid}.liveStreamIncome) ─────────────────────────────────────────
// Minimum a single withdrawal request must clear — no follower-tier ladder
// like Gifting & Tipping (a live host's income isn't tied to follower
// count the same way), just one flat floor so small/frequent cash-outs
// don't eat the platform in transaction overhead, same rationale as
// GIFTING_WITHDRAWAL_TIERS above. Defaults to match gifting's own tier-1
// floor ($10) for consistency between the two streams now that the wallet
// UI shows them side by side — env-overridable if that number needs
// tuning later without a code change.
const LIVE_STREAMING_MIN_WITHDRAW_USD = Number(process.env.LIVE_STREAMING_MIN_WITHDRAW_USD) || 10;
// Same withdrawal fee as gifting — one consistent fee across both streams
// rather than a second, separately-tuned percentage.
const LIVE_STREAMING_WITHDRAWAL_FEE_PCT = WITHDRAWAL_FEE_PCT;

// ── Tiered Withdrawal Threshold Model (Gifting & Tipping only) ────────────
// Below the first tier's follower floor, withdrawal is not offered at all —
// "Withdrawals are only permitted once users meet a minimum follower
// threshold (e.g., 500–1,000 followers)". Each tier's minWithdrawUsd is the
// MINIMUM a single withdrawal request must clear at that follower count —
// not a balance cap, just a floor, so small/frequent cash-outs don't eat the
// platform in transaction overhead. Ordered ascending; the matching tier is
// the LAST one whose minFollowers the user's followerCount clears.
const GIFTING_WITHDRAWAL_TIERS = [
    { id: 'tier-1', minFollowers: 500,    minWithdrawUsd: 10  },
    { id: 'tier-2', minFollowers: 1000,   minWithdrawUsd: 20  },
    { id: 'tier-3', minFollowers: 5000,   minWithdrawUsd: 50  },
    { id: 'tier-4', minFollowers: 10000,  minWithdrawUsd: 100 },
    { id: 'tier-5', minFollowers: 25000,  minWithdrawUsd: 200 }
];

function _tierFor(followerCount) {
    let matched = null;
    for (const tier of GIFTING_WITHDRAWAL_TIERS) {
        if (followerCount >= tier.minFollowers) matched = tier;
    }
    return matched; // null if below the first tier's floor
}

async function _requireAuthedUid(req, res, admin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }
    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

async function _requireAdmin(req, res, admin) {
    const decoded = await _requireAuthedUid(req, res, admin);
    if (!decoded) return null;
    const isAdmin = decoded.admin === true || ADMIN_EMAILS.includes(decoded.email);
    if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
    return decoded;
}

module.exports = function createEarningsRouter(getAdmin) {
    const router = express.Router();

    // ── GET /api/earnings/summary/:userId ── read-only, all three streams ──
    router.get('/summary/:userId', async (req, res) => {
        const admin = getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
        const decoded = await _requireAuthedUid(req, res, admin);
        if (!decoded) return;
        const { userId } = req.params;
        if (decoded.uid !== userId && decoded.admin !== true && !ADMIN_EMAILS.includes(decoded.email)) {
            return res.status(403).json({ error: 'Can only read your own earnings summary' });
        }

        try {
            const db = admin.firestore();
            const [userSnap, adRevSnap, launchSnap] = await Promise.all([
                db.collection('users').doc(userId).get(),
                db.collection('ad_revenue_shares').doc(userId).get(),
                db.collection('platform_config').doc('launch').get()
            ]);
            const u = userSnap.exists ? (userSnap.data() || {}) : {};
            const adRev = adRevSnap.exists ? (adRevSnap.data() || {}) : {};
            const launch = launchSnap.exists ? (launchSnap.data() || {}) : {};

            const followerCount = Number(u.followerCount || 0);
            const tier = _tierFor(followerCount);
            const adRevAvailableUsd = Math.max(0, (Number(adRev.totalEarnedUsd) || 0) - (Number(adRev.paidOutUsd) || 0));

            res.json({
                ok: true,
                empyRateUsd: EMPY_RATE_USD,
                followerCount,
                rewards: {
                    balanceEmpy: Number(u.rewardsBalance || 0),
                    withdrawable: launch.rewardsWithdrawalsLive === true,
                    lockedReason: launch.rewardsWithdrawalsLive === true
                        ? null
                        : 'Rewards cannot be withdrawn until the official full launch.'
                },
                gifting: {
                    balanceEmpy: Number(u.giftTokenBalance || 0),
                    eligible: !!tier,
                    tierId: tier ? tier.id : null,
                    minWithdrawUsd: tier ? tier.minWithdrawUsd : null,
                    minWithdrawEmpy: tier ? Math.ceil(tier.minWithdrawUsd / EMPY_RATE_USD) : null,
                    nextTier: !tier ? GIFTING_WITHDRAWAL_TIERS[0] : null,
                    feePct: WITHDRAWAL_FEE_PCT
                },
                advertRevenue: {
                    totalEarnedUsd: Number(adRev.totalEarnedUsd) || 0,
                    paidOutUsd: Number(adRev.paidOutUsd) || 0,
                    availableUsd: adRevAvailableUsd,
                    suspiciousFlag: !!adRev.suspiciousFlag
                },
                liveStreaming: {
                    balanceEmpy: Number(u.liveStreamIncome || 0),
                    kycVerified: !!u.isVerified,
                    minWithdrawUsd: LIVE_STREAMING_MIN_WITHDRAW_USD,
                    minWithdrawEmpy: Math.ceil(LIVE_STREAMING_MIN_WITHDRAW_USD / EMPY_RATE_USD),
                    feePct: LIVE_STREAMING_WITHDRAWAL_FEE_PCT
                }
            });
        } catch (err) {
            console.error('[Earnings Summary] failed for', userId, '-', err.message);
            res.status(500).json({ error: 'Could not load earnings summary', detail: err.message });
        }
    });

    // ── POST /api/earnings/gifting/request-withdrawal ──────────────────────
    // body: { userId, amountEmpy, method, accountDetails }
    // Validates follower-tier eligibility + per-tier minimum, computes the
    // system-charge fee, decrements giftTokenBalance (NOT empyBalance — those
    // purchased/gifted tokens may already be earmarked for spending elsewhere;
    // this only ever draws down the withdrawable ledger), and queues the
    // payout in withdrawal_queue with sourceType:'gifting' — the same
    // collection/admin-review flow /api/ad-revenue/request-payout already
    // uses for its own sourceType:'ad_revenue' requests.
    router.post('/gifting/request-withdrawal', async (req, res) => {
        const admin = getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
        const decoded = await _requireAuthedUid(req, res, admin);
        if (!decoded) return;

        const { userId, method, accountDetails } = req.body || {};
        const amountEmpy = Number(req.body && req.body.amountEmpy);
        if (!userId) return res.status(400).json({ error: 'userId required' });
        if (decoded.uid !== userId) return res.status(403).json({ error: 'Can only request your own withdrawal' });
        if (!(amountEmpy > 0)) return res.status(400).json({ error: 'amountEmpy must be a positive number' });
        if (!method) return res.status(400).json({ error: 'method required (e.g. "bank")' });

        try {
            const db = admin.firestore();
            const userRef = db.collection('users').doc(userId);

            const result = await db.runTransaction(async (tx) => {
                const snap = await tx.get(userRef);
                if (!snap.exists) return { code: 404, body: { error: 'User not found' } };
                const u = snap.data() || {};

                const followerCount = Number(u.followerCount || 0);
                const tier = _tierFor(followerCount);
                if (!tier) {
                    return {
                        code: 403,
                        body: { error: 'Withdrawals unlock once you reach ' + GIFTING_WITHDRAWAL_TIERS[0].minFollowers + ' followers.', followerCount }
                    };
                }

                const amountUsd = amountEmpy * EMPY_RATE_USD;
                if (amountUsd < tier.minWithdrawUsd) {
                    return {
                        code: 400,
                        body: {
                            error: 'Minimum withdrawal at your follower tier is $' + tier.minWithdrawUsd
                                + ' (\u2248 ' + Math.ceil(tier.minWithdrawUsd / EMPY_RATE_USD) + ' EMPY).',
                            tierId: tier.id, minWithdrawUsd: tier.minWithdrawUsd
                        }
                    };
                }

                const giftTokenBalance = Number(u.giftTokenBalance || 0);
                if (giftTokenBalance < amountEmpy) {
                    return { code: 400, body: { error: 'Insufficient gifting/tipping balance for this withdrawal.', giftTokenBalance } };
                }

                const feeEmpy = amountEmpy * WITHDRAWAL_FEE_PCT;
                const netAmountEmpy = amountEmpy - feeEmpy;

                tx.update(userRef, { giftTokenBalance: giftTokenBalance - amountEmpy });

                const reqRef = db.collection('withdrawal_queue').doc();
                tx.set(reqRef, {
                    userId, username: u.username || u.fullName || '', email: u.email || '',
                    amountEmpy: netAmountEmpy,
                    grossAmountEmpy: amountEmpy,
                    feeEmpy, feePct: WITHDRAWAL_FEE_PCT,
                    method, accountDetails: accountDetails || null,
                    sourceType: 'gifting',
                    followerCountAtRequest: followerCount,
                    tierId: tier.id,
                    status: 'pending',
                    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: new Date().toISOString() // matches the legacy withdrawal_queue shape's field name
                });

                return { code: 200, body: { ok: true, requestId: reqRef.id, amountEmpy, feeEmpy, netAmountEmpy, newBalance: giftTokenBalance - amountEmpy } };
            });

            res.status(result.code).json(result.body);
        } catch (err) {
            console.error('[Gifting Withdrawal] failed for', userId, '-', err.message);
            res.status(500).json({ error: 'Could not submit withdrawal request', detail: err.message });
        }
    });

    // ── POST /api/earnings/live-streaming/request-withdrawal ───────────────
    // body: { userId, amountEmpy, method, accountDetails }
    // Gated on KYC (userState.isVerified), not follower count — a live
    // host's gift income isn't tied to follower count the same way
    // Gifting & Tipping is. Debits users/{uid}.liveStreamIncome specifically
    // (NOT giftTokenBalance — these are two separate, independently-tracked
    // ledgers; see app-fixes.js's _empySendGiftNow for how liveStreamIncome
    // is credited). Mirrors /gifting/request-withdrawal's transaction/fee/
    // queue shape so both streams settle through the same admin review flow.
    router.post('/live-streaming/request-withdrawal', async (req, res) => {
        const admin = getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
        const decoded = await _requireAuthedUid(req, res, admin);
        if (!decoded) return;

        const { userId, method, accountDetails } = req.body || {};
        const amountEmpy = Number(req.body && req.body.amountEmpy);
        if (!userId) return res.status(400).json({ error: 'userId required' });
        if (decoded.uid !== userId) return res.status(403).json({ error: 'Can only request your own withdrawal' });
        if (!(amountEmpy > 0)) return res.status(400).json({ error: 'amountEmpy must be a positive number' });
        if (!method) return res.status(400).json({ error: 'method required (e.g. "bank")' });

        try {
            const db = admin.firestore();
            const userRef = db.collection('users').doc(userId);

            const result = await db.runTransaction(async (tx) => {
                const snap = await tx.get(userRef);
                if (!snap.exists) return { code: 404, body: { error: 'User not found' } };
                const u = snap.data() || {};

                if (!u.isVerified) {
                    return { code: 403, body: { error: 'Complete KYC verification before withdrawing live streaming income.' } };
                }

                const amountUsd = amountEmpy * EMPY_RATE_USD;
                if (amountUsd < LIVE_STREAMING_MIN_WITHDRAW_USD) {
                    return {
                        code: 400,
                        body: {
                            error: 'Minimum live streaming withdrawal is $' + LIVE_STREAMING_MIN_WITHDRAW_USD
                                + ' (\u2248 ' + Math.ceil(LIVE_STREAMING_MIN_WITHDRAW_USD / EMPY_RATE_USD) + ' EMPY).',
                            minWithdrawUsd: LIVE_STREAMING_MIN_WITHDRAW_USD
                        }
                    };
                }

                const liveStreamIncome = Number(u.liveStreamIncome || 0);
                if (liveStreamIncome < amountEmpy) {
                    return { code: 400, body: { error: 'Insufficient live streaming income for this withdrawal.', liveStreamIncome } };
                }

                const feeEmpy = amountEmpy * LIVE_STREAMING_WITHDRAWAL_FEE_PCT;
                const netAmountEmpy = amountEmpy - feeEmpy;

                tx.update(userRef, { liveStreamIncome: liveStreamIncome - amountEmpy });

                const reqRef = db.collection('withdrawal_queue').doc();
                tx.set(reqRef, {
                    userId, username: u.username || u.fullName || '', email: u.email || '',
                    amountEmpy: netAmountEmpy,
                    grossAmountEmpy: amountEmpy,
                    feeEmpy, feePct: LIVE_STREAMING_WITHDRAWAL_FEE_PCT,
                    method, accountDetails: accountDetails || null,
                    sourceType: 'live_streaming',
                    status: 'pending',
                    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: new Date().toISOString()
                });

                return { code: 200, body: { ok: true, requestId: reqRef.id, amountEmpy, feeEmpy, netAmountEmpy, newBalance: liveStreamIncome - amountEmpy } };
            });

            res.status(result.code).json(result.body);
        } catch (err) {
            console.error('[Live Streaming Withdrawal] failed for', userId, '-', err.message);
            res.status(500).json({ error: 'Could not submit withdrawal request', detail: err.message });
        }
    });

    // ── POST /api/earnings/rewards/request-withdrawal ───────────────────────
    // Always rejects unless platform_config/launch.rewardsWithdrawalsLive is
    // explicitly true — "The withdrawal section for rewards must remain
    // gated until launch." Kept as a real endpoint (rather than just hiding
    // the button client-side) so the gate holds even against a direct API
    // call, and so flipping the flag at launch needs no further code change.
    router.post('/rewards/request-withdrawal', async (req, res) => {
        const admin = getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
        const decoded = await _requireAuthedUid(req, res, admin);
        if (!decoded) return;

        const { userId } = req.body || {};
        if (!userId) return res.status(400).json({ error: 'userId required' });
        if (decoded.uid !== userId) return res.status(403).json({ error: 'Can only request your own withdrawal' });

        try {
            const db = admin.firestore();
            const launchSnap = await db.collection('platform_config').doc('launch').get();
            const live = launchSnap.exists && launchSnap.data().rewardsWithdrawalsLive === true;
            if (!live) {
                return res.status(403).json({ error: 'Rewards cannot be withdrawn until the official full launch.' });
            }
            // Reaching here means launch has flipped the flag on — reuses
            // the exact same tiered-withdrawal mechanics as gifting, since
            // by launch the two streams are meant to behave the same way
            // once both are live; kept as a deliberate no-op body (rather
            // than silently allowing an un-tiered withdrawal) until that
            // policy is confirmed at actual launch time.
            res.status(501).json({ error: 'Rewards withdrawals are enabled but the payout flow has not been finalized yet — contact support.' });
        } catch (err) {
            console.error('[Rewards Withdrawal] failed for', userId, '-', err.message);
            res.status(500).json({ error: 'Could not process request', detail: err.message });
        }
    });

    // ── POST /api/earnings/admin/set-launch-status ── admin-only toggle ────
    // body: { rewardsWithdrawalsLive: boolean }
    router.post('/admin/set-launch-status', async (req, res) => {
        const admin = getAdmin();
        if (!admin) return res.status(500).json({ error: 'Server Firebase Admin not configured' });
        const decoded = await _requireAdmin(req, res, admin);
        if (!decoded) return;

        const live = req.body && req.body.rewardsWithdrawalsLive === true;
        try {
            const db = admin.firestore();
            await db.collection('platform_config').doc('launch').set({
                rewardsWithdrawalsLive: live,
                updatedBy: decoded.email || decoded.uid,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            res.json({ ok: true, rewardsWithdrawalsLive: live });
        } catch (err) {
            res.status(500).json({ error: 'Could not update launch status', detail: err.message });
        }
    });

    return router;
};

module.exports.GIFTING_WITHDRAWAL_TIERS = GIFTING_WITHDRAWAL_TIERS;
module.exports.EMPY_RATE_USD = EMPY_RATE_USD;