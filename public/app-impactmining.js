/* =============================================================================
   EMPYREAN INTERNATIONAL — IMPACT MINING LOGIC ARCHITECTURE FRAMEWORK
   app-impact-mining.js  |  Step 0.15  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Extracted from app-fixes.js. Central reward engine for the Empyrean
   impact-mining system. Manages all EMPY reward logic and connects it to
   every user action across the platform.

   REWARD ACTIONS COVERED
   ──────────────────────
     Social engagement:
       • ENGAGE_LIKE           — user LIKES a post/comment (the engager is rewarded)
       • ENGAGE_COMMENT        — user COMMENTS on a post (the engager is rewarded)
       • RETWEET_POST          — user retweets
       • SHARE_POST            — user shares a post externally (cross-posting)
       • SEND_GIFT             — user sends a symbolic gift

     RETIRED (2026-08-15 — engagement-attribution fix): RECEIVE_LIKE /
     RECEIVE_COMMENT used to pay the post/comment AUTHOR every time someone
     ELSE liked/commented on their content. Two problems: (1) it rewarded
     the wrong side of the interaction — the post author already earns
     EMPY for the act of posting (CREATE_POST/CREATE_REEL); the engagement
     reward belongs to the person DOING the liking/commenting (ENGAGE_LIKE/
     ENGAGE_COMMENT above), not the person receiving it a second time.
     (2) "receiving engagement" is a creator-monetization concern, not an
     impact-mining (EMPY) one — app-monetization.js's computeEngagement()
     already reads a creator's total likes/commentCount/shareCount straight
     off their posts to gate their payout tier/eligibility, so a creator
     already earns real payout upside from receiving likes/comments through
     that system. Paying it AGAIN here, per-event, out of the mining pool
     was duplicate credit through the wrong channel. See §1 (REWARD_TABLE),
     §2 (SELF_MINING_SERVER_ACTIONS/SERVER_OBSERVED_ACTIONS) and §8
     (onLikePost/onCommentPost) below for the actual removal, and
     server.js's own matching note for the server-side half of this fix.

     Content creation:
       • CREATE_POST           — user publishes a feed post
       • CREATE_REEL           — user publishes a reel
       • PUBLISH_NEWS          — user publishes a news article

     Download:
       • DOWNLOAD_MEDIA        — user downloads media from the platform

     Live streaming:
       • LIVE_STREAM_INTERVAL  — host reward tick every 2 min
       • GUEST_JOINED_LIVE     — guest joins a live stream
       • HOST_INVITED_GUEST    — host invites a co-host

     SOS / Crisis:
       • VERIFIED_SOS_REQUEST  — SOS request is admin-verified
       • VERIFIED_CRISIS_REPORT— crisis report is admin-verified

     Commerce:
       • SUCCESSFUL_ESCROW_SELLER — escrow sale completed (seller)
       • SUCCESSFUL_ESCROW_BUYER  — escrow purchase completed (buyer)

     Referral / Cross-post:
       • SUCCESSFUL_REFERRAL   — referred user signs up
       • CROSS_POST            — user cross-posts to external platform

   REWARD SPLIT (premium actions)
   ──────────────────────────────
     60% → immediately withdrawable (added to empyBalance)
     40% → locked for 6 months (added to userLockedStakedBalance)

   POOL MANAGEMENT
   ───────────────
   • Daily budget = 90% of IMPACT_MINING_TOTAL_POOL ÷ (MINING_POOL_YEARS ×
     365.25 days) — see app-state.js for both constants.
   • Resets at midnight each calendar day
   • Stops issuing rewards once daily budget is exhausted

   REDUCED (2026-08-15 — token-allocation review)
   ───────────────────────────────────────────────
   Foundation allocation cut from 37,500,000 to 35,000,000 EMPY, meant to
   last 8–10 years rather than an unstated ~12. Two changes make that
   realistic instead of just a smaller number on paper:
     1. Every REWARD_TABLE amount below was cut drastically (roughly
        4–10x, action by action) — the aggregate daily budget is a hard
        ceiling either way, but at the OLD rates a handful of engaged
        users could exhaust an entire day's budget by themselves, which
        both feels stingy platform-wide and doesn't actually stretch the
        pool further (the ceiling already prevents overspend). Lower
        per-action rates mean the SAME daily budget now covers many more
        users' worth of genuine engagement each day.
     2. A new PER-USER daily cap (DAILY_USER_EMPY_CAP, app-state.js) is
        enforced below — previously the only throttle most actions had
        was the shared platform-wide daily budget, so nothing stopped one
        account from claiming most of a day's pool alone. See §2 for the
        per-user tracker.
   Ranking-tier rewards (app-wallet.js's RANKS, mirrored for display in
   app-profile.js) were cut by the same logic and are out of scope for
   this file, but are part of the same review — see those files' own
   change notes.

   LOAD ORDER
   ──────────
   Must come AFTER: firebase-init, app-state, app-helpers.

   DEPENDS ON
   ──────────
   • window.EmpState.*          — userState, impactMiningState, staking balances
   • window.showNotification    (app-helpers.js)
   • window.updateWalletUI      (app-wallet.js, called if available)
   • window.fbDb / _firebaseLoaded — background Firestore balance sync

   PUBLIC API
   ──────────
   window.rewardUserForAction(action, targetUserId?, dedupKey?)
       Same name/signature as before. As of the Option A partial unification
       (2026-07) this is a thin dispatcher: it fires an 'emp:reward' DOM
       event rather than paying out directly. The single listener on that
       event (§2b, near the bottom of §2) is the only code that ever calls
       the private payout function (_processReward). window._rewardUser and
       window._awardImpactMining go through the same dispatcher.
   window.getImpactMiningStats()     → { dailyBudget, dailySpent, remaining, pct }
   window.getReferralLink()          → string URL with ?ref= parameter
   window.handleCrossPost(platform, postData) → Promise resolves after share

   SECTION MAP
   ───────────
   §1  Reward table
   §2  rewardUserForAction()
   §3  getImpactMiningStats()
   §4  Referral link generator + tracker
   §5  Cross-post handler (share to external platform with SHARE_POST reward)
   §6  Download media handler (watermarked)
   §7  Realtime listener integration hooks
   §8  Bootstrap

   ============================================================================= */

(function empyreanImpactMiningModule() {
    'use strict';

    if (window._empyreanImpactMiningLoaded) {
        console.warn('[EmpImpact] Already loaded — skipping.');
        return;
    }
    window._empyreanImpactMiningLoaded = true;

    /* ── State helpers ── */
    function _S()   { return window.EmpState || {}; }
    /* Mirrors app-wallet.js's own _set() — used only by the server-
       reconciliation code below (after a claim-mining-reward response) to
       write the two locked-staking display fields through whichever of
       EmpState/window already holds them, same convention the existing
       PREMIUM_ACTIONS local-optimistic-update code below already uses
       inline for the same two fields. */
    function _set(key, val) {
        if (window.EmpState && window.EmpState[key] != null) window.EmpState[key] = val;
        else window[key] = val;
    }
    /* PRIORITY FIX: window.userState is the object the login/session-restore
       flow in app-fixes.js actually keeps live and pointed at the real user.
       window.EmpState.userState is frequently stale or never repointed after
       login, so preferring it first meant rewards were computed against the
       wrong balance and then stomped the real, visible one. window.userState
       now wins when both exist. */
    function _us()  { return window.userState || _S().userState || {}; }
    function _ims() { return _S().impactMiningState || window.impactMiningState || { dailyBudget: 0, dailySpent: 0, rankingPoolSpent: 0, lastReset: 0 }; }
    function _mu()  { return _S().mockUsers  || window.mockUsers  || {}; }

    function _isGuest() { var s = _S(); return s.isGuest != null ? s.isGuest : !!window.isGuest; }

    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type);
    }

    function _getConst(name, fallback) {
        var s = _S();
        return (s[name] != null) ? s[name] : (window[name] != null ? window[name] : fallback);
    }


    /* =========================================================================
       §1  REWARD TABLE
       EMPY amounts per action. Verified / creation actions use 60/40 split.
       Engagement actions go directly to withdrawable balance.

       MERGED (2026-07): the per-action rates, daily caps, and session dedup
       guard that used to live in app-fix-final.js §43 ("impactMiningEngine")
       now live here — that was a second, independent reward implementation
       running in parallel with this module (which wasn't even wired into
       index.html until now), plus a third copy inside app-fixes.js's own
       closure. A single click was sometimes being evaluated by more than one
       engine, each with its own rate table and its own idea of the user's
       balance — hence rewards that fired unpredictably and didn't reliably
       show up. §43's action names (LIKE_POST, LIKE_COMMENT, LIKE_SUBREPLY,
       RETWEET_COMMENT, QUOTE_TWEET, SUBREPLY, REPLY_POST, POST_CREATE) are
       added below so its call sites keep working unchanged; app-fix-final.js
       §43 and app-fixes.js's local copy have both been reduced to thin
       pass-throughs into rewardUserForAction() below.
       ========================================================================= */

    /* REDUCED (2026-08-15 — token-allocation review, see header note above).
       Every value below was cut ~4–10x from its prior amount. Comments show
       the old value for reference — remove once this has baked in for a
       while (kept for now per this codebase's own "supersede, don't
       delete" convention for anything a reviewer might want to diff
       against). */
    /* UPDATED (2026-08-15 — official launch forecast): the actions below
       marked "FORECAST" now use the exact values from the launch reward-
       allocation forecast (server.js's SELF_MINING_ACTIONS/
       RECEIVE_MINING_ACTIONS mirror these exactly — see that file's own
       comment). Everything else was NOT part of the forecast list and
       stays at its prior (already-reduced, provisional) rate pending a
       future launch decision — flagged individually below. */
    var REWARD_TABLE = {
        /* SOS / Crisis — highest value (verified by admin) — FORECAST */
        VERIFIED_CRISIS_REPORT:  0.025,  /* was 12 (provisional) / 50 (original) */
        VERIFIED_SOS_REQUEST:    0.015,  /* was 6 (provisional) / 25 (original) */

        /* Commerce — FORECAST */
        SUCCESSFUL_ESCROW_SELLER: 0.0075, /* was 4 (provisional) / 15 (original) */
        SUCCESSFUL_ESCROW_BUYER:  0.005,  /* was 1.5 (provisional) / 5 (original) */

        /* Content creation — FORECAST (CREATE_REEL, CREATE_POST) */
        CREATE_REEL:              0.004,  /* was 0.4 (provisional) / 2.0 (original) */
        CREATE_POST:              0.0025, /* was 0.2 (provisional) / 1.0 (original) */
        POST_CREATE:              0.0025, /* alias, §43's generic post-create wrapper — kept equal to CREATE_POST */
        PUBLISH_NEWS:             2.5,    /* not in forecast — provisional, unchanged */

        /* Live streaming — not in forecast, provisional, unchanged */
        LIVE_STREAM_INTERVAL:     0.25,
        GUEST_JOINED_LIVE:        1,
        HOST_INVITED_GUEST:       0.4,

        /* Referral & cross-post — FORECAST (SUCCESSFUL_REFERRAL) */
        SUCCESSFUL_REFERRAL:      1,      /* was 5 (provisional) / 20 (original) */
        CROSS_POST:               0.2,    /* not in forecast — provisional, unchanged */

        /* RECEIVE_COMMENT / RECEIVE_LIKE — RETIRED (2026-08-15, engagement-
           attribution fix). This "combined Like/Comment" forecast rate is
           for the ENGAGEMENT ACTION itself, not for receiving one — see the
           RETIRED note in the header comment above. The 0.0005 rate now
           lives on ENGAGE_COMMENT/ENGAGE_LIKE below, where it correctly
           pays the person doing the liking/commenting. Receiving a like or
           comment no longer credits EMPY from this file or the mining pool
           at all — that side of it is already covered by
           app-monetization.js's engagement-based creator payout tier. */

        /* Social engagement (sent) — FORECAST, combined "Receive a
           Like/Comment" rate from the launch forecast, now correctly
           attributed to the person DOING the liking/commenting rather than
           the post/comment owner (see RETIRED note above). */
        ENGAGE_COMMENT:           0.0005, /* was 0.01 (mis-attributed provisional rate) */
        ENGAGE_LIKE:              0.0005, /* was 0.004 (mis-attributed provisional rate) */
        SHARE_POST:               0.001,  /* was 0.1 (provisional) / 0.5 (original) — "Share/Retweet" */
        RETWEET_POST:             0.001,  /* was 0.1 (provisional) / 0.5 (original) — "Share/Retweet" */
        SEND_GIFT:                0.02,   /* not in forecast — provisional, unchanged */

        /* Thread / comment-level engagement — not in forecast, provisional, unchanged */
        LIKE_POST:                0.02,
        LIKE_COMMENT:             0.01,
        LIKE_SUBREPLY:            0.004,
        RETWEET_COMMENT:          0.02,
        QUOTE_TWEET:              0.06,
        REPLY_POST:               0.05,
        SUBREPLY:                 0.02,

        /* Download — not in forecast, provisional, unchanged */
        DOWNLOAD_MEDIA:           0.01
    };

    /**
     * Actions that use the 60/40 locked/withdrawable split.
     * Everything else goes directly to withdrawable balance.
     */
    // FIX (2026-07-31 — vetting pass): RECEIVE_COMMENT/RECEIVE_LIKE removed
    // from this set. They're cross-user rewards (the post AUTHOR is
    // rewarded for someone ELSE'S like/comment) and are correctly absent
    // from server.js's PREMIUM_MINING_ACTIONS/SELF_MINING_ACTIONS entirely —
    // neither one is a real self-mining premium action. Their only reachable
    // path here was an edge case: liking/commenting on your OWN post makes
    // recipient.id === us.id below, which used to wrongly take the 60/40
    // split branch and show a phantom balance/locked-staking bump that then
    // failed to persist once firebase-rules.js's ban on self-increasing
    // empyBalance shipped (self-corrected on the next sync, but a real,
    // avoidable glitch until then). This set must stay a subset of the 9
    // actual server-side PREMIUM_MINING_ACTIONS.
    var PREMIUM_ACTIONS = new Set([
        'VERIFIED_CRISIS_REPORT', 'VERIFIED_SOS_REQUEST',
        'CREATE_REEL', 'CREATE_POST', 'PUBLISH_NEWS',
        'LIVE_STREAM_INTERVAL',
        'SUCCESSFUL_REFERRAL',
        'GUEST_JOINED_LIVE', 'HOST_INVITED_GUEST'
    ]);

    /**
     * Per-action daily caps — merged from §43. Actions not listed here have
     * no per-action cap; they're still throttled by the overall daily pool
     * budget further down.
     */
    var DAILY_CAPS = {
        LIKE_POST:       50,
        LIKE_COMMENT:    50,
        LIKE_SUBREPLY:   30,
        RETWEET_POST:    20,
        RETWEET_COMMENT: 20,
        QUOTE_TWEET:     10,
        SHARE_POST:      15,
        REPLY_POST:      20,
        SUBREPLY:        20,
        POST_CREATE:      5,
        ENGAGE_LIKE:     50,
        ENGAGE_COMMENT:  20
    };

    /* ── Daily per-action counts (localStorage, resets each calendar day) —
       merged from §43 ── */
    var _CAP_STORE_KEY = 'emp_mining_';
    function _todayKey() {
        var d = new Date();
        return _CAP_STORE_KEY + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    function _loadCounts() {
        try { return JSON.parse(localStorage.getItem(_todayKey()) || '{}'); } catch (e) { return {}; }
    }
    function _saveCounts(c) {
        try { localStorage.setItem(_todayKey(), JSON.stringify(c)); } catch (e) {}
    }

    /**
     * Per-USER daily earning cap — NEW (2026-08-15). Independent of both
     * the per-action DAILY_CAPS above and the aggregate pool budget in §2.
     * Previously the only throttle on most actions was the shared,
     * platform-wide daily budget — nothing stopped a single account from
     * claiming most of a day's pool by itself before anyone else got a
     * turn. This bounds how much any ONE recipient can earn per calendar
     * day, regardless of which action(s) they use to get there.
     *
     * Tracked in localStorage the same way DAILY_CAPS' per-action counts
     * already are (device-local, resets at midnight) — this is a client-
     * side guard, same posture as everything else in this file's daily-cap
     * system; server.js's own claim-mining-reward / claim-rank-reward
     * endpoints should enforce the same ceiling server-side for the
     * actions they already gate (out of scope here — that file wasn't
     * part of this change).
     */
    var _USER_CAP_STORE_PREFIX = 'emp_mining_user_';
    function _userCapTodayKey(uid) {
        var d = new Date();
        return _USER_CAP_STORE_PREFIX + uid + '_' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    function _loadUserSpentToday(uid) {
        try { return parseFloat(localStorage.getItem(_userCapTodayKey(uid))) || 0; } catch (e) { return 0; }
    }
    function _saveUserSpentToday(uid, amount) {
        try { localStorage.setItem(_userCapTodayKey(uid), String(amount)); } catch (e) {}
    }

    /* ── Session-only dedup guard — merged from §43. Same action+dedupKey
       can't pay twice in one page session (e.g. two handlers firing off the
       same click). Only enforced when a dedupKey is explicitly passed. ── */
    var _sessionGuard = {};
    function _guardKey(action, dedupKey) { return action + '|' + dedupKey; }
    function _isDuplicate(action, dedupKey) {
        if (!dedupKey) return false;
        return !!_sessionGuard[_guardKey(action, dedupKey)];
    }
    function _markSeen(action, dedupKey) {
        if (!dedupKey) return;
        _sessionGuard[_guardKey(action, dedupKey)] = true;
    }


    /* =========================================================================
       §2  rewardUserForAction
       Central reward dispatcher. Call this from any user-action handler.
       @param {string} action            — key from REWARD_TABLE
       @param {string|null} targetUserId — optional: reward a different user
                                            (e.g. the author of a liked post)
       @param {string|null} dedupKey     — optional: per-content id (e.g. a
                                            postId/commentId) used to (a)
                                            block the same action from paying
                                            twice for the same content in one
                                            session, and (b) count against
                                            that action's daily cap, if any.
       ========================================================================= */

    function _processReward(action, targetUserId, dedupKey) {
        if (_isGuest()) return;

        /* ── Per-content session dedup ── */
        if (_isDuplicate(action, dedupKey)) return;

        /* ── Per-action daily cap ── */
        var cap = DAILY_CAPS[action];
        if (cap != null) {
            var capCounts = _loadCounts();
            if ((capCounts[action] || 0) >= cap) {
                _notify('Daily ' + action.replace(/_/g, ' ').toLowerCase() + ' mining cap reached.', 'info');
                return;
            }
        }

        var ims = _ims();

        /* ── Daily reset check (overall pool) ── */
        var today = new Date().setHours(0, 0, 0, 0);
        if (today > ims.lastReset) {
            ims.dailySpent  = 0;
            ims.lastReset   = today;
        }

        /* ── Budget guard (overall pool) ── */
        if (ims.dailySpent >= ims.dailyBudget) return;

        var rewardAmount = REWARD_TABLE[action] || 0;
        if (rewardAmount === 0) return;
        if (ims.dailySpent + rewardAmount > ims.dailyBudget) return;

        /* ── Determine recipient (moved up so the per-user cap below can
           check the actual person the reward is going to, not just the
           acting user) ── */
        var mu = _mu();
        var recipient = (targetUserId && mu[targetUserId]) ? mu[targetUserId] : _us();
        var us        = _us();
        if (!recipient.empyBalance) recipient.empyBalance = 0;

        /* ── Per-user daily cap (NEW 2026-08-15) ──
           Bounds total EMPY any one recipient can earn today, regardless
           of action — see DAILY_USER_EMPY_CAP's own comment in
           app-state.js for why this was added alongside the rate cuts. */
        var recipientId = recipient.id || targetUserId;
        if (recipientId) {
            var userCap = _getConst('DAILY_USER_EMPY_CAP', 15);
            var userSpentToday = _loadUserSpentToday(recipientId);
            if (userSpentToday >= userCap) {
                if (recipient.id === us.id) {
                    _notify('You\u2019ve reached today\u2019s mining reward limit — more available tomorrow!', 'info');
                }
                return;
            }
            if (userSpentToday + rewardAmount > userCap) return;
        }

        /* Both guards passed — mark seen + bump the per-action daily count */
        _markSeen(action, dedupKey);
        if (cap != null) {
            var newCounts = _loadCounts();
            newCounts[action] = (newCounts[action] || 0) + 1;
            _saveCounts(newCounts);
        }
        if (recipientId) {
            _saveUserSpentToday(recipientId, _loadUserSpentToday(recipientId) + rewardAmount);
        }

        /* ── Apply reward ── */
        var selfDelta = 0; /* amount actually added to the ACTING user's own withdrawable balance this call */
        if (PREMIUM_ACTIONS.has(action) && recipient.id === us.id) {
            /* 60/40 split — only for the acting user themselves */
            var STAKING_LOCK_DURATION = _getConst('STAKING_LOCK_DURATION', 6 * 30 * 24 * 60 * 60 * 1000);
            var lockedPortion      = rewardAmount * 0.40;
            var withdrawablePortion= rewardAmount * 0.60;
            selfDelta = withdrawablePortion;

            /* Update staking state */
            if (_S().userLockedStakedBalance != null) {
                _S().userLockedStakedBalance = (_S().userLockedStakedBalance || 0) + lockedPortion;
            } else {
                window.userLockedStakedBalance = (window.userLockedStakedBalance || 0) + lockedPortion;
            }
            var lockEnd = Date.now() + STAKING_LOCK_DURATION;
            if (_S().userLockedStakingEndTime != null) {
                _S().userLockedStakingEndTime = lockEnd;
            } else {
                window.userLockedStakingEndTime = lockEnd;
            }

            recipient.empyBalance += withdrawablePortion;

            /* Append to rewards history */
            var history = _S().userClaimedRewardsHistory || window.userClaimedRewardsHistory || [];
            history.push({
                type: 'Earned (60% claimable)', amount: withdrawablePortion,
                date: new Date().toLocaleDateString()
            });
            history.push({
                type: 'Earned (40% locked)', amount: lockedPortion,
                date: new Date().toLocaleDateString(),
                lockExpiry: new Date(lockEnd).toLocaleDateString()
            });

            _notify(
                '+' + withdrawablePortion.toFixed(2) + ' EMPY (60% claimable), '
                + lockedPortion.toFixed(2) + ' EMPY locked for 6 months!',
                'success'
            );
        } else {
            /* Direct to withdrawable */
            recipient.empyBalance += rewardAmount;
            if (recipient.id === us.id) {
                selfDelta = rewardAmount;
                _notify('+' + rewardAmount.toFixed(2) + ' EMPY for your contribution!', 'success');
            } else {
                _notify('+' + rewardAmount.toFixed(2) + ' EMPY for their contribution!', 'success');
            }
        }

        /* ── Update pool spend ── */
        ims.dailySpent = (ims.dailySpent || 0) + rewardAmount;

        /* ── Refresh wallet UI ── */
        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

        /* ── Persist balance ──
           FIX (2026-07-31 — token-ecosystem security review): this used to
           write empyBalance straight to Firestore via the client SDK for
           EVERY action in REWARD_TABLE, self-target or not — the general
           owner-write rule let that value be anything, since a Firestore
           rule has no way to check a write was actually a legitimate,
           just-performed action. For every SELF-target action that
           server.js's SELF_MINING_ACTIONS table covers (all 14 of them —
           see below), this now goes through /api/wallet/claim-mining-reward
           instead, which looks the reward up from its OWN table by action
           name, enforces the shared daily pool budget server-side, and —
           as of the split-credit follow-up — also does the 60/40
           withdrawable/locked split server-side for the 9 PREMIUM actions,
           depositing the 40% into the same server-authoritative
           lockedStakedBalance/lockedStakingEndTime fields real staking
           uses (see server.js's computeStakingAccrual). The
           client-computed rewardAmount/selfDelta above are never trusted
           for the actual credit, only used for the optimistic local/UI
           update; on success we resync empyBalance AND the locked-staking
           display fields to the server's authoritative response.
           ENGAGE_LIKE/ENGAGE_COMMENT are SELF-target (the person doing the
           liking/commenting is the recipient), so as of the RETIRED note
           above they're added to SELF_MINING_SERVER_ACTIONS below and now
           go through the same secure server claim endpoint as every other
           self-target action, instead of the raw client Firestore
           increment write the final else-branch below used to be their
           only path through.
           RECEIVE_LIKE/RECEIVE_COMMENT (crediting a DIFFERENT user — the
           post/comment OWNER) are RETIRED as of 2026-08-15 — see the
           header comment's RETIRED note. server.js no longer runs its
           like/comment Firestore listener for these either. Neither this
           file nor the server writes any EMPY for receiving a like/comment
           any more; that's covered by app-monetization.js's engagement-
           based payout tier instead. */
        var SELF_MINING_SERVER_ACTIONS = {
            SUCCESSFUL_ESCROW_SELLER: 1, SUCCESSFUL_ESCROW_BUYER: 1,
            SHARE_POST: 1, RETWEET_POST: 1, SEND_GIFT: 1,
            VERIFIED_CRISIS_REPORT: 1, VERIFIED_SOS_REQUEST: 1, CREATE_REEL: 1,
            CREATE_POST: 1, PUBLISH_NEWS: 1, LIVE_STREAM_INTERVAL: 1,
            SUCCESSFUL_REFERRAL: 1, GUEST_JOINED_LIVE: 1, HOST_INVITED_GUEST: 1,
            ENGAGE_LIKE: 1, ENGAGE_COMMENT: 1
        };
        /* RETIRED (2026-08-15): RECEIVE_LIKE/RECEIVE_COMMENT used to be
           credited purely by server.js observing Firestore, with no client
           write of any kind for either action. Both actions are gone from
           REWARD_TABLE entirely now (see §1), so rewardAmount resolves to
           0 and _processReward already returns before reaching this point
           for either one — this set is kept empty (rather than deleted
           outright) as a explicit, named belt-and-suspenders: if either
           action ever came back to REWARD_TABLE by mistake, it still could
           not fall through to a client-side write below. */
        var SERVER_OBSERVED_ACTIONS = {};

        if (SERVER_OBSERVED_ACTIONS[action]) {
            /* Dead branch now that RECEIVE_LIKE/RECEIVE_COMMENT are
               retired — see the comment above SERVER_OBSERVED_ACTIONS. */
        } else if (!_isGuest() && us.id && recipient.id === us.id && selfDelta > 0 && SELF_MINING_SERVER_ACTIONS[action]) {
            fetch(window._empApiBase() + '/api/wallet/claim-mining-reward', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: us.id, action: action })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (data && typeof data.newBalance === 'number') {
                    recipient.empyBalance = data.newBalance;
                    if (typeof data.lockedStakedBalance === 'number') _set('userLockedStakedBalance', data.lockedStakedBalance);
                    if (typeof data.lockedStakingEndTime === 'number') _set('userLockedStakingEndTime', data.lockedStakingEndTime);
                    if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
                } else if (!data || data.error) {
                    console.warn('[EmpImpact] server declined the mining-reward claim for ' + action + ':', data && data.error);
                }
            }).catch(function (err) {
                console.warn('[EmpImpact] mining-reward claim request failed (will still show locally until next sync):', err && err.message);
            });
        } else {
            /* MERGED from §43: prefer FieldValue.increment for concurrency
               safety — writing the absolute computed balance (the old
               behavior, kept below as a fallback) can clobber a write made
               by another concurrent session/tab in between our read and
               write. This path now only runs for actions outside BOTH
               SELF_MINING_SERVER_ACTIONS and SERVER_OBSERVED_ACTIONS —
               i.e. the remaining smaller/self-target engagement actions
               (LIKE_POST, DOWNLOAD_MEDIA, etc. — ENGAGE_LIKE/ENGAGE_COMMENT
               were migrated to the server-authoritative branch above as of
               the RETIRED fix, see its note) that haven't been migrated to
               a server-authoritative path yet. Guarded again here (not
               just via the branch above) so a future refactor of this
               if/else can't accidentally reintroduce a direct write for
               RECEIVE_LIKE/RECEIVE_COMMENT, should either ever come back. */
            if (SERVER_OBSERVED_ACTIONS[action]) {
                /* Belt-and-suspenders — see the branch above. Never write. */
            } else
            try {
                if (!_isGuest() && us.id && window.fbDb && window._firebaseLoaded) {
                    var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
                    var updateObj;
                    if (fv && typeof fv.increment === 'function' && selfDelta > 0) {
                        updateObj = { empyBalance: fv.increment(selfDelta) };
                    } else {
                        updateObj = { empyBalance: us.empyBalance };
                    }
                    window.fbDb.collection('users').doc(us.id)
                        .update(updateObj)
                        .catch(function () {
                            try {
                                window.fbDb.collection('users').doc(us.id)
                                    .set({ empyBalance: us.empyBalance }, { merge: true })
                                    .catch(function () {});
                            } catch (e2) {}
                        });
                }
            } catch (e) {}
        }
    }
    /* =========================================================================
       §2b  PARTIAL UNIFICATION (Option A)
       ─────────────────────────────────────────────────────────────────────
       The click/engagement handlers scattered across app-fixes.js,
       app-fix-final.js and app-patch-v2.js still each independently decide
       WHEN a reward-worthy action happened. That trigger logic hasn't moved
       (see Option B for the full physical move). What HAS changed here is
       WHO gets to actually pay out: every one of those call sites already
       funnels through window.rewardUserForAction / window._rewardUser /
       window._awardImpactMining, so instead of each of those aliases calling
       _processReward directly, they now all just dispatch a single
       'emp:reward' DOM event with the same (action, targetUserId, dedupKey)
       payload. The listener below is the ONLY code in the app that ever
       calls _processReward — i.e. the only code that ever decides to pay
       out. This is a decoupling seam, not a relocation: existing callers
       keep their exact same function names/signatures, nothing at any
       call site needed to change.
       ========================================================================= */
    function _dispatchRewardEvent(action, targetUserId, dedupKey) {
        try {
            document.dispatchEvent(new CustomEvent('emp:reward', {
                detail: { action: action, targetUserId: targetUserId || null, dedupKey: dedupKey || '' }
            }));
        } catch (e) {
            /* CustomEvent unsupported / document unavailable — fall back to
               calling the payout logic directly so a reward is never silently
               dropped. */
            _processReward(action, targetUserId, dedupKey);
        }
    }

    /* =========================================================================
       §2c  TRIGGER MANIFEST + COLLISION GUARD
       ─────────────────────────────────────────────────────────────────────
       This is the "unify without relocating" version of Option B: rather
       than physically moving DOM click-handling code (retweet picker,
       reply composer, live-stream state, escrow flow, etc.) out of the
       files it's entangled with — risky to do blind, across ~1.3MB of code,
       with no browser here to click-test each path afterward — every known
       UI trigger is catalogued in ONE place, and a runtime guard now warns
       if two different call sites ever fire the same action for what looks
       like the same real-world event. That's the actual failure mode that
       matters (see the RETWEET_POST case below, already found and fixed
       once by hand); this guard means the next one gets caught in the
       console instead of silently mispaying someone.

       Audited 2026-07 across app-fixes.js, app-fix-final.js, app-patch-v2.js.
       Update this table whenever a new reward trigger is added anywhere.

       action                 | file : location                              | dedup key basis
       -----------------------|-----------------------------------------------|-------------------
       SEND_GIFT              | app-fixes.js:262  (gift-send flow)             | none
       RECEIVE_COMMENT        | app-fixes.js:263  (gift comment)               | none  ⚠ RETIRED 2026-08-15 — call site still fires this, now a harmless no-op (see header RETIRED note)
       RECEIVE_COMMENT        | app-fixes.js:7655 (normal comment, top-level)  | postElement userId  ⚠ RETIRED 2026-08-15 — same as above
       SHARE_POST             | app-fixes.js:3723 (live-stream share)          | none
       SHARE_POST             | app-fix-final.js:3073 (§43 feed share)         | 'sh-'+postId
       SHARE_POST             | app-fix-final.js:3104 (§43 comment share)      | 'cs-'+commentId
       SHARE_POST             | app-fix-final.js:3584 (§45 feed share)         | 'sh-'+postId  ⚠ see below
       LIVE_STREAM_INTERVAL   | app-fixes.js:4816 (live join path A)           | interval tick, no key
       LIVE_STREAM_INTERVAL   | app-fixes.js:8530 (live join path B)           | interval tick, no key
                               ⚠ two separate "start live" code paths each arm liveStreamData.rewardInterval;
                                 harmless today only because each clears the prior handle before arming a new
                                 one — if that shared-handle assumption ever breaks, two intervals could run.
       SUCCESSFUL_REFERRAL    | app-impactmining.js §4 _checkAndRewardReferrer | referrerId from ?ref= — CANONICAL, FIXED 2026-07
                               ⚠ RESOLVED (2026-07): this listened for 'empyrean-user-ready', an event
                                 never dispatched anywhere in the codebase — so it never actually ran. The
                                 two direct rewardUserForAction('SUCCESSFUL_REFERRAL') calls that used to
                                 live in app-fixes.js's signup flows (Google sign-in + email/password) were
                                 the only thing paying out referrals, and they paid the wrong person (no
                                 target passed = rewards the current session, not the referrer). Now fixed
                                 to listen for 'empyrean-init-done' (which is dispatched, once, at the end
                                 of every initializeApp() run) and both dead-target call sites removed.
       RETWEET_POST            | app-fix-final.js:3029 (thread action bar)     | postId
       RETWEET_POST            | app-fixes.js:6496 (feed picker confirm)       | 'rt-'+originalPostId
       RETWEET_POST            | app-fix-final.js:415 (reel repost)            | none
                               ⚠ HISTORICAL BUG (fixed): the feed retweet button used to award here too,
                                 double-paying a confirmed retweet and single-paying a cancelled one. Now a
                                 documented no-op (app-fix-final.js:3063) that defers to the picker-confirm
                                 site. This is the case the guard below is built to catch automatically next time.
       LIKE_POST               | app-fix-final.js:3027/3043 (§43 thread+feed)  | postId / 'fl-'+Date.now()
       LIKE_POST               | app-fix-final.js:3531 (§45 feed like)         | postId
                               ⚠ §43 and §45 are BOTH capture-phase document click listeners that match
                                 `.action-btn.like-btn` on a normal feed card. Both currently fire on the
                                 same click. They don't double-pay today only because both derive the exact
                                 same dedup key (card.dataset.postId) so the session-dedup guard silently
                                 absorbs the second call. This is fragile — if either key formula changes
                                 independently, this becomes a live double-pay. The guard below will now flag
                                 it immediately if that happens.
       CREATE_POST              | app-fixes.js:6618, 8371, 8947                | none
       CREATE_REEL              | app-fixes.js:9028                            | none
       PUBLISH_NEWS             | app-fixes.js:9090                            | none
       DOWNLOAD_MEDIA           | app-fixes.js:6968, app-impactmining.js §6    | varies
       SUCCESSFUL_ESCROW_BUYER  | app-fixes.js:9209                            | none
       ENGAGE_LIKE              | app-fix-final.js:356 (reel), app-fixes.js:7152 (feed) | none — separate content types, not a collision
       ENGAGE_COMMENT           | app-fixes.js:7644, 7654                      | none
       POST_CREATE (removed)    | was: app-fix-final.js _wrapPostCreate        | n/a
                               ⚠ REMOVED (2026-07): wrapped window.createPost / submitPost / addPost /
                                 publishPost, but none of those names exist anywhere in this codebase
                                 (confirmed via search) — the actual post-submit code is an inline handler,
                                 not a function under any of those names, so this could never fire. Deleted
                                 the wrapper and its init-time call sites. REWARD_TABLE/DAILY_CAPS entries
                                 for POST_CREATE left in place (harmless if unused) in case a future post-
                                 creation refactor wants to wire it back up under its real function name.
       ========================================================================= */

    var _recentFires = {}; /* action+dedupKey -> {ts, stack} for the collision guard, cleared lazily */

    document.addEventListener('emp:reward', function (e) {
        var d = (e && e.detail) || {};
        if (d.dedupKey) {
            var guardKey = d.action + '|' + d.dedupKey;
            var now = Date.now();
            var prev = _recentFires[guardKey];
            if (prev && (now - prev.ts) < 800) {
                console.warn(
                    '[EmpImpact] ⚠ Possible duplicate reward trigger for "' + d.action +
                    '" (key: ' + d.dedupKey + ') fired twice within ' + (now - prev.ts) +
                    'ms from two different call sites. First call stack:\n' + prev.stack +
                    '\nSecond call stack:\n' + (new Error().stack || '(unavailable)')
                );
            }
            _recentFires[guardKey] = { ts: now, stack: (new Error().stack || '(unavailable)') };
        }
        _processReward(d.action, d.targetUserId, d.dedupKey);
    });

    window.rewardUserForAction = _dispatchRewardEvent;

    /* ── Backward-compat aliases for §43's external API (app-fix-final.js
       §6 reel wrapper, its like/share handlers, app-patch-v2.js's reply
       handler) — both now just forward straight into the dispatcher above,
       so they too go through the single listener rather than paying out
       directly. ── */
    window._rewardUser = function (actionType, targetId) {
        _dispatchRewardEvent(actionType, null, targetId || '');
    };
    window._awardImpactMining = function (actionType, targetId) {
        _dispatchRewardEvent(actionType, null, targetId || '');
    };


    /* =========================================================================
       §3  getImpactMiningStats
       Returns a snapshot of the current daily budget status.
       ========================================================================= */

    function getImpactMiningStats() {
        var ims = _ims();
        var budget    = ims.dailyBudget || 0;
        var spent     = ims.dailySpent  || 0;
        var remaining = Math.max(0, budget - spent);
        var pct       = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

        /* Per-user cap snapshot (NEW 2026-08-15) — for the current logged-in
           user only, so a wallet/mining-tab UI can show "X/15 EMPY earned
           today" alongside the platform-wide numbers above. */
        var us = _us();
        var userCap = _getConst('DAILY_USER_EMPY_CAP', 15);
        var userSpent = (us && us.id) ? _loadUserSpentToday(us.id) : 0;

        return {
            dailyBudget: budget,
            dailySpent:  spent,
            remaining:   remaining,
            pct:         pct,
            userDailyCap:   userCap,
            userDailySpent: userSpent,
            userDailyRemaining: Math.max(0, userCap - userSpent)
        };
    }
    window.getImpactMiningStats = getImpactMiningStats;


    /* =========================================================================
       §4  REFERRAL LINK GENERATOR + TRACKER
       Generates a referral URL containing the current user's ID.
       Listens for the signup success event and fires SUCCESSFUL_REFERRAL reward
       when a referred user completes registration.
       ========================================================================= */

    function getReferralLink() {
        var us = _us();
        if (!us.id || _isGuest()) return window.location.href;
        var base = window.location.href.split('?')[0].split('#')[0];
        return base + '?ref=' + encodeURIComponent(us.id);
    }
    window.getReferralLink = getReferralLink;

    /**
     * Call this after a new user successfully signs up via a referral link.
     * Reads ?ref= from the URL and rewards the referrer.
     */
    function _checkAndRewardReferrer() {
        try {
            var params   = new URLSearchParams(window.location.search);
            var referrerId = params.get('ref');
            if (!referrerId) return;
            /* Don't reward self-referral */
            var us = _us();
            if (referrerId === us.id) return;
            /* Fire referral reward for referrer */
            _processReward('SUCCESSFUL_REFERRAL', referrerId);
            /* Clean the URL */
            try {
                var cleanUrl = window.location.href.replace(/[?&]ref=[^&]+/, '').replace(/[?&]$/, '');
                window.history.replaceState(null, '', cleanUrl);
            } catch (e) {}
        } catch (e) {}
    }
    /* Hook into app-ready event.
       FIX (2026-07): this used to listen for 'empyrean-user-ready', which is
       never dispatched anywhere in the codebase (confirmed via full-codebase
       search) — so this tracker never ran, and the two direct
       rewardUserForAction('SUCCESSFUL_REFERRAL') calls that used to sit in
       app-fixes.js's signup flow (wrong-target: they rewarded whoever the
       CURRENT session was, not the referrer) were the only thing actually
       paying out referrals. Those have been removed now that this listens
       for 'empyrean-init-done', which IS dispatched once at the end of
       every initializeApp() run (app-fixes.js) — login, signup, and guest
       alike. Safe to fire on every init: this only pays out when a
       '?ref=' param is present in the URL, and it strips that param after
       paying once. */
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(_checkAndRewardReferrer, 800);
    });


    /* =========================================================================
       §5  CROSS-POST HANDLER
       Shares content to an external platform (Web Share API / clipboard).
       Fires SHARE_POST reward and optionally CROSS_POST for verified external
       sharing to specific platforms.
       @param {string} platform   — 'twitter'|'whatsapp'|'telegram'|'copy'|'native'
       @param {Object} postData   — { title, text, url }
       @returns {Promise}
       ========================================================================= */

    function handleCrossPost(platform, postData) {
        var data = postData || {};
        var url  = data.url  || window.location.href;
        var text = data.text || '';
        var title= data.title|| 'Check this out on Empyrean';

        var platformUrls = {
            twitter:  'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url),
            whatsapp: 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url),
            telegram: 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text),
            facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)
        };

        var promise;

        if (platform === 'copy') {
            promise = (navigator.clipboard
                ? navigator.clipboard.writeText(url).then(function () {
                    if (typeof window.showNotification === 'function') window.showNotification('Link copied to clipboard!', 'success');
                })
                : Promise.resolve()).catch(function () {
                    if (typeof window.showNotification === 'function') window.showNotification('Could not copy link.', 'error');
                });
        } else if (platform === 'native' && navigator.share) {
            promise = navigator.share({ title: title, text: text, url: url }).catch(function () {});
        } else if (platformUrls[platform]) {
            window.open(platformUrls[platform], '_blank', 'noopener,width=600,height=450');
            promise = Promise.resolve();
        } else if (navigator.share) {
            promise = navigator.share({ title: title, text: text, url: url }).catch(function () {});
        } else {
            /* Fallback: clipboard */
            if (navigator.clipboard) {
                promise = navigator.clipboard.writeText(url).then(function () {
                    if (typeof window.showNotification === 'function') window.showNotification('Link copied!', 'success');
                });
            } else {
                promise = Promise.resolve();
                if (typeof window.showNotification === 'function') window.showNotification('Sharing not available on this browser.', 'info');
            }
        }

        /* Fire reward */
        _processReward('SHARE_POST');
        if (platform && platform !== 'copy' && platform !== 'native') {
            _processReward('CROSS_POST');
        }

        if (typeof window.updateLiveInteractionCount === 'function') {
            window.updateLiveInteractionCount('share');
        }

        return promise || Promise.resolve();
    }
    window.handleCrossPost = handleCrossPost;

    /* Expose legacy shareContent wrapper for backward compat */
    if (!window.shareContent) {
        window.shareContent = function (shareData) { return handleCrossPost('native', shareData); };
    }


    /* =========================================================================
       §6  DOWNLOAD MEDIA HANDLER
       Provides watermarked image download and direct video download.
       Fires DOWNLOAD_MEDIA reward on success.
       ========================================================================= */

    function downloadPostMedia(container) {
        if (!container) {
            if (typeof window.showNotification === 'function') window.showNotification('No content found.', 'info');
            return;
        }
        // FIX (2026-07-29 — same scope bug as app-fixes.js's active download
        // path): scanning the whole card picks up the author's avatar <img>
        // in .story-header alongside the actual post photo. Scope to
        // .story-media-container (app-feed.js) when present so this stays
        // correct if it's ever wired back up.
        var mediaScope = container.querySelector('.story-media-container') || container;
        var mediaEls = mediaScope.querySelectorAll('img[src], video[src]');
        var urls = [];
        mediaEls.forEach(function (el) {
            var url = el.src || el.dataset.src;
            if (url && !url.startsWith('data:') && !url.startsWith('blob:') && !urls.some(function (u) { return u.url === url; })) {
                urls.push({ url: url, type: el.tagName === 'VIDEO' ? 'video' : 'image' });
            }
        });
        if (container.dataset.mediaUrl) {
            var u = container.dataset.mediaUrl;
            if (u && !u.startsWith('blob:')) {
                urls.push({ url: u, type: /\.(mp4|webm|mov)/i.test(u) ? 'video' : 'image' });
            }
        }

        if (urls.length === 0) {
            if (typeof window.showNotification === 'function') window.showNotification('No downloadable media found in this post.', 'info');
            return;
        }

        if (typeof window.showNotification === 'function') {
            window.showNotification('⬇ Preparing ' + urls.length + ' file' + (urls.length > 1 ? 's' : '') + ' with Empyrean watermark…', 'info');
        }

        urls.forEach(function (item) {
            var ts = Date.now();
            if (item.type === 'image') {
                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () {
                    try {
                        var canvas = document.createElement('canvas');
                        canvas.width  = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        var ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        /* Watermark bar */
                        var barH = Math.max(36, canvas.height * 0.055);
                        ctx.fillStyle = 'rgba(10,14,39,0.72)';
                        ctx.fillRect(0, canvas.height - barH, canvas.width, barH);

                        /* Logo circle */
                        var cx = 22, cy = canvas.height - barH / 2;
                        ctx.beginPath();
                        ctx.arc(cx, cy, barH * 0.38, 0, Math.PI * 2);
                        ctx.fillStyle = '#F5C518'; ctx.fill();
                        ctx.fillStyle = '#0A0E27';
                        ctx.font = 'bold ' + Math.round(barH * 0.42) + 'px Arial';
                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        ctx.fillText('E', cx, cy);

                        /* Brand text */
                        ctx.fillStyle = 'white';
                        ctx.font = 'bold ' + Math.round(barH * 0.44) + 'px Arial';
                        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                        ctx.fillText('Empyrean', cx + barH * 0.52, cy);

                        /* URL */
                        ctx.fillStyle = 'rgba(255,255,255,0.5)';
                        ctx.font = Math.round(barH * 0.32) + 'px Arial';
                        ctx.textAlign = 'right';
                        ctx.fillText('empyrean.app', canvas.width - 10, cy);

                        canvas.toBlob(function (blob) {
                            if (!blob) return;
                            var blobUrl = URL.createObjectURL(blob);
                            var a = document.createElement('a');
                            a.href = blobUrl;
                            a.download = 'empyrean-' + ts + '.jpg';
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 5000);
                            _processReward('DOWNLOAD_MEDIA');
                        }, 'image/jpeg', 0.92);
                    } catch (err) {
                        /* CORS fallback: open in new tab */
                        window.open(item.url, '_blank', 'noopener');
                        _processReward('DOWNLOAD_MEDIA');
                    }
                };
                img.onerror = function () { window.open(item.url, '_blank', 'noopener'); };
                img.src = item.url;
            } else {
                /* Video — direct download */
                var a = document.createElement('a');
                a.href     = item.url;
                a.download = 'empyrean-video-' + ts + '.mp4';
                a.target   = '_blank';
                a.rel      = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                _processReward('DOWNLOAD_MEDIA');
            }
        });
    }
    window.downloadPostMedia = downloadPostMedia;


    /* =========================================================================
       §7  EVENT DELEGATION — download button click
       Intercepts .download-media-btn clicks anywhere in the document and
       routes them to downloadPostMedia().
       ========================================================================= */

    document.addEventListener('click', function (e) {
        /* FIX (2026-07-29 — download button saves every file twice / pays
           DOWNLOAD_MEDIA twice): this listener and app-fixes.js's master click
           handler (setupMasterEventListeners, bound to document.body) BOTH
           intercept the same .download-media-btn click independently. Because
           document.body sits between the button and this listener's target
           (document), the body handler always fires first on the bubble phase
           — and it's the more complete implementation: it already gates on
           userState.downloadedPostIds / the Firestore downloadedBy array
           (see firebase-rules.js isOneTimeField), writes the per-file
           download-progress tracker, and logs to the Download Log collection.
           downloadPostMedia() below has none of that dedup — it would
           re-download and re-reward on every repeat click even by itself —
           so having both wired up meant one tap always produced two saved
           files and two DOWNLOAD_MEDIA payouts (see the DOWNLOAD_MEDIA row,
           "varies", in the reward-collision audit table above §7).
           Disabled here (not deleted): downloadPostMedia() itself is left
           intact and still exposed on window in case something else ever
           wants the watermark-canvas logic directly. */
        return;
        var dlBtn = e.target.closest('.download-media-btn');
        if (!dlBtn) return;
        e.preventDefault();
        e.stopPropagation();

        /* Find nearest post/card container */
        var container = dlBtn.closest('.impact-story')
            || dlBtn.closest('.reel-card')
            || dlBtn.closest('.news-list-item')
            || dlBtn.closest('.property-card')
            || dlBtn.closest('[data-media-url]')
            || dlBtn.closest('[data-post-id]');

        downloadPostMedia(container);
    });


    /* =========================================================================
       §8  REALTIME LISTENER HOOKS
       These helpers are called by the Firestore listeners in app-feed.js when
       engagement events fire (like, comment, retweet, share).
       They exist here so all reward logic is centralised in this module.
       ========================================================================= */

    /**
     * Called when the current user likes a post.
     * RETIRED (2026-08-15): this used to also credit the post AUTHOR
     * (postAuthorId) RECEIVE_LIKE — removed, see the header's RETIRED
     * note. postAuthorId is still accepted so existing call sites don't
     * need to change, it's just no longer used for a mining payout here.
     * @param {string} [postAuthorId] — unused now; kept for call-site compat
     */
    function onLikePost(postAuthorId) {
        _processReward('ENGAGE_LIKE');
    }
    window.onLikePost = onLikePost;

    /**
     * Called when the current user comments on a post.
     * RETIRED (2026-08-15): this used to also credit the post AUTHOR
     * (postAuthorId) RECEIVE_COMMENT — removed, see the header's RETIRED
     * note. postAuthorId is still accepted so existing call sites don't
     * need to change, it's just no longer used for a mining payout here.
     * @param {string} [postAuthorId] — unused now; kept for call-site compat
     */
    function onCommentPost(postAuthorId) {
        _processReward('ENGAGE_COMMENT');
    }
    window.onCommentPost = onCommentPost;

    /**
     * Called when the current user retweets a post.
     */
    function onRetweetPost() {
        _processReward('RETWEET_POST');
    }
    window.onRetweetPost = onRetweetPost;

    /**
     * Called when the current user shares a post.
     * @param {string} platform — sharing platform identifier
     * @param {Object} postData — { title, text, url }
     */
    function onSharePost(platform, postData) {
        return handleCrossPost(platform || 'native', postData);
    }
    window.onSharePost = onSharePost;

    /**
     * Called when a bubble like (live stream tap) fires.
     */
    function onBubbleLike() {
        _processReward('ENGAGE_LIKE');
    }
    window.onBubbleLike = onBubbleLike;


    console.log('[EmpImpact] ✅ Impact mining framework ready.');

})();