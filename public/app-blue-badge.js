/* =============================================================================
   EMPYREAN INTERNATIONAL — BLUE BADGE MODULE
   app-blue-badge.js  |  Load near the end, after app-wallet.js, app-profile.js
   and app-analytics.js — this file only READS globals those already provide
   (window.fbDb, window._firebaseLoaded, window._appConfig, window.userState /
   window.EmpState, the `empyrean-section-change` event) and never overwrites
   an existing global or edits another file's DOM output. Fully additive,
   same isolation pattern as app-analytics.js.

   TASK: paid verification badges, distinct per account/entity type (the six
   categories this app already recognises for KYC: Individual, Company,
   NGO/Organization, Cooperative Society, Government Agency, International
   Organization), each with 3 price tiers (Basic / Premium / Elite) that get
   a visually distinct badge. Plus a promo banner on Profile, Settings and
   Dashboard driving purchases, and a Flutterwave checkout re-using the same
   public key / customer-object convention app-wallet.js already established
   for "Buy EMPY".

   ═══════════════════════════════════════════════════════════════════════
   WHY ADDITIVE, NOT AN EDIT TO app-profile.js / index.html
   ═══════════════════════════════════════════════════════════════════════
   app-profile.js rebuilds #profile-section's innerHTML from scratch on every
   render, so anything injected has to be re-injected after each render
   rather than baked into that template — this module listens for the same
   `empyrean-section-change` event app-fix-final.js's own patches already use
   for exactly that reason (see e.g. its profile/dashboard listeners) and
   (re)inserts its banner/badge nodes a beat after the section becomes
   active. That keeps this feature in one file, with one price table to
   maintain, instead of a new conditional branch inside an already very
   large template string.

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL (Firestore users/{id}, additive fields only)
   ═══════════════════════════════════════════════════════════════════════
   hasBlueBadge        bool
   badgeEntityType     'individual' | 'company' | 'organization' |
                       'cooperative' | 'government' | 'international'
   badgeTier           'basic' | 'premium' | 'elite'
   badgePurchasedAt    ISO string

   PRICING AND COPY BELOW ARE PLACEHOLDERS — edit the PRICING table and
   ENTITY_TYPES/TIERS labels freely, everything else reads from them.
   ============================================================================= */

(function empyreanBlueBadge() {
    'use strict';

    if (window._empBlueBadgeLoaded) {
        console.warn('[BlueBadge] Already loaded — skipping duplicate.');
        return;
    }
    window._empBlueBadgeLoaded = true;

    function log(msg) { console.log('[BlueBadge] ' + msg); }

    // ── Shared helpers, same shape as app-analytics.js's local copies ──
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb && typeof window.fbDb.collection === 'function'); }
    function _us() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _isGuest() {
        var s = window.EmpState || {};
        if (s.isGuest != null) return !!s.isGuest;
        if (window.isGuest != null) return !!window.isGuest;
        var u = _us();
        if (u && u.id && u.id !== 'guest' && !String(u.id).startsWith('guest-')) return false;
        return true;
    }
    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); else console.log('[BlueBadge] ' + msg); }

    // Blend two hex colors together, weight 0..1 = how much of hexB to mix in.
    // Used to give each tier its own finish (matte pewter / warm gold / icy
    // platinum) without hand-picking six new colors per entity.
    function _mixHex(hexA, hexB, w) {
        function parse(h) {
            h = h.replace('#', '');
            if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
            return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
        }
        var a = parse(hexA), b = parse(hexB);
        var r = Math.round(a[0] * (1 - w) + b[0] * w);
        var g = Math.round(a[1] * (1 - w) + b[1] * w);
        var bl = Math.round(a[2] * (1 - w) + b[2] * w);
        return '#' + [r, g, bl].map(function (v) { return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'); }).join('');
    }

    // Per-tier color finish, layered on top of each entity's own hue so
    // Basic / Premium / Elite read as genuinely different colors, not just
    // different decorations on an identical seal.
    //   basic   — matte pewter, slightly muted: classic, understated
    //   premium — warm champagne-gold cast: elegant, richer
    //   elite   — bright platinum-diamond cast: sleek, most luminous
    var TIER_TINT = {
        basic:   { color: '#8A94A6', from: 0.22, to: 0.30 },
        premium: { color: '#F0C75E', from: 0.20, to: 0.16 },
        elite:   { color: '#F4F8FF', from: 0.30, to: 0.10 }
    };

    /* =========================================================================
       §1 — CONFIG: entity types, tiers, pricing
       ========================================================================= */

    var ENTITY_TYPES = [
        { key: 'individual',    label: 'Individual',              icon: 'fa-user',           from: '#1E88E5', to: '#0B3D91' }, // sapphire
        { key: 'company',       label: 'Company / Business',       icon: 'fa-briefcase',      from: '#F5D76E', to: '#B8860B' }, // amber gold
        { key: 'organization',  label: 'Organization / NGO',       icon: 'fa-hands-helping',  from: '#34D399', to: '#065F46' }, // emerald
        { key: 'cooperative',   label: 'Cooperative Society',      icon: 'fa-people-carry',   from: '#2DD4BF', to: '#0F766E' }, // teal
        { key: 'government',    label: 'Government Agency',        icon: 'fa-landmark',       from: '#EF4444', to: '#7F1D1D' }, // crimson
        { key: 'international', label: 'International Organization', icon: 'fa-globe',        from: '#6366F1', to: '#0A0E27' }  // indigo/navy
    ];

    // ring: 'none' | 'thin' | 'thick' — gives each tier a visually distinct
    // seal so Basic/Premium/Elite are never just "same badge, different price".
    var TIERS = [
        { key: 'basic',   label: 'Basic',   ring: 'none',  glow: false, starburst: false, constellation: false },
        { key: 'premium', label: 'Premium', ring: 'thin',  glow: true,  starburst: true,  constellation: false },
        { key: 'elite',   label: 'Elite',   ring: 'thick', glow: true,  starburst: true,  constellation: true  }
    ];

    // NGN, one-time / lifetime. Edit freely — nothing else needs to change.
    var PRICING = {
        individual:    { basic: 3000,  premium: 7500,  elite: 15000  },
        company:       { basic: 12000, premium: 28000, elite: 55000  },
        organization:  { basic: 8000,  premium: 18000, elite: 35000  },
        cooperative:   { basic: 8000,  premium: 18000, elite: 35000  },
        government:    { basic: 20000, premium: 45000, elite: 90000  },
        international: { basic: 25000, premium: 60000, elite: 120000 }
    };

    function _entity(key) { return ENTITY_TYPES.filter(function (e) { return e.key === key; })[0] || ENTITY_TYPES[0]; }
    function _tier(key) { return TIERS.filter(function (t) { return t.key === key; })[0] || TIERS[0]; }
    function _price(entityKey, tierKey) { return (PRICING[entityKey] || PRICING.individual)[tierKey] || 0; }
    function _fmtNaira(n) { return '\u20A6' + Number(n || 0).toLocaleString(); }

    /* =========================================================================
       §2 — BADGE SVG (one shared <defs> block of gradients, badges just
       reference url(#grad-<entity>) so no per-instance gradient IDs and no
       collisions when the badge appears more than once on a page)
       ========================================================================= */

    function _ensureDefs() {
        if (document.getElementById('emp-bb-defs')) return;
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', 'emp-bb-defs');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        var defsHTML = '<defs>' + ENTITY_TYPES.map(function (e) {
            // One gradient per (entity, tier): same hue family, distinct
            // finish, so Basic/Premium/Elite are never the same color.
            return TIERS.map(function (t) {
                var tint = TIER_TINT[t.key];
                var fromC = _mixHex(e.from, tint.color, tint.from);
                var toC = _mixHex(e.to, tint.color, tint.to);
                return '<linearGradient id="grad-' + e.key + '-' + t.key + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
                    '<stop offset="0%" stop-color="' + fromC + '"/>' +
                    '<stop offset="100%" stop-color="' + toC + '"/>' +
                    '</linearGradient>';
            }).join('');
        }).join('') +
            // Platinum-silver gradient — used for the checkmark, rings and
            // the embossed "EMPYREAN" lettering on every badge.
            '<linearGradient id="grad-platinum" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="#F8FAFC"/>' +
            '<stop offset="45%" stop-color="#CBD5E1"/>' +
            '<stop offset="100%" stop-color="#94A3B8"/>' +
            '</linearGradient>' +
            // Sky-blue halo glow, sits behind the seal on Premium/Elite.
            '<radialGradient id="grad-halo" cx="50%" cy="50%" r="50%">' +
            '<stop offset="0%" stop-color="#BFE3FF" stop-opacity="0.65"/>' +
            '<stop offset="70%" stop-color="#BFE3FF" stop-opacity="0.15"/>' +
            '<stop offset="100%" stop-color="#BFE3FF" stop-opacity="0"/>' +
            '</radialGradient>' +
            // Shared invisible arc every badge's "EMPYREAN" text rides along
            // the lower rim — one definition, referenced by every instance.
            '<path id="bb-text-arc" d="M 14,80 A 39,39 0 0,0 86,80" fill="none"/>' +
            '</defs>';
        svg.innerHTML = defsHTML;
        document.body.appendChild(svg);
    }

    // 12-cusp scalloped seal outline, shared by every badge instance.
    var BADGE_PATH = 'M 50.0,4.0 L 39.39,10.4 L 27.0,10.16 L 21.01,21.01 L 10.16,27.0 L 10.4,39.39 L 4.0,50.0 L 10.4,60.61 L 10.16,73.0 L 21.01,78.99 L 27.0,89.84 L 39.39,89.6 L 50.0,96.0 L 60.61,89.6 L 73.0,89.84 L 78.99,78.99 L 89.84,73.0 L 89.6,60.61 L 96.0,50.0 L 89.6,39.39 L 89.84,27.0 L 78.99,21.01 L 73.0,10.16 L 60.61,10.4 Z';

    // Fixed (not random) constellation layout — 7 stars behind the checkmark,
    // reused by every Elite badge so the motif is consistent, not noisy.
    var _CONSTELLATION_PTS = [[30, 28], [42, 21], [58, 25], [72, 33], [66, 74], [34, 71], [50, 58]];
    var _CONSTELLATION_LINES = [[0, 1], [1, 2], [2, 3], [0, 6], [3, 4], [5, 6], [4, 5]];

    /**
     * Returns an inline <svg> string for one badge. Every tier is built from
     * the same 12-cusp seal + entity gradient, but Basic / Premium / Elite
     * layer on progressively more of the celestial treatment (halo glow,
     * starburst rays, constellation, platinum ring) so the three tiers read
     * as genuinely different badges, not just a colour swap.
     * @param {string} entityKey
     * @param {string} tierKey
     * @param {number} size px, defaults to 22 (inline, next-to-name size)
     */
    function badgeSVG(entityKey, tierKey, size) {
        _ensureDefs();
        var e = _entity(entityKey), t = _tier(tierKey);
        size = size || 22;
        var glowFilter = t.glow ? ' style="filter:drop-shadow(0 0 4px ' + e.from + 'cc)"' : '';

        // Sky-blue halo behind the whole seal (Premium + Elite only).
        var halo = t.glow ? '<circle cx="50" cy="50" r="47" fill="url(#grad-halo)"/>' : '';

        // Platinum ring — thin single line for Premium, doubled/thicker for Elite.
        var ring = '';
        if (t.ring === 'thin') {
            ring = '<path d="' + BADGE_PATH + '" fill="none" stroke="url(#grad-platinum)" stroke-width="1.5" ' +
                'transform="translate(50 50) scale(1.05) translate(-50 -50)" opacity="0.8"/>';
        } else if (t.ring === 'thick') {
            ring = '<path d="' + BADGE_PATH + '" fill="none" stroke="url(#grad-platinum)" stroke-width="2.6" ' +
                'transform="translate(50 50) scale(1.07) translate(-50 -50)" opacity="0.95"/>' +
                '<path d="' + BADGE_PATH + '" fill="none" stroke="#F0F4F8" stroke-width="1.1" ' +
                'transform="translate(50 50) scale(1.13) translate(-50 -50)" opacity="0.5"/>';
        }

        // Starburst — thin rays glinting off the seal's edge (Premium + Elite).
        var starburst = '';
        if (t.starburst) {
            var rays = [], rayCount = 16;
            for (var i = 0; i < rayCount; i++) {
                var ang = (i / rayCount) * Math.PI * 2;
                var x1 = (50 + Math.cos(ang) * 41).toFixed(1), y1 = (50 + Math.sin(ang) * 41).toFixed(1);
                var x2 = (50 + Math.cos(ang) * 49).toFixed(1), y2 = (50 + Math.sin(ang) * 49).toFixed(1);
                rays.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#F0F4F8" stroke-width="0.8" opacity="0.6"/>');
            }
            starburst = '<g>' + rays.join('') + '</g>';
        }

        // Constellation motif behind the checkmark (Elite only).
        var constellation = '';
        if (t.constellation) {
            var dots = _CONSTELLATION_PTS.map(function (p) {
                return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.2" fill="#F8FAFC" opacity="0.85"/>';
            }).join('');
            var segs = _CONSTELLATION_LINES.map(function (l) {
                var a = _CONSTELLATION_PTS[l[0]], b = _CONSTELLATION_PTS[l[1]];
                return '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="#F8FAFC" stroke-width="0.5" opacity="0.35"/>';
            }).join('');
            constellation = '<g>' + segs + dots + '</g>';
        }

        // "EMPYREAN" embossed along the lower rim — only worth drawing once
        // the badge is large enough to read (preview size and up).
        var nameText = size >= 28
            ? '<text font-size="8.5" font-weight="700" letter-spacing="1.6" fill="url(#grad-platinum)" opacity="0.9">' +
              '<textPath href="#bb-text-arc" startOffset="50%" text-anchor="middle">EMPYREAN</textPath></text>'
            : '';

        return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" class="emp-bb-badge-svg"' + glowFilter + '>' +
            halo + ring +
            '<path d="' + BADGE_PATH + '" fill="url(#grad-' + e.key + '-' + t.key + ')"/>' +
            constellation + starburst +
            '<path d="M31 51.5 L44 64 L70 36" fill="none" stroke="url(#grad-platinum)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>' +
            nameText +
            '</svg>';
    }

    /* =========================================================================
       §3 — Persistence
       ========================================================================= */

    function _saveBadge(entityKey, tierKey) {
        var us = _us();
        us.hasBlueBadge = true;
        us.badgeEntityType = entityKey;
        us.badgeTier = tierKey;
        us.badgePurchasedAt = new Date().toISOString();
        if (us.id && _fbOk()) {
            window.fbDb.collection('users').doc(us.id).update({
                hasBlueBadge: true,
                badgeEntityType: entityKey,
                badgeTier: tierKey,
                badgePurchasedAt: us.badgePurchasedAt
            }).catch(function () {});
        }
    }

    /* =========================================================================
       §4 — CSS (injected once)
       ========================================================================= */

    (function injectCSS() {
        if (document.getElementById('emp-bb-css')) return;
        var css = document.createElement('style');
        css.id = 'emp-bb-css';
        css.textContent =
            /* REDESIGN (2026-10-27): "Get verified" card - white, gold-ringed seal, benefit list, one clear action. */
            '.emp-bb-banner{display:block;padding:20px 18px 12px;margin:12px 0;border-radius:22px;cursor:pointer;position:relative;overflow:hidden;' +
            'background:#FFFFFF;border:1px solid #D5DAF0;box-shadow:none;' +
            'transition:border-color .2s ease;}' +
            '.emp-bb-banner:hover{border-color:#1B2B8B;}' +
            '.emp-bb-banner .emp-bb-banner-head{display:flex;align-items:center;gap:14px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #ECEEF7;}' +
            '.emp-bb-banner .emp-bb-badge-ring{flex-shrink:0;width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
            'background:#FFFFFF;border:2px solid #C9A66B;}' +
            /* 2026-10-27: badge sits on plain white - no sky-blue halo or blue glow behind the seal, and the mount slot is white too. */
            '.emp-bb-banner .emp-bb-badge-ring svg{filter:none !important;}' +
            '.emp-bb-banner .emp-bb-badge-ring circle[fill="url(#grad-halo)"]{display:none;}' +
            '[data-emp-bb-mounted="1"]{background:#FFFFFF;}' +
            '.emp-bb-banner .emp-bb-banner-text{flex:1;min-width:0;}' +
            '.emp-bb-banner .emp-bb-banner-title{font-weight:800;font-size:1.05rem;color:#0A0E39;letter-spacing:0.1px;}' +
            '.emp-bb-banner .emp-bb-banner-sub{font-size:0.8rem;color:#5A6385;margin-top:3px;line-height:1.35;}' +
            '.emp-bb-banner .emp-bb-benefits{list-style:none;margin:0 0 18px;padding:0;}' +
            '.emp-bb-banner .emp-bb-benefits li{display:flex;align-items:center;gap:10px;font-size:0.82rem;color:#2B3260;margin:0 0 9px;line-height:1.3;}' +
            '.emp-bb-banner .emp-bb-benefits li svg{flex-shrink:0;}' +
            '.emp-bb-banner .emp-bb-cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:50px;border:1.5px solid #1B2B8B;border-radius:999px;' +
            'background:#FFFFFF;color:#1B2B8B;font-size:0.92rem;font-weight:700;letter-spacing:.2px;cursor:pointer;font-family:inherit;}' +
            '.emp-bb-banner .emp-bb-cta:active{transform:scale(0.98);background:#F4F6FD;}' +
            '.emp-bb-banner .emp-bb-later{display:block;width:100%;min-height:44px;margin-top:4px;border:0;background:none;color:#5A6385;font-size:0.8rem;cursor:pointer;font-family:inherit;}' +
            '.emp-bb-owned-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;margin:8px 16px;border-radius:22px;' +
            'background:linear-gradient(135deg,#0B1436,#1B2B8B);border:1px solid rgba(255,255,255,0.25);font-size:0.8rem;font-weight:700;color:#fff;' +
            'box-shadow:0 4px 14px rgba(10,14,39,0.22);}' +
            '.emp-bb-modal-overlay{display:none;position:fixed;inset:0;background:rgba(10,14,39,0.55);z-index:9999;align-items:center;justify-content:center;padding:16px;}' +
            '.emp-bb-modal-overlay.show{display:flex;}' +
            '.emp-bb-modal{background:#fff;border-radius:18px;max-width:480px;width:100%;max-height:88vh;overflow-y:auto;padding:22px;position:relative;}' +
            '.emp-bb-modal-close{position:absolute;top:14px;right:16px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#888;line-height:1;}' +
            '.emp-bb-step-title{font-weight:800;font-size:1.05rem;color:#0A0E27;margin-bottom:4px;}' +
            '.emp-bb-step-sub{font-size:0.82rem;color:var(--text-muted,#6B7280);margin-bottom:16px;}' +
            '.emp-bb-entity-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;}' +
            '.emp-bb-entity-card{border:1.5px solid rgba(10,14,39,0.10);border-radius:14px;padding:12px 10px;text-align:center;cursor:pointer;transition:all .15s;}' +
            '.emp-bb-entity-card:hover{border-color:#1E88E5;}' +
            '.emp-bb-entity-card.selected{border-color:#1E88E5;background:rgba(30,136,229,0.06);box-shadow:0 0 0 2px rgba(30,136,229,0.25) inset;}' +
            '.emp-bb-entity-card i{font-size:1.1rem;margin-bottom:6px;display:block;color:#1E88E5;}' +
            '.emp-bb-entity-card span{font-size:0.74rem;font-weight:700;color:#0A0E27;}' +
            /* FIX (2026-10-27 — "broken icons" in the Get Verified account-type grid: Cooperative Society rendered a tofu box, Individual/Company/NGO rendered blank, whenever the Font Awesome webfont didn't finish loading on a weak connection; fa-people-carry had no offline fallback entry at all and fa-briefcase/fa-hands-helping have empty ones). Same self-contained SVG-mask technique style.css already uses for #settings / #profile-kyc-tab / the P2P card, so the six tiles no longer depend on the webfont OR on the unicode fallback — works identically either way. */
            '.emp-bb-entity-card i:before{content:"" !important;display:block !important;width:1.2em;height:1.2em;margin:0 auto;background-color:currentColor;-webkit-mask:var(--emp-wi) center/contain no-repeat;mask:var(--emp-wi) center/contain no-repeat;}' +
            '.emp-bb-entity-card .fa-user{--emp-wi:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%271.75%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M19%2021v-2a4%204%200%200%200-4-4H9a4%204%200%200%200-4%204v2%27/%3E%3Ccircle%20cx=%2712%27%20cy=%277%27%20r=%274%27/%3E%3C/svg%3E");}' +
            '.emp-bb-entity-card .fa-briefcase{--emp-wi:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%271.75%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M16%2020V4a2%202%200%200%200-2-2h-4a2%202%200%200%200-2%202v16%27/%3E%3Crect%20x=%272%27%20y=%276%27%20width=%2720%27%20height=%2714%27%20rx=%272%27/%3E%3C/svg%3E");}' +
            '.emp-bb-entity-card .fa-hands-helping{--emp-wi:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%271.75%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M19%2014c1.49-1.46%203-3.21%203-5.5A5.5%205.5%200%200%200%2016.5%203c-1.76%200-3%20.5-4.5%202-1.5-1.5-2.74-2-4.5-2A5.5%205.5%200%200%200%202%208.5c0%202.3%201.5%204.05%203%205.5l7%207Z%27/%3E%3C/svg%3E");}' +
            '.emp-bb-entity-card .fa-people-carry{--emp-wi:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%271.75%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M16%2021v-2a4%204%200%200%200-4-4H6a4%204%200%200%200-4%204v2%27/%3E%3Ccircle%20cx=%279%27%20cy=%277%27%20r=%274%27/%3E%3Cpath%20d=%27M22%2021v-2a4%204%200%200%200-3-3.87%27/%3E%3Cpath%20d=%27M16%203.13a4%204%200%200%201%200%207.75%27/%3E%3C/svg%3E");}' +
            '.emp-bb-entity-card .fa-landmark{--emp-wi:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%271.75%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M3%2022h18%27/%3E%3Cpath%20d=%27M6%2018v-7%27/%3E%3Cpath%20d=%27M10%2018v-7%27/%3E%3Cpath%20d=%27M14%2018v-7%27/%3E%3Cpath%20d=%27M18%2018v-7%27/%3E%3Cpath%20d=%27M12%202%2020%207H4z%27/%3E%3C/svg%3E");}' +
            '.emp-bb-entity-card .fa-globe{--emp-wi:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%271.75%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Ccircle%20cx=%2712%27%20cy=%2712%27%20r=%2710%27/%3E%3Cpath%20d=%27M12%202a14.5%2014.5%200%200%200%200%2020%2014.5%2014.5%200%200%200%200-20%27/%3E%3Cpath%20d=%27M2%2012h20%27/%3E%3C/svg%3E");}' +
            '.emp-bb-tier-row{display:flex;flex-direction:column;gap:10px;margin-bottom:16px;}' +
            '.emp-bb-tier-card{border:1.5px solid rgba(10,14,39,0.10);border-radius:14px;padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:all .15s;}' +
            '.emp-bb-tier-card:hover{border-color:#1E88E5;}' +
            '.emp-bb-tier-card.selected{border-color:#1E88E5;background:rgba(30,136,229,0.06);}' +
            '.emp-bb-tier-name{font-weight:800;font-size:0.9rem;color:#0A0E27;}' +
            '.emp-bb-tier-price{font-weight:700;font-size:0.86rem;color:#1E88E5;margin-left:auto;}' +
            '.emp-bb-back-btn{background:none;border:none;color:#1E88E5;font-weight:700;font-size:0.82rem;cursor:pointer;margin-bottom:10px;padding:0;}' +
            '.emp-bb-pay-btn{width:100%;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#1E88E5,#0B3D91);color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;}' +
            '.emp-bb-pay-btn:disabled{opacity:0.5;cursor:default;}' +

            /* ── Dashboard promo toast: not permanent — slides in from the
               right, sits briefly, then slides back out and unmounts.
               Positioned fixed so the horizontal slide reads as a true
               pop-in over the dashboard rather than a layout shift. ── */
            '@keyframes empBbToastIn{0%{transform:translateX(120%);opacity:0;}60%{transform:translateX(-3%);opacity:1;}100%{transform:translateX(0);opacity:1;}}' +
            '@keyframes empBbToastOut{0%{transform:translateX(0);opacity:1;}100%{transform:translateX(120%);opacity:0;}}' +
            '@keyframes empBbSealPulse{0%,100%{filter:drop-shadow(0 0 3px rgba(191,227,255,0.7));}50%{filter:drop-shadow(0 0 9px rgba(191,227,255,0.95));}}' +
            '.emp-bb-dash-toast{position:fixed;top:88px;right:16px;z-index:var(--z-toast,4000);max-width:340px;width:calc(100% - 32px);' +
            'display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:16px;cursor:pointer;' +
            'background:linear-gradient(135deg,rgba(11,20,54,0.92),rgba(30,64,145,0.90));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
            'border:1px solid rgba(191,227,255,0.35);box-shadow:0 10px 34px rgba(6,10,30,0.35),0 0 0 1px rgba(255,255,255,0.04) inset;' +
            'animation:empBbToastIn .55s cubic-bezier(.22,1,.36,1) both;}' +
            '.emp-bb-dash-toast.emp-bb-toast-leaving{animation:empBbToastOut .4s cubic-bezier(.4,0,1,1) both;}' +
            '.emp-bb-dash-toast .emp-bb-badge-svg{animation:empBbSealPulse 2.2s ease-in-out infinite;flex-shrink:0;}' +
            '.emp-bb-dash-toast .emp-bb-banner-title{color:#fff;font-weight:800;font-size:0.86rem;letter-spacing:0.1px;}' +
            '.emp-bb-dash-toast .emp-bb-banner-sub{color:rgba(226,236,255,0.82);font-size:0.74rem;margin-top:2px;}' +
            '.emp-bb-dash-toast:hover{background:linear-gradient(135deg,rgba(15,26,66,0.94),rgba(36,74,165,0.92));}' +
            '.emp-bb-dash-toast .emp-bb-toast-close{flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;' +
            'background:rgba(255,255,255,0.14);color:#fff;font-size:0.9rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
            '.emp-bb-dash-toast .emp-bb-toast-close:hover{background:rgba(255,255,255,0.26);}' +
            '.emp-bb-dash-toast .emp-bb-toast-chevron{color:#BFE3FF;flex-shrink:0;}' +
            '@media (max-width:480px){.emp-bb-dash-toast{left:16px;right:16px;width:auto;max-width:none;top:auto;bottom:88px;}}';
        document.head.appendChild(css);
    })();

    /* =========================================================================
       §5 — Modal (built once, appended to body — same additive convention
       as the rest of this module; index.html is not touched)
       ========================================================================= */

    var _selectedEntity = null;
    var _selectedTier = null;
    var _modalStep = 1;

    function _ensureModal() {
        if (document.getElementById('emp-bb-modal-overlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'emp-bb-modal-overlay';
        overlay.className = 'emp-bb-modal-overlay';
        overlay.innerHTML = '<div class="emp-bb-modal">' +
            '<button class="emp-bb-modal-close" id="emp-bb-modal-close">&times;</button>' +
            '<div id="emp-bb-modal-body"></div>' +
            '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) _closeModal(); });
        document.getElementById('emp-bb-modal-close').addEventListener('click', _closeModal);
    }

    function _closeModal() {
        var overlay = document.getElementById('emp-bb-modal-overlay');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    function _openModal() {
        if (_isGuest()) { if (typeof window._openAuth === 'function') window._openAuth(); return; }
        _ensureModal();
        _selectedEntity = null;
        _selectedTier = null;
        _modalStep = 1;
        _renderModalStep();
        var overlay = document.getElementById('emp-bb-modal-overlay');
        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    window.openBlueBadgeModal = _openModal;

    function _renderModalStep() {
        var body = document.getElementById('emp-bb-modal-body');
        if (!body) return;

        if (_modalStep === 1) {
            body.innerHTML =
                '<div class="emp-bb-step-title">Get Verified</div>' +
                '<div class="emp-bb-step-sub">Choose the account type this badge represents.</div>' +
                '<div class="emp-bb-entity-grid">' +
                ENTITY_TYPES.map(function (e) {
                    return '<div class="emp-bb-entity-card" data-entity="' + e.key + '">' +
                        '<i class="fas ' + e.icon + '"></i><span>' + _esc(e.label) + '</span></div>';
                }).join('') +
                '</div>';
            Array.prototype.forEach.call(body.querySelectorAll('.emp-bb-entity-card'), function (card) {
                card.addEventListener('click', function () {
                    _selectedEntity = card.getAttribute('data-entity');
                    _modalStep = 2;
                    _renderModalStep();
                });
            });
            return;
        }

        if (_modalStep === 2) {
            var e2 = _entity(_selectedEntity);
            body.innerHTML =
                '<button class="emp-bb-back-btn" id="emp-bb-back-1"><i class="fas fa-arrow-left"></i> Back</button>' +
                '<div class="emp-bb-step-title">Choose your tier</div>' +
                '<div class="emp-bb-step-sub">' + _esc(e2.label) + ' badge \u2014 pick a tier. Higher tiers get a brighter finish and a platinum ring.</div>' +
                '<div class="emp-bb-tier-row">' +
                TIERS.map(function (t) {
                    return '<div class="emp-bb-tier-card" data-tier="' + t.key + '">' +
                        badgeSVG(_selectedEntity, t.key, 34) +
                        '<div class="emp-bb-tier-name">' + t.label + '</div>' +
                        '<div class="emp-bb-tier-price">' + _fmtNaira(_price(_selectedEntity, t.key)) + '</div>' +
                        '</div>';
                }).join('') +
                '</div>';
            var backBtn = document.getElementById('emp-bb-back-1');
            if (backBtn) backBtn.addEventListener('click', function () { _modalStep = 1; _renderModalStep(); });
            Array.prototype.forEach.call(body.querySelectorAll('.emp-bb-tier-card'), function (card) {
                card.addEventListener('click', function () {
                    _selectedTier = card.getAttribute('data-tier');
                    _modalStep = 3;
                    _renderModalStep();
                });
            });
            return;
        }

        if (_modalStep === 3) {
            var e3 = _entity(_selectedEntity), t3 = _tier(_selectedTier);
            var amount = _price(_selectedEntity, _selectedTier);
            body.innerHTML =
                '<button class="emp-bb-back-btn" id="emp-bb-back-2"><i class="fas fa-arrow-left"></i> Back</button>' +
                '<div style="text-align:center;margin-bottom:14px;">' + badgeSVG(_selectedEntity, _selectedTier, 72) + '</div>' +
                '<div class="emp-bb-step-title" style="text-align:center;">' + e3.label + ' \u2014 ' + t3.label + '</div>' +
                '<div class="emp-bb-step-sub" style="text-align:center;">' + _fmtNaira(amount) + ' \u00b7 one-time, lifetime badge</div>' +
                '<div style="background:#e8f5e9;border-left:4px solid var(--success-color,#10B981);padding:10px;border-radius:5px;margin-bottom:16px;font-size:0.82rem;">' +
                '<i class="fas fa-shield-alt" style="color:var(--success-color,#10B981);"></i> Payment secured by <strong>Flutterwave</strong>.</div>' +
                '<button class="emp-bb-pay-btn" id="emp-bb-pay-btn"><i class="fas fa-check-circle"></i> Pay ' + _fmtNaira(amount) + '</button>';
            var backBtn2 = document.getElementById('emp-bb-back-2');
            if (backBtn2) backBtn2.addEventListener('click', function () { _modalStep = 2; _renderModalStep(); });
            var payBtn = document.getElementById('emp-bb-pay-btn');
            if (payBtn) payBtn.addEventListener('click', function () { _pay(_selectedEntity, _selectedTier, amount, payBtn); });
        }
    }

    function _pay(entityKey, tierKey, amount, btnEl) {
        var us = _us();
        if (typeof FlutterwaveCheckout === 'undefined') {
            _notify('Payment system not available. Please try again shortly.', 'error');
            return;
        }
        if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing\u2026'; }
        FlutterwaveCheckout({
            public_key: (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '',
            tx_ref: 'EMPY-BADGE-' + entityKey + '-' + tierKey + '-' + Date.now(),
            amount: amount,
            currency: 'NGN',
            payment_options: 'card,banktransfer,ussd',
            customer: {
                email: us.email || 'user@empyrean.com',
                phone_number: us.phone || '',
                name: us.fullName || 'Empyrean Member'
            },
            customizations: {
                title: 'Empyrean Verification Badge',
                description: _entity(entityKey).label + ' \u2014 ' + _tier(tierKey).label + ' badge',
                logo: 'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
            },
            callback: function (data) {
                if (data.status === 'successful') {
                    _saveBadge(entityKey, tierKey);
                    _closeModal();
                    _notify('\u2705 ' + _entity(entityKey).label + ' ' + _tier(tierKey).label + ' badge activated!', 'success');
                    _refreshAllMounts();
                } else {
                    _notify('Payment was not completed. Please try again.', 'error');
                }
                if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-check-circle"></i> Pay ' + _fmtNaira(amount); }
            },
            onclose: function () {
                if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-check-circle"></i> Pay ' + _fmtNaira(amount); }
            }
        });
    }

    /* =========================================================================
       §6 — Banner / owned-chip markup + mount points
       ========================================================================= */

    /* REDESIGN (2026-10-27): "Get verified" card. Same entry point (_openModal) and same mount/remount flow
       as before; only the markup changed. "Not now" hides it for the rest of this browser session. */
    var _BB_TICK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="#1B2B8B" stroke-width="1.8"/><path d="M8 12.3l2.8 2.8 5.4-5.6" stroke="#1B2B8B" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function _bannerHTML() {
        return '<div class="emp-bb-banner" data-emp-bb-banner>' +
            '<div class="emp-bb-banner-head">' +
            '<span class="emp-bb-badge-ring">' + badgeSVG('individual', 'elite', 30) + '</span>' +
            '<div class="emp-bb-banner-text">' +
            '<div class="emp-bb-banner-title">Get verified</div>' +
            '<div class="emp-bb-banner-sub">Show the tick beside your name.</div>' +
            '</div></div>' +
            '<ul class="emp-bb-benefits">' +
            '<li>' + _BB_TICK + 'Verified tick on your profile and posts</li>' +
            '<li>' + _BB_TICK + 'Build trust with people who find you</li>' +
            '<li>' + _BB_TICK + 'Stand out in suggestions and search</li>' +
            '</ul>' +
            '<button type="button" class="emp-bb-cta">Get verified from ' + _fmtNaira(PRICING.individual.basic) + '</button>' +
            '<button type="button" class="emp-bb-later">Not now</button></div>';
    }

    function _ownedChipHTML(us) {
        var e = _entity(us.badgeEntityType), t = _tier(us.badgeTier);
        return '<div class="emp-bb-owned-chip">' + badgeSVG(us.badgeEntityType, us.badgeTier, 16) +
            e.label + ' \u00b7 ' + t.label + ' Badge</div>';
    }

    function _mountInto(container) {
        if (!container || container.getAttribute('data-emp-bb-mounted') === '1') return;
        container.setAttribute('data-emp-bb-mounted', '1');
        var us = _us();
        var wrap = document.createElement('div');
        if (us.hasBlueBadge) {
            wrap.innerHTML = _ownedChipHTML(us);
        } else {
            try { if (sessionStorage.getItem('emp_bb_banner_dismissed') === '1') { return; } } catch (eSs) {}
            wrap.innerHTML = _bannerHTML();
            wrap.firstChild.addEventListener('click', function (ev) {
                var later = ev.target && ev.target.closest && ev.target.closest('.emp-bb-later');
                if (later) {
                    ev.stopPropagation();
                    try { sessionStorage.setItem('emp_bb_banner_dismissed', '1'); } catch (eSs2) {}
                    if (wrap.firstChild && wrap.firstChild.parentNode) wrap.firstChild.parentNode.removeChild(wrap.firstChild);
                    return;
                }
                _openModal();
            });
        }
        if (wrap.firstChild) container.appendChild(wrap.firstChild);
    }

    function _remount(container) {
        if (!container) return;
        container.removeAttribute('data-emp-bb-mounted');
        var existing = container.querySelector('.emp-bb-banner, .emp-bb-owned-chip');
        if (existing) existing.remove();
        _mountInto(container);
    }

    /* ── Dashboard promo toast ───────────────────────────────────────────
       Unlike the profile/settings banner (which stays put once mounted),
       the dashboard version is a one-off pop-in: appended to <body> (so
       `position:fixed` isn't at the mercy of an ancestor's transform),
       slides in from the right, and slides back out + unmounts a few
       seconds later — either on its own timer or on user dismissal. It
       re-appears fresh each time the dashboard becomes active, rather
       than staying mounted forever. ── */
    var _dashToastTimer = null;
    var _dashToastActive = false;
    /* FIX (request — "badge banner displayed on the home page appears too
       frequently; it should only display once, immediately after login"):
       this was wired to 'empyrean-section-change' with sec === 'dashboard'
       (see the listener further down), so it re-popped in every single
       time the person navigated back to the home tab during a session —
       not just after logging in. Gated with this one-shot flag so it can
       only ever fire once per login. */
    var _dashToastShownThisSession = false;

    function _showDashboardToast() {
        var us = _us();
        if (us.hasBlueBadge || _isGuest() || _dashToastActive || _dashToastShownThisSession) return;
        _dashToastShownThisSession = true;
        var stale = document.querySelector('.emp-bb-dash-toast');
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);

        _dashToastActive = true;
        var el = document.createElement('div');
        el.className = 'emp-bb-dash-toast';
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', 'Get your verification badge');
        el.innerHTML = badgeSVG('individual', 'elite', 34) +
            '<div class="emp-bb-banner-text">' +
            '<div class="emp-bb-banner-title">Get your Verification Badge</div>' +
            '<div class="emp-bb-banner-sub">Stand out with a badge for your account type \u2014 from ' + _fmtNaira(PRICING.individual.basic) + '.</div>' +
            '</div>' +
            '<i class="fas fa-chevron-right emp-bb-toast-chevron"></i>' +
            '<button type="button" class="emp-bb-toast-close" aria-label="Dismiss">&times;</button>';
        document.body.appendChild(el);

        el.addEventListener('click', function (e) {
            var closing = !!(e.target && e.target.closest && e.target.closest('.emp-bb-toast-close'));
            _dismissDashboardToast(el);
            if (!closing) _openModal();
        });

        clearTimeout(_dashToastTimer);
        _dashToastTimer = setTimeout(function () { _dismissDashboardToast(el); }, 6500);
    }

    function _dismissDashboardToast(el) {
        clearTimeout(_dashToastTimer);
        if (!el || !el.parentNode) { _dashToastActive = false; return; }
        el.classList.add('emp-bb-toast-leaving');
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
            _dashToastActive = false;
        }, 420);
    }

    function _refreshAllMounts() {
        ['profile', 'settings'].forEach(function (name) {
            var c = _containerFor(name);
            if (c) _remount(c);
        });
        // A badge was just purchased — clear any pending promo toast rather
        // than let it pop in and advertise something already bought.
        var activeToast = document.querySelector('.emp-bb-dash-toast');
        if (activeToast) _dismissDashboardToast(activeToast);
        // Refresh badge icon next to the profile display name, if present.
        _mountNameBadge();
    }

    function _containerFor(section) {
        if (section === 'profile') {
            var host = document.querySelector('.profile-header-container');
            if (!host) return null;
            var slot = host.nextElementSibling;
            if (!slot || !slot.classList || !slot.classList.contains('emp-bb-slot')) {
                slot = document.createElement('div');
                slot.className = 'emp-bb-slot';
                host.parentNode.insertBefore(slot, host.nextSibling);
            }
            return slot;
        }
        if (section === 'settings') {
            var sp = document.getElementById('settings-profile');
            if (!sp) return null;
            var slot2 = sp.querySelector(':scope > .emp-bb-slot');
            if (!slot2) {
                slot2 = document.createElement('div');
                slot2.className = 'emp-bb-slot';
                sp.insertBefore(slot2, sp.firstChild);
            }
            return slot2;
        }
        return null;
    }

    function _mountNameBadge() {
        var nameEl = document.getElementById('profile-display-name');
        if (!nameEl) return;
        var existing = nameEl.querySelector('.emp-bb-name-badge');
        if (existing) existing.remove();
        var us = _us();
        if (!us.hasBlueBadge) return;
        var span = document.createElement('span');
        span.className = 'emp-bb-name-badge';
        span.style.marginLeft = '6px';
        span.style.verticalAlign = 'middle';
        span.innerHTML = badgeSVG(us.badgeEntityType, us.badgeTier, 20);
        nameEl.appendChild(span);
    }

    document.addEventListener('empyrean-section-change', function (ev) {
        var sec = ev && ev.detail && ev.detail.section;
        if (sec === 'profile') setTimeout(function () { _mountInto(_containerFor('profile')); _mountNameBadge(); }, 250);
        if (sec === 'settings') setTimeout(function () { _mountInto(_containerFor('settings')); }, 250);
        if (sec === 'dashboard') setTimeout(function () { _showDashboardToast(); }, 250);
    });

    log('\u2705 Blue Badge module armed \u2014 6 entity types \u00d7 3 tiers, distinct per-tier colors, profile/settings banner + dashboard slide-in toast.');

})();