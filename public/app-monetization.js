/* =============================================================================
   EMPYREAN INTERNATIONAL — CREATOR MONETIZATION MODULE
   app-monetization.js  |  Load LAST (after app-profile.js, app-wallet.js,
   app-kyc.js, app-analytics.js, app-admin.js, app-live.js) — this file only
   READS/WRAPS globals those already provide; it does not need to run before
   any of them.

   TASK: "Build a monetization module linked to the individual analytical
   tools system." — a full eligibility → tier → badge → payout pipeline,
   wired to real engagement data, additive only.

   ═══════════════════════════════════════════════════════════════════════
   WHAT ALREADY EXISTED (audited before writing a single line here)
   ═══════════════════════════════════════════════════════════════════════
   • app-profile.js  §2 renderMonetizationTab() — a flat gate
     (isVerified && followerCount>=500) showing a wallet-balance card or a
     "locked" reasons list, plus a RANKS ladder (Bronze 100 / Silver 500 /
     Gold 1000 / Platinum 5000 / Diamond 10000 / Elite 50000 followers)
     used ONLY for one-time EMPY follower-milestone rewards.
   • app-wallet.js — checkAndAwardRank() (pays out that RANKS ladder),
     updateWithdrawalPreview()/handleWithdrawalMethodChange() (fee math for
     an UNGATED withdrawal form), and already calls
     window.renderMonetizationTab() after every balance update.
   • app-kyc.js — kyc_submissions queue, approveKyc()/rejectKyc(), but
     approveKyc() never actually flips user.isVerified — only the separate
     admin "Mark Verified" toggle in app-live.js does that. Gap noted below.
   • app-analytics.js — site-wide analytics_sessions/analytics_daily page
     view tracking. Not per-creator, not engagement/retention.
   • Firestore rules already define posts, presence, withdrawal_queue,
     kyc_submissions, users — all reused here, nothing duplicated.

   This module does NOT replace or delete any of the above. It:
     1. Keeps RANKS (app-profile.js) and CREATOR_TIERS (below) as two
        clearly separate systems — one is a one-time follower-milestone
        reward, the other is the paid/compulsory creator badge + payout
        tier from the monetization spec. Same currency, different purpose.
     2. Fixes the approveKyc() → isVerified gap by wrapping (not editing)
        the existing function.
     3. Overrides window.renderMonetizationTab with a richer dashboard
        that reuses the same #profile-monetization container app-profile.js
        already builds and calls. (One surgical one-line change was made
        in app-profile.js so that call now checks window.renderMonetizationTab
        first, exactly like the "last-loaded patch wins" convention already
        used for CSS in app-patch-v32.js.)
     4. Wraps (not replaces) updateWithdrawalPreview to add an eligibility
        gate on top of the existing fee-math, and adds the missing
        "submit the request" step into the existing withdrawal_queue
        collection.
     5. Computes engagement straight from the existing `posts` collection
        (views / shareCount / commentCount / likes fields already written
        by app-feed.js) — no new collection for something that already
        exists.
     6. Adds exactly two new, narrowly-scoped Firestore collections that
        have no existing equivalent: creator_badges/{userId} and
        referrals/{referralId}. Rules for both appended to firebase-rules.js
        in the same style as the WALLET / FINANCIAL block.

   PUBLIC API
   ──────────
   window.EmpMonetization = {
       CREATOR_TIERS, computeEngagement, computeEligibility, determineTier,
       openCreatorBadgeModal, purchaseCreatorBadge, submitWithdrawalRequest,
       generateReferralLink, renderMonetizationTab, renderAdminMonetizationPanel
   }
   (Also exposed individually on window.* for onclick="" handlers, matching
   this codebase's existing convention.)

   SECTION MAP
   ───────────
   §1  Guards, shared helpers
   §2  CREATOR_TIERS constants (separate from app-profile.js RANKS)
   §3  Engagement engine (reads `posts` collection)
   §4  Activity engine (reads `presence` collection)
   §5  Eligibility engine (merges §3+§4 + KYC + followers + badge)
   §6  Tier assignment
   §7  Creator badge purchase flow (creator_badges collection)
   §8  Payout / withdrawal gate + compliance pre-check (withdrawal_queue)
   §9  Referral tracking (referrals collection)
   §10 Creator dashboard renderer — overrides window.renderMonetizationTab
   §11 Admin monetization panel
   §12 KYC → isVerified wiring fix (wraps approveKyc, non-destructive)
   §13 Init / event wiring
   §14 AD REVENUE SHARE — "Content Creator Monetization Model" proposal
       (engagement-based ad-revenue split, kept deliberately independent of
       both the CREATOR_TIERS/badge system above and app-impactmining.js;
       see §14's own header comment for the full design). Computation and
       every write now live SERVER-SIDE (server.js's /api/admin/ad-revenue/*
       and /api/ad-revenue/request-payout routes, Admin SDK) — this file
       only reads ad_revenue_shares/ad_revenue_quarterly_reports/
       ad_revenue_program_meta and calls those routes; firebase-rules.js
       denies client writes to all three outright (`if false`), admin
       session or not. Admin UI mounts into #admin-ad-revenue-container
       (added to index.html next to #admin-monetization-container).
   ============================================================================= */

(function empyreanMonetizationModule() {
    'use strict';

    if (window._empyreanMonetizationLoaded) {
        console.warn('[EmpMonetization] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanMonetizationLoaded = true;

    /* =========================================================================
       §1  Shared helpers — local copies, same shape as every other patch file
           in this codebase, zero dependency on other files' closures.
       ========================================================================= */

    function log(msg)  { console.log('[Monetization] ' + msg); }
    function warn(msg) { console.warn('[Monetization] ' + msg); }

    function _S()       { return window.EmpState || {}; }
    function _us()       { return _S().userState || window.userState || {}; }
    function _mu()       { return _S().mockUsers || window.mockUsers || {}; }
    function _isGuest()  { var s = _S(); return s.isGuest != null ? s.isGuest : !!window.isGuest; }
    function _isAdmin()  { var s = _S(); return s.isAdmin != null ? s.isAdmin : !!window.isAdmin; }
    function _fbOk()     { return !!(window._firebaseLoaded && window.fbDb && typeof window.fbDb.collection === 'function'); }
    function _rate()     { return (_S().EMPY_RATE_USD) || window.EMPY_RATE_USD || 0.10; }
    function _fmtUsd(v)  { return typeof window.formatUsdPrice === 'function' ? window.formatUsdPrice(v) : ('$' + (v || 0).toFixed(2)); }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _audit(action, target, details) {
        if (typeof window.logAdminAction === 'function') {
            try { window.logAdminAction(action, target, details); } catch (e) {}
        }
    }
    function _userById(userId) {
        var mu = _mu();
        if (mu && mu[userId]) return mu[userId];
        var us = _us();
        if (us && us.id === userId) return us;
        return null;
    }


    /* =========================================================================
       §2  CREATOR_TIERS
       Separate on purpose from app-profile.js RANKS (that ladder pays a
       one-time reward at 100/500/1000/5000/10000/50000 followers and is
       untouched here). This ladder governs cash-out eligibility, the
       verified-creator badge, and payout rate — per the monetization spec.
       ========================================================================= */

    var CREATOR_TIERS = [
        {
            key: 'bronze', name: 'Bronze', order: 1,
            minFollowers: 1000,
            badgeFeeUsd: 5, badgeRequired: false,       // optional at Bronze
            payoutRateMultiplier: 1.00,
            perks: ['Withdrawals enabled', 'Standard analytics']
        },
        {
            key: 'silver', name: 'Silver', order: 2,
            minFollowers: 5000,
            badgeFeeUsd: 10, badgeRequired: true,        // compulsory from Silver up
            payoutRateMultiplier: 1.15,
            perks: ['Higher payout rate', 'Advanced analytics', 'Priority support']
        },
        {
            key: 'gold', name: 'Gold', order: 3,
            minFollowers: 20000,
            badgeFeeUsd: 20, badgeRequired: true,
            payoutRateMultiplier: 1.35,
            perks: ['Premium payouts', 'Sponsorships', 'Brand partnerships', 'Referral bonuses', 'Dedicated account manager']
        }
    ];
    window.CREATOR_TIERS = CREATOR_TIERS;

    /* Mandatory-for-all-tiers engagement bar, straight from the spec. */
    var ENGAGEMENT_BAR = { avgViewsPerPost: 500, avgInteractionsPerPost: 50, retentionRate: 0.25 };

    /* Must have posted/logged in within this many days to stay eligible. */
    var ACTIVITY_WINDOW_DAYS = 90; // "3-month period"


    /* =========================================================================
       §3  Engagement engine — reads the SAME `posts` collection app-feed.js
           already writes to (views, shareCount, commentCount, likes).
           Cached 10 min per user so the dashboard doesn't re-query on every
           re-render.
       ========================================================================= */

    /* FIX (2026-11-06 — "Loading monetization status…" never finished): none of the Firestore reads
       below had a timeout, so one stalled read on a slow connection left the spinner up forever.
       Every read now goes through _tmo(), which rejects after `ms` so each existing .catch()
       fallback runs and the dashboard always renders. */
    function _tmo(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject({ code: 'timeout', message: 'Request timed out' }); }, ms || 6000);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    var _engagementCache = {}; // userId -> { data, ts }
    var ENGAGEMENT_CACHE_MS = 10 * 60 * 1000;

    function computeEngagement(userId, cb) {
        if (!userId) { cb({ postCount: 0, avgViews: 0, avgInteractions: 0, retentionRate: 0, meetsBar: false }); return; }

        var cached = _engagementCache[userId];
        if (cached && (Date.now() - cached.ts) < ENGAGEMENT_CACHE_MS) { cb(cached.data); return; }

        if (!_fbOk()) {
            var empty = {
                postCount: 0, avgViews: 0, avgInteractions: 0, retentionRate: 0, meetsBar: false, offline: true,
                dailySeries: [], breakdown: { likes: 0, comments: 0, shares: 0 }
            };
            cb(empty);
            return;
        }

        try {
            _tmo(window.fbDb.collection('posts').where('userId', '==', userId).limit(300).get(), 20000)
                .then(function (snap) {
                    var posts = [];
                    (snap.docs || []).forEach(function (d) { posts.push(d.data() || {}); });

                    var postCount = posts.length;
                    var totalViews = 0, totalInteractions = 0, engagedPosts = 0;
                    var totalLikes = 0, totalComments = 0, totalShares = 0;

                    // Last 7 calendar days, oldest → newest, for the trend bar chart
                    // (same "one bucket per YYYY-MM-DD" idea app-analytics.js already
                    // uses for its site-wide chart, applied here per-creator).
                    var dayBuckets = {};
                    var days = [];
                    for (var i = 6; i >= 0; i--) {
                        var d = new Date();
                        d.setDate(d.getDate() - i);
                        var key = d.toISOString().slice(0, 10);
                        days.push(key);
                        dayBuckets[key] = { key: key, views: 0, interactions: 0 };
                    }

                    posts.forEach(function (p) {
                        var views    = (typeof p.views === 'number' ? p.views : (p.viewCount || 0));
                        var likes    = p.likes || 0;
                        var comments = p.commentCount || 0;
                        var shares   = p.shareCount || 0;
                        var interactions = likes + comments + shares;
                        totalViews += views;
                        totalInteractions += interactions;
                        totalLikes += likes; totalComments += comments; totalShares += shares;
                        // Retention proxy: a post "retained" viewers if it collected
                        // any interaction beyond a passive view. Real watch-time /
                        // scroll-depth tracking isn't wired anywhere in this codebase
                        // yet — if/when app-video-fullscreen.js starts recording
                        // watch-time, swap this one line for that figure.
                        if (interactions > 0) engagedPosts++;

                        var createdRaw = p.createdAt;
                        var createdDate = (createdRaw && typeof createdRaw.toDate === 'function') ? createdRaw.toDate() : (createdRaw ? new Date(createdRaw) : null);
                        if (createdDate && !isNaN(createdDate.getTime())) {
                            var dKey = createdDate.toISOString().slice(0, 10);
                            if (dayBuckets[dKey]) { dayBuckets[dKey].views += views; dayBuckets[dKey].interactions += interactions; }
                        }
                    });

                    var avgViews        = postCount ? (totalViews / postCount) : 0;
                    var avgInteractions = postCount ? (totalInteractions / postCount) : 0;
                    var retentionRate   = postCount ? (engagedPosts / postCount) : 0;

                    var meetsBar = postCount > 0
                        && avgViews >= ENGAGEMENT_BAR.avgViewsPerPost
                        && avgInteractions >= ENGAGEMENT_BAR.avgInteractionsPerPost
                        && retentionRate >= ENGAGEMENT_BAR.retentionRate;

                    var data = {
                        postCount: postCount,
                        avgViews: avgViews,
                        avgInteractions: avgInteractions,
                        retentionRate: retentionRate,
                        meetsBar: meetsBar,
                        dailySeries: days.map(function (k) { return dayBuckets[k]; }),
                        breakdown: { likes: totalLikes, comments: totalComments, shares: totalShares }
                    };
                    _engagementCache[userId] = { data: data, ts: Date.now() };
                    cb(data);
                })
                .catch(function (err) {
                    warn('engagement query failed: ' + (err && err.message));
                    cb({ postCount: 0, avgViews: 0, avgInteractions: 0, retentionRate: 0, meetsBar: false, error: true });
                });
        } catch (e) {
            cb({ postCount: 0, avgViews: 0, avgInteractions: 0, retentionRate: 0, meetsBar: false, error: true });
        }
    }
    window.computeCreatorEngagement = computeEngagement;


    /* =========================================================================
       §4  Activity engine — reuses the existing `presence` collection
           (app-fix-final.js already writes lastSeen there on every heartbeat).
       ========================================================================= */

    function isActiveWithinWindow(userId, cb) {
        if (!userId || !_fbOk()) { cb(true); return; } // best-effort: don't block offline/local mode
        try {
            _tmo(window.fbDb.collection('presence').doc(userId).get())
                .then(function (doc) {
                    var data = doc && doc.exists && typeof doc.data === 'function' ? doc.data() : null;
                    if (!data || !data.lastSeen) { cb(true); return; } // no record yet — don't punish new accounts
                    var lastSeenMs = new Date(data.lastSeen).getTime();
                    var ageDays = (Date.now() - lastSeenMs) / (1000 * 60 * 60 * 24);
                    cb(ageDays <= ACTIVITY_WINDOW_DAYS);
                })
                .catch(function () { cb(true); });
        } catch (e) { cb(true); }
    }


    /* =========================================================================
       §5  Eligibility engine — merges everything into one verdict.
       ========================================================================= */

    function determineTier(followerCount) {
        var tier = null;
        CREATOR_TIERS.forEach(function (t) {
            if ((followerCount || 0) >= t.minFollowers) tier = t;
        });
        return tier; // null if below Bronze's 1000
    }
    window.determineCreatorTier = determineTier;

    function computeEligibility(userId, cb) {
        var user = _userById(userId) || {};
        var followerCount = user.followerCount || 0;
        var tier = determineTier(followerCount);

        var reasons = [];
        var badgeState = _badgeCache[userId] || null;

        function finish(engagement, active) {
            var kycOk = !!user.isVerified;
            if (!kycOk) reasons.push('Complete KYC verification.');
            if (!tier)  reasons.push('Reach at least ' + CREATOR_TIERS[0].minFollowers.toLocaleString() + ' followers (Bronze tier).');
            if (!engagement.meetsBar) {
                reasons.push('Meet the engagement bar: avg ' + ENGAGEMENT_BAR.avgViewsPerPost + ' views/post, '
                    + ENGAGEMENT_BAR.avgInteractionsPerPost + ' interactions/post, ' + Math.round(ENGAGEMENT_BAR.retentionRate * 100) + '%+ retention.');
            }
            if (!active) reasons.push('Stay active — no activity detected in the last ' + ACTIVITY_WINDOW_DAYS + ' days.');

            var badgeOk = true;
            if (tier && tier.badgeRequired) {
                badgeOk = !!(badgeState && badgeState.status === 'active' && badgeState.tier === tier.key);
                if (!badgeOk) reasons.push('Purchase the ' + tier.name + ' verified badge (' + _fmtUsd(tier.badgeFeeUsd) + ') — compulsory from Silver upward.');
            }

            var eligible = kycOk && !!tier && engagement.meetsBar && active && badgeOk;

            cb({
                eligible: eligible,
                tier: tier,
                followerCount: followerCount,
                engagement: engagement,
                active: active,
                kycVerified: kycOk,
                badge: badgeState,
                badgeRequired: !!(tier && tier.badgeRequired),
                badgeOk: badgeOk,
                reasons: reasons
            });
        }

        computeEngagement(userId, function (engagement) {
            isActiveWithinWindow(userId, function (active) {
                finish(engagement, active);
            });
        });
    }
    window.computeMonetizationEligibility = computeEligibility;


    /* =========================================================================
       §7  Creator badge purchase flow — new `creator_badges/{userId}` doc.
           Payment reuses the existing EMPY balance / rate, same math pattern
           as app-wallet.js's own preview functions (no new payment gateway
           invented here — Empy tokens now; card/PayPal fiat rails already
           exist in app-wallet.js's withdrawal method selector and can be
           pointed at this same purchaseCreatorBadge() entry point later).
       ========================================================================= */

    var _badgeCache = {}; // userId -> {tier, status, ...} (also §5 reads this)

    function _badgeDocRef(userId) {
        return window.fbDb.collection('creator_badges').doc(userId);
    }

    function loadCreatorBadge(userId, cb) {
        if (!userId || !_fbOk()) { cb(_badgeCache[userId] || null); return; }
        try {
            _tmo(_badgeDocRef(userId).get()).then(function (doc) {
                var data = doc && doc.exists && typeof doc.data === 'function' ? doc.data() : null;
                _badgeCache[userId] = data;
                cb(data);
            }).catch(function () { cb(_badgeCache[userId] || null); });
        } catch (e) { cb(_badgeCache[userId] || null); }
    }
    window.loadCreatorBadge = loadCreatorBadge;

    function openCreatorBadgeModal(tierKey) {
        var tier = CREATOR_TIERS.find(function (t) { return t.key === tierKey; });
        if (!tier) return;
        if (_isGuest()) { _notify('Please sign in to purchase a creator badge.', 'info'); return; }

        var us = _us();
        var priceEmpy = tier.badgeFeeUsd / _rate();
        var confirmMsg = 'Purchase the ' + tier.name + ' verified creator badge for '
            + _fmtUsd(tier.badgeFeeUsd) + ' (~' + priceEmpy.toFixed(2) + ' EMPY)?'
            + (tier.badgeRequired ? ' This badge is compulsory to cash out at ' + tier.name + ' tier.' : ' This badge is optional at Bronze tier.');

        if (typeof window.confirm === 'function' ? window.confirm(confirmMsg) : true) {
            purchaseCreatorBadge(tier.key);
        }
    }
    window.openCreatorBadgeModal = openCreatorBadgeModal;

    function purchaseCreatorBadge(tierKey) {
        var tier = CREATOR_TIERS.find(function (t) { return t.key === tierKey; });
        if (!tier) return;
        var us = _us();
        if (!us || !us.id) { _notify('Please sign in first.', 'error'); return; }

        var priceEmpy = tier.badgeFeeUsd / _rate();
        var balance = us.empyBalance || 0;
        if (balance < priceEmpy) {
            _notify('Insufficient EMPY balance. Need ~' + priceEmpy.toFixed(2) + ' EMPY, you have ' + balance.toFixed(2) + '.', 'error');
            return;
        }

        // Deduct locally first (optimistic — matches this app's existing
        // pattern for wallet UI updates), then persist.
        us.empyBalance = balance - priceEmpy;
        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

        var badgeDoc = {
            userId: us.id,
            tier: tier.key,
            status: 'active',
            feeUsd: tier.badgeFeeUsd,
            paidEmpy: priceEmpy,
            paymentMethod: 'empy_balance',
            purchasedAt: new Date().toISOString()
        };
        _badgeCache[us.id] = badgeDoc;

        if (_fbOk()) {
            try {
                _badgeDocRef(us.id).set(badgeDoc, { merge: true }).catch(function (e) { warn('badge write failed: ' + e.message); });
                window.fbDb.collection('users').doc(us.id).update({ empyBalance: us.empyBalance }).catch(function () {});
            } catch (e) {}
        }

        _audit('CREATOR_BADGE_PURCHASED', us.fullName + ' (' + (us.email || '') + ')', tier.name + ' badge — ' + _fmtUsd(tier.badgeFeeUsd));
        _notify(tier.name + ' verified creator badge activated! 🎉', 'success');
        renderMonetizationTab({ force: true });
    }
    window.purchaseCreatorBadge = purchaseCreatorBadge;


    /* =========================================================================
       §8  Payout / withdrawal gate — wraps (never replaces) the existing
           fee-math functions in app-wallet.js, and adds the missing
           "actually submit a request" step into the existing
           withdrawal_queue collection with a lightweight client-side
           compliance pre-check. Real fraud detection needs a server (Cloud
           Function) — this is a pre-flight flag for admin review only, it
           never itself blocks or approves a payout.
       ========================================================================= */

    var _origUpdateWithdrawalPreview = window.updateWithdrawalPreview;
    window.updateWithdrawalPreview = function () {
        var previewEl = document.getElementById('withdrawal-preview');
        var us = _us();
        if (!previewEl || !us || !us.id) {
            if (typeof _origUpdateWithdrawalPreview === 'function') _origUpdateWithdrawalPreview();
            return;
        }

        computeEligibility(us.id, function (verdict) {
            if (!verdict.eligible) {
                previewEl.innerHTML = '<div class="form-feedback error" style="display:block;">'
                    + '<p><i class="fas fa-lock"></i> Withdrawals are locked.</p>'
                    + '<ul style="margin:6px 0 0 18px;">' + verdict.reasons.map(function (r) { return '<li>' + _esc(r) + '</li>'; }).join('') + '</ul>'
                    + '</div>';
                return;
            }
            if (typeof _origUpdateWithdrawalPreview === 'function') _origUpdateWithdrawalPreview();
        });
    };

    function _lastWithdrawalTs(userId, cb) {
        if (!_fbOk()) { cb(0); return; }
        try {
            window.fbDb.collection('withdrawal_queue').where('userId', '==', userId)
                .orderBy('requestedAt', 'desc').limit(1).get()
                .then(function (snap) {
                    var ts = 0;
                    (snap.docs || []).forEach(function (d) {
                        var v = d.data() || {};
                        ts = v.requestedAt ? new Date(v.requestedAt).getTime() : 0;
                    });
                    cb(ts);
                }).catch(function () { cb(0); });
        } catch (e) { cb(0); }
    }

    /**
     * Submit a withdrawal request into the existing withdrawal_queue
     * collection, gated on §5 eligibility, with a compliance pre-check
     * flag for admin review (fast repeat withdrawals get flagged, not
     * blocked — final call stays with the admin panel).
     */
    function submitWithdrawalRequest(amountEmpy, method) {
        var us = _us();
        if (_isGuest() || !us || !us.id) { _notify('Please sign in first.', 'error'); return; }
        if (!amountEmpy || amountEmpy < 5 || !method) { _notify('Enter a valid amount (min 5 EMPY) and method.', 'error'); return; }
        if ((us.empyBalance || 0) < amountEmpy) { _notify('Insufficient EMPY balance.', 'error'); return; }

        computeEligibility(us.id, function (verdict) {
            if (!verdict.eligible) {
                _notify('Withdrawal blocked — you do not currently meet eligibility. See the Monetization tab for details.', 'error');
                return;
            }

            _lastWithdrawalTs(us.id, function (lastTs) {
                var hoursSinceLast = lastTs ? (Date.now() - lastTs) / 3600000 : 999;
                var flagged = hoursSinceLast < 1; // more than one request per hour → flag for review
                var reqDoc = {
                    userId: us.id,
                    amountEmpy: amountEmpy,
                    method: method,
                    tier: verdict.tier ? verdict.tier.key : null,
                    payoutRateMultiplier: verdict.tier ? verdict.tier.payoutRateMultiplier : 1,
                    status: 'pending',
                    flaggedForReview: flagged,
                    flagReason: flagged ? 'Multiple withdrawal requests within 1 hour' : null,
                    requestedAt: new Date().toISOString()
                };

                if (_fbOk()) {
                    try {
                        window.fbDb.collection('withdrawal_queue').add(reqDoc).catch(function (e) { warn('withdrawal submit failed: ' + e.message); });
                    } catch (e) {}
                }
                _audit('WITHDRAWAL_REQUESTED', us.fullName + ' (' + (us.email || '') + ')',
                    amountEmpy + ' EMPY via ' + method + (flagged ? ' — FLAGGED for review' : ''));
                _notify('Withdrawal request submitted' + (flagged ? ' — pending compliance review.' : ' for processing.'), 'success');
            });
        });
    }
    window.submitWithdrawalRequest = submitWithdrawalRequest;


    /* =========================================================================
       §9  Referral tracking (optional at every tier, never blocks cash-out).
           Additive `referrals/{referralId}` collection. Does not touch
           app-auth.js's signup flow — captures ?ref= on load, then records
           once a real userState.id shows up (poll, since sign-up can finish
           at any point after this file has already run).
       ========================================================================= */

    function generateReferralLink() {
        var us = _us();
        if (!us || !us.id) return null;
        var base = (window.location && window.location.origin) ? window.location.origin + window.location.pathname : '';
        return base + '?ref=' + encodeURIComponent(us.id);
    }
    window.generateReferralLink = generateReferralLink;

    function _captureReferralParam() {
        try {
            var params = new URLSearchParams(window.location.search || '');
            var ref = params.get('ref');
            if (ref) window._pendingReferralCode = ref;
        } catch (e) {}
    }

    function _tryRecordPendingReferral() {
        var us = _us();
        if (!window._pendingReferralCode || !us || !us.id || _isGuest()) return;
        if (window._pendingReferralCode === us.id) { window._pendingReferralCode = null; return; } // no self-referrals
        if (window._referralRecordedFor === us.id) return; // already recorded this session

        window._referralRecordedFor = us.id;
        var doc = {
            referrerId: window._pendingReferralCode,
            referredUserId: us.id,
            status: 'pending_verification', // an admin/engagement threshold can flip this later; fraud-detection is server-side
            createdAt: new Date().toISOString()
        };
        if (_fbOk()) {
            try { window.fbDb.collection('referrals').add(doc).catch(function () {}); } catch (e) {}
        }
        window._pendingReferralCode = null;
    }

    function getReferralStats(userId, cb) {
        if (!userId || !_fbOk()) { cb({ total: 0, verified: 0 }); return; }
        try {
            _tmo(window.fbDb.collection('referrals').where('referrerId', '==', userId).get())
                .then(function (snap) {
                    var total = 0, verified = 0;
                    (snap.docs || []).forEach(function (d) {
                        total++;
                        if ((d.data() || {}).status === 'verified') verified++;
                    });
                    cb({ total: total, verified: verified });
                }).catch(function () { cb({ total: 0, verified: 0 }); });
        } catch (e) { cb({ total: 0, verified: 0 }); }
    }


    /* =========================================================================
       §10 Creator dashboard — overrides window.renderMonetizationTab.
           2026-11-07 REBUILD (mockup-accurate, "appears and disappears" fixed):
             • ROOT CAUSE of the vanishing tab: app-profile.js rebuilds the whole profile DOM
               several times after load (follower recount, birthday feed, etc). The old render
               kept a reference to the #profile-monetization element that existed when it
               STARTED, so when its async reads finished it painted into a detached node and the
               visible tab stayed blank. Now every paint re-resolves the container by id.
             • The last good HTML is cached per user and re-injected synchronously whenever the
               container is found empty (MutationObserver self-heal + tab click + section change),
               so the tab can never flash blank; fresh numbers replace it in place.
             • No more "Loading…" text: the real layout paints at once from known profile data
               and refines when engagement numbers arrive.
             • Rules/eligibility/badge/referral/ad-revenue logic is untouched (same engine).
       ========================================================================= */

    (function injectMonCSS() {
        if (document.getElementById('emp-mon-css')) return;
        var s = document.createElement('style');
        s.id = 'emp-mon-css';
        s.textContent =
            '.mz-wrap{max-width:460px;margin:0 auto;display:flex;flex-direction:column;gap:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0b1528;}' +
            '.mz-title{font-size:1.4rem;font-weight:900;letter-spacing:-.3px;margin:0;display:flex;align-items:center;justify-content:space-between;gap:8px;}' +
            '.mz-tier{font-size:.72rem;font-weight:800;border-radius:20px;padding:4px 10px;background:#e8ecf6;color:#1B2B8B;}' +
            '.mz-hero{background:linear-gradient(135deg,#071330 0%,#0b1e4a 60%,#102a6b 100%);border-radius:20px;padding:22px;color:#fff;box-shadow:0 8px 20px rgba(11,30,74,.25);}' +
            '.mz-hero .k{font-size:.75rem;font-weight:600;color:#a7b3cc;display:block;margin-bottom:4px;}' +
            '.mz-hero .big{font-size:2.2rem;font-weight:900;letter-spacing:-.5px;margin-bottom:18px;}' +
            '.mz-hero .row{display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid rgba(255,255,255,.14);padding-top:12px;}' +
            '.mz-hero .row small{display:block;font-size:.68rem;color:#a7b3cc;}' +
            '.mz-hero .row b{font-size:.98rem;font-weight:800;}' +
            '.mz-card{background:#f8fafc;border:1px solid #edf2f7;border-radius:16px;padding:16px;}' +
            '.mz-card h3{font-size:.92rem;font-weight:900;margin:0;}' +
            '.mz-sub{font-size:.72rem;color:#64748b;display:block;margin:2px 0 0;}' +
            '.mz-req{margin-top:12px;}' +
            '.mz-req .l{display:flex;justify-content:space-between;gap:8px;font-size:.76rem;font-weight:700;color:#334155;margin-bottom:5px;}' +
            '.mz-req .l span:last-child{font-weight:800;color:#0f172a;}' +
            '.mz-req .l span.ok{color:#059669;}.mz-req .l span.pend{color:#1d4ed8;}' +
            '.mz-track{height:6px;background:#e2e8f0;border-radius:10px;overflow:hidden;}' +
            '.mz-track i{display:block;height:100%;background:#1d4ed8;border-radius:10px;transition:width .5s ease;}' +
            '.mz-track i.done{background:#059669;}' +
            '.mz-foot{font-size:.68rem;color:#94a3b8;display:block;margin-top:14px;}' +
            '.mz-tabs{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap;}' +
            '.mz-tab{border:0;background:#f1f5f9;color:#64748b;padding:6px 15px;border-radius:20px;font-size:.74rem;font-weight:800;cursor:pointer;min-height:34px;}' +
            '.mz-tab.on{background:#0c1e4a;color:#fff;}' +
            '.mz-note{font-size:.74rem;color:#94a3b8;font-style:italic;margin:0 0 10px;}' +
            '.mz-ticks{display:flex;gap:6px;}.mz-ticks i{flex:1;height:4px;background:#e2e8f0;border-radius:10px;}' +
            '.mz-src-hero{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px;margin-bottom:10px;}.mz-src-hero span{display:block;font-size:.7rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.4px;}.mz-src-hero b{display:block;font-size:1.5rem;font-weight:900;color:#0b1528;}.mz-src-hero small{font-size:.74rem;color:#64748b;}' +
            '.mz-src-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}.mz-src-grid div{background:#f8fafc;border-radius:12px;padding:10px 12px;}.mz-src-grid span{display:block;font-size:.66rem;font-weight:800;color:#94a3b8;text-transform:uppercase;}.mz-src-grid b{font-size:.92rem;font-weight:900;color:#0b1528;}' +
            '.mz-spark{display:flex;align-items:flex-end;gap:4px;height:48px;}.mz-spark i{flex:1;background:#93c5fd;border-radius:3px 3px 1px 1px;min-height:4px;}' +
            '.mz-src-list{margin-top:10px;}.mz-src-list b{font-size:.76rem;color:#0b1528;}.mz-src-list div{display:flex;justify-content:space-between;gap:8px;font-size:.78rem;padding:6px 0;border-bottom:1px solid #f1f5f9;color:#334155;}.mz-src-list div:last-child{border-bottom:0;}' +
            '.mz-stand{display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:#ecfdf5;color:#059669;padding:6px 12px;border-radius:12px;font-size:.74rem;font-weight:800;border:1px solid #d1fae5;}' +
            '.mz-stand.bad{background:#fef2f2;color:#b42318;border-color:#fecaca;}' +
            '.mz-stand b{width:7px;height:7px;border-radius:50%;background:currentColor;display:inline-block;}' +
            '.mz-pay{border-top:1px solid #f1f5f9;padding-top:16px;}' +
            '.mz-pay .r{display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:10px;}' +
            '.mz-pay .r span:first-child{font-weight:800;color:#334155;}.mz-pay .r span:last-child{color:#94a3b8;}' +
            '.mz-btn{width:100%;border:0;background:#f59e0b;color:#1e293b;font-weight:900;font-size:.8rem;padding:13px;border-radius:12px;cursor:pointer;box-shadow:0 2px 6px rgba(245,158,11,.25);min-height:46px;}' +
            '.mz-btn.alt{background:#0c1e4a;color:#fff;box-shadow:none;margin-top:10px;}' +
            '.mz-list{margin:10px 0 0 18px;padding:0;font-size:.78rem;line-height:1.65;color:#334155;}' +
            '.mz-row{display:flex;justify-content:space-between;font-size:.78rem;font-weight:600;padding:9px 0;border-top:1px solid #e8ecf6;}' +
            '.mz-link{font-size:.8rem;font-weight:800;color:#1B2B8B;}' +
            '.mz-sync{opacity:.78;}';
        document.head.appendChild(s);
    })();

    var _monSeq = 0;
    var _monCache = { uid: null, html: '', at: 0, bal: 0 };
    var _monSource = 'Gifts';
    var _monSrc = { uid: null, at: 0, data: {}, busy: {} };   // per-source earnings cache (2026-11-07)
    var MON_FRESH_MS = 30000;
    var MIN_WITHDRAW_EMPY = 5;   // matches the "Minimum withdrawal is 5 EMPY" rule enforced in the wallet

    function _monBar(label, valueTxt, pct, state) {
        var p = Math.max(0, Math.min(100, Math.round(pct || 0)));
        return '<div class="mz-req"><div class="l"><span>' + _esc(label) + '</span><span class="' + (state || '') + '">' + _esc(valueTxt) + '</span></div>'
            + '<div class="mz-track"><i class="' + (p >= 100 ? 'done' : '') + '" style="width:' + p + '%"></i></div></div>';
    }

    var _monSourceNotes = {
        Gifts: 'Gift earnings appear here once monetization is unlocked.',
        Live:  'Live broadcast earnings appear here once monetization is unlocked.',
        Ads:   'Your ad revenue share is shown at the bottom of this page once figures are computed.',
        Subs:  'Fans can subscribe to you for a monthly EMPY fee. Set your price below.'
    };

    function _monBuildHtml(us, verdict, referrals, syncing) {
        var tier = verdict.tier;
        var nextTier = CREATOR_TIERS.find(function (t) { return !tier || t.order > tier.order; });
        var eng = verdict.engagement || {};
        var bal = us.empyBalance || 0;
        var usd = bal * _rate();
        var kyc = !!verdict.kycVerified;
        var fol = verdict.followerCount || 0;
        var fTarget = tier ? (nextTier ? nextTier.minFollowers : tier.minFollowers) : CREATOR_TIERS[0].minFollowers;
        var avgV = Math.round(eng.avgViews || 0), avgI = Math.round(eng.avgInteractions || 0);
        var retPct = Math.round((eng.retentionRate || 0) * 100), retTarget = Math.round(ENGAGEMENT_BAR.retentionRate * 100);
        var met = (kyc ? 1 : 0) + (tier ? 1 : 0)
            + (avgV >= ENGAGEMENT_BAR.avgViewsPerPost ? 1 : 0)
            + (avgI >= ENGAGEMENT_BAR.avgInteractionsPerPost ? 1 : 0)
            + (retPct >= retTarget ? 1 : 0);

        var h = '<div class="mz-wrap' + (syncing ? ' mz-sync' : '') + '" data-mz-uid="' + _esc(us.id) + '">';
        h += '<h2 class="mz-title"><span>Monetization</span>' + (tier ? '<span class="mz-tier"><i class="fas fa-award"></i> ' + _esc(tier.name) + (verdict.badgeOk ? ' \u2713' : '') + '</span>' : '') + '</h2>';

        h += '<div class="mz-hero"><span class="k">Estimated earnings this month</span>'
            + '<div class="big">' + _fmtUsd(usd) + '</div>'
            + '<div class="row"><div><small>Available balance</small><b>' + _fmtUsd(verdict.eligible ? usd : 0) + '</b></div>'
            + '<div style="text-align:right;"><small>Payout minimum</small><b>' + MIN_WITHDRAW_EMPY + ' EMPY</b></div></div></div>';

        h += '<div class="mz-card"><h3>Ads Manager</h3><span class="mz-sub">Run a paid campaign to reach more people, like Facebook Ads. Pick your audience, budget and dates \u2014 unspent budget is refunded.</span>'
            + '<button type="button" class="mz-btn" data-mz-ads-open="1"><i class="fas fa-bullhorn"></i> Open Ads Manager</button></div>';

        h += '<div class="mz-card"><h3>Eligibility</h3><span class="mz-sub">' + met + ' of 5 requirements met</span>'
            + _monBar('KYC verification', kyc ? 'Verified' : 'Pending', kyc ? 100 : 0, kyc ? 'ok' : 'pend')
            + _monBar('Followers', fol.toLocaleString() + ' / ' + fTarget.toLocaleString(), fol / fTarget * 100)
            + _monBar('Avg views per post', avgV.toLocaleString() + ' / ' + ENGAGEMENT_BAR.avgViewsPerPost, avgV / ENGAGEMENT_BAR.avgViewsPerPost * 100)
            + _monBar('Avg interactions per post', avgI.toLocaleString() + ' / ' + ENGAGEMENT_BAR.avgInteractionsPerPost, avgI / ENGAGEMENT_BAR.avgInteractionsPerPost * 100)
            + _monBar('Retention', retPct + '% / ' + retTarget + '%', retPct / retTarget * 100)
            + '<span class="mz-foot">Reviewed daily; unlocks at ' + _esc(CREATOR_TIERS[0].name) + ' tier.</span></div>';

        if (verdict.reasons && verdict.reasons.length) {
            h += '<div class="mz-card"><h3>To unlock or keep monetization</h3><ul class="mz-list">'
                + verdict.reasons.map(function (r) { return '<li>' + _esc(r) + '</li>'; }).join('') + '</ul></div>';
        }

        h += '<div><h3 style="font-size:.92rem;font-weight:900;margin:0;">Earnings by source</h3><div class="mz-tabs">'
            + ['Gifts', 'Live', 'Ads', 'Subs'].map(function (t) {
                return '<button type="button" class="mz-tab' + (t === _monSource ? ' on' : '') + '" data-mz-source="' + t + '">' + t + '</button>';
            }).join('') + '</div>'
            + '<div id="mz-source-body">' + _monSourceHtml(us) + '</div></div>';

        var strikes = us.strikes || us.communityStrikes || 0;
        h += '<div><h3 style="font-size:.92rem;font-weight:900;margin:0;">Account standing</h3><span class="mz-sub">Content and community guidelines</span>'
            + (strikes ? '<div class="mz-stand bad"><b></b>' + strikes + ' active strike(s)</div>' : '<div class="mz-stand"><b></b>Good standing, no strikes</div>') + '</div>';

        if (tier && !verdict.badgeOk) {
            h += '<div class="mz-card"><h3>' + _esc(tier.name) + ' Verified Badge \u2014 ' + _fmtUsd(tier.badgeFeeUsd) + '</h3>'
                + '<span class="mz-sub">' + (tier.badgeRequired ? 'Required to withdraw at this tier. ' : 'Optional, unlocks perks. ') + 'Perks: ' + _esc(tier.perks.join(', ')) + '</span>'
                + '<button type="button" class="mz-btn alt" onclick="window.openCreatorBadgeModal(\'' + tier.key + '\')"><i class="fas fa-shield-alt"></i> Get ' + _esc(tier.name) + ' badge</button></div>';
        }

        h += '<div class="mz-pay"><div class="r"><span>Payouts</span><span>' + (verdict.eligible ? 'Managed in your Wallet' : 'Not set up') + '</span></div>'
            + '<button type="button" class="mz-btn nav-link" data-target="my-wallet">' + (verdict.eligible ? 'Go to Wallet to withdraw' : 'Set up payout method') + '</button></div>';

        h += '<div class="mz-card"><h3>Referrals <span style="font-weight:500;color:#64748b;">(optional)</span></h3>'
            + '<div class="mz-row" style="border-top:0;"><span>Verified / total</span><span>' + referrals.verified + ' / ' + referrals.total + '</span></div>'
            + '<a href="#" class="mz-link" data-mz-copy-ref="1">Copy your referral link</a></div>';

        h += '</div>';
        return h;
    }

    function _monSnapshot(container) {
        var us = _us();
        if (!container || !us || !us.id) return;
        var w = container.querySelector('.mz-wrap');
        if (!w) return;
        _monCache = { uid: us.id, html: container.innerHTML, at: _monCache.at || Date.now(), bal: us.empyBalance || 0 };
    }

    function renderMonetizationTab(opts) {
        var container = document.getElementById('profile-monetization');
        if (!container) return;
        var us = _us();
        if (!us || !us.id) return;                       // never blank the tab just because state isn't ready yet
        var force = !!(opts && opts.force === true);
        var haveCache = _monCache.uid === us.id && !!_monCache.html;

        // 1) Instant, synchronous paint — cached HTML if we have it, otherwise the real layout from what we already know.
        if (!container.querySelector('.mz-wrap')) {
            if (haveCache) container.innerHTML = _monCache.html;
            else {
                var tier0 = determineTier(us.followerCount || 0);
                container.innerHTML = _monBuildHtml(us, {
                    tier: tier0, eligible: false, badgeOk: true, kycVerified: !!us.isVerified,
                    followerCount: us.followerCount || 0, engagement: {}, reasons: []
                }, { verified: 0, total: 0 }, true);
            }
        }

        // 2) Skip the network refresh while the data is still fresh.
        if (haveCache && !force && _monCache.bal === (us.empyBalance || 0) && (Date.now() - _monCache.at) < MON_FRESH_MS) return;

        var seq = ++_monSeq;
        loadCreatorBadge(us.id, function (badge) {
            if (seq !== _monSeq) return;
            _badgeCache[us.id] = badge;
            computeEligibility(us.id, function (verdict) {
                if (seq !== _monSeq) return;
                getReferralStats(us.id, function (referrals) {
                    if (seq !== _monSeq) return;
                    var c = document.getElementById('profile-monetization');   // RE-RESOLVE: the profile may have been rebuilt meanwhile
                    var html;
                    try { html = _monBuildHtml(_us(), verdict, referrals || { verified: 0, total: 0 }, false); }
                    catch (err) { warn('dashboard render failed: ' + (err && err.message)); return; }   // keep whatever is on screen
                    _monCache = { uid: us.id, html: html, at: Date.now(), bal: us.empyBalance || 0 };
                    if (!c) return;                                              // not on screen now; the cache repaints it later
                    c.innerHTML = html;
                    _renderAdRevenueCard(c, _us());                              // same render, so nothing can wipe it afterwards
                    _monLoadSource(_monSource, false);
                    _watchAdCard(c);
                });
            });
        });
    }
    window.renderMonetizationTab = function () { renderMonetizationTab({ force: false }); };
    window.refreshMonetizationTab = function () { renderMonetizationTab({ force: true }); };

    // Keep the cached snapshot in step with the ad-revenue card that fills in asynchronously.
    function _watchAdCard(c) {
        if (typeof MutationObserver === 'undefined') { setTimeout(function () { _monSnapshotKeep(c); }, 2500); return; }
        var t = null, mo = new MutationObserver(function () {
            clearTimeout(t); t = setTimeout(function () { _monSnapshotKeep(c); }, 250);
        });
        mo.observe(c, { childList: true, subtree: true, characterData: true });
        setTimeout(function () { mo.disconnect(); _monSnapshotKeep(c); }, 15000);
    }
    function _monSnapshotKeep(c) {
        var us = _us();
        if (c && c.isConnected && us && us.id && c.querySelector('.mz-wrap')) _monCache = { uid: us.id, html: c.innerHTML, at: _monCache.at, bal: us.empyBalance || 0 };
    }

    // Delegated handlers (survive any DOM rebuild — nothing is bound to elements that can be thrown away).
    document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        var src = t.closest('[data-mz-source]');
        if (src) {
            _monSource = src.getAttribute('data-mz-source');
            var box = document.getElementById('profile-monetization');
            if (box) {
                box.querySelectorAll('.mz-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mz-source') === _monSource); });
                _monPaintSource(); _monLoadSource(_monSource, false);
                _monSnapshotKeep(box);
            }
            return;
        }
        if (t.closest('[data-mz-sub-save]')) { _subSavePlan(t.closest('[data-mz-sub-save]')); return; }
        if (t.closest('[data-mz-ads-open]')) { e.preventDefault(); window.openAdsManager(); return; }
        if (t.closest('[data-mz-src-retry]')) { e.preventDefault(); _monLoadSource(_monSource, true); return; }
        if (t.closest('[data-mz-copy-ref]')) {
            e.preventDefault();
            var link = generateReferralLink();
            if (link && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(function () { _notify('Referral link copied!', 'success'); }).catch(function () {});
            }
            return;
        }
        if (t.closest('.profile-tab[data-target="profile-monetization"]')) {
            setTimeout(function () { renderMonetizationTab(); }, 0);
            setTimeout(function () { renderMonetizationTab(); }, 250);
        }
    });

    // Self-heal: if anything ever empties the tab while it exists, repaint it on the next frame.
    (function armMonetizationSelfHeal() {
        if (typeof MutationObserver === 'undefined') return;
        var queued = false;
        function check() {
            queued = false;
            var c = document.getElementById('profile-monetization');
            if (c && !c.querySelector('.mz-wrap')) renderMonetizationTab();
        }
        function start() {
            new MutationObserver(function () {
                if (queued) return;
                queued = true;
                (window.requestAnimationFrame || setTimeout)(check);
            }).observe(document.body, { childList: true, subtree: true });
        }
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    })();


    /* =========================================================================
       §11 Admin monetization panel — reads creator_badges + flagged
           withdrawal_queue entries across all users, for admin review.
           Renders into #admin-monetization-container if present in the DOM
           (container added alongside the KYC admin card in index.html,
           same pattern as #admin-kyc-docs-container).
       ========================================================================= */

    function renderAdminMonetizationPanel() {
        if (!_isAdmin()) return;
        var container = document.getElementById('admin-monetization-container');
        if (!container || !_fbOk()) return;

        container.innerHTML = '<p style="text-align:center;padding:20px;color:#888;"><i class="fas fa-spinner fa-spin"></i> Loading…</p>';

        window.fbDb.collection('withdrawal_queue').where('flaggedForReview', '==', true).where('status', '==', 'pending').get()
            .then(function (snap) {
                var flagged = [];
                (snap.docs || []).forEach(function (d) { flagged.push(Object.assign({ id: d.id }, d.data())); });

                if (!flagged.length) {
                    container.innerHTML = '<p style="text-align:center;padding:20px;color:#888;">No flagged withdrawal requests.</p>';
                    return;
                }

                container.innerHTML = flagged.map(function (r) {
                    return '<div class="kyc-doc-card">'
                        + '<div><strong>' + _esc(r.userId) + '</strong>'
                        + '<p style="color:#666;font-size:0.83rem;margin:2px 0;">' + (r.amountEmpy || 0) + ' EMPY via ' + _esc(r.method || '—')
                        + ' &bull; ' + _esc(r.flagReason || '') + ' &bull; ' + _esc(r.requestedAt || '') + '</p></div>'
                        + '<div style="display:flex;gap:6px;">'
                        + '<button class="btn btn-success btn-small" onclick="window.approveFlaggedWithdrawal(\'' + r.id + '\')"><i class="fas fa-check"></i> Approve</button>'
                        + '<button class="btn btn-danger btn-small" onclick="window.rejectFlaggedWithdrawal(\'' + r.id + '\')"><i class="fas fa-times"></i> Reject</button>'
                        + '</div></div>';
                }).join('');
            })
            .catch(function (err) {
                container.innerHTML = '<p style="text-align:center;padding:20px;color:#888;">Could not load flagged requests.</p>';
                warn('admin panel load failed: ' + (err && err.message));
            });
    }
    window.renderAdminMonetizationPanel = renderAdminMonetizationPanel;

    window.approveFlaggedWithdrawal = function (reqId) {
        if (!_isAdmin() || !_fbOk()) return;
        window.fbDb.collection('withdrawal_queue').doc(reqId).update({ status: 'approved', reviewedAt: new Date().toISOString() })
            .then(function () { _audit('WITHDRAWAL_APPROVED', reqId, 'Flagged request approved by admin'); renderAdminMonetizationPanel(); })
            .catch(function () {});
    };
    window.rejectFlaggedWithdrawal = function (reqId) {
        if (!_isAdmin() || !_fbOk()) return;
        window.fbDb.collection('withdrawal_queue').doc(reqId).update({ status: 'rejected', reviewedAt: new Date().toISOString() })
            .then(function () { _audit('WITHDRAWAL_REJECTED', reqId, 'Flagged request rejected by admin'); renderAdminMonetizationPanel(); })
            .catch(function () {});
    };


    /* =========================================================================
       §12 KYC → isVerified wiring fix
           approveKyc() (app-kyc.js) updates the kyc_submissions doc status
           but never flips user.isVerified — the only thing that does today
           is the separate manual "Mark Verified" admin toggle in app-live.js.
           Wrapped, not edited: original still runs first, this only adds
           the missing side-effect once KYC is actually approved, so the
           eligibility engine above (§5) sees a consistent isVerified flag.
       ========================================================================= */

    var _origApproveKyc = window.approveKyc;
    if (typeof _origApproveKyc === 'function') {
        window.approveKyc = function (id) {
            _origApproveKyc(id);
            try {
                var entry = (window._kycQueue || []).find(function (k) { return k.id === id; });
                if (!entry || !entry.userId) return;
                var user = _userById(entry.userId);
                if (user) user.isVerified = true;
                if (_fbOk()) {
                    window.fbDb.collection('users').doc(entry.userId).update({ isVerified: true }).catch(function () {});
                }
                if (typeof window.renderMonetizationTab === 'function') window.renderMonetizationTab();
            } catch (e) { warn('post-KYC-approval sync failed: ' + e.message); }
        };
    }


    /* =========================================================================
       §14 AD REVENUE SHARE — "Content Creator Monetization Model" proposal
       ═══════════════════════════════════════════════════════════════════════
       REWRITE (2026-08, follow-up review): the first pass of this section
       computed everything client-side against a made-up perViewUsd
       constant, had no bridge to a real withdrawable balance, and relied
       only on a Firestore "admin can write" rule to keep the ledger
       honest. All three are fixed by moving computation and every write
       server-side (server.js's new /api/admin/ad-revenue/* and
       /api/ad-revenue/request-payout routes, Admin SDK) — this file is now
       READ-ONLY against ad_revenue_shares/ad_revenue_quarterly_reports/
       ad_revenue_program_meta (firebase-rules.js's write rules for all
       three are `if false` — not even an admin's own browser session can
       write them anymore, only the server's service account can) plus a
       thin fetch() layer that calls those routes for admin actions and
       for a creator's own payout request. See server.js's own header
       comment on that block for the full before/after.

       Still true from the original design, unchanged:
         • Kept fully independent of CREATOR_TIERS/badge/withdrawal above
           and of app-impactmining.js — separate collections, separate
           config, nothing shared.
         • Engagement-based: the server aggregates the same `posts` fields
           (views/likes/commentCount/shareCount) app-feed.js already
           writes and this file's own §3 computeEngagement() already
           reads client-side for the (separate) creator-tier eligibility
           bar — server.js's compute-payouts route reimplements that same
           bar independently rather than trusting anything the client
           reports about its own performance.
         • 30% baseline / 50% ceiling, performance bonus pool, market-
           adjustment countdown, regional adaptation — all now computed
           and enforced server-side; this file only displays the result.
       ═══════════════════════════════════════════════════════════════════════ */

    // Display-only mirror of server.js's AD_REVENUE_BASELINE_PCT/MAX_PCT —
    // used here purely for labels and to sanity-clamp what an admin types
    // into the override field before it's even sent. The server clamps
    // again independently; this is just so the admin doesn't have to wait
    // on a round trip to see an out-of-range value rejected.
    var AD_REVENUE_DISPLAY = {
        baselinePct: 0.30,
        maxPct: 0.50,
        marketAdjustmentIntervalMonths: 24,
        systemNote: 'Independent of app-impactmining.js — that system rewards '
            + 'humanitarian/impact actions with its own token economy; this one '
            + 'pays a share of REAL, admin-entered ad revenue, computed and '
            + 'written server-side. A creator can participate in both; neither '
            + 'figure feeds into the other.'
    };
    window.AD_REVENUE_SHARE_CONFIG = AD_REVENUE_DISPLAY;

    function _clampSharePctDisplay(pct) {
        return Math.max(AD_REVENUE_DISPLAY.baselinePct, Math.min(AD_REVENUE_DISPLAY.maxPct, pct || AD_REVENUE_DISPLAY.baselinePct));
    }

    // Same bearer-ID-token fetch pattern app-bulk-disburse.js already
    // established for admin-only server routes in this codebase.
    function _adRevGetIdToken() {
        if (!window.fbAuth || !window.fbAuth.currentUser) return Promise.reject(new Error('Not signed in.'));
        return window.fbAuth.currentUser.getIdToken();
    }
    function _adRevApiBase() {
        return (typeof window._empApiBase === 'function' ? window._empApiBase() : '') + '/api';
    }
    function _adRevAuthedFetch(path, body) {
        return _adRevGetIdToken().then(function (token) {
            return fetch(_adRevApiBase() + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify(body || {})
            }).then(function (r) {
                return r.json().then(function (data) {
                    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                    return data;
                });
            });
        });
    }

    var _revShareCache = {}; // userId -> ad_revenue_shares doc (read-only client cache)

    function loadAdRevenueShare(userId, cb) {
        if (!userId || !_fbOk()) { cb(_revShareCache[userId] || null); return; }
        try {
            _tmo(window.fbDb.collection('ad_revenue_shares').doc(userId).get()).then(function (doc) {
                var data = doc && doc.exists && typeof doc.data === 'function' ? doc.data() : null;
                _revShareCache[userId] = data;
                cb(data);
            }).catch(function () { cb(_revShareCache[userId] || null); });
        } catch (e) { cb(_revShareCache[userId] || null); }
    }
    window.loadAdRevenueShare = loadAdRevenueShare;

    function loadReviewSchedule(cb) {
        if (!_fbOk()) { cb(null); return; }
        try {
            _tmo(window.fbDb.collection('ad_revenue_program_meta').doc('schedule').get()).then(function (doc) {
                cb(doc && doc.exists && typeof doc.data === 'function' ? doc.data() : null);
            }).catch(function () { cb(null); });
        } catch (e) { cb(null); }
    }
    function _nextReviewDate(lastReviewedAt) {
        var base = lastReviewedAt ? new Date(lastReviewedAt) : new Date();
        var next = new Date(base);
        next.setMonth(next.getMonth() + AD_REVENUE_DISPLAY.marketAdjustmentIntervalMonths);
        return next;
    }

    /**
     * Creator requests a payout of their AVAILABLE (unpaid) ad-revenue
     * balance. The server re-reads the ledger inside a transaction and
     * reserves the amount atomically (server.js's /api/ad-revenue/
     * request-payout) — this call cannot itself credit or invent a
     * balance, it only asks the server to move whatever it already
     * computed into the existing withdrawal_queue for admin review, same
     * as every other withdrawal in this app.
     */
    window.requestAdRevenuePayout = function () {
        var us = _us();
        if (_isGuest() || !us || !us.id) { _notify('Please sign in first.', 'error'); return; }
        _notify('Requesting payout…', 'info');
        _adRevAuthedFetch('/ad-revenue/request-payout')
            .then(function (data) {
                _notify('Payout of ' + _fmtUsd(data.amountUsd) + ' (~' + data.amountEmpy.toFixed(2) + ' EMPY) requested — pending admin review, same queue as your wallet withdrawals.', 'success');
                renderMonetizationTab({ force: true });
            })
            .catch(function (err) { _notify('Could not request payout: ' + (err.message || 'unknown error'), 'error'); });
    };

    /**
     * Creator-facing card — appended inside §10's _renderDashboard(),
     * visually separate from the Creator Tier/badge block above it.
     * Purely a READ of what server.js's compute-payouts route already
     * wrote; this file computes nothing.
     */
    function _renderAdRevenueCard(container, us) {
        var el = document.createElement('div');
        el.className = 'card-content';
        el.style.cssText = 'border:1px solid var(--accent-color,#C9A66B);border-radius:10px;padding:14px;margin-top:18px;';
        el.innerHTML = '<p style="text-align:center;color:#888;"><i class="fas fa-spinner fa-spin"></i> Loading ad revenue share…</p>';
        container.appendChild(el);

        loadAdRevenueShare(us.id, function (ledger) {
            loadReviewSchedule(function (meta) {
                var nextReview = _nextReviewDate(meta && meta.lastReviewedAt);

                if (!ledger) {
                    el.innerHTML =
                        '<h4 style="margin:0 0 8px;"><i class="fas fa-chart-pie"></i> Ad Revenue Share <span style="font-weight:400;font-size:0.75rem;color:#888;">(separate from your Wallet balance above)</span></h4>'
                        + '<p style="font-size:0.85rem;color:#666;">No figures yet for this period — the platform\u2019s ad revenue pool is set and split by an admin each period. Keep posting; you\u2019ll show up here once you meet the engagement bar and a period has been computed.</p>'
                        + '<p style="font-size:0.75rem;color:#888;margin:8px 0 0;">Guaranteed minimum ' + Math.round(AD_REVENUE_DISPLAY.baselinePct * 100)
                        + '%, up to ' + Math.round(AD_REVENUE_DISPLAY.maxPct * 100) + '% with the performance bonus pool once figures are computed. '
                        + 'Next market-adjustment review: ' + nextReview.toLocaleDateString() + '.</p>';
                    return;
                }

                if (ledger.suspiciousFlag) {
                    el.innerHTML =
                        '<h4 style="margin:0 0 8px;"><i class="fas fa-chart-pie"></i> Ad Revenue Share</h4>'
                        + '<div class="form-feedback error" style="display:block;"><p><i class="fas fa-flag"></i> This period\u2019s payout is on hold for review — '
                        + _esc(ledger.suspiciousReason || 'unusual engagement pattern detected') + '. Contact support if you believe this is a mistake.</p></div>';
                    return;
                }

                var totalEarned = Number(ledger.totalEarnedUsd) || 0;
                var paidOut = Number(ledger.paidOutUsd) || 0;
                var available = Math.max(0, totalEarned - paidOut);

                el.innerHTML =
                    '<h4 style="margin:0 0 8px;"><i class="fas fa-chart-pie"></i> Ad Revenue Share <span style="font-weight:400;font-size:0.75rem;color:#888;">(separate from your Wallet balance above)</span></h4>'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
                    + '<span>Your current share</span><strong>' + Math.round((ledger.sharePct || AD_REVENUE_DISPLAY.baselinePct) * 100) + '%'
                    + (ledger.bonusUnlocked ? ' <span style="color:#22c55e;font-size:0.78rem;">(bonus pool active)</span>' : '') + '</strong></div>'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
                    + '<span>Last period (' + _esc(ledger.lastPeriodKey || '—') + ')</span><strong>' + _fmtUsd(ledger.lastPeriodCreatorShareUsd || 0) + '</strong></div>'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
                    + '<span>Total earned to date</span><strong>' + _fmtUsd(totalEarned) + '</strong></div>'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
                    + '<span>Already paid out</span><strong>' + _fmtUsd(paidOut) + '</strong></div>'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
                    + '<span><strong>Available now</strong></span><strong style="color:var(--accent-color,#C9A66B);">' + _fmtUsd(available) + '</strong></div>'
                    + (available > 0.01
                        ? '<button class="btn btn-accent btn-small" onclick="window.requestAdRevenuePayout()"><i class="fas fa-paper-plane"></i> Request Payout</button>'
                        : '<p style="font-size:0.78rem;color:#888;">Nothing available to request yet.</p>')
                    + '<p style="font-size:0.75rem;color:#888;margin:10px 0 0;">Guaranteed minimum ' + Math.round(AD_REVENUE_DISPLAY.baselinePct * 100)
                    + '%, up to ' + Math.round(AD_REVENUE_DISPLAY.maxPct * 100) + '% with the performance bonus pool. '
                    + 'Next market-adjustment review: ' + nextReview.toLocaleDateString() + '.</p>'
                    + '<button class="btn btn-small" style="margin-top:8px;" onclick="window.viewLatestAdRevenueReport()"><i class="fas fa-file-invoice-dollar"></i> View latest quarterly report</button>';
            });
        });
    }

    window.viewLatestAdRevenueReport = function () {
        if (!_fbOk()) { _notify('Reports need a live connection — try again shortly.', 'info'); return; }
        window.fbDb.collection('ad_revenue_quarterly_reports').orderBy('publishedAt', 'desc').limit(1).get()
            .then(function (snap) {
                var doc = (snap.docs || [])[0];
                if (!doc) { _notify('No quarterly report has been published yet.', 'info'); return; }
                var r = doc.data() || {};
                var mine = (r.creators || []).find(function (c) { return c.userId === (_us() && _us().id); });
                var msg = 'Report ' + r.quarter + ': ' + r.creatorCount + ' creators, '
                    + _fmtUsd(r.platformCreatorShareUsd) + ' distributed platform-wide'
                    + (mine ? ('. Your share: ' + Math.round(mine.sharePct * 100) + '% — ' + _fmtUsd(mine.lastPeriodCreatorShareUsd) + ' this period.') : '.');
                _notify(msg, 'info');
            }).catch(function () { _notify('Could not load the latest report.', 'error'); });
    };

    /* =========================================================================
       Admin controls — every action below hits server.js's Admin-SDK
       routes; nothing here writes to Firestore directly (firebase-rules.js
       now denies client writes to all three ad-revenue collections
       outright, admin session or not — see that file's own comment).
       ========================================================================= */

    window.setAdRevenuePool = function () {
        if (!_isAdmin()) return;
        var amountEl = document.getElementById('rev-pool-amount');
        var sourceEl = document.getElementById('rev-pool-source');
        var amount = amountEl ? parseFloat(amountEl.value) : NaN;
        if (!(amount > 0)) { _notify('Enter the real ad revenue figure for this period (a positive number).', 'error'); return; }
        _adRevAuthedFetch('/admin/ad-revenue/set-pool', { totalAdRevenueUsd: amount, source: sourceEl ? sourceEl.value : '' })
            .then(function (data) {
                _audit('AD_REVENUE_POOL_SET', data.periodKey, _fmtUsd(amount));
                _notify('Ad revenue pool for ' + data.periodKey + ' set to ' + _fmtUsd(amount) + '.', 'success');
                renderAdRevenueAdminPanel();
            })
            .catch(function (err) { _notify('Could not set pool: ' + (err.message || 'unknown error'), 'error'); });
    };

    window.computeAdRevenuePayouts = function () {
        if (!_isAdmin()) return;
        _notify('Computing this period\u2019s payouts — this can take a moment on a large post collection…', 'info');
        _adRevAuthedFetch('/admin/ad-revenue/compute-payouts')
            .then(function (data) {
                _audit('AD_REVENUE_PAYOUTS_COMPUTED', data.periodKey, data.creatorsPaid + ' paid, ' + data.creatorsFlagged + ' flagged');
                _notify('Computed ' + data.periodKey + ': ' + data.creatorsPaid + ' creators paid, ' + data.creatorsFlagged + ' flagged for review.', 'success');
                renderAdRevenueAdminPanel();
            })
            .catch(function (err) { _notify('Compute failed: ' + (err.message || 'unknown error'), 'error'); });
    };

    window.publishQuarterlyRevenueReport = function () {
        if (!_isAdmin()) return;
        _adRevAuthedFetch('/admin/ad-revenue/publish-report')
            .then(function (data) {
                _audit('AD_REVENUE_QUARTERLY_REPORT_PUBLISHED', data.periodKey, data.creatorCount + ' creators, ' + _fmtUsd(data.platformCreatorShareUsd) + ' distributed');
                _notify('Quarterly report ' + data.periodKey + ' published (' + data.creatorCount + ' creators).', 'success');
                renderAdRevenueAdminPanel();
            })
            .catch(function (err) { _notify('Could not publish report: ' + (err.message || 'unknown error'), 'error'); });
    };

    window.markRevenueShareReviewed = function () {
        if (!_isAdmin()) return;
        _adRevAuthedFetch('/admin/ad-revenue/mark-reviewed')
            .then(function () {
                _audit('AD_REVENUE_MARKET_REVIEW', 'program', 'Market-adjustment review recorded');
                _notify('Market-adjustment review recorded — next review in ' + AD_REVENUE_DISPLAY.marketAdjustmentIntervalMonths + ' months.', 'success');
                renderAdRevenueAdminPanel();
            }).catch(function (err) { _notify('Could not record review: ' + (err.message || 'unknown error'), 'error'); });
    };

    window.setCreatorRevenueSharePct = function (userId, pct) {
        if (!_isAdmin() || !userId) return;
        var clamped = _clampSharePctDisplay(parseFloat(pct));
        _adRevAuthedFetch('/admin/ad-revenue/set-share-pct', { userId: userId, pct: clamped })
            .then(function () {
                _audit('AD_REVENUE_SHARE_ADJUSTED', userId, 'Share set to ' + Math.round(clamped * 100) + '%');
                _notify('Revenue share for ' + userId + ' set to ' + Math.round(clamped * 100) + '%.', 'success');
                renderAdRevenueAdminPanel();
            })
            .catch(function (err) { _notify('Could not set share: ' + (err.message || 'unknown error'), 'error'); });
    };

    /**
     * Admin panel — pool entry, compute/publish/review actions, and a
     * creator roster with per-creator override. Mounted into
     * #admin-ad-revenue-container (index.html). All figures displayed are
     * a straight read of ad_revenue_shares — nothing computed here.
     */
    function renderAdRevenueAdminPanel() {
        if (!_isAdmin()) return;
        var container = document.getElementById('admin-ad-revenue-container');
        if (!container || !_fbOk()) return;

        container.innerHTML = '<p style="text-align:center;padding:20px;color:#888;"><i class="fas fa-spinner fa-spin"></i> Loading…</p>';

        loadReviewSchedule(function (meta) {
            var nextReview = _nextReviewDate(meta && meta.lastReviewedAt);
            var reviewBadge = document.getElementById('rev-share-next-review-badge');
            if (reviewBadge) reviewBadge.textContent = 'Next review: ' + nextReview.toLocaleDateString();

            var toolbarHtml = '<div style="padding:10px 14px;border-bottom:1px solid #eee;">'
                + '<div style="font-size:0.82rem;color:#666;margin-bottom:8px;">Baseline ' + Math.round(AD_REVENUE_DISPLAY.baselinePct * 100) + '% &bull; Max '
                + Math.round(AD_REVENUE_DISPLAY.maxPct * 100) + '% &bull; Next market review ' + nextReview.toLocaleDateString() + '</div>'
                + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">'
                + '<input type="number" min="0" step="0.01" placeholder="Real ad revenue this period ($)" id="rev-pool-amount" style="width:220px;">'
                + '<input type="text" placeholder="Source (e.g. AdSense payout ref)" id="rev-pool-source" style="width:220px;">'
                + '<button class="btn btn-small" onclick="window.setAdRevenuePool()"><i class="fas fa-coins"></i> Set Pool</button>'
                + '</div>'
                + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
                + '<button class="btn btn-small" onclick="window.computeAdRevenuePayouts()"><i class="fas fa-calculator"></i> Compute This Period\u2019s Payouts</button>'
                + '<button class="btn btn-small" onclick="window.markRevenueShareReviewed()"><i class="fas fa-calendar-check"></i> Mark Reviewed</button>'
                + '<button class="btn btn-accent btn-small" onclick="window.publishQuarterlyRevenueReport()"><i class="fas fa-file-export"></i> Publish Quarterly Report</button>'
                + '</div></div>';

            window.fbDb.collection('ad_revenue_shares').get().then(function (snap) {
                var rows = [];
                (snap.docs || []).forEach(function (d) { rows.push(Object.assign({ id: d.id }, d.data())); });

                if (!rows.length) {
                    container.innerHTML = toolbarHtml + '<p style="text-align:center;padding:20px;color:#888;">No creator ad-revenue ledger entries yet — set this period\u2019s pool figure, then click Compute.</p>';
                    return;
                }

                container.innerHTML = toolbarHtml + rows.map(function (r) {
                    var pct = Math.round((r.sharePct || AD_REVENUE_DISPLAY.baselinePct) * 100);
                    return '<div class="kyc-doc-card">'
                        + '<div><strong>' + _esc(r.id) + '</strong>'
                        + (r.suspiciousFlag ? ' <span style="color:#ef4444;font-size:0.75rem;"><i class="fas fa-flag"></i> flagged</span>' : '')
                        + '<p style="color:#666;font-size:0.83rem;margin:2px 0;">' + pct + '% share'
                        + (r.bonusUnlocked ? ' (bonus pool)' : '') + ' &bull; ' + _fmtUsd(r.totalEarnedUsd || 0) + ' earned, '
                        + _fmtUsd(r.paidOutUsd || 0) + ' paid out'
                        + ' &bull; last period ' + _esc(r.lastPeriodKey || '—') + '</p></div>'
                        + '<div style="display:flex;gap:6px;align-items:center;">'
                        + '<input type="number" min="' + Math.round(AD_REVENUE_DISPLAY.baselinePct * 100) + '" max="' + Math.round(AD_REVENUE_DISPLAY.maxPct * 100)
                        + '" value="' + pct + '" style="width:64px;" id="rev-pct-' + _esc(r.id) + '">%'
                        + '<button class="btn btn-small" onclick="window.setCreatorRevenueSharePct(\'' + _esc(r.id) + '\', document.getElementById(\'rev-pct-' + _esc(r.id) + '\').value/100)"><i class="fas fa-save"></i> Set</button>'
                        + '</div></div>';
                }).join('');
            }).catch(function (err) {
                container.innerHTML = toolbarHtml + '<p style="text-align:center;padding:20px;color:#888;">Could not load creator ad-revenue ledger.</p>';
                warn('ad revenue admin panel load failed: ' + (err && err.message));
            });
        });
    }
    window.renderAdRevenueAdminPanel = renderAdRevenueAdminPanel;

    // (2026-11-06) The Ad Revenue Share card is now appended by _renderDashboard() itself. The old wrapper
    // here added it from a 50 ms timer while the monetization chain was still loading, then the chain's
    // final render wiped it, and a stalled read left both spinners up forever.


    /* =========================================================================
       §13 Init / event wiring
       ========================================================================= */

    _captureReferralParam();

    // Poll briefly for sign-up completion so a referral captured pre-login
    // still gets recorded once userState.id exists (mirrors app-startup.js's
    // own short-retry pattern for Firebase init).
    var _refPoll = 0;
    var _refTimer = setInterval(function () {
        _refPoll++;
        _tryRecordPendingReferral();
        if (!window._pendingReferralCode || _refPoll >= 40) clearInterval(_refTimer); // ~20s at 500ms
    }, 500);

    // Refresh the admin panel whenever the admin section becomes visible,
    // same event this app already dispatches for other section-scoped renders.
    window.addEventListener('empyrean-section-change', function (e) {
        try {
            if (e && e.detail && e.detail.section === 'admin' && _isAdmin()) {
                renderAdminMonetizationPanel();
                renderAdRevenueAdminPanel();
            }
        } catch (err) {}
    });


    /* =============================================================================
       2026-11-07 — EARNINGS BY SOURCE (Gifts / Live / Ads / Subs) + ADS MANAGER
       ---------------------------------------------------------------------------
       Earnings tabs: the four tabs used to show a placeholder sentence. They now read the creator's REAL
       records — `gifts` (recipientId == me), `live_gifts` (hostId / recipientId == me; the whole gift
       amount is credited to the host, there is no platform cut), and the `ad_revenue_shares/{me}` ledger.
       Subscriptions: Empyrean has no paid-subscription product yet, so that tab says so plainly
       instead of promising numbers that can never arrive.
       Ads Manager (Facebook-Ads-Manager style): build a campaign (objective, audience, budget & schedule,
       creative + call-to-action), see a live preview and an estimate, pay from the EMPY wallet, track
       delivery. Creating / pausing / cancelling goes through server.js (/api/ads/*) which debits and refunds
       the wallet atomically and is the only writer of impressions / clicks / spend. An admin approves new
       campaigns in Admin > Platform Analytics > "Ad campaign review"; app-feed.js serves approved ones.
       ============================================================================= */
    function _fmtE(n) { n = Number(n) || 0; return (Math.round(n * 100) / 100).toLocaleString(); }
    function _tsOf(v) { if (!v) return 0; if (typeof v.toMillis === 'function') return v.toMillis(); var t = Date.parse(v); return isNaN(t) ? 0 : t; }
    function _topOf(map, n) { return Object.keys(map).map(function (k) { return { k: k, v: map[k] }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, n); }
    function _summ(items) {
        var now = Date.now(), d30 = now - 30 * 86400000, o = { total: 0, count: 0, last30: 0, who: {}, label: {}, streams: {}, days: {} };
        items.forEach(function (i) {
            o.total += i.amt; o.count++; if (i.ts >= d30) o.last30 += i.amt;
            if (i.who) o.who[i.who] = (o.who[i.who] || 0) + i.amt;
            if (i.label) o.label[i.label] = (o.label[i.label] || 0) + i.amt;
            if (i.stream) o.streams[i.stream] = 1;
            var k = Math.floor((now - i.ts) / 86400000); if (i.ts && k >= 0 && k < 14) o.days[k] = (o.days[k] || 0) + i.amt;
        });
        return o;
    }
    function _loadGiftsModel(uid) {
        return _tmo(window.fbDb.collection('gifts').where('recipientId', '==', uid).limit(500).get(), 20000).then(function (s) {
            var a = []; s.forEach(function (d) { var x = d.data() || {}; a.push({ amt: Number(x.amount) || 0, ts: _tsOf(x.timestamp || x.createdAt), who: x.senderId || '', label: x.giftType || x.giftName || 'Gift' }); });
            return _summ(a);
        });
    }
    function _loadLiveModel(uid) {
        var col = window.fbDb.collection('live_gifts');
        return Promise.all([_tmo(col.where('hostId', '==', uid).limit(500).get(), 20000), _tmo(col.where('recipientId', '==', uid).limit(500).get(), 20000)]).then(function (r) {
            var seen = {}, a = [];
            r.forEach(function (s) { s.forEach(function (d) {
                if (seen[d.id]) return; seen[d.id] = 1; var x = d.data() || {};
                if (x.senderId === uid) return;
                a.push({ amt: Number(x.amount) || 0, ts: _tsOf(x.createdAt), who: x.senderName || x.senderId || '', label: x.giftName || 'Gift', stream: x.streamId || '' });
            }); });
            return _summ(a);
        });
    }
    function _monLoadSource(src, force) {
        var us = _us(); if (!us || !us.id) return;
        if (_monSrc.uid !== us.id) _monSrc = { uid: us.id, at: 0, data: {}, busy: {} };
        var ent = _monSrc.data[src];
        if (ent && !force && Date.now() - ent.at < 60000) { _monPaintSource(); return; }
        if (_monSrc.busy[src]) return;
        var uid = us.id;
        function done(model) { _monSrc.busy[src] = 0; _monSrc.data[src] = { at: Date.now(), model: model }; if (src === _monSource) _monPaintSource(); }
        if (!window.fbDb || !window._firebaseLoaded) { setTimeout(function () { _monLoadSource(src, force); }, 1500); return; }
        _monSrc.busy[src] = 1;
        if (src === 'Subs') { _loadSubsModel(uid).then(done, function (e) { done({ err: (e && e.code) || 'error' }); }); return; }
        if (src === 'Gifts') _loadGiftsModel(uid).then(done, function (e) { done({ err: (e && e.code) || 'error' }); });
        else if (src === 'Live') _loadLiveModel(uid).then(done, function (e) { done({ err: (e && e.code) || 'error' }); });
        else if (src === 'Ads') { try { loadAdRevenueShare(uid, function (ledger) { done({ ledger: ledger || null }); }); } catch (e) { done({ err: 'error' }); } }
        else done({ err: 'unknown' });
    }
    function _monPaintSource() {
        var b = document.getElementById('mz-source-body'); if (!b) return;
        b.innerHTML = _monSourceHtml(_us());
        var box = document.getElementById('profile-monetization'); if (box) _monSnapshotKeep(box);
    }
    function _srcSummaryHtml(m, src) {
        var live = src === 'Live';
        if (!m.count) return '<p class="mz-note">No ' + (live ? 'live-stream gifts' : 'gifts') + ' received yet. They are listed here the moment someone sends you one.</p>';
        var days = [], mx = 1, i; for (i = 13; i >= 0; i--) { var v = m.days[i] || 0; days.push(v); if (v > mx) mx = v; }
        var h = '<div class="mz-src-hero"><span>Total received</span><b>' + _fmtE(m.total) + ' EMPY</b><small>\u2248 ' + _esc(_fmtUsd(m.total * _rate())) + '</small></div>' +
            '<div class="mz-src-grid"><div><span>Last 30 days</span><b>' + _fmtE(m.last30) + ' EMPY</b></div><div><span>Gifts received</span><b>' + m.count + '</b></div>' +
            '<div><span>' + (live ? 'Supporters' : 'Different senders') + '</span><b>' + Object.keys(m.who).length + '</b></div>' +
            '<div><span>' + (live ? 'Streams with gifts' : 'Average gift') + '</span><b>' + (live ? Object.keys(m.streams).length : _fmtE(m.total / m.count) + ' EMPY') + '</b></div></div>' +
            '<div class="mz-spark">' + days.map(function (v) { return '<i style="height:' + Math.max(4, Math.round(v / mx * 100)) + '%" title="' + _fmtE(v) + ' EMPY"></i>'; }).join('') + '</div><div class="mz-note" style="margin:4px 0 8px;">Last 14 days (oldest \u2192 today)</div>';
        var tl = _topOf(m.label, 3);
        if (live) { var tw = _topOf(m.who, 3); h += '<div class="mz-src-list"><b>Top supporters</b>' + tw.map(function (x) { return '<div><span>' + _esc(x.k) + '</span><span>' + _fmtE(x.v) + ' EMPY</span></div>'; }).join('') + '</div>'; }
        h += '<div class="mz-src-list"><b>Top gifts</b>' + tl.map(function (x) { return '<div><span>' + _esc(x.k) + '</span><span>' + _fmtE(x.v) + ' EMPY</span></div>'; }).join('') + '</div>';
        return h;
    }
    function _monSourceHtml(us) {
        var ent = _monSrc.uid === us.id && _monSrc.data[_monSource];
        if (!ent) return '<p class="mz-note">Loading ' + _esc(_monSource.toLowerCase()) + ' earnings\u2026</p>';
        var m = ent.model;
        if (m.err) return '<p class="mz-note">Could not load these earnings (' + _esc(m.err) + '). <a href="#" class="mz-link" data-mz-src-retry="1">Retry</a></p>';
        if (_monSource === 'Subs') return _subsPanelHtml(m, us);
        if (_monSource === 'Ads') {
            var l = m.ledger;
            if (!l) return '<p class="mz-note">No ad-revenue share has been computed for your account yet. An admin splits the platform\u2019s real ad revenue each period; your figures appear here once it has been computed for you.</p>';
            var tot = Number(l.totalEarnedUsd) || 0, paid = Number(l.paidOutUsd) || 0;
            return '<div class="mz-src-hero"><span>Total earned from ad revenue</span><b>' + _esc(_fmtUsd(tot)) + '</b><small>Your share: ' + Math.round((l.sharePct || AD_REVENUE_DISPLAY.baselinePct) * 100) + '%</small></div>' +
                '<div class="mz-src-grid"><div><span>Last period' + (l.lastPeriodKey ? ' (' + _esc(l.lastPeriodKey) + ')' : '') + '</span><b>' + _esc(_fmtUsd(l.lastPeriodCreatorShareUsd || 0)) + '</b></div><div><span>Paid out</span><b>' + _esc(_fmtUsd(paid)) + '</b></div>' +
                '<div><span>Available now</span><b>' + _esc(_fmtUsd(Math.max(0, tot - paid))) + '</b></div><div><span>Payout</span><b>See Ad Revenue Share below</b></div></div>';
        }
        return _srcSummaryHtml(m, _monSource);
    }

    /* ───────────────────────────── ADS MANAGER ───────────────────────────── */
    var AM = { tab: 'campaigns', camps: null, loading: false, err: '', busy: false, uploading: false, posts: null, postsLoading: false, pay: 'wallet',
        pricing: { cpm: 5, cpc: 0.5, minDaily: 20, maxDaily: 50000, maxDays: 30, ctas: ['Learn More', 'Shop Now', 'Sign Up', 'Donate', 'Contact Us', 'Download', 'Apply Now'], empyUsd: 0.10, ngnPerEmpy: 150, cardEnabled: false },
        draft: null };
    function _amNewDraft() {
        var us = _us();
        return { name: '', objective: 'awareness', locations: '', keywords: '', dailyBudget: 50, durationDays: 7, advertiserName: us.fullName || us.username || '', caption: '', ctaLabel: 'Learn More', linkUrl: '', mediaUrl: '', mediaType: 'image', postId: '', placement: 'all' };
    }
    /* 2026-11-07: where the campaign may appear — 'all', 'card' (feed card), 'popup' (inside videos), 'slide' (between reels) */
    function _amPlacementOpts(d) {
        return [['all', 'Everywhere'], ['card', 'Feed card only'], ['popup', 'Pop-up inside videos only'], ['slide', 'Slide between reels only']].map(function (o) {
            return '<option value="' + o[0] + '"' + ((d.placement || 'all') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
    }
    function _amInjectCss() {
        if (document.getElementById('emp-ams-css')) return;
        var s = document.createElement('style'); s.id = 'emp-ams-css';
        s.textContent =
            '#emp-ams{position:fixed;inset:0;z-index:100060;background:#f1f5f9;display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1e293b;}' +
            '#emp-ams.open{display:flex;}#emp-ams *{box-sizing:border-box;}' +
            '.ams-top{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0c1e4a;color:#fff;}' +
            '.ams-top h2{font-size:1.05rem;font-weight:900;margin:0;flex:1;}.ams-top button{border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:10px;min-width:38px;min-height:38px;cursor:pointer;font-size:1rem;}' +
            '.ams-bal{font-size:.74rem;font-weight:800;background:rgba(255,255,255,.14);padding:6px 10px;border-radius:20px;white-space:nowrap;}' +
            '.ams-tabs{display:flex;gap:6px;padding:10px 14px;background:#fff;border-bottom:1px solid #e2e8f0;}' +
            '.ams-tabs button{border:0;background:#f1f5f9;color:#64748b;padding:8px 16px;border-radius:20px;font-size:.78rem;font-weight:800;cursor:pointer;min-height:36px;}.ams-tabs button.on{background:#0c1e4a;color:#fff;}' +
            '.ams-body{flex:1;overflow-y:auto;padding:14px;-webkit-overflow-scrolling:touch;}.ams-wrap{max-width:980px;margin:0 auto;}' +
            '.ams-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:14px;}' +
            '.ams-card h3{font-size:.9rem;font-weight:900;margin:0 0 4px;color:#0b1528;}.ams-sub{font-size:.74rem;color:#64748b;margin:0 0 12px;display:block;}' +
            '.ams-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px;}' +
            '.ams-sum div{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;}.ams-sum span{display:block;font-size:.66rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.4px;}.ams-sum b{font-size:1.15rem;font-weight:900;color:#0b1528;}' +
            '.ams-c{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;}.ams-c img,.ams-c video{width:92px;height:92px;object-fit:cover;border-radius:10px;background:#e2e8f0;flex-shrink:0;}' +
            '.ams-c .m{flex:1;min-width:210px;}.ams-c h4{margin:0 0 2px;font-size:.92rem;font-weight:900;color:#0b1528;}.ams-meta{font-size:.72rem;color:#64748b;margin:2px 0;}' +
            '.ams-chip{display:inline-block;font-size:.66rem;font-weight:900;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:#475569;margin-left:6px;vertical-align:middle;}' +
            '.ams-chip.active{background:#dcfce7;color:#166534;}.ams-chip.pending_review{background:#fef3c7;color:#92400e;}.ams-chip.rejected,.ams-chip.cancelled{background:#ffe4e6;color:#9f1239;}.ams-chip.paused{background:#e0e7ff;color:#3730a3;}' +
            '.ams-met{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin:10px 0;}.ams-met div{background:#f8fafc;border-radius:10px;padding:8px 10px;}.ams-met span{display:block;font-size:.62rem;font-weight:800;color:#94a3b8;text-transform:uppercase;}.ams-met b{font-size:.9rem;font-weight:900;color:#0b1528;}' +
            '.ams-trk{height:7px;background:#f1f5f9;border-radius:10px;overflow:hidden;}.ams-trk i{display:block;height:100%;background:#1d4ed8;border-radius:10px;}' +
            '.ams-spark{display:flex;align-items:flex-end;gap:4px;height:46px;margin:10px 0 2px;}.ams-spark i{flex:1;background:#93c5fd;border-radius:3px 3px 1px 1px;min-height:2px;}' +
            '.ams-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}' +
            '.ams-btn{border:0;background:#0c1e4a;color:#fff;border-radius:10px;padding:9px 16px;font-size:.78rem;font-weight:800;cursor:pointer;min-height:38px;}.ams-btn.ghost{background:#fff;color:#1B2B8B;border:1.5px solid #d5daea;}.ams-btn.danger{background:#fff;color:#be123c;border:1.5px solid #fecdd3;}.ams-btn:disabled{opacity:.55;cursor:default;}' +
            '.ams-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;}@media(max-width:820px){.ams-grid{grid-template-columns:1fr;}}' +
            '.ams-f{margin-bottom:12px;}.ams-f label{display:block;font-size:.72rem;font-weight:800;color:#334155;margin-bottom:5px;}.ams-f input,.ams-f select,.ams-f textarea{width:100%;border:1.5px solid #d5daea;border-radius:10px;padding:10px 12px;font-size:.85rem;font-family:inherit;background:#fff;color:#0f172a;}.ams-f textarea{min-height:76px;resize:vertical;}.ams-f small{display:block;font-size:.68rem;color:#94a3b8;margin-top:4px;}' +
            '.ams-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}' +
            '.ams-obj{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}.ams-obj button{text-align:left;border:1.5px solid #d5daea;background:#fff;border-radius:12px;padding:10px 12px;cursor:pointer;}.ams-obj button.on{border-color:#1d4ed8;background:#eff6ff;}.ams-obj b{display:block;font-size:.82rem;color:#0b1528;}.ams-obj span{font-size:.7rem;color:#64748b;}' +
            '.ams-est{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:12px;font-size:.78rem;line-height:1.6;color:#334155;}.ams-est b{color:#0b1528;}' +
            '.ams-pv{border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;background:#fff;}.ams-pv .b{font-size:.66rem;font-weight:800;color:#64748b;padding:8px 12px 0;}.ams-pv .a{font-weight:900;font-size:.82rem;padding:2px 12px;}.ams-pv p{margin:0;padding:2px 12px 8px;font-size:.8rem;color:#334155;}' +
            '.ams-pv .md{width:100%;aspect-ratio:1/1;background:#e2e8f0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:.76rem;}.ams-pv .md img,.ams-pv .md video{width:100%;height:100%;object-fit:cover;}' +
            '.ams-pv .cta{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f8fafc;font-size:.78rem;font-weight:800;color:#1d4ed8;}' +
            '.ams-err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;font-size:.78rem;margin-bottom:12px;}.ams-empty{text-align:center;padding:34px 14px;color:#64748b;font-size:.84rem;}';
        document.head.appendChild(s);
    }
    function _amDay(ago) { return new Date(Date.now() + 3600000 - ago * 86400000).toISOString().slice(0, 10).replace(/-/g, '_'); }
    function _amToken() { return window.fbAuth && window.fbAuth.currentUser ? window.fbAuth.currentUser.getIdToken() : Promise.reject(new Error('Not signed in.')); }
    function _amFetch(method, path, body) {
        return _amToken().then(function (t) {
            var o = { method: method, headers: { 'Authorization': 'Bearer ' + t } };
            if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
            return fetch(_adRevApiBase() + path, o).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }, function () { throw new Error('HTTP ' + r.status); }); });
        });
    }
    function _amEl() {
        var el = document.getElementById('emp-ams');
        if (!el) {
            _amInjectCss(); el = document.createElement('div'); el.id = 'emp-ams'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Ads Manager');
            document.body.appendChild(el);
            el.addEventListener('click', _amClick); el.addEventListener('input', _amInput); el.addEventListener('change', _amInput);
        }
        return el;
    }
    function _amLoad() {
        var us = _us(); if (!us || !us.id || !window.fbDb) return;
        AM.loading = true; AM.err = ''; _amRender();
        _tmo(window.fbDb.collection('ad_campaigns').where('ownerId', '==', us.id).limit(100).get(), 20000).then(function (s) {
            var a = []; s.forEach(function (d) { var c = d.data() || {}; c.id = d.id; c._ts = _tsOf(c.createdAt); a.push(c); });
            a.sort(function (x, y) { return y._ts - x._ts; }); AM.camps = a; AM.loading = false; _amRender();
        }).catch(function (e) { AM.loading = false; AM.err = 'Could not load your campaigns (' + ((e && (e.code || e.message)) || 'error') + ').'; _amRender(); });
    }
    window.openAdsManager = function () {
        var us = _us(); if (!us || !us.id || String(us.id).indexOf('guest') === 0) { _notify('Log in to use Ads Manager.', 'error'); return; }
        var el = _amEl(); el.classList.add('open'); if (!AM.draft) AM.draft = _amNewDraft();
        _amFetch('GET', '/ads/pricing').then(function (p) { AM.pricing = Object.assign(AM.pricing, p); _amRender(); }).catch(function () {});
        _amLoad();
    };
    function _amClose() { var el = document.getElementById('emp-ams'); if (el) el.classList.remove('open'); }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _amClose(); });

    var AM_STATUS = { pending_review: 'Starting', active: 'Running', paused: 'Paused', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' };
    var AM_OBJ = { awareness: ['Awareness', 'Show your ad to as many people as possible. Billed per 1,000 views.'], traffic: ['Traffic', 'Send people to your website or page. Billed per click.'], leads: ['Leads', 'Get sign-ups and enquiries. Billed per click.'] };
    function _amRender() {
        var el = document.getElementById('emp-ams'); if (!el || !el.classList.contains('open')) return;
        var us = _us(), bal = Math.floor(us.empyBalance || 0);
        el.innerHTML = '<div class="ams-top"><button type="button" data-ams="close" aria-label="Close"><i class="fas fa-arrow-left"></i></button><h2><i class="fas fa-bullhorn"></i> Ads Manager</h2><span class="ams-bal">' + _fmtE(bal) + ' EMPY</span></div>' +
            '<div class="ams-tabs"><button type="button" data-ams-tab="campaigns" class="' + (AM.tab === 'campaigns' ? 'on' : '') + '">Campaigns</button><button type="button" data-ams-tab="create" class="' + (AM.tab === 'create' ? 'on' : '') + '">Create campaign</button></div>' +
            '<div class="ams-body"><div class="ams-wrap">' + (AM.tab === 'create' ? _amCreateHtml() : _amListHtml()) + '</div></div>';
        if (AM.tab === 'create') { _amRefreshLive(); _amLoadPosts(); }
    }
    function _amRate(c) { return c.pricing && c.pricing.model === 'cpm' ? 'CPM' : 'CPC'; }
    function _amListHtml() {
        if (AM.loading && !AM.camps) return '<div class="ams-empty"><i class="fas fa-circle-notch fa-spin"></i> Loading your campaigns\u2026</div>';
        var h = AM.err ? '<div class="ams-err">' + _esc(AM.err) + ' <button type="button" class="ams-btn ghost" data-ams="reload">Retry</button></div>' : '', list = AM.camps || [];
        if (!list.length) return h + '<div class="ams-card"><div class="ams-empty"><i class="fas fa-bullhorn" style="font-size:1.6rem;color:#94a3b8;"></i><br><br><b>No campaigns yet</b><br>Reach more people with a paid campaign. You choose the audience, the budget and the dates \u2014 you only pay for delivery, and unspent budget is refunded.<br><br><button type="button" class="ams-btn" data-ams-tab="create">Create your first campaign</button></div></div>';
        var t = list.reduce(function (a, c) { a.spent += c.spent || 0; a.imp += c.impressions || 0; a.clk += c.clicks || 0; a.reach += c.reach || 0; return a; }, { spent: 0, imp: 0, clk: 0, reach: 0 });
        h += '<div class="ams-sum"><div><span>Total spent</span><b>' + _fmtE(t.spent) + ' EMPY</b></div><div><span>Impressions</span><b>' + _fmtE(t.imp) + '</b></div><div><span>Reach</span><b>' + _fmtE(t.reach) + '</b></div><div><span>Clicks</span><b>' + _fmtE(t.clk) + '</b></div></div>';
        return h + list.map(function (c) {
            var imp = c.impressions || 0, clk = c.clicks || 0, ctr = imp ? clk / imp * 100 : 0, sp = c.spent || 0, pct = c.totalBudget ? Math.min(100, Math.round(sp / c.totalBudget * 100)) : 0;
            var cost = _amRate(c) === 'CPM' ? (imp ? sp / (imp / 1000) : 0) : (clk ? sp / clk : 0);
            var media = c.mediaType === 'video' ? '<video src="' + _esc(c.mediaUrl) + '" muted playsinline preload="metadata"></video>' : '<img src="' + _esc(c.mediaUrl) + '" alt="" loading="lazy">';
            var days = [], mx = 1, i, field = c.objective === 'awareness' ? 'impressions' : 'clicks';
            for (i = 6; i >= 0; i--) { var v = ((c.daily || {})[_amDay(i)] || {})[field] || 0; days.push(v); if (v > mx) mx = v; }
            var when = c.status === 'pending_review' ? 'Starts once approved \u2022 ' + c.durationDays + ' days' : (c.endAt ? (c.status === 'active' || c.status === 'paused' ? 'Ends ' : 'Ended ') + new Date(c.endedAt && c.status !== 'active' && c.status !== 'paused' ? c.endedAt : c.endAt).toLocaleDateString() : '');
            var acts = '';
            if (c.status === 'active') acts += '<button type="button" class="ams-btn ghost" data-ams-act="pause" data-id="' + _esc(c.id) + '">Pause</button>';
            if (c.status === 'paused') acts += '<button type="button" class="ams-btn" data-ams-act="resume" data-id="' + _esc(c.id) + '">Resume</button>';
            if (['pending_review', 'active', 'paused'].indexOf(c.status) > -1) acts += '<button type="button" class="ams-btn danger" data-ams-act="cancel" data-id="' + _esc(c.id) + '">Cancel &amp; refund unspent</button>';
            return '<div class="ams-card"><div class="ams-c">' + media + '<div class="m"><h4>' + _esc(c.name) + '<span class="ams-chip ' + _esc(c.status) + '">' + _esc(AM_STATUS[c.status] || c.status) + '</span></h4>' +
                '<div class="ams-meta">' + _esc((AM_OBJ[c.objective] || [c.objective])[0]) + ' \u2022 ' + _fmtE(c.dailyBudget) + ' EMPY/day \u2022 ' + _esc(when) + '</div>' +
                (c.status === 'rejected' && c.rejectReason ? '<div class="ams-meta" style="color:#be123c;">Rejected: ' + _esc(c.rejectReason) + ' (your budget was refunded)</div>' : '') +
                '<div class="ams-meta">Budget used ' + _fmtE(sp) + ' / ' + _fmtE(c.totalBudget) + ' EMPY' + (c.refunded ? ' \u2022 ' + _fmtE(c.refunded) + ' refunded' : '') + '</div><div class="ams-trk"><i style="width:' + pct + '%"></i></div></div></div>' +
                '<div class="ams-met"><div><span>Impressions</span><b>' + _fmtE(imp) + '</b></div><div><span>Reach</span><b>' + _fmtE(c.reach || 0) + '</b></div><div><span>Clicks</span><b>' + _fmtE(clk) + '</b></div><div><span>CTR</span><b>' + (Math.round(ctr * 100) / 100) + '%</b></div><div><span>Avg ' + _amRate(c) + '</span><b>' + (cost ? (Math.round(cost * 100) / 100) : '\u2014') + '</b></div><div><span>Spent</span><b>' + _fmtE(sp) + '</b></div></div>' +
                '<div class="ams-spark">' + days.map(function (v) { return '<i style="height:' + Math.max(4, Math.round(v / mx * 100)) + '%" title="' + v + '"></i>'; }).join('') + '</div><div class="ams-meta">Last 7 days \u2022 ' + field + '</div>' +
                (acts ? '<div class="ams-act">' + acts + '</div>' : '') + '</div>';
        }).join('');
    }
    function _amCreateHtml() {
        var d = AM.draft || (AM.draft = _amNewDraft()), p = AM.pricing;
        var obj = Object.keys(AM_OBJ).map(function (k) { return '<button type="button" data-ams-obj="' + k + '" class="' + (d.objective === k ? 'on' : '') + '"><b>' + AM_OBJ[k][0] + '</b><span>' + AM_OBJ[k][1] + '</span></button>'; }).join('');
        var cta = (p.ctas || []).map(function (c) { return '<option' + (d.ctaLabel === c ? ' selected' : '') + '>' + _esc(c) + '</option>'; }).join('');
        return '<div class="ams-grid"><div>' +
            '<div class="ams-card"><h3>Promote one of your posts <span style="font-weight:600;color:#94a3b8;">(optional)</span></h3><span class="ams-sub">Pick a post to turn it into an ad, or skip this and build a custom ad below.</span><div class="ams-f"><select data-ams-post="1">' + _amPostOptions(d.postId) + '</select></div></div>' +
            '<div class="ams-card"><h3>1. Campaign</h3><span class="ams-sub">Name it and pick what you want to achieve.</span><div class="ams-f"><label>Campaign name</label><input data-ams-f="name" maxlength="60" value="' + _esc(d.name) + '" placeholder="e.g. Back-to-school promo"></div><div class="ams-obj">' + obj + '</div></div>' +
            '<div class="ams-card"><h3>2. Audience</h3><span class="ams-sub">Leave both blank to reach everyone. Matching uses the location, bio, profession and hobbies members put on their profile.</span>' +
            '<div class="ams-f"><label>Locations</label><input data-ams-f="locations" value="' + _esc(d.locations) + '" placeholder="e.g. Lagos, Abuja, Port Harcourt"><small>Separate with commas. A member matches if their profile location contains one of these.</small></div>' +
            '<div class="ams-f"><label>Interests / keywords</label><input data-ams-f="keywords" value="' + _esc(d.keywords) + '" placeholder="e.g. fashion, farming, football"><small>Separate with commas. Up to 10.</small></div></div>' +
            '<div class="ams-card"><h3>3. Budget &amp; schedule</h3><span class="ams-sub">Paid from your EMPY wallet now. Anything not spent is refunded when the campaign ends or is cancelled.</span><div class="ams-row">' +
            '<div class="ams-f"><label>Daily budget (EMPY)</label><input type="number" inputmode="numeric" data-ams-f="dailyBudget" min="' + p.minDaily + '" max="' + p.maxDaily + '" value="' + _esc(d.dailyBudget) + '"></div>' +
            '<div class="ams-f"><label>Duration (days)</label><input type="number" inputmode="numeric" data-ams-f="durationDays" min="1" max="' + p.maxDays + '" value="' + _esc(d.durationDays) + '"></div></div><div class="ams-est" id="ams-est"></div></div>' +
            '<div class="ams-card"><h3>4. Ad creative</h3><span class="ams-sub">What people will see in their feed.</span>' +
            '<div class="ams-f"><label>Advertiser / page name</label><input data-ams-f="advertiserName" maxlength="60" value="' + _esc(d.advertiserName) + '"></div>' +
            '<div class="ams-f"><label>Image or video</label><input type="file" id="ams-file" accept="image/*,video/*"><small id="ams-up">' + (d.mediaUrl ? 'Uploaded \u2713 \u2014 choose another file to replace it.' : 'Square images work best.') + '</small></div>' +
            '<div class="ams-f"><label>Text</label><textarea data-ams-f="caption" maxlength="300" placeholder="Say something short and clear (300 characters max)">' + _esc(d.caption) + '</textarea></div>' +
            '<div class="ams-row"><div class="ams-f"><label>Button</label><select data-ams-f="ctaLabel">' + cta + '</select></div><div class="ams-f"><label>Destination link' + (d.objective === 'awareness' ? ' (optional)' : '') + '</label><input type="url" data-ams-f="linkUrl" value="' + _esc(d.linkUrl) + '" placeholder="https://"></div></div>' +
            '<div class="ams-row"><div class="ams-f"><label>Where to show</label><select data-ams-f="placement">' + _amPlacementOpts(d) + '</select></div></div></div>' +
            '</div><div><div class="ams-card" style="position:sticky;top:0;"><h3>Preview</h3><span class="ams-sub">How your ad will look in the feed.</span><div id="ams-pv"></div>' +
            '<div class="ams-f" style="margin-top:12px;"><label>Pay with</label><select data-ams-pay="1"><option value="wallet"' + (AM.pay === 'wallet' ? ' selected' : '') + '>EMPY wallet</option>' + (p.cardEnabled ? '<option value="card"' + (AM.pay === 'card' ? ' selected' : '') + '>Debit / credit card or bank transfer</option>' : '') + '</select></div>' +
            '<div id="ams-msg"></div><button type="button" class="ams-btn" id="ams-submit" data-ams="submit" style="width:100%;margin-top:4px;"></button><div class="ams-meta" style="margin-top:8px;">Your campaign goes live right after payment. You can pause or cancel any time \u2014 unspent budget is returned to your EMPY wallet.</div></div></div></div>';
    }
    function _amPostOptions(sel) {
        if (AM.postsLoading) return '<option value="">Loading your posts\u2026</option>';
        var o = '<option value="">\u2014 No post, custom ad \u2014</option>';
        (AM.posts || []).forEach(function (p) { o += '<option value="' + _esc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + _esc((p.text || 'Post with media').replace(/\s+/g, ' ').slice(0, 60)) + '</option>'; });
        return o;
    }
    function _amLoadPosts() {
        var us = _us(); if (AM.posts || AM.postsLoading || !us.id || !window.fbDb) return;
        AM.postsLoading = true;
        _tmo(window.fbDb.collection('posts').where('userId', '==', us.id).limit(40).get(), 20000).then(function (sn) {
            var a = []; sn.forEach(function (d) { var x = d.data() || {}; var m = Array.isArray(x.media) ? x.media.filter(Boolean) : []; if ((x.text || m.length) && !x.isQuote) a.push({ id: d.id, text: String(x.text || ''), media: m, at: String(x.createdAt || '') }); });
            a.sort(function (x, y) { return y.at < x.at ? -1 : 1; }); AM.posts = a; AM.postsLoading = false; if (AM.tab === 'create') _amRender();
        }).catch(function () { AM.posts = []; AM.postsLoading = false; });
    }
    function _amPickPost(id) {
        var d = AM.draft; d.postId = id || ''; if (!id) { _amRender(); return; }
        var p = (AM.posts || []).filter(function (x) { return x.id === id; })[0]; if (!p) return;
        var m = p.media[0] || '';
        d.caption = p.text.slice(0, 300); d.mediaUrl = /^https:\/\//.test(m) ? m : ''; d.mediaType = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(m) ? 'video' : 'image';
        d.linkUrl = window.location.origin + '/?post=' + encodeURIComponent(id); d.ctaLabel = 'Learn More';
        if (!d.name) d.name = 'Promote: ' + (p.text.replace(/\s+/g, ' ').slice(0, 30) || 'my post');
        _amRender();
    }
    function _amTotals() {
        var d = AM.draft, p = AM.pricing, daily = Math.floor(Number(d.dailyBudget)) || 0, days = Math.floor(Number(d.durationDays)) || 0, total = daily * days;
        return { daily: daily, days: days, total: total };
    }
    function _amRefreshLive() {
        var d = AM.draft, p = AM.pricing, t = _amTotals(), est = document.getElementById('ams-est'), pv = document.getElementById('ams-pv'), btn = document.getElementById('ams-submit');
        if (est) {
            var line = d.objective === 'awareness' ? 'Up to about <b>' + _fmtE(Math.floor(t.total / (p.cpm / 1000))) + '</b> views' : 'Up to about <b>' + _fmtE(Math.floor(t.total / p.cpc)) + '</b> clicks';
            est.innerHTML = 'Total budget: <b>' + _fmtE(t.total) + ' EMPY</b> (\u2248 ' + _esc(_fmtUsd(t.total * (p.empyUsd || 0.1))) + ') for ' + t.days + ' day' + (t.days === 1 ? '' : 's') + '.<br>' + line + ' \u2014 an estimate at today\u2019s rate (' + (d.objective === 'awareness' ? p.cpm + ' EMPY per 1,000 views' : p.cpc + ' EMPY per click') + '). Daily spend never goes above your daily budget.';
        }
        if (pv) {
            var media = d.mediaUrl ? (d.mediaType === 'video' ? '<video src="' + _esc(d.mediaUrl) + '" muted playsinline autoplay loop></video>' : '<img src="' + _esc(d.mediaUrl) + '" alt="">') : 'Your image or video';
            pv.innerHTML = '<div class="ams-pv"><div class="b"><i class="fas fa-bullhorn"></i> Sponsored</div><div class="a">' + _esc(d.advertiserName || 'Your page') + '</div>' + (d.caption ? '<p>' + _esc(d.caption) + '</p>' : '') + '<div class="md">' + media + '</div><div class="cta"><span>' + _esc(d.ctaLabel) + '</span><i class="fas fa-arrow-right"></i></div></div>';
        }
        if (btn) { btn.disabled = AM.busy || AM.uploading; btn.textContent = AM.busy ? 'Submitting\u2026' : 'Submit for review \u2022 pay ' + _fmtE(t.total) + ' EMPY'; }
    }
    function _amInput(e) {
        var t = e.target; if (!t || !AM.draft) return;
        if (t.id === 'ams-file') { if (e.type === 'change') _amUpload(t.files && t.files[0]); return; }
        if (t.getAttribute && t.getAttribute('data-ams-post')) { if (e.type === 'change') _amPickPost(t.value); return; }
        if (t.getAttribute && t.getAttribute('data-ams-pay')) { AM.pay = t.value === 'card' ? 'card' : 'wallet'; return; }
        var f = t.getAttribute && t.getAttribute('data-ams-f'); if (!f) return;
        AM.draft[f] = t.value; _amRefreshLive();
    }
    function _amUpload(file) {
        if (!file) return; var up = document.getElementById('ams-up');
        if (typeof window.uploadToCloudinary !== 'function') { if (up) up.textContent = 'Upload is not available right now.'; return; }
        AM.uploading = true; _amRefreshLive(); if (up) up.textContent = 'Uploading\u2026 0%';
        window.uploadToCloudinary(file, function (pct) { var u = document.getElementById('ams-up'); if (u) u.textContent = 'Uploading\u2026 ' + pct + '%'; }).then(function (url) {
            AM.uploading = false; AM.draft.mediaUrl = String(url || ''); AM.draft.mediaType = /^video\//.test(file.type) ? 'video' : 'image';
            var u = document.getElementById('ams-up'); if (u) u.textContent = 'Uploaded \u2713 \u2014 choose another file to replace it.'; _amRefreshLive();
        }).catch(function (err) { AM.uploading = false; var u = document.getElementById('ams-up'); if (u) u.textContent = 'Upload failed: ' + ((err && err.message) || 'try again'); _amRefreshLive(); });
    }
    function _amMsg(t) { var m = document.getElementById('ams-msg'); if (m) m.innerHTML = t ? '<div class="ams-err" style="margin-top:10px;">' + _esc(t) + '</div>' : ''; }
    function _amSubmit() {
        var d = AM.draft, p = AM.pricing, t = _amTotals(), us = _us();
        function bad(m) { _amMsg(m); }
        if (String(d.name).trim().length < 3) return bad('Give the campaign a name (3+ characters).');
        if (!d.mediaUrl) return bad('Add an image or video for your ad.');
        if (String(d.advertiserName).trim().length < 2) return bad('Enter the advertiser or page name.');
        if (d.objective !== 'awareness' && !/^https:\/\//i.test(String(d.linkUrl).trim())) return bad('Traffic and lead campaigns need a destination link starting with https://');
        if (d.linkUrl && !/^https:\/\//i.test(String(d.linkUrl).trim())) return bad('The destination link must start with https://');
        if (!(t.daily >= p.minDaily && t.daily <= p.maxDaily)) return bad('Daily budget must be between ' + p.minDaily + ' and ' + p.maxDaily + ' EMPY.');
        if (!(t.days >= 1 && t.days <= p.maxDays)) return bad('Duration must be between 1 and ' + p.maxDays + ' days.');
        var list = function (v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
        var payload = { name: d.name, objective: d.objective, advertiserName: d.advertiserName, caption: d.caption, mediaUrl: d.mediaUrl, mediaType: d.mediaType, linkUrl: String(d.linkUrl || '').trim(), ctaLabel: d.ctaLabel, locations: list(d.locations), keywords: list(d.keywords), dailyBudget: t.daily, durationDays: t.days, postId: d.postId || '', placement: d.placement || 'all' };
        function ok(msg) { AM.busy = false; _notify(msg, 'success'); AM.draft = _amNewDraft(); AM.tab = 'campaigns'; _amLoad(); }
        function fail(err) { AM.busy = false; _amRefreshLive(); _amMsg((err && err.message) || 'Could not create the campaign.'); }
        if (AM.pay === 'card') {
            var key = (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '';
            var uid = window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid;
            if (typeof FlutterwaveCheckout !== 'function' || !key || !uid) return bad('Card payment is not available right now. Please refresh, or pay with your EMPY wallet.');
            var ref = 'EMPY-AD-' + uid + '-' + Date.now(), amount = Math.ceil(t.total * (p.ngnPerEmpy || 150));
            _amMsg(''); AM.busy = true; _amRefreshLive();
            FlutterwaveCheckout({
                public_key: key, tx_ref: ref, amount: amount, currency: 'NGN', payment_options: 'card,banktransfer,ussd',
                customer: { email: us.email || 'user@empyrean.com', name: us.fullName || us.username || 'Empyrean User' },
                customizations: { title: 'Empyrean Ads', description: 'Ad campaign: ' + t.total + ' EMPY of ad budget', logo: 'https://cdn-icons-png.flaticon.com/512/6001/6001527.png' },
                callback: function (data) {
                    if (data.status !== 'successful' && data.status !== 'completed') { AM.busy = false; _amRefreshLive(); _amMsg('Payment was not completed.'); return; }
                    var txRef = data.tx_ref || data.transaction_ref || ref;
                    _amFetch('POST', '/ads/campaigns/create-card', Object.assign({ txRef: txRef }, payload)).then(function () { ok('Payment received \u2014 your campaign is live.'); })
                        .catch(function (err) { fail({ message: ((err && err.message) || 'Could not create the campaign.') + ' If you were charged, contact support with reference ' + txRef + '.' }); });
                },
                onclose: function () { if (AM.busy) { AM.busy = false; _amRefreshLive(); } }
            });
            return;
        }
        if ((us.empyBalance || 0) < t.total) return bad('Not enough EMPY. This campaign needs ' + _fmtE(t.total) + ' EMPY and your balance is ' + _fmtE(Math.floor(us.empyBalance || 0)) + '. Top up your wallet or pay by card.');
        _amMsg(''); AM.busy = true; _amRefreshLive();
        _amFetch('POST', '/ads/campaigns/create', payload).then(function () {
            us.empyBalance = (us.empyBalance || 0) - t.total; if (typeof window.updateWalletUI === 'function') try { window.updateWalletUI(); } catch (e) {}
            ok('Your campaign is live. ' + t.total + ' EMPY was reserved from your wallet.');
        }).catch(fail);
    }
    function _amAct(id, action, btn) {
        if (action === 'cancel' && !window.confirm('Cancel this campaign? Anything not yet spent is refunded to your wallet.')) return;
        if (btn) { btn.disabled = true; btn.textContent = 'Working\u2026'; }
        _amFetch('POST', '/ads/campaigns/' + encodeURIComponent(id) + '/action', { action: action }).then(function (r) {
            if (r && r.refunded) { var us = _us(); us.empyBalance = (us.empyBalance || 0) + r.refunded; if (typeof window.updateWalletUI === 'function') try { window.updateWalletUI(); } catch (e) {} _notify(_fmtE(r.refunded) + ' EMPY refunded to your wallet.', 'success'); }
            _amLoad();
        }).catch(function (err) { _notify((err && err.message) || 'Could not update the campaign.', 'error'); _amLoad(); });
    }
    function _amClick(e) {
        var t = e.target && e.target.closest ? e.target : null; if (!t) return;
        var a = t.closest('[data-ams]'), tab = t.closest('[data-ams-tab]'), obj = t.closest('[data-ams-obj]'), act = t.closest('[data-ams-act]');
        if (a) { var v = a.getAttribute('data-ams'); if (v === 'close') _amClose(); else if (v === 'reload') _amLoad(); else if (v === 'submit') _amSubmit(); return; }
        if (tab) { AM.tab = tab.getAttribute('data-ams-tab'); if (AM.tab === 'campaigns') _amLoad(); else _amRender(); return; }
        if (obj && AM.draft) { AM.draft.objective = obj.getAttribute('data-ams-obj'); _amRender(); return; }
        if (act) _amAct(act.getAttribute('data-id'), act.getAttribute('data-ams-act'), act);
    }


    /* ───────────────────── CREATOR SUBSCRIPTIONS (Subs tab + Subscribe button) ─────────────────────
       Plans: creator_subscription_plans/{creatorId}; fans: creator_subscriptions/{creatorId}_{fanId}.
       Payments, renewals and cancellations are done by server.js (/api/subs/*); this file only reads and calls it. */
    function _loadSubsModel(uid) {
        return Promise.all([
            _tmo(window.fbDb.collection('creator_subscription_plans').doc(uid).get(), 15000),
            _tmo(window.fbDb.collection('creator_subscriptions').where('creatorId', '==', uid).limit(500).get(), 20000)
        ]).then(function (r) {
            var subs = []; r[1].forEach(function (d) { var x = d.data() || {}; x.id = d.id; subs.push(x); });
            return { plan: r[0].exists ? r[0].data() : null, subs: subs };
        });
    }
    function _subsPanelHtml(m, us) {
        var now = Date.now(), subs = m.subs || [], act = subs.filter(function (x) { return x.status === 'active' && x.renewsAt > now; });
        var net = subs.reduce(function (a, x) { return a + (Number(x.totalNet) || 0); }, 0);
        var mrr = act.filter(function (x) { return !x.cancelAtPeriodEnd; }).reduce(function (a, x) { return a + (Number(x.priceEmpy) || 0) * (1 - (Number(x.feePct) || 0) / 100); }, 0);
        var plan = m.plan, h = ''; _subInjectCss();
        if (subs.length) {
            h += '<div class="mz-src-hero"><span>Total earned from subscriptions</span><b>' + _fmtE(net) + ' EMPY</b><small>\u2248 ' + _esc(_fmtUsd(net * _rate())) + '</small></div>' +
                '<div class="mz-src-grid"><div><span>Active subscribers</span><b>' + act.length + '</b></div><div><span>Monthly recurring</span><b>' + _fmtE(mrr) + ' EMPY</b></div>' +
                '<div><span>All-time subscribers</span><b>' + subs.length + '</b></div><div><span>Ending soon</span><b>' + act.filter(function (x) { return x.cancelAtPeriodEnd; }).length + '</b></div></div>';
        } else {
            h += '<p class="mz-note">No subscribers yet. Once you switch your plan on, a Subscribe button appears on your profile.</p>';
        }
        if (!us.isVerified) return h + '<p class="mz-note">Verify your account (KYC) to start offering paid subscriptions.</p>';
        h += '<div class="mz-src-list"><b>Your subscription plan</b></div>' +
            '<div class="mz-sub-form"><label for="mz-sub-price">Price (EMPY per 30 days)</label><input type="number" inputmode="numeric" id="mz-sub-price" min="10" max="100000" value="' + _esc(plan ? plan.priceEmpy : 50) + '">' +
            '<label for="mz-sub-perks">What subscribers get</label><textarea id="mz-sub-perks" maxlength="300" placeholder="e.g. Early access to my reels, subscriber shout-outs">' + _esc(plan ? plan.perks || '' : '') + '</textarea>' +
            '<label class="mz-sub-chk"><input type="checkbox" id="mz-sub-active"' + (!plan || plan.active ? ' checked' : '') + '> Accept new subscribers</label>' +
            '<button type="button" class="mz-btn" data-mz-sub-save="1">' + (plan ? 'Update plan' : 'Start offering subscriptions') + '</button></div>';
        if (subs.length) {
            h += '<div class="mz-src-list"><b>Recent subscribers</b>' + subs.slice().sort(function (a, b) { return (b.startedAt || 0) - (a.startedAt || 0); }).slice(0, 5).map(function (x) {
                var st = x.status === 'active' && x.renewsAt > now ? (x.cancelAtPeriodEnd ? 'ends ' + new Date(x.renewsAt).toLocaleDateString() : 'renews ' + new Date(x.renewsAt).toLocaleDateString()) : 'ended';
                return '<div><span>' + _esc(x.subscriberName || 'Member') + '</span><span>' + _fmtE(x.priceEmpy) + ' EMPY \u2022 ' + _esc(st) + '</span></div>';
            }).join('') + '</div>';
        }
        return h;
    }
    function _subSavePlan(btn) {
        var price = parseInt((document.getElementById('mz-sub-price') || {}).value, 10), perks = (document.getElementById('mz-sub-perks') || {}).value || '', act = !!(document.getElementById('mz-sub-active') || {}).checked;
        if (!(price >= 10 && price <= 100000)) { _notify('Price must be between 10 and 100,000 EMPY.', 'error'); return; }
        btn.disabled = true; btn.textContent = 'Saving\u2026';
        _adRevAuthedFetch('/subs/plan', { priceEmpy: price, perks: perks, active: act }).then(function () { _notify('Subscription plan saved.', 'success'); _monLoadSource('Subs', true); })
            .catch(function (e) { btn.disabled = false; btn.textContent = 'Save plan'; _notify((e && e.message) || 'Could not save the plan.', 'error'); });
    }

    // Fan side: a Subscribe box on other creators' profiles (only when the creator has an active plan).
    function _subInjectCss() {
        if (document.getElementById('emp-sub-css')) return;
        var st = document.createElement('style'); st.id = 'emp-sub-css';
        st.textContent = '.emp-sub-box{margin:10px 0;padding:12px;border:1.5px solid #d5daea;border-radius:12px;background:#f8fafc;font-size:.8rem;color:#334155;}.emp-sub-box b{color:#0b1528;}' +
            '.emp-sub-box button{margin-top:8px;border:0;background:#0c1e4a;color:#fff;border-radius:10px;padding:9px 16px;font-weight:800;font-size:.78rem;cursor:pointer;min-height:38px;}.emp-sub-box button.ghost{background:#fff;color:#be123c;border:1.5px solid #fecdd3;}.emp-sub-box button:disabled{opacity:.55;}' +
            '.mz-sub-form label{display:block;font-size:.72rem;font-weight:800;color:#334155;margin:8px 0 4px;}.mz-sub-form input[type=number],.mz-sub-form textarea{width:100%;border:1.5px solid #d5daea;border-radius:10px;padding:9px 12px;font-size:.85rem;font-family:inherit;}.mz-sub-form textarea{min-height:64px;}.mz-sub-form .mz-sub-chk{display:flex;gap:8px;align-items:center;font-weight:700;}.mz-sub-form .mz-btn{margin-top:10px;}';
        document.head.appendChild(st);
    }
    function _subBoxHtml(plan, sub) {
        var now = Date.now(), live = sub && sub.status === 'active' && sub.renewsAt > now;
        var h = '<b>Subscribe to ' + _esc(plan.creatorName || 'this creator') + '</b><br>' + _fmtE(plan.priceEmpy) + ' EMPY every 30 days' + (plan.perks ? '<br>' + _esc(plan.perks) : '');
        if (live) return h + '<br><b style="color:#047857;">Subscribed</b> \u2022 ' + (sub.cancelAtPeriodEnd ? 'ends ' : 'renews ') + new Date(sub.renewsAt).toLocaleDateString() + '<br>' +
            (sub.cancelAtPeriodEnd ? '<button type="button" data-emp-sub-act="subscribe" data-creator="' + _esc(plan.creatorId) + '">Keep my subscription</button>' : '<button type="button" class="ghost" data-emp-sub-act="cancel" data-creator="' + _esc(plan.creatorId) + '">Cancel at end of period</button>');
        return h + '<br><button type="button" data-emp-sub-act="subscribe" data-creator="' + _esc(plan.creatorId) + '" data-price="' + _esc(plan.priceEmpy) + '">Subscribe \u2022 ' + _fmtE(plan.priceEmpy) + ' EMPY</button>';
    }
    function _subRender(el, creatorId) {
        var us = _us(), auth = window.fbAuth && window.fbAuth.currentUser;
        el.setAttribute('data-emp-sub', creatorId);
        var old = el.querySelector('.emp-sub-box'); if (old) old.remove();
        if (!us.id || !auth || !creatorId || creatorId === us.id || creatorId === auth.uid || !window.fbDb || !window._firebaseLoaded) return;
        _tmo(window.fbDb.collection('creator_subscription_plans').doc(creatorId).get(), 12000).then(function (pd) {
            if (!pd.exists || !pd.data().active) return null;
            return _tmo(window.fbDb.collection('creator_subscriptions').doc(creatorId + '_' + auth.uid).get(), 12000).then(function (sd) { return { plan: pd.data(), sub: sd.exists ? sd.data() : null }; }, function () { return { plan: pd.data(), sub: null }; });
        }).then(function (r) {
            if (!r || el.getAttribute('data-emp-sub') !== creatorId) return;
            _subInjectCss(); var b = el.querySelector('.emp-sub-box'); if (b) b.remove();
            b = document.createElement('div'); b.className = 'emp-sub-box'; b.innerHTML = _subBoxHtml(r.plan, r.sub); el.appendChild(b);
        }).catch(function () {});
    }
    (function armSubscribeButton() {
        if (typeof MutationObserver === 'undefined') return;
        var queued = false;
        function scan() {
            queued = false;
            var els = document.querySelectorAll('.profile-header-info[data-user-id]');
            for (var i = 0; i < els.length; i++) { var uid = els[i].getAttribute('data-user-id'); if (uid && els[i].getAttribute('data-emp-sub') !== uid) _subRender(els[i], uid); }
        }
        function start() { new MutationObserver(function () { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(scan); } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-user-id'] }); scan(); }
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
        document.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('[data-emp-sub-act]') : null; if (!b) return;
            var act = b.getAttribute('data-emp-sub-act'), cid = b.getAttribute('data-creator'), box = b.closest('.emp-sub-box'), host = b.closest('.profile-header-info[data-user-id]');
            if (act === 'subscribe' && b.getAttribute('data-price') && !window.confirm('Subscribe for ' + b.getAttribute('data-price') + ' EMPY every 30 days? The first payment is taken now and it renews automatically until you cancel.')) return;
            if (act === 'cancel' && !window.confirm('Cancel? You keep access until the end of the period you already paid for.')) return;
            b.disabled = true;
            _adRevAuthedFetch(act === 'cancel' ? '/subs/cancel' : '/subs/subscribe', { creatorId: cid }).then(function () {
                if (act === 'subscribe' && b.getAttribute('data-price')) { var us = _us(); us.empyBalance = (us.empyBalance || 0) - Number(b.getAttribute('data-price')); if (typeof window.updateWalletUI === 'function') try { window.updateWalletUI(); } catch (e2) {} }
                _notify(act === 'cancel' ? 'Subscription will end at the end of the period.' : 'You are subscribed.', 'success'); if (host) _subRender(host, cid);
            }).catch(function (err) { b.disabled = false; _notify((err && err.message) || 'Something went wrong.', 'error'); });
        });
    })();

    log('Creator monetization module loaded.');
})();