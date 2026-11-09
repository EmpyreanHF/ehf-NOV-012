/* =============================================================================
   EMPYREAN INTERNATIONAL — SELF HELP ASSISTANCE CENTER  (v2)
   self-help-assistance-center.js  |  Load AFTER app-fixes.js AND after
   app-nav.js (v2 of this file relies on app-nav.js's NAV array having a
   'help-center' entry — see the small addition made to app-nav.js alongside
   this update). Order relative to app-patch-v46.js etc. still doesn't
   matter, this file never touches their markup.

   FEATURE: a searchable, categorised self-help hub (search bar with live
   suggestions, five accordion categories, 40+ articles, article reading
   view, "Contact Support" fallback) rendered in a premium overlay panel —
   reachable from THREE places:
     1. A dedicated "Help & Assistance Center" item in the main sidebar
        (added to app-nav.js's NAV array), for one-tap access from anywhere.
     2. A banner mounted at the very top of the Settings tab-content area
        (above Profile/Security/Privacy/Terms/E-Commerce/Help — see
        insertSettingsEntry below), so it's the first thing visible no
        matter which Settings tab a user has open.
     3. A small persistent "?" floating button (bottom-right, §FAB) as a
        belt-and-braces fallback in case neither of the above mounts.

   CONTENT NOTE: the article bodies below are professionally-written
   starting copy, not your actual legal/policy text. "Rules & Policies" in
   particular is written as reasonable placeholder language — replace
   ARTICLES['rules-*'].body with your real, binding policy wording before
   this is treated as authoritative by users. Everything else (feature
   how-tos, Marketplace escrow/direct-sales flow, Impact Mining mechanics)
   was cross-checked against the live app code and index.html's own policy
   copy, so it's safe to ship as-is and refine over time.

   v2 CHANGES
   ──────────
   • Sidebar entry added (see app-nav.js NAV array + its click handler —
     clicks call window._empOpenHelpCenter(), exposed near the bottom of
     §3 below, instead of navigating to a non-existent section).
   • Settings banner now mounts inside #settings .card-content, as the
     FIRST child — i.e. above every settings tab's own content, always,
     regardless of which tab (Profile, Security, Privacy, Terms,
     E-Commerce, Help) is currently active. Carries a small "Settings /
     Self Help Assistance Center" eyebrow label above the button.
   • index.html: the "Help" tab in .settings-tabs was reordered to be
     first (before Profile), renamed to "Help & Assistance Center".
   • New category "Wallet, Tokens & Impact Mining" — Impact Mining is now
     explained extensively (reward pool, daily budget, ranking pool, 40%/
     6-month lock, what actions earn EMPY, claiming, fair-use safeguards).
   • SOS article expanded: donors can sponsor an SOS request as a full
     cause via Sponsor a Cause / Donor Hub, not just send a one-off gift.
   • Marketplace article rewritten to clearly separate Escrow (smaller/
     general items) from Direct Sales (vehicles, trucks, houses, real
     estate, property) with the full transaction flow and a due-diligence
     disclaimer for Direct Sales.
   • New articles for previously-uncovered areas found in a full site scan:
     My Wallet overview, Community Tasks (earn EMPY for following our
     social channels), Reels, Dashboard/News, Saved posts & Download log.

   Purely additive: creates its own DOM/CSS at runtime, edits nothing in
   app-fixes.js / app-patch-v46.js / style.css. The only two files this
   version touches are app-nav.js (one NAV entry + one click branch) and
   index.html (reordering/renaming the existing Help tab) — both called
   out explicitly above so they're easy to review or revert.
   ============================================================================= */

(function empyreanSelfHelpAssistanceCenter() {
    'use strict';

    if (window._empSelfHelpCenterLoaded) {
        console.warn('[SelfHelpCenter] Already loaded — skipping duplicate execution.');
        return;
    }
    window._empSelfHelpCenterLoaded = true;

    /* ═══════════════════════════════════════════════════════════════════
       §1  CONTENT — categories, subheadings, article bodies
       ═══════════════════════════════════════════════════════════════════ */

    var ICONS = {
        rules: '<path d="M12 2 3 6v6c0 5 3.8 8.7 9 10 5.2-1.3 9-5 9-10V6l-9-4z"/>',
        account: '<path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
        compass: '<circle cx="12" cy="12" r="9"/><path d="m14.5 9.5-2 5-5 2 2-5 5-2z"/>',
        shield: '<path d="M12 2 4 5v6c0 5.2 3.4 9 8 11 4.6-2 8-5.8 8-11V5l-8-3z"/><path d="m9 12 2 2 4-4"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        chevron: '<path d="m9 6 6 6-6 6"/>',
        back: '<path d="m15 6-6 6 6 6"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        support: '<path d="M12 2a7 7 0 0 0-7 7v3a2 2 0 0 0 2 2h1v-6a4 4 0 0 1 8 0v6h1a2 2 0 0 0 2-2V9a7 7 0 0 0-7-7z"/><path d="M6 14v2a4 4 0 0 0 4 4h1"/>',
        coin: '<circle cx="12" cy="12" r="9"/><path d="M9.5 15.2c.4.9 1.3 1.5 2.5 1.5 1.7 0 2.8-1 2.8-2.2 0-1.4-1.1-1.9-2.8-2.3-1.6-.4-2.4-.9-2.4-2 0-1.1 1-2 2.4-2 1.1 0 2 .5 2.4 1.4M12 7.3v1.1M12 15.6v1.1"/>'
    };

    // Each article's `kw` (keywords) feed the search index in addition to its title.
    var CATEGORIES = [
        {
            id: 'rules-policies',
            title: 'Rules & Policies',
            icon: ICONS.shield,
            subs: [
                {
                    id: 'enforcement-of-rules', title: 'Enforcement of rules', kw: 'strikes ban suspend violation',
                    body: '<p>Empyrean enforces its community standards in stages so members generally have the chance to correct course before losing access. In most cases:</p>' +
                        '<ul><li><strong>First violation</strong> — a written notice explaining what was affected and why, with guidance on how to comply.</li>' +
                        '<li><strong>Repeated or severe violations</strong> — temporary limits on the specific feature involved (posting, messaging, live streaming, withdrawals, etc.).</li>' +
                        '<li><strong>Serious or repeated severe violations</strong> — account suspension or permanent removal.</li></ul>' +
                        '<p>Some actions — fraud, impersonation, endangering another person\u2019s safety, or misuse of the SOS/Crisis systems — can result in immediate suspension without the staged process above, because of the harm they can cause.</p>'
                },
                {
                    id: 'notices-and-meanings', title: 'Notices and their meanings', kw: 'warning email banner label',
                    body: '<p>You may see any of the following, in-app or by email:</p>' +
                        '<ul><li><strong>Warning notice</strong> — informational; no restriction yet, but the behaviour needs to stop.</li>' +
                        '<li><strong>Restriction notice</strong> — a specific feature (posting, DMs, marketplace, live) has been temporarily limited.</li>' +
                        '<li><strong>Review notice</strong> — your account or a specific item (post, listing, withdrawal) is under manual review; expect a delay before it resolves.</li>' +
                        '<li><strong>Suspension notice</strong> — your account has been suspended; the notice states the reason and, where applicable, how to appeal.</li></ul>' +
                        '<p>Every notice includes a reference so our support team can look up the exact action taken if you reach out.</p>'
                },
                {
                    id: 'site-rules', title: 'Community guidelines overview', kw: 'terms conduct policy rules',
                    body: '<p>In short, Empyrean asks every member to:</p>' +
                        '<ul><li>Be truthful about who you are — no impersonation or fake identities.</li>' +
                        '<li>Treat other members, especially those requesting help through SOS or Crisis Reporting, with dignity.</li>' +
                        '<li>Only raise funds, list items, or make claims you can honestly stand behind — misuse of donation, grant, or marketplace tools is treated seriously.</li>' +
                        '<li>Respect intellectual property and privacy — don\u2019t post content you don\u2019t have the right to share, or someone else\u2019s private information.</li>' +
                        '<li>Follow the law that applies to you, including around payments, KYC, and financial activity on the platform.</li></ul>' +
                        '<p>This page is a summary. Your account\u2019s full Terms of Service and Community Guidelines are the governing documents — replace this note with a link to those once published.</p>'
                }
            ]
        },
        {
            id: 'managing-account',
            title: 'Managing Your Account',
            icon: ICONS.account,
            subs: [
                {
                    id: 'suspended-accounts', title: 'Suspended accounts', kw: 'banned appeal locked out',
                    body: '<p>A suspended account can\u2019t sign in or use platform features until the suspension is lifted or overturned. To resolve it:</p>' +
                        '<ol><li>Check the email tied to your account for the suspension notice — it states the reason and any reference ID.</li>' +
                        '<li>Use the <strong>Contact Support</strong> button below with that reference ID; appeals are reviewed individually.</li>' +
                        '<li>If the suspension was time-limited, access restores automatically once that period ends — no action needed.</li></ol>'
                },
                {
                    id: 'locked-limited-accounts', title: 'Locked or limited accounts', kw: 'restricted verify identity unlock',
                    body: '<p>A locked or limited account usually means one specific safeguard was triggered — a security check, an incomplete KYC step, or an automatic flag on unusual activity — rather than a full suspension.</p>' +
                        '<p>Go to <strong>Settings → Account Status</strong> to see exactly what\u2019s pending; most locks clear once the listed step (verify email/phone, complete KYC, confirm a recent login) is finished. If nothing is listed there, contact support with your account email.</p>'
                },
                {
                    id: 'adding-phone-number', title: 'Adding a phone number', kw: 'sms otp mobile number verify',
                    body: '<p>Go to <strong>Settings → Account → Phone Number → Add Number</strong>, enter your number with country code, and confirm the SMS one-time code. A verified phone number strengthens account recovery and can be required for certain withdrawal and KYC tiers.</p>'
                },
                {
                    id: 'updating-email-address', title: 'Updating your email address', kw: 'change email inbox',
                    body: '<p>Go to <strong>Settings → Account → Email Address → Change</strong>. You\u2019ll confirm your current password, then verify the new address via a confirmation link sent to it — the change only takes effect after that link is clicked, so old sign-ins keep working until then.</p>'
                },
                {
                    id: 'change-reset-password', title: 'Change or reset your password', kw: 'forgot password login locked out',
                    body: '<p><strong>To change it while signed in:</strong> Settings → Account → Password → Change Password, then enter your current and new password.</p>' +
                        '<p><strong>If you\u2019re locked out:</strong> use \u201cForgot password?\u201d on the sign-in screen. A reset link is sent to your account email and expires after a short window for security — request a fresh one if it lapses.</p>'
                }
            ]
        },
        {
            id: 'using-empyrean',
            title: 'Using Empyrean',
            icon: ICONS.compass,
            subs: [
                { id: 'how-to-post', title: 'How to post', kw: 'feed create upload photo video reel',
                    body: '<p>Tap the <strong>+</strong> button on the feed to create a photo, video, reel, or text post. Add a caption, tag a category if prompted, and choose your audience (public or protected) before sharing — see \u201cPublic vs. protected posts\u201d for what that choice controls.</p>' },
                { id: 'supported-browsers', title: 'Supported browsers', kw: 'chrome safari compatibility device',
                    body: '<p>Empyrean works best on the latest version of Chrome (Android/desktop) and Safari (iOS/macOS). For live streaming and video calls specifically, Chrome-based browsers currently offer the most reliable experience. Keeping your browser or the installed app updated avoids most display and playback issues.</p>' },
                { id: 'direct-messages', title: 'Direct Messages', kw: 'dm chat inbox contacts',
                    body: '<p>Open the Messages tab to see your conversations, or start a new one from someone\u2019s profile. Messages are private between participants; you can mute, block, or report a conversation from the chat\u2019s options menu at any time.</p>' },
                { id: 'marketplace', title: 'Marketplace \u2014 Escrow vs. Direct Sales', kw: 'buy sell listing shop products escrow direct sales vehicles cars trucks houses real estate property due diligence vetting',
                    body: '<p>The Marketplace runs on <strong>two distinct systems</strong> depending on what\u2019s being sold \u2014 knowing which one applies to a listing tells you exactly what protection you have before you pay.</p>' +
                        '<p><strong>1. Escrow \u2014 for smaller, general items.</strong> Both buyer and seller must be KYC-verified to use it. You pay the full amount into Empyrean\u2019s secure escrow wallet at checkout \u2014 funds are held in trust, not sent straight to the seller. Once the seller ships and you receive the item, you have <strong>48 hours</strong> to inspect it and tap \u201cConfirm Delivery\u201d before funds are released to the seller. If something\u2019s wrong, tap \u201cRaise a Dispute\u201d within that same window and an admin will mediate a return or refund. If you neither confirm nor dispute in time, funds release automatically to the seller.</p>' +
                        '<p><strong>2. Direct Sales \u2014 restricted to vehicles, trucks, houses, real estate and other property.</strong> These high-value, physically-inspected categories are never eligible for escrow and only ever sell through Direct Sales. This bypasses checkout entirely: the platform reveals the seller\u2019s contact details, and buyer and seller arrange to meet, inspect the item in person, and settle payment directly between themselves (cash, bank transfer, etc.) completely outside the app. Listings from sellers who aren\u2019t yet KYC-verified are also only available through Direct Sales, regardless of category.</p>' +
                        '<p><strong>Empyrean is not involved in and does not protect Direct Sales transactions</strong> \u2014 we can\u2019t refund or mediate a deal made outside the platform. The buyer is responsible for doing their own vetting and due diligence before purchasing: verify ownership/title documents, meet in a safe public place, never pay before inspecting the item in person, and for big-ticket property or vehicle purchases, strongly consider involving a lawyer or a professional inspector before you commit funds.</p>'
                },
                { id: 'sos-request', title: 'SOS request community support system', kw: 'emergency help request urgent sponsor donate cause fund',
                    body: '<p>SOS lets a member in urgent need post a request the community can see and respond to with direct support or donations. Requests go through a review step before wider distribution, both to protect the requester\u2019s dignity and to reduce misuse.</p>' +
                        '<p>As a donor, you\u2019re not limited to sending a one-off gift on an SOS post \u2014 you can also <strong>sponsor an SOS request as a full cause</strong>. From Sponsor a Cause (the Donor Hub), pledge toward the request\u2019s stated funding goal, track how much has been raised so far, and follow it through until it\u2019s fully funded \u2014 the same way you\u2019d sponsor any other humanitarian cause, just tied to that one specific urgent request rather than a general fund.</p>' +
                        '<p>If you\u2019re submitting a request yourself, be as specific and honest as possible about the need \u2014 it speeds up review and builds trust with potential supporters and sponsors.</p>'
                },
                { id: 'crisis-reporting', title: 'Crisis reporting media system', kw: 'disaster news alert report',
                    body: '<p>Crisis Reporting lets members document and share on-the-ground information during emergencies or humanitarian crises — photos, video, and written accounts. Submissions are reviewed for authenticity where possible before being surfaced widely; always prioritise your own safety over documenting an event.</p>' },
                { id: 'ngo-partner-programs', title: 'NGO partner programs', kw: 'nonprofit organization partnership',
                    body: '<p>Registered NGOs can apply for a verified partner page, giving access to grant-visibility tools, donor communication features, and eligibility for certain platform-facilitated funding programs. Apply from <strong>Settings → Organizations → Become a Partner</strong>; applications are reviewed manually and typically require registration documentation.</p>' },
                { id: 'live-streaming', title: 'Live streaming system', kw: 'go live broadcast host guest viewer',
                    body: '<p>Start a stream from the Live tab; viewers can join, comment, and send gifts in real time. As a host you can invite guests, moderate comments, and end the stream at any point. If you background the app mid-stream, Minimize (Picture-in-Picture) keeps playback running in a small floating window rather than cutting off.</p>' },
                { id: 'community-tasks-earn', title: 'Community Tasks \u2014 earn EMPY for following our channels', kw: 'earn empy follow social tasks twitter instagram facebook tiktok youtube linkedin telegram whatsapp',
                    body: '<p>The Community Tasks panel is the quickest way to earn a one-time EMPY bonus. Open it from the sidebar, tap a task \u2014 follow on X (Twitter), Instagram, Facebook, TikTok, LinkedIn, subscribe on YouTube, or join our Telegram/WhatsApp channel \u2014 complete the action on that platform, then return and confirm it. The reward credits straight to your Impact Mining balance. Each task can only be completed once per account.</p>'
                },
                { id: 'reels-system', title: 'Reels \u2014 short-form video', kw: 'reels short video swipe vertical clips',
                    body: '<p>Reels is Empyrean\u2019s short-form vertical video feed. Swipe up or down to move between clips, tap to like, comment, or share, and use the <strong>+</strong> button to record or upload your own. Watching, liking, and sharing reels count toward your everyday engagement the same way a regular post does.</p>'
                },
                { id: 'dashboard-feed', title: 'Dashboard, News & your home feed', kw: 'home feed dashboard timeline news announcements',
                    body: '<p>The Dashboard is your home feed \u2014 a scrollable timeline of posts, business updates, and SOS/crisis stories from the people and pages you follow. The separate <strong>News</strong> tab carries platform-wide announcements and curated humanitarian news, so day-to-day updates from your network and official Empyrean news don\u2019t get mixed together.</p>'
                },
                { id: 'saved-downloads', title: 'Saved posts & your download log', kw: 'saved bookmarks downloads log offline media',
                    body: '<p>Tap the bookmark icon on any post to save it for later \u2014 everything you\u2019ve saved collects under the <strong>Saved</strong> tab so you can find it again without scrolling back through your feed. The <strong>Downloads</strong> tab keeps a running log of any photos or videos you\u2019ve downloaded from posts, so you always know where to find media you\u2019ve already saved to your device.</p>'
                },
                { id: 'business-pages', title: 'Business page system', kw: 'company brand storefront profile',
                    body: '<p>A Business Page gives an organisation or brand a dedicated presence separate from a personal profile, with its own posts, contact details, and (for eligible accounts) marketplace listings. Create one from <strong>Settings → Business Pages → Create Page</strong> — accounts can manage up to five pages.</p>' }
            ]
        },
        {
            id: 'wallet-tokens-mining',
            title: 'Wallet, Tokens & Impact Mining',
            icon: ICONS.coin,
            subs: [
                { id: 'my-wallet-overview', title: 'Your Empyrean Wallet', kw: 'wallet balance tokens empy overview',
                    body: '<p>Wallet is the central hub for everything token-related on your account: your available EMPY balance, any amount currently staked or locked from Impact Mining, your accrued staking rewards, and a full transaction history. From here you can jump straight into Claim Rewards, Stake, Withdraw, or Buy Tokens \u2014 see the linked articles below for how each of those works.</p>'
                },
                /* CRYPTO_HIDDEN_FOR_PLAY_STORE (2026-08): a 'Blockchain
                   integration' article used to live in this section,
                   describing on-chain record-keeping for grants/tokens.
                   Removed along with the rest of the crypto/blockchain
                   surface — it isn't accurate to hide the feature
                   everywhere else in the app while a help article still
                   tells people it's there. Restore it alongside the
                   feature when crypto goes live. */
                { id: 'impact-mining', title: 'Empyrean Social Impact Mining \u2014 how EMPY rewards work', kw: 'impact mining earn empy rewards tokens proof of impact daily budget',
                    body: '<p><strong>Impact Mining</strong> turns the things you already do on Empyrean \u2014 posting, engaging, helping, giving \u2014 into daily EMPY token rewards. There\u2019s no hardware or energy cost like a real-world mining operation: your <strong>genuine activity on the platform is the proof of impact</strong>, and the more of it you create, the more you earn.</p>' +
                        '<p><strong>What earns you EMPY:</strong></p>' +
                        '<ul><li>Everyday engagement \u2014 liking, sharing, replying to, and reposting/quoting posts.</li>' +
                        '<li>Completing a one-time Community Task (following Empyrean\u2019s official X/Twitter, Instagram, Facebook, TikTok, YouTube, LinkedIn, Telegram, or WhatsApp channel) \u2014 each channel pays its own small EMPY bonus, once per account.</li>' +
                        '<li>Successfully completing an escrow purchase in the Marketplace.</li>' +
                        '<li>Responding to and helping fulfil SOS requests.</li>' +
                        '<li>Other genuine community contributions the platform recognises over time.</li></ul>' +
                        '<p><strong>Where the rewards come from:</strong> Impact Mining is funded from a fixed pool of <strong>35,000,000 EMPY</strong>, released gradually over roughly 8\u201310 years rather than all at once \u2014 90% of the pool is spread into a shared daily budget so the reward system stays sustainable for the long haul, and a further 10% is set aside specifically as a <strong>ranking rewards pool</strong> for top community contributors on the leaderboard.</p>' +
                        '<p><strong>Daily cap:</strong> to keep rewards spread fairly across the whole community rather than a handful of highly active accounts claiming most of a day\u2019s budget, each account can earn up to <strong>15 EMPY per calendar day</strong> from Impact Mining actions, on top of the platform-wide shared daily budget above. The cap resets at midnight.</p>' +
                        '<p><strong>Locking:</strong> 40% of every reward you earn is automatically locked for <strong>6 months</strong> \u2014 a built-in savings mechanism that rewards long-term participation over short-term farming. The remaining 60% is available to you right away.</p>' +
                        '<p><strong>Claiming:</strong> Go to <strong>Wallet → Rewards</strong> and tap \u201cClaim Rewards\u201d to pull your available (unlocked) balance into your in-app wallet balance; a minimum withdrawal threshold applies, shown on the claim screen.</p>' +
                        '<p><strong>Putting it to work:</strong> Once claimed, EMPY from Impact Mining can be staked for further yield, spent on Marketplace purchases or live-stream gifts, or donated straight back into SOS requests and other humanitarian causes \u2014 completing the platform\u2019s giving-and-earning loop.</p>' +
                        '<p><strong>Fair use:</strong> because the daily reward budget is shared across every active member, the system watches for reward farming, duplicate actions, and bot-like behaviour, and can pause an account\u2019s mining privileges for repeated abuse \u2014 see \u201cEnforcement of rules\u201d for how that\u2019s handled.</p>'
                },
                { id: 'gifting-tokens', title: 'Gifting token purchase & payment system', kw: 'gifts buy tokens payment card',
                    body: '<p>Gifts are purchased with EMPY tokens, bought in-app via your saved payment method. Send a gift during a live stream or on a post to show support — recipients can convert received gifts according to the platform\u2019s standard conversion and payout terms.</p>' },
                { id: 'staking', title: 'Staking system', kw: 'lock tokens rewards yield',
                    body: '<p>Staking lets you lock EMPY tokens for a chosen period in exchange for rewards, visible from your Wallet. Rewards accrue over the staking term; withdrawing early may forfeit some or all pending rewards depending on the term you selected — review the terms shown before confirming a stake.</p>' },
                { id: 'withdrawal-system', title: 'Withdrawal system', kw: 'cash out payout bank transfer',
                    body: '<p>Go to <strong>Wallet → Withdraw</strong>, choose a payout method, and confirm the amount. Withdrawals above certain thresholds require completed KYC verification, and first-time payout methods may need a short manual review — both exist to protect your funds, not to slow you down unnecessarily.</p>' },
                { id: 'kyc-verification', title: 'KYC verification system', kw: 'identity document id verify upload',
                    body: '<p>KYC (Know Your Customer) confirms your identity for withdrawals, staking payouts, and higher-value transactions. Go to <strong>Settings → Verification</strong>, upload a valid government ID and a clear selfie, and submit — review typically completes within a short window, and you\u2019ll be notified of the outcome in-app.</p>' },
                { id: 'badge-purchase', title: 'Badge purchase system', kw: 'profile badge premium status icon',
                    body: '<p>Badges are optional profile markers (supporter tiers, verified partner status, milestones) purchasable from <strong>Settings → Badges</strong> using EMPY tokens or a direct payment. They\u2019re cosmetic/status indicators and don\u2019t change your account\u2019s underlying permissions.</p>' },
                { id: 'monetization-policies', title: 'Monetization policies', kw: 'earnings creator income payout rules',
                    body: '<p>Creators can earn through gifts received during live streams, marketplace sales, and eligible sponsored content. Payouts follow the platform fee structure shown in your Wallet before you withdraw, and monetized content must still follow the same community guidelines as any other post — earning potential doesn\u2019t exempt content from review.</p>' },
                { id: 'grant-disbursement', title: 'Grant disbursement system', kw: 'funding transparent ledger audit',
                    body: '<p>Approved grants are recorded and disbursed through a transparent audit trail, so both the sender and recipient — and, for public grants, the wider community — can verify that funds moved as intended. Disbursement status can be tracked from the Grant Transparency Portal.</p>' },
                { id: 'targeted-grants-collection', title: 'Individual accounts collection for targeted grants', kw: 'sponsor beneficiary fundraising target',
                    body: '<p>Some grants are directed at a specific individual or small group rather than a general fund. In these cases, donations are collected against that named recipient\u2019s account and released according to the grant\u2019s stated terms, keeping the connection between a gift and its intended recipient traceable end-to-end.</p>' },
                { id: 'donor-portal', title: 'Donor Hub — a.k.a. \u201cSponsor a Cause\u201d', kw: 'donate hub give sponsor track sponsor a cause',
                    body: '<p>The Donor Hub \u2014 labelled <strong>Sponsor a Cause</strong> in the sidebar \u2014 is where you set up a donor profile, browse approved requests and projects (including individual SOS requests), submit or track sponsorship pledges, see the public Donor Wall, and message support directly. It also links out to the Grant Transparency Portal so you can see exactly how funds you\u2019ve given were used.</p>' },
            ]
        },
        {
            id: 'safety-security',
            title: 'Safety & Security',
            icon: ICONS.shield,
            subs: [
                { id: 'protecting-personal-info', title: 'Protecting your personal information', kw: 'privacy data safety exposure',
                    body: '<p>Avoid sharing sensitive personal details (home address, financial account numbers, government ID numbers) in public posts, comments, or with people you don\u2019t know and trust — legitimate Empyrean staff and verified NGO partners will never ask for your password or a one-time verification code over chat. Review <strong>Settings → Privacy</strong> periodically to confirm what\u2019s visible to whom.</p>' },
                { id: 'public-vs-protected-posts', title: 'Public vs. protected posts', kw: 'audience visibility followers private',
                    body: '<p><strong>Public posts</strong> are visible to anyone on or off the platform, including in shared links and previews. <strong>Protected posts</strong> are visible only to your approved followers/connections. You choose this per post at the time you create it, and can adjust your default audience in <strong>Settings → Privacy → Post Visibility</strong>.</p>' },
                { id: 'sharing-with-partners', title: 'Sharing information with business partners', kw: 'third party data share vendors',
                    body: '<p>Certain features (payments, KYC, SMS verification) necessarily involve trusted processing partners — for example, payment processing or identity verification providers — to function at all. Empyrean shares only what each partner needs to perform that specific service, never sells personal data for advertising, and this is detailed fully in the platform\u2019s Privacy Policy.</p>' },
                { id: 'compromised-accounts', title: 'If your account is compromised', kw: 'hacked stolen unauthorized access',
                    body: '<p>If you notice activity you didn\u2019t take (posts, messages, withdrawal attempts):</p>' +
                        '<ol><li>Change your password immediately from a device you trust — Settings → Account → Password.</li>' +
                        '<li>Revoke active sessions you don\u2019t recognise under Settings → Security → Active Sessions.</li>' +
                        '<li>Contact support right away, especially if any withdrawal or payment activity is involved, so it can be frozen pending review.</li></ol>'
                },
                { id: 'report-child-safety-concern', title: 'Report a child safety concern', kw: 'child safety csae csam abuse exploitation minor report',
                    body: '<p>Empyrean has a <strong>zero-tolerance policy</strong> for content or behavior that sexualizes, exploits, or endangers a minor — including child sexual abuse material (CSAM), grooming, and solicitation of a minor. Any account found doing this is suspended immediately, its content removed, and the matter is reported to the appropriate authorities, including the National Center for Missing &amp; Exploited Children (NCMEC) where required by law.</p>' +
                        '<p><strong>To report it in-app:</strong> open the ⋮ menu on the reel, post, listing, seller profile, or conversation and choose <strong>Report</strong>, then select <strong>"Child sexual abuse or exploitation"</strong> as the reason. Reports flagged this way are routed for immediate review, ahead of the normal report queue.</p>' +
                        '<p>You can also email our Safety &amp; Security team directly at <a href="mailto:support@joinempyrean.com">support@joinempyrean.com</a>. Our full published standards are at <a href="/child-safety" target="_blank" rel="noopener">joinempyrean.com/child-safety</a>.</p>'
                }
            ]
        }
    ];

    // Flat search index: every article, plus its parent category label.
    var SEARCH_INDEX = [];
    CATEGORIES.forEach(function (cat) {
        cat.subs.forEach(function (sub) {
            SEARCH_INDEX.push({ cat: cat.id, catTitle: cat.title, id: sub.id, title: sub.title, kw: (sub.kw || '').toLowerCase() });
        });
    });

    function findArticle(catId, subId) {
        var cat = CATEGORIES.filter(function (c) { return c.id === catId; })[0];
        if (!cat) return null;
        var sub = cat.subs.filter(function (s) { return s.id === subId; })[0];
        if (!sub) return null;
        return { cat: cat, sub: sub };
    }

    function searchArticles(q) {
        q = (q || '').trim().toLowerCase();
        if (!q) return [];
        return SEARCH_INDEX.filter(function (a) {
            return a.title.toLowerCase().indexOf(q) !== -1 || a.kw.indexOf(q) !== -1 || a.catTitle.toLowerCase().indexOf(q) !== -1;
        }).slice(0, 6);
    }

    /* ═══════════════════════════════════════════════════════════════════
       §2  MARKUP + RENDERING
       ═══════════════════════════════════════════════════════════════════ */

    var SUPPORT_EMAIL = 'chiefadmin@empyreanhumanitarianfoundation.com';
    var els = {};
    var state = { view: 'list', openCategory: null, article: null };

    function icon(svg, cls) {
        return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svg + '</svg>';
    }

    function buildOverlay() {
        var overlay = document.createElement('div');
        overlay.id = 'emp-help-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Help & Assistance Center');
        overlay.innerHTML =
            '<div class="emp-help-panel">' +
            '  <div class="emp-help-header">' +
            '    <button type="button" class="emp-help-back" aria-label="Back" style="display:none">' + icon(ICONS.back) + '</button>' +
            '    <div class="emp-help-header-text">' +
            '      <span class="emp-help-eyebrow">Empyrean Support</span>' +
            '      <h2>Help &amp; Assistance Center</h2>' +
            '    </div>' +
            '    <button type="button" class="emp-help-close" aria-label="Close Help Center">' + icon(ICONS.close) + '</button>' +
            '  </div>' +
            '  <div class="emp-help-search-wrap">' +
            '    <span class="emp-help-search-icon">' + icon(ICONS.search) + '</span>' +
            '    <input type="text" class="emp-help-search" placeholder="Search for help — e.g. \u201clocked account\u201d, \u201cwithdrawal\u201d" autocomplete="off" aria-label="Search help articles">' +
            '    <div class="emp-help-suggestions" hidden></div>' +
            '  </div>' +
            '  <div class="emp-help-body"><div class="emp-help-body-inner"></div></div>' +
            '</div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function renderCategoryList() {
        var html = '';
        CATEGORIES.forEach(function (cat) {
            var isOpen = state.openCategory === cat.id;
            html += '<div class="emp-help-cat' + (isOpen ? ' is-open' : '') + '" data-cat="' + cat.id + '">' +
                '<button type="button" class="emp-help-cat-head">' +
                '<span class="emp-help-cat-icon">' + icon(cat.icon) + '</span>' +
                '<span class="emp-help-cat-title">' + cat.title + '</span>' +
                '<span class="emp-help-cat-chevron">' + icon(ICONS.chevron) + '</span>' +
                '</button>' +
                '<div class="emp-help-cat-body">' +
                '<ul class="emp-help-sub-list">' +
                cat.subs.map(function (s) {
                    return '<li><button type="button" class="emp-help-sub-btn" data-cat="' + cat.id + '" data-sub="' + s.id + '">' +
                        '<span>' + s.title + '</span>' + icon(ICONS.chevron, 'emp-help-sub-chev') + '</button></li>';
                }).join('') +
                '</ul>' +
                '<button type="button" class="emp-help-seeall" data-cat="' + cat.id + '">See all articles in ' + cat.title + '</button>' +
                '</div>' +
                '</div>';
        });
        html += '<div class="emp-help-contact-row">' +
            '<p>Can\u2019t find what you\u2019re looking for?</p>' +
            '<button type="button" class="emp-help-contact-btn">' + icon(ICONS.support) + ' Contact Support</button>' +
            '</div>';
        els.bodyInner.innerHTML = html;
        els.backBtn.style.display = 'none';
    }

    function renderArticle(catId, subId) {
        var found = findArticle(catId, subId);
        if (!found) return renderCategoryList();
        state.view = 'article';
        state.article = { cat: catId, sub: subId };
        els.bodyInner.innerHTML =
            '<div class="emp-help-article">' +
            '<span class="emp-help-breadcrumb">' + found.cat.title + '</span>' +
            '<h3>' + found.sub.title + '</h3>' +
            '<div class="emp-help-article-body">' + found.sub.body + '</div>' +
            '<div class="emp-help-article-footer">' +
            '<p>Still need help with this?</p>' +
            '<button type="button" class="emp-help-contact-btn">' + icon(ICONS.support) + ' Contact Support</button>' +
            '</div>' +
            '</div>';
        els.bodyInner.scrollTop = 0;
        els.backBtn.style.display = 'flex';
    }

    function openArticleFromSearch(item) {
        closeSuggestions();
        els.search.value = '';
        renderArticle(item.cat, item.id);
    }

    function closeSuggestions() {
        els.suggestions.hidden = true;
        els.suggestions.innerHTML = '';
    }

    function renderSuggestions(q) {
        var results = searchArticles(q);
        if (!results.length) { closeSuggestions(); return; }
        els.suggestions.innerHTML = results.map(function (r) {
            return '<button type="button" class="emp-help-suggestion" data-cat="' + r.cat + '" data-sub="' + r.id + '">' +
                '<span class="emp-help-suggestion-title">' + r.title + '</span>' +
                '<span class="emp-help-suggestion-cat">' + r.catTitle + '</span></button>';
        }).join('');
        els.suggestions.hidden = false;
    }

    function contactSupport() {
        var subject = encodeURIComponent('Help Center — Support Request');
        var body = encodeURIComponent('Hi Empyrean Support Team,\n\nI need help with:\n\n(Please describe your issue here.)\n');
        window.location.href = 'mailto:' + SUPPORT_EMAIL + '?subject=' + subject + '&body=' + body;
    }

    /* ═══════════════════════════════════════════════════════════════════
       §3  OPEN / CLOSE + EVENT WIRING
       ═══════════════════════════════════════════════════════════════════ */

    var wired = false;
    function ensureOverlay() {
        var overlay = document.getElementById('emp-help-overlay');
        if (!overlay) overlay = buildOverlay();
        els.overlay = overlay;
        els.panel = overlay.querySelector('.emp-help-panel');
        els.bodyInner = overlay.querySelector('.emp-help-body-inner');
        els.search = overlay.querySelector('.emp-help-search');
        els.suggestions = overlay.querySelector('.emp-help-suggestions');
        els.closeBtn = overlay.querySelector('.emp-help-close');
        els.backBtn = overlay.querySelector('.emp-help-back');

        if (wired) return overlay;
        wired = true;

        els.closeBtn.addEventListener('click', closeHelpCenter);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeHelpCenter(); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeHelpCenter();
        });

        els.backBtn.addEventListener('click', function () {
            state.view = 'list';
            state.article = null;
            renderCategoryList();
        });

        els.bodyInner.addEventListener('click', function (e) {
            var catHead = e.target.closest('.emp-help-cat-head');
            if (catHead) {
                var catEl = catHead.closest('.emp-help-cat');
                var id = catEl.getAttribute('data-cat');
                state.openCategory = (state.openCategory === id) ? null : id;
                renderCategoryList();
                return;
            }
            var subBtn = e.target.closest('.emp-help-sub-btn');
            if (subBtn) { renderArticle(subBtn.getAttribute('data-cat'), subBtn.getAttribute('data-sub')); return; }

            var seeAll = e.target.closest('.emp-help-seeall');
            if (seeAll) { state.openCategory = seeAll.getAttribute('data-cat'); renderCategoryList(); return; }

            var contactBtn = e.target.closest('.emp-help-contact-btn');
            if (contactBtn) { contactSupport(); return; }
        });

        els.search.addEventListener('input', function () { renderSuggestions(els.search.value); });
        els.search.addEventListener('focus', function () { if (els.search.value) renderSuggestions(els.search.value); });
        els.suggestions.addEventListener('click', function (e) {
            var s = e.target.closest('.emp-help-suggestion');
            if (!s) return;
            openArticleFromSearch({ cat: s.getAttribute('data-cat'), id: s.getAttribute('data-sub') });
        });
        document.addEventListener('click', function (e) {
            if (!els.suggestions || els.suggestions.hidden) return;
            if (!e.target.closest('.emp-help-search-wrap')) closeSuggestions();
        });

        return overlay;
    }

    function openHelpCenter() {
        var overlay = ensureOverlay();
        state.view = 'list';
        state.openCategory = null;
        state.article = null;
        renderCategoryList();
        overlay.classList.add('is-open');
        document.body.classList.add('emp-help-lock-scroll');
        setTimeout(function () { els.search.focus(); }, 220);
    }

    function closeHelpCenter() {
        if (!els.overlay) return;
        els.overlay.classList.remove('is-open');
        document.body.classList.remove('emp-help-lock-scroll');
        closeSuggestions();
    }

    /* Exposed so the sidebar "Help & Assistance Center" nav item (added by
       app-nav.js) can open this panel directly instead of trying to
       navigate to a section that doesn't exist. */
    window._empOpenHelpCenter = openHelpCenter;

    /* ═══════════════════════════════════════════════════════════════════
       §4  SETTINGS ENTRY POINT (+ §FAB fallback)
       ═══════════════════════════════════════════════════════════════════ */

    function buildSettingsRow() {
        var wrap = document.createElement('div');
        wrap.id = 'emp-help-settings-entry';
        wrap.className = 'emp-help-settings-banner';
        wrap.innerHTML =
            '<span class="emp-help-settings-eyebrow">Settings / Self Help Assistance Center</span>';

        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'emp-form-card emp-help-entry-card';
        row.innerHTML =
            '<span class="emp-help-entry-icon">' + icon(ICONS.support) + '</span>' +
            '<span class="emp-help-entry-text">' +
            '<strong>Help &amp; Assistance Center</strong>' +
            '<span>Search articles or contact support</span>' +
            '</span>' +
            '<span class="emp-help-entry-chevron">' + icon(ICONS.chevron) + '</span>';
        row.addEventListener('click', openHelpCenter);

        wrap.appendChild(row);
        return wrap;
    }

    function insertSettingsEntry() {
        if (document.getElementById('emp-help-settings-entry')) return true;

        // Preferred: the very top of the tab content area inside #settings,
        // so the banner sits above whichever settings tab (Profile,
        // Security, Privacy, Terms, E-Commerce, Help) is currently active —
        // i.e. it always appears BEFORE those tabs' own content, every time
        // the Settings section is opened, regardless of which tab is showing.
        var cardContent = document.querySelector('#settings .card-content');
        if (cardContent) {
            cardContent.insertBefore(buildSettingsRow(), cardContent.firstChild);
            return true;
        }

        // Next preference: a dedicated #settings container — append at the end.
        var settingsRoot = document.getElementById('settings');
        if (settingsRoot) {
            settingsRoot.appendChild(buildSettingsRow());
            return true;
        }

        // Fallback: known sibling from app-patch-v46.js — insert right after it.
        var profileForm = document.getElementById('profile-info-form') || document.getElementById('settings-profile');
        if (profileForm) {
            var anchor = profileForm.closest('.emp-form-card') || profileForm;
            anchor.parentNode.insertBefore(buildSettingsRow(), anchor.nextSibling);
            return true;
        }

        return false;
    }

    /* §FAB — persistent floating fallback trigger. Safe to delete this
       block if the in-Settings entry above is confirmed working and you
       don't want a second access point. */
    var fab = null;
    function ensureFab() {
        if (fab) return;
        fab = document.createElement('button');
        fab.type = 'button';
        fab.id = 'emp-help-fab';
        fab.setAttribute('aria-label', 'Open Help & Assistance Center');
        fab.title = 'Help & Assistance Center';
        fab.innerHTML = icon(ICONS.support);
        fab.addEventListener('click', openHelpCenter);
        document.body.appendChild(fab);
    }

    /* ═══════════════════════════════════════════════════════════════════
       §5  STYLES
       ═══════════════════════════════════════════════════════════════════ */

    var style = document.createElement('style');
    style.textContent = [
        /* ---- design tokens, with safe fallbacks if token.css vars are absent ---- */
        '#emp-help-overlay{--eh-blue:var(--primary-blue,#1B2B8B);--eh-gold:var(--color-gold,#D4AF37);',
        '--eh-ink:var(--text-primary,#1A1D2E);--eh-muted:var(--text-secondary,#6B7080);',
        '--eh-bg:var(--surface-elevated,#FFFDF8);--eh-line:rgba(27,43,139,0.10);',
        '--eh-font-display:var(--font-display,"Fraunces",Georgia,serif);',
        '--eh-font-body:var(--font-body,"Manrope","Segoe UI",sans-serif);}',

        /* ---- overlay + panel ---- */
        '#emp-help-overlay{position:fixed;inset:0;z-index:10500;display:flex;align-items:flex-end;justify-content:center;',
        'background:rgba(12,16,40,0.55);backdrop-filter:blur(3px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .25s ease,visibility 0s linear .25s;font-family:var(--eh-font-body);}',
        /* FIX (2026-10-04): once opened, this full-screen z-index:10500 backdrop-filter layer stayed in the DOM
           hidden only by opacity:0, which several non-Chrome engines don't fully honor for backdrop-filter --
           leaving the whole app blurred. visibility:hidden removes it from painting entirely while closed. */
        '#emp-help-overlay.is-open{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .25s ease,visibility 0s linear 0s;}',
        'body.emp-help-lock-scroll{overflow:hidden;}',
        '.emp-help-panel{width:100%;max-width:600px;max-height:88vh;background:var(--eh-bg);border-radius:22px 22px 0 0;',
        'box-shadow:0 -12px 48px rgba(10,14,40,0.35);display:flex;flex-direction:column;overflow:hidden;',
        'transform:translateY(24px);transition:transform .28s cubic-bezier(.2,.8,.2,1);position:relative;}',
        '#emp-help-overlay.is-open .emp-help-panel{transform:translateY(0);}',
        '.emp-help-panel::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;',
        'background:linear-gradient(90deg,var(--eh-gold),var(--eh-blue),var(--eh-gold));}',
        '@media (min-width:640px){#emp-help-overlay{align-items:center;}.emp-help-panel{border-radius:22px;max-height:82vh;}}',

        /* ---- header ---- */
        '.emp-help-header{display:flex;align-items:center;gap:12px;padding:20px 20px 14px;border-bottom:1px solid var(--eh-line);}',
        '.emp-help-header-text{flex:1;display:flex;flex-direction:column;gap:2px;}',
        '.emp-help-eyebrow{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--eh-gold);font-weight:700;}',
        '.emp-help-header-text h2{margin:0;font-family:var(--eh-font-display);font-weight:600;font-size:22px;color:var(--eh-ink);letter-spacing:.01em;}',
        '.emp-help-back,.emp-help-close{flex-shrink:0;width:36px;height:36px;border-radius:50%;border:1px solid var(--eh-line);',
        'background:#fff;color:var(--eh-blue);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s;}',
        '.emp-help-back svg,.emp-help-close svg{width:17px;height:17px;}',
        '.emp-help-back:hover,.emp-help-close:hover{background:rgba(27,43,139,0.07);}',

        /* ---- search ---- */
        '.emp-help-search-wrap{position:relative;padding:16px 20px 4px;}',
        '.emp-help-search-icon{position:absolute;left:34px;top:32px;color:var(--eh-muted);pointer-events:none;}',
        '.emp-help-search-icon svg{width:17px;height:17px;}',
        '.emp-help-search{width:100%;box-sizing:border-box;padding:13px 16px 13px 42px;border-radius:14px;',
        'border:1.5px solid var(--eh-line);background:#fff;font-family:var(--eh-font-body);font-size:14.5px;color:var(--eh-ink);',
        'outline:none;transition:border-color .15s, box-shadow .15s;}',
        '.emp-help-search:focus{border-color:var(--eh-gold);box-shadow:0 0 0 3px rgba(212,175,55,0.18);}',
        '.emp-help-search::placeholder{color:var(--eh-muted);}',
        '.emp-help-suggestions{position:absolute;left:20px;right:20px;top:66px;background:#fff;border-radius:14px;',
        'border:1px solid var(--eh-line);box-shadow:0 14px 34px rgba(10,14,40,0.18);overflow:hidden;z-index:2;}',
        '.emp-help-suggestion{width:100%;text-align:left;padding:11px 16px;background:none;border:none;cursor:pointer;',
        'display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid var(--eh-line);}',
        '.emp-help-suggestion:last-child{border-bottom:none;}',
        '.emp-help-suggestion:hover{background:rgba(27,43,139,0.06);}',
        '.emp-help-suggestion-title{font-size:13.5px;color:var(--eh-ink);font-weight:600;}',
        '.emp-help-suggestion-cat{font-size:11px;color:var(--eh-muted);flex-shrink:0;}',

        /* ---- body / categories ---- */
        '.emp-help-body{flex:1;overflow-y:auto;padding:14px 20px 24px;}',
        '.emp-help-cat{border:1px solid var(--eh-line);border-radius:16px;margin-bottom:10px;overflow:hidden;background:#fff;}',
        '.emp-help-cat-head{width:100%;display:flex;align-items:center;gap:12px;padding:15px 16px;background:none;border:none;cursor:pointer;text-align:left;}',
        '.emp-help-cat-icon{width:34px;height:34px;flex-shrink:0;border-radius:10px;display:flex;align-items:center;justify-content:center;',
        'background:linear-gradient(135deg,var(--eh-blue),#2C3FA8);color:#fff;}',
        '.emp-help-cat-icon svg{width:17px;height:17px;}',
        '.emp-help-cat-title{flex:1;font-weight:700;font-size:15px;color:var(--eh-ink);font-family:var(--eh-font-display);}',
        '.emp-help-cat-chevron{color:var(--eh-muted);transition:transform .2s;}',
        '.emp-help-cat-chevron svg{width:16px;height:16px;transform:rotate(90deg);}',
        '.emp-help-cat.is-open .emp-help-cat-chevron svg{transform:rotate(-90deg);}',
        '.emp-help-cat-body{max-height:0;overflow:hidden;transition:max-height .25s ease;}',
        '.emp-help-cat.is-open .emp-help-cat-body{max-height:900px;}',
        '.emp-help-sub-list{list-style:none;margin:0;padding:0 8px;}',
        '.emp-help-sub-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;',
        'padding:11px 12px;background:none;border:none;border-top:1px solid var(--eh-line);text-align:left;',
        'font-family:var(--eh-font-body);font-size:13.5px;color:var(--eh-ink);cursor:pointer;}',
        '.emp-help-sub-btn:hover{color:var(--eh-blue);}',
        '.emp-help-sub-chev{width:14px;height:14px;color:var(--eh-muted);flex-shrink:0;}',
        '.emp-help-seeall{display:block;width:calc(100% - 24px);margin:8px 12px 12px;padding:9px;border-radius:10px;',
        'border:1px dashed var(--eh-gold);background:rgba(212,175,55,0.08);color:#8a6c14;font-size:12.5px;font-weight:700;',
        'cursor:pointer;text-align:center;}',

        /* ---- contact row ---- */
        '.emp-help-contact-row{text-align:center;padding:18px 10px 4px;}',
        '.emp-help-contact-row p{margin:0 0 10px;color:var(--eh-muted);font-size:13px;}',
        '.emp-help-contact-btn{display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:50px;',
        'border:none;cursor:pointer;font-weight:700;font-size:13.5px;color:#fff;',
        'background:linear-gradient(120deg,var(--eh-blue),#2C3FA8);box-shadow:0 8px 20px rgba(27,43,139,0.28);}',
        '.emp-help-contact-btn svg{width:16px;height:16px;}',
        '.emp-help-contact-btn:hover{filter:brightness(1.07);}',

        /* ---- article view ---- */
        '.emp-help-article{padding:2px 2px 8px;}',
        '.emp-help-breadcrumb{display:inline-block;font-size:11px;letter-spacing:.07em;text-transform:uppercase;',
        'color:var(--eh-gold);font-weight:700;margin-bottom:6px;}',
        '.emp-help-article h3{margin:0 0 14px;font-family:var(--eh-font-display);font-size:21px;font-weight:600;color:var(--eh-ink);}',
        '.emp-help-article-body{font-size:14px;line-height:1.7;color:#3A3F55;}',
        '.emp-help-article-body p{margin:0 0 12px;}',
        '.emp-help-article-body ul,.emp-help-article-body ol{margin:0 0 12px;padding-left:20px;}',
        '.emp-help-article-body li{margin-bottom:6px;}',
        '.emp-help-article-footer{margin-top:22px;padding-top:18px;border-top:1px solid var(--eh-line);text-align:center;}',
        '.emp-help-article-footer p{margin:0 0 10px;color:var(--eh-muted);font-size:13px;}',

        /* ---- Settings entry row ---- */
        '.emp-help-settings-banner{margin:2px 0 14px;}',
        '.emp-help-settings-eyebrow{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;',
        'color:var(--eh-muted,#6B7080);font-weight:700;margin:0 0 8px 2px;}',
        '.emp-help-entry-card{width:100%;box-sizing:border-box;display:flex;align-items:center;gap:14px;',
        'padding:16px 18px;border-radius:16px;border:1px solid var(--eh-line, rgba(27,43,139,0.10));background:#fff;',
        'cursor:pointer;text-align:left;font-family:inherit;margin:10px 0;transition:box-shadow .15s;}',
        '.emp-help-entry-card:hover{box-shadow:0 6px 18px rgba(27,43,139,0.12);}',
        '.emp-help-entry-icon{width:40px;height:40px;flex-shrink:0;border-radius:12px;display:flex;align-items:center;justify-content:center;',
        'background:linear-gradient(135deg,#1B2B8B,#2C3FA8);color:#fff;}',
        '.emp-help-entry-icon svg{width:19px;height:19px;}',
        '.emp-help-entry-text{flex:1;display:flex;flex-direction:column;gap:2px;}',
        '.emp-help-entry-text strong{font-size:14.5px;color:#1A1D2E;}',
        '.emp-help-entry-text span{font-size:12.5px;color:#6B7080;}',
        '.emp-help-entry-chevron{color:#6B7080;}',
        '.emp-help-entry-chevron svg{width:16px;height:16px;}',

        /* ---- §FAB fallback ---- */
        '#emp-help-fab{position:fixed;right:16px;bottom:170px;z-index:9998;width:46px;height:46px;border-radius:50%;',
        'border:none;background:linear-gradient(135deg,#1B2B8B,#2C3FA8);color:#fff;box-shadow:0 6px 18px rgba(27,43,139,0.4);',
        'display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
        '#emp-help-fab svg{width:20px;height:20px;}',
        '#emp-help-fab:active{transform:scale(.93);}',
        '@media (min-width:768px){#emp-help-fab{right:24px;bottom:32px;}}'
    ].join('');
    document.head.appendChild(style);

    /* ═══════════════════════════════════════════════════════════════════
       §6  BOOT + DEFENSIVE RE-MOUNT (matches app-patch-v46/v48 convention)
       ═══════════════════════════════════════════════════════════════════ */

    // FIX (dashboard clash — "Hide the help center icon on the home
    // page"): the FAB had no per-section visibility logic at all — it was
    // a single document.body.appendChild at boot, always on screen,
    // fixed at right:16px/bottom:170px, colliding with the home
    // dashboard's Quick Post FAB / Report entry / stream-replays button
    // (see the matching app-patch-v42.js fix for that button, same
    // session). Scoped narrowly: hidden ONLY on #dashboard; every other
    // section keeps the fallback launcher exactly as before.
    function updateFabVisibility() {
        if (!fab) return;
        var dash = document.getElementById('dashboard');
        var onDashboard = !!(dash && dash.classList.contains('active'));
        fab.style.display = onDashboard ? 'none' : '';
    }

    function attemptMount() {
        var placed = insertSettingsEntry();
        ensureFab(); // always present as a guaranteed fallback entry point
        updateFabVisibility();
        return placed;
    }

    function ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }

    ready(function () {
        attemptMount();
        setInterval(attemptMount, 2000); // Settings section may re-render its inner markup
    });

    document.addEventListener('empyrean-section-change', function (e) {
        if (e && e.detail && e.detail.section === 'settings') setTimeout(attemptMount, 0);
        updateFabVisibility();
    });

    console.log('[EmpyreanSelfHelpAssistanceCenter] \u2705 Help & Assistance Center wired: search + ' + CATEGORIES.length + ' categories / ' + SEARCH_INDEX.length + ' articles, banner mounted at the top of Settings + sidebar entry + persistent fallback launcher.');

})();