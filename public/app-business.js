/* safeFileClick: prevents Android gallery-reopening on file inputs */
function safeFileClick(el) {
    if (!el) return;
    var now = Date.now();
    if (el._lastClick && (now - el._lastClick) < 1000) return;
    el._lastClick = now;
    el.click();
}

/* =============================================================================
   EMPYREAN INTERNATIONAL — BUSINESS PAGE MODULE
   app-business.js  |  v3.1  |  Complete rewrite
   =============================================================================

   PURPOSE
   ───────
   Standalone module that owns everything related to Business Pages:

     • renderBusinessPage(bizId)    — full page renderer into #business-page
     • renderDashboardBusinesses()  — dashboard business-pages slider
     • submitBusinessPost()         — create/upload a post for the page
     • Post composer ownership      — owner sees composer, visitors never do
     • Business posts feed          — product/listing cards with media
     • Create business page form    — modal wire-up with Cloudinary upload

   DESIGN REFERENCES
   ─────────────────
   Facebook business pages (cover + avatar + about + tabs + posts)
   with Empyrean brand colours (navy #0A0E27 / royal #1B2B8B / violet #5B0EA6)

   FIRESTORE COLLECTIONS
   ─────────────────────
   business_pages   — page documents  { id, ownerId, name, industry, bio,
                                        coverPhoto, profilePhoto, website,
                                        email, phone, followers[], createdAt }
   business_posts   — post documents  { id, pageId, userId, text, media[],
                                        pageName, createdAt, likes, comments }

   DOM TARGETS
   ───────────
   #business-page              — section that receives full rendered page
   #dashboard-bizposts-container / #dashboard-bizposts-slider  — dashboard strip
   #dashboard-business-container / #dashboard-business-slider  — alias strip (§14 compat)
   #create-business-page-form  — create-page modal form
   window._activeBizPageId     — shared state: currently viewed biz page id
   window._activeBizData       — shared state: currently viewed biz page data
   window._firestoreBusinessPages — shared cache of all fetched pages

   PUBLIC API
   ──────────
   window.renderBusinessPage(bizId)
   window.renderDashboardBusinesses()
   window.submitBusinessPost()

   SECTION MAP
   ───────────
   §1  Module guard + state helpers
   §2  HTML escape / attribute escape utilities
   §3  Cloudinary upload helper
   §4  Create Business Page modal — form wire-up
   §5  renderBusinessPage(bizId) — full page renderer
   §6  renderDashboardBusinesses() — dashboard slider
   §7  submitBusinessPost() — post creation
   §8  Post composer ownership enforcement
   §9  Navigation + section-change listeners
   §10 Dashboard business posts (product cards) slider — #dashboard-bizposts-slider

   ============================================================================= */

(function empyreanBusinessModule() {
    'use strict';

    /* =========================================================================
       §1  MODULE GUARD + STATE HELPERS
       ========================================================================= */

    if (window._empyreanBusinessLoaded) {
        console.warn('[EmpBusiness] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanBusinessLoaded = true;

    /* FIX (2026-08-06 — "switch to a new account, the OLD account's
       business page is still there"): renderBusinessPage() (§5 below)
       trusts window._activeBizData / window._activeBizPageId /
       window._firestoreBusinessPages as a cache and renders straight from
       them whenever they already "match" the requested id — but nothing
       in the app ever cleared those three globals on sign-out. They live
       outside EmpState (see app-state.js's own reset(), which resets
       userState/isGuest/etc. but was never told about this module's own
       state), so after Account A logs out and Account B logs in, this
       module was still holding Account A's page object/id in memory —
       and since window._activeBizPageId was still non-empty,
       renderBusinessPage() (called with no argument, which is the normal
       case on section-navigate) fell back to that stale id, found its own
       stale cached object still "matching," and rendered Account A's
       page under Account B's session. Not a per-render bug — a state-
       lifecycle gap.
       FIX: clear all three on the SAME 'empyrean:logout' event
       signOutUser() (app-auth.js) already dispatches for exactly this
       kind of per-file teardown — app-patch-v20.js's Marketplace/
       Broadcasts listeners already hook this same event for their own
       state. Once cleared, the next renderBusinessPage() call (fired
       automatically on the following login's own 'empyrean-init-done' —
       see this file's own listener further below, which already re-
       renders the business-page section if it's the active one) has
       nothing stale left to fall back to, so it correctly re-derives the
       page from the NEWLY logged-in account's own us.businessPage /
       businessPages instead. */
    document.addEventListener('empyrean:logout', function () {
        window._activeBizData         = null;
        window._activeBizPageId       = '';
        window._firestoreBusinessPages = [];
        window._bizPendingMedia       = []; // any unposted composer attachments — shouldn't carry into the next account either
        console.log('[EmpBusiness] Cleared cached business-page state on logout — next render starts fresh from whichever account logs in next.');
    });

    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    function _isGuest() { var s = _S(); return s.isGuest != null ? !!s.isGuest : !!window.isGuest; }
    function _isAdmin() { return !!(window.isAdmin || (_S().isAdmin)); }
    function _fbOk()    { return !!(window._firebaseLoaded && window.fbDb); }

    /* Users may own up to this many business pages. */
    var MAX_BIZ_PAGES = 5;

    /**
     * Returns the array of business pages owned by the given user (or the
     * current user if omitted). Reads the new `businessPages` array field,
     * falling back to the legacy singular `businessPage` field for accounts
     * that only have that (pre-multi-page accounts) so nothing already
     * created is lost. Never returns more than MAX_BIZ_PAGES entries.
     */
    function _myPages(us) {
        us = us || _us();
        var arr = Array.isArray(us.businessPages) ? us.businessPages.slice() : [];
        if (!arr.length && us.businessPage && typeof us.businessPage === 'object') {
            arr = [us.businessPage];
        }
        return arr.slice(0, MAX_BIZ_PAGES);
    }

    function ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }


    /* =========================================================================
       §2  UTILITIES
       ========================================================================= */

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _attr(s) { return String(s || '').replace(/"/g, '&quot;'); }

    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(msg, type || 'info');
        }
    }

    function _ts(createdAt) {
        if (!createdAt) return '';
        var d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
        /* FIX (request — "add published timeline date, minutes and seconds
           a publication was made"): was date-only ("7 Aug 2026"). Now
           appends the exact time, down to the second, so a post's header
           reads e.g. "7 Aug 2026, 09:55:12 AM". */
        var datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        var timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        return datePart + ', ' + timePart;
    }


    /* =========================================================================
       §3  MEDIA UPLOAD HELPER
       ─────────────────────────────────────────────────────────────────────
       FIX (2026-08-06 — business cover/profile photo + listing media all
       failing "Media upload failed: HTTP 401"): this function was still
       posting directly to Cloudinary (api.cloudinary.com, upload_preset
       'ehfapp_preset') — the OLD storage backend, left over from before the
       app migrated to Firebase Storage. Every OTHER upload path in this
       codebase (avatar, posts, reels, chat, KYC, news…) already goes
       through window.uploadToCloudinary, which — despite the legacy name —
       is Firebase-Storage-backed (see Store_firebase.js's storage.rules
       comment and app-fixes.js's own uploadToCloudinary rewrite note).
       app-business.js's own _uploadMedia() was never migrated, so every
       cover photo, profile photo, and marketplace-style listing image
       posted from a business page was still hitting the old Cloudinary
       account/preset directly — which now rejects with a plain HTTP 401
       (unsigned-upload preset no longer valid), exactly matching the
       screenshot's "Media upload failed: HTTP 401".

       FIX: delegate to window.uploadToCloudinary (Firebase Storage) —
       same function every other upload path already relies on, so this
       now goes through its owner-segmented path + auth + retry logic
       instead of a second, independent (and broken) upload backend.
       Falls back to the old direct-Cloudinary path ONLY if
       window.uploadToCloudinary somehow never loaded, so this can't make
       things worse if app-dom.js/app-fixes.js haven't defined it yet.

       SPEED: client-side image compression is applied once, app-wide, at
       the window.uploadToCloudinary level itself (see app-startup.js's
       "SPEED — compress images before every upload" section) — so this
       function doesn't need its own copy; every caller of
       window.uploadToCloudinary, this one included, gets the smaller/
       faster upload automatically and consistently.
       ========================================================================= */

    function _uploadMediaLegacyCloudinary(file) {
        return new Promise(function (resolve, reject) {
            var isVid = file.type && file.type.startsWith('video/');
            var _cfg  = (window._appConfig && window._appConfig.cloudinary) || {};
            var _cloud  = _cfg.cloud  || 'dxwmts9vw';
            var _preset = _cfg.preset || 'ehfapp_preset';
            var fd = new FormData();
            fd.append('file', file);
            fd.append('upload_preset', _preset);
            fd.append('tags', 'empyrean_business');
            fetch('https://api.cloudinary.com/v1_1/' + _cloud + '/' + (isVid ? 'video' : 'image') + '/upload', {
                method: 'POST', body: fd
            })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (d) { if (!d.secure_url) throw new Error('No URL'); resolve(d.secure_url); })
            .catch(reject);
        });
    }

    function _uploadMedia(file, onProgress) {
        if (!file) return Promise.reject(new Error('No file'));
        if (typeof window.uploadToCloudinary === 'function') {
            return window.uploadToCloudinary(file, onProgress || null);
        }
        console.warn('[EmpBusiness] window.uploadToCloudinary not available yet — falling back to legacy direct-Cloudinary upload, which is expected to fail (HTTP 401) since that preset/account is no longer active.');
        return _uploadMediaLegacyCloudinary(file);
    }
    window._bizUploadMedia = _uploadMedia;


    /* =========================================================================
       §3.5  BUSINESS CATEGORY SYSTEM
       ─────────────────────────────────────────────────────────────────────
       Implements the "Category Selection → Dynamic Page Model" spec: seven
       organisation categories, each with its own tailored composer fields
       and its own set of on-page features (key-feature chips, info panels,
       and interactive CTAs like Donate / Volunteer / Book / Feedback).

       BIZ_CATEGORIES     — single source of truth: id, label, icon, brand
                             colour, short description, the spec's own
                             "Key Features" list (display chips), and the
                             composer fields captured into categoryData.
       _resolveCategory()  — maps a page's stored category (or, for pages
                             created before this system existed, its legacy
                             free-text `industry` string) to one of the
                             seven ids, defaulting safely to 'service' —
                             never leaves a page without a template.
       Rendering helpers    — shared by the Create-Page modal, the Edit
                             Page panel, and the live page itself, so the
                             exact same field set/markup is used everywhere
                             a category's data is entered or displayed.
       ========================================================================= */

    var BIZ_CATEGORY_ORDER = ['ngo', 'bank', 'government', 'international', 'oilgas', 'service', 'product'];

    var BIZ_CATEGORIES = {
        ngo: {
            id: 'ngo', label: 'NGOs / Nonprofits', icon: 'fa-hand-holding-heart', color: '#0EA5A4',
            description: 'Mission-driven organisations, charities & community initiatives.',
            keyFeatures: ['Mission & Vision', 'Services Offered', 'Donation Button', 'Volunteer Sign-Up', 'Transparency Reports', 'Impact Metrics', 'Beneficiary Stories', 'Community Events'],
            fields: [
                { key: 'mission', label: 'Mission & Vision', type: 'textarea', placeholder: 'What drives your organisation, and what future are you working toward?' },
                { key: 'servicesOffered', label: 'Services Offered', type: 'textarea', placeholder: 'e.g. Free healthcare outreach, School feeding programme, Clean water projects (one per line)' },
                { key: 'donationLink', label: 'Donation Link (optional)', type: 'url', placeholder: 'https://... external donation/payment page, if you have one' },
                { key: 'impactMetrics', label: 'Impact Metrics', type: 'textarea', placeholder: 'e.g. 12,000 people served (one per line)' },
                { key: 'beneficiaryStories', label: 'Beneficiary Stories', type: 'textarea', placeholder: 'Share a short story about someone your work has helped.' },
                { key: 'transparencyReports', label: 'Transparency / Annual Reports (links)', type: 'textarea', placeholder: 'One link per line — annual report, audited accounts, etc.' },
                { key: 'communityEvents', label: 'Upcoming Community Events', type: 'textarea', placeholder: 'e.g. Blood Donation Drive — 20 Sept, Lagos (one per line)' }
            ]
        },
        bank: {
            id: 'bank', label: 'Banks & Financial Institutions', icon: 'fa-building-columns', color: '#1B2B8B',
            description: 'Banks, microfinance, insurance & other regulated financial institutions.',
            keyFeatures: ['Services (Loans, Savings, Investments)', 'Branch Locator', 'ATM Map', 'Compliance Info', 'Customer Support Chat', 'Financial Literacy Resources', 'Secure Transaction Portal'],
            fields: [
                { key: 'services', label: 'Services Offered', type: 'textarea', placeholder: 'e.g. Personal Loans, Savings Accounts, Fixed Deposits, Investments (one per line)' },
                { key: 'branches', label: 'Branch Locations', type: 'textarea', placeholder: 'e.g. Victoria Island Branch — 12 Adeola Odeku St, Lagos — 6.4281,3.4219 (add "lat,lng" at the end of a line to pin it on the map; one location per line)' },
                { key: 'atmLocations', label: 'ATM Locations', type: 'textarea', placeholder: 'e.g. Ikeja City Mall ATM — 6.6018,3.3515 (add "lat,lng" at the end of a line to pin it on the map; one per line)' },
                { key: 'complianceInfo', label: 'Compliance / Regulatory Info', type: 'textarea', placeholder: 'e.g. Licensed by the Central Bank of Nigeria — RC1234567' },
                { key: 'financialLiteracyLinks', label: 'Financial Literacy Resources (links)', type: 'textarea', placeholder: 'One link per line' },
                { key: 'transactionPortalUrl', label: 'Secure Transaction Portal URL', type: 'url', placeholder: 'https://online.yourbank.com' }
            ]
        },
        government: {
            id: 'government', label: 'Government Ministries & Agencies', icon: 'fa-landmark-dome', color: '#0A0E27',
            description: 'Ministries, parastatals, agencies & public sector bodies.',
            keyFeatures: ['Mandate & Mission', 'Public Service Catalog', 'Downloadable Forms', 'Announcements', 'Citizen Feedback Portal', 'E-Governance Tools', 'Transparency Reports'],
            fields: [
                { key: 'mandate', label: 'Mandate & Mission', type: 'textarea', placeholder: 'What is this ministry/agency officially responsible for?' },
                { key: 'serviceCatalog', label: 'Public Service Catalog', type: 'textarea', placeholder: 'e.g. Passport Renewal, Business Registration, Tax Filing (one per line)' },
                { key: 'downloadableForms', label: 'Downloadable Forms (links)', type: 'textarea', placeholder: 'Form name — link (one per line)' },
                { key: 'announcements', label: 'Announcements', type: 'textarea', placeholder: 'Public notices, deadlines, policy updates (one per line)' },
                { key: 'egovTools', label: 'E-Governance Tools (links)', type: 'textarea', placeholder: 'e.g. Online Tax Portal — https://... (one per line)' },
                { key: 'transparencyReports', label: 'Transparency Reports (links)', type: 'textarea', placeholder: 'One link per line' }
            ]
        },
        international: {
            id: 'international', label: 'International Institutions', icon: 'fa-earth-africa', color: '#5B0EA6',
            description: 'UN agencies, multilateral bodies, embassies & global institutions.',
            keyFeatures: ['Global Programs', 'Multilingual Support', 'Partnerships', 'Impact Dashboards', 'Research Publications', 'Event Calendar', 'Collaboration Requests'],
            fields: [
                { key: 'globalPrograms', label: 'Global Programs', type: 'textarea', placeholder: 'e.g. Global Vaccination Initiative, Climate Resilience Fund (one per line)' },
                { key: 'languages', label: 'Languages Supported', type: 'text', placeholder: 'e.g. English, French, Spanish, Arabic' },
                { key: 'partnerships', label: 'Partnerships', type: 'textarea', placeholder: 'Partner organisations (one per line)' },
                { key: 'impactDashboard', label: 'Impact Dashboard (key stats)', type: 'textarea', placeholder: 'e.g. 54 countries reached | 2.1M beneficiaries (one per line)' },
                { key: 'researchPublications', label: 'Research Publications (links)', type: 'textarea', placeholder: 'Title — link (one per line)' },
                { key: 'eventCalendar', label: 'Event Calendar', type: 'textarea', placeholder: 'e.g. Annual Forum — 14 Oct, Geneva (one per line)' }
            ]
        },
        oilgas: {
            id: 'oilgas', label: 'Oil & Gas / Servicing Companies', icon: 'fa-oil-well', color: '#92400E',
            description: 'Upstream, midstream, downstream & oilfield servicing companies.',
            keyFeatures: ['Service Portfolio', 'Compliance Certifications', 'Safety Standards', 'Project Showcases', 'Sustainability Initiatives', 'Career Opportunities'],
            fields: [
                { key: 'servicePortfolio', label: 'Service Portfolio', type: 'textarea', placeholder: 'e.g. Drilling Services, Logistics & Haulage, Equipment Maintenance (one per line)' },
                { key: 'certifications', label: 'Compliance Certifications', type: 'textarea', placeholder: 'e.g. ISO 9001, ISO 14001, DPR Licensed (one per line)' },
                { key: 'safetyStandards', label: 'Safety Standards', type: 'textarea', placeholder: 'Describe your HSE policy / safety record' },
                { key: 'sustainabilityInitiatives', label: 'Sustainability Initiatives', type: 'textarea', placeholder: 'e.g. Gas flaring reduction, community reforestation (one per line)' },
                { key: 'careers', label: 'Career Opportunities', type: 'textarea', placeholder: 'Role — link/how to apply (one per line)' }
            ]
        },
        service: {
            id: 'service', label: 'Service Companies', icon: 'fa-briefcase', color: '#0369A1',
            description: 'Consulting, training, healthcare, education & other professional services.',
            keyFeatures: ['Service Catalog', 'Booking/Inquiry', 'Client Testimonials', 'Case Studies', 'Pricing Models', 'Certifications', 'Team Expertise Profiles'],
            fields: [
                { key: 'serviceCatalog', label: 'Service Catalog', type: 'textarea', placeholder: 'e.g. Business Consulting, Staff Training, Diagnostic Services (one per line)' },
                { key: 'caseStudies', label: 'Case Studies', type: 'textarea', placeholder: 'Short case study summaries (one per line)' },
                { key: 'testimonials', label: 'Client Testimonials', type: 'textarea', placeholder: '"Great service!" — Client Name (one per line)' },
                { key: 'pricingModels', label: 'Pricing / Packages', type: 'textarea', placeholder: 'e.g. Starter — ₦50,000/mo (one per line)' },
                { key: 'certifications', label: 'Certifications', type: 'textarea', placeholder: 'One per line' },
                { key: 'teamExpertise', label: 'Team Expertise Profiles', type: 'textarea', placeholder: 'Name — Role — Expertise (one per line)' }
            ]
        },
        product: {
            id: 'product', label: 'Product-Based Businesses', icon: 'fa-store', color: '#B45309',
            description: 'Retail, e-commerce, real estate, auto sales & other product sellers.',
            keyFeatures: ['Product Listings', 'Images & Descriptions', 'Pricing', 'Promotions & Discounts', 'Reviews & Ratings', 'Delivery/Logistics Info'],
            fields: [
                { key: 'promotions', label: 'Current Promotions / Discounts', type: 'textarea', placeholder: 'e.g. 10% off all items this weekend (one per line)' },
                { key: 'deliveryInfo', label: 'Delivery / Logistics Info', type: 'textarea', placeholder: 'e.g. Same-day delivery within Lagos, Nationwide shipping in 3-5 days' },
                { key: 'returnPolicy', label: 'Return / Refund Policy', type: 'textarea', placeholder: 'Describe your returns/refunds policy' }
            ]
        }
    };

    var BIZ_SOCIAL_PLATFORMS = [
        { key: 'facebook',  label: 'Facebook',    icon: 'fa-facebook-f',  placeholder: 'https://facebook.com/yourpage' },
        { key: 'instagram', label: 'Instagram',   icon: 'fa-instagram',   placeholder: 'https://instagram.com/yourhandle' },
        { key: 'twitter',   label: 'X / Twitter', icon: 'fa-x-twitter',   placeholder: 'https://x.com/yourhandle' },
        { key: 'linkedin',  label: 'LinkedIn',    icon: 'fa-linkedin-in', placeholder: 'https://linkedin.com/company/yourorg' },
        { key: 'youtube',   label: 'YouTube',     icon: 'fa-youtube',     placeholder: 'https://youtube.com/@yourchannel' },
        { key: 'whatsapp',  label: 'WhatsApp',    icon: 'fa-whatsapp',    placeholder: 'https://wa.me/2348012345678' }
    ];

    /**
     * Resolves any business_pages document to one of the 7 category ids.
     * Prefers the explicit `category` field (set by the new create/edit
     * flow); for pages created before this system existed, maps the old
     * free-text `industry` value to the closest fit; anything unrecognised
     * falls back to 'service' (a broad, generically useful template) so no
     * page is ever left without a working set of features.
     */
    function _resolveCategory(data) {
        data = data || {};
        if (data.category && BIZ_CATEGORIES[data.category]) return data.category;
        var legacy = String(data.industry || data.category || '').toLowerCase().trim();
        var map = {
            'non-profit': 'ngo', 'nonprofit': 'ngo', 'ngo': 'ngo', 'charity': 'ngo',
            'finance': 'bank', 'bank': 'bank', 'banking': 'bank', 'insurance': 'bank',
            'government': 'government', 'public sector': 'government',
            'international': 'international',
            'oil': 'oilgas', 'oil & gas': 'oilgas', 'oil-gas': 'oilgas', 'oilgas': 'oilgas', 'gas': 'oilgas',
            'healthcare': 'service', 'education': 'service', 'technology': 'service', 'agriculture': 'service', 'consulting': 'service',
            'retail': 'product', 'e-commerce': 'product', 'ecommerce': 'product', 'real estate': 'product', 'automotive': 'product', 'other': 'service'
        };
        return map[legacy] || 'service';
    }
    window._bizResolveCategory = _resolveCategory;

    function _parseLines(text) {
        return String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    /* ── Category tab selector (Create Page modal) ── */
    function _renderCategoryTabsHTML(selectedId) {
        return '<div id="biz-category-tabs" style="display:flex;gap:8px;overflow-x:auto;padding:2px 1px 10px;'
            + 'margin-bottom:4px;-webkit-overflow-scrolling:touch;">'
            + BIZ_CATEGORY_ORDER.map(function (id) {
                var cat = BIZ_CATEGORIES[id];
                var active = id === selectedId;
                return '<button type="button" class="biz-cat-tab" data-cat="' + id + '" style="flex:0 0 auto;'
                    + 'display:flex;align-items:center;gap:6px;padding:9px 14px;border-radius:50px;font-size:0.78rem;'
                    + 'font-weight:700;white-space:nowrap;cursor:pointer;transition:all 0.15s;'
                    + 'border:1.5px solid ' + (active ? cat.color : 'rgba(10,14,39,0.14)') + ';'
                    + 'background:' + (active ? cat.color : '#fff') + ';'
                    + 'color:' + (active ? '#fff' : '#374151') + ';">'
                    + '<i class="fas ' + cat.icon + '"></i>' + _esc(cat.label) + '</button>';
            }).join('')
            + '</div>';
    }

    /* ── Dynamic per-category fields (shared by create + edit) ── */
    function _renderCategoryFieldsHTML(categoryId, existing, idPrefix) {
        var cat = BIZ_CATEGORIES[categoryId];
        if (!cat) return '';
        existing = existing || {};
        idPrefix = idPrefix || 'biz-catfield-';
        var out = cat.fields.map(function (f) {
            var val = existing[f.key] || '';
            var id  = idPrefix + f.key;
            var inputHtml;
            if (f.type === 'textarea') {
                inputHtml = '<textarea id="' + id + '" data-catfield="' + f.key + '" rows="3" placeholder="' + _attr(f.placeholder || '') + '"'
                    + ' style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;'
                    + 'padding:9px 12px;font-size:0.85rem;color:#374151;resize:vertical;font-family:inherit;outline:none;">'
                    + _esc(val) + '</textarea>';
            } else {
                inputHtml = '<input type="' + (f.type === 'url' ? 'url' : 'text') + '" id="' + id + '" data-catfield="' + f.key + '"'
                    + ' value="' + _attr(val) + '" placeholder="' + _attr(f.placeholder || '') + '"'
                    + ' style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;'
                    + 'padding:9px 12px;font-size:0.85rem;color:#374151;outline:none;">';
            }
            return '<div class="biz-catfield-group" style="margin-bottom:12px;">'
                + '<label style="display:block;font-size:0.72rem;font-weight:800;color:#374151;text-transform:uppercase;'
                + 'letter-spacing:0.03em;margin-bottom:5px;">' + _esc(f.label) + '</label>' + inputHtml + '</div>';
        }).join('');
        return '<div style="margin:4px 0 10px;padding:10px 12px;background:' + cat.color + '12;border-radius:10px;'
            + 'font-size:0.76rem;color:' + cat.color + ';line-height:1.5;">'
            + '<i class="fas ' + cat.icon + '" style="margin-right:6px;"></i>' + _esc(cat.description) + '</div>' + out;
    }

    function _collectCategoryFieldValues(categoryId, idPrefix) {
        var cat = BIZ_CATEGORIES[categoryId];
        if (!cat) return {};
        idPrefix = idPrefix || 'biz-catfield-';
        var out = {};
        cat.fields.forEach(function (f) {
            var el = document.getElementById(idPrefix + f.key);
            if (el) out[f.key] = (el.value || '').trim();
        });
        return out;
    }

    /* ── Social media integration fields (universal, shared by create + edit) ── */
    function _renderSocialLinksHTML(existing, idPrefix) {
        existing = existing || {};
        idPrefix = idPrefix || 'biz-social-';
        return '<div>'
            + '<label style="display:block;font-size:0.75rem;font-weight:800;color:#374151;text-transform:uppercase;'
            + 'letter-spacing:0.04em;margin-bottom:8px;"><i class="fas fa-share-nodes" style="margin-right:6px;color:#1B2B8B;"></i>'
            + 'Social Media Links (optional)</label>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
            + BIZ_SOCIAL_PLATFORMS.map(function (p) {
                return '<div style="display:flex;align-items:center;gap:6px;border:1.5px solid rgba(10,14,39,0.12);'
                    + 'border-radius:10px;padding:6px 10px;min-width:0;">'
                    + '<i class="fab ' + p.icon + '" style="color:#1B2B8B;width:14px;flex-shrink:0;font-size:0.8rem;"></i>'
                    + '<input type="url" id="' + idPrefix + p.key + '" data-social="' + p.key + '" value="' + _attr(existing[p.key] || '') + '"'
                    + ' placeholder="' + _attr(p.placeholder) + '" style="flex:1;min-width:0;border:none;font-size:0.76rem;outline:none;background:transparent;">'
                    + '</div>';
            }).join('')
            + '</div></div>';
    }

    function _collectSocialLinksValues(idPrefix) {
        idPrefix = idPrefix || 'biz-social-';
        var out = {};
        BIZ_SOCIAL_PLATFORMS.forEach(function (p) {
            var el = document.getElementById(idPrefix + p.key);
            if (el && el.value.trim()) out[p.key] = el.value.trim();
        });
        return out;
    }

    /* ── Display helpers for the category features section on the live page ── */
    function _renderBulletList(text, icon) {
        var lines = _parseLines(text);
        if (!lines.length) return '';
        return '<ul style="margin:0;padding:0;list-style:none;">'
            + lines.map(function (l) {
                return '<li style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;'
                    + 'border-bottom:1px solid rgba(10,14,39,0.06);font-size:0.85rem;color:#374151;">'
                    + '<i class="fas ' + (icon || 'fa-check') + '" style="color:#1B2B8B;margin-top:3px;font-size:0.7rem;flex-shrink:0;"></i>'
                    + '<span>' + _esc(l) + '</span></li>';
            }).join('') + '</ul>';
    }

    function _renderStatChips(text) {
        var lines = _parseLines(text);
        if (!lines.length) return '';
        return '<div style="display:flex;flex-wrap:wrap;gap:8px;">'
            + lines.map(function (l) {
                return '<div style="padding:8px 14px;border-radius:12px;background:rgba(27,43,139,0.07);'
                    + 'font-size:0.8rem;font-weight:700;color:#1B2B8B;">' + _esc(l) + '</div>';
            }).join('') + '</div>';
    }

    function _renderLinkList(text, icon) {
        var lines = _parseLines(text);
        if (!lines.length) return '';
        return '<ul style="margin:0;padding:0;list-style:none;">'
            + lines.map(function (l) {
                var url = '', label = l;
                var urlMatch = l.match(/https?:\/\/\S+/);
                if (urlMatch) {
                    url = urlMatch[0];
                    label = l.replace(url, '').replace(/[—\-:]\s*$/, '').trim() || url;
                }
                var inner = '<i class="fas ' + (icon || 'fa-file-alt') + '" style="color:#1B2B8B;margin-right:8px;font-size:0.75rem;"></i>' + _esc(label);
                return '<li style="padding:8px 0;border-bottom:1px solid rgba(10,14,39,0.06);font-size:0.85rem;">'
                    + (url
                        ? '<a href="' + _attr(url) + '" target="_blank" rel="noopener noreferrer" style="color:#1B2B8B;text-decoration:none;font-weight:600;">' + inner + '</a>'
                        : '<span style="color:#374151;">' + inner + '</span>')
                    + '</li>';
            }).join('') + '</ul>';
    }

    /* Wires the key-features chip row's chevron button (built in
       _buildCategoryFeaturesSection) to show/hide the chips past the
       first 6. Safe to call even when the page's category has 6 or
       fewer features — the toggle button simply won't exist, so the
       querySelector below finds nothing and this is a no-op. */
    function _wireKeyFeaturesToggle(bizId) {
        var toggle = document.querySelector('[data-keyfeat-toggle="' + bizId + '"]');
        var extra  = document.querySelector('[data-keyfeat-extra="' + bizId + '"]');
        if (!toggle || !extra || toggle._wired) return;
        toggle._wired = true;
        var extraCount = extra.children.length;
        toggle.addEventListener('click', function () {
            var expanded = toggle.getAttribute('aria-expanded') === 'true';
            expanded = !expanded;
            toggle.setAttribute('aria-expanded', String(expanded));
            extra.style.display = expanded ? 'contents' : 'none';
            var label = toggle.querySelector('.vf-keyfeat-toggle-label');
            if (label) label.textContent = expanded ? 'Show less' : ('+' + extraCount + ' more');
            var chevron = toggle.querySelector('i');
            if (chevron) chevron.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)';
        });
    }

    /* ── Bank category: Branch Locator / ATM Map ──
       Parses an optional "lat,lng" pair off the end of each line in a
       branches/atmLocations textarea (e.g. "Victoria Island Branch — 12
       Adeola Odeku St, Lagos — 6.4281,3.4219"). Lines without a valid
       coordinate pair are simply skipped for the MAP (they still render
       normally in the existing bullet-list card underneath — nothing is
       lost if an owner never adds coordinates, the map is purely additive
       on top of that). Kept intentionally forgiving on separators (—, -,
       comma) since this is filled in by hand on a phone, not validated
       input.
       Returns [{ label, lat, lng }, ...]. */
    function _parseCoordLines(text) {
        var out = [];
        _parseLines(text).forEach(function (line) {
            var m = line.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
            if (!m) return;
            var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
            if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
            var label = line.slice(0, m.index).replace(/[—\-,:]\s*$/, '').trim() || line;
            out.push({ label: label, lat: lat, lng: lng });
        });
        return out;
    }

    /**
     * Builds the Branch Locator / ATM Map section card for the bank
     * category — an interactive Leaflet map (OpenStreetMap tiles, no API
     * key required, matching the "Places" style already used elsewhere in
     * this app conceptually but with zero external billing dependency)
     * plotting every branch/ATM line that carries a valid "lat,lng" pair.
     * Returns '' if neither list has a single geocoded entry — in that
     * case the plain Branch Locator / ATM Locations bullet-list cards
     * (already rendered separately, unchanged) are all the owner filled
     * in, and there's nothing to plot yet.
     */
    function _buildBankLocatorMapHTML(bizId, cd) {
        var branchPoints = _parseCoordLines(cd.branches).map(function (p) { return Object.assign({ kind: 'branch' }, p); });
        var atmPoints    = _parseCoordLines(cd.atmLocations).map(function (p) { return Object.assign({ kind: 'atm' }, p); });
        var allPoints = branchPoints.concat(atmPoints);
        if (!allPoints.length) return '';

        var mapId = 'biz-bank-locator-map-' + bizId;
        /* Stash the points on window keyed by mapId so _wireBankLocatorMap
           (run after sec.innerHTML lands in the DOM) doesn't have to
           re-parse the textarea — same "build then wire" split every
           other interactive section in this file already uses. */
        window._empBizLocatorPoints = window._empBizLocatorPoints || {};
        window._empBizLocatorPoints[mapId] = allPoints;

        return '<div style="background:#fff;border-radius:14px;padding:16px;margin-bottom:12px;'
            + 'box-shadow:0 2px 10px rgba(10,14,39,0.06);border:1px solid rgba(10,14,39,0.06);">'
            + '<h4 style="margin:0 0 10px;font-size:0.88rem;font-weight:800;color:#0A0E27;display:flex;align-items:center;gap:8px;">'
            + '<i class="fas fa-map-location-dot" style="color:#1B2B8B;"></i>Branch &amp; ATM Map'
            + '<span style="margin-left:auto;display:flex;gap:10px;font-size:0.68rem;font-weight:700;color:#6B7280;">'
            + (branchPoints.length ? '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1B2B8B;margin-right:4px;"></span>' + branchPoints.length + ' Branch' + (branchPoints.length === 1 ? '' : 'es') + '</span>' : '')
            + (atmPoints.length ? '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#C9A66B;margin-right:4px;"></span>' + atmPoints.length + ' ATM' + (atmPoints.length === 1 ? '' : 's') + '</span>' : '')
            + '</span></h4>'
            + '<div id="' + mapId + '" data-locator-map="1" style="width:100%;height:240px;border-radius:10px;background:#EEF1F8;'
            + 'display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:0.8rem;">'
            + '<i class="fas fa-spinner fa-spin" style="margin-right:7px;"></i>Loading map…</div>'
            + '</div>';
    }

    /**
     * Lazy-loads Leaflet (CSS + JS) from CDN exactly once — no API key
     * needed (OpenStreetMap tiles), so this works the same on every
     * deploy without any config/billing setup. Returns a Promise that
     * resolves once window.L is ready.
     */
    function _ensureLeaflet() {
        if (window.L) return Promise.resolve(window.L);
        if (window._empLeafletLoading) return window._empLeafletLoading;
        window._empLeafletLoading = new Promise(function (resolve, reject) {
            if (!document.getElementById('_biz-leaflet-css')) {
                var link = document.createElement('link');
                link.id = '_biz-leaflet-css';
                link.rel = 'stylesheet';
                link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                document.head.appendChild(link);
            }
            var script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = function () { resolve(window.L); };
            script.onerror = function () { reject(new Error('Leaflet failed to load')); };
            document.head.appendChild(script);
        });
        return window._empLeafletLoading;
    }

    /**
     * Initializes the actual Leaflet map for a rendered
     * _buildBankLocatorMapHTML() container. Called once per page render,
     * only when the resolved category is 'bank' and at least one
     * geocoded branch/ATM line exists (see _buildBankLocatorMapHTML).
     * Fits the view to every marker; a single point falls back to a
     * sensible city-level zoom instead of zooming in on nothing.
     */
    function _wireBankLocatorMap(bizId) {
        var mapId = 'biz-bank-locator-map-' + bizId;
        var el = document.getElementById(mapId);
        var points = window._empBizLocatorPoints && window._empBizLocatorPoints[mapId];
        if (!el || !points || !points.length || el._empMapInit) return;
        el._empMapInit = true;

        _ensureLeaflet().then(function (L) {
            el.innerHTML = '';
            el.style.background = '';
            el.style.display = '';
            var map = L.map(el, { scrollWheelZoom: false });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
                maxZoom: 19
            }).addTo(map);

            var branchIcon = L.divIcon({ className: '', html: '<div style="width:16px;height:16px;border-radius:50%;background:#1B2B8B;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
            var atmIcon    = L.divIcon({ className: '', html: '<div style="width:16px;height:16px;border-radius:50%;background:#C9A66B;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });

            var markers = points.map(function (p) {
                var m = L.marker([p.lat, p.lng], { icon: p.kind === 'atm' ? atmIcon : branchIcon }).addTo(map);
                m.bindPopup('<strong>' + _esc(p.label) + '</strong><br>' + (p.kind === 'atm' ? 'ATM' : 'Branch'));
                return m;
            });

            if (markers.length === 1) {
                map.setView([points[0].lat, points[0].lng], 14);
            } else {
                map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
            }

            /* Tapping a marker on a touch device fires both a click AND
               (on some browsers) a synthetic follow-up — Leaflet's own
               popup handling already guards this internally, nothing
               extra needed here. */
            setTimeout(function () { map.invalidateSize(); }, 200); /* container can still be mid-layout on first paint */
        }).catch(function () {
            el.innerHTML = '<span style="padding:0 16px;text-align:center;"><i class="fas fa-triangle-exclamation" style="margin-right:6px;"></i>Map could not load — check your connection.</span>';
        });
    }

    function _sectionCard(title, icon, innerHtml, id) {
        if (!innerHtml) return '';
        return '<div ' + (id ? 'id="' + id + '" ' : '') + 'style="background:#fff;border-radius:14px;padding:16px;'
            + 'margin-bottom:12px;box-shadow:0 2px 10px rgba(10,14,39,0.06);border:1px solid rgba(10,14,39,0.06);">'
            + '<h4 style="margin:0 0 10px;font-size:0.88rem;font-weight:800;color:#0A0E27;display:flex;align-items:center;gap:8px;">'
            + '<i class="fas ' + icon + '" style="color:#1B2B8B;"></i>' + _esc(title) + '</h4>'
            + innerHtml + '</div>';
    }

    function _ctaButton(id, label, icon) {
        return '<button id="' + id + '" type="button" style="margin-top:6px;padding:10px 20px;border-radius:50px;'
            + 'background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;border:none;font-weight:700;'
            + 'font-size:0.82rem;cursor:pointer;display:inline-flex;align-items:center;gap:7px;">'
            + '<i class="fas ' + icon + '"></i>' + _esc(label) + '</button>';
    }

    /**
     * Builds the full category-specific features panel for the live page —
     * exactly the "Key Features by Category" table from the spec, rendered
     * as a key-features chip row followed by info cards populated from the
     * page's own categoryData, plus the category's interactive CTA(s).
     * Cards with no content yet (owner hasn't filled that field) are
     * simply omitted rather than shown empty.
     */
    function _buildCategoryFeaturesSection(bizId, data, isOwner, categoryId) {
        var cd  = data.categoryData || {};
        var cat = BIZ_CATEGORIES[categoryId] || BIZ_CATEGORIES.service;
        var out = '<div id="vf-biz-category-features" style="padding:0 14px 4px;">';

        /* Key-features chip row — capped to the first 6 chips on screen;
           any remaining chips (some categories, e.g. NGO, list up to 8)
           sit in a hidden group toggled open/closed by a trailing chevron
           button, instead of all chips always being visible/wrapping the
           row taller than the rest of the dashboard scroll section. */
        var _kfVisible = cat.keyFeatures.slice(0, 6);
        var _kfExtra   = cat.keyFeatures.slice(6);
        function _kfChip(f) {
            return '<span style="font-size:0.68rem;font-weight:700;padding:4px 10px;border-radius:20px;'
                + 'background:rgba(10,14,39,0.045);color:#6B7280;">' + _esc(f) + '</span>';
        }
        out += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 2px 14px;align-items:center;">'
            + _kfVisible.map(_kfChip).join('')
            + (_kfExtra.length
                ? '<span id="vf-biz-keyfeat-extra-' + bizId + '" data-keyfeat-extra="' + bizId + '" style="display:none;">'
                    + _kfExtra.map(_kfChip).join('') + '</span>'
                  + '<button type="button" id="vf-biz-keyfeat-toggle-' + bizId + '" data-keyfeat-toggle="' + bizId + '" aria-expanded="false"'
                    + ' style="display:inline-flex;align-items:center;gap:4px;font-size:0.68rem;font-weight:700;'
                    + 'padding:4px 10px;border-radius:20px;background:rgba(27,43,139,0.08);color:#1B2B8B;'
                    + 'border:none;cursor:pointer;font-family:inherit;">'
                    + '<span class="vf-keyfeat-toggle-label">+' + _kfExtra.length + ' more</span>'
                    + '<i class="fas fa-chevron-down" style="font-size:0.6rem;transition:transform 0.18s;"></i></button>'
                : '')
            + '</div>';

        switch (categoryId) {
            case 'ngo':
                out += _sectionCard('Mission & Vision', 'fa-bullseye', cd.mission ? '<p style="margin:0;font-size:0.87rem;color:#374151;line-height:1.6;white-space:pre-line;">' + _esc(cd.mission) + '</p>' : '');
                out += _sectionCard('Services Offered', 'fa-hand-holding-heart', _renderBulletList(cd.servicesOffered));
                out += _sectionCard('Impact Metrics', 'fa-chart-line', _renderStatChips(cd.impactMetrics));
                out += _sectionCard('Beneficiary Stories', 'fa-quote-left', cd.beneficiaryStories ? '<p style="margin:0;font-size:0.85rem;color:#374151;line-height:1.6;white-space:pre-line;">' + _esc(cd.beneficiaryStories) + '</p>' : '');
                out += _sectionCard('Community Events', 'fa-calendar-days', _renderBulletList(cd.communityEvents, 'fa-calendar'));
                out += _sectionCard('Transparency Reports', 'fa-file-shield', _renderLinkList(cd.transparencyReports, 'fa-file-pdf'));
                out += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 2px 16px;">'
                    + _ctaButton('biz-cta-donate', 'Donate / Support', 'fa-heart')
                    + _ctaButton('biz-cta-volunteer', 'Volunteer Sign-Up', 'fa-hands-helping')
                    + '</div>';
                break;

            case 'bank':
                out += _sectionCard('Services', 'fa-sack-dollar', _renderBulletList(cd.services, 'fa-check-circle'));
                out += _buildBankLocatorMapHTML(bizId, cd);
                out += _sectionCard('Branch Locator', 'fa-location-dot', _renderBulletList(cd.branches, 'fa-building'));
                out += _sectionCard('ATM Locations', 'fa-map-pin', _renderBulletList(cd.atmLocations, 'fa-map-pin'));
                out += _sectionCard('Compliance & Regulatory Info', 'fa-shield-halved', cd.complianceInfo ? '<p style="margin:0;font-size:0.85rem;color:#374151;line-height:1.6;white-space:pre-line;">' + _esc(cd.complianceInfo) + '</p>' : '');
                out += _sectionCard('Financial Literacy Resources', 'fa-book-open', _renderLinkList(cd.financialLiteracyLinks, 'fa-book'));
                out += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 2px 16px;">'
                    + _ctaButton('biz-cta-support-chat', 'Customer Support Chat', 'fa-comments')
                    + (cd.transactionPortalUrl
                        ? '<a href="' + _attr(cd.transactionPortalUrl) + '" target="_blank" rel="noopener noreferrer"'
                            + ' style="margin-top:6px;padding:10px 20px;border-radius:50px;background:rgba(27,43,139,0.08);'
                            + 'color:#1B2B8B;border:2px solid rgba(27,43,139,0.25);font-weight:700;font-size:0.82rem;'
                            + 'text-decoration:none;display:inline-flex;align-items:center;gap:7px;">'
                            + '<i class="fas fa-lock"></i>Secure Transaction Portal</a>'
                        : '')
                    + '</div>';
                break;

            case 'government':
                out += _sectionCard('Mandate & Mission', 'fa-scroll', cd.mandate ? '<p style="margin:0;font-size:0.87rem;color:#374151;line-height:1.6;white-space:pre-line;">' + _esc(cd.mandate) + '</p>' : '');
                out += _sectionCard('Public Service Catalog', 'fa-list-check', _renderBulletList(cd.serviceCatalog));
                out += _sectionCard('Downloadable Forms', 'fa-file-arrow-down', _renderLinkList(cd.downloadableForms, 'fa-file-lines'));
                out += _sectionCard('Announcements', 'fa-bullhorn', _renderBulletList(cd.announcements, 'fa-bell'));
                out += _sectionCard('E-Governance Tools', 'fa-display', _renderLinkList(cd.egovTools, 'fa-laptop'));
                out += _sectionCard('Transparency Reports', 'fa-file-shield', _renderLinkList(cd.transparencyReports, 'fa-file-pdf'));
                out += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 2px 16px;">'
                    + _ctaButton('biz-cta-feedback', 'Citizen Feedback Portal', 'fa-comment-dots')
                    + '</div>';
                break;

            case 'international':
                out += _sectionCard('Global Programs', 'fa-earth-africa', _renderBulletList(cd.globalPrograms, 'fa-globe'));
                out += _sectionCard('Languages Supported', 'fa-language', cd.languages
                    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + String(cd.languages).split(',').map(function (l) { return l.trim(); }).filter(Boolean)
                        .map(function (l) { return '<span style="font-size:0.75rem;font-weight:700;padding:5px 12px;border-radius:20px;background:rgba(27,43,139,0.08);color:#1B2B8B;">' + _esc(l) + '</span>'; }).join('') + '</div>'
                    : '');
                out += _sectionCard('Partnerships', 'fa-handshake', _renderBulletList(cd.partnerships, 'fa-handshake'));
                out += _sectionCard('Impact Dashboard', 'fa-chart-pie', _renderStatChips(cd.impactDashboard));
                out += _sectionCard('Research Publications', 'fa-book', _renderLinkList(cd.researchPublications, 'fa-file-alt'));
                out += _sectionCard('Event Calendar', 'fa-calendar-days', _renderBulletList(cd.eventCalendar, 'fa-calendar'));
                out += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 2px 16px;">'
                    + _ctaButton('biz-cta-collaborate', 'Request Collaboration', 'fa-people-arrows')
                    + '</div>';
                break;

            case 'oilgas':
                out += _sectionCard('Service Portfolio', 'fa-gears', _renderBulletList(cd.servicePortfolio, 'fa-oil-well'));
                out += _sectionCard('Compliance Certifications', 'fa-certificate', _renderStatChips(cd.certifications));
                out += _sectionCard('Safety Standards', 'fa-hard-hat', cd.safetyStandards ? '<p style="margin:0;font-size:0.85rem;color:#374151;line-height:1.6;white-space:pre-line;">' + _esc(cd.safetyStandards) + '</p>' : '');
                out += _sectionCard('Sustainability Initiatives', 'fa-leaf', _renderBulletList(cd.sustainabilityInitiatives, 'fa-seedling'));
                out += _sectionCard('Career Opportunities', 'fa-briefcase', _renderLinkList(cd.careers, 'fa-user-tie'), 'biz-section-careers');
                out += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 2px 16px;">'
                    + '<p style="font-size:0.76rem;color:#9CA3AF;margin:0;width:100%;">'
                    + '<i class="fas fa-images" style="margin-right:6px;"></i>Project showcases appear in the Posts &amp; Listings feed below.</p>'
                    + '</div>';
                break;

            case 'service':
                out += _sectionCard('Service Catalog', 'fa-list', _renderBulletList(cd.serviceCatalog, 'fa-briefcase'));
                out += _sectionCard('Case Studies', 'fa-lightbulb', _renderBulletList(cd.caseStudies, 'fa-lightbulb'));
                out += _sectionCard('Client Testimonials', 'fa-quote-left', _renderBulletList(cd.testimonials, 'fa-quote-right'));
                out += _sectionCard('Pricing / Packages', 'fa-tags', _renderBulletList(cd.pricingModels, 'fa-tag'));
                out += _sectionCard('Certifications', 'fa-certificate', _renderStatChips(cd.certifications));
                out += _sectionCard('Team Expertise', 'fa-users', _renderBulletList(cd.teamExpertise, 'fa-user'));
                out += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 2px 16px;">'
                    + _ctaButton('biz-cta-booking', 'Book / Inquire', 'fa-calendar-check')
                    + '</div>';
                break;

            case 'product':
                out += _sectionCard('Current Promotions &amp; Discounts', 'fa-tags', _renderBulletList(cd.promotions, 'fa-percent'));
                out += _sectionCard('Delivery / Logistics', 'fa-truck-fast', cd.deliveryInfo ? '<p style="margin:0;font-size:0.85rem;color:#374151;line-height:1.6;white-space:pre-line;">' + _esc(cd.deliveryInfo) + '</p>' : '');
                out += _sectionCard('Return / Refund Policy', 'fa-rotate-left', cd.returnPolicy ? '<p style="margin:0;font-size:0.85rem;color:#374151;line-height:1.6;white-space:pre-line;">' + _esc(cd.returnPolicy) + '</p>' : '');
                out += '<p style="font-size:0.78rem;color:#9CA3AF;margin:0 2px 16px;">'
                    + '<i class="fas fa-info-circle" style="margin-right:6px;"></i>Product listings, images, pricing, and reviews appear in the Posts &amp; Listings feed below.</p>';
                break;
        }

        out += '</div>';
        return out;
    }

    /**
     * Generic lead-capture modal used by every category CTA (Donate,
     * Volunteer Sign-Up, Citizen Feedback, Collaboration Request,
     * Book/Inquire). One shared builder + Firestore writer instead of a
     * bespoke modal per action, so every one of these forms behaves
     * identically and only the field list / target collection differ.
     *
     * NOTE ON FIRESTORE RULES: this writes to collections that are NEW
     * to this codebase (business_donation_pledges, business_volunteer_
     * signups, business_citizen_feedback, business_collaboration_requests,
     * business_bookings). firebase-rules.js was not provided as part of
     * this session's file set, so its exact rule blocks could not be
     * edited here — each of these collections needs an `allow create: if
     * request.auth != null;` rule added (mirroring the same "any
     * authenticated user can create" pattern already used for posts/
     * messages/live_* per Store_firebase.js's own comment), or these
     * submissions will fail with a permission-denied error until that's
     * added.
     */
    function _openBizLeadForm(bizId, data, config) {
        if (_isGuest()) { _notify('Please log in to continue.', 'info'); return; }
        var us = _us();
        var existing = document.getElementById('biz-lead-form-panel');
        if (existing) existing.remove();

        if (!document.getElementById('_biz-lead-anim')) {
            var st = document.createElement('style');
            st.id = '_biz-lead-anim';
            st.textContent = '@keyframes slideUpBizLead{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}';
            document.head.appendChild(st);
        }

        var panel = document.createElement('div');
        panel.id = 'biz-lead-form-panel';
        panel.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(10,14,39,0.65);'
            + 'display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);';

        var inner = document.createElement('div');
        inner.style.cssText = 'background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:520px;'
            + 'max-height:88vh;overflow-y:auto;padding:24px 20px 32px;box-shadow:0 -8px 40px rgba(10,14,39,0.22);'
            + 'animation:slideUpBizLead 0.28s cubic-bezier(0.34,1.56,0.64,1);';

        function fieldHTML(f) {
            var id = 'biz-lead-field-' + f.key;
            var prefill = (f.key === 'name' && us.fullName) ? us.fullName : ((f.key === 'email' && us.email) ? us.email : '');
            var input;
            if (f.type === 'textarea') {
                input = '<textarea id="' + id + '" rows="3" placeholder="' + _attr(f.placeholder || '') + '"'
                    + ' style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;'
                    + 'padding:9px 12px;font-size:0.88rem;color:#374151;resize:vertical;font-family:inherit;outline:none;">'
                    + _esc(prefill) + '</textarea>';
            } else {
                input = '<input type="' + (f.type || 'text') + '" id="' + id + '" value="' + _attr(prefill) + '"'
                    + ' placeholder="' + _attr(f.placeholder || '') + '" style="width:100%;box-sizing:border-box;'
                    + 'border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;padding:9px 12px;font-size:0.88rem;'
                    + 'color:#374151;outline:none;">';
            }
            return '<div style="margin-bottom:14px;"><label style="display:block;font-size:0.75rem;font-weight:800;'
                + 'color:#374151;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">'
                + _esc(f.label) + (f.required ? ' *' : '') + '</label>' + input + '</div>';
        }

        inner.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">'
            + '<h3 style="margin:0;font-size:1.02rem;font-weight:900;color:#0A0E27;"><i class="fas ' + config.icon
            + '" style="color:#1B2B8B;margin-right:8px;"></i>' + _esc(config.title) + '</h3>'
            + '<button id="biz-lead-close-btn" style="background:rgba(10,14,39,0.07);border:none;width:34px;height:34px;'
            + 'border-radius:50%;font-size:1rem;cursor:pointer;color:#6B7280;"><i class="fas fa-times"></i></button></div>'
            + config.fields.map(fieldHTML).join('')
            + '<button id="biz-lead-submit-btn" style="width:100%;padding:13px;border-radius:14px;'
            + 'background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;border:none;font-weight:800;'
            + 'font-size:0.92rem;cursor:pointer;margin-top:4px;"><i class="fas fa-paper-plane" style="margin-right:7px;"></i>'
            + _esc(config.submitLabel || 'Submit') + '</button>';

        panel.appendChild(inner);
        document.body.appendChild(panel);

        document.getElementById('biz-lead-close-btn').addEventListener('click', function () { panel.remove(); });
        panel.addEventListener('click', function (e) { if (e.target === panel) panel.remove(); });

        document.getElementById('biz-lead-submit-btn').addEventListener('click', function () {
            var btn = this;
            var values = {};
            var missingRequired = false;
            config.fields.forEach(function (f) {
                var el = document.getElementById('biz-lead-field-' + f.key);
                var v  = el ? el.value.trim() : '';
                if (f.required && !v) missingRequired = true;
                values[f.key] = v;
            });
            if (missingRequired) { _notify('Please fill in all required fields.', 'error'); return; }

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:7px;"></i>Sending…';

            var lead = Object.assign({}, values, {
                pageId: bizId,
                pageName: data.name || '',
                userId: us.id || null,
                createdAt: Date.now()
            });

            if (!_fbOk()) {
                panel.remove();
                _notify(config.successMsg || 'Submitted!', 'success');
                return;
            }

            window.fbDb.collection(config.collection).add(lead)
                .then(function () {
                    panel.remove();
                    _notify(config.successMsg || 'Submitted!', 'success');
                })
                .catch(function (err) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:7px;"></i>' + _esc(config.submitLabel || 'Submit');
                    _notify('Could not submit: ' + (err && err.message ? err.message : 'please try again.'), 'error');
                });
        });
    }

    /* Wires every category CTA button rendered by _buildCategoryFeaturesSection. */
    function _wireCategoryFeatureActions(bizId, data, categoryId) {
        var pageName = data.name || data.businessName || 'this page';
        function wire(id, handler) {
            var el = document.getElementById(id);
            if (el && !el._wired) { el._wired = true; el.addEventListener('click', handler); }
        }

        wire('biz-cta-donate', function () {
            var cd = data.categoryData || {};
            if (cd.donationLink) { window.open(cd.donationLink, '_blank', 'noopener,noreferrer'); return; }
            _openBizLeadForm(bizId, data, {
                title: 'Support ' + pageName, icon: 'fa-heart', collection: 'business_donation_pledges',
                submitLabel: 'Send Pledge', successMsg: 'Thank you! ' + pageName + ' will reach out with next steps.',
                fields: [
                    { key: 'name', label: 'Your Name', type: 'text', required: true },
                    { key: 'email', label: 'Email', type: 'email', required: true },
                    { key: 'amount', label: 'Amount you\u2019d like to give (optional)', type: 'text' },
                    { key: 'message', label: 'Message (optional)', type: 'textarea' }
                ]
            });
        });

        wire('biz-cta-volunteer', function () {
            _openBizLeadForm(bizId, data, {
                title: 'Volunteer with ' + pageName, icon: 'fa-hands-helping', collection: 'business_volunteer_signups',
                submitLabel: 'Sign Up', successMsg: 'Thanks for signing up to volunteer with ' + pageName + '!',
                fields: [
                    { key: 'name', label: 'Full Name', type: 'text', required: true },
                    { key: 'email', label: 'Email', type: 'email', required: true },
                    { key: 'phone', label: 'Phone', type: 'tel' },
                    { key: 'interest', label: 'Area of Interest', type: 'text', placeholder: 'e.g. Fundraising, Field Work, Admin' },
                    { key: 'message', label: 'Message', type: 'textarea' }
                ]
            });
        });

        wire('biz-cta-support-chat', function () {
            if (data.email) {
                window.location.href = 'mailto:' + data.email + '?subject=' + encodeURIComponent('Support request — ' + pageName);
            } else {
                _notify('This page hasn\u2019t listed a support contact yet.', 'info');
            }
        });

        wire('biz-cta-feedback', function () {
            _openBizLeadForm(bizId, data, {
                title: 'Send Feedback to ' + pageName, icon: 'fa-comment-dots', collection: 'business_citizen_feedback',
                submitLabel: 'Submit Feedback', successMsg: 'Your feedback has been submitted.',
                fields: [
                    { key: 'name', label: 'Your Name', type: 'text', required: true },
                    { key: 'email', label: 'Email', type: 'email' },
                    { key: 'message', label: 'Your Feedback', type: 'textarea', required: true }
                ]
            });
        });

        wire('biz-cta-collaborate', function () {
            _openBizLeadForm(bizId, data, {
                title: 'Request Collaboration with ' + pageName, icon: 'fa-people-arrows', collection: 'business_collaboration_requests',
                submitLabel: 'Send Request', successMsg: 'Your collaboration request has been sent.',
                fields: [
                    { key: 'name', label: 'Your Name', type: 'text', required: true },
                    { key: 'organisation', label: 'Organisation', type: 'text' },
                    { key: 'email', label: 'Email', type: 'email', required: true },
                    { key: 'message', label: 'Proposal / Message', type: 'textarea', required: true }
                ]
            });
        });

        wire('biz-cta-booking', function () {
            _openBizLeadForm(bizId, data, {
                title: 'Book / Inquire with ' + pageName, icon: 'fa-calendar-check', collection: 'business_bookings',
                submitLabel: 'Send Inquiry', successMsg: 'Your inquiry has been sent to ' + pageName + '.',
                fields: [
                    { key: 'name', label: 'Your Name', type: 'text', required: true },
                    { key: 'email', label: 'Email', type: 'email', required: true },
                    { key: 'phone', label: 'Phone', type: 'tel' },
                    { key: 'service', label: 'Service Needed', type: 'text' },
                    { key: 'message', label: 'Details', type: 'textarea' }
                ]
            });
        });
    }

    /**
     * Analytics dashboard (universal feature): increments pageViews at
     * most once per browser session per page (sessionStorage-guarded, so
     * repeated re-renders/section-switches during one visit don't inflate
     * the count), then reflects the new total into the dashboard number
     * already on screen without a full re-render.
     */
    function _trackPageView(bizId) {
        if (!bizId || !_fbOk()) return;
        try {
            var seenKey = 'empyrean_biz_viewed_' + bizId;
            if (sessionStorage.getItem(seenKey)) return;
            sessionStorage.setItem(seenKey, '1');
        } catch (e) { /* sessionStorage unavailable — proceed with a single increment anyway */ }
        var FV  = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        var inc = FV ? FV.increment(1) : 1;
        window.fbDb.collection('business_pages').doc(bizId).update({ pageViews: inc })
            .then(function () {
                var el = document.getElementById('biz-analytics-views');
                if (el) {
                    var n = Number(String(el.textContent).replace(/,/g, '')) || 0;
                    el.textContent = (n + 1).toLocaleString();
                }
            })
            .catch(function () { /* analytics-only — never surface an error for this */ });
    }


    /* =========================================================================
       §4  CREATE BUSINESS PAGE MODAL — FORM WIRE-UP
       ========================================================================= */

    (function wireCreatePageModal() {

        var _coverUrl   = '';
        var _avatarUrl  = '';
        var _selectedCategory = BIZ_CATEGORY_ORDER[0]; /* 'ngo' — sensible default, changed the instant a tab is tapped */

        /**
         * Business Page Creation Flow, steps 1-2 (Category Selection Tab +
         * Dynamic Page Model): renders the 7 category tabs into
         * #page-category-tabs-container, the currently-selected category's
         * fields into #page-category-fields-container, and the universal
         * social-links inputs into #page-social-links-container. Re-run
         * every time the selected category changes (tab click) so the
         * dynamic fields always match the current tab — this is the
         * "clicking a category opens a customized template" behaviour from
         * the spec's User Experience Flow.
         */
        function _renderCategoryStep() {
            var tabsEl   = document.getElementById('page-category-tabs-container');
            var fieldsEl = document.getElementById('page-category-fields-container');
            var socialEl = document.getElementById('page-social-links-container');
            var hidden   = document.getElementById('page-category');
            if (!tabsEl || !fieldsEl) return;

            tabsEl.innerHTML = _renderCategoryTabsHTML(_selectedCategory);
            fieldsEl.innerHTML = _renderCategoryFieldsHTML(_selectedCategory, {}, 'pgcf-');
            if (hidden) hidden.value = _selectedCategory;
            if (socialEl && !socialEl._pgSocialRendered) {
                socialEl._pgSocialRendered = true;
                socialEl.innerHTML = _renderSocialLinksHTML({}, 'pgsl-');
            }

            if (!tabsEl._catTabsWired) {
                tabsEl._catTabsWired = true;
                tabsEl.addEventListener('click', function (e) {
                    var tab = e.target.closest('.biz-cat-tab');
                    if (!tab) return;
                    e.preventDefault();
                    var cat = tab.dataset.cat;
                    if (!cat || cat === _selectedCategory) return;
                    /* Preserve whatever the person already typed into the
                       previous category's fields isn't possible across a
                       type change (the fields themselves are different) —
                       matches the spec: switching category swaps the whole
                       template, it doesn't merge two unrelated field sets. */
                    _selectedCategory = cat;
                    _renderCategoryStep();
                });
            }
        }

        function _openModal() {
            var m = document.getElementById('create-business-page-modal');
            if (m) { m.style.display = 'flex'; m.classList.add('show'); document.body.classList.add('modal-open'); }
            _ensureCloseButton();
            _renderCategoryStep(); /* re-assert tabs/fields even if the modal's DOM was rebuilt since last open */
        }

        function _closeModal() {
            var m = document.getElementById('create-business-page-modal');
            if (m) { m.style.display = 'none'; m.classList.remove('show'); document.body.classList.remove('modal-open'); }
        }

        /* FIX (2026-08-06 — "once you navigate to create a new business page
           account, you can not exit"): _ensureCloseButton() (below) is what
           wires the X button, backdrop-click, and Escape key — but it was
           only ever CALLED from _openModal() and from _wireForm()'s one-time
           ready() pass. Two other places in this file open this exact same
           modal by setting `m.style.display='flex'; m.classList.add('show')`
           directly instead of calling _openModal() — the "Create Business
           Page" button on the empty-state screen (inline onclick, can't
           reach this module's private _openModal at all) and the "Create
           New Page" tile in the My Pages switcher (_renderMyPagesList's own
           click listener). Neither of those two paths ever ran
           _ensureCloseButton(), so a person entering the modal through
           EITHER of them had no wired close button/backdrop/Escape for that
           session (only the very first, earliest-rendered copy of the modal
           — from _wireForm()'s ready() pass — was ever guaranteed wired,
           and even that depends on timing). Rather than edit both of those
           other call sites (and any future one that opens this modal the
           same way), watch the modal's own class/style directly: whenever
           it becomes visible, run _ensureCloseButton() right then — this
           makes "how the modal was opened" irrelevant, closing the gap for
           good and for any future entry point too. */
        (function _watchModalVisibility() {
            var modalEl = document.getElementById('create-business-page-modal');
            if (!modalEl) return;
            var wasOpen = false;
            function _check() {
                var isOpen = modalEl.classList.contains('show') || modalEl.style.display === 'flex';
                if (isOpen && !wasOpen) _ensureCloseButton();
                wasOpen = isOpen;
            }
            new MutationObserver(_check).observe(modalEl, { attributes: true, attributeFilter: ['class', 'style'] });
            _check(); // cover the case where it's already open at the moment this file runs
        })();

        /**
         * Guarantees the create-page modal always has a visible, working way
         * to leave it. Previously this relied entirely on a `.close-modal`
         * button assumed to exist inside a `.modal-card` wrapper somewhere
         * in the surrounding page markup — if that markup wasn't present,
         * there was no way to back out of the form once opened. Now: wire
         * any existing close button if found, but also inject a fallback
         * X button, wire backdrop-click-to-close, and Escape-to-close, all
         * self-contained in this module so none of it depends on external
         * markup being exactly right.
         */
        function _ensureCloseButton() {
            var modalEl = document.getElementById('create-business-page-modal');
            if (!modalEl) return;

            /* Click on the backdrop itself (not its children) closes it */
            if (!modalEl._bizBackdropWired) {
                modalEl._bizBackdropWired = true;
                modalEl.addEventListener('click', function (e) {
                    if (e.target === modalEl) _closeModal();
                });
            }

            /* Escape key closes it while open */
            if (!window._bizModalEscWired) {
                window._bizModalEscWired = true;
                document.addEventListener('keydown', function (e) {
                    if (e.key !== 'Escape') return;
                    var m = document.getElementById('create-business-page-modal');
                    if (m && m.classList.contains('show')) _closeModal();
                });
            }

            /* Wire any existing close button the surrounding markup provides.
               FIX (exit button "not visible/tappable"): index.html's native
               .close-modal button on this modal carries no inline style and
               there is no CSS rule anywhere for .close-modal scoped to this
               modal (other modals at least set inline top/right/z-index).
               With nothing positioning it, it rendered as a bare default
               button in normal document flow at the top of the card — easy
               to get visually squashed/overlapped by the cover-photo
               uploader immediately below it. We now force the same
               positioning/sizing the fallback-injection branch below already
               used, directly onto the existing button, so it's guaranteed
               visible and tappable regardless of what (if any) external CSS
               targets it. */
            var form = document.getElementById('create-business-page-form');
            var card = (form && (form.closest('.modal-card') || form.parentElement)) || modalEl;
            if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

            var existingClose = modalEl.querySelector('.close-modal, [data-action="close-modal"]');
            if (existingClose) {
                existingClose.style.cssText = 'position:absolute;top:10px;right:10px;width:34px;height:34px;'
                    + 'border-radius:50%;background:rgba(10,14,39,0.07);border:none;font-size:1.1rem;'
                    + 'line-height:34px;text-align:center;padding:0;color:#6B7280;cursor:pointer;'
                    + 'z-index:5;';
                if (!existingClose._bizWired) {
                    existingClose._bizWired = true;
                    existingClose.addEventListener('click', _closeModal);
                }
                return;
            }

            /* Fallback: inject our own X button if none is present at all */
            if (card.querySelector('#biz-create-modal-close-btn')) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'biz-create-modal-close-btn';
            btn.setAttribute('aria-label', 'Close');
            btn.innerHTML = '<i class="fas fa-times"></i>';
            btn.style.cssText = 'position:absolute;top:10px;right:10px;width:34px;height:34px;'
                + 'border-radius:50%;background:rgba(10,14,39,0.07);border:none;font-size:1rem;'
                + 'color:#6B7280;cursor:pointer;z-index:5;';
            btn.addEventListener('click', _closeModal);
            card.insertBefore(btn, card.firstChild);
        }

        function _wireImageUploader(inputId, previewId, isAvatar) {
            var input   = document.getElementById(inputId);
            var preview = document.getElementById(previewId);
            if (!input || !preview) return;
            input.addEventListener('change', function () {
                /* Guard: Android double-fires change — drop duplicates */
                var file = input.files && input.files[0];
                if (!file) return;
                var _sig = file.name + file.size + file.lastModified;
                if (input._lastChangeSig === _sig) return;
                input._lastChangeSig = _sig;
                preview.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                // ADDED (2026-08-10 — upload progress tracker)
                var _bizAvatarBar = (typeof window.empUploadProgress === 'object')
                    ? window.empUploadProgress.attach(preview.parentElement || preview, isAvatar ? 'Profile photo' : 'Cover photo')
                    : { update: function () {}, done: function () {}, fail: function () {} };
                _uploadMedia(file, function (pct) { _bizAvatarBar.update(pct); }).then(function (url) {
                    _bizAvatarBar.done();
                    if (isAvatar) {
                        _avatarUrl = url;
                        preview.style.backgroundImage = 'url(' + url + ')';
                        preview.style.backgroundSize  = 'cover';
                        preview.innerHTML = '';
                    } else {
                        _coverUrl = url;
                        preview.style.backgroundImage = 'url(' + url + ')';
                        preview.style.backgroundSize  = 'cover';
                        preview.innerHTML = '';
                    }
                    _notify('Image uploaded!', 'success');
                }).catch(function () {
                    _bizAvatarBar.fail('Failed');
                    _notify('Upload failed — please try again.', 'error');
                    preview.innerHTML = '<i class="fas fa-camera"></i>&nbsp; Add Cover Image';
                });
            });
        }

        function _wireForm() {
            var form = document.getElementById('create-business-page-form');
            if (!form || form._bizWired) { _ensureCloseButton(); return; }
            form._bizWired = true;
            _ensureCloseButton();

            _wireImageUploader('page-cover-photo-input',   'page-cover-photo-preview',   false);
            _wireImageUploader('page-profile-photo-input', 'page-profile-photo-preview', true);
            _renderCategoryStep();

            form.addEventListener('submit', function (e) {
                e.preventDefault();
                if (!_fbOk()) { _notify('Not connected — please try again.', 'error'); return; }

                var us = _us();

                /* Up to MAX_BIZ_PAGES pages per account. */
                var existingPages = _myPages(us);
                if (existingPages.length >= MAX_BIZ_PAGES) {
                    _notify('You already have ' + MAX_BIZ_PAGES + ' business pages — that\'s the maximum allowed. Delete one to create another.', 'warning');
                    return;
                }

                var name = (document.getElementById('page-name')    || {}).value || '';
                var tag  = (document.getElementById('page-tagline') || {}).value || '';
                var email= (document.getElementById('page-email')   || {}).value || '';
                var phone= (document.getElementById('page-phone')   || {}).value || '';
                var addr = (document.getElementById('page-address') || {}).value || '';
                var web  = (document.getElementById('page-website') || {}).value || '';

                if (!name.trim()) { _notify('Organisation name is required.', 'error'); return; }
                if (!_selectedCategory || !BIZ_CATEGORIES[_selectedCategory]) {
                    _notify('Please choose a business category.', 'error');
                    return;
                }
                var chosenCat = BIZ_CATEGORIES[_selectedCategory];

                var btn = form.querySelector('[type="submit"]');
                if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

                var pageId = 'biz-' + Date.now() + '-' + (Math.random() * 1e6 | 0);
                var doc = {
                    id: pageId,
                    ownerId: us.id || '',
                    name: name.trim(),
                    tagline: tag.trim(),
                    /* `category` is the new source of truth (drives the
                       Dynamic Page Model — _resolveCategory() below always
                       prefers it); `industry` is kept in sync as the
                       category's display label purely for back-compat with
                       every older file that still reads data.industry
                       (dashboard chips, admin panel, search). */
                    category: _selectedCategory,
                    industry: chosenCat.label,
                    categoryData: _collectCategoryFieldValues(_selectedCategory, 'pgcf-'),
                    socialLinks: _collectSocialLinksValues('pgsl-'),
                    website: web.trim(),
                    email: email.trim(),
                    phone: phone.trim(),
                    address: addr.trim(),
                    bio: tag.trim(),
                    coverPhoto: _coverUrl,
                    profilePhoto: _avatarUrl,
                    followers: [],
                    verified: false,   /* Universal feature: Verified badge — starts unverified; admin-only toggle in app-admin.js */
                    pageViews: 0,      /* Universal feature: Analytics dashboard */
                    createdAt: Date.now()
                };

                window.fbDb.collection('business_pages').doc(pageId).set(doc)
                    .then(function () {
                        window._firestoreBusinessPages = window._firestoreBusinessPages || [];
                        window._firestoreBusinessPages.unshift(doc);
                        window._activeBizData    = doc;
                        window._activeBizPageId  = pageId;

                        /* FIX (bug: "business page doesn't persist — asks me
                           to create another one after logout/refresh"): this
                           write links the page to the account. It used to
                           have a silent .catch(function(){}) — if Firestore
                           rejected it (e.g. Security Rules not whitelisting
                           the "businessPage" field on the users collection),
                           the page saved fine to business_pages/ but never
                           got attached to users/{uid}, so nothing was found
                           on next login. Now: wait for it, only confirm
                           success once BOTH writes are done, and surface a
                           clear error (instead of hiding it) if it fails —
                           the page it created is NOT lost in that case, it
                           just isn't linked to your account yet, so we keep
                           the modal open and let you retry.

                           MULTI-PAGE SUPPORT: businessPages is now an array
                           (max 5). businessPage (singular) is kept in sync as
                           businessPages[0] so every other file that still
                           reads the old singular field (follow counts, the
                           feed composer's quick-post-as-business shortcut,
                           the profile "my page" link, admin unlink, dashboard
                           dedup) keeps working exactly as before — they just
                           always see your first/primary page. */
                        var newPages = existingPages.concat([doc]).slice(0, MAX_BIZ_PAGES);
                        return window.fbDb.collection('users').doc(us.id).update({
                                businessPages: newPages,
                                businessPage:  newPages[0]
                            })
                            .then(function () {
                                us.businessPages = newPages;
                                us.businessPage  = newPages[0];
                                /* FIX (bug: page doesn't persist across
                                   refresh/logout — see note on
                                   window._persistSession in app-auth.js):
                                   keep the localStorage session snapshot in
                                   sync with this in-memory change, since a
                                   slow-network reload restores FROM that
                                   snapshot before Firestore's fresh fetch
                                   can land. */
                                if (typeof window._persistSession === 'function') window._persistSession(us);
                                _notify('Business page created!', 'success');
                                _closeModal();
                                form.reset();
                                _coverUrl  = '';
                                _avatarUrl = '';
                                _selectedCategory = BIZ_CATEGORY_ORDER[0];
                                var socialContainer = document.getElementById('page-social-links-container');
                                if (socialContainer) socialContainer._pgSocialRendered = false;
                                _renderCategoryStep();
                                setTimeout(function () {
                                    if (typeof window.navigateTo === 'function') window.navigateTo('business-page');
                                    setTimeout(function () {
                                        if (typeof window.renderBusinessPage === 'function') window.renderBusinessPage(pageId);
                                    }, 120);
                                }, 200);
                            })
                            .catch(function (linkErr) {
                                /* Page WAS created in business_pages/, it just
                                   isn't linked to the account — say so plainly
                                   instead of a generic failure message. */
                                throw new Error('Page created but could not be linked to your account: '
                                    + (linkErr && linkErr.message ? linkErr.message : 'permission denied')
                                    + '. Please try again.');
                            });
                    })
                    .catch(function (err) {
                        _notify((err && err.message) || 'Could not create page — please try again.', 'error');
                    })
                    .finally(function () {
                        if (btn) { btn.disabled = false; btn.textContent = 'Create Page'; }
                    });
            });

            /* Close button */
            var closeBtn = form.closest('.modal-card') && form.closest('.modal-card').querySelector('.close-modal');
            if (closeBtn && !closeBtn._bizWired) {
                closeBtn._bizWired = true;
                closeBtn.addEventListener('click', _closeModal);
            }
        }

        /* Wire a "Create Business Page" button if present */
        function _wireOpenBtn() {
            document.querySelectorAll('[data-action="create-business-page"], #create-business-page-btn, .create-business-page-btn')
                .forEach(function (btn) {
                    if (btn._bizOpenWired) return;
                    btn._bizOpenWired = true;
                    btn.addEventListener('click', function (e) {
                        e.preventDefault();
                        if (_isGuest()) { _notify('Please log in to create a business page.', 'info'); return; }
                        _openModal();
                        _wireForm();
                    });
                });
        }

        ready(function () {
            setTimeout(function () { _wireForm(); _wireOpenBtn(); }, 400);
        });
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(function () { _wireForm(); _wireOpenBtn(); }, 300);
        });
        document.addEventListener('empyrean-section-change', function (ev) {
            if (ev && ev.detail && ev.detail.section === 'business-page') {
                setTimeout(function () { _wireForm(); _wireOpenBtn(); }, 150);
            }
        });

    })();


    /* =========================================================================
       §5  renderBusinessPage(bizId) — FULL PAGE RENDERER
       ========================================================================= */

    /**
     * Renders a complete business page into #business-page.
     * Fetches page data from Firestore if not cached.
     * Shows post composer only for the page owner.
     * Shows a full product/post grid with media.
     *
     * @param {string} [bizId] — Firestore document ID of the business page
     */
    function renderBusinessPage(bizId) {
        var id = bizId || window._activeBizPageId || '';
        var cached = window._activeBizData;

        /* Use cached data when it matches the requested id */
        if (cached && (cached.id === id || !id)) {
            _renderBizPageFull(id || cached.id, cached);
            return;
        }

        /* Search in-memory cache first */
        var pages = window._firestoreBusinessPages || [];
        var us    = _us();
        if (us.businessPage) pages = [us.businessPage].concat(pages);
        var found = pages.find(function (p) { return p.id === id; });
        if (found) {
            window._activeBizData = found;
            _renderBizPageFull(id, found);
            return;
        }

        /* Firestore fetch */
        if (_fbOk() && id) {
            var sec = document.getElementById('business-page');
            if (sec) {
                sec.innerHTML =
                    '<div style="padding:60px 20px;text-align:center;color:#9CA3AF;">'
                    + '<i class="fas fa-spinner fa-spin" style="font-size:2.5rem;color:#1B2B8B;"></i>'
                    + '<p style="margin-top:16px;font-size:0.95rem;">Loading business page…</p></div>';
            }
            window.fbDb.collection('business_pages').doc(id).get()
                .then(function (doc) {
                    if (!doc.exists) {
                        var s = document.getElementById('business-page');
                        if (s) s.innerHTML = _emptyState('Business page not found.', 'fa-store-slash');
                        return;
                    }
                    var data = doc.data();
                    data.id = doc.id;
                    window._activeBizData = data;
                    if (!window._firestoreBusinessPages) window._firestoreBusinessPages = [];
                    if (!window._firestoreBusinessPages.find(function (p) { return p.id === data.id; })) {
                        window._firestoreBusinessPages.push(data);
                    }
                    _renderBizPageFull(id, data);
                })
                .catch(function (err) {
                    console.warn('[EmpBusiness] Firestore fetch error:', err);
                    var s = document.getElementById('business-page');
                    if (s) s.innerHTML = _emptyState('Could not load this page. Check your connection.', 'fa-wifi');
                });
            return;
        }

        /* No id, no cache — show own page or empty state */
        if (us.businessPage) {
            var own = typeof us.businessPage === 'object' ? us.businessPage : { id: us.businessPage };
            window._activeBizPageId = own.id;
            window._activeBizData   = typeof us.businessPage === 'object' ? us.businessPage : null;
            renderBusinessPage(own.id);
        } else {
            var sec2 = document.getElementById('business-page');
            if (sec2) sec2.innerHTML = _noPageYetState();
        }
    }
    window.renderBusinessPage = renderBusinessPage;

    /* Mark so app-fix-final.js §P6 wrapper can detect this as the authoritative version */
    renderBusinessPage._bizModuleV3 = true;

    /* Save a permanent reference to this raw renderer.
       Patch files (app-patch-v2/v3/v4) wrap window.renderBusinessPage after this module
       loads. Any of them can call window._appBizRenderer(id) directly to invoke the full
       app-business.js renderer, bypassing the wrapper chain entirely. */
    window._appBizRenderer = renderBusinessPage;


    /**
     * Core renderer — called once page data is available.
     */
    function _renderBizPageFull(bizId, data) {
        var sec = document.getElementById('business-page');
        if (!sec) return;

        var us      = _us();
        function _computeIsOwner(u) {
            return !!(_isAdmin()
                || (u.id && data.ownerId && data.ownerId === u.id)
                /* Check ALL of the user's pages (up to MAX_BIZ_PAGES), not just
                   the legacy singular `businessPage` field — that field only
                   ever mirrors page #1, so pages #2-#5 were being misread as
                   "not mine" whenever data.ownerId didn't resolve in time. */
                || (u.id && _myPages(u).some(function (pg) { return pg && pg.id === bizId; })));
        }
        var isOwner = _computeIsOwner(us);

        var name     = data.name     || data.businessName || 'Business Page';
        var cover    = data.coverPhoto  || data.coverImage  || '';
        var avatar   = data.profilePhoto|| data.logo        || '';
        var bio      = data.bio      || data.description   || data.tagline || '';
        var industry = data.industry || data.category      || '';
        var website  = data.website  || '';
        var email    = data.email    || '';
        var phone    = data.phone    || data.contactPhone  || '';
        var addr     = data.address  || '';
        var followers = Array.isArray(data.followers) ? data.followers.length : (data.followerCount || 0);
        var isFollowing = Array.isArray(data.followers) && us.id && data.followers.indexOf(us.id) > -1;

        /* FIX (2026-09-28 — "uploaded business cover doesn't display"): coverBg is
           dropped into a DOUBLE-quoted style="..." attribute below, but it used to wrap
           the URL in url("...") — the raw double quotes closed the style attribute early,
           leaving just "background:url(" (invalid) so the uploaded cover never painted
           (and no gradient either, since the gradient branch has no quotes). Now the URL
           is wrapped in single quotes, with any ' or " in it percent-encoded. */
        var coverBg  = cover
            ? "url('" + String(cover).replace(/'/g, '%27').replace(/"/g, '%22') + "') center/cover no-repeat"
            : 'linear-gradient(135deg,#0A0E27 0%,#1B2B8B 60%,#5B0EA6 100%)';
        var avatarSrc = avatar || (
            'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) +
            '&background=1B2B8B&color=fff&size=200'
        );

        /* ── Update body class for CSS composer visibility ── */
        document.body.classList.toggle('biz-visitor', !isOwner);

        /* ── Build page HTML ── */
        var html = [];

        /* Cover photo
           FIX (2026-08-06 — cover/avatar photo "not reflecting" + avatar
           "hiding inside the cover picture, difficult to upload"): this
           single container used to carry BOTH the cover background-image
           AND overflow:hidden (for rounded corners), while also being the
           direct parent of the avatar circle and its "change profile
           photo" camera button — both deliberately positioned to hang
           PARTWAY BELOW the cover (bottom:-40px / bottom:-28px) so the
           avatar overlaps the cover/page-info boundary, same as
           Facebook/Instagram business pages. overflow:hidden on their own
           parent silently clipped anything sticking out past the
           container's bottom edge: for the avatar that cut off roughly
           HALF the circle (only its top ~44px of 84px was ever visible —
           "hiding inside the cover"), and for the avatar's own edit-
           camera button (bottom:-28px, 28px tall) it clipped the button's
           ENTIRE height, making it invisible and untappable ("difficult
           to upload photo"). Uploads themselves were already working
           (see _wireCoverChange/_wireAvatarChange below) — the photo
           just never had a visible/tappable target to land on.
           FIX: split into an OUTER wrapper (position:relative, height:
           200px, no overflow clipping) that the avatar + edit-camera
           button are now positioned against, and an INNER div
           (position:absolute;inset:0;id="biz-cover-bg") that owns ONLY
           the background-image + rounded top corners + its own
           overflow:hidden — the image still clips/rounds correctly, but
           nothing positioned relative to the outer wrapper gets cut off
           anymore. Avatar's own offset (bottom:-40px) and the page-info
           section's compensating top padding (50px, unchanged further
           below) are untouched — this only removes the clipping. */
        html.push(
            '<div style="position:relative;height:200px;flex-shrink:0;">'
        );
        html.push(
            '<div id="biz-cover-bg" style="position:absolute;inset:0;background:' + coverBg + ';'
            + 'border-radius:18px 18px 0 0;overflow:hidden;"></div>'
        );
        if (isOwner) {
            html.push(
                '<label for="biz-cover-change-input" title="Change cover photo"'
                + ' style="position:absolute;bottom:12px;right:14px;background:rgba(0,0,0,0.55);'
                + 'color:white;border-radius:10px;padding:7px 14px;font-size:0.78rem;font-weight:700;'
                + 'cursor:pointer;display:flex;align-items:center;gap:6px;backdrop-filter:blur(4px);z-index:2;">'
                + '<i class="fas fa-camera"></i> Edit Cover</label>'
                + '<input type="file" id="biz-cover-change-input" accept="image/*" style="display:none;">'
            );
        }
        /* Avatar — now a direct child of the OUTER (non-clipping) wrapper,
           so its bottom:-40px overlap onto the page-info section below is
           fully visible instead of being cut off by the cover's own
           overflow:hidden. */
        html.push(
            '<div style="position:absolute;bottom:-40px;left:20px;width:84px;height:84px;'
            + 'border-radius:50%;border:4px solid #fff;overflow:hidden;'
            + 'box-shadow:0 4px 18px rgba(0,0,0,0.28);background:#e8eaf6;z-index:3;">'
            + '<img src="' + _attr(avatarSrc) + '" alt="' + _attr(name) + '"'
            + ' style="width:100%;height:100%;object-fit:cover;"'
            + ' onerror="this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff&size=200\'">'
            + '</div>'
        );
        if (isOwner) {
            html.push(
                '<label for="biz-avatar-change-input" title="Change profile photo"'
                + ' style="position:absolute;bottom:-28px;left:74px;z-index:4;'
                + 'background:#1B2B8B;color:white;border-radius:50%;width:28px;height:28px;'
                + 'display:flex;align-items:center;justify-content:center;cursor:pointer;'
                + 'box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white;">'
                + '<i class="fas fa-camera" style="font-size:0.65rem;"></i></label>'
                + '<input type="file" id="biz-avatar-change-input" accept="image/*" style="display:none;">'
            );
        }
        html.push('</div>'); /* end cover wrapper */

        /* Action row (follow / edit / share / delete) */
        html.push(
            '<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px 10px;'
            + 'padding:14px 18px 0;">'
        );
        /* Compact round icon-button helper, shared by Share + Delete so the
           action row can hold several controls on narrow phones without
           overflowing off-screen (redesigned per feedback: fixed pill
           buttons for every action didn't fit on smaller screens, which is
           why Share/Delete effectively disappeared off the edge). */
        function _iconBtn(id, icon, danger) {
            // FIX (2026-07-30): allow passing a raw inline SVG string (used for
            // the share icon, kept identical to the universal share glyph used
            // on business post cards/reels/feed) instead of only an FA class
            // name — FA's fa-share-alt rendered fine but was one more distinct
            // code path for the same icon rather than sharing the one true SVG.
            var iconHtml = (icon.indexOf('<svg') === 0) ? icon : '<i class="fas ' + icon + '"></i>';
            return '<button id="' + id + '" title="' + (danger ? 'Delete Page' : 'Share Page') + '"'
                + ' style="width:38px;height:38px;border-radius:50%;flex-shrink:0;display:flex;'
                + 'align-items:center;justify-content:center;cursor:pointer;font-size:0.92rem;'
                + (danger
                    ? 'background:rgba(239,68,68,0.08);color:#EF4444;border:2px solid rgba(239,68,68,0.25);'
                    : 'background:rgba(10,14,39,0.05);color:#374151;border:1.5px solid rgba(10,14,39,0.12);')
                + '">' + iconHtml + '</button>';
        }
        if (!isOwner) {
            html.push(
                '<button id="biz-follow-btn" data-biz-id="' + _attr(bizId) + '"'
                + ' style="padding:9px 26px;border-radius:50px;font-size:0.88rem;font-weight:700;'
                + 'background:' + (isFollowing ? 'rgba(27,43,139,0.1)' : 'linear-gradient(135deg,#1B2B8B,#5B0EA6)') + ';'
                + 'color:' + (isFollowing ? '#1B2B8B' : 'white') + ';'
                + 'border:' + (isFollowing ? '2px solid #1B2B8B' : 'none') + ';cursor:pointer;">'
                + (isFollowing
                    ? 'Following'
                    : '<i class="fas fa-plus" style="margin-right:6px;"></i>Follow Page')
                + '</button>'
            );
            html.push(_iconBtn('biz-share-btn', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', false));
        } else {
            html.push(
                '<button id="biz-my-pages-btn"'
                + ' style="padding:9px 18px;border-radius:50px;font-size:0.85rem;font-weight:700;'
                + 'background:rgba(10,14,39,0.05);color:#374151;border:1.5px solid rgba(10,14,39,0.12);cursor:pointer;">'
                + '<i class="fas fa-store" style="margin-right:6px;"></i>My Pages</button>'
            );
            html.push(
                '<button id="biz-edit-page-btn"'
                + ' style="padding:9px 22px;border-radius:50px;font-size:0.88rem;font-weight:700;'
                + 'background:rgba(27,43,139,0.08);color:#1B2B8B;border:2px solid rgba(27,43,139,0.25);cursor:pointer;">'
                + '<i class="fas fa-edit" style="margin-right:6px;"></i>Edit Page</button>'
            );
            html.push(_iconBtn('biz-share-btn', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', false));
            html.push(_iconBtn('biz-quick-delete-btn', 'fa-trash', true));
        }
        html.push('</div>');

        /* Page info */
        html.push(
            '<div style="padding:50px 20px 16px;">'
            + '<h2 style="margin:0 0 4px;font-size:1.35rem;font-weight:900;color:#0A0E27;'
            + 'line-height:1.2;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' + _esc(name)
            /* ── Universal feature: Verified badge ──
               Admin-only toggle (see app-admin.js's business-pages panel,
               "Verify"/"Unverify" button) writes data.verified onto the
               business_pages doc. Purely a display flag — same pattern
               already used for users/{uid}.isVerified on marketplace
               sellers (app-marketplace-governance.js) — not tied to the
               separate paid blue-badge system (app-blue-badge.js), which
               is for personal accounts, not business pages. */
            + (data.verified
                ? '<span title="Verified by Empyrean" style="display:inline-flex;align-items:center;justify-content:center;'
                    + 'width:20px;height:20px;border-radius:50%;background:#1B9AF5;flex-shrink:0;">'
                    + '<i class="fas fa-check" style="color:#fff;font-size:0.62rem;"></i></span>'
                : '')
            + '</h2>'
        );
        if (industry) {
            html.push(
                '<span style="display:inline-block;font-size:0.72rem;font-weight:700;'
                + 'padding:3px 12px;background:rgba(27,43,139,0.1);color:#1B2B8B;'
                + 'border-radius:20px;margin-bottom:10px;">' + _esc(industry) + '</span>'
            );
        }
        /* Follower count */
        html.push(
            '<p style="font-size:0.82rem;color:#6B7280;margin:4px 0 10px;">'
            + '<i class="fas fa-users" style="margin-right:5px;color:#1B2B8B;"></i>'
            + '<strong style="color:#0A0E27;">' + followers.toLocaleString() + '</strong> followers</p>'
        );
        if (bio) {
            html.push('<p style="font-size:0.9rem;color:#374151;margin:0 0 12px;line-height:1.55;">' + _esc(bio) + '</p>');
        }
        /* Contact info */
        if (website) {
            html.push('<p style="font-size:0.82rem;margin:5px 0;"><i class="fas fa-globe" style="color:#1B2B8B;width:16px;margin-right:7px;"></i>'
                + '<a href="' + _attr(website) + '" target="_blank" rel="noopener noreferrer" style="color:#1B2B8B;font-weight:600;">' + _esc(website) + '</a></p>');
        }
        if (email) {
            html.push('<p style="font-size:0.82rem;margin:5px 0;"><i class="fas fa-envelope" style="color:#1B2B8B;width:16px;margin-right:7px;"></i>'
                + '<a href="mailto:' + _attr(email) + '" style="color:#1B2B8B;">' + _esc(email) + '</a></p>');
        }
        if (phone) {
            html.push('<p style="font-size:0.82rem;margin:5px 0;"><i class="fas fa-phone" style="color:#1B2B8B;width:16px;margin-right:7px;"></i>'
                + '<a href="tel:' + _attr(phone) + '" style="color:#1B2B8B;">' + _esc(phone) + '</a></p>');
        }
        if (addr) {
            html.push('<p style="font-size:0.82rem;margin:5px 0;"><i class="fas fa-map-marker-alt" style="color:#1B2B8B;width:16px;margin-right:7px;"></i>'
                + '<span style="color:#374151;">' + _esc(addr) + '</span></p>');
        }

        /* ── Universal feature: Social media integration (display) ──
           Icons only ever render for platforms the owner actually filled
           in (biz-social-* inputs, collected by _collectSocialLinksValues
           in the create/edit forms) — same "omit empty" convention as
           every category info card below. */
        var socialLinks = data.socialLinks || {};
        var socialIcons = BIZ_SOCIAL_PLATFORMS.filter(function (p) { return !!socialLinks[p.key]; });
        if (socialIcons.length) {
            html.push('<div style="display:flex;gap:8px;margin:10px 0 2px;flex-wrap:wrap;">'
                + socialIcons.map(function (p) {
                    return '<a href="' + _attr(socialLinks[p.key]) + '" target="_blank" rel="noopener noreferrer" title="' + _attr(p.label) + '"'
                        + ' style="width:32px;height:32px;border-radius:50%;background:rgba(27,43,139,0.08);'
                        + 'display:flex;align-items:center;justify-content:center;color:#1B2B8B;text-decoration:none;font-size:0.82rem;">'
                        + '<i class="fab ' + p.icon + '"></i></a>';
                }).join('') + '</div>');
        }
        html.push('</div>'); /* end page info */

        /* ── Category-specific features section ──
           Resolves the page's category (explicit `category` field, or a
           best-fit mapping from the old free-text `industry` field for
           pages created before this system existed — see _resolveCategory)
           and renders the exact "Key Features by Category" panel from the
           spec: a key-features chip row, then info cards populated from
           categoryData, then the category's CTA button(s). Cards with no
           content yet are simply omitted rather than shown empty. */
        var bizCategoryId = _resolveCategory(data);
        html.push(_buildCategoryFeaturesSection(bizId, data, isOwner, bizCategoryId));

        /* ── Universal feature: Analytics dashboard (owner only) ──
           Page views (server-tracked, see _trackPageView below) + at-a-
           glance engagement numbers already available on the doc/DOM
           without a second Firestore read — followers and post count.
           Visitors never see this; it's the owner's own dashboard, not a
           public stat. */
        if (isOwner) {
            html.push(
                '<div style="margin:0 14px 16px;background:linear-gradient(135deg,#0A0E27,#1B2B8B);'
                + 'border-radius:16px;padding:16px 18px;color:#fff;">'
                + '<h4 style="margin:0 0 12px;font-size:0.85rem;font-weight:800;display:flex;align-items:center;gap:7px;opacity:0.9;">'
                + '<i class="fas fa-chart-simple"></i>Analytics Dashboard</h4>'
                + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">'
                + '<div><div id="biz-analytics-views" style="font-size:1.25rem;font-weight:900;">' + Number(data.pageViews || 0).toLocaleString() + '</div>'
                + '<div style="font-size:0.68rem;opacity:0.65;text-transform:uppercase;letter-spacing:0.03em;margin-top:2px;">Page Views</div></div>'
                + '<div><div id="biz-analytics-followers" style="font-size:1.25rem;font-weight:900;">' + followers.toLocaleString() + '</div>'
                + '<div style="font-size:0.68rem;opacity:0.65;text-transform:uppercase;letter-spacing:0.03em;margin-top:2px;">Followers</div></div>'
                + '<div><div id="biz-analytics-posts" style="font-size:1.25rem;font-weight:900;">' + Number(data.postCount || 0).toLocaleString() + '</div>'
                + '<div style="font-size:0.68rem;opacity:0.65;text-transform:uppercase;letter-spacing:0.03em;margin-top:2px;">Posts</div></div>'
                + '</div></div>'
            );
        }

        /* ── Featured Products strip — populated by app-business-feedcard.js's
           renderBizPageFeaturedProducts(), same horizontally-scrollable
           thumbnail row used on the feed card, scoped to this page's own
           products. Hidden until that function finds at least one product. */
        html.push('<div id="vf-biz-featured-products" style="display:none;"></div>');

        /* ── Visitor notice ── */
        if (!isOwner) {
            html.push(
                '<div style="margin:0 16px 16px;padding:11px 16px;background:rgba(27,43,139,0.06);'
                + 'border-radius:12px;font-size:0.82rem;color:#1B2B8B;text-align:center;'
                + 'border:1px solid rgba(27,43,139,0.12);">'
                + '<i class="fas fa-eye" style="margin-right:7px;"></i>'
                + 'You are viewing <strong>' + _esc(name) + '</strong> as a visitor.</div>'
            );
        }

        /* ── Post composer (owners only) ── */
        if (isOwner) {
            /* Listing Details (phone / address / currency) — ONLY for
               product-based businesses (the 'product' category: retail,
               e-commerce, real estate, auto sales, etc.). An NGO, bank,
               government body, international institution, oil & gas
               company, or general service company isn't selling a priced,
               shippable item per-post, so these fields would be noise on
               their composer — omitted entirely for every category other
               than 'product', rather than just hidden/disabled. */
            var _showListingDetails = (bizCategoryId === 'product');
            html.push(
                '<div id="biz-post-composer" class="business-post-composer"'
                + ' style="margin:0 16px 16px;background:white;border-radius:16px;'
                + 'box-shadow:0 2px 12px rgba(10,14,39,0.08);border:1px solid rgba(10,14,39,0.07);'
                + 'padding:16px;overflow:hidden;">'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">'
                + '<img src="' + _attr(avatarSrc) + '" alt="' + _attr(name) + '"'
                + ' style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                + '<textarea id="business-post-content" placeholder="Write a short caption for this product/offer — this is what shows on your advert in the feed…"'
                + ' style="flex:1;border:1px solid rgba(10,14,39,0.1);border-radius:12px;padding:10px 14px;'
                + 'font-size:0.88rem;color:#374151;resize:none;min-height:60px;outline:none;'
                + 'font-family:inherit;line-height:1.45;background:#F9FAFB;"'
                + ' rows="2"></textarea>'
                + '</div>'
                /* Media preview strip */
                + '<div id="biz-media-preview" style="display:none;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>'
                /* Listing Details (optional) — product category only */
                + (_showListingDetails
                    ? '<div id="biz-listing-details" style="margin-bottom:12px;">'
                        + '<div style="font-size:0.7rem;font-weight:800;color:#6B7280;text-transform:uppercase;'
                        + 'letter-spacing:0.04em;margin-bottom:8px;">Listing Details (Optional)</div>'
                        + '<div style="display:flex;gap:8px;margin-bottom:8px;">'
                        + '<input type="tel" id="biz-listing-phone" placeholder="Phone number"'
                        + ' style="flex:1;min-width:0;border:1px solid rgba(10,14,39,0.12);border-radius:10px;'
                        + 'padding:10px 12px;font-size:0.85rem;color:#374151;outline:none;font-family:inherit;">'
                        + '<input type="text" id="biz-listing-address" placeholder="Pickup / listing address"'
                        + ' style="flex:1;min-width:0;border:1px solid rgba(10,14,39,0.12);border-radius:10px;'
                        + 'padding:10px 12px;font-size:0.85rem;color:#374151;outline:none;font-family:inherit;">'
                        + '</div>'
                        + '<select id="biz-listing-currency"'
                        + ' style="width:100%;box-sizing:border-box;border:1px solid rgba(10,14,39,0.12);border-radius:10px;'
                        + 'padding:10px 12px;font-size:0.85rem;color:#374151;outline:none;font-family:inherit;background:#fff;">'
                        + '<option value="NGN">Naira (₦)</option>'
                        + '<option value="USD">US Dollar ($)</option>'
                        + '<option value="GBP">Pound Sterling (£)</option>'
                        + '<option value="EUR">Euro (€)</option>'
                        + '</select>'
                        /* ADDED (2026-09-28 — "add price and other things relevant for
                           public display" for product sellers): condition, availability
                           and negotiable flag — all optional, saved per post and shown on
                           the dashboard card, feed card and this page's listing card. */
                        + '<div style="display:flex;gap:8px;margin-top:8px;">'
                        + '<select id="biz-listing-condition"'
                        + ' style="flex:1;min-width:0;box-sizing:border-box;border:1px solid rgba(10,14,39,0.12);border-radius:10px;'
                        + 'padding:10px 12px;font-size:0.85rem;color:#374151;outline:none;font-family:inherit;background:#fff;">'
                        + '<option value="">Condition (optional)</option><option value="New">New</option>'
                        + '<option value="Used">Used</option><option value="Refurbished">Refurbished</option></select>'
                        + '<select id="biz-listing-availability"'
                        + ' style="flex:1;min-width:0;box-sizing:border-box;border:1px solid rgba(10,14,39,0.12);border-radius:10px;'
                        + 'padding:10px 12px;font-size:0.85rem;color:#374151;outline:none;font-family:inherit;background:#fff;">'
                        + '<option value="">Availability (optional)</option><option value="In stock">In stock</option>'
                        + '<option value="Limited stock">Limited stock</option><option value="Pre-order">Pre-order</option>'
                        + '<option value="Sold out">Sold out</option></select>'
                        + '</div>'
                        + '<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:0.85rem;color:#374151;cursor:pointer;">'
                        + '<input type="checkbox" id="biz-listing-negotiable"> Price is negotiable</label>'
                        + '</div>'
                    : '')
                /* Action bar */
                + '<div style="display:flex;align-items:center;justify-content:space-between;'
                + 'padding-top:10px;border-top:1px solid rgba(10,14,39,0.07);">'
                + '<div style="display:flex;gap:8px;">'
                + '<label for="biz-media-input" title="Add photos or videos"'
                + ' style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;'
                + 'border-radius:10px;background:rgba(27,43,139,0.07);color:#1B2B8B;'
                + 'font-size:0.82rem;font-weight:700;cursor:pointer;transition:background 0.18s;">'
                + '<i class="fas fa-image"></i> Photo/Video</label>'
                + '<input type="file" id="biz-media-input" accept="image/*,video/*" multiple style="display:none;">'
                + '</div>'
                + '<button id="biz-post-submit-btn"'
                + ' style="padding:9px 26px;border-radius:50px;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);'
                + 'color:white;border:none;font-weight:700;font-size:0.88rem;cursor:pointer;'
                + 'transition:opacity 0.18s;">'
                + '<i class="fas fa-paper-plane" style="margin-right:6px;"></i>Post</button>'
                + '</div>'
                + '</div>'
            );
        }

        /* ── Posts/Listings area ── */
        html.push(
            '<div id="vf-biz-posts-area" style="padding:0 14px 40px;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;'
            + 'margin-bottom:14px;padding:12px 2px 0;">'
            + '<h3 style="font-size:1rem;font-weight:800;color:#0A0E27;margin:0;display:flex;align-items:center;gap:8px;">'
            + '<span style="width:28px;height:28px;border-radius:8px;background:rgba(27,43,139,0.1);'
            + 'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">'
            + '<i class="fas fa-store" style="color:#1B2B8B;font-size:0.8rem;"></i></span>'
            + 'Posts &amp; Listings</h3>'
            + '</div>'
            + '<div id="vf-biz-posts-list" style="display:flex;flex-direction:column;gap:14px;">'
            + '<div style="text-align:center;color:#9CA3AF;font-size:0.88rem;padding:32px 20px;">'
            + '<i class="fas fa-spinner fa-spin" style="font-size:1.6rem;color:#1B2B8B;margin-bottom:10px;display:block;"></i>'
            + 'Loading posts…</div>'
            + '</div>'
            + '</div>'
        );

        sec.innerHTML = html.join('');
        /* Ensure section is properly scrollable */
        sec.style.overflowY = 'auto';
        sec.style.webkitOverflowScrolling = 'touch';

        /* ── Wire cover/avatar change for owner ── */
        if (isOwner) {
            _wireCoverChange(bizId, data);
            _wireAvatarChange(bizId, data);
        }

        /* ── Wire follow button ── */
        var followBtn = sec.querySelector('#biz-follow-btn');
        if (followBtn) _wireFollowBtn(followBtn, bizId, data);

        /* ── Wire Share Page button (visible to owners and visitors alike) ── */
        var shareBtn = sec.querySelector('#biz-share-btn');
        if (shareBtn && !shareBtn._wired) {
            shareBtn._wired = true;
            shareBtn.addEventListener('click', function () {
                // FIX: this used to share window.location.href — the current
                // SPA URL, which (being a single-page app) never actually
                // carries the business page's id in a way a link-preview
                // crawler could resolve. Sharing that URL meant WhatsApp/
                // Facebook always fell back to the generic branded card,
                // never the real page name/photo/follower count, no matter
                // what server.js did. Building the same ?post=<id> permalink
                // used for posts/reels/etc. routes it through the same
                // crawler-preview logic in server.js (_collectionForId's
                // 'biz-' prefix -> business_pages collection).
                var shareUrl = window.location.origin + '/?post=' + encodeURIComponent(bizId);
                var shareData = { title: name, text: (bio || ('Check out ' + name + ' on Empyrean')), url: shareUrl };
                if (navigator.share) {
                    navigator.share(shareData).catch(function () { /* user cancelled — no-op */ });
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(shareUrl)
                        .then(function () { _notify('Page link copied to clipboard!', 'success'); })
                        .catch(function () { _notify('Could not copy link.', 'error'); });
                } else {
                    _notify(shareUrl, 'info');
                }
            });
        }

        /* ── Wire quick Delete button (owner only — same action as the one
           inside Edit Page, just directly visible so it isn't buried) ── */
        var quickDeleteBtn = sec.querySelector('#biz-quick-delete-btn');
        if (quickDeleteBtn && !quickDeleteBtn._wired) {
            quickDeleteBtn._wired = true;
            quickDeleteBtn.addEventListener('click', function () {
                if (!quickDeleteBtn._confirming) {
                    quickDeleteBtn._confirming = true;
                    quickDeleteBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                    quickDeleteBtn.title = 'Tap again to permanently delete';
                    setTimeout(function () {
                        if (quickDeleteBtn._confirming) {
                            quickDeleteBtn._confirming = false;
                            quickDeleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                            quickDeleteBtn.title = 'Delete Page';
                        }
                    }, 4000);
                    return;
                }
                quickDeleteBtn._confirming = false;
                quickDeleteBtn.disabled = true;
                quickDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                _deleteBusinessPage(bizId)
                    .then(function () {
                        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
                    })
                    .catch(function (err) {
                        quickDeleteBtn.disabled = false;
                        quickDeleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                        _notify('Failed to delete: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            });
        }

        /* ── Wire category feature CTAs (Donate, Volunteer, Support Chat,
           Citizen Feedback, Collaboration Request, Book/Inquire — whichever
           the resolved category rendered) ── */
        _wireCategoryFeatureActions(bizId, data, bizCategoryId);

        /* ── Wire the key-features chip row's "+N more" chevron toggle ── */
        _wireKeyFeaturesToggle(bizId);

        /* ── Bank category: initialize the Branch/ATM Leaflet map, if the
           owner filled in at least one geocoded ("lat,lng") line ── */
        if (bizCategoryId === 'bank') { _wireBankLocatorMap(bizId); }

        /* ── Universal feature: Analytics dashboard — record this view.
           Owner views count too (matches the page-views-are-total-traffic
           convention every other analytics surface in this app already
           uses); _trackPageView's own sessionStorage guard already caps
           this at one increment per browser session per page, so an
           owner repeatedly opening their own page doesn't inflate it. */
        _trackPageView(bizId);

        /* ── Wire edit page button ── */
        if (isOwner) { _wireEditPageBtn(bizId, data); }

        /* ── Wire "My Pages" button (multi-page switcher, up to 5) ── */
        if (isOwner) {
            var myPagesBtn = document.getElementById('biz-my-pages-btn');
            if (myPagesBtn && !myPagesBtn._wired) {
                myPagesBtn._wired = true;
                myPagesBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    _renderMyPagesList();
                });
            }
        }

        /* ── Wire post composer ── */
        if (isOwner) {
            _wirePostComposer(bizId, data, avatarSrc, name);
        }

        /* ── Load posts from Firestore ── */
        _loadBizPosts(bizId, data, avatarSrc, name);

        /* ── Featured Products strip (app-business-feedcard.js) ── */
        if (typeof window.renderBizPageFeaturedProducts === 'function') {
            window.renderBizPageFeaturedProducts(bizId, sec.querySelector('#vf-biz-featured-products'));
        }

        /* ── Owner-detection safety net ──
           If this rendered as "visitor" but the user's account/auth state
           (_us()) hadn't finished loading yet at render time, re-check
           shortly after and re-render as owner if it turns out to be
           their page — instead of leaving them stuck looking like a
           visitor on their own business page. */
        if (!isOwner) {
            setTimeout(function () {
                if (window._activeBizPageId !== bizId) return; /* navigated away already */
                if (_computeIsOwner(_us())) renderBusinessPage(bizId);
            }, 700);
        }
    }


    /**
     * Shared business-page deletion routine — used by both the "Delete Page
     * & All Posts" button in the edit panel and the per-card delete button
     * in the "My Pages" switcher, so there's exactly one place that owns
     * Firestore cleanup + local/account-state sync.
     *
     * Deletes all business_posts for the page, then the page document
     * itself, then updates window._firestoreBusinessPages, the current
     * user's businessPages array (and legacy businessPage field), and
     * removes any matching cards from the DOM. Resolves with
     * { wasActive, remaining } on success so callers can decide whether
     * to navigate away.
     */
    function _deleteBusinessPage(bizId) {
        function _finish() {
            if (window._activeBizData && window._activeBizData.id === bizId) window._activeBizData = null;
            if (window._viewingBizPage && window._viewingBizPage.id === bizId) window._viewingBizPage = null;
            var wasActive = window._activeBizPageId === bizId;
            if (wasActive) window._activeBizPageId = '';

            var pages = window._firestoreBusinessPages || [];
            window._firestoreBusinessPages = pages.filter(function (p) { return p.id !== bizId; });

            var us = _us();
            /* MULTI-PAGE SUPPORT: remove the deleted page from the
               businessPages array (max 5) and re-derive the legacy
               singular businessPage field as the new first page (or
               null if none remain), so every other file still reading
               the old singular field stays correct. */
            var remaining = _myPages(us).filter(function (p) { return p.id !== bizId; });
            us.businessPages = remaining;
            us.businessPage  = remaining[0] || null;
            /* Keep the localStorage session snapshot in sync too — see the
               note on window._persistSession in app-auth.js / the create-page
               handler above for why the in-memory update alone isn't enough. */
            if (typeof window._persistSession === 'function') window._persistSession(us);
            if (_fbOk() && us.id) {
                window.fbDb.collection('users').doc(us.id).update({
                    businessPages: remaining,
                    businessPage:  remaining[0] || null
                }).catch(function (err) {
                    /* The page itself IS already deleted at this point —
                       this only failing means your account record is
                       briefly out of sync. Surface it instead of hiding
                       it so it doesn't look like nothing happened. */
                    _notify('Page deleted, but your account record could not be updated: '
                        + (err && err.message ? err.message : 'permission denied')
                        + '. It should correct itself next time you reload.', 'warning');
                });
            }

            /* Remove cards from dashboard slider / My Pages list */
            document.querySelectorAll('[data-biz-id="' + bizId + '"],[data-page-id="' + bizId + '"]').forEach(function (c) { c.remove(); });
            if (typeof window.renderDashboardBusinesses === 'function') {
                try { window.renderDashboardBusinesses(); } catch (e) {}
            }
            _notify('Business page deleted.', 'success');
            return { wasActive: wasActive, remaining: remaining };
        }

        if (!_fbOk() || !bizId) { return Promise.resolve(_finish()); }

        /* Delete all business_posts belonging to this page, then the page itself */
        return window.fbDb.collection('business_posts').where('pageId', '==', bizId).get()
            .then(function (snap) {
                var batchDeletes = [];
                snap.forEach(function (doc) { batchDeletes.push(doc.ref.delete().catch(function () {})); });
                return Promise.all(batchDeletes);
            })
            .catch(function () { /* ignore post-cleanup errors, still delete the page */ })
            .then(function () {
                return window.fbDb.collection('business_pages').doc(bizId).delete();
            })
            .then(_finish);
    }

    /* Wire Edit Page button */
    function _wireEditPageBtn(bizId, data) {
        var btn = document.getElementById('biz-edit-page-btn');
        if (!btn || btn._wired) return;
        btn._wired = true;
        btn.addEventListener('click', function () {
            var existing = document.getElementById('biz-edit-form-panel');
            if (existing) { existing.remove(); return; }
            if (!document.getElementById('_biz-edit-anim')) {
                var st = document.createElement('style');
                st.id = '_biz-edit-anim';
                st.textContent = '@keyframes slideUpEdit{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}';
                document.head.appendChild(st);
            }
            var panel = document.createElement('div');
            panel.id = 'biz-edit-form-panel';
            panel.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(10,14,39,0.65);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);';
            var inner = document.createElement('div');
            inner.style.cssText = 'background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;padding:24px 20px 36px;box-shadow:0 -8px 40px rgba(10,14,39,0.22);animation:slideUpEdit 0.28s cubic-bezier(0.34,1.56,0.64,1);';
            function _f(label, id, val, type) {
                return '<div style="margin-bottom:14px;"><label style="display:block;font-size:0.75rem;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">' + label + '</label>' +
                    (type === 'textarea'
                        ? '<textarea id="' + id + '" rows="3" style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;padding:9px 12px;font-size:0.88rem;color:#374151;resize:vertical;font-family:inherit;outline:none;">' + _esc(val || '') + '</textarea>'
                        : '<input type="text" id="' + id + '" value="' + _attr(val || '') + '" style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;padding:9px 12px;font-size:0.88rem;color:#374151;outline:none;">') + '</div>';
            }
            /* Business category — same tab selector as the Create Page
               modal, pre-selected to this page's current (resolved)
               category, with its dynamic fields pre-filled from
               data.categoryData. Changing tabs here re-renders the field
               set exactly like the create flow. */
            var _editCategory = _resolveCategory(data);

            inner.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
                '<h3 style="margin:0;font-size:1.05rem;font-weight:900;color:#0A0E27;"><i class="fas fa-edit" style="color:#1B2B8B;margin-right:8px;"></i>Edit Business Page</h3>' +
                '<button id="biz-edit-close-btn" style="background:rgba(10,14,39,0.07);border:none;width:34px;height:34px;border-radius:50%;font-size:1rem;cursor:pointer;color:#6B7280;"><i class="fas fa-times"></i></button></div>' +
                _f('Business Name', 'biz-edit-name', data.name || data.businessName, 'input') +
                _f('Bio / Description', 'biz-edit-bio', data.bio || data.description || data.tagline, 'textarea') +
                '<div style="margin-bottom:14px;"><label style="display:block;font-size:0.75rem;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">Business Category</label>' +
                '<div id="biz-edit-category-tabs"></div></div>' +
                '<div id="biz-edit-category-fields"></div>' +
                _f('Website', 'biz-edit-website', data.website, 'input') +
                _f('Email', 'biz-edit-email', data.email, 'input') +
                _f('Phone', 'biz-edit-phone', data.phone || data.contactPhone, 'input') +
                _f('Address', 'biz-edit-address', data.address, 'input') +
                '<div id="biz-edit-social-links" style="margin-bottom:14px;"></div>' +
                '<button id="biz-edit-save-btn" style="width:100%;padding:13px;border-radius:14px;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;border:none;font-weight:800;font-size:0.92rem;cursor:pointer;margin-top:6px;"><i class="fas fa-save" style="margin-right:7px;"></i>Save Changes</button>' +
                '<button id="biz-edit-delete-btn" style="width:100%;padding:13px;border-radius:14px;background:rgba(239,68,68,0.08);color:#EF4444;border:2px solid rgba(239,68,68,0.25);font-weight:800;font-size:0.92rem;cursor:pointer;margin-top:10px;"><i class="fas fa-trash" style="margin-right:7px;"></i>Delete Page &amp; All Posts</button>';
            panel.appendChild(inner);
            document.body.appendChild(panel);
            document.getElementById('biz-edit-close-btn').addEventListener('click', function () { panel.remove(); });
            panel.addEventListener('click', function (e) { if (e.target === panel) panel.remove(); });

            /* Render + wire the category tabs/fields, mirroring the create
               modal's _renderCategoryStep() but scoped to this panel's own
               containers/idPrefix ('edcf-') so the two never collide if
               both happen to be in the DOM at once. */
            function _renderEditCategoryStep() {
                var tabsEl   = document.getElementById('biz-edit-category-tabs');
                var fieldsEl = document.getElementById('biz-edit-category-fields');
                if (!tabsEl || !fieldsEl) return;
                tabsEl.innerHTML   = _renderCategoryTabsHTML(_editCategory);
                fieldsEl.innerHTML = _renderCategoryFieldsHTML(_editCategory, data.categoryData || {}, 'edcf-');
                if (!tabsEl._catTabsWired) {
                    tabsEl._catTabsWired = true;
                    tabsEl.addEventListener('click', function (e) {
                        var tab = e.target.closest('.biz-cat-tab');
                        if (!tab || !tab.dataset.cat || tab.dataset.cat === _editCategory) return;
                        e.preventDefault();
                        _editCategory = tab.dataset.cat;
                        _renderEditCategoryStep();
                    });
                }
            }
            _renderEditCategoryStep();
            var socialWrap = document.getElementById('biz-edit-social-links');
            if (socialWrap) socialWrap.innerHTML = _renderSocialLinksHTML(data.socialLinks || {}, 'edsl-');

            /* ── Delete Page button ── */
            document.getElementById('biz-edit-delete-btn').addEventListener('click', function () {
                var delBtn = this;
                if (!delBtn._confirming) {
                    delBtn._confirming = true;
                    delBtn.innerHTML = '<i class="fas fa-exclamation-triangle" style="margin-right:7px;"></i>Tap again to permanently delete';
                    setTimeout(function () {
                        if (delBtn._confirming) {
                            delBtn._confirming = false;
                            delBtn.innerHTML = '<i class="fas fa-trash" style="margin-right:7px;"></i>Delete Page &amp; All Posts';
                        }
                    }, 4000);
                    return;
                }
                delBtn._confirming = false;
                delBtn.disabled = true;
                delBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:7px;"></i>Deleting…';

                _deleteBusinessPage(bizId)
                    .then(function () {
                        panel.remove();
                        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
                    })
                    .catch(function (err) {
                        delBtn.disabled = false;
                        delBtn.innerHTML = '<i class="fas fa-trash" style="margin-right:7px;"></i>Delete Page &amp; All Posts';
                        _notify('Failed to delete: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            });

            document.getElementById('biz-edit-save-btn').addEventListener('click', function () {
                var sb = document.getElementById('biz-edit-save-btn');
                if (sb) { sb.disabled = true; sb.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:7px;"></i>Saving…'; }
                var chosenEditCat = BIZ_CATEGORIES[_editCategory] || BIZ_CATEGORIES.service;
                var updates = {
                    name:         (document.getElementById('biz-edit-name')     || {}).value || data.name || '',
                    /* category is the source of truth going forward; industry
                       kept in sync as its display label — same back-compat
                       reasoning as the create-page handler above. */
                    category:     _editCategory,
                    industry:     chosenEditCat.label,
                    categoryData: _collectCategoryFieldValues(_editCategory, 'edcf-'),
                    socialLinks:  _collectSocialLinksValues('edsl-'),
                    bio:       (document.getElementById('biz-edit-bio')       || {}).value || '',
                    website:   (document.getElementById('biz-edit-website')   || {}).value || '',
                    email:     (document.getElementById('biz-edit-email')     || {}).value || '',
                    phone:     (document.getElementById('biz-edit-phone')     || {}).value || '',
                    address:   (document.getElementById('biz-edit-address')   || {}).value || '',
                    updatedAt: new Date()
                };
                if (!window._firebaseLoaded || !window.fbDb) {
                    Object.assign(data, updates);
                    if (window._activeBizData) Object.assign(window._activeBizData, updates);
                    panel.remove();
                    if (typeof window.renderBusinessPage === 'function') window.renderBusinessPage(bizId);
                    _notify('Changes saved locally.', 'success');
                    return;
                }
                window.fbDb.collection('business_pages').doc(bizId).update(updates)
                    .then(function () {
                        Object.assign(data, updates);
                        if (window._activeBizData) Object.assign(window._activeBizData, updates);
                        var pages = window._firestoreBusinessPages || [];
                        var pg = pages.find(function (p) { return p.id === bizId; });
                        if (pg) Object.assign(pg, updates);
                        panel.remove();
                        if (typeof window.renderBusinessPage === 'function') window.renderBusinessPage(bizId);
                        _notify('Business page updated!', 'success');
                    })
                    .catch(function (err) {
                        if (sb) { sb.disabled = false; sb.innerHTML = '<i class="fas fa-save" style="margin-right:7px;"></i>Save Changes'; }
                        _notify('Failed to save: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            });
        });
    }

    /* Wire cover photo change */
    function _wireCoverChange(bizId, data) {
        var input = document.getElementById('biz-cover-change-input');
        if (!input || input._wired) return;
        input._wired = true;
        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var _sig2 = file.name + file.size + file.lastModified;
            if (input._lastChangeSig === _sig2 && input._coverBusy) return;
            input._lastChangeSig = _sig2;
            input._coverBusy = true;
            /* FIX (2026-09-28 — "business cover isn't uploading"): the input was never
               cleared, so after ONE failed/slow attempt, picking the same photo again
               fired no change event at all (browser sees an unchanged value) and, even
               when it did, the duplicate-signature guard swallowed it — the button just
               looked dead. Now the guard only blocks a genuine double-fire while an
               upload is in flight, and the input is cleared when the attempt finishes
               (success or failure) so the same photo can be retried straight away. */
            function _coverDone() { input._coverBusy = false; input._lastChangeSig = ''; try { input.value = ''; } catch (e) {} }
            _notify('Uploading cover photo\u2026', 'info');
            var _bizCoverBar = (typeof window.empUploadProgress === 'object')
                ? window.empUploadProgress.attach(document.getElementById('business-page') || document.body, 'Cover photo')
                : { update: function () {}, done: function () {}, fail: function () {} };
            _uploadMedia(file, function (pct) { _bizCoverBar.update(pct); }).then(function (url) {
                if (_fbOk() && bizId) {
                    /* FIX (bug: "cover photo upload doesn't persist"): this
                       used to update the DOM and show "Cover photo updated!"
                       immediately, with the Firestore write firing in the
                       background behind a silent .catch(function(){}) — so a
                       rejected write (e.g. Security Rules) still looked like
                       success until the next refresh wiped it. Now the UI
                       only updates and confirms success once Firestore
                       actually accepts the write. */
                    window.fbDb.collection('business_pages').doc(bizId).update({ coverPhoto: url })
                        .then(function () {
                            data.coverPhoto = url;
                            /* FIX (2026-09-28): also refresh the cached copies of this page.
                               renderBusinessPage() rebuilds from window._activeBizData /
                               window._firestoreBusinessPages, which still held the OLD (empty)
                               cover — so the new cover showed for a moment, then vanished the
                               next time the page re-rendered (tab switch, post, edit). */
                            try {
                                if (window._activeBizData && (window._activeBizData.id === bizId || !window._activeBizData.id)) window._activeBizData.coverPhoto = url;
                                var _pgs = window._firestoreBusinessPages || [];
                                for (var _pi = 0; _pi < _pgs.length; _pi++) { if (_pgs[_pi].id === bizId) { _pgs[_pi].coverPhoto = url; } }
                            } catch (_ce) {}
                            _coverDone();
                            /* FIX (2026-08-06): was '#business-page > div:first-child',
                               a positional selector that broke once the cover markup
                               was split into an outer non-clipping wrapper + this inner
                               background div (see _renderBizPageFull's own fix note
                               above) — id="biz-cover-bg" is stable regardless of how
                               many siblings/wrappers surround it. */
                            var coverDiv = document.getElementById('biz-cover-bg');
                            if (coverDiv) coverDiv.style.background = 'url("' + url + '") center/cover no-repeat';
                            _bizCoverBar.done();
                            _notify('Cover photo updated!', 'success');
                        })
                        .catch(function (err) {
                            _coverDone();
                            _bizCoverBar.fail('Save failed');
                            _notify('Cover photo could not be saved: ' + (err && err.message ? err.message : 'permission denied'), 'error');
                        });
                } else {
                    _coverDone();
                    data.coverPhoto = url;
                    var coverDiv2 = document.getElementById('biz-cover-bg');
                    if (coverDiv2) coverDiv2.style.background = 'url("' + url + '") center/cover no-repeat';
                    _bizCoverBar.done();
                    _notify('Cover photo updated locally (not saved — offline).', 'info');
                }
            }).catch(function (err) {
                /* FIX (2026-09-28): the real reason used to be thrown away ("Upload failed."
                   every time), so a storage/permission/network problem was impossible to tell apart. */
                _coverDone();
                console.warn('[EmpBusiness] cover upload failed:', err);
                _bizCoverBar.fail('Failed');
                _notify('Cover upload failed: ' + ((err && (err.message || err.code)) || 'please check your connection and try again.'), 'error');
            });
        });
    }

    /* Wire avatar change */
    function _wireAvatarChange(bizId, data) {
        var input = document.getElementById('biz-avatar-change-input');
        if (!input || input._wired) return;
        input._wired = true;
        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var _sig3 = file.name + file.size + file.lastModified;
            if (input._lastChangeSig === _sig3) return;
            input._lastChangeSig = _sig3;
            _notify('Uploading profile photo…', 'info');
            var _bizAvatarBar2 = (typeof window.empUploadProgress === 'object')
                ? window.empUploadProgress.attach(document.getElementById('business-page') || document.body, 'Profile photo')
                : { update: function () {}, done: function () {}, fail: function () {} };
            _uploadMedia(file, function (pct) { _bizAvatarBar2.update(pct); }).then(function (url) {
                if (_fbOk() && bizId) {
                    window.fbDb.collection('business_pages').doc(bizId).update({ profilePhoto: url })
                        .then(function () {
                            data.profilePhoto = url;
                            var imgs = document.querySelectorAll('#business-page img[alt="' + (data.name || '').replace(/"/g, '&quot;') + '"]');
                            imgs.forEach(function (img) { img.src = url; });
                            _bizAvatarBar2.done();
                            _notify('Profile photo updated!', 'success');
                        })
                        .catch(function (err) {
                            _bizAvatarBar2.fail('Save failed');
                            _notify('Profile photo could not be saved: ' + (err && err.message ? err.message : 'permission denied'), 'error');
                        });
                } else {
                    data.profilePhoto = url;
                    var imgs2 = document.querySelectorAll('#business-page img[alt="' + (data.name || '').replace(/"/g, '&quot;') + '"]');
                    imgs2.forEach(function (img) { img.src = url; });
                    _bizAvatarBar2.done();
                    _notify('Profile photo updated locally (not saved — offline).', 'info');
                }
            }).catch(function () { _bizAvatarBar2.fail('Failed'); _notify('Upload failed.', 'error'); });
        });
    }

    /* Wire follow button */
    function _wireFollowBtn(btn, bizId, data) {
        if (btn._wired) return;
        btn._wired = true;
        btn.addEventListener('click', function () {
            var us = _us();
            if (_isGuest() || !us.id) { _notify('Please log in to follow a page.', 'info'); return; }
            var followers = Array.isArray(data.followers) ? data.followers : [];
            var idx = followers.indexOf(us.id);
            if (idx > -1) {
                followers.splice(idx, 1);
                btn.innerHTML = '<i class="fas fa-plus" style="margin-right:6px;"></i>Follow Page';
                btn.style.background = 'linear-gradient(135deg,#1B2B8B,#5B0EA6)';
                btn.style.color = 'white';
                btn.style.border = 'none';
                _notify('Unfollowed page.', 'info');
            } else {
                followers.push(us.id);
                btn.innerHTML = 'Following';
                btn.style.background = 'rgba(27,43,139,0.1)';
                btn.style.color = '#1B2B8B';
                btn.style.border = '2px solid #1B2B8B';
                _notify('Following ' + (data.name || 'page') + '!', 'success');
            }
            data.followers = followers;
            if (_fbOk() && bizId) {
                window.fbDb.collection('business_pages').doc(bizId)
                    .update({ followers: followers })
                    .catch(function () {});
            }
            /* Update follower count display */
            var countEl = document.querySelector('#business-page .biz-follower-count');
            if (countEl) countEl.textContent = followers.length.toLocaleString();
        });
    }


    /* =========================================================================
       §6  renderDashboardBusinesses() — DASHBOARD SLIDER
       ========================================================================= */

    /**
     * Populate the business pages horizontal slider on the dashboard.
     * Targets both #dashboard-bizposts-container/#dashboard-bizposts-slider (real IDs)
     * and #dashboard-business-container/#dashboard-business-slider (alias IDs used by §14).
     */
    function renderDashboardBusinesses() {
        /* Resolve real vs alias slider.
           FIX (duplicate business-page cards): previously this resolved
           #dashboard-business-slider OR #dashboard-bizposts-slider fresh on
           EVERY call, and renamed #dashboard-bizposts-slider into
           #dashboard-business-slider the first time no alias existed yet.
           If this function got called more than once before §44's hidden
           alias was created (e.g. two independent callers firing on the same
           empyrean-init-done dispatch, or two separate init-done dispatches
           in one session), the rename could happen against the real,
           VISIBLE #dashboard-bizposts-slider — putting page-cards directly
           into the visible Business Posts strip — and a later call could
           re-resolve a different slider reference, producing duplicate
           cards. We now cache the resolved slider on window._bizDashSlider
           the first time it's found, so every subsequent call — no matter
           when or how many times it's invoked — targets the exact same
           element. */
        var slider = window._bizDashSlider || document.getElementById('dashboard-business-slider')
            || document.getElementById('dashboard-bizposts-slider');
        if (!slider) return;
        window._bizDashSlider = slider;

        /* Ensure alias IDs exist for §14 compatibility */
        if (!document.getElementById('dashboard-business-slider') && slider) {
            slider.id = 'dashboard-business-slider';
        }

        var us    = _us();
        var pages = (window._firestoreBusinessPages || []).slice();
        if (us.businessPage && typeof us.businessPage === 'object' && us.businessPage.id) {
            if (!pages.find(function (p) { return p.id === us.businessPage.id; })) {
                pages.unshift(us.businessPage);
            }
        }

        /* Remove placeholder/demo cards if real data is present */
        if (pages.length) {
            slider.querySelectorAll('[data-biz-id^="biz-demo-"],[data-biz-id^="demo-"]').forEach(function (c) { c.remove(); });
        }

        /* Render page cards */
        pages.forEach(function (biz) {
            if (!biz || !biz.id) return;
            if (slider.querySelector('[data-biz-id="' + biz.id + '"]')) return;

            var name    = biz.name || biz.businessName || 'Business';
            var avatar  = biz.profilePhoto || biz.logo || '';
            var cover   = biz.coverPhoto   || biz.coverImage || '';
            var ind     = biz.industry     || '';
            var isOwn   = (us.id && biz.ownerId === us.id);
            var followers = Array.isArray(biz.followers) ? biz.followers.length : 0;

            var card = document.createElement('div');
            card.className = 'dashboard-business-card';
            card.dataset.bizId   = biz.id;
            card.dataset.bizData = JSON.stringify(biz);
            card.style.cssText =
                'flex:0 0 200px;width:200px;border-radius:18px;overflow:hidden;cursor:pointer;'
                + 'box-shadow:0 4px 18px rgba(10,14,39,0.12);background:white;'
                + 'border:1px solid rgba(10,14,39,0.07);scroll-snap-align:start;'
                + 'transition:transform 0.2s,box-shadow 0.2s;display:flex;flex-direction:column;flex-shrink:0;';

            /* FIX (2026-09-28): same raw-double-quote-in-style-attribute bug as the
               full business page above — single-quote the url() instead. */
            var coverBg = cover
                ? "url('" + String(cover).replace(/'/g, '%27').replace(/"/g, '%22') + "') center/cover no-repeat"
                : 'linear-gradient(135deg,#0A0E27,#1B2B8B)';
            var avatarSrc = avatar || (
                'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff&size=100'
            );

            card.innerHTML =
                '<div style="height:88px;background:' + coverBg + ';position:relative;flex-shrink:0;">'
                + (isOwn ? '<span style="position:absolute;top:8px;right:9px;font-size:0.58rem;font-weight:800;'
                    + 'padding:3px 8px;border-radius:8px;background:rgba(245,197,24,0.95);color:#0A0E27;'
                    + 'letter-spacing:0.3px;box-shadow:0 2px 6px rgba(0,0,0,0.15);">YOURS</span>' : '')
                + '<div style="position:absolute;bottom:-22px;left:14px;width:46px;height:46px;'
                + 'border-radius:50%;border:3px solid white;overflow:hidden;background:#e8eaf6;'
                + 'box-shadow:0 3px 10px rgba(0,0,0,0.2);">'
                + '<img src="' + _attr(avatarSrc) + '" style="width:100%;height:100%;object-fit:cover;"'
                + ' onerror="this.src=\'https://ui-avatars.com/api/?name=B&background=1B2B8B&color=fff&size=100\'"></div>'
                + '</div>'
                + '<div style="padding:28px 12px 10px;">'
                + '<strong style="display:block;font-size:0.85rem;font-weight:800;color:#0A0E27;'
                + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(name) + '</strong>'
                + (ind ? '<span style="font-size:0.64rem;color:#5B0EA6;font-weight:700;display:block;margin-top:3px;'
                    + 'background:rgba(91,14,166,0.08);padding:2px 8px;border-radius:20px;display:inline-block;">' + _esc(ind) + '</span>' : '')
                + '<span style="font-size:0.68rem;color:#6B7280;display:block;margin-top:5px;">'
                + '<i class="fas fa-users" style="color:#1B2B8B;font-size:0.6rem;margin-right:3px;"></i>'
                + followers.toLocaleString() + ' followers</span>'
                + '</div>'
                + '<div style="padding:0 12px 14px;margin-top:auto;">'
                + '<button class="vf-biz-card-follow-btn biz-card-action-btn" data-biz-id="' + biz.id + '"'
                + ' style="width:100%;padding:8px;border-radius:10px;font-size:0.75rem;font-weight:700;'
                + 'background:' + (isOwn ? 'linear-gradient(135deg,#1B2B8B,#5B0EA6)' : 'rgba(27,43,139,0.07)') + ';'
                + 'color:' + (isOwn ? 'white' : '#1B2B8B') + ';'
                + 'border:' + (isOwn ? 'none' : '1.5px solid rgba(27,43,139,0.2)') + ';cursor:pointer;">'
                + (isOwn ? '<i class="fas fa-cog" style="margin-right:5px;font-size:0.65rem;"></i>Manage Page'
                         : '<i class="fas fa-eye" style="margin-right:5px;font-size:0.65rem;"></i>View Page') + '</button>'
                + '</div>';

            card.addEventListener('mouseenter', function () {
                card.style.transform = 'translateY(-4px)';
                card.style.boxShadow = '0 10px 28px rgba(10,14,39,0.2)';
            });
            card.addEventListener('mouseleave', function () {
                card.style.transform = '';
                card.style.boxShadow = '0 4px 16px rgba(10,14,39,0.12)';
            });
            card.addEventListener('click', function (e) {
                if (e.target.closest('.biz-card-action-btn,.vf-biz-card-follow-btn')) return;
                _navToBizPage(biz);
            });
            card.querySelector('.vf-biz-card-follow-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                _navToBizPage(biz);
            });

            slider.appendChild(card);
        });

        /* Fetch from Firestore if cache is empty */
        if (!pages.length && _fbOk() && !window._bizPagesFetchDone) {
            window._bizPagesFetchDone = true;
            window.fbDb.collection('business_pages').orderBy('createdAt', 'desc').limit(20).get()
                .then(function (snap) {
                    if (!window._firestoreBusinessPages) window._firestoreBusinessPages = [];
                    snap.forEach(function (doc) {
                        var d = doc.data(); d.id = doc.id;
                        if (!window._firestoreBusinessPages.find(function (p) { return p.id === d.id; })) {
                            window._firestoreBusinessPages.push(d);
                        }
                    });
                    renderDashboardBusinesses();
                })
                .catch(function (err) { console.warn('[EmpBusiness] dashboard fetch error:', err && err.message); });
        }
    }
    window.renderDashboardBusinesses = renderDashboardBusinesses;

    function _navToBizPage(biz) {
        window._activeBizPageId = biz.id;
        window._activeBizData   = biz;
        if (typeof window.navigateTo === 'function') window.navigateTo('business-page');
        /* Use 250ms — enough to let navigateTo + section-change at 100ms complete first.
           Always prefer _appBizRenderer (the raw app-business.js version) to bypass wrappers. */
        setTimeout(function () {
            var renderer = window._appBizRenderer || window.renderBusinessPage;
            if (typeof renderer === 'function') renderer(biz.id);
        }, 250);
    }


    /* =========================================================================
       §7  submitBusinessPost() — POST CREATION
       ========================================================================= */

    /**
     * Upload queued media files and write a business_posts document to Firestore.
     * Called by the composer submit button.
     */
    var _lastBizPostContent = '';
    var _lastBizPostTime    = 0;

    async function submitBusinessPost() {
        if (_isGuest()) { _notify('Please log in to post.', 'info'); return; }
        if (!_fbOk())   { _notify('Not connected — please try again.', 'error'); return; }

        var us      = _us();
        var bizId   = window._activeBizPageId || (us.businessPage && us.businessPage.id) || '';
        var bizData = window._activeBizData   || us.businessPage || {};
        var content = (document.getElementById('business-post-content') || {}).value || '';
        var files   = window._bizPendingMedia || [];

        if (!content.trim() && !files.length) {
            _notify('Please write something or add a photo/video.', 'info'); return;
        }
        /* Dedup guard */
        var now = Date.now();
        if (content === _lastBizPostContent && now - _lastBizPostTime < 6000) {
            _notify('Post already submitted — please wait.', 'info'); return;
        }
        _lastBizPostContent = content;
        _lastBizPostTime    = now;

        /* Disable submit button */
        var submitBtn = document.getElementById('biz-post-submit-btn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting…'; }

        var mediaUrls = [];
        var products  = []; /* { url, isVideo, name, price } — one entry per uploaded file,
                                read from the name/price inputs added in §8's composer preview.
                                Kept alongside media[] (not replacing it) so any older renderer
                                that only reads media[] keeps working unchanged. */
        // ADDED (2026-08-10 — upload progress tracker)
        var _bizPostBar = (typeof window.empUploadProgress === 'object')
            ? window.empUploadProgress.attach(
                document.getElementById('business-post-content')
                    ? document.getElementById('business-post-content').parentElement
                    : (document.body),
                files.length > 1 ? 'Media' : 'Upload')
            : { update: function () {}, done: function () {}, fail: function () {} };
        try {
            if (files.length) {
                _notify('Uploading media…', 'info');
                for (var i = 0; i < files.length; i++) {
                    var url = await _uploadMedia(files[i], function (pct) {
                        var overall = Math.round(((i + (pct / 100)) / files.length) * 100);
                        _bizPostBar.update(overall, files.length > 1 ? ('File ' + (i + 1) + '/' + files.length) : null);
                    });
                    mediaUrls.push(url);
                    products.push({
                        url: url,
                        isVideo: !!(files[i].type && files[i].type.startsWith('video/')),
                        name: (files[i]._bizProductName  || '').trim(),
                        price: (files[i]._bizProductPrice || '').trim()
                    });
                }
                _bizPostBar.done();
            }
        } catch (err) {
            _bizPostBar.fail('Failed');
            _notify('Media upload failed: ' + (err.message || 'unknown'), 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i>Post'; }
            return;
        }

        var postId  = 'bizpost-' + Date.now() + '-' + (Math.random() * 1e6 | 0);
        var pageName   = bizData.name    || bizData.businessName || 'Business';
        var pageAvatar = bizData.profilePhoto || bizData.logo    || '';
        var pageCover  = bizData.coverPhoto   || bizData.coverImage || '';
        /* Carried onto the post so the feed's advert card (app-business-
           feedcard.js) can show contact info without a second Firestore
           read per card — mirrors how pageName/pageAvatar/pageCover are
           already snapshotted onto every post the same way. */
        var pagePhone   = bizData.phone   || bizData.contactPhone || '';
        var pageAddress = bizData.address || '';

        /* Per-post Listing Details (Optional) — only rendered in the
           composer for the 'product' category (see the composer HTML
           above), so these elements simply won't exist for any other
           category and the fields below stay empty/undefined for them.
           Falls back to the page's own phone/address when the owner
           leaves a per-post field blank. */
        var listingPhoneEl    = document.getElementById('biz-listing-phone');
        var listingAddressEl  = document.getElementById('biz-listing-address');
        var listingCurrencyEl = document.getElementById('biz-listing-currency');
        var listingPhone    = listingPhoneEl    ? listingPhoneEl.value.trim()    : '';
        var listingAddress  = listingAddressEl  ? listingAddressEl.value.trim()  : '';
        var listingCurrency = listingCurrencyEl ? listingCurrencyEl.value        : '';

        var listingConditionEl    = document.getElementById('biz-listing-condition');
        var listingAvailabilityEl = document.getElementById('biz-listing-availability');
        var listingNegotiableEl   = document.getElementById('biz-listing-negotiable');

        var doc = {
            id: postId,
            pageId: bizId,
            userId: us.id || '',
            username: us.username || us.fullName || 'User',
            pageName: pageName,
            pageAvatar: pageAvatar,
            pageCover: pageCover,
            pagePhone: pagePhone,
            pageAddress: pageAddress,
            listingPhone: listingPhone || pagePhone,
            listingAddress: listingAddress || pageAddress,
            listingCurrency: listingCurrency || 'NGN',
            text: content.trim(),
            media: mediaUrls,
            products: products,
            likes: 0,
            comments: [],
            createdAt: Date.now()
        };
        /* only written when the seller actually chose/ticked something */
        if (listingConditionEl    && listingConditionEl.value)    doc.listingCondition    = listingConditionEl.value;
        if (listingAvailabilityEl && listingAvailabilityEl.value) doc.listingAvailability = listingAvailabilityEl.value;
        if (listingNegotiableEl   && listingNegotiableEl.checked) doc.listingNegotiable   = true;

        window.fbDb.collection('business_posts').doc(postId).set(doc)
            .then(function () {
                _notify('Post published!', 'success');
                /* Clear composer */
                var ta = document.getElementById('business-post-content');
                if (ta) ta.value = '';
                if (listingPhoneEl)    listingPhoneEl.value = '';
                if (listingAddressEl)  listingAddressEl.value = '';
                if (listingCurrencyEl) listingCurrencyEl.value = 'NGN';
                if (listingConditionEl)    listingConditionEl.value = '';
                if (listingAvailabilityEl) listingAvailabilityEl.value = '';
                if (listingNegotiableEl)   listingNegotiableEl.checked = false;
                window._bizPendingMedia = [];
                var preview = document.getElementById('biz-media-preview');
                if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
                /* Prepend to the live posts list */
                var list = document.getElementById('vf-biz-posts-list');
                if (list) {
                    var empty = list.querySelector('[style*="Loading posts"]');
                    if (empty) empty.remove();
                    var noPostsEl = list.querySelector('[style*="No posts yet"]');
                    if (noPostsEl) noPostsEl.remove();
                    var card = _buildBizPostCard(doc, pageAvatar, pageName);
                    list.prepend(card);
                }
            })
            .catch(function (err) {
                _notify('Could not save post: ' + (err.message || 'error'), 'error');
            })
            .finally(function () {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i>Post'; }
            });
    }
    window.submitBusinessPost = submitBusinessPost;


    /* =========================================================================
       §8  POST COMPOSER — WIRE-UP & MEDIA PREVIEW
       ========================================================================= */

    function _wirePostComposer(bizId, data, avatarSrc, pageName) {
        window._bizPendingMedia = [];

        var submitBtn = document.getElementById('biz-post-submit-btn');
        var mediaInput = document.getElementById('biz-media-input');
        var preview    = document.getElementById('biz-media-preview');

        /* PRICE DISPLAY FIX (2026-08-07): mirrors the category gate this
           function's caller already applies to the Listing Details block
           just above (_showListingDetails) — NGOs / service-rendering
           organisations don't sell a priced, shippable item per-post, so
           the per-media "Price (optional)" field built into the media
           preview below is exactly as much noise for them as the Listing
           Details block already correctly omits. This was the one price
           input _showListingDetails never reached (it's built later, in
           the media-change handler below, independently of that block) —
           confirmed still showing for an NGO account via screenshot.
           Product name stays for every category (still useful to label
           what's in a photo); only the price input is category-gated. */
        var _pricedCategory = (_resolveCategory(data) === 'product');

        if (submitBtn && !submitBtn._wired) {
            submitBtn._wired = true;
            submitBtn.addEventListener('click', function (e) {
                e.preventDefault();
                submitBusinessPost();
            });
        }

        if (mediaInput && !mediaInput._wired) {
            mediaInput._wired = true;
            mediaInput.addEventListener('change', function () {
                var files = Array.from(mediaInput.files || []);
                if (files.length) {
                    var _sig4 = files.map(function(f){ return f.name+f.size+f.lastModified; }).join('|');
                    if (mediaInput._lastChangeSig === _sig4) return;
                    mediaInput._lastChangeSig = _sig4;
                }
                window._bizPendingMedia = (window._bizPendingMedia || []).concat(files);
                if (!preview) return;
                preview.style.display = 'flex';
                preview.style.flexWrap = 'wrap';
                files.forEach(function (file) {
                    var thumbUrl = URL.createObjectURL(file);
                    var wrap = document.createElement('div');
                    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:84px;flex-shrink:0;';
                    var isVid = file.type.startsWith('video/');

                    var thumb = document.createElement('div');
                    thumb.style.cssText = 'position:relative;width:84px;height:84px;border-radius:10px;overflow:hidden;flex-shrink:0;';
                    thumb.innerHTML = isVid
                        ? '<video src="' + thumbUrl + '" style="width:100%;height:100%;object-fit:cover;" muted preload="metadata"></video>'
                            + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);">'
                            + '<i class="fas fa-play" style="color:white;font-size:1.1rem;"></i></div>'
                        : '<img src="' + thumbUrl + '" style="width:100%;height:100%;object-fit:cover;">';
                    thumb.innerHTML += '<button style="position:absolute;top:3px;right:3px;width:18px;height:18px;'
                        + 'border-radius:50%;background:rgba(0,0,0,0.65);color:white;border:none;'
                        + 'cursor:pointer;font-size:0.65rem;display:flex;align-items:center;justify-content:center;">'
                        + '<i class="fas fa-times"></i></button>';
                    thumb.querySelector('button').addEventListener('click', function () {
                        var idx = window._bizPendingMedia.indexOf(file);
                        if (idx > -1) window._bizPendingMedia.splice(idx, 1);
                        wrap.remove();
                        if (!preview.children.length) preview.style.display = 'none';
                    });
                    wrap.appendChild(thumb);

                    /* Product name + price — stored directly on the file object so
                       submitBusinessPost() can read them off window._bizPendingMedia
                       without keeping a separate array in sync. Optional: a post can
                       still be plain media with no product info, same as before. */
                    var nameInput = document.createElement('input');
                    nameInput.type = 'text';
                    nameInput.placeholder = 'Product name';
                    nameInput.maxLength = 60;
                    nameInput.style.cssText = 'width:100%;font-size:0.68rem;padding:4px 6px;border-radius:6px;'
                        + 'border:1px solid rgba(0,0,0,0.12);outline:none;box-sizing:border-box;';
                    nameInput.addEventListener('input', function () { file._bizProductName = nameInput.value; });
                    wrap.appendChild(nameInput);

                    /* PRICE DISPLAY FIX (2026-08-07): only product-selling
                       categories get a price input at all — see the
                       _pricedCategory gate set at the top of
                       _wirePostComposer(). For NGOs/service categories,
                       file._bizProductPrice is simply never set, so
                       submitBusinessPost() below writes an empty price on
                       every product, exactly like a plain photo/video post. */
                    if (_pricedCategory) {
                        var priceInput = document.createElement('input');
                        priceInput.type = 'text';
                        priceInput.inputMode = 'decimal';
                        priceInput.placeholder = 'Price (optional)';
                        priceInput.maxLength = 20;
                        priceInput.style.cssText = 'width:100%;font-size:0.68rem;padding:4px 6px;border-radius:6px;'
                            + 'border:1px solid rgba(0,0,0,0.12);outline:none;box-sizing:border-box;';
                        priceInput.addEventListener('input', function () { file._bizProductPrice = priceInput.value; });
                        wrap.appendChild(priceInput);
                    }

                    preview.appendChild(wrap);
                });
                mediaInput.value = '';
            });
        }
    }


    /* =========================================================================
       §9  LOAD POSTS FROM FIRESTORE
       ========================================================================= */

    function _loadBizPosts(bizId, data, avatarSrc, pageName) {
        var list = document.getElementById('vf-biz-posts-list');
        if (!list) return;

        if (!_fbOk() || !bizId) {
            list.innerHTML = _emptyState('No posts yet.', 'fa-pen-nib');
            return;
        }

        /* FIX (failed-precondition / "missing composite index"): Firestore
           requires a composite index for where('pageId','==',x) combined
           with orderBy('createdAt','desc'). Until that index is created in
           the Firebase console, this query throws every time. Drop the
           orderBy from the server-side query and sort the results in JS
           instead — cheap for the volumes here and avoids the index dep. */
        window.fbDb.collection('business_posts')
            .where('pageId', '==', bizId)
            .limit(30)
            .get()
            .then(function (snap) {
                var rows = [];
                snap.forEach(function (doc) { var p = doc.data(); p.id = doc.id; rows.push(p); });
                rows.sort(function (a, b) {
                    var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
                    var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
                    return tb - ta;
                });
                /* Feed the Analytics Dashboard's Posts stat (query is capped
                   at 30 — appends "+" so an owner with more posts than that
                   isn't shown a falsely-exact low number). */
                var postsStatEl = document.getElementById('biz-analytics-posts');
                if (postsStatEl) postsStatEl.textContent = rows.length.toLocaleString() + (rows.length === 30 ? '+' : '');
                list.innerHTML = '';
                if (!rows.length) {
                    list.innerHTML =
                        '<div style="text-align:center;padding:40px 20px;color:#9CA3AF;">'
                        + '<i class="fas fa-store" style="font-size:2rem;color:rgba(27,43,139,0.2);margin-bottom:10px;display:block;"></i>'
                        + '<p style="margin:0;font-size:0.88rem;">No posts yet.'
                        + (window._activeBizData && window._activeBizData.ownerId === _us().id
                            ? ' Share your first update above!' : '') + '</p></div>';
                    return;
                }
                rows.forEach(function (p) {
                    var av = p.pageAvatar || avatarSrc;
                    var pn = p.pageName   || pageName;
                    list.appendChild(_buildBizPostCard(p, av, pn));
                });
            })
            .catch(function (err) {
                console.warn('[EmpBusiness] loadBizPosts error:', err);
                if (list) {
                    list.innerHTML =
                        '<div style="text-align:center;padding:30px;color:#9CA3AF;font-size:0.85rem;">'
                        + 'Could not load posts — check your connection.</div>';
                }
            });
    }

    /**
     * FIX (memory leak feeding the "Edit misbehaves" report): _buildBizPostCard
     * used to register its OWN `document.addEventListener('click', …)` on
     * every single render, purely to close that one card's options menu on
     * an outside click. Business Page re-renders itself automatically and
     * often (after every post, after every "Edit Page" save, on the
     * owner-detection safety-net timeout) — each re-render discards the old
     * cards via innerHTML replace, but the document-level listeners those
     * old cards registered are never removed, so they just pile up forever
     * for the lifetime of the tab. Registered once here instead, and reused
     * for every card via the shared `.options-menu.show` class already
     * defined in style.css.
     */
    var _bizMenuOutsideClickWired = false;
    function _wireBizMenuOutsideClick() {
        if (_bizMenuOutsideClickWired) return;
        _bizMenuOutsideClickWired = true;
        document.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('.post-options')) return;
            document.querySelectorAll('.biz-post-card .options-menu.show').forEach(function (m) {
                m.classList.remove('show');
                m.style.display = 'none';
            });
        });
    }

    /**
     * Build a styled post card element for the business page posts list.
     */
    /* ── Public listing helpers (2026-09-28) ────────────────────────────────
       _bizFmtMoney: formats the seller's free-text price with the currency they
       picked in Listing Details (₦ $ £ €) and thousands separators; text that
       already carries a symbol/code is shown exactly as typed. Posts made before
       the currency picker existed have no currency and keep the old "$" default.
       _bizListingChipsHTML: small pills for condition / availability / negotiable. */
    var _BIZ_CUR_SYM = { NGN: '\u20A6', USD: '$', GBP: '\u00A3', EUR: '\u20AC' };
    function _bizFmtMoney(price, cur) {
        if (price === undefined || price === null) return '';
        var p = String(price).trim();
        if (!p) return '';
        if (/^[\u20A6$\u00A3\u20AC]/.test(p) || /^(NGN|USD|GBP|EUR)\b/i.test(p)) return p;
        var sym = _BIZ_CUR_SYM[cur] || '$';
        var clean = p.replace(/[,\s]/g, '');
        if (/^\d+(\.\d+)?$/.test(clean)) {
            return sym + Number(clean).toLocaleString('en-US', { maximumFractionDigits: 2 });
        }
        return /^\d/.test(p) ? sym + p : p;
    }
    window._bizFmtMoney = _bizFmtMoney;
    function _bizListingChipsHTML(src) {
        if (!src) return '';
        var chip = function (txt, bg, fg) {
            return '<span style="display:inline-block;font-size:0.6rem;font-weight:800;padding:2px 8px;border-radius:20px;'
                + 'background:' + bg + ';color:' + fg + ';letter-spacing:0.2px;white-space:nowrap;">' + _esc(txt) + '</span>';
        };
        var out = '';
        if (src.condition) out += chip(src.condition, 'rgba(27,43,139,0.09)', '#1B2B8B');
        if (src.availability) {
            var a = src.availability;
            out += a === 'Sold out' ? chip(a, 'rgba(229,57,53,0.1)', '#C62828')
                 : a === 'Limited stock' ? chip(a, 'rgba(245,158,11,0.15)', '#B45309')
                 : a === 'Pre-order' ? chip(a, 'rgba(37,99,235,0.1)', '#1D4ED8')
                 : chip(a, 'rgba(16,185,129,0.13)', '#047857');
        }
        if (src.negotiable) out += chip('Negotiable', 'rgba(91,14,166,0.1)', '#5B0EA6');
        return out ? '<div style="display:flex;flex-wrap:wrap;gap:5px;">' + out + '</div>' : '';
    }

    function _buildBizPostCard(p, avatarSrc, pageName) {
        var card = document.createElement('div');
        card.className   = 'biz-post-card';   // ← targeted by app-patch-share-likes.js
        card.dataset.postId    = p.id;
        card.dataset.collection = 'business_posts'; // §45 like/share routing
        card.style.cssText =
            'background:#fff;border-radius:16px;overflow:hidden;'
            + 'box-shadow:0 2px 12px rgba(0,0,0,0.07);border:1px solid rgba(0,0,0,0.06);';

        var us      = _us();
        var isOwner = _isAdmin() || (us.id && p.userId && p.userId === us.id);
        var ts      = _ts(p.createdAt);
        var media   = p.media || [];

        /* Media HTML */
        var mediaHTML = '';
        if (media.length > 0) {
            var mc = media.length;
            var cols = mc === 1 ? '1fr' : mc === 2 ? '1fr 1fr' : mc === 3 ? '2fr 1fr' : '1fr 1fr';
            mediaHTML = '<div style="display:grid;grid-template-columns:' + cols + ';gap:2px;background:#f3f4f6;">';
            media.slice(0, 4).forEach(function (url, mi) {
                if (!url || url.startsWith('blob:')) return;
                var isVid = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url) || /\/video\/upload\//i.test(url);
                var extra = mc === 3 && mi === 0 ? 'grid-row:span 2;' : '';
                var cellHeight = mc === 1 ? '320px' : '200px';
                mediaHTML += '<div style="overflow:hidden;max-height:' + cellHeight + ';' + extra + '">';
                if (isVid) {
                    mediaHTML += '<video src="' + _attr(url) + '" controls preload="metadata" playsinline'
                        + ' style="width:100%;height:100%;object-fit:cover;display:block;"></video>';
                } else {
                    mediaHTML += '<img src="' + _attr(url) + '" alt="Post media" loading="lazy"'
                        + ' style="width:100%;height:100%;object-fit:cover;display:block;"'
                        + ' onerror="this.closest(\'div\').style.display=\'none\'">';
                }
                mediaHTML += '</div>';
            });
            if (media.length > 4) {
                mediaHTML += '<div style="display:flex;align-items:center;justify-content:center;'
                    + 'background:rgba(0,0,0,0.55);color:white;font-size:1.3rem;font-weight:800;min-height:100px;">'
                    + '+' + (media.length - 4) + '</div>';
            }
            mediaHTML += '</div>';
        }

        /* Options menu (owner only) */
        var optsHTML = isOwner
            ? '<div class="post-options" style="position:relative;">'
              + '<button class="options-btn" style="background:none;border:none;cursor:pointer;padding:4px 8px;">'
              + '<i class="fas fa-ellipsis-h" style="color:#6B7280;"></i></button>'
              + '<div class="options-menu" style="display:none;position:absolute;right:0;top:28px;background:white;'
              + 'border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,0.15);min-width:130px;z-index:50;overflow:hidden;border:1px solid rgba(0,0,0,0.07);">'
              + '<a href="#" class="edit-biz-post-btn" data-post-id="' + p.id + '"'
              + ' style="display:flex;align-items:center;gap:8px;padding:11px 14px;font-size:0.83rem;'
              + 'color:#1B2B8B;font-weight:600;text-decoration:none;border-bottom:1px solid rgba(0,0,0,0.06);">'
              + '<i class="fas fa-pen"></i> Edit</a>'
              + '<a href="#" class="delete-biz-post-btn" data-post-id="' + p.id + '"'
              + ' style="display:flex;align-items:center;gap:8px;padding:11px 14px;font-size:0.83rem;'
              + 'color:#e53935;font-weight:600;text-decoration:none;">'
              + '<i class="fas fa-trash"></i> Delete</a></div></div>'
            : '';

        card.innerHTML =
            /* Header */
            '<div style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px;">'
            + '<img src="' + _attr(avatarSrc) + '" alt="' + _attr(pageName) + '"'
            + ' style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;"'
            + ' onerror="this.src=\'https://ui-avatars.com/api/?name=B&background=1B2B8B&color=fff&size=100\'">'
            + '<div style="flex:1;min-width:0;">'
            + '<div style="font-weight:800;font-size:0.9rem;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
            + _esc(pageName) + '</div>'
            + '<div style="font-size:0.72rem;color:#9CA3AF;">' + ts + '</div>'
            + '</div>'
            + optsHTML
            + '</div>'
            /* Text —
               FIX (caption silently missing + unreachable): this used to be
               `display:none` and completely gone from layout whenever
               p.text was empty, with nothing pointing an owner at the fact
               a caption never saved, and no way to add one short of the
               "..." menu (hardened below — see that fix's note). An
               owner-only placeholder now always renders in that case, so a
               post that lost/never got its caption is visibly recoverable
               instead of quietly looking "fine" while missing content.
               Visitors still see nothing when there's genuinely no text. */
            + '<div class="biz-post-text-view' + (!p.text && isOwner ? ' biz-post-caption-empty' : '') + '"'
            + (p.text
                ? ' style="padding:0 16px 12px;font-size:0.9rem;color:#374151;line-height:1.55;"'
                : (isOwner
                    ? ' style="padding:0 16px 12px;font-size:0.85rem;color:#9CA3AF;font-style:italic;cursor:pointer;"'
                    : ' style="display:none;"'))
            + '>'
            + (p.text
                ? _esc(p.text)
                : (isOwner ? '<i class="fas fa-pen" style="margin-right:6px;"></i>No caption — tap to add one' : ''))
            + '</div>'
            /* Edit mode — hidden until "Edit" is clicked; swaps in place of
               .biz-post-text-view without touching media/action-bar HTML. */
            + '<div class="biz-post-edit-form" style="display:none;padding:0 16px 12px;">'
            + '<textarea class="biz-post-edit-textarea" rows="3"'
            + ' style="width:100%;box-sizing:border-box;border:1px solid rgba(10,14,39,0.12);border-radius:10px;'
            + 'padding:10px 12px;font-size:0.9rem;color:#374151;resize:vertical;font-family:inherit;'
            + 'line-height:1.5;outline:none;background:#F9FAFB;">' + _esc(p.text || '') + '</textarea>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">'
            + '<button type="button" class="biz-post-edit-cancel" style="padding:7px 16px;border-radius:20px;'
            + 'background:rgba(10,14,39,0.06);color:#374151;border:none;font-weight:700;font-size:0.8rem;cursor:pointer;">Cancel</button>'
            + '<button type="button" class="biz-post-edit-save" style="padding:7px 18px;border-radius:20px;'
            + 'background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:white;border:none;font-weight:700;'
            + 'font-size:0.8rem;cursor:pointer;">Save</button>'
            + '</div></div>'
            /* Media */
            + mediaHTML
            /* ADDED (2026-09-28): public listing details for product sellers */
            + (function () {
                var prods = (Array.isArray(p.products) ? p.products : []).filter(function (pr) { return pr && (pr.name || pr.price); });
                var hasPrice = prods.some(function (pr) { return pr.price; });
                var chips = _bizListingChipsHTML({ condition: p.listingCondition, availability: p.listingAvailability, negotiable: p.listingNegotiable });
                if (!hasPrice && !chips) return '';
                var rows = prods.slice(0, 6).map(function (pr) {
                    var pt = _bizFmtMoney(pr.price, p.listingCurrency);
                    return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:3px 0;">'
                        + '<span style="font-size:0.85rem;font-weight:700;color:#0A0E27;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(pr.name || 'Item') + '</span>'
                        + (pt ? '<span style="font-size:0.95rem;font-weight:900;color:#5B0EA6;flex-shrink:0;">' + _esc(pt) + '</span>' : '')
                        + '</div>';
                }).join('');
                if (prods.length > 6) rows += '<div style="font-size:0.75rem;color:#6B7280;">+' + (prods.length - 6) + ' more item(s)</div>';
                var contact = '';
                if (p.listingAddress) contact += '<div style="font-size:0.78rem;color:#6B7280;margin-top:6px;"><i class="fas fa-location-dot" style="color:#E53935;margin-right:6px;"></i>' + _esc(p.listingAddress) + '</div>';
                if (p.listingPhone) contact += '<div style="font-size:0.78rem;margin-top:3px;"><i class="fas fa-phone" style="color:#1B2B8B;margin-right:6px;"></i><a href="tel:' + _attr(p.listingPhone) + '" style="color:#1B2B8B;font-weight:700;text-decoration:none;">' + _esc(p.listingPhone) + '</a></div>';
                return '<div class="biz-post-listing-details" style="padding:10px 16px 12px;">' + rows
                    + (chips ? '<div style="margin-top:6px;">' + chips + '</div>' : '') + contact + '</div>';
            })()
            /* Action bar */
            + '<div style="display:flex;align-items:center;justify-content:space-around;padding:6px 10px;'
            + 'border-top:1px solid rgba(0,0,0,0.06);margin-top:2px;">'
            + '<a class="action-btn like-btn" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;'
            + 'font-size:0.82rem;color:#6B7280;text-decoration:none;cursor:pointer;padding:8px 4px;'
            + 'border-radius:8px;transition:background 0.15s,color 0.15s,transform 0.15s;">'
            + '<i class="far fa-heart" style="font-size:15px;"></i>'
            + '<span class="like-count" style="font-size:11px;font-weight:400;">'
            + ((p.likes && p.likes > 0) ? p.likes : '') + '</span></a>'
            + '<a class="action-btn comment-btn" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;'
            + 'font-size:0.82rem;color:#6B7280;text-decoration:none;cursor:pointer;padding:8px 4px;border-radius:8px;">'
            + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
            + '<span class="comment-count" style="font-size:11px;">'
            + ((p.comments && p.comments.length) || 0) + '</span></a>'
            + '<a class="action-btn share-btn" data-action="share" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;'
            + 'font-size:0.82rem;color:#6B7280;text-decoration:none;cursor:pointer;padding:8px 4px;border-radius:8px;">'
            + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'
            + '<span class="share-count" style="font-size:11px;">'
            + ((p.shareCount && p.shareCount > 0) ? p.shareCount : '') + '</span></a>'
            + '</div>';

        /* Wire options menu toggle —
           FIX ("Edit" tap misbehaving): two bugs here.
           1) This used to flip a raw inline `style.display` and, separately,
              register a BRAND NEW `document.addEventListener('click', …)`
              closure every single time a card was built. Business Page
              re-renders on its own after every post, after every "Edit
              Page" save, and via the owner-detection safety-net timeout —
              so on any page that had re-rendered a few times, dozens of
              these stale per-card listeners were stacked up forever (old
              cards get discarded via innerHTML replace, but their document
              listeners never get removed). That's a leak, and on this
              app's Android WebView — which has needed repaint-hardening
              for other inline style.display toggles before (see the share
              sheet's _forcePaint fix) — a bare inline-style flip under
              rapid taps is exactly the kind of toggle that can silently
              fail to repaint, making the "..." → Edit tap look like it
              does nothing.
           2) The open/close now uses the SAME class-based `.options-menu.
              show` convention style.css and the app's own global click
              router already use everywhere else (instead of a second,
              inline-style-only mechanism unique to this card type), and
              a forced double-rAF reflow after toggling, matching the
              hardening pattern already used elsewhere in this app for
              WebView repaint issues. The outside-click-closes behaviour is
              now ONE delegated listener (registered once, module-wide —
              see _wireBizMenuOutsideClick below) instead of one per card. */
        var optBtn = card.querySelector('.options-btn');
        var optMenu = card.querySelector('.options-menu');
        function _forceReflow(el) {
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    if (el) { void el.offsetHeight; } /* force the WebView to actually repaint */
                });
            });
        }
        if (optBtn && optMenu) {
            optBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var willOpen = !optMenu.classList.contains('show');
                document.querySelectorAll('.options-menu.show').forEach(function (m) {
                    if (m !== optMenu) m.classList.remove('show');
                });
                optMenu.classList.toggle('show', willOpen);
                optMenu.style.display = willOpen ? 'block' : 'none'; /* belt-and-suspenders for the class rule */
                _forceReflow(optMenu);
            });
        }
        _wireBizMenuOutsideClick();

        /* Wire edit (owner only) — toggles .biz-post-text-view for
           .biz-post-edit-form, saves the trimmed textarea value straight
           to the post's `text` field on Save, and updates the card's own
           display + the in-memory `p` object so no re-render/re-fetch of
           the posts list is needed afterward. */
        var editBtn      = card.querySelector('.edit-biz-post-btn');
        var textView      = card.querySelector('.biz-post-text-view');
        var editForm      = card.querySelector('.biz-post-edit-form');
        var editTextarea  = card.querySelector('.biz-post-edit-textarea');
        var editSaveBtn   = card.querySelector('.biz-post-edit-save');
        var editCancelBtn = card.querySelector('.biz-post-edit-cancel');

        function _refreshTextView() {
            if (!textView) return;
            textView.classList.toggle('biz-post-caption-empty', !p.text && isOwner);
            if (p.text) {
                textView.style.cssText = 'padding:0 16px 12px;font-size:0.9rem;color:#374151;line-height:1.55;';
                textView.textContent = p.text;
            } else if (isOwner) {
                textView.style.cssText = 'padding:0 16px 12px;font-size:0.85rem;color:#9CA3AF;font-style:italic;cursor:pointer;';
                textView.innerHTML = '<i class="fas fa-pen" style="margin-right:6px;"></i>No caption — tap to add one';
            } else {
                textView.style.display = 'none';
            }
        }

        function _exitEditMode() {
            if (editForm) editForm.style.display = 'none';
            _refreshTextView();
        }

        function _enterEditMode() {
            var optMenuEl = card.querySelector('.options-menu');
            if (optMenuEl) { optMenuEl.classList.remove('show'); optMenuEl.style.display = 'none'; }
            if (textView) textView.style.display = 'none';
            if (editForm) editForm.style.display = 'block';
            _forceReflow(editForm);
            if (editTextarea) {
                editTextarea.value = p.text || '';
                /* Focus after the forced reflow settles, not before — on
                   this app's WebView, focusing an element that's still
                   mid-repaint from `display:none → block` on the same
                   tick can be swallowed, leaving the field visible but not
                   actually focused/keyboard-active. */
                requestAnimationFrame(function () { requestAnimationFrame(function () { editTextarea.focus(); }); });
            }
        }

        if (editBtn) {
            editBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                _enterEditMode();
            });
        }

        /* The empty-caption placeholder itself (owner-only) is also a
           direct shortcut into edit mode — no need to hunt for the "..."
           menu just to add a caption that never saved. */
        if (textView && isOwner) {
            textView.addEventListener('click', function (e) {
                if (!p.text) { e.preventDefault(); e.stopPropagation(); _enterEditMode(); }
            });
        }

        if (editCancelBtn) {
            editCancelBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                _exitEditMode();
            });
        }

        if (editSaveBtn) {
            editSaveBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var newText = editTextarea ? editTextarea.value.trim() : (p.text || '');
                if (newText === (p.text || '')) { _exitEditMode(); return; }
                editSaveBtn.disabled = true;
                editSaveBtn.textContent = 'Saving…';
                if (!_fbOk()) {
                    _notify('Not connected — please try again.', 'error');
                    editSaveBtn.disabled = false; editSaveBtn.textContent = 'Save';
                    return;
                }
                window.fbDb.collection('business_posts').doc(p.id).update({ text: newText, editedAt: Date.now() })
                    .then(function () {
                        p.text = newText;
                        _exitEditMode();
                        _notify('Post updated.', 'success');
                    })
                    .catch(function (err) {
                        _notify('Could not save changes: ' + (err && err.message ? err.message : 'error'), 'error');
                    })
                    .finally(function () {
                        editSaveBtn.disabled = false;
                        editSaveBtn.textContent = 'Save';
                    });
            });
        }

        /* Wire delete */
        var delBtn = card.querySelector('.delete-biz-post-btn');
        if (delBtn) {
            delBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (!confirm('Delete this post?')) return;
                if (_fbOk()) {
                    window.fbDb.collection('business_posts').doc(p.id).delete()
                        .then(function () { card.remove(); _notify('Post deleted.', 'success'); })
                        .catch(function () { _notify('Could not delete post.', 'error'); });
                }
            });
        }

        return card;
    }


    /* =========================================================================
       §10  DASHBOARD BUSINESS POSTS (PRODUCT CARDS) — #dashboard-bizposts-slider
       ========================================================================= */

    (function initDashboardBizPostsSlider() {

        function _buildProductCard(post, pageName, pageAvatar, pageCover, pageId, listingCount) {
            var card = document.createElement('div');
            card.dataset.postId = post.id;
            card.dataset.pageId = pageId || post.pageId || '';
            card.style.cssText =
                'flex:0 0 220px;width:220px;border-radius:20px;overflow:hidden;cursor:pointer;'
                + 'box-shadow:0 6px 24px rgba(10,14,39,0.14);background:white;'
                + 'border:1px solid rgba(10,14,39,0.07);scroll-snap-align:start;'
                + 'transition:transform 0.22s,box-shadow 0.22s;display:flex;flex-direction:column;flex-shrink:0;';

            var fm     = post.media && post.media.length ? post.media[0] : '';
            var isVid  = fm && (/\.(mp4|webm|mov)/i.test(fm) || /\/video\/upload\//i.test(fm));
            var avatarSrc = pageAvatar || (
                'https://ui-avatars.com/api/?name=' + encodeURIComponent(pageName || 'B') + '&background=1B2B8B&color=fff&size=100'
            );

            var count = listingCount || 1;
            var catalogBadge = count > 1
                ? '<div style="position:absolute;top:10px;right:10px;background:rgba(10,14,39,0.72);'
                  + 'color:white;font-size:0.58rem;font-weight:800;padding:3px 9px;border-radius:20px;'
                  + 'letter-spacing:0.4px;backdrop-filter:blur(4px);display:flex;align-items:center;gap:4px;">'
                  + '<i class="fas fa-layer-group" style="font-size:0.55rem;"></i>' + count + ' Listings</div>'
                : '';

            /* ── Product image: large & prominent ── */
            var productBox = fm && !isVid
                ? '<div style="width:100%;height:200px;overflow:hidden;background:#f3f4f6;flex-shrink:0;position:relative;">'
                  + '<img src="' + _attr(fm) + '" style="width:100%;height:100%;object-fit:cover;display:block;"'
                  + ' onerror="this.parentNode.style.display=\'none\'">'
                  + '<div style="position:absolute;top:10px;left:10px;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);'
                  + 'color:white;font-size:0.58rem;font-weight:800;padding:3px 10px;border-radius:20px;'
                  + 'letter-spacing:0.6px;text-transform:uppercase;box-shadow:0 2px 8px rgba(27,43,139,0.35);">For Sale</div>'
                  + catalogBadge
                  + '</div>'
                : fm && isVid
                    ? '<div style="width:100%;height:200px;overflow:hidden;background:#0A0E27;position:relative;flex-shrink:0;">'
                      + '<video src="' + _attr(fm) + '" style="width:100%;height:100%;object-fit:cover;display:block;" muted playsinline preload="metadata"></video>'
                      + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">'
                      + '<div style="width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,0.6);'
                      + 'display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);">'
                      + '<i class="fas fa-play" style="color:white;font-size:0.9rem;margin-left:3px;"></i></div></div>'
                      + '<div style="position:absolute;top:10px;left:10px;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);'
                      + 'color:white;font-size:0.58rem;font-weight:800;padding:3px 10px;border-radius:20px;'
                      + 'letter-spacing:0.6px;text-transform:uppercase;">Video</div>'
                      + catalogBadge
                      + '</div>'
                    : '<div style="width:100%;height:120px;background:linear-gradient(135deg,rgba(27,43,139,0.07),rgba(91,14,166,0.12));'
                      + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
                      + '<i class="fas fa-store" style="font-size:2.8rem;color:rgba(27,43,139,0.22);"></i></div>';

            /* ADDED (2026-09-28): the horizontally-scrolling dashboard card now shows
               the product name, price (in the seller's chosen currency) and the
               condition / availability / negotiable pills. Product-only data: NGOs and
               service pages never set a price, so nothing extra appears for them. */
            var _dProds = Array.isArray(post.products) ? post.products : [];
            var _dProd = null;
            for (var _di = 0; _di < _dProds.length; _di++) { if (_dProds[_di] && _dProds[_di].url === fm) { _dProd = _dProds[_di]; break; } }
            if (!_dProd) _dProd = _dProds.filter(function (pr) { return pr && (pr.price || pr.name); })[0] || null;
            var _dPrice = _dProd ? _bizFmtMoney(_dProd.price, post.listingCurrency) : '';
            var _dChips = _bizListingChipsHTML({ condition: post.listingCondition, availability: post.listingAvailability, negotiable: post.listingNegotiable });
            var _dDetails = (_dPrice || _dChips)
                ? '<div style="padding:10px 13px 0;">'
                  + (_dProd && _dProd.name ? '<div style="font-size:0.8rem;font-weight:800;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(_dProd.name) + '</div>' : '')
                  + (_dPrice ? '<div style="font-size:1.05rem;font-weight:900;color:#5B0EA6;margin-top:1px;">' + _esc(_dPrice) + '</div>' : '')
                  + (_dChips ? '<div style="margin-top:5px;">' + _dChips + '</div>' : '')
                  + (post.listingAddress ? '<div style="font-size:0.66rem;color:#6B7280;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><i class="fas fa-location-dot" style="color:#E53935;margin-right:4px;"></i>' + _esc(post.listingAddress) + '</div>' : '')
                  + '</div>'
                : '';

            card.innerHTML =
                productBox
                + _dDetails
                /* Seller strip */
                + '<div style="display:flex;align-items:center;gap:9px;padding:11px 13px 7px;">'
                + '<div style="width:32px;height:32px;border-radius:50%;border:2px solid #fff;overflow:hidden;'
                + 'box-shadow:0 2px 8px rgba(0,0,0,0.18);background:#e8eaf6;flex-shrink:0;">'
                + '<img src="' + _attr(avatarSrc) + '" style="width:100%;height:100%;object-fit:cover;"'
                + ' onerror="this.src=\'https://ui-avatars.com/api/?name=B&background=1B2B8B&color=fff&size=100\'"></div>'
                + '<div style="min-width:0;">'
                + '<strong style="display:block;font-size:0.74rem;font-weight:800;color:#0A0E27;'
                + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(pageName || 'Business') + '</strong>'
                + '<span style="font-size:0.59rem;color:#5B0EA6;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Business Page</span>'
                + '</div></div>'
                /* Description */
                + (post.text
                    ? '<div style="padding:2px 13px 10px;">'
                      + '<p style="margin:0;font-size:0.76rem;color:#374151;line-height:1.45;'
                      + 'overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">'
                      + _esc(post.text) + '</p></div>'
                    : '<div style="height:6px;"></div>')
                /* CTA */
                + '<div style="padding:0 13px 14px;margin-top:auto;">'
                + '<div style="background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:white;'
                + 'border-radius:10px;padding:9px;text-align:center;font-size:0.74rem;font-weight:700;'
                + 'letter-spacing:0.2px;display:flex;align-items:center;justify-content:center;gap:6px;">'
                + '<i class="fas fa-eye" style="font-size:0.66rem;"></i>View Listing</div>'
                + '</div>';

            card.addEventListener('mouseenter', function () {
                card.style.transform = 'translateY(-5px)';
                card.style.boxShadow = '0 14px 34px rgba(10,14,39,0.22)';
            });
            card.addEventListener('mouseleave', function () {
                card.style.transform = '';
                card.style.boxShadow = '0 6px 24px rgba(10,14,39,0.14)';
            });
            card.addEventListener('click', function () {
                var pid = post.pageId || '';
                if (pid) window._activeBizPageId = pid;
                var pages = window._firestoreBusinessPages || [];
                var biz   = pages.find(function (p) { return p.id === pid; });
                if (biz)  window._activeBizData = biz;
                if (typeof window.navigateTo === 'function') window.navigateTo('business-page');
                setTimeout(function () {
                    if (typeof window.renderBusinessPage === 'function') window.renderBusinessPage(pid);
                }, 80);
            });

            return card;
        }

        /* Track, per business page, the most recent post + total listing count
           so each page shows exactly ONE card in the dashboard timeline
           (a "catalog" card), rather than one card per post. */
        var _pageListingCounts = {};   // pageId -> total post count seen
        var _pageLatestPost    = {};   // pageId -> most recent post object

        function _upsertProductCard(post, name, avatar, cover) {
            var slider = document.getElementById('dashboard-bizposts-slider');
            if (!slider) return;
            var pid = post.pageId || ('post-' + post.id); // fallback key for pages without an id

            /* Update running totals — keep the newest post as the cover */
            _pageListingCounts[pid] = (_pageListingCounts[pid] || 0) + 1;
            var prevLatest = _pageLatestPost[pid];
            var postTime   = post.createdAt && post.createdAt.toMillis ? post.createdAt.toMillis() : (post.createdAt || 0);
            var prevTime   = prevLatest && prevLatest.createdAt && prevLatest.createdAt.toMillis ? prevLatest.createdAt.toMillis() : (prevLatest && prevLatest.createdAt || 0);
            if (!prevLatest || postTime >= prevTime) {
                _pageLatestPost[pid] = post;
            }
            var latest = _pageLatestPost[pid];
            var count  = _pageListingCounts[pid];

            var empty = document.getElementById('bizposts-empty');
            if (empty) { try { slider.removeChild(empty); } catch (_e) {} }

            /* Remove any existing card for this page (will be re-inserted at the front) */
            var existing = slider.querySelector('[data-page-id="' + pid + '"]');
            if (existing) { try { slider.removeChild(existing); } catch (_e2) {} }

            /* Most recently updated page's card appears first in the timeline */
            slider.insertBefore(_buildProductCard(latest, name, avatar, cover, pid, count), slider.firstChild);
        }

        function _loadProductCards() {
            if (!_fbOk()) return;
            if (window._bizPostsListenerActive) return; /* guard: only one listener */
            window._bizPostsListenerActive = true;
            try {
                window.fbDb.collection('business_posts')
                    .orderBy('createdAt', 'desc').limit(20)
                    .onSnapshot(function (snap) {
                        if (!snap || snap.empty) return;
                        snap.docChanges().forEach(function (change) {
                            if (change.type !== 'added') return;
                            var post = change.doc.data();
                            post.id  = change.doc.id;
                            var name = post.pageName || post.orgName || post.businessName || 'Business';
                            if (post.pageId) {
                                window.fbDb.collection('business_pages').doc(post.pageId).get()
                                    .then(function (d) {
                                        var data = d.exists ? d.data() : {};
                                        _upsertProductCard(post, data.name || name, data.profilePhoto || '', data.coverPhoto || '');
                                    })
                                    .catch(function () { _upsertProductCard(post, name, '', ''); });
                            } else {
                                _upsertProductCard(post, name, '', '');
                            }
                        });
                    }, function (err) {
                        console.warn('[EmpBusiness] biz-posts slider:', err && err.message);
                    });
            } catch (e) { /* silent */ }
        }

        function _init() {
            var container = document.getElementById('dashboard-bizposts-container');
            if (container) container.style.display = 'block';
            _loadProductCards();
            renderDashboardBusinesses();
        }

        /* ID rename removed — it caused duplicate cards */

        document.addEventListener('empyrean-init-done', function () { setTimeout(_init, 600); });
        document.addEventListener('empyrean-section-change', function (ev) {
            if (ev && ev.detail && ev.detail.section === 'dashboard') {
                setTimeout(function () {
                    if (!document.getElementById('dashboard-bizposts-container')) _init();
                    else renderDashboardBusinesses();
                }, 600);
            }
        });

        ready(function () { setTimeout(_init, 1200); });

    })();


    /* =========================================================================
       SECTION-CHANGE LISTENER — render page on navigate
       ========================================================================= */

    document.addEventListener('empyrean-section-change', function (ev) {
        if (!ev || !ev.detail) return;
        var sec = ev.detail.section;
        if (sec === 'business-page') {
            setTimeout(function () {
                /* Use the raw renderer directly — not window.renderBusinessPage which
                   may have been wrapped by patch files and point to a stripped version */
                var renderer = window._appBizRenderer || window.renderBusinessPage;
                if (typeof renderer === 'function') {
                    renderer(window._activeBizPageId || '');
                }
            }, 100);
        }
    });

    /* Also fire if navigateTo is called directly before this module was loaded */
    ready(function () {
        setTimeout(function () {
            var active = document.querySelector('.content-section.active');
            if (active && active.id === 'business-page') {
                renderBusinessPage(window._activeBizPageId || '');
            }
        }, 800);
    });


    /* =========================================================================
       EMPTY STATE HELPERS
       ========================================================================= */

    function _emptyState(msg, icon) {
        return '<div style="padding:60px 24px;text-align:center;color:#9CA3AF;">'
            + '<i class="fas ' + (icon || 'fa-store') + '" style="font-size:2.5rem;color:rgba(27,43,139,0.2);margin-bottom:14px;display:block;"></i>'
            + '<p style="margin:0;font-size:0.9rem;">' + _esc(msg) + '</p></div>';
    }

    function _noPageYetState() {
        var us = _us();
        if (_isGuest()) {
            return _emptyState('Please log in to view business pages.', 'fa-user-lock');
        }
        return '<div style="padding:60px 24px;text-align:center;">'
            + '<div style="width:80px;height:80px;border-radius:24px;'
            + 'background:linear-gradient(135deg,rgba(27,43,139,0.08),rgba(91,14,166,0.08));'
            + 'display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">'
            + '<i class="fas fa-store" style="font-size:2.2rem;color:rgba(27,43,139,0.3);"></i></div>'
            + '<h3 style="margin:0 0 8px;font-size:1.1rem;font-weight:800;color:#0A0E27;">No Business Page Yet</h3>'
            + '<p style="color:#6B7280;font-size:0.88rem;margin:0 0 22px;line-height:1.5;">'
            + 'Create your business page to start showcasing products,<br>posts, and offers to the community.</p>'
            + '<button onclick="(function(){var m=document.getElementById(\'create-business-page-modal\');if(m){m.style.display=\'flex\';m.classList.add(\'show\');}})()"'
            + ' style="padding:12px 32px;border-radius:50px;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);'
            + 'color:white;border:none;font-weight:700;font-size:0.92rem;cursor:pointer;'
            + 'box-shadow:0 4px 18px rgba(91,14,166,0.35);">'
            + '<i class="fas fa-plus" style="margin-right:8px;"></i>Create Business Page</button>'
            + '</div>';
    }

    /**
     * "My Pages" list/switcher — lets an owner see, open, and delete any of
     * their up-to-MAX_BIZ_PAGES business pages, and create another one while
     * under the cap. Reached via the "My Pages" button on an owned page.
     */
    function _renderMyPagesList() {
        var sec = document.getElementById('business-page');
        if (!sec) return;
        var us    = _us();
        var pages = _myPages(us);

        var cards = pages.map(function (p) {
            var cover = p.coverPhoto || p.coverImage || '';
            var avatar = p.profilePhoto || p.logo || '';
            return '<div class="biz-mypage-card" data-biz-id="' + _attr(p.id) + '" style="cursor:pointer;position:relative;'
                + 'border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(10,14,39,0.08);">'
                + '<button class="biz-mypage-delete-btn" data-biz-id="' + _attr(p.id) + '" data-biz-name="' + _attr(p.name || 'this page') + '"'
                + ' title="Delete page" style="position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;'
                + 'background:rgba(10,14,39,0.55);border:none;color:#fff;font-size:0.75rem;cursor:pointer;'
                + 'display:flex;align-items:center;justify-content:center;z-index:2;"><i class="fas fa-trash"></i></button>'
                + '<div style="height:90px;background:' + (cover ? 'url(\'' + _attr(cover) + '\') center/cover no-repeat' : 'linear-gradient(135deg,#1B2B8B,#5B0EA6)') + ';"></div>'
                + '<div style="padding:12px 14px;display:flex;align-items:center;gap:10px;">'
                + (avatar
                    ? '<img src="' + _attr(avatar) + '" style="width:38px;height:38px;border-radius:10px;object-fit:cover;flex-shrink:0;">'
                    : '<div style="width:38px;height:38px;border-radius:10px;background:rgba(27,43,139,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-store" style="color:#1B2B8B;"></i></div>')
                + '<div style="min-width:0;">'
                + '<div style="font-weight:800;font-size:0.9rem;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(p.name || 'Business Page') + '</div>'
                + '<div style="font-size:0.75rem;color:#9CA3AF;">' + _esc(p.industry || '') + '</div>'
                + '</div></div></div>';
        }).join('');

        var canCreateMore = pages.length < MAX_BIZ_PAGES;
        var createTile = canCreateMore
            ? '<button id="biz-mypage-create-tile" style="cursor:pointer;border-radius:16px;'
                + 'border:2px dashed rgba(27,43,139,0.25);background:rgba(27,43,139,0.03);'
                + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
                + 'min-height:132px;color:#1B2B8B;font-weight:700;font-size:0.85rem;">'
                + '<i class="fas fa-plus-circle" style="font-size:1.6rem;margin-bottom:8px;"></i>'
                + 'Create New Page</button>'
            : '<div style="border-radius:16px;border:2px dashed rgba(10,14,39,0.1);'
                + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
                + 'min-height:132px;color:#9CA3AF;font-size:0.8rem;text-align:center;padding:0 12px;">'
                + '<i class="fas fa-lock" style="font-size:1.3rem;margin-bottom:6px;"></i>'
                + 'Maximum of ' + MAX_BIZ_PAGES + ' pages reached</div>';

        sec.innerHTML =
            '<div style="padding:24px 18px;">'
            + '<h2 style="margin:0 0 4px;font-size:1.2rem;font-weight:900;color:#0A0E27;">My Business Pages</h2>'
            + '<p style="margin:0 0 18px;font-size:0.85rem;color:#6B7280;">' + pages.length + ' of ' + MAX_BIZ_PAGES + ' pages used</p>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;">'
            + cards + createTile
            + '</div></div>';

        sec.querySelectorAll('.biz-mypage-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var id = card.dataset.bizId;
                window._activeBizData   = pages.find(function (p) { return p.id === id; }) || null;
                window._activeBizPageId = id;
                renderBusinessPage(id);
            });
        });

        /* ── Wire per-card delete button ── */
        sec.querySelectorAll('.biz-mypage-delete-btn').forEach(function (delBtn) {
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation(); /* don't also trigger the card's open-page click */
                var id   = delBtn.dataset.bizId;
                var name = delBtn.dataset.bizName || 'this page';
                if (!window.confirm('Delete "' + name + '"? This permanently removes the page and all its posts.')) return;
                delBtn.disabled = true;
                delBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                _deleteBusinessPage(id)
                    .then(function () { _renderMyPagesList(); })
                    .catch(function (err) {
                        delBtn.disabled = false;
                        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                        _notify('Failed to delete: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                    });
            });
        });

        var createTileBtn = document.getElementById('biz-mypage-create-tile');
        if (createTileBtn) {
            createTileBtn.addEventListener('click', function () {
                var m = document.getElementById('create-business-page-modal');
                if (m) { m.style.display = 'flex'; m.classList.add('show'); document.body.classList.add('modal-open'); }
            });
        }
    }
    window.renderMyBusinessPages = _renderMyPagesList;

    console.log('[EmpBusiness] ✅ Business module v3.0 ready — page renderer, dashboard slider, post composer, ownership enforcement loaded.');

})();