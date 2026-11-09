/* =============================================================================
   EMPYREAN INTERNATIONAL — APPLICATION STATE
   app-state.js  |  Step 0.2  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Single source of truth for every piece of mutable application state and
   static configuration data.  Extracted verbatim from the original
   DOMContentLoaded closure in app-fixes.js.

   LOAD ORDER
   ──────────
   <script src="firebase-init.js">   ← stubs + _initFirebase
   <script src="app-state.js">       ← THIS FILE (no other deps)
   ... all other app-*.js modules ...

   NAMESPACE
   ─────────
   Every value lives on  window.EmpState  for clean access from any module:
       window.EmpState.userState
       window.EmpState.liveStreamData
       etc.

   BACKWARD-COMPATIBLE SHIMS
   ─────────────────────────
   All mutable state objects are ALSO assigned directly to  window.*  so that
   existing inline handlers and the un-refactored portions of app-fixes.js
   continue to work without any changes:
       window.userState === window.EmpState.userState  // true
       window.cart      === window.EmpState.cart       // true

   WHAT LIVES HERE
   ───────────────
   §1  Runtime constants       — rates, pool sizes, lock durations
   §2  Auth & user state       — isGuest, isAdmin, userState, captchaCode
   §3  Web3 runtime handles    — provider, signer, contracts{}
                                 (ABIs + addresses → app-contracts.js Step 0.4)
   §4  Media file buffers      — temporary pre-upload File[] arrays
   §5  Cart state              — cart[]
   §6  Live stream state       — liveStreamData, liveLikeCount
   §7  Staking & impact mining — balances, history, daily budget
   §8  Static catalogs         — empyGiftCatalog, liveBackgrounds, communityTasks
   §9  Runtime queues          — mockUsers, admin queues, NGO partners
   §10 UI sub-state            — marketplaceGalleryState, dispute/complaint state
   §11 Accessor helpers        — EmpState.reset(), EmpState.patchUser()

   MIGRATION NOTE
   ──────────────
   When a module is extracted from app-fixes.js it should read/write state
   via window.EmpState.*  rather than bare window.* globals.
   The direct window.* shims will be removed in Phase 1 (Vue + Pinia).

   ============================================================================= */

(function empyreanStateModule() {
    'use strict';

    /* ── Guard: never initialise twice ──────────────────────────────────── */
    if (window.EmpState && window.EmpState.__initialised) {
        console.warn('[EmpState] Already initialised — skipping duplicate load.');
        return;
    }

    /* =========================================================================
       §1  RUNTIME CONSTANTS
       Values that never change during a session.
       ========================================================================= */

    /** EMPY token price in USD (display / calculation only — not on-chain) */
    const EMPY_RATE_USD = 0.10;

    /** USD → NGN conversion rate for local price display */
    const USD_TO_NGN_RATE = 1500;

    /** Platform fee percentage charged on crypto transactions */
    const CRYPTO_FEE_PERCENT = 1.5;

    /** Estimated annual percentage yield shown in the staking UI */
    const STAKING_APY_ESTIMATE = 0.157; // 15.7 %

    /**
     * Lock duration for the 40 % staking portion of earned rewards.
     * 6 calendar months expressed in milliseconds.
     */
    const STAKING_LOCK_DURATION = 6 * 30 * 24 * 60 * 60 * 1000;

    /**
     * Total EMPY token supply allocated to the impact-mining reward pool.
     * 90 % feeds the daily drip; 10 % is the ranking/leaderboard pool.
     *
     * REDUCED (2026-08-15 — token-allocation review): was 37,500,000 spread
     * over an implicit 12 years. Foundation has allocated 35,000,000 EMPY
     * total, to be mined out over MINING_POOL_YEARS below. Per-action
     * REWARD_TABLE amounts (app-impactmining.js) and RANKS tier amounts
     * (app-wallet.js / app-profile.js) were cut drastically alongside this
     * change — the pool total alone doesn't determine how "generous" the
     * app feels day-to-day, the per-action rates do, and those were the
     * actual driver of the reduction request. See app-impactmining.js's
     * own header for the full breakdown.
     */
    const IMPACT_MINING_TOTAL_POOL = 35_000_000;
    const RANKING_REWARDS_POOL     = IMPACT_MINING_TOTAL_POOL * 0.10;

    /**
     * Number of years the daily-drip portion (90 % of the pool) is spread
     * across. dailyBudget below is a HARD CEILING — once
     * impactMiningState.dailySpent hits it for the day, rewardUserForAction()
     * stops issuing rewards until the next calendar day (see
     * app-impactmining.js §2) — so the pool is mathematically guaranteed
     * not to deplete before this many years even at full daily utilization.
     * Real-world spend sits below the ceiling most days (drastically lower
     * per-action rates + the new per-user daily cap both throttle usage
     * well before the aggregate ceiling is hit at anything short of
     * platform-wide heavy engagement), which is what stretches the
     * realistic runway toward the requested 8–10 year window rather than
     * being exhausted right at the 10-year mark.
     */
    const MINING_POOL_YEARS = 10;

    /**
     * Hard per-user daily earning cap (EMPY), independent of the aggregate
     * pool budget above and the per-action caps in app-impactmining.js's
     * DAILY_CAPS. Added 2026-08-15: previously only a handful of
     * high-frequency actions (likes, comments, etc.) had a per-action daily
     * cap, and the ONLY thing stopping a single user (or bot) from farming
     * every uncapped action back-to-back was the shared, platform-wide
     * daily budget — meaning one aggressive account could exhaust an
     * entire day's mining pool alone, leaving nothing for everyone else.
     * This cap bounds how much any single account can earn in one
     * calendar day regardless of which action(s) they use to get there.
     * Enforced client-side in app-impactmining.js (see its §2 for the
     * per-user localStorage-based tracker, same convention as the existing
     * per-action DAILY_CAPS); server.js's own claim-mining-reward /
     * claim-rank-reward endpoints should mirror this same ceiling
     * server-side for the actions they already gate (not done here — that
     * file wasn't part of this change set).
     */
    const DAILY_USER_EMPY_CAP = 15;

    /* =========================================================================
       §2  AUTH & USER STATE
       Mutable.  Reset on logout via EmpState.reset().
       ========================================================================= */

    /** True until a user successfully authenticates. */
    let isGuest = true;

    /** True for accounts that have admin privileges. */
    let isAdmin = false;

    /**
     * Active authenticated user's profile document.
     * Populated by the auth listener in app-auth.js.
     * Shape mirrors the Firestore `users/{id}` document.
     */
    let userState = {};

    /**
     * In-memory map of other users fetched during the session.
     * Key: Firestore user ID.  Value: user profile object.
     * Populated by feed, profile, and live-stream listeners.
     */
    let registeredUsers = {};

    /** Current captcha string shown in the login modal. */
    let captchaCode = '';

    /* =========================================================================
       §3  WEB3 RUNTIME HANDLES
       Populated by app-wallet.js once ethers.js is loaded.
       The contract ABIs and addresses live in app-contracts.js (Step 0.4).
       ========================================================================= */

    /** ethers.js Web3Provider instance — null until wallet is connected */
    let provider = null;

    /** ethers.js Signer — null until wallet is connected */
    let signer = null;

    /**
     * Instantiated ethers.js Contract objects.
     * Keyed by contract name, e.g. contracts.EmpyreanToken
     * Populated by app-wallet.js after provider is ready.
     */
    let contracts = {};

    /* =========================================================================
       §4  MEDIA FILE BUFFERS
       Temporary arrays/references that hold File objects selected by the user
       before they are uploaded to Cloudinary.  Cleared after each successful
       upload by the respective form handler.
       ========================================================================= */

    /** Files attached to a new social post */
    let postMediaFiles = [];

    /** Files attached to an SOS request form */
    let sosMediaFiles = [];

    /** Files attached to a crisis-report form */
    let crisisMediaFiles = [];

    /** Files attached to a business-page post form */
    let businessPostMediaFiles = [];

    /** Files attached to a marketplace listing */
    let marketplaceMediaFiles = [];

    /** Single file for a news article upload */
    let newsMediaFile = null;

    /** New profile avatar selected but not yet uploaded */
    let newAvatarFile = null;

    /** New profile cover photo selected but not yet uploaded */
    let newCoverFile = null;

    /** New business-page profile photo selected but not yet uploaded */
    let newPageProfileFile = null;

    /** New business-page cover photo selected but not yet uploaded */
    let newPageCoverFile = null;

    /* =========================================================================
       §5  CART STATE
       Marketplace shopping cart.  Array of listing objects.
       ========================================================================= */

    /** Active items in the marketplace shopping cart */
    let cart = [];

    /* =========================================================================
       §6  LIVE STREAM STATE
       All live-stream session data.  Managed by app-live.js.
       ========================================================================= */

    /**
     * Complete live stream session object.
     * Kept flat (no nested reactive objects) so app-live.js can mutate
     * individual properties without triggering unintended side effects.
     */
    let liveStreamData = {
        /** Whether a stream is currently active */
        isLive: false,

        /** Whether the stream is being recorded locally */
        isRecording: false,

        /** Stream title set by the host */
        title: '',

        /** Stream description set by the host */
        description: '',

        /** Date the stream started (Date object | null) */
        startTime: null,

        /** Firestore document ID for this stream session */
        streamId: null,

        /** CSS gradient or image URL used as the virtual background */
        background: 'linear-gradient(160deg,#0A0E27 0%,#1B2B8B 50%,#0A0E27 100%)',

        /** File object for a custom background the host uploaded */
        customBackgroundFile: null,

        /** setInterval handle for the periodic impact-mining reward tick */
        rewardInterval: null,

        /** Whether the host's microphone is muted */
        isMicMuted: false,

        /** Whether the host's camera is disabled */
        isVideoMuted: false,

        /** Whether screen sharing is active */
        isScreenSharing: false,

        /** Firestore user ID of the host */
        hostUserId: null,

        /** Array of current co-host guest objects { userId, slotIndex, … } */
        guests: [],

        /** Pending guest-join request objects waiting for host approval */
        joinRequests: [],

        /** Active stream goal { target, current, label } | null */
        liveGoal: null,

        /** Whether the fan-club subscriber overlay is showing */
        fanClubActive: false,

        /** Active mini-game object { type, data } | null */
        activeGame: null,

        /** Pinned message object { authorName, text } | null */
        pinnedMessage: null,

        /**
         * Whether the host video is displayed in a small PiP.
         * Functionality removed from UI; property kept for data compatibility.
         */
        hostInSmallScreen: false,

        /** Local copy of messages sent during this stream (for replay) */
        sentMessages: [],

        /* ── Internal Agora references — set by app-live.js ── */

        /** Agora RTC client instance */
        _agoraClient: null,

        /** Agora channel name for this session */
        _agoraChannel: null,

        /** Agora local video track */
        _localVideoTrack: null,

        /** Agora local audio track */
        _localStream: null
    };

    /** Running count of hearts/likes received during the current live stream */
    let liveLikeCount = 0;

    /* =========================================================================
       §7  STAKING & IMPACT MINING STATE
       ========================================================================= */

    /**
     * EMPY balance the user has staked via the automatic (compound) mechanism.
     * Source of truth is on-chain; this mirrors it for display.
     */
    let userStakedBalance = 0;

    /**
     * EMPY balance the user has manually staked from the staking panel.
     */
    let userManualStakedBalance = 0;

    /**
     * The 40 % portion of impact-mining rewards that is locked for 6 months.
     * Incremented by rewardUserForAction() in app-helpers.js.
     */
    let userLockedStakedBalance = 0;

    /**
     * Unix timestamp (ms) when the locked staking portion becomes withdrawable.
     */
    let userLockedStakingEndTime = 0;

    /**
     * Accumulated unclaimed staking rewards (display only, mirrors contract).
     */
    let userEarnedRewards = 0;

    /**
     * Chronological log of rewards earned and claimed.
     * Each entry: { type, amount, date, lockExpiry? }
     */
    let userClaimedRewardsHistory = [];

    /**
     * Daily impact-mining budget and spend tracker.
     * Reset to zero each calendar day by rewardUserForAction().
     */
    let impactMiningState = {
        /** Daily EMPY budget = 90 % of pool ÷ (MINING_POOL_YEARS × 365.25 days) */
        dailyBudget: (IMPACT_MINING_TOTAL_POOL * 0.90) / (MINING_POOL_YEARS * 365.25),

        /** EMPY distributed today so far */
        dailySpent: 0,

        /** EMPY distributed from the ranking pool so far */
        rankingPoolSpent: 0,

        /** Midnight timestamp of the current day; triggers reset check */
        lastReset: new Date().setHours(0, 0, 0, 0)
    };

    /* =========================================================================
       §8  STATIC CATALOGS
       Read-only data that is baked in at load time.
       In Phase 1 these will migrate to Pinia stores loaded from Firestore.
       ========================================================================= */

    /**
     * Complete live-stream gift catalog.
     * Each entry: { name, symbol, price } where price is in EMPY.
     */
    const empyGiftCatalog = [
        // ── Tier 1: 1–20 EMPY ──
        { name: 'Rose',          symbol: '🌹',  price: 1   },
        { name: 'Like',          symbol: '👍',  price: 2   },
        { name: 'Heart',         symbol: '❤️',  price: 3   },
        { name: 'Coffee',        symbol: '☕',  price: 5   },
        { name: 'Star',          symbol: '⭐',  price: 7   },
        { name: 'Chocolate',     symbol: '🍫',  price: 10  },
        { name: 'Ice Cream',     symbol: '🍦',  price: 12  },
        { name: 'Balloon',       symbol: '🎈',  price: 15  },
        { name: 'Cupcake',       symbol: '🧁',  price: 18  },
        { name: 'Candy',         symbol: '🍬',  price: 20  },

        // ── Tier 2: 25–100 EMPY ──
        { name: 'Teddy Bear',    symbol: '🧸',  price: 25  },
        { name: 'Pizza Slice',   symbol: '🍕',  price: 30  },
        { name: 'Popcorn',       symbol: '🍿',  price: 35  },
        { name: 'Music Note',    symbol: '🎵',  price: 40  },
        { name: 'Flower Bouquet',symbol: '💐',  price: 50  },
        { name: 'Football',      symbol: '⚽',  price: 60  },
        { name: 'Sunglasses',    symbol: '😎',  price: 70  },
        { name: 'Perfume',       symbol: '💄',  price: 80  },
        { name: 'Cat',           symbol: '🐱',  price: 90  },
        { name: 'Dog',           symbol: '🐶',  price: 100 },

        // ── Tier 3: 120–500 EMPY ──
        { name: 'Diamond Ring',  symbol: '💍',  price: 120 },
        { name: 'Camera',        symbol: '📷',  price: 150 },
        { name: 'Champagne',     symbol: '🍾',  price: 180 },
        { name: 'Heart Mills',   symbol: '💖',  price: 200 },
        { name: 'Guitar',        symbol: '🎸',  price: 200 },
        { name: 'Laptop',        symbol: '💻',  price: 250 },
        { name: 'Gold Medal',    symbol: '🥇',  price: 300 },
        { name: 'Airplane',      symbol: '✈️',  price: 350 },
        { name: 'Luxury Watch',  symbol: '⌚',  price: 400 },
        { name: 'Car',           symbol: '🚗',  price: 450 },
        { name: 'Yacht',         symbol: '🛥️',  price: 500 },

        // ── Tier 4: 1 000–10 000 EMPY ──
        { name: 'Mansion',       symbol: '🏠',  price: 1_000  },
        { name: 'Helicopter',    symbol: '🚁',  price: 2_000  },
        { name: 'Private Jet',   symbol: '🛫',  price: 3_500  },
        { name: 'Crown',         symbol: '👑',  price: 5_000  },
        { name: 'Island',        symbol: '🏝️',  price: 7_500  },
        { name: 'Diamond Trophy',symbol: '🏆💎',price: 10_000 }
    ];

    /** Currently selected gift in the live-stream gift catalog modal */
    let selectedGift = null;

    /**
     * Virtual background options available in the go-live setup modal.
     * Each entry: { label, style, category }
     * style is either a CSS gradient string or an Unsplash image URL.
     */
    const liveBackgrounds = [
        // === CLASSIC GRADIENTS ===
        { label: 'Deep Space',    category: 'classic', style: 'linear-gradient(160deg,#0A0E27 0%,#1B2B8B 50%,#0A0E27 100%)' },
        { label: 'Gold Rush',     category: 'classic', style: 'linear-gradient(135deg,#F5C518 0%,#F59E0B 50%,#B45309 100%)' },
        { label: 'Emerald',       category: 'classic', style: 'linear-gradient(135deg,#00D4AA 0%,#10B981 50%,#047857 100%)' },
        { label: 'Royal Night',   category: 'classic', style: 'linear-gradient(160deg,#1a1a2e 0%,#16213e 40%,#0f3460 100%)' },
        // === PREMIUM GRADIENTS ===
        { label: 'Aurora',        category: 'premium', style: 'linear-gradient(135deg,#667eea 0%,#764ba2 50%,#f64f59 100%)' },
        { label: 'Sunset',        category: 'premium', style: 'linear-gradient(135deg,#f093fb 0%,#f5576c 50%,#fda085 100%)' },
        { label: 'Ocean Depth',   category: 'premium', style: 'linear-gradient(160deg,#0093E9 0%,#80D0C7 100%)' },
        { label: 'Mango',         category: 'premium', style: 'linear-gradient(135deg,#f6d365 0%,#fda085 100%)' },
        { label: 'Nebula',        category: 'premium', style: 'linear-gradient(135deg,#8E2DE2 0%,#4A00E0 50%,#2c1654 100%)' },
        { label: 'Rose Gold',     category: 'premium', style: 'linear-gradient(135deg,#f8b4c8 0%,#e8a0b0 30%,#c97a8b 70%,#a05070 100%)' },
        // === STUDIO STYLES ===
        { label: 'Midnight Studio',category: 'studio', style: 'radial-gradient(ellipse at top,#1a1a2e 0%,#16213e 50%,#0f3460 100%)' },
        { label: 'Soft White',    category: 'studio', style: 'linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%)' },
        { label: 'Carbon Dark',   category: 'studio', style: 'linear-gradient(135deg,#1c1c1c 0%,#2d2d2d 50%,#1c1c1c 100%)' },
        { label: 'Warm Cream',    category: 'studio', style: 'linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)' },
        // === PHOTO BACKGROUNDS ===
        { label: 'Studio Lights', category: 'photo', style: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=450&q=80' },
        { label: 'City Night',    category: 'photo', style: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=450&q=80' },
        { label: 'Forest',        category: 'photo', style: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=450&q=80' },
        { label: 'Galaxy',        category: 'photo', style: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=450&q=80' },
        { label: 'Library',       category: 'photo', style: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=450&q=80' },
        { label: 'Abstract Art',  category: 'photo', style: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=450&q=80' }
    ];

    /**
     * Social media community tasks shown in the "Earn EMPY" panel.
     * Each entry: { id, text, icon, url, reward (EMPY) }
     */
    const mockCommunityTasks = [
        { id: 'task-1', icon: 'fab fa-twitter',        reward: 5,  text: 'Follow on X (Twitter)',       url: 'https://x.com/EmpyreanApp' },
        { id: 'task-2', icon: 'fab fa-instagram',       reward: 5,  text: 'Follow on Instagram',         url: 'https://www.instagram.com/empyreanapp' },
        { id: 'task-3', icon: 'fab fa-youtube',         reward: 10, text: 'Subscribe on YouTube',        url: 'https://www.youtube.com/@EmpyreanHFNewsTV' },
        { id: 'task-4', icon: 'fab fa-linkedin',        reward: 8,  text: 'Connect on LinkedIn',         url: 'https://www.linkedin.com/company/108660039/admin/' },
        { id: 'task-5', icon: 'fab fa-telegram-plane',  reward: 10, text: 'Join our Telegram',           url: 'https://t.me/EmpyreanToken' },
        { id: 'task-6', icon: 'fab fa-whatsapp',        reward: 10, text: 'Join our WhatsApp Channel',   url: 'https://whatsapp.com/channel/0029VbDGHWy3rZZkpsFqmM3n' },
        { id: 'task-7', icon: 'fab fa-facebook-f',     reward: 5,  text: 'Follow on Facebook',          url: 'https://www.facebook.com/share/18UFZB7rxi/' },
        { id: 'task-8', icon: 'fab fa-tiktok',         reward: 5,  text: 'Follow on TikTok',            url: 'https://www.tiktok.com/@empyreanapp' },
        { id: 'task-9', icon: 'fab fa-tiktok',         reward: 5,  text: 'Follow @alexicographer9 on TikTok', url: 'https://www.tiktok.com/@alexicographer9' }
    ];

    /* =========================================================================
       §9  RUNTIME QUEUES
       Populated from Firestore after login.
       ========================================================================= */

    /** Map of user profiles fetched during this session. Key = Firestore user ID */
    let mockUsers = {};

    /** Withdrawal requests pending admin review. Loaded from Firestore. */
    let mockAdminWithdrawalQueue = [];

    /** SOS requests pending admin approval. Loaded from Firestore. */
    let mockAdminSosQueue = [];

    /** Grant disbursement ledger entries. Loaded from Firestore. */
    const mockGrantLedger = [];

    /** Verified NGO partner profiles. Key = Firestore document ID. */
    const mockNgoPartners = {};

    /* =========================================================================
       §10  UI SUB-STATE
       Fine-grained state for individual UI widgets.
       ========================================================================= */

    /**
     * Tracks the currently displayed media in the marketplace gallery lightbox.
     */
    let marketplaceGalleryState = {
        /** Array of { url, type } media objects for the current listing */
        media: [],
        /** Index of the media item currently shown in the lightbox */
        currentIndex: 0
    };

    /**
     * Dispute management state.
     * Seed data matches production Firestore shape; loaded from Firestore in
     * app-admin.js after login.
     */
    let mockDisputes = [
        {
            id: 'DP-001', status: 'open',
            item: '3 Bedroom Flat, Lekki', itemId: 'prop-3',
            buyerUsername: 'samuel_okoro', buyerId: 'user-2',
            sellerUsername: 'seller', sellerId: 'user-1',
            amount: '$250,000', currency: 'USD',
            reason: 'Property was not as described. Photos showed full furnishing but arrived unfurnished.',
            evidence: [
                'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=400',
                'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=400'
            ],
            chats: [
                { role: 'member', sender: 'samuel_okoro', text: 'I raised this dispute because the property was misrepresented in the listing.',   ts: '2025-08-01 10:22' },
                { role: 'member', sender: 'seller',       text: 'The furnishing was optional. I communicated this before the sale.',               ts: '2025-08-01 11:05' }
            ],
            date: '2025-08-01'
        },
        {
            id: 'DP-002', status: 'pending',
            item: 'Toyota Camry 2018', itemId: 'prop-4',
            buyerUsername: 'NairobiVibes', buyerId: 'user-3',
            sellerUsername: 'CiromaCars', sellerId: 'user-ciroma',
            amount: '$18,000', currency: 'USD',
            reason: 'Car has hidden mechanical faults not disclosed by seller. Engine light came on within 2 days.',
            evidence: [],
            chats: [
                { role: 'member', sender: 'NairobiVibes', text: 'The car was sold with undisclosed faults. Requesting full refund.', ts: '2025-08-03 09:15' }
            ],
            date: '2025-08-03'
        },
        {
            id: 'DP-003', status: 'resolved',
            item: 'MacBook Pro Listing', itemId: 'prop-mac',
            buyerUsername: 'KanoConnect', buyerId: 'user-1',
            sellerUsername: 'TechSeller_NG', sellerId: 'user-tech',
            amount: '$1,200', currency: 'USD',
            reason: 'Item never delivered within agreed timeframe.',
            evidence: [],
            chats: [
                { role: 'member', sender: 'KanoConnect', text: 'I paid but the item was never shipped.',                                        ts: '2025-07-28 14:00' },
                { role: 'admin',  sender: 'Admin',       text: 'After review, we have refunded the buyer in full. Case closed.',                ts: '2025-07-29 10:30' }
            ],
            date: '2025-07-28'
        }
    ];

    /**
     * User-submitted complaints visible in the admin complaint inbox.
     * Loaded from Firestore; seed data mirrors schema.
     */
    let mockComplaints = [
        {
            id: 'CMP-001', status: 'unread',
            userId: 'user-2', username: 'samuel_okoro',
            category: 'payment', subject: 'Withdrawal stuck for 5 days',
            detail: 'I submitted a withdrawal request 5 days ago for 1,500 EMPY but it still shows pending. Please resolve urgently.',
            evidence: [], date: '2025-08-05 09:12',
            replies: []
        },
        {
            id: 'CMP-002', status: 'read',
            userId: 'user-3', username: 'NairobiVibes',
            category: 'account', subject: 'KYC verification stuck',
            detail: 'My KYC documents were submitted 2 weeks ago but verification is still pending. I am unable to use escrow features.',
            evidence: [],
            date: '2025-08-03 15:44',
            replies: [
                { role: 'admin', sender: 'Admin', text: 'We are reviewing your KYC documents. Please allow 2-3 more business days.', ts: '2025-08-04 09:00' }
            ]
        }
    ];

    /** ID of the dispute currently open in the detail modal */
    let activeDisputeId   = null;

    /** ID of the complaint currently open in the detail modal */
    let activeComplaintId = null;

    /* =========================================================================
       §11  PUBLIC NAMESPACE — window.EmpState
       Expose everything as a flat object.  Mutable state is wrapped in
       getter/setter pairs so modules can read the current value even if the
       variable was re-assigned since module load.
       ========================================================================= */

    const EmpState = {

        __initialised: true,

        /* ── §1 Constants ── */
        EMPY_RATE_USD,
        USD_TO_NGN_RATE,
        CRYPTO_FEE_PERCENT,
        STAKING_APY_ESTIMATE,
        STAKING_LOCK_DURATION,
        IMPACT_MINING_TOTAL_POOL,
        RANKING_REWARDS_POOL,

        /* ── §2 Auth / user ── */
        get isGuest()  { return isGuest;  },
        set isGuest(v) { isGuest  = v; window.isGuest  = v; },

        get isAdmin()  { return isAdmin;  },
        set isAdmin(v) { isAdmin  = v; window.isAdmin  = v; },

        get userState()  { return userState;  },
        set userState(v) { userState  = v; window.userState  = v; },

        get captchaCode()  { return captchaCode;  },
        set captchaCode(v) { captchaCode  = v; window.captchaCode  = v; },

        get registeredUsers()  { return registeredUsers;  },
        set registeredUsers(v) { registeredUsers  = v; window.registeredUsers  = v; },

        /* ── §3 Web3 handles ── */
        get provider()  { return provider;  },
        set provider(v) { provider  = v; window.provider  = v; },

        get signer()  { return signer;  },
        set signer(v) { signer  = v; window.signer  = v; },

        get contracts()  { return contracts;  },
        set contracts(v) { contracts  = v; window.contracts  = v; },

        /* ── §4 Media buffers ── */
        get postMediaFiles()            { return postMediaFiles; },
        set postMediaFiles(v)           { postMediaFiles = v; window.postMediaFiles = v; },

        get sosMediaFiles()             { return sosMediaFiles; },
        set sosMediaFiles(v)            { sosMediaFiles = v; window.sosMediaFiles = v; },

        get crisisMediaFiles()          { return crisisMediaFiles; },
        set crisisMediaFiles(v)         { crisisMediaFiles = v; window.crisisMediaFiles = v; },

        get businessPostMediaFiles()    { return businessPostMediaFiles; },
        set businessPostMediaFiles(v)   { businessPostMediaFiles = v; window.businessPostMediaFiles = v; },

        get marketplaceMediaFiles()     { return marketplaceMediaFiles; },
        set marketplaceMediaFiles(v)    { marketplaceMediaFiles = v; window.marketplaceMediaFiles = v; },

        get newsMediaFile()             { return newsMediaFile; },
        set newsMediaFile(v)            { newsMediaFile = v; window.newsMediaFile = v; },

        get newAvatarFile()             { return newAvatarFile; },
        set newAvatarFile(v)            { newAvatarFile = v; window.newAvatarFile = v; },

        get newCoverFile()              { return newCoverFile; },
        set newCoverFile(v)             { newCoverFile = v; window.newCoverFile = v; },

        get newPageProfileFile()        { return newPageProfileFile; },
        set newPageProfileFile(v)       { newPageProfileFile = v; window.newPageProfileFile = v; },

        get newPageCoverFile()          { return newPageCoverFile; },
        set newPageCoverFile(v)         { newPageCoverFile = v; window.newPageCoverFile = v; },

        /* ── §5 Cart ── */
        get cart()  { return cart;  },
        set cart(v) { cart  = v; window.cart  = v; },

        /* ── §6 Live stream ── */
        get liveStreamData()  { return liveStreamData;  },
        set liveStreamData(v) { liveStreamData  = v; window.liveStreamData  = v; },

        get liveLikeCount()  { return liveLikeCount;  },
        set liveLikeCount(v) { liveLikeCount  = v; window.liveLikeCount  = v; },

        /* ── §7 Staking & impact mining ── */
        get userStakedBalance()        { return userStakedBalance; },
        set userStakedBalance(v)       { userStakedBalance = v; window.userStakedBalance = v; },

        get userManualStakedBalance()  { return userManualStakedBalance; },
        set userManualStakedBalance(v) { userManualStakedBalance = v; window.userManualStakedBalance = v; },

        get userLockedStakedBalance()  { return userLockedStakedBalance; },
        set userLockedStakedBalance(v) { userLockedStakedBalance = v; window.userLockedStakedBalance = v; },

        get userLockedStakingEndTime() { return userLockedStakingEndTime; },
        set userLockedStakingEndTime(v){ userLockedStakingEndTime = v; window.userLockedStakingEndTime = v; },

        get userEarnedRewards()        { return userEarnedRewards; },
        set userEarnedRewards(v)       { userEarnedRewards = v; window.userEarnedRewards = v; },

        get userClaimedRewardsHistory() { return userClaimedRewardsHistory; },
        set userClaimedRewardsHistory(v){ userClaimedRewardsHistory = v; window.userClaimedRewardsHistory = v; },

        get impactMiningState()  { return impactMiningState;  },
        set impactMiningState(v) { impactMiningState  = v; window.impactMiningState  = v; },

        /* ── §8 Static catalogs (read-only references) ── */
        empyGiftCatalog,
        liveBackgrounds,
        mockCommunityTasks,

        get selectedGift()  { return selectedGift;  },
        set selectedGift(v) { selectedGift  = v; window.selectedGift  = v; },

        /* ── §9 Runtime queues ── */
        get mockUsers()  { return mockUsers;  },
        set mockUsers(v) { mockUsers  = v; window.mockUsers  = v; },

        get mockAdminWithdrawalQueue()  { return mockAdminWithdrawalQueue;  },
        set mockAdminWithdrawalQueue(v) { mockAdminWithdrawalQueue = v; window.mockAdminWithdrawalQueue = v; },

        get mockAdminSosQueue()  { return mockAdminSosQueue;  },
        set mockAdminSosQueue(v) { mockAdminSosQueue = v; window.mockAdminSosQueue = v; },

        mockGrantLedger,
        mockNgoPartners,

        /* ── §10 UI sub-state ── */
        get marketplaceGalleryState()  { return marketplaceGalleryState;  },
        set marketplaceGalleryState(v) { marketplaceGalleryState = v; window.marketplaceGalleryState = v; },

        get mockDisputes()  { return mockDisputes;  },
        set mockDisputes(v) { mockDisputes = v; window.mockDisputes = v; },

        get mockComplaints()  { return mockComplaints;  },
        set mockComplaints(v) { mockComplaints = v; window.mockComplaints = v; },

        get activeDisputeId()  { return activeDisputeId;  },
        set activeDisputeId(v) { activeDisputeId = v; window.activeDisputeId = v; },

        get activeComplaintId()  { return activeComplaintId;  },
        set activeComplaintId(v) { activeComplaintId = v; window.activeComplaintId = v; },

        /* =========================================================================
           §11  UTILITY METHODS
           ========================================================================= */

        /**
         * Reset all mutable session state to defaults.
         * Called on logout or hard session expiry.
         * Static catalogs (empyGiftCatalog, liveBackgrounds, etc.) are NOT reset.
         */
        reset() {
            isGuest            = true;    window.isGuest            = true;
            isAdmin            = false;   window.isAdmin            = false;
            userState          = {};      window.userState          = {};
            captchaCode        = '';      window.captchaCode        = '';
            registeredUsers    = {};      window.registeredUsers    = {};

            provider  = null; window.provider  = null;
            signer    = null; window.signer    = null;
            contracts = {};   window.contracts = {};

            postMediaFiles          = []; window.postMediaFiles          = [];
            sosMediaFiles           = []; window.sosMediaFiles           = [];
            crisisMediaFiles        = []; window.crisisMediaFiles        = [];
            businessPostMediaFiles  = []; window.businessPostMediaFiles  = [];
            marketplaceMediaFiles   = []; window.marketplaceMediaFiles   = [];
            newsMediaFile           = null; window.newsMediaFile         = null;
            newAvatarFile           = null; window.newAvatarFile         = null;
            newCoverFile            = null; window.newCoverFile          = null;
            newPageProfileFile      = null; window.newPageProfileFile    = null;
            newPageCoverFile        = null; window.newPageCoverFile      = null;

            cart = []; window.cart = [];

            liveStreamData = {
                isLive: false, isRecording: false, title: '', description: '',
                startTime: null, streamId: null,
                background: 'linear-gradient(160deg,#0A0E27 0%,#1B2B8B 50%,#0A0E27 100%)',
                customBackgroundFile: null, rewardInterval: null,
                isMicMuted: false, isVideoMuted: false, isScreenSharing: false,
                hostUserId: null, guests: [], joinRequests: [],
                liveGoal: null, fanClubActive: false, activeGame: null,
                pinnedMessage: null, hostInSmallScreen: false, sentMessages: [],
                _agoraClient: null, _agoraChannel: null,
                _localVideoTrack: null, _localStream: null
            };
            window.liveStreamData = liveStreamData;
            liveLikeCount = 0; window.liveLikeCount = 0;

            userStakedBalance       = 0;  window.userStakedBalance       = 0;
            userManualStakedBalance = 0;  window.userManualStakedBalance = 0;
            userLockedStakedBalance = 0;  window.userLockedStakedBalance = 0;
            userLockedStakingEndTime= 0;  window.userLockedStakingEndTime= 0;
            userEarnedRewards       = 0;  window.userEarnedRewards       = 0;
            userClaimedRewardsHistory = []; window.userClaimedRewardsHistory = [];
            impactMiningState = {
                dailyBudget:    (IMPACT_MINING_TOTAL_POOL * 0.90) / (MINING_POOL_YEARS * 365.25),
                dailySpent:     0,
                rankingPoolSpent: 0,
                lastReset:      new Date().setHours(0, 0, 0, 0)
            };
            window.impactMiningState = impactMiningState;

            selectedGift = null; window.selectedGift = null;

            console.log('[EmpState] Session state reset.');
        },

        /**
         * Merge partial updates into userState without replacing the reference.
         * Keeps window.userState pointer intact for legacy code.
         * @param {Object} patch — key/value pairs to merge
         */
        patchUser(patch) {
            Object.assign(userState, patch);
            // window.userState is the same object reference — no extra assign needed
        },

        /**
         * Merge partial updates into liveStreamData without replacing the reference.
         * @param {Object} patch — key/value pairs to merge
         */
        patchLive(patch) {
            Object.assign(liveStreamData, patch);
        }
    };

    /* =========================================================================
       PUBLISH — attach to window
       ========================================================================= */

    window.EmpState = EmpState;

    /* ── Backward-compatible direct window.* shims ─────────────────────────
       Each shim points at the same object reference as EmpState.
       Any module that writes window.userState.foo = bar is writing to the same
       object that EmpState.userState points to — no data duplication.
       ──────────────────────────────────────────────────────────────────────── */

    window.isGuest                  = isGuest;
    window.isAdmin                  = isAdmin;
    window.userState                = userState;
    window.registeredUsers          = registeredUsers;
    window.captchaCode              = captchaCode;

    window.provider                 = provider;
    window.signer                   = signer;
    window.contracts                = contracts;

    window.postMediaFiles           = postMediaFiles;
    window.sosMediaFiles            = sosMediaFiles;
    window.crisisMediaFiles         = crisisMediaFiles;
    window.businessPostMediaFiles   = businessPostMediaFiles;
    window.marketplaceMediaFiles    = marketplaceMediaFiles;
    window.newsMediaFile            = newsMediaFile;
    window.newAvatarFile            = newAvatarFile;
    window.newCoverFile             = newCoverFile;
    window.newPageProfileFile       = newPageProfileFile;
    window.newPageCoverFile         = newPageCoverFile;

    window.cart                     = cart;

    window.liveStreamData           = liveStreamData;
    window.liveLikeCount            = liveLikeCount;

    window.userStakedBalance        = userStakedBalance;
    window.userManualStakedBalance  = userManualStakedBalance;
    window.userLockedStakedBalance  = userLockedStakedBalance;
    window.userLockedStakingEndTime = userLockedStakingEndTime;
    window.userEarnedRewards        = userEarnedRewards;
    window.userClaimedRewardsHistory= userClaimedRewardsHistory;
    window.impactMiningState        = impactMiningState;

    window.empyGiftCatalog          = empyGiftCatalog;
    window.liveBackgrounds          = liveBackgrounds;
    window.mockCommunityTasks       = mockCommunityTasks;
    window.selectedGift             = selectedGift;

    window.mockUsers                = mockUsers;
    window.mockAdminWithdrawalQueue = mockAdminWithdrawalQueue;
    window.mockAdminSosQueue        = mockAdminSosQueue;
    window.mockGrantLedger          = mockGrantLedger;
    window.mockNgoPartners          = mockNgoPartners;

    window.marketplaceGalleryState  = marketplaceGalleryState;
    window.mockDisputes             = mockDisputes;
    window.mockComplaints           = mockComplaints;
    window.activeDisputeId          = activeDisputeId;
    window.activeComplaintId        = activeComplaintId;

    /* Rate / pool constants */
    window.EMPY_RATE_USD            = EMPY_RATE_USD;
    window.USD_TO_NGN_RATE          = USD_TO_NGN_RATE;
    window.CRYPTO_FEE_PERCENT       = CRYPTO_FEE_PERCENT;
    window.STAKING_APY_ESTIMATE     = STAKING_APY_ESTIMATE;
    window.STAKING_LOCK_DURATION    = STAKING_LOCK_DURATION;
    window.IMPACT_MINING_TOTAL_POOL = IMPACT_MINING_TOTAL_POOL;
    window.RANKING_REWARDS_POOL     = RANKING_REWARDS_POOL;
    window.MINING_POOL_YEARS        = MINING_POOL_YEARS;
    window.DAILY_USER_EMPY_CAP      = DAILY_USER_EMPY_CAP;

    console.log('[EmpState] ✅ Application state initialised. Access via window.EmpState');

})();