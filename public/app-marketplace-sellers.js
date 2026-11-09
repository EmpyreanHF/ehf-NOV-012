/* =============================================================================
   EMPYREAN INTERNATIONAL — MARKETPLACE SELLER PROFILES
   app-marketplace-sellers.js

   v2 — converted from popup modal to full-screen pages, per direct request:
   the Seller Profile and the KYC verification form now each live in their
   own <section class="content-section"> (#seller-profile-page and
   #seller-kyc-page in index.html), switched via the app's existing
   navigateTo() router in app-nav.js — the same mechanism every other
   section (Profile, Settings, Saved Posts, etc.) already uses. This keeps
   sidebar/breadcrumb/mobile-nav state consistent instead of inventing a
   parallel modal-only navigation path.

   WHAT THIS FILE OWNS
   ────────────────────
   • Verified-seller checkmark badge, injected onto every .property-card's
     seller row (DOM post-processing — never touches app-fixes.js's
     card-builder HTML).
   • Seller Profile page (#seller-profile-page): seller info, verified
     badge, star rating summary, grid of active listings, and reviews.
     Opened by tapping a seller's name on any listing card, or by swiping
     left on the Marketplace for your own profile.
   • Buyer reviews & ratings: 1–5 star + text review, one per buyer per
     seller (upsert), stored in the `marketplace_reviews` Firestore
     collection.
   • Seller KYC verification page (#seller-kyc-page): reached by swiping
     left anywhere on the Marketplace, or tapping the "Set Up Seller
     Profile" banner (swipe-only affordances are easy to miss, so both
     exist and do the same thing). Collects ID/business-certificate
     documents and submits into the existing `kyc_submissions` collection
     (the same collection/shape app-fixes.js's generic KYC flow already
     writes to), so it plugs into whatever admin review pipeline already
     processes KYC — no parallel approval system invented here. Once an
     admin marks the account isVerified (the same flag already used
     app-wide — see app-live.js's admin "Mark Verified" panel), the
     checkmark badge appears automatically everywhere this file renders it.

   DEPENDENCY NOTE: this reuses `users/{uid}.isVerified` (the existing
   app-wide verified flag) and the existing `kyc_submissions` collection
   shape. If app-kyc.js / app-admin.js expect different field names than
   what's used here, this may need a small alignment pass against those
   files — they weren't in the set of files shared for this change.
   ============================================================================= */

(function empyreanMarketplaceSellersModule() {
    'use strict';

    if (window._empyreanMarketplaceSellersLoaded) {
        console.warn('[EmpMarketSellers] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanMarketplaceSellersLoaded = true;

    /* ── Local helpers (mirrors app-marketplace.js's own local helpers —
       each module in this codebase stays self-contained) ── */
    /* Inline-SVG WhatsApp glyph — used instead of the Font Awesome brand
       webfont ("fab fa-whatsapp"). Font Awesome's brand icons ship in a
       *separate* font file from the regular/solid sets, so even when the
       rest of the icon font loads fine, this glyph can still fail to
       arrive on a slow/unstable connection and render as a blank box —
       the same known failure mode already worked around elsewhere in the
       marketplace (see app-marketplace.js's MKT_ICONS) and app-wide (see
       the disabled community-tasks icon map in app-fixes.js).
       FIX (2026-08-09 — "should display the WhatsApp logo"): the previous
       version of this constant was a generic line-glyph speech bubble —
       recognizable as SOME kind of chat icon, but not actually the
       WhatsApp mark, so it read as wrong/broken next to a real WhatsApp
       number. This is now the real WhatsApp glyph (rounded bubble tail +
       the handset/receiver mark), traced as a single filled path so it
       stays just as self-contained and offline-safe as the icon it
       replaces — no dependency on the brands webfont loading at all. */
    var _WA_ICON_SVG = '<svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor" style="flex-shrink:0;"><path d="M16.001 3C9.107 3 3.5 8.607 3.5 15.5c0 2.42.687 4.68 1.878 6.598L3 29l7.09-2.336A12.42 12.42 0 0 0 16.001 28C22.894 28 28.5 22.393 28.5 15.5S22.894 3 16.001 3zm0 22.75c-2.02 0-3.9-.59-5.48-1.607l-.393-.246-4.207 1.387 1.406-4.1-.256-.42A10.19 10.19 0 0 1 5.75 15.5c0-5.66 4.59-10.25 10.251-10.25 5.66 0 10.25 4.59 10.25 10.25 0 5.66-4.59 10.25-10.25 10.25zm5.63-7.678c-.31-.155-1.828-.902-2.111-1.005-.283-.104-.489-.155-.695.155-.206.31-.797 1.005-.978 1.211-.18.206-.36.232-.669.078-.31-.155-1.309-.482-2.492-1.535-.921-.82-1.543-1.834-1.724-2.144-.18-.31-.02-.478.136-.632.14-.14.31-.361.464-.542.155-.18.206-.31.31-.516.103-.206.051-.387-.026-.542-.078-.155-.695-1.673-.952-2.291-.251-.602-.505-.52-.695-.53-.18-.008-.387-.01-.593-.01-.206 0-.542.078-.826.387-.283.31-1.082 1.057-1.082 2.577 0 1.52 1.108 2.988 1.262 3.194.155.206 2.181 3.33 5.284 4.67.738.319 1.315.51 1.764.652.741.236 1.416.203 1.949.123.595-.089 1.828-.747 2.086-1.469.258-.723.258-1.343.18-1.469-.077-.129-.283-.206-.593-.361z"/></svg>';

    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    function _isAdmin() { var s = _S(); return s.isAdmin != null ? s.isAdmin : (window.isAdmin || false); }
    function _fbDb()    { return window.fbDb || null; }

    // Minimum naira withdrawal — a placeholder figure, not something the
    // product spec fixed. Easy to change: just this one constant.
    var MKT_NGN_WITHDRAW_MIN = 1000;
    function _isGuest() {
        if (typeof window._empIsGuest === 'function') return window._empIsGuest();
        if (_S().isGuest === false) return false;
        if (_S().isGuest === true) return true;
        return !(_us() && _us().id);
    }
    function _ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }
    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _goTo(sectionId) {
        if (typeof window.navigateTo === 'function') window.navigateTo(sectionId);
        else { var el = document.getElementById(sectionId); if (el) el.scrollIntoView(); }
    }

    /* Premium seller-avatar markup: a real photo when one exists and loads,
       otherwise a navy/gold monogram medallion (first letter of the name)
       — instead of the plain <img src=""> that used to just render a
       broken-image icon whenever a seller hadn't set a profile photo.
       extraClass/extraStyle let callers keep their own sizing/cursor
       tweaks (the header vs. the bio-modal use slightly different ones). */
    function _mktSellerAvatarHTML(name, avatarUrl, extraClass, extraStyle) {
        var cls = 'mkt-seller-avatar' + (extraClass ? ' ' + extraClass : '');
        var style = extraStyle || '';
        var initial = (String(name || '').trim().charAt(0) || '?').toUpperCase();
        var hasPhoto = !!avatarUrl;
        var img = hasPhoto
            ? '<img src="' + _esc(avatarUrl) + '" alt="' + _esc(name) + '" style="display:block;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">'
            : '';
        var placeholder = '<div class="mkt-seller-avatar-placeholder" style="display:' + (hasPhoto ? 'none' : 'flex') + ';"><span>' + _esc(initial) + '</span></div>';
        return '<div class="' + cls + '" style="' + style + '">' + img + placeholder + '</div>';
    }

    /* =========================================================================
       §STYLE  Injected once — badge, stars, page layout, swipe hint banner.
       ========================================================================= */
    (function _injectStyles() {
        if (document.getElementById('_mkt_sellers_style')) return;
        var s = document.createElement('style');
        s.id = '_mkt_sellers_style';
        s.textContent = [
            '.property-seller-info strong.mkt-seller-name-clickable { cursor:pointer; }',
            '.property-seller-info strong.mkt-seller-name-clickable:hover { text-decoration:underline; }',
            '.mkt-seller-verified-badge { color:#1d9bf0; margin-left:4px; font-size:0.85em; }',
            '.mkt-dash-av-head-clickable { cursor:pointer; }',
            '.mkt-dash-av-head-clickable:hover .mkt-dash-av-names h5 { text-decoration:underline; }',

            '.mkt-stars { color:#f5b301; letter-spacing:1px; white-space:nowrap; }',
            '.mkt-stars .far { color:rgba(0,0,0,0.18); }',
            '.mkt-rating-summary { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:6px 0 14px; }',
            '.mkt-rating-avg { font-weight:800; color:var(--primary); font-size:1.1rem; }',
            '.mkt-rating-count { color:var(--color-neutral-600); font-size:0.85rem; }',

            '.mkt-seller-header { display:flex; align-items:center; gap:14px; margin-bottom:6px; }',
            '.mkt-seller-avatar { width:72px; height:72px; border-radius:50%; object-fit:cover; background:#eee; flex-shrink:0; cursor:pointer; }',
            '.mkt-seller-header-info { flex:1; min-width:0; }',
            /* Own-profile only — see editProfileBtnHTML in _renderSellerProfilePage. */
            '.mkt-seller-edit-profile-btn { flex-shrink:0; align-self:flex-start; height:34px; padding:0 14px; border-radius:17px; border:none; background:var(--secondary); color:#fff; font-size:0.82rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; }',
            '.mkt-seller-edit-profile-btn i { font-size:0.9rem; }',
            '.mkt-seller-name-row { display:flex; align-items:center; gap:6px; font-weight:800; font-size:1.25rem; color:var(--primary); }',
            '.mkt-seller-username { color:var(--color-neutral-600); font-size:0.9rem; }',
            '.mkt-seller-msg-btn { margin-left:10px; flex-shrink:0; height:34px; padding:0 14px; border-radius:17px; border:none; background:var(--secondary); color:#fff; font-size:0.82rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; text-decoration:none; }',
            '.mkt-seller-msg-btn i { font-size:0.95rem; }',
            '.mkt-seller-phone-row { display:flex; align-items:center; flex-wrap:wrap; row-gap:6px; }',

            '.mkt-seller-contact-row { display:flex; flex-direction:column; gap:6px; margin:10px 0 12px; }',
            '.mkt-seller-contact-item { display:flex; align-items:center; gap:8px; font-size:0.87rem; color:var(--color-neutral-700); text-decoration:none; word-break:break-all; min-width:0; }',
            '.mkt-seller-contact-item.mkt-seller-contact-whatsapp { flex:1 1 auto; }',
            '.mkt-seller-contact-item i, .mkt-seller-contact-item svg { width:16px; flex-shrink:0; color:var(--secondary); }',
            '.mkt-seller-contact-item.mkt-seller-contact-whatsapp { color:#25D366; font-weight:600; min-width:0; }',
            '.mkt-seller-contact-item.mkt-seller-contact-whatsapp i, .mkt-seller-contact-item.mkt-seller-contact-whatsapp svg { color:#25D366; }',
            '.mkt-seller-contact-item.mkt-seller-contact-tel { color:var(--secondary); font-weight:600; }',

            /* FIX (2026-08-09 — phone-column cleanup): directPhoneHTML /
               whatsappHTML are now wrapped in a small span so an own-
               profile-only edit pencil can sit right next to the number
               instead of in a separate row above (see businessInfoHTML's
               own comment in _renderSellerProfilePage). */
            '.mkt-seller-contact-tel-wrap, .mkt-seller-contact-whatsapp-wrap { display:flex; align-items:center; gap:4px; }',
            '.mkt-seller-contact-edit-btn { width:22px; height:22px; font-size:0.68rem; }',
            '.mkt-seller-contact-unset { color:var(--color-neutral-500); font-style:normal; }',
            '.mkt-seller-contact-unset em { font-style:normal; }',
            /* Third contact column — direct Empyrean messages inbox
               (window.openChat, general 1:1 chat — see the wiring for
               #mkt-seller-direct-msg-btn in _renderSellerProfilePage). */
            '.mkt-seller-contact-item.mkt-seller-contact-msg { color:var(--secondary); font-weight:600; cursor:pointer; }',
            '.mkt-seller-contact-item.mkt-seller-contact-msg i { color:var(--secondary); }',
            /* FIX (2026-08-09 — "the 1:1 Empyrean inbox chat should include
               the Empyrean logo"): sizes the new /logo.png badge to match
               the 16px icon column every other contact row uses, with a
               slight rounding so a square source image still reads as a
               small brand mark rather than a raw screenshot-shaped icon. */
            '.mkt-seller-msg-logo { width:16px; height:16px; flex-shrink:0; border-radius:4px; object-fit:cover; vertical-align:middle; }',

            /* Marketplace Adjustments #6/#7 (2026-08-09): own-profile
               editable business-info block — Company Name / Direct Phone
               Number / WhatsApp Number. */
            '.mkt-seller-business-info { display:flex; flex-direction:column; gap:2px; margin:10px 0 4px; padding:10px 12px; background:rgba(10,14,39,0.03); border-radius:12px; }',
            '.mkt-seller-business-row { display:flex; align-items:center; gap:8px; padding:5px 0; }',
            '.mkt-seller-business-label { flex:0 0 150px; font-size:0.78rem; font-weight:700; color:var(--color-neutral-600); }',
            '.mkt-seller-business-value { flex:1; min-width:0; font-size:0.87rem; color:var(--primary); word-break:break-word; }',
            '.mkt-seller-business-value em { color:var(--color-neutral-500); font-style:normal; }',
            '.mkt-seller-business-edit-btn { flex-shrink:0; width:28px; height:28px; border-radius:50%; border:none; background:rgba(27,43,139,0.08); color:var(--secondary); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:0.78rem; }',
            '.mkt-seller-business-edit-btn:active { opacity:0.7; }',

            /* Seller bio modal — opened by tapping the avatar */
            /* Seller bio modal — opened by tapping the avatar. Anchored to
               the bottom of the screen (bottom-sheet style) instead of the
               shared .modal-overlay-container's centered/top-anchored
               position, scoped to this modal only so nothing else in the
               app is affected. */
            '#mkt-seller-bio-modal.modal-overlay-container { align-items:flex-end !important; justify-content:center !important; padding-top:0 !important; }',
            '#mkt-seller-bio-modal .modal-card { width:100% !important; max-width:520px !important; text-align:left !important; border-radius:20px 20px 0 0 !important; max-height:80vh !important; overflow-y:auto !important; margin:0 !important; }',
            '.mkt-bio-stats { display:flex; gap:18px; flex-wrap:wrap; margin:14px 0 16px; padding:14px 16px; background:rgba(10,14,39,0.03); border-radius:12px; }',
            '.mkt-bio-stat { text-align:center; }',
            '.mkt-bio-stat .mbs-num { display:block; font-weight:800; font-size:1.15rem; color:var(--primary); }',
            '.mkt-bio-stat .mbs-label { font-size:0.7rem; color:var(--color-neutral-600); text-transform:uppercase; letter-spacing:0.03em; }',
            '.mkt-bio-row { display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid rgba(10,14,39,0.06); font-size:0.9rem; color:var(--color-neutral-700); }',
            '.mkt-bio-row i { width:18px; color:var(--secondary); }',
            '.mkt-bio-row:last-child { border-bottom:none; }',

            '.mkt-seller-tabs { display:flex; gap:6px; margin:16px 0 12px; border-bottom:1.5px solid rgba(10,14,39,0.08); }',
            '.mkt-seller-tab { padding:9px 16px; font-weight:700; font-size:0.92rem; color:var(--color-neutral-600); cursor:pointer; border-bottom:2px solid transparent; }',
            '.mkt-seller-tab.active { color:var(--secondary); border-bottom-color:var(--secondary); }',
            '.mkt-seller-pane { display:none; }',
            '.mkt-seller-pane.active { display:block; }',

            '.mkt-seller-listings-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; }',
            '.mkt-seller-mini-card { border-radius:14px; overflow:hidden; border:1px solid rgba(10,14,39,0.07); cursor:pointer; background:#fff; }',
            '.mkt-seller-mini-card img { width:100%; height:100px; object-fit:cover; display:block; background:#eee; }',
            '.mkt-seller-mini-card .mmc-body { padding:8px; }',
            '.mkt-seller-mini-card .mmc-name { font-size:0.8rem; font-weight:700; color:var(--primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
            '.mkt-seller-mini-card .mmc-price { font-size:0.78rem; color:var(--accent-color); font-weight:700; }',

            '.mkt-review-card { border-bottom:1px solid rgba(10,14,39,0.06); padding:12px 0; }',
            '.mkt-review-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }',
            '.mkt-review-author { font-weight:700; font-size:0.87rem; color:var(--primary); }',
            '.mkt-review-date { font-size:0.72rem; color:var(--color-neutral-600); }',
            '.mkt-review-comment { font-size:0.89rem; color:var(--color-neutral-700); margin-top:4px; }',

            '.mkt-review-form { border-top:1px solid rgba(10,14,39,0.08); margin-top:16px; padding-top:16px; max-width:420px; }',
            '.mkt-star-picker { display:flex; gap:6px; font-size:1.7rem; color:rgba(0,0,0,0.18); cursor:pointer; margin-bottom:10px; }',
            '.mkt-star-picker i.active { color:#f5b301; }',
            '.mkt-review-form textarea { width:100%; border-radius:12px; border:1.5px solid rgba(10,14,39,0.1); padding:10px 12px; font-size:0.9rem; resize:vertical; min-height:70px; }',

            '.mkt-verify-block { margin-top:18px; border-top:1px solid rgba(10,14,39,0.08); padding-top:16px; }',
            '.mkt-verify-status { display:flex; align-items:center; gap:8px; font-weight:700; padding:12px 16px; border-radius:12px; }',
            '.mkt-verify-status.is-verified { background:rgba(29,155,240,0.08); color:#1d9bf0; }',
            '.mkt-verify-status.is-pending { background:rgba(245,179,1,0.1); color:#a67200; }',
            '.mkt-verify-cta { display:inline-flex; align-items:center; gap:8px; padding:11px 18px; border-radius:12px; background:var(--g-navy,linear-gradient(135deg,var(--color-navy),var(--color-royal))); color:#fff; font-weight:700; font-size:0.9rem; border:none; cursor:pointer; }',

            '.mkt-kyc-form { max-width:460px; }',
            '.mkt-kyc-form .form-group { margin:12px 0; }',
            '.mkt-kyc-form label { display:block; font-size:0.82rem; font-weight:700; color:var(--primary); margin-bottom:5px; }',
            '.mkt-kyc-form input, .mkt-kyc-form select { width:100%; padding:10px 13px; border-radius:10px; border:1.5px solid rgba(10,14,39,0.1); font-size:0.9rem; }',
            '.mkt-kyc-intro { color:var(--color-neutral-700); font-size:0.9rem; margin-bottom:16px; max-width:460px; }',

            /* Discoverable fallback for the swipe gesture — swipe-only affordances
               are easy to miss, so a tappable banner sits at the top of the
               Marketplace and does exactly what the swipe does. */
            '.mkt-seller-swipe-banner { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; background:rgba(27,43,139,0.06); border:1.5px dashed rgba(27,43,139,0.25); border-radius:14px; padding:12px 16px; margin-bottom:16px; }',
            '.mkt-seller-swipe-banner .msb-text { font-size:0.87rem; color:var(--primary); font-weight:600; display:flex; align-items:center; gap:8px; }',
            '.mkt-seller-swipe-banner .msb-text i.fa-hand-point-left { color:var(--secondary); animation:mktSwipeHintNudge 1.6s ease-in-out infinite; }',
            '@keyframes mktSwipeHintNudge { 0%,100% { transform:translateX(0); } 50% { transform:translateX(-6px); } }',
            '.mkt-seller-swipe-banner button { flex-shrink:0; padding:9px 16px; border-radius:10px; border:none; background:var(--secondary); color:#fff; font-weight:700; font-size:0.85rem; cursor:pointer; white-space:nowrap; }',
            '.mkt-seller-swipe-banner.is-verified { background:rgba(29,155,240,0.07); border-style:solid; border-color:rgba(29,155,240,0.2); }',
            '.mkt-seller-swipe-banner.is-pending { background:rgba(245,179,1,0.08); border-style:solid; border-color:rgba(245,179,1,0.25); }',

            /* Listing Detail page — this had NO CSS anywhere before this
               fix, so the "dedicated page" every listing now opens into
               was rendering as unstyled stacked divs (full-bleed hero
               image with no crop, plain-text price, no spacing between
               rows). Added as its own block since this file is what
               builds/owns the page. */
            '.mkt-listing-detail-hero { width:100%; height:280px; object-fit:cover; display:block; background:#eee; }',
            '.mkt-listing-detail-thumbs { display:flex; gap:8px; padding:10px 16px 0; overflow-x:auto; -webkit-overflow-scrolling:touch; }',
            '.mkt-listing-detail-thumbs img { width:56px; height:56px; object-fit:cover; border-radius:8px; flex-shrink:0; cursor:pointer; opacity:0.6; border:2px solid transparent; }',
            '.mkt-listing-detail-thumbs img.active { opacity:1; border-color:var(--secondary); }',
            '.mkt-listing-detail-body { padding:18px 16px 28px; }',
            '.mkt-listing-detail-name { margin:10px 0 4px; font-size:1.3rem; color:var(--primary); }',
            '.mkt-listing-detail-price { font-size:1.15rem; font-weight:800; color:var(--accent-color); margin-bottom:10px; }',
            '.mkt-listing-detail-seller { display:inline-flex; align-items:center; gap:8px; font-weight:600; color:var(--secondary); font-size:0.9rem; margin-bottom:14px; }',
            '.mkt-listing-detail-desc { font-size:0.92rem; color:var(--color-neutral-700); line-height:1.5; margin:14px 0; white-space:pre-wrap; }',
            '.mkt-listing-detail-loc { display:flex; align-items:center; gap:8px; font-size:0.87rem; color:var(--color-neutral-600); margin-bottom:6px; }',
            '.mkt-listing-detail-loc i { color:var(--secondary); }',

            /* Step-by-step spec list — one row per field (Year, Brand,
               Model, ...), each numbered, instead of the compact inline
               chip row used on cards. */
            '.mkt-listing-detail-specs { margin:14px 0; border:1px solid rgba(10,14,39,0.08); border-radius:14px; overflow:hidden; }',
            '.mkt-listing-detail-spec-row { display:flex; align-items:center; gap:12px; padding:11px 14px; border-bottom:1px solid rgba(10,14,39,0.06); }',
            '.mkt-listing-detail-spec-row:last-child { border-bottom:none; }',
            '.mkt-listing-detail-spec-row:nth-child(odd) { background:rgba(10,14,39,0.02); }',
            '.mlds-step { flex-shrink:0; width:22px; height:22px; border-radius:50%; background:var(--secondary); color:#fff; font-size:0.72rem; font-weight:800; display:flex; align-items:center; justify-content:center; }',
            '.mlds-label { flex:1; font-weight:700; font-size:0.85rem; color:var(--color-neutral-700); }',
            '.mlds-value { font-size:0.87rem; color:var(--primary); font-weight:600; text-align:right; word-break:break-word; max-width:55%; }',

            /* Orders pane (own-profile only) — "My Purchases" / "My Sales" */
            '.mkt-orders-subhead { font-weight:800; font-size:0.86rem; color:var(--color-neutral-600); text-transform:uppercase; letter-spacing:0.03em; margin:18px 0 8px; }',
            '.mkt-orders-subhead:first-child { margin-top:0; }',
            '.mkt-order-row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid rgba(10,14,39,0.06); }',
            '.mkt-order-row:last-child { border-bottom:none; }',
            '.mkt-order-info { flex:1; min-width:0; }',
            '.mkt-order-title { font-weight:700; font-size:0.9rem; color:var(--primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
            '.mkt-order-meta { font-size:0.78rem; color:var(--color-neutral-600); margin-top:2px; }',
            '.mkt-order-status { display:inline-block; padding:3px 10px; border-radius:20px; font-size:0.7rem; font-weight:800; letter-spacing:0.02em; margin-top:4px; }',
            '.mkt-order-status.status-paid { background:rgba(245,179,1,0.12); color:#a67200; }',
            '.mkt-order-status.status-dispatched { background:rgba(29,155,240,0.1); color:#1d9bf0; }',
            '.mkt-order-status.status-released { background:rgba(22,163,74,0.1); color:#16A34A; }',
            '.mkt-order-action-btn { flex-shrink:0; padding:8px 14px; border-radius:10px; border:none; background:var(--secondary); color:#fff; font-weight:700; font-size:0.78rem; cursor:pointer; white-space:nowrap; }',
            '.mkt-order-action-btn:disabled { opacity:0.5; cursor:default; }',

            /* Naira Earnings block (own-profile Orders pane, above My
               Purchases/My Sales) + Withdraw to Bank modal — matches the
               bottom-sheet convention already used by the seller bio modal. */
            '.mkt-earnings-block { background:linear-gradient(135deg,rgba(27,43,139,0.06),rgba(201,166,107,0.08)); border:1px solid rgba(27,43,139,0.12); border-radius:16px; padding:16px 18px; margin-bottom:18px; }',
            '.mkt-earnings-label { font-size:0.75rem; font-weight:800; color:var(--color-neutral-600); text-transform:uppercase; letter-spacing:0.04em; }',
            '.mkt-earnings-amount { font-size:1.6rem; font-weight:800; color:var(--primary); margin:4px 0 12px; }',
            '.mkt-withdraw-btn { display:inline-flex; align-items:center; gap:8px; padding:10px 18px; border-radius:12px; border:none; background:var(--g-navy,linear-gradient(135deg,var(--color-navy),var(--color-royal))); color:#fff; font-weight:700; font-size:0.87rem; cursor:pointer; }',
            '.mkt-withdraw-btn:disabled { opacity:0.5; cursor:default; }',
            '.mkt-earnings-min-note { font-size:0.76rem; color:var(--color-neutral-600); margin-top:8px; }',
            '#mkt-withdraw-modal.modal-overlay-container { align-items:flex-end !important; justify-content:center !important; padding-top:0 !important; }',
            '#mkt-withdraw-modal .modal-card { width:100% !important; max-width:480px !important; text-align:left !important; border-radius:20px 20px 0 0 !important; max-height:85vh !important; overflow-y:auto !important; margin:0 !important; }'
        ].join('\n');
        document.head.appendChild(s);
    })();

    /* =========================================================================
       §VERIFIED BADGE  Cached isVerified lookups + DOM post-processing.
       ========================================================================= */
    var _verifiedCache = {}; /* uid -> true | false */
    var _listingDetailCache = {}; /* itemId -> raw listing data, populated by _renderSellerProfilePage */
    var _userDocCache  = {}; /* uid -> full user doc data (short-lived, cleared on refresh) */
    /* FIX (bug — Listing Detail's back button was hardcoded to always
       return to #seller-profile-page, but this page is opened from three
       different places: the main Marketplace grid, the Dashboard's "New
       in Marketplace" slider, and a Seller Profile's Listings/Sold grid.
       Tapping a listing from the main feed and hitting Back incorrectly
       dropped the buyer onto an unrelated seller's profile instead of
       back where they were browsing). Set at open-time by whichever
       click handler opened the page; read by the back button below. */
    var _listingDetailOrigin = 'marketplace';

    function _checkSellerVerified(uid, cb) {
        if (!uid) { cb(false); return; }
        if (_verifiedCache.hasOwnProperty(uid)) { cb(_verifiedCache[uid]); return; }
        var db = _fbDb();
        if (!db) { cb(false); return; }
        db.collection('users').doc(uid).get()
            .then(function (doc) {
                var v = !!(doc.exists && doc.data() && doc.data().isVerified);
                _verifiedCache[uid] = v;
                cb(v);
            })
            .catch(function () { cb(false); });
    }

    function _ensureSellerBadge(card) {
        if (!card) return;
        var sellerId = card.dataset.sellerId;
        var handleEl = card.querySelector('.property-seller-info strong');
        if (!handleEl) return;
        handleEl.classList.add('mkt-seller-name-clickable');
        if (!sellerId) return; /* app-marketplace.js's own resolver will fill this in; observer retries */
        if (handleEl._mktBadgeDone === sellerId) return;
        handleEl._mktBadgeDone = sellerId;
        _checkSellerVerified(sellerId, function (isVerified) {
            var existing = handleEl.parentNode.querySelector('.mkt-seller-verified-badge');
            if (existing) existing.remove();
            if (isVerified) {
                var badge = document.createElement('i');
                badge.className = 'fas fa-check-circle mkt-seller-verified-badge';
                badge.title = 'Verified Seller';
                handleEl.insertAdjacentElement('afterend', badge);
            }
        });
    }

    function _sweepBadges() {
        document.querySelectorAll('#property-grid-container .property-card, #marketplace .property-card').forEach(_ensureSellerBadge);
    }

    /* =========================================================================
       §STARS  Display + interactive picker.
       ========================================================================= */
    function _starsHTML(avg) {
        avg = Math.max(0, Math.min(5, avg || 0));
        var full = Math.floor(avg);
        var half = (avg - full) >= 0.5;
        var html = '';
        for (var i = 0; i < full; i++) html += '<i class="fas fa-star"></i>';
        if (half) html += '<i class="fas fa-star-half-alt"></i>';
        for (var j = full + (half ? 1 : 0); j < 5; j++) html += '<i class="far fa-star"></i>';
        return html;
    }

    /* Local label map for the Listing Detail page's step-by-step spec
       list — mirrors app-marketplace.js's own MKT_SPEC_LABELS (not
       exposed on window), duplicated here per this file's existing
       "each module stays self-contained" convention rather than reaching
       into that module's internals. */
    var _DETAIL_SPEC_LABELS = {
        condition: 'Condition', brand: 'Brand', model: 'Model', year: 'Year', transmission: 'Transmission',
        vtype: 'Type', engine: 'Engine', mileage: 'Mileage', color: 'Color', features: 'Features',
        ptype: 'Property Type', purpose: 'Purpose', size: 'Size', ownership: 'Ownership',
        bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', amenities: 'Amenities',
        itemType: 'Item Type', specs: 'Specs', warranty: 'Warranty',
        serviceType: 'Service Type', experience: 'Experience'
    };
    function _mktDetailSpecsHTML(categoryFields) {
        if (!categoryFields) return '';
        var shown = Object.keys(_DETAIL_SPEC_LABELS).filter(function (k) { return categoryFields[k]; });
        if (!shown.length) return '';
        return '<div class="mkt-listing-detail-specs">' + shown.map(function (k, i) {
            return '<div class="mkt-listing-detail-spec-row">' +
                '<span class="mlds-step">' + (i + 1) + '</span>' +
                '<span class="mlds-label">' + _DETAIL_SPEC_LABELS[k] + '</span>' +
                '<span class="mlds-value">' + _esc(String(categoryFields[k]).slice(0, 120)) + '</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    /* Converts a stored phone number into a tappable wa.me WhatsApp link.
       Strips everything but digits; a leading local "0" (Nigerian local
       format, e.g. "080...") is swapped for the "234" country code since
       this is a Nigerian platform — a number already given with a country
       code (e.g. "234..." or "+234...") passes through unchanged. */
    function _waLink(phone) {
        var digits = String(phone || '').replace(/\D/g, '');
        if (!digits) return '';
        if (digits.charAt(0) === '0') digits = '234' + digits.slice(1);
        return 'https://wa.me/' + digits;
    }

    /* Converts a stored phone number into a plain tel: dialer link — used
       by the "Call" button (request — Communication Adjustments,
       2026-08-09) instead of opening the in-app chat overlay. */
    function _telLink(phone) {
        var digits = String(phone || '').replace(/[^\d+]/g, '');
        return digits ? 'tel:' + digits : '';
    }

    /* =========================================================================
       §DATA  Listings + reviews for a given seller.
       ========================================================================= */
    function _fetchSellerListings(sellerId, cb) {
        var db = _fbDb();
        if (!db) { cb([], []); return; }
        db.collection('marketplace_listings').where('sellerId', '==', sellerId).limit(60).get()
            .then(function (snap) {
                var all = snap.docs.map(function (d) { return d.data(); });
                var active = all.filter(function (it) { return (it.status || 'active') === 'active'; });
                var sold = all.filter(function (it) { return it.status === 'sold'; });
                cb(active, sold);
            })
            .catch(function () { cb([], []); });
    }

    function _fetchSellerReviews(sellerId, cb) {
        var db = _fbDb();
        if (!db) { cb([], 0, 0); return; }
        db.collection('marketplace_reviews').where('sellerId', '==', sellerId).get()
            .then(function (snap) {
                var reviews = snap.docs.map(function (d) { return d.data(); });
                reviews.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
                var sum = reviews.reduce(function (acc, r) { return acc + (parseFloat(r.rating) || 0); }, 0);
                var avg = reviews.length ? (sum / reviews.length) : 0;
                cb(reviews, avg, reviews.length);
            })
            .catch(function () { cb([], 0, 0); });
    }

    // Own-profile only — pulls BOTH sides of escrow orders for this user:
    // purchases they made (buyerId match) and sales they're fulfilling
    // (sellerId match). Written by server.js's /api/marketplace/order/*
    // routes into the marketplace_orders collection (see that file for
    // the status lifecycle: paid -> dispatched -> released).
    function _fetchMyOrders(uid, cb) {
        var db = _fbDb();
        if (!db || !uid) { cb([], []); return; }
        function _sortDesc(arr) {
            arr.sort(function (a, b) {
                var at = (a.createdAt && a.createdAt.toMillis) ? a.createdAt.toMillis() : 0;
                var bt = (b.createdAt && b.createdAt.toMillis) ? b.createdAt.toMillis() : 0;
                return bt - at;
            });
            return arr;
        }
        Promise.all([
            db.collection('marketplace_orders').where('buyerId', '==', uid).get().catch(function () { return { docs: [] }; }),
            db.collection('marketplace_orders').where('sellerId', '==', uid).get().catch(function () { return { docs: [] }; })
        ]).then(function (results) {
            var purchases = results[0].docs.map(function (dsnap) { var o = dsnap.data() || {}; o.id = dsnap.id; return o; });
            var sales     = results[1].docs.map(function (dsnap) { var o = dsnap.data() || {}; o.id = dsnap.id; return o; });
            cb(_sortDesc(purchases), _sortDesc(sales));
        }).catch(function () { cb([], []); });
    }

    /* =========================================================================
       §SELLER PROFILE PAGE  (#seller-profile-page)
       ========================================================================= */
    function _switchSellerTab(pane) {
        document.querySelectorAll('.mkt-seller-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.pane === pane); });
        document.querySelectorAll('.mkt-seller-pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === pane); });
    }

    function _openSellerProfile(sellerId) {
        if (!sellerId) { _notify('Could not find this seller — try again in a moment.', 'error'); return; }
        _goTo('seller-profile-page');
        var body = document.getElementById('seller-profile-page-body');
        if (body) body.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--color-neutral-600);"><i class="fas fa-spinner fa-spin"></i> Loading seller profile…</div>';

        var db = _fbDb();
        if (!db) return;

        db.collection('users').doc(sellerId).get().then(function (doc) {
            var u = doc.exists ? (doc.data() || {}) : {};
            _userDocCache[sellerId] = u;
            var isOwn = _us().id && _us().id === sellerId;

            if (u.banned && !_isAdmin()) {
                var b = document.getElementById('seller-profile-page-body');
                if (b) {
                    b.innerHTML = isOwn
                        ? '<p style="text-align:center;color:var(--color-neutral-600);padding:40px 20px;"><i class="fas fa-exclamation-circle" style="font-size:1.6rem;display:block;margin-bottom:10px;"></i>Your account access is currently restricted. Contact support for more information.</p>'
                        : '<p style="text-align:center;color:var(--color-neutral-600);padding:40px 20px;"><i class="fas fa-user-slash" style="font-size:1.6rem;display:block;margin-bottom:10px;"></i>This seller profile is currently unavailable.</p>';
                }
                return;
            }

            var name   = u.fullName || u.username || 'Seller';
            var handle = u.username || '';
            var avatar = u.avatar || 'https://source.unsplash.com/random/150x150/?avatar';
            var isVerified = !!u.isVerified;
            _verifiedCache[sellerId] = isVerified;
            /* FIX (2026-08-09 — Marketplace Adjustments #6/#7): a seller's
               general account name is now private to the account owner —
               visitors see the business identity instead. companyName/
               directPhone/whatsappNumber are new, optional profile fields
               (edited from this same page, own-profile only — see the
               "Edit" affordances further down); falling back to the
               existing generic 'phone' field for whatsappNumber keeps
               older accounts (saved before this split existed) working
               exactly as before instead of suddenly losing their WhatsApp
               contact row. */
            var companyName    = u.companyName || '';
            var directPhone    = u.directPhone || '';
            var whatsappNumber = u.whatsappNumber || u.phone || '';

            _fetchSellerListings(sellerId, function (listings, soldListings) {
                _fetchSellerReviews(sellerId, function (reviews, avg, count) {
                    /* The account-level 'phone' field is optional at signup and
                       often left blank. Every listing, on the other hand,
                       requires a contact phone at posting time (contactPhone,
                       from #item-seller-phone) — fall back to the most recent
                       listing's number so buyers still see a working WhatsApp
                       contact instead of the row silently disappearing. */
                    var phone = whatsappNumber;
                    if (!phone) {
                        var withPhone = (listings || []).concat(soldListings || []).filter(function (it) { return it.contactPhone; });
                        if (withPhone.length) phone = withPhone[0].contactPhone;
                    }
                    var directPhoneOut = directPhone || phone; /* Direct Phone column falls back to the same number when the seller hasn't set a distinct one yet */
                    // Orders pane is own-profile only — skip the extra
                    // Firestore reads entirely when viewing someone else's
                    // profile (isOwn is already known at this point).
                    function _withOrders(purchases, sales) {
                        _renderSellerProfilePage({
                            sellerId: sellerId, name: name, handle: handle, avatar: avatar,
                            isVerified: isVerified, isOwn: isOwn,
                            listings: listings, soldListings: soldListings || [],
                            reviews: reviews, avg: avg, count: count,
                            sellerVerificationStatus: u.sellerVerificationStatus || '',
                            email: u.email || '', phone: phone,
                            companyName: companyName, directPhone: directPhoneOut, whatsappNumber: phone,
                            myPurchases: purchases || [], mySales: sales || [],
                            // Real naira earnings, credited server-side into
                            // fiatBalance.NGN by /api/marketplace/order/:id/
                            // confirm-receipt when a sale is released (see the
                            // creditLine comment in _saleRowHTML below). Own-
                            // profile only matters here — other viewers never
                            // see this block regardless of what's passed.
                            fiatBalanceNGN: Number((u.fiatBalance && u.fiatBalance.NGN) || 0)
                        });
                    }
                    if (isOwn) _fetchMyOrders(sellerId, _withOrders);
                    else _withOrders([], []);
                });
            });
        }).catch(function () {
            var b = document.getElementById('seller-profile-page-body');
            if (b) b.innerHTML = '<p style="text-align:center;color:var(--danger-color);padding:30px 0;">Could not load this seller profile. Please try again.</p>';
        });
    }
    window._openSellerProfile = _openSellerProfile;

    function _renderSellerProfilePage(d) {
        var body = document.getElementById('seller-profile-page-body');
        if (!body) return;

        var listingsHTML = d.listings.length ? d.listings.map(function (item) {
            var syms = { NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', EMPY: 'EMPY ', USDT: 'USDT ' };
            var sym = syms[item.currency] || '$';
            var priceStr = sym + parseFloat(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
            var thumb = (item.media && item.media[0]) || '';
            if (item.id) _listingDetailCache[item.id] = item;
            return '<div class="mkt-seller-mini-card" data-listing-id="' + _esc(item.id || '') + '">' +
                (thumb ? '<img src="' + _esc(thumb) + '" alt="' + _esc(item.name || '') + '" loading="lazy">' : '<div style="height:100px;background:linear-gradient(135deg,#1B2B8B,#0A0E27);"></div>') +
                '<div class="mmc-body"><div class="mmc-name">' + _esc(item.name || 'Item') + '</div><div class="mmc-price">' + priceStr + '</div></div>' +
                '</div>';
        }).join('') : '<p style="color:var(--color-neutral-600);font-size:0.88rem;">No active listings yet.</p>';

        var soldHTML = (d.soldListings && d.soldListings.length) ? d.soldListings.map(function (item) {
            var syms = { NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', EMPY: 'EMPY ', USDT: 'USDT ' };
            var sym = syms[item.currency] || '$';
            var priceStr = sym + parseFloat(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
            var thumb = (item.media && item.media[0]) || '';
            if (item.id) _listingDetailCache[item.id] = item;
            return '<div class="mkt-seller-mini-card" style="opacity:0.72;position:relative;" data-listing-id="' + _esc(item.id || '') + '">' +
                '<span style="position:absolute;top:6px;left:6px;background:rgba(10,14,39,0.75);color:#fff;font-size:0.65rem;font-weight:800;padding:2px 8px;border-radius:20px;letter-spacing:0.04em;">SOLD</span>' +
                (thumb ? '<img src="' + _esc(thumb) + '" alt="' + _esc(item.name || '') + '" loading="lazy">' : '<div style="height:100px;background:linear-gradient(135deg,#1B2B8B,#0A0E27);"></div>') +
                '<div class="mmc-body"><div class="mmc-name">' + _esc(item.name || 'Item') + '</div><div class="mmc-price">' + priceStr + '</div></div>' +
                '</div>';
        }).join('') : '<p style="color:var(--color-neutral-600);font-size:0.88rem;">No sold items yet.</p>';

        var reviewsHTML = d.reviews.length ? d.reviews.map(function (r) {
            return '<div class="mkt-review-card">' +
                '<div class="mkt-review-head"><span class="mkt-review-author">' + _esc(r.buyerName || 'Buyer') + '</span>' +
                '<span class="mkt-review-date">' + (r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '') + '</span></div>' +
                '<div class="mkt-stars">' + _starsHTML(r.rating) + '</div>' +
                (r.comment ? '<div class="mkt-review-comment">' + _esc(r.comment) + '</div>' : '') +
                '</div>';
        }).join('') : '<p style="color:var(--color-neutral-600);font-size:0.88rem;">No reviews yet.</p>';

        var reviewFormHTML = d.isOwn ? '' :
            '<div class="mkt-review-form" id="mkt-review-form">' +
                '<label style="font-weight:700;font-size:0.85rem;color:var(--primary);">Leave a review</label>' +
                '<div class="mkt-star-picker" id="mkt-star-picker" data-value="0">' +
                    [1, 2, 3, 4, 5].map(function (n) { return '<i class="fas fa-star" data-star="' + n + '"></i>'; }).join('') +
                '</div>' +
                '<textarea id="mkt-review-comment" placeholder="How was your experience with this seller?"></textarea>' +
                '<button type="button" class="btn btn-accent" id="mkt-review-submit" style="margin-top:10px;">Submit Review</button>' +
            '</div>';

        // Orders pane — own-profile only. Two subsections: purchases this
        // user made (buyer side — Confirm Receipt) and sales they're
        // fulfilling (seller side — Mark as Dispatched). Status label/badge
        // and which action button (if any) shows are driven entirely by
        // each order's current `status` field (paid -> dispatched ->
        // released), written server-side by /api/marketplace/order/*.
        var CURRENCY_SYMS = { NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', EMPY: 'EMPY ', USDT: 'USDT ' };
        function _orderPriceStr(amount, currency) {
            var sym = CURRENCY_SYMS[currency] || '$';
            return sym + parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
        function _statusLabel(status) {
            if (status === 'released') return 'Released';
            if (status === 'dispatched') return 'Dispatched';
            return 'Paid — Awaiting Dispatch';
        }
        function _purchaseRowHTML(o) {
            var actionHTML = o.status === 'released'
                ? ''
                : '<button type="button" class="mkt-order-action-btn" data-confirm-receipt="' + _esc(o.id) + '">Confirm Receipt</button>';
            return '<div class="mkt-order-row">' +
                '<div class="mkt-order-info">' +
                    '<div class="mkt-order-title">' + _esc(o.productTitle || 'Item') + '</div>' +
                    '<div class="mkt-order-meta">' + _orderPriceStr(o.amount, o.currency) + '</div>' +
                    '<span class="mkt-order-status status-' + _esc(o.status || 'paid') + '">' + _statusLabel(o.status) + '</span>' +
                '</div>' + actionHTML +
            '</div>';
        }
        function _saleRowHTML(o) {
            var actionHTML = o.status === 'paid'
                ? '<button type="button" class="mkt-order-action-btn" data-mark-dispatched="' + _esc(o.id) + '">Mark Dispatched</button>'
                : '';
            // creditedAmount / creditedCurrency / creditFailed are written
            // by the server in the SAME transaction that flips status ->
            // 'released' (see server.js's /api/marketplace/order/:id/
            // confirm-receipt) — already present on this order doc by the
            // time it's released. The seller is credited in the SAME
            // currency the buyer paid: fiat stays fiat (fiatBalance.<CUR>),
            // EMPY only if the order itself was priced/paid in EMPY.
            var creditLine = '';
            if (o.status === 'released') {
                if (o.creditFailed) {
                    creditLine = '<div class="mkt-order-meta" style="color:#B3261E;">⚠ Auto-credit failed — contact support for manual review.</div>';
                } else if (typeof o.creditedAmount === 'number' && o.creditedCurrency) {
                    creditLine = '<div class="mkt-order-meta">+' + _orderPriceStr(o.creditedAmount, o.creditedCurrency) + ' credited</div>';
                }
            }
            return '<div class="mkt-order-row">' +
                '<div class="mkt-order-info">' +
                    '<div class="mkt-order-title">' + _esc(o.productTitle || 'Item') + '</div>' +
                    '<div class="mkt-order-meta">' + _orderPriceStr(o.amount, o.currency) + ' — Buyer: ' + _esc(o.buyerName || 'Buyer') + '</div>' +
                    creditLine +
                    '<span class="mkt-order-status status-' + _esc(o.status || 'paid') + '">' + _statusLabel(o.status) + '</span>' +
                '</div>' + actionHTML +
            '</div>';
        }
        // Naira Earnings block — own-profile only. Shows the seller's real,
        // withdrawable fiatBalance.NGN (credited by /api/marketplace/order/
        // :id/confirm-receipt on each released sale) and a button that opens
        // the Withdraw to Bank modal (see _openNairaWithdrawModal below).
        var earningsHTML = '';
        if (d.isOwn) {
            var bal = Number(d.fiatBalanceNGN || 0);
            var canWithdraw = bal >= MKT_NGN_WITHDRAW_MIN;
            earningsHTML =
                '<div class="mkt-earnings-block">' +
                    '<div class="mkt-earnings-label">Naira Earnings</div>' +
                    '<div class="mkt-earnings-amount">' + _orderPriceStr(bal, 'NGN') + '</div>' +
                    '<button type="button" class="mkt-withdraw-btn" id="mkt-withdraw-open-btn"' + (canWithdraw ? '' : ' disabled') + '>' +
                        '<i class="fas fa-university"></i> Withdraw to Bank' +
                    '</button>' +
                    (canWithdraw ? '' : '<div class="mkt-earnings-min-note">Minimum withdrawal is ' + _orderPriceStr(MKT_NGN_WITHDRAW_MIN, 'NGN') + '.</div>') +
                '</div>';
        }

        var ordersHTML = d.isOwn ?
            earningsHTML +
            '<div class="mkt-orders-subhead">My Purchases</div>' +
            (d.myPurchases && d.myPurchases.length ? d.myPurchases.map(_purchaseRowHTML).join('') : '<p style="color:var(--color-neutral-600);font-size:0.88rem;">No purchases yet.</p>') +
            '<div class="mkt-orders-subhead">My Sales</div>' +
            (d.mySales && d.mySales.length ? d.mySales.map(_saleRowHTML).join('') : '<p style="color:var(--color-neutral-600);font-size:0.88rem;">No sales yet.</p>')
            : '';

        /* Own-profile verification block: status only here — the actual
           form now lives on its own page (#seller-kyc-page), reached by
           swiping left on the Marketplace or tapping the CTA below. */
        var verifyHTML = '';
        if (d.isOwn) {
            if (d.isVerified) {
                verifyHTML = '<div class="mkt-verify-block"><div class="mkt-verify-status is-verified"><i class="fas fa-check-circle"></i> You\'re a Verified Seller</div></div>';
            } else if (d.sellerVerificationStatus === 'pending') {
                verifyHTML = '<div class="mkt-verify-block"><div class="mkt-verify-status is-pending"><i class="fas fa-hourglass-half"></i> Verification submitted — under review</div></div>';
            } else {
                verifyHTML =
                    '<div class="mkt-verify-block">' +
                        '<p style="font-size:0.87rem;color:var(--color-neutral-700);margin-bottom:10px;">You\'re not verified yet. Verified sellers get a checkmark badge buyers can trust.</p>' +
                        '<button type="button" class="mkt-verify-cta" id="mkt-goto-kyc-btn"><i class="fas fa-shield-alt"></i> Get Verified</button>' +
                    '</div>';
            }
        }

        /* FIX (2026-08-09 — Marketplace Adjustments, phone-column cleanup):
           the profile used to show FOUR phone numbers — this same Direct
           Phone Number + WhatsApp Number pair twice over: once as editable
           rows in businessInfoHTML right below the header (the "top two",
           now removed), and again as tappable contact-link icons here.
           That's now trimmed to the two that are actually needed — one
           Call icon, one WhatsApp icon — plus a third contact column, a
           direct link into the account's own Empyrean messages inbox (the
           general 1:1 chat, window.openChat — NOT the separate
           marketplace-listing chat, which stays on its own "Contact
           Seller" flow per listing; see app-marketplace.js's
           _openMarketChatOverlay for that one). Editing directPhone /
           whatsappNumber moved down onto these same two icons (own-profile
           only, small pencil button, same data-edit-field/data-edit-label
           + .mkt-seller-business-edit-btn convention the Company Name row
           already uses below, so the existing delegated click handler
           just below picks these up with no new wiring) rather than
           living in a separate duplicate row above. */
        var directPhoneEditBtn = d.isOwn
            ? '<button type="button" class="mkt-seller-business-edit-btn mkt-seller-contact-edit-btn" data-edit-field="directPhone" data-edit-label="Direct Phone Number"><i class="fas fa-pen"></i></button>'
            : '';
        var whatsappEditBtn = d.isOwn
            ? '<button type="button" class="mkt-seller-business-edit-btn mkt-seller-contact-edit-btn" data-edit-field="whatsappNumber" data-edit-label="WhatsApp Number"><i class="fas fa-pen"></i></button>'
            : '';
        var directPhoneHTML = (d.directPhone || d.isOwn)
            ? '<span class="mkt-seller-contact-item mkt-seller-contact-tel-wrap">' +
                (d.directPhone
                    ? '<a href="' + _esc(_telLink(d.directPhone)) + '" class="mkt-seller-contact-tel"><i class="fas fa-phone"></i> ' + _esc(d.directPhone) + '</a>'
                    : '<span class="mkt-seller-contact-tel mkt-seller-contact-unset"><i class="fas fa-phone"></i> <em>Not set</em></span>') +
                directPhoneEditBtn +
              '</span>'
            : '';
        var whatsappHTML = (d.whatsappNumber || d.isOwn)
            ? '<span class="mkt-seller-contact-item mkt-seller-contact-whatsapp-wrap">' +
                (d.whatsappNumber
                    ? '<a href="' + _esc(_waLink(d.whatsappNumber)) + '" target="_blank" rel="noopener" class="mkt-seller-contact-whatsapp">' + _WA_ICON_SVG + ' ' + _esc(d.whatsappNumber) + '</a>'
                    : '<span class="mkt-seller-contact-whatsapp mkt-seller-contact-unset">' + _WA_ICON_SVG + ' <em>Not set</em></span>') +
                whatsappEditBtn +
              '</span>'
            : '';
        /* New third column — direct Empyrean messages inbox. Own-profile
           view has no one to message (that's just yourself), so this only
           renders for a visitor looking at someone else's profile, same
           gating every other contact-only affordance on this page uses.
           FIX (2026-08-09 — "the 1:1 Empyrean inbox chat should include
           the Empyrean logo"): was a generic fa-comment-alt speech-bubble
           icon — swapped for the app's own logo (the same /logo.png this
           app already serves at its root for the favicon/push-notification
           icon, so this is an existing asset, not a new file) so the
           button visibly reads as "message them on Empyrean" rather than
           a generic chat icon. onerror falls back to the original speech-
           bubble icon so a missing/renamed logo asset never leaves the
           button showing a broken image. */
        var directMsgHTML = (!d.isOwn && d.sellerId)
            ? '<a href="javascript:void(0)" class="mkt-seller-contact-item mkt-seller-contact-msg" id="mkt-seller-direct-msg-btn" data-seller-id="' + _esc(d.sellerId) + '">'
                + '<img src="/logo.png" alt="Empyrean" class="mkt-seller-msg-logo" onerror="this.outerHTML=\'<i class=&quot;fas fa-comment-alt&quot;></i>\';"> Message</a>'
            : '';
        var contactRows = [];
        if (d.email) contactRows.push('<a href="mailto:' + _esc(d.email) + '" class="mkt-seller-contact-item"><i class="fas fa-envelope"></i> ' + _esc(d.email) + '</a>');
        if (directPhoneHTML || whatsappHTML || directMsgHTML) {
            contactRows.push('<div class="mkt-seller-phone-row">' + directPhoneHTML + whatsappHTML + directMsgHTML + '</div>');
        }
        var contactHTML = contactRows.length ? '<div class="mkt-seller-contact-row">' + contactRows.join('') + '</div>' : '';

        /* Own-profile-only editable business-info block: Company Name
           only now — Direct Phone Number / WhatsApp Number used to have
           their own duplicate editable rows here too (the "first two at
           the top" of the old four-number layout, removed per this
           session's request). Editing those two numbers still works
           exactly as before (same prompt()-driven flow, same Firestore
           write), just from the pencil buttons on the contact-icon row
           above now instead of a separate row here. */
        var businessInfoHTML = d.isOwn
            ? '<div class="mkt-seller-business-info">' +
                '<div class="mkt-seller-business-row"><span class="mkt-seller-business-label">Company Name</span>' +
                    '<span class="mkt-seller-business-value">' + (d.companyName ? _esc(d.companyName) : '<em>Not set</em>') + '</span>' +
                    '<button type="button" class="mkt-seller-business-edit-btn" data-edit-field="companyName" data-edit-label="Company Name"><i class="fas fa-pen"></i></button></div>' +
              '</div>'
            : '';

        /* FIX (request — "add edit profile button" to the Marketplace
           Seller Profile page): own-profile only, same nav-link/data-
           target convention app-profile.js's main Profile page header
           already uses for its own "Edit Profile" button — a document-
           level delegated click handler (app-fixes.js) already routes any
           `.nav-link[data-target]` to navigateTo(), so this needs no new
           wiring here, just the button markup. Takes the seller to the
           same Settings > Profile screen used everywhere else in the app,
           rather than duplicating a second profile-edit form scoped to
           Marketplace. */
        var editProfileBtnHTML = d.isOwn
            ? '<button type="button" class="btn btn-small nav-link mkt-seller-edit-profile-btn" data-target="settings"><i class="fas fa-edit"></i> Edit Profile</button>'
            : '';

        /* Header name: the account owner still sees their own real name
           (and can still get there via Edit Profile) — a visitor sees the
           Company Name instead, so the general profile name never leaks
           to buyers browsing listings. */
        var headerDisplayName = d.isOwn ? d.name : (d.companyName || 'Seller');

        body.innerHTML =
            '<div class="mkt-seller-header">' +
                '<img class="mkt-seller-avatar" src="' + _esc(d.avatar) + '" alt="' + _esc(headerDisplayName) + '">' +
                '<div class="mkt-seller-header-info">' +
                    '<div class="mkt-seller-name-row">' + _esc(headerDisplayName) + (d.isVerified ? ' <i class="fas fa-check-circle mkt-seller-verified-badge" title="Verified Seller"></i>' : '') + '</div>' +
                    (d.isOwn && d.handle ? '<div class="mkt-seller-username">@' + _esc(d.handle) + '</div>' : '') +
                '</div>' +
                editProfileBtnHTML +
            '</div>' +
            businessInfoHTML +
            contactHTML +
            '<div class="mkt-rating-summary">' +
                '<span class="mkt-rating-avg">' + d.avg.toFixed(1) + '</span>' +
                '<span class="mkt-stars">' + _starsHTML(d.avg) + '</span>' +
                '<span class="mkt-rating-count">(' + d.count + ' review' + (d.count === 1 ? '' : 's') + ')</span>' +
            '</div>' +
            '<div class="mkt-seller-tabs">' +
                '<div class="mkt-seller-tab active" data-pane="listings">Listings</div>' +
                '<div class="mkt-seller-tab" data-pane="sold">Sold</div>' +
                '<div class="mkt-seller-tab" data-pane="reviews">Reviews</div>' +
                (d.isOwn ? '<div class="mkt-seller-tab" data-pane="orders">Orders</div>' : '') +
            '</div>' +
            '<div class="mkt-seller-pane active" data-pane="listings"><div class="mkt-seller-listings-grid">' + listingsHTML + '</div></div>' +
            '<div class="mkt-seller-pane" data-pane="sold"><div class="mkt-seller-listings-grid">' + soldHTML + '</div></div>' +
            '<div class="mkt-seller-pane" data-pane="reviews">' + reviewsHTML + reviewFormHTML + '</div>' +
            (d.isOwn ? '<div class="mkt-seller-pane" data-pane="orders">' + ordersHTML + '</div>' : '') +
            verifyHTML +
            (d.isOwn ? '' : '<div style="margin-top:18px;text-align:right;"><a href="javascript:void(0)" id="mkt-report-seller-link" style="font-size:0.76rem;color:var(--color-neutral-500);text-decoration:underline;">Report this seller</a></div>');

        /* Wire tabs */
        body.querySelectorAll('.mkt-seller-tab').forEach(function (tab) {
            tab.addEventListener('click', function () { _switchSellerTab(tab.dataset.pane); });
        });

        /* Wire Orders pane action buttons (own-profile only — the buttons
           only ever render when d.isOwn, but the delegated listener itself
           is harmless to attach unconditionally). Re-opens this same
           profile on success to refresh both the order list and, for a
           release, the "Sold" tab / rating summary elsewhere on the page —
           same "just re-run _openSellerProfile" refresh pattern already
           used after submitting a review, just below.
           GUARD: `body` (#seller-profile-page-body) is a persistent element
           that only has its innerHTML replaced on each render — attaching
           this listener unconditionally on every render would stack a new
           one each time the profile is opened, firing the same click
           handler multiple times (the exact duplicate-listener failure
           mode this codebase has already hit before — see
           app-patch-v39.js's header). body._ordersDelegationWired makes
           this idempotent, same convention used elsewhere in this app. */
        if (!body._ordersDelegationWired) {
            body._ordersDelegationWired = true;
            body.addEventListener('click', function (e) {
                /* Own-profile business-info edit (Company Name / Direct
                   Phone Number / WhatsApp Number) — see #6/#7 above. Simple
                   prompt()-driven edit, writes straight to users/{uid}. */
                var bizEditBtn = e.target.closest('.mkt-seller-business-edit-btn');
                if (bizEditBtn) {
                    var field = bizEditBtn.getAttribute('data-edit-field');
                    var label = bizEditBtn.getAttribute('data-edit-label') || field;
                    var current = (_userDocCache[d.sellerId] || {})[field] || '';
                    var next = window.prompt('Set your ' + label + ':', current);
                    if (next === null) return; /* cancelled */
                    next = next.trim();
                    var db = _fbDb();
                    if (!db) { _notify('Could not save — check your connection.', 'error'); return; }
                    var payload = {}; payload[field] = next;
                    db.collection('users').doc(d.sellerId).set(payload, { merge: true })
                        .then(function () {
                            _notify(label + ' updated.', 'success');
                            _openSellerProfile(d.sellerId); /* refresh so the new value renders everywhere it's used */
                        })
                        .catch(function (err) { _notify('Could not save: ' + (err && err.message || 'try again.'), 'error'); });
                    return;
                }
                var confirmBtn = e.target.closest('[data-confirm-receipt]');
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    if (typeof window._empMktConfirmReceipt === 'function') {
                        window._empMktConfirmReceipt(confirmBtn.getAttribute('data-confirm-receipt')).then(function (ok) {
                            if (ok) _openSellerProfile(d.sellerId); else confirmBtn.disabled = false;
                        });
                    }
                    return;
                }
                var dispatchBtn = e.target.closest('[data-mark-dispatched]');
                if (dispatchBtn) {
                    dispatchBtn.disabled = true;
                    if (typeof window._empMktMarkDispatched === 'function') {
                        window._empMktMarkDispatched(dispatchBtn.getAttribute('data-mark-dispatched')).then(function (ok) {
                            if (ok) _openSellerProfile(d.sellerId); else dispatchBtn.disabled = false;
                        });
                    }
                    return;
                }
                var withdrawBtn = e.target.closest('#mkt-withdraw-open-btn');
                if (withdrawBtn && !withdrawBtn.disabled) {
                    _openNairaWithdrawModal(d);
                }
            });
        }

        /* Wire listing-thumbnail click: navigate to the full-page Listing
           Detail screen (its own step, own URL, no reload — same pattern as
           the Seller Profile page itself) instead of popping open a small
           gallery modal over the current page. */
        body.querySelectorAll('.mkt-seller-mini-card').forEach(function (mc) {
            mc.addEventListener('click', function () {
                _listingDetailOrigin = 'seller-profile-page';
                _openListingDetailPage(mc.dataset.listingId);
            });
        });

        /* Wire avatar click: open a bio/stats panel with whatever
           registration info this seller has on file. */
        var avatarEl = body.querySelector('.mkt-seller-avatar');
        if (avatarEl) avatarEl.addEventListener('click', function () { _openSellerBioModal(d); });

        if (!d.isOwn) _wireReviewForm(d.sellerId);

        /* FIX (request — Marketplace Communication Adjustments, 2026-08-09):
           #mkt-seller-msg-btn is now a plain tel: <a> link (see msgBtnHTML
           above) — the browser's own dialer handles the tap, no JS wiring
           needed. Previous click handler (opened the in-app chat overlay)
           removed since there's no longer a "Message" affordance here. */

        /* Wire the new "Message" contact column (directMsgHTML above) —
           the account's general, 1:1 Empyrean messages inbox. Deliberately
           window.openChat(), NOT window._openMarketChatOverlay() — that
           second one is the separate, per-listing Marketplace chat used by
           the "Contact Seller" button on a listing card (see
           app-marketplace.js), and is intentionally left untouched here so
           the two inboxes never cross-write into each other. */
        var directMsgBtn = document.getElementById('mkt-seller-direct-msg-btn');
        if (directMsgBtn) {
            directMsgBtn.addEventListener('click', function () {
                if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                var targetId = directMsgBtn.getAttribute('data-seller-id');
                if (!targetId) return;
                if (typeof window.navigateTo === 'function') window.navigateTo('messages');
                setTimeout(function () {
                    var fn = window.openChatWith || window.openChat;
                    if (typeof fn === 'function') fn(targetId);
                    else _notify('Messaging isn\u2019t available right now.', 'error');
                }, 350);
            });
        }

        var kycBtn = document.getElementById('mkt-goto-kyc-btn');
        if (kycBtn) kycBtn.addEventListener('click', function () { _openSellerKycPage(); });

        var reportLink = document.getElementById('mkt-report-seller-link');
        if (reportLink) reportLink.addEventListener('click', function () {
            if (typeof window._empGovReportTarget === 'function') {
                window._empGovReportTarget('seller', d.sellerId, d.sellerId);
            } else {
                _notify('Reporting isn\'t available right now.', 'error');
            }
        });
    }

    /* =========================================================================
       §LISTING DETAIL PAGE  Full-page step opened by tapping ANY listing —
       the main Marketplace feed/grid, the Search results, or a Seller
       Profile's Listings/Sold grid — same "own page via navigateTo, no
       reload" pattern the Seller Profile page itself already uses.
       Reads from _listingDetailCache when available (instant transition
       from the Seller Profile page, which pre-populates it) and otherwise
       fetches the listing doc directly from Firestore, so a tap from the
       main feed (which was never routed here before) works the same way.
       Falls back to the small swipeable gallery for the photo itself when
       there's more than one image, since that's a genuinely different job
       (browsing photos of the one item you're already looking at) than
       navigating between listings.
       ========================================================================= */
    /* Back-fills blank Contact-card fields on the expanded listing from the
       seller's profile (users/<sellerId>), same priority the old feed-card
       panel used: listing contact* fields first, then profile fields. Then
       hides empty rows / shows the "no details" note if nothing exists. */
    function _mktFillDetailContact(item, owner) {
        var box = document.getElementById('mkt-ld-contact');
        if (!box || _isGuest()) return;
        var apply = function (nm, ph, em, ad) {
            var set = function (label, val, href) {
                var r = box.querySelector('[data-field="' + label + '"]'); if (!r) return;
                if (!val) return;
                r.style.display = '';
                var t = r.querySelector('a,b'); if (t) { t.textContent = val; if (href && t.tagName === 'A') t.setAttribute('href', href); }
            };
            set('Name', nm); set('Phone', ph, _telLink(ph)); set('Email', em, 'mailto:' + em); set('Address', ad);
            var call = box.querySelector('.mkt-ld-act-call'), wa = box.querySelector('.mkt-ld-act-wa'), ml = box.querySelector('.mkt-ld-act-mail');
            if (ph && call) { call.style.display = ''; call.setAttribute('href', _telLink(ph)); }
            if (ph && wa) { wa.style.display = ''; wa.setAttribute('href', _waLink(ph)); }
            if (em && ml) { ml.style.display = ''; ml.setAttribute('href', 'mailto:' + em); }
            var any = Array.prototype.some.call(box.querySelectorAll('.mkt-ld-contact-row'), function (r) { return r.style.display !== 'none'; });
            var empty = box.querySelector('.mkt-ld-contact-empty'); if (empty) empty.style.display = any ? 'none' : '';
        };
        var nm0 = item.contactName || '', ph0 = item.contactPhone || '', em0 = item.contactEmail || '', ad0 = item.contactAddress || '';
        apply(nm0, ph0, em0, ad0);
        var db = _fbDb();
        if (!db || !item.sellerId || (ph0 && em0 && nm0 && ad0)) return;
        db.collection('users').doc(item.sellerId).get().then(function (d) {
            var pd = d && d.exists ? d.data() : {};
            apply(nm0 || pd.fullName || pd.username || '',
                  ph0 || pd.directPhone || pd.phone || pd.contactPhone || pd.phoneNumber || '',
                  em0 || pd.email || pd.contactEmail || '',
                  ad0 || pd.address || '');
        }).catch(function () { /* contact card keeps whatever the listing itself had */ });
    }

    /* Job experience timeline — parses categoryFields.workHistory, one job
       per line as "Role | Company | Period | Note" (trailing parts optional). */
    function _mktExperienceHTML(raw) {
        var jobs = String(raw || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 12);
        if (!jobs.length) return '';
        return '<div class="mkt-ld-exp"><div class="mkt-ld-exp-head"><i class="fas fa-briefcase"></i> Job experience</div>' +
            jobs.map(function (line, i) {
                var p = line.split('|').map(function (x) { return x.trim(); });
                var co = [p[1], p[2]].filter(Boolean).join(' · ');
                return '<div class="mkt-ld-exp-item"><div class="mkt-ld-exp-rail"><span class="mkt-ld-exp-dot"></span>' +
                    (i < jobs.length - 1 ? '<span class="mkt-ld-exp-line"></span>' : '') + '</div>' +
                    '<div class="mkt-ld-exp-body"><p class="mkt-ld-exp-role">' + _esc(p[0] || '') + '</p>' +
                    (co ? '<p class="mkt-ld-exp-co">' + _esc(co) + '</p>' : '') +
                    (p[3] ? '<p class="mkt-ld-exp-note">' + _esc(p.slice(3).join(' | ')) + '</p>' : '') + '</div></div>';
            }).join('') + '</div>';
    }

    function _renderListingDetailPage(itemId, item) {
        var body = document.getElementById('mkt-listing-detail-body');
        if (!item || !body) { _notify('Could not load this listing — try again.', 'error'); return; }
        _listingDetailCache[itemId] = item;

        /* Uses replaceState (not pushState) here — app-nav.js's navigateTo()
           (called via _goTo() below) already pushes ITS OWN history entry
           for the section change to 'mkt-listing-detail-page' (see its
           "Hardware/browser Back button support" section). If this also
           pushed a separate entry, opening a listing would create TWO
           history entries for one tap, so a single Back press would only
           unwind this deep-link URL without visibly changing anything —
           the person would have to press Back twice to actually leave the
           listing. replaceState still keeps the shareable/bookmarkable
           deep-link URL (_mktBuildListingDeepLink) working exactly as
           before; it just folds into the ONE history entry navigateTo()
           creates a moment later instead of adding a second one. */
        try { history.replaceState({ mktListing: itemId }, '', _mktBuildListingDeepLink(itemId)); }
        catch (e) { /* replaceState can't fail in a way that should block the UI update below */ }

        var syms = { NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', EMPY: 'EMPY ', USDT: 'USDT ' };
        var sym = syms[item.currency] || '$';
        var priceStr = sym + parseFloat(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
        var media = item.media || [];
        var mainImg = media[0] || '';
        var thumbsHTML = media.length > 1 ? '<div class="mkt-listing-detail-thumbs">' +
            media.map(function (m, i) { return '<img src="' + _esc(m) + '" data-idx="' + i + '" class="' + (i === 0 ? 'active' : '') + '">'; }).join('') +
            '</div>' : '';

        /* Step-by-step spec list — same category field schema the Sell
           flow collects (Year/Brand/Model/Mileage for Vehicles, Bedrooms/
           Bathrooms for Properties, etc.), rendered as its own vertical
           row-per-field list on this page. The card-badge helper
           (window._mktQuickSpecsHTML) wraps everything into one inline
           chip row, which is fine for a compact card but doesn't read as
           a clear, step-by-step spec sheet on a full detail page — so
           this page gets its own row-list renderer instead (local label
           map, mirroring app-marketplace.js's own, per this file's
           existing self-contained-module convention). */
        var catBadge = (item.category && typeof window._mktCategoryBadgeHTML === 'function') ? window._mktCategoryBadgeHTML(item.category) : '';
        var specsHTML = _mktDetailSpecsHTML(item.categoryFields || {});

        // FIX (request — "redesign the card thumbnail... use the mockup
        // to improve the card"): Job Seeker / Professional Service / Job
        // Vacancy listings are people, not products with photos — the
        // full-width hero above rendered as an empty navy block for these
        // whenever there was no media (the exact "Listing Details" bug in
        // the screenshot). They now get the same compact navy/gold ID
        // card (medallion + name/role/price) the marketplace grid
        // thumbnail uses (see _mktAvatarIdCardHTML, app-marketplace.js),
        // in place of the hero + name + price block below. Every other
        // category keeps the existing hero-image treatment untouched.
        var isAvatarListing = (typeof window._mktIsAvatarCategory === 'function') && window._mktIsAvatarCategory(item.category);
        var idCardHTML = (isAvatarListing && typeof window._mktAvatarIdCardHTML === 'function') ? window._mktAvatarIdCardHTML(item, priceStr) : '';

        var us = _us();
        var isOwner = _isAdmin() || (us.id && item.sellerId && item.sellerId === us.id);
        // FIX (request — tailor wording for Job Seeking / Professional
        // Services listings instead of the generic "Seller"): same
        // _mktAvatarRoleLabel lookup app-marketplace.js and app-patch-v2.js
        // use for the grid card, applied here too for consistency.
        var _ldRoleLabel = (typeof window._mktAvatarRoleLabel === 'function') ? window._mktAvatarRoleLabel(item.category || '') : null;
        /* FIX (request — Marketplace Communication Adjustments, 2026-08-09):
           "Remove direct message inbox" / "Add direct phone call icon" —
           was a "Message <role>" button that opened the in-app chat
           overlay. Now a plain tel: "Call <role>" link, shown only when
           this listing has a contactPhone on file (direct-sale listings
           collect one; escrow listings and — as of the Vehicle & Truck
           section fix above — Vehicles do not, so no button renders for
           those, same graceful-degrade the WhatsApp icons elsewhere in
           this codebase already use). */
        /* FIX (request — "where is the contact information, transfer it to
           the expanded card"): the seller's contact details (name, phone,
           email, address) used to live only in the hidden
           .direct-contact-info panel on the feed card. They now live here,
           on the expanded Listing Details page, as one "Contact" card with
           Call / WhatsApp / Email quick actions. Fields come from the
           listing's own contact* data; anything missing is back-filled from
           the seller's profile after render (see _mktFillDetailContact). */
        function _ldContactCard(it, roleLabel, owner) {
            var nm = it.contactName || '', ph = it.contactPhone || '', em = it.contactEmail || '', ad = it.contactAddress || '';
            var role = roleLabel || 'Seller';
            var row = function (ico, label, val, href) {
                return '<div class="mkt-ld-contact-row" data-field="' + label + '"' + (val ? '' : ' style="display:none;"') + '>' +
                    '<span class="mkt-ld-contact-ico"><i class="fas ' + ico + '"></i></span>' +
                    '<span class="mkt-ld-contact-txt"><small>' + label + '</small>' +
                    (href ? '<a href="' + _esc(href) + '">' + _esc(val) + '</a>' : '<b>' + _esc(val) + '</b>') + '</span></div>';
            };
            var actions = '<div class="mkt-ld-contact-actions">' +
                '<a class="mkt-ld-act mkt-ld-act-call" id="mkt-listing-detail-msg-btn" href="' + _esc(_telLink(ph)) + '"' + (ph ? '' : ' style="display:none;"') + '><i class="fas fa-phone"></i> Call</a>' +
                '<a class="mkt-ld-act mkt-ld-act-wa" href="' + _esc(_waLink(ph)) + '" target="_blank" rel="noopener"' + (ph ? '' : ' style="display:none;"') + '><i class="fab fa-whatsapp"></i> WhatsApp</a>' +
                '<a class="mkt-ld-act mkt-ld-act-mail" href="mailto:' + _esc(em) + '"' + (em ? '' : ' style="display:none;"') + '><i class="fas fa-envelope"></i> Email</a>' +
            '</div>';
            if (_isGuest()) {
                return '<div class="mkt-ld-contact" id="mkt-ld-contact"><div class="mkt-ld-contact-head"><i class="fas fa-address-card"></i> Contact ' + _esc(role) + '</div>' +
                    '<button type="button" class="mkt-ld-login-btn" id="mkt-ld-login-btn"><i class="fas fa-lock"></i> Log in to view contact details</button></div>';
            }
            return '<div class="mkt-ld-contact" id="mkt-ld-contact" data-seller-id="' + _esc(it.sellerId || '') + '">' +
                '<div class="mkt-ld-contact-head"><i class="fas fa-address-card"></i> Contact ' + _esc(role) + (owner ? ' <span class="mkt-ld-you">Your listing</span>' : '') + '</div>' +
                row('fa-user', 'Name', nm) + row('fa-phone', 'Phone', ph, ph ? _telLink(ph) : '') +
                row('fa-envelope', 'Email', em, em ? 'mailto:' + em : '') + row('fa-map-marker-alt', 'Address', ad) +
                '<p class="mkt-ld-contact-empty" style="display:none;">No contact details posted for this listing.</p>' +
                (owner ? '' : actions) + '</div>';
        }
        /* Scope (request — "only for job seekers and professional service
           rendering"): the Contact card + Job experience appear only on those
           two categories. Every other category keeps its original single
           "Call <role>" button exactly as before. */
        var _ldIsPeople = (item.category === 'jobseeking' || item.category === 'professional');
        var contactBtn = _ldIsPeople
            ? _ldContactCard(item, _ldRoleLabel, isOwner)
            : ((!isOwner && item.sellerId && item.contactPhone)
                ? '<a href="' + _esc(_telLink(item.contactPhone)) + '" class="btn mkt-msg-seller-btn" id="mkt-listing-detail-msg-btn" style="margin-top:14px;width:100%;justify-content:center;text-decoration:none;"><i class="fas fa-phone"></i> Call ' + _esc(_ldRoleLabel || 'Seller') + '</a>'
                : '');
        var sumRaw = _ldIsPeople ? String((item.categoryFields || {}).execSummary || '').trim() : '';
        var sumHTML = sumRaw ? '<div class="mkt-ld-sum"><div class="mkt-ld-exp-head"><i class="fas fa-file-lines"></i> Executive summary</div><p class="mkt-ld-sum-txt">' + _esc(sumRaw.slice(0, 800)) + '</p></div>' : '';
        var expHTML = _ldIsPeople ? _mktExperienceHTML((item.categoryFields || {}).workHistory) : '';
        var sellerRow = item.sellerId
            ? '<div class="mkt-listing-detail-seller" id="mkt-listing-detail-seller" data-seller-id="' + _esc(item.sellerId) + '" style="cursor:pointer;">' +
                  '<i class="fas fa-store"></i> ' + _esc(item.sellerName || item.username || 'Seller') +
              '</div>'
            : '';

        // FIX (request — "clicking the job seeker/employer card should
        // open the full details, where they also have access to
        // download the files"): this page never rendered item.documents
        // at all before now — the résumé/portfolio/credential chips
        // (with real, clickable download/view links) only ever showed on
        // the inline marketplace-grid card via _mktDocumentsHTML
        // (app-marketplace.js), never here on the dedicated single-item
        // detail page a card tap actually lands on. Reuses that exact
        // same helper/markup so a listing's attached files look and
        // behave identically wherever they're shown across the app.
        //
        // FIX (request — "implement exactly the screenshot featuring the
        // 4 downloadable folder indicating PDF for PDF upload... enable
        // it to be downloadable for employer to get access"): Job
        // Seeker / Professional Service / Job Vacancy listings (the
        // "reference screenshot" this was requested against) now get a
        // dedicated "Credentials & Files" section here built from the
        // exact same always-4 labeled folder-tile grid (Resume / Photo /
        // Record / Portfolio, each corner-badged PDF/DOC/IMG, each a
        // real download link — see _mktBuildAvatarTiles above in
        // app-marketplace.js) the dashboard-strip "New in Marketplace"
        // card already uses, instead of the generic chip-list "Attached
        // Files" block below — so an employer opening a job seeker's
        // full listing sees and can download their résumé/portfolio the
        // same way the screenshot shows, not a plain row of chips. Every
        // other (physical-product) category is untouched and keeps the
        // original "Attached Files" chip list exactly as before.
        var docsHTML;
        if (isAvatarListing && typeof window._mktBuildAvatarTiles === 'function') {
            docsHTML = '<div class="mkt-listing-detail-credentials">' +
                '<h4 class="mkt-listing-detail-docs-h">Credentials &amp; Files</h4>' +
                '<div class="mkt-dash-av-tiles mkt-listing-detail-tiles">' + window._mktBuildAvatarTiles(item) + '</div>' +
            '</div>';
        } else {
            docsHTML = (typeof window._mktDocumentsHTML === 'function') ? window._mktDocumentsHTML(item.documents) : '';
            if (docsHTML) {
                docsHTML = '<div class="mkt-listing-detail-docs"><h4 class="mkt-listing-detail-docs-h">Attached Files</h4>' + docsHTML + '</div>';
            }
        }

        body.innerHTML =
            (isAvatarListing
                ? idCardHTML
                : (mainImg ? '<img class="mkt-listing-detail-hero" id="mkt-listing-detail-hero" src="' + _esc(mainImg) + '" alt="' + _esc(item.name || '') + '">'
                           : '<div class="mkt-listing-detail-hero" style="background:linear-gradient(135deg,#1B2B8B,#0A0E27);"></div>')
                  + thumbsHTML) +
            '<div class="mkt-listing-detail-body">' +
                (isAvatarListing ? '' : catBadge) +
                (isAvatarListing ? '' : '<h2 class="mkt-listing-detail-name">' + _esc(item.name || 'Item') + '</h2>') +
                (isAvatarListing ? '' : '<div class="mkt-listing-detail-price">' + priceStr + '</div>') +
                sellerRow +
                specsHTML +
                (item.description ? '<p class="mkt-listing-detail-desc">' + _esc(item.description) + '</p>' : '') +
                (item.location ? '<div class="mkt-listing-detail-loc"><i class="fas fa-map-marker-alt"></i> ' + _esc(item.location) + '</div>' : '') +
                (_ldIsPeople ? sumHTML + contactBtn + expHTML + docsHTML : docsHTML + contactBtn) +
            '</div>';

        var hero = document.getElementById('mkt-listing-detail-hero');
        body.querySelectorAll('.mkt-listing-detail-thumbs img').forEach(function (t) {
            t.addEventListener('click', function () {
                if (hero) hero.src = t.src;
                body.querySelectorAll('.mkt-listing-detail-thumbs img').forEach(function (o) { o.classList.remove('active'); });
                t.classList.add('active');
            });
        });

        var _ldLoginBtn = document.getElementById('mkt-ld-login-btn');
        if (_ldLoginBtn) _ldLoginBtn.addEventListener('click', function () { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); });
        _mktFillDetailContact(item, isOwner);

        var sellerEl = document.getElementById('mkt-listing-detail-seller');
        if (sellerEl) sellerEl.addEventListener('click', function () { _openSellerProfile(sellerEl.dataset.sellerId); });

        /* FIX (request — Marketplace Communication Adjustments, 2026-08-09):
           #mkt-listing-detail-msg-btn is now a plain tel: <a> link (see
           contactBtn above) — the browser's own dialer handles the tap.
           Previous click handler (opened the in-app chat overlay) removed. */

        var backBtn = document.getElementById('mkt-listing-detail-back-btn');
        _upgradeListingDetailBackIcon(backBtn);
        if (backBtn) {
            backBtn.title = _listingDetailOrigin === 'seller-profile-page' ? 'Back to Seller Profile'
                : (_listingDetailOrigin === 'dashboard' ? 'Back to Home' : 'Back to Marketplace');
        }

        _goTo('mkt-listing-detail-page');
    }

    function _openListingDetailPage(itemId) {
        if (!itemId) { _notify('Could not load this listing — try again.', 'error'); return; }
        var cached = _listingDetailCache[itemId];
        if (cached) { _renderListingDetailPage(itemId, cached); return; }

        var body = document.getElementById('mkt-listing-detail-body');
        if (body) body.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--color-neutral-600);"><i class="fas fa-spinner fa-spin"></i> Loading listing…</div>';
        _goTo('mkt-listing-detail-page');

        var db = _fbDb();
        if (!db) { _notify('Could not load this listing — try again.', 'error'); return; }
        db.collection('marketplace_listings').doc(itemId).get().then(function (doc) {
            if (!doc.exists) { _notify('This listing is no longer available.', 'error'); return; }
            var item = doc.data() || {};
            item.id = itemId;
            _renderListingDetailPage(itemId, item);
        }).catch(function () {
            _notify('Could not load this listing. Please try again.', 'error');
        });
    }
    window._openListingDetailPage = _openListingDetailPage;

    /* Wire every marketplace feed/search card (not just the Seller
       Profile's mini-cards) to open this same dedicated page. Delegated
       on document so it works for cards rendered at any point, including
       ones added later by the live Firestore listener. Excludes taps on
       anything already interactive on the card (seller name, contact/
       message/cart/edit/delete buttons, the expandable direct-contact
       panel) so those keep their own existing behavior untouched. */
    document.addEventListener('click', function (e) {
        var card = e.target.closest('#property-grid-container .property-card, #dashboard-market-container .property-card');
        if (!card) return;
        if (e.target.closest(
            'button, a, input, select, textarea, ' +
            '.property-seller-info, .direct-contact-info, .property-actions, ' +
            '.mkt-dash-av-head-clickable, ' +
            '[data-action], .contact-seller-btn, .expand-contact-btn'
        )) return;

        /* FIX (request — "Clicking a card [in the dashboard's horizontal
           scroll 'New in Marketplace' section] should take users directly
           to the seller's published product listings"): a full property-
           card rendered inside the dashboard strip now opens straight onto
           that seller's storefront (Seller Profile page, which lists all
           their published listings) instead of this single item's detail
           page. The main Marketplace grid keeps the existing single-item
           Listing Detail page untouched — this only changes cards inside
           #dashboard-market-container. */
        if (card.closest('#dashboard-market-container')) {
            /* FIX (request — "clicking the job seeker/employer card
               should open the full listing details, with access to
               download the attached files"): Job Seeking / Professional
               Services / Job Vacancy cards on this strip now go straight
               to THIS listing's own detail page (which shows the
               attached résumé/portfolio/credential files via
               _mktDocumentsHTML — see _renderListingDetailPage below),
               same as tapping a card on the main Marketplace grid does.
               Every other category's dashboard card is untouched and
               still opens the seller's storefront, per the original
               "take users directly to the seller's published listings"
               request this block's comment above documents. */
            var dashCategory = card.dataset.category || '';
            var dashIsAvatar = (typeof window._mktIsAvatarCategory === 'function') && window._mktIsAvatarCategory(dashCategory);
            if (!dashIsAvatar) {
                var dashSellerId = card.dataset.sellerId || card.dataset.userId || '';
                if (dashSellerId) {
                    /* FIX (bug found while wiring the avatar-card case
                       above): app-fixes.js's own master click handler has
                       a SEPARATE, later-registered listener on `document`
                       that also matches any `.dashboard-market-card` tap
                       (its `dashboardClickTarget` check) and unconditionally
                       calls navigateTo(card.dataset.navTarget) — which for
                       every card here is the generic 'marketplace' section.
                       Since neither listener calls stopPropagation, both
                       fire for the same tap; that second, generic
                       navigateTo('marketplace') was firing right after
                       _openSellerProfile()/_openListingDetailPage() below
                       and immediately switching the visible section back
                       to the plain marketplace grid, undoing whichever of
                       the two more specific pages this handler had just
                       opened. Flagging the event (rather than a blanket
                       e.stopPropagation(), which would also block the
                       unrelated open-dropdown-menu-cleanup logic bundled
                       earlier in that same app-fixes.js master handler)
                       lets that one specific branch recognize the click
                       was already routed and skip its own navigateTo —
                       see the matching check added around its
                       `dashboardClickTarget` block. */
                    e._empMktHandled = true;
                    _openSellerProfile(dashSellerId);
                    return;
                }
                /* No sellerId on the card yet — fall through to the item
                   detail page below rather than doing nothing on tap. */
            }
        }

        var itemId = card.dataset.id || card.dataset.postId;
        if (itemId) {
            /* FIX (request — "Clicking the back button should return
               users to the marketplace section (not the general
               dashboard)"): always 'marketplace' now, regardless of
               where the card was tapped from. */
            _listingDetailOrigin = 'marketplace';
            /* See the matching comment a few lines up: prevents
               app-fixes.js's generic dashboard-strip click handler from
               navigating back to the plain 'marketplace' section right
               after this opens the listing's own detail page (only
               matters for cards inside #dashboard-market-container —
               harmless no-op for main-grid cards, which that other
               handler never matches anyway). */
            if (card.closest('#dashboard-market-container')) e._empMktHandled = true;
            _openListingDetailPage(itemId);
        }
    });


    function _mktBuildListingDeepLink(itemId) {
        var url;
        try { url = new URL(location.href); } catch (e) { return location.href; }
        url.searchParams.set('mktView', 'listing');
        url.searchParams.set('mktItem', itemId);
        return url.toString();
    }

    /* PREMIUM BACK ICON (2026-10-23): the plain "\u2190" text glyph on the Listing Details back button is
       replaced with a fine-stroke chevron in a navy/gold ring (styled by .mkt-back-premium in style.css).
       Idempotent; the button's id, click wiring and title are untouched. */
    function _upgradeListingDetailBackIcon(btn) {
        if (!btn || btn.getAttribute('data-premium-icon') === '1') return;
        btn.setAttribute('data-premium-icon', '1');
        btn.classList.add('mkt-back-premium');
        btn.setAttribute('aria-label', 'Back');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" '
            + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>';
    }

    function _wireListingDetailBackButton() {
        var btn = document.getElementById('mkt-listing-detail-back-btn');
        _upgradeListingDetailBackIcon(btn);
        if (!btn || btn._wired) return;
        btn._wired = true;
        btn.addEventListener('click', function () { _goTo(_listingDetailOrigin || 'marketplace'); });
    }
    document.addEventListener('empyrean-init-done', function () { setTimeout(_wireListingDetailBackButton, 400); });

    /* =========================================================================
       §BIO  Seller bio modal — opened by tapping the avatar on the profile
       page. Shows listing/rating stats plus whatever registration bio-data
       fields (phone/email/dob/address/stateOfResidence) exist on the user
       doc already cached in _userDocCache by _openSellerProfile above.
       ========================================================================= */
    function _ensureSellerBioModal() {
        if (document.getElementById('mkt-seller-bio-modal')) return;
        var modal = document.createElement('div');
        modal.id = 'mkt-seller-bio-modal';
        modal.className = 'modal-overlay-container';
        modal.innerHTML =
            '<div class="modal-card">' +
                '<button type="button" class="close-modal" title="Close">&times;</button>' +
                '<div id="mkt-seller-bio-body"></div>' +
            '</div>';
        document.body.appendChild(modal);
        modal.querySelector('.close-modal').addEventListener('click', _closeSellerBioModal);
        modal.addEventListener('click', function (e) { if (e.target === modal) _closeSellerBioModal(); });
    }

    function _closeSellerBioModal() {
        var modal = document.getElementById('mkt-seller-bio-modal');
        if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; }
        document.body.classList.remove('modal-open');
    }

    function _openSellerBioModal(d) {
        _ensureSellerBioModal();
        var body = document.getElementById('mkt-seller-bio-body');
        if (!body) return;
        var u = _userDocCache[d.sellerId] || {};

        var rows = [];
        if (u.phone) rows.push('<div class="mkt-bio-row"><i class="fas fa-phone"></i> ' + _esc(u.phone) + '</div>');
        if (u.email) rows.push('<div class="mkt-bio-row"><i class="fas fa-envelope"></i> ' + _esc(u.email) + '</div>');
        if (u.dob) rows.push('<div class="mkt-bio-row"><i class="fas fa-birthday-cake"></i> ' + _esc(u.dob) + '</div>');
        if (u.stateOfResidence) rows.push('<div class="mkt-bio-row"><i class="fas fa-map-marker-alt"></i> ' + _esc(u.stateOfResidence) + '</div>');
        if (u.address) rows.push('<div class="mkt-bio-row"><i class="fas fa-home"></i> ' + _esc(u.address) + '</div>');
        if (u.businessName) rows.push('<div class="mkt-bio-row"><i class="fas fa-briefcase"></i> ' + _esc(u.businessName) + '</div>');

        body.innerHTML =
            '<div class="mkt-seller-header" style="margin-bottom:4px;">' +
                '<img class="mkt-seller-avatar" style="cursor:default;" src="' + _esc(d.avatar) + '" alt="' + _esc(d.name) + '">' +
                '<div>' +
                    '<div class="mkt-seller-name-row">' + _esc(d.name) + (d.isVerified ? ' <i class="fas fa-check-circle mkt-seller-verified-badge" title="Verified Seller"></i>' : '') + '</div>' +
                    (d.handle ? '<div class="mkt-seller-username">@' + _esc(d.handle) + '</div>' : '') +
                '</div>' +
            '</div>' +
            '<div class="mkt-bio-stats">' +
                '<div class="mkt-bio-stat"><span class="mbs-num">' + (d.listings ? d.listings.length : 0) + '</span><span class="mbs-label">Listings</span></div>' +
                '<div class="mkt-bio-stat"><span class="mbs-num">' + (d.soldListings ? d.soldListings.length : 0) + '</span><span class="mbs-label">Sold</span></div>' +
                '<div class="mkt-bio-stat"><span class="mbs-num">' + (d.avg || 0).toFixed(1) + '</span><span class="mbs-label">Rating</span></div>' +
                '<div class="mkt-bio-stat"><span class="mbs-num">' + (d.count || 0) + '</span><span class="mbs-label">Reviews</span></div>' +
            '</div>' +
            (rows.length ? rows.join('') : '<p style="color:var(--color-neutral-600);font-size:0.87rem;">No additional bio details on file.</p>');

        var modal = document.getElementById('mkt-seller-bio-modal');
        modal.style.display = '';
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }

    /* =========================================================================
       §NAIRA WITHDRAW  Seller-initiated real bank payout of fiatBalance.NGN.
       Writes a withdrawal_requests doc in the EXACT shape server.js's
       /api/admin/withdrawals/:id/payout route and app-patch-v48.js's admin
       approve/decline logic expect: currency:'NGN', method:'bank',
       accountDetails:{bankName, accountNumber}. The amount is held
       immediately (fiatBalance.NGN decremented client-side, same "hold on
       submit, refund on decline" pattern app-patch-v48.js already uses for
       the general EMPY withdrawal form) — an admin later either approves it
       (fires a real Flutterwave transfer) or declines it (refunds
       fiatBalance.NGN, per app-patch-v48.js's currency-aware refund fix).

       FIRESTORE RULES NOTE (not applied here — same caveat as
       app-patch-v48.js's own rules note at the bottom of that file): the
       existing withdrawal_requests create/read/update rules already cover
       this collection generically (create-by-owner, read/update-by-admin),
       so no NEW rule is needed for withdrawal_requests itself. What DOES
       need a rule if one doesn't already exist: allow a user to update
       their OWN users/{uid}.fiatBalance.NGN field (this modal decrements it
       client-side on submit) — e.g.:
         allow update: if request.auth.uid == userId
           && request.resource.data.diff(resource.data).affectedKeys()
                .hasOnly(['fiatBalance']);
       ========================================================================= */
    function _ensureNairaWithdrawModal() {
        if (document.getElementById('mkt-withdraw-modal')) return;
        var modal = document.createElement('div');
        modal.id = 'mkt-withdraw-modal';
        modal.className = 'modal-overlay-container';
        modal.innerHTML =
            '<div class="modal-card">' +
                '<button type="button" class="close-modal" title="Close">&times;</button>' +
                '<div id="mkt-withdraw-body"></div>' +
            '</div>';
        document.body.appendChild(modal);
        modal.querySelector('.close-modal').addEventListener('click', _closeNairaWithdrawModal);
        modal.addEventListener('click', function (e) { if (e.target === modal) _closeNairaWithdrawModal(); });
    }

    function _closeNairaWithdrawModal() {
        var modal = document.getElementById('mkt-withdraw-modal');
        if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; }
        document.body.classList.remove('modal-open');
    }

    function _openNairaWithdrawModal(d) {
        _ensureNairaWithdrawModal();
        var body = document.getElementById('mkt-withdraw-body');
        if (!body) return;
        var bal = Number(d.fiatBalanceNGN || 0);

        body.innerHTML =
            '<h3 style="margin:0 0 4px;color:var(--primary);">Withdraw to Bank</h3>' +
            '<p style="font-size:0.85rem;color:var(--color-neutral-600);margin:0 0 16px;">' +
                'Available: <strong>' + _orderPriceStr(bal, 'NGN') + '</strong>. Minimum withdrawal is ' + _orderPriceStr(MKT_NGN_WITHDRAW_MIN, 'NGN') + '.' +
            '</p>' +
            '<div class="mkt-kyc-form">' +
                '<div class="form-group">' +
                    '<label for="mkt-wd-amount">Amount (₦)</label>' +
                    '<input type="number" id="mkt-wd-amount" min="' + MKT_NGN_WITHDRAW_MIN + '" max="' + bal + '" step="1" placeholder="e.g. 5000">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label for="mkt-wd-bank">Bank Name</label>' +
                    '<input type="text" id="mkt-wd-bank" placeholder="e.g. GTBank">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label for="mkt-wd-account">Account Number</label>' +
                    '<input type="text" id="mkt-wd-account" maxlength="10" placeholder="10-digit NUBAN">' +
                '</div>' +
            '</div>' +
            '<div id="mkt-wd-feedback" style="display:none;margin:10px 0;padding:9px 12px;border-radius:10px;font-size:0.83rem;"></div>' +
            '<button type="button" class="btn btn-accent" id="mkt-wd-submit" style="width:100%;margin-top:6px;">Submit Withdrawal Request</button>';

        document.getElementById('mkt-wd-submit').addEventListener('click', function () {
            _submitNairaWithdraw(d, bal);
        });

        var modal = document.getElementById('mkt-withdraw-modal');
        modal.style.display = '';
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }

    function _wdFeedback(msg, type) {
        var el = document.getElementById('mkt-wd-feedback');
        if (!el) return;
        var colors = { error: ['#fee2e2', '#991b1b'], success: ['rgba(22,163,74,0.1)', '#16A34A'], info: ['rgba(29,155,240,0.08)', '#1d9bf0'] };
        var c = colors[type] || colors.info;
        el.style.display = 'block';
        el.style.background = c[0];
        el.style.color = c[1];
        el.textContent = msg;
    }

    function _submitNairaWithdraw(d, availableBalance) {
        var us = _us();
        if (!us.id) { _wdFeedback('Please log in to request a withdrawal.', 'error'); return; }

        var amountInput = document.getElementById('mkt-wd-amount');
        var bankInput = document.getElementById('mkt-wd-bank');
        var accountInput = document.getElementById('mkt-wd-account');
        var amount = parseFloat(amountInput && amountInput.value);
        var bankName = bankInput ? bankInput.value.trim() : '';
        var accountNumber = accountInput ? accountInput.value.trim().replace(/\D/g, '') : '';

        if (!amount || isNaN(amount) || amount < MKT_NGN_WITHDRAW_MIN) {
            _wdFeedback('Minimum withdrawal is ' + _orderPriceStr(MKT_NGN_WITHDRAW_MIN, 'NGN') + '.', 'error');
            return;
        }
        if (amount > availableBalance) {
            _wdFeedback('Amount exceeds your available balance.', 'error');
            return;
        }
        if (!bankName) { _wdFeedback('Please enter your bank name.', 'error'); return; }
        if (accountNumber.length !== 10) { _wdFeedback('Account number must be exactly 10 digits.', 'error'); return; }

        var db = _fbDb();
        if (!db) { _wdFeedback('Offline — cannot submit right now.', 'error'); return; }

        var submitBtn = document.getElementById('mkt-wd-submit');
        if (submitBtn) submitBtn.disabled = true;
        _wdFeedback('Submitting…', 'info');

        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        var userRef = db.collection('users').doc(us.id);
        // Pre-generate the auto-ID doc ref (Firestore transactions require
        // all reads before any write, so this can't be a collection().add()
        // call inside the transaction body — .doc() with no argument gives
        // the same auto-ID behavior, just resolved up front).
        var wdRef = db.collection('withdrawal_requests').doc();

        var payload = {
            userId: us.id,
            username: us.username || '',
            fullName: us.fullName || us.username || 'Empyrean Member',
            email: us.email || '',
            amount: amount, currency: 'NGN', method: 'bank',
            accountDetails: { bankName: bankName, accountNumber: accountNumber },
            status: 'pending'
        };
        payload.createdAt = fv ? fv.serverTimestamp() : new Date().toISOString();
        payload.updatedAt = payload.createdAt;

        // ATOMIC: create the withdrawal_requests doc and hold the amount
        // (decrement fiatBalance.NGN) in a single transaction, re-validated
        // against the CURRENT server balance — not the `availableBalance`
        // closed over from when the modal opened, which could be stale if
        // another withdrawal/sale happened in between. Either both writes
        // land or neither does; there's no window where a request exists
        // without its hold, or a hold exists without a matching request.
        // The refund path in app-patch-v48.js's _declineWithdrawal, and the
        // "amount already left, don't refund" success path in server.js's
        // /api/admin/withdrawals/:id/payout route, both rely on that
        // invariant always holding.
        var txPromise = (fv && typeof db.runTransaction === 'function')
            ? db.runTransaction(function (transaction) {
                return transaction.get(userRef).then(function (snap) {
                    var uData = snap.exists ? (snap.data() || {}) : {};
                    var liveBal = Number((uData.fiatBalance && uData.fiatBalance.NGN) || 0);
                    if (liveBal < amount) {
                        throw new Error('Amount exceeds your available balance.');
                    }
                    transaction.set(wdRef, payload);
                    transaction.update(userRef, { 'fiatBalance.NGN': liveBal - amount });
                });
            })
            // No FieldValue available (SDK not fully loaded) — vanishingly
            // rare in practice since a transaction needs the same SDK
            // surface, but kept as a safety net rather than a hard failure.
            : userRef.get().then(function (snap) {
                var uData = snap.exists ? (snap.data() || {}) : {};
                var liveBal = Number((uData.fiatBalance && uData.fiatBalance.NGN) || 0);
                if (liveBal < amount) throw new Error('Amount exceeds your available balance.');
                payload.createdAt = new Date().toISOString();
                payload.updatedAt = payload.createdAt;
                return wdRef.set(payload).then(function () {
                    return userRef.update({ fiatBalance: Object.assign({}, uData.fiatBalance || {}, { NGN: liveBal - amount }) });
                });
            });

        txPromise.then(function () {
            _wdFeedback('Withdrawal request submitted for review. You\u2019ll be notified once it\u2019s processed.', 'success');
            setTimeout(function () {
                _closeNairaWithdrawModal();
                _openSellerProfile(d.sellerId); // refresh the Earnings block with the held balance
            }, 900);
        }).catch(function (err) {
            console.error('[EmpMarketSellers] Naira withdrawal submit failed:', err.message);
            // The transaction throws this exact message when the live
            // server balance (re-checked at commit time) turns out lower
            // than what the modal showed when it opened — worth surfacing
            // as-is rather than masking it with the generic failure message.
            _wdFeedback(err.message === 'Amount exceeds your available balance.' ? err.message : 'Could not submit withdrawal — please try again.', 'error');
            if (submitBtn) submitBtn.disabled = false;
        });
    }

    /* =========================================================================
       §REVIEWS  Star picker + submit (one review per buyer per seller).
       ========================================================================= */
    function _wireReviewForm(sellerId) {
        var picker = document.getElementById('mkt-star-picker');
        var submitBtn = document.getElementById('mkt-review-submit');
        if (!picker || !submitBtn) return;

        picker.querySelectorAll('i').forEach(function (star) {
            star.addEventListener('click', function () {
                var val = parseInt(star.dataset.star, 10);
                picker.dataset.value = val;
                picker.querySelectorAll('i').forEach(function (s) {
                    s.classList.toggle('active', parseInt(s.dataset.star, 10) <= val);
                });
            });
        });

        submitBtn.addEventListener('click', function () {
            var us = _us();
            if (!us.id) { _notify('Please log in to leave a review.', 'error'); return; }
            if (us.id === sellerId) { _notify('You can\'t review your own seller profile.', 'error'); return; }
            var rating = parseInt(picker.dataset.value, 10) || 0;
            if (rating < 1) { _notify('Please select a star rating.', 'error'); return; }
            var comment = (document.getElementById('mkt-review-comment') || {}).value || '';
            var db = _fbDb();
            if (!db) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting…';

            var reviewDoc = {
                sellerId: sellerId,
                buyerId: us.id,
                buyerName: us.fullName || us.username || 'Buyer',
                buyerAvatar: us.avatar || '',
                rating: rating,
                comment: comment.trim(),
                createdAt: new Date().toISOString()
            };

            /* Deterministic doc id (seller_buyer) keeps this to one review
               per buyer per seller — resubmitting updates their existing
               review instead of spamming duplicates. */
            db.collection('marketplace_reviews').doc(sellerId + '_' + us.id).set(reviewDoc, { merge: true })
                .then(function () {
                    _notify('Review submitted. Thank you!', 'success');
                    _openSellerProfile(sellerId); /* refresh with the new average */
                })
                .catch(function () {
                    _notify('Could not submit your review. Please try again.', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit Review';
                });
        });
    }

    /* =========================================================================
       §SELLER KYC PAGE  (#seller-kyc-page)  Reached by swiping left on the
       Marketplace, tapping the swipe-hint banner, or the "Get Verified" CTA
       on your own seller profile.
       ========================================================================= */
    function _openSellerKycPage() {
        var us = _us();
        if (_isGuest() || !us.id) {
            _notify('Please log in to set up your seller profile.', 'error');
            return;
        }
        _goTo('seller-kyc-page');
        var body = document.getElementById('seller-kyc-page-body');
        if (body) body.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--color-neutral-600);"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';

        var db = _fbDb();
        if (!db) { _renderSellerKycPage({ isVerified: false, status: '' }); return; }

        db.collection('users').doc(us.id).get().then(function (doc) {
            var u = doc.exists ? (doc.data() || {}) : {};
            _userDocCache[us.id] = u;
            _verifiedCache[us.id] = !!u.isVerified;
            if (u.banned) {
                if (body) body.innerHTML = '<p style="text-align:center;color:var(--color-neutral-600);padding:40px 20px;"><i class="fas fa-exclamation-circle" style="font-size:1.6rem;display:block;margin-bottom:10px;"></i>Your account access is currently restricted. Contact support for more information.</p>';
                return;
            }
            _renderSellerKycPage({ isVerified: !!u.isVerified, status: u.sellerVerificationStatus || '' });
        }).catch(function () {
            _renderSellerKycPage({ isVerified: false, status: '' });
        });
    }
    window._openSellerKycPage = _openSellerKycPage;

    function _renderSellerKycPage(d) {
        var body = document.getElementById('seller-kyc-page-body');
        if (!body) return;

        if (d.isVerified) {
            body.innerHTML =
                '<div class="mkt-verify-status is-verified" style="max-width:460px;"><i class="fas fa-check-circle"></i> You\'re already a Verified Seller — no further action needed.</div>' +
                '<button type="button" class="btn" id="mkt-kyc-view-profile-btn" style="margin-top:16px;background:none;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;padding:10px 16px;cursor:pointer;">View my Seller Profile</button>';
            var viewBtn = document.getElementById('mkt-kyc-view-profile-btn');
            if (viewBtn) viewBtn.addEventListener('click', function () { _openSellerProfile(_us().id); });
            return;
        }

        if (d.status === 'pending') {
            body.innerHTML =
                '<div class="mkt-verify-status is-pending" style="max-width:460px;"><i class="fas fa-hourglass-half"></i> Your verification is submitted and under review. We\'ll mark your account Verified once it\'s approved.</div>';
            return;
        }

        body.innerHTML =
            '<p class="mkt-kyc-intro">Set up your seller profile and submit KYC verification to receive a Verified badge that helps buyers trust your listings.</p>' +
            '<form id="mkt-verify-form" class="mkt-kyc-form">' +
                '<div class="form-group"><label>Full Name / Business Name</label><input type="text" id="mkt-verify-name" required placeholder="e.g., John Doe or Doe Motors Ltd"></div>' +
                '<div class="form-group"><label>Profile Picture / Logo</label><input type="file" id="mkt-verify-avatar" accept="image/*"></div>' +
                '<div class="form-group"><label>Phone Number</label><input type="tel" id="mkt-verify-phone" required placeholder="e.g., +2348012345678"></div>' +
                '<div class="form-group"><label>Email Address</label><input type="email" id="mkt-verify-email" required placeholder="you@example.com"></div>' +
                '<div class="form-group"><label>Home Address</label><input type="text" id="mkt-verify-address" required placeholder="Street, City"></div>' +
                '<div class="form-group"><label>Date of Birth</label><input type="date" id="mkt-verify-dob" required></div>' +
                '<div class="form-group"><label>State of Residence</label><input type="text" id="mkt-verify-state" required placeholder="e.g., Lagos"></div>' +
                '<div class="form-group"><label>ID Type</label><select id="mkt-verify-idtype" required>' +
                    '<option value="">Select…</option>' +
                    '<option value="National ID">National ID</option>' +
                    '<option value="International Passport">International Passport</option>' +
                    '<option value="Driver\'s License">Driver\'s License</option>' +
                    '<option value="CAC Business Certificate">CAC / Business Certificate</option>' +
                '</select></div>' +
                '<div class="form-group"><label>ID Number</label><input type="text" id="mkt-verify-idnumber" required placeholder="e.g., 12345678901"></div>' +
                '<div class="form-group"><label>Upload ID Document</label><input type="file" id="mkt-verify-iddoc" accept="image/*,.pdf" required></div>' +
                '<div class="form-group"><label>Upload Business Certificate (optional)</label><input type="file" id="mkt-verify-bizcert" accept="image/*,.pdf"></div>' +
                '<button type="submit" class="btn btn-accent" style="width:100%;margin-top:6px;">Submit for KYC Review</button>' +
            '</form>';

        var form = document.getElementById('mkt-verify-form');
        if (form) form.addEventListener('submit', function (e) {
            e.preventDefault();
            _submitSellerVerification(form);
        });
    }

    function _submitSellerVerification(form) {
        var us = _us();
        var name      = (document.getElementById('mkt-verify-name') || {}).value || '';
        var phone     = (document.getElementById('mkt-verify-phone') || {}).value || '';
        var email     = (document.getElementById('mkt-verify-email') || {}).value || '';
        var address   = (document.getElementById('mkt-verify-address') || {}).value || '';
        var dob       = (document.getElementById('mkt-verify-dob') || {}).value || '';
        var stateRes  = (document.getElementById('mkt-verify-state') || {}).value || '';
        var idType    = (document.getElementById('mkt-verify-idtype') || {}).value || '';
        var idNumber  = (document.getElementById('mkt-verify-idnumber') || {}).value || '';
        var idFileEl  = document.getElementById('mkt-verify-iddoc');
        var bizFileEl = document.getElementById('mkt-verify-bizcert');
        var avatarFileEl = document.getElementById('mkt-verify-avatar');

        if (!name.trim() || !phone.trim() || !email.trim() || !address.trim() || !dob || !stateRes.trim() ||
            !idType || !idNumber.trim() || !idFileEl || !idFileEl.files || !idFileEl.files[0]) {
            _notify('Please fill in all required fields and upload your ID document.', 'error');
            return;
        }
        if (typeof window.uploadMediaFilesToCloudinary !== 'function') {
            _notify('Upload isn\'t available right now — please try again shortly.', 'error');
            return;
        }

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading…'; }

        var filesToUpload = [idFileEl.files[0]];
        var hasBizCert = bizFileEl && bizFileEl.files && bizFileEl.files[0];
        if (hasBizCert) filesToUpload.push(bizFileEl.files[0]);
        var hasAvatar = avatarFileEl && avatarFileEl.files && avatarFileEl.files[0];
        if (hasAvatar) filesToUpload.push(avatarFileEl.files[0]);

        window.uploadMediaFilesToCloudinary(filesToUpload)
            .then(function (urls) {
                urls = (urls || []).filter(Boolean);
                var idDocUrl = urls[0] || '';
                var idx = 1;
                var bizCertUrl = hasBizCert ? (urls[idx++] || '') : '';
                var avatarUrl = hasAvatar ? (urls[idx++] || '') : '';
                var db = _fbDb();
                var kycData = {
                    id: 'kyc-' + Date.now(),
                    userId: us.id,
                    username: us.username || '',
                    type: 'marketplace-seller',
                    businessName: name.trim(),
                    phone: phone.trim(),
                    email: email.trim(),
                    address: address.trim(),
                    dob: dob,
                    stateOfResidence: stateRes.trim(),
                    idType: idType,
                    idNumber: idNumber.trim(),
                    documents: { idDocument: idDocUrl, businessCertificate: bizCertUrl },
                    avatarUrl: avatarUrl,
                    submittedAt: new Date().toISOString(),
                    status: 'pending'
                };
                var writes = [];
                if (db) {
                    writes.push(db.collection('kyc_submissions').add(kycData).catch(function () {}));
                    writes.push(db.collection('users').doc(us.id).set({ sellerVerificationStatus: 'pending' }, { merge: true }).catch(function () {}));
                    if (avatarUrl) {
                        writes.push(db.collection('users').doc(us.id).set({ avatar: avatarUrl }, { merge: true }).catch(function () {}));
                        if (window.userState) window.userState.avatar = avatarUrl;
                    }
                }
                Promise.all(writes).then(function () {
                    /* Reflect locally so re-opening the page shows the
                       pending state without waiting on a fresh read. */
                    if (window.userState) window.userState.sellerVerificationStatus = 'pending';
                    if (_S().userState) _S().userState.sellerVerificationStatus = 'pending';
                    _notify('Submitted for KYC review. You\'ll be marked Verified once approved.', 'success');
                    _renderSellerKycPage({ isVerified: false, status: 'pending' });
                    _refreshSwipeBanner();
                });
            })
            .catch(function () {
                _notify('Document upload failed. Please try again.', 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit for KYC Review'; }
            });
    }

    /* =========================================================================
       §BACK BUTTONS
       ========================================================================= */
    _ready(function () {
        var pBack = document.getElementById('seller-profile-back-btn');
        if (pBack) pBack.addEventListener('click', function () { _goTo('marketplace'); });
        var kBack = document.getElementById('seller-kyc-back-btn');
        if (kBack) kBack.addEventListener('click', function () { _goTo('marketplace'); });
    });

    /* =========================================================================
       §SWIPE-LEFT ON MARKETPLACE  Real gesture on the Marketplace screen
       itself (not nested inside any modal), per the original spec: swiping
       left opens the seller setup / KYC page. Scoped to #marketplace only,
       and requires a mostly-horizontal drag so normal vertical scrolling
       of the listings grid is never intercepted.
       ========================================================================= */
    function _wireMarketplaceSwipe() {
        /* DISABLED — swipe-to-profile navigation removed. Any swipe on the
           Marketplace screen used to open the seller setup/profile page,
           which meant normal vertical scrolling gestures could misfire into
           a navigation. Profile access is now restricted to the dedicated
           swipe-hint banner button only (_ensureSwipeBanner /
           _handleMarketplaceSwipeLeft below), which is unaffected by this
           guard. Left in place rather than removed in case the gesture is
           reinstated later. */
        if (false) {
        var section = document.getElementById('marketplace');
        if (!section || section._mktSwipeWired) return;
        section._mktSwipeWired = true;

        var startX = null, startY = null, dragging = false;
        var THRESHOLD_X = 90;   /* minimum horizontal travel to count as a swipe */
        var MAX_Y_RATIO = 0.6;  /* how vertical the drag is allowed to be, relative to X */

        function onStart(x, y) { startX = x; startY = y; dragging = true; }
        function onEnd(endX, endY) {
            if (!dragging || startX == null) { dragging = false; return; }
            dragging = false;
            var dx = endX - startX;
            var dy = Math.abs(endY - startY);
            if (dx < -THRESHOLD_X && dy < Math.abs(dx) * MAX_Y_RATIO) {
                _handleMarketplaceSwipeLeft();
            }
            startX = null; startY = null;
        }

        section.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            onStart(t.clientX, t.clientY);
        }, { passive: true });
        section.addEventListener('touchend', function (e) {
            var t = e.changedTouches[0];
            onEnd(t.clientX, t.clientY);
        }, { passive: true });

        /* Mouse fallback for desktop testing — same convention already used
           elsewhere in this codebase for swipe gestures. */
        section.addEventListener('mousedown', function (e) { onStart(e.clientX, e.clientY); });
        document.addEventListener('mouseup', function (e) {
            if (dragging) onEnd(e.clientX, e.clientY);
        });
        }
    }

    function _handleMarketplaceSwipeLeft() {
        var us = _us();
        if (_isGuest() || !us.id) {
            _notify('Log in to set up your seller profile.', 'info');
            return;
        }
        var cachedVerified = _verifiedCache[us.id];
        if (cachedVerified === true) { _openSellerProfile(us.id); return; }
        _openSellerKycPage();
    }

    /* =========================================================================
       §SWIPE-HINT BANNER  Visible, tappable fallback for the swipe gesture —
       sits at the top of the Marketplace, above the listings grid.
       ========================================================================= */
    function _ensureSwipeBanner() {
        /* The "Swipe left to set up your Seller Profile" banner has been
           removed from the Marketplace home page entirely, per request.
           Any banner left over from an older render is torn down too. */
        var existing = document.getElementById('mkt-seller-swipe-banner');
        if (existing) existing.remove();
        return;
    }

    function _refreshSwipeBanner() {
        var banner = document.getElementById('mkt-seller-swipe-banner');
        if (!banner) return;
        var us = _us();

        if (_isGuest() || !us.id) { banner.style.display = 'none'; return; }
        banner.style.display = 'flex';

        var db = _fbDb();
        var render = function (isVerified, status) {
            banner.classList.toggle('is-verified', !!isVerified);
            banner.classList.toggle('is-pending', !isVerified && status === 'pending');
            if (isVerified) {
                banner.innerHTML =
                    '<span class="msb-text"><i class="fas fa-check-circle" style="color:#1d9bf0;"></i> You\'re a Verified Seller</span>' +
                    '<button type="button" id="mkt-swipe-banner-btn">View My Seller Profile</button>';
            } else if (status === 'pending') {
                banner.innerHTML =
                    '<span class="msb-text"><i class="fas fa-hourglass-half" style="color:#a67200;"></i> Verification under review</span>' +
                    '<button type="button" id="mkt-swipe-banner-btn">Check Status</button>';
            } else {
                banner.innerHTML =
                    '<span class="msb-text"><i class="fas fa-hand-point-left"></i> Swipe left on this page to set up your Seller Profile &amp; get verified</span>' +
                    '<button type="button" id="mkt-swipe-banner-btn">Set Up Seller Profile</button>';
            }
            var btn = document.getElementById('mkt-swipe-banner-btn');
            if (btn) btn.addEventListener('click', function () { _handleMarketplaceSwipeLeft(); });
        };

        if (!db) { render(false, ''); return; }
        db.collection('users').doc(us.id).get().then(function (doc) {
            var u = doc.exists ? (doc.data() || {}) : {};
            _verifiedCache[us.id] = !!u.isVerified;
            render(!!u.isVerified, u.sellerVerificationStatus || '');
        }).catch(function () { render(false, ''); });
    }

    /* =========================================================================
       §CLICK DELEGATION  Opening a seller profile from any card.
       ========================================================================= */
    function _resolveSellerIdFromCard(card, cb) {
        if (card.dataset.sellerId) { cb(card.dataset.sellerId); return; }
        var handleEl = card.querySelector('.property-seller-info strong');
        var handle = handleEl ? handleEl.textContent.replace(/^@/, '').trim() : '';
        var db = _fbDb();
        if (!handle || handle.toLowerCase() === 'seller' || !db) { cb(''); return; }
        db.collection('users').where('username', '==', handle).limit(1).get()
            .then(function (snap) { cb(snap.empty ? '' : snap.docs[0].id); })
            .catch(function () { cb(''); });
    }

    _ready(function () {
        document.addEventListener('click', function (e) {
            var nameEl = e.target.closest('.property-seller-info strong');
            if (nameEl) {
                var card = nameEl.closest('.property-card');
                if (!card) return;
                _resolveSellerIdFromCard(card, function (sellerId) { _openSellerProfile(sellerId); });
                return;
            }
            /* FEATURE (request — "enable job seeker and professional
               service rendering categories to carry or display profile
               page of the applicant too like other cards"): the avatar-
               card variant (Job Seeking/Professional Services/Job
               Vacancy) has no `.property-seller-info strong` element for
               the branch above to match — see the matching markup
               comment in app-marketplace.js's _mktDashboardAvatarCardHTML.
               sellerId is already known and stamped directly onto this
               element (no username lookup needed, unlike
               _resolveSellerIdFromCard above). */
            var avHead = e.target.closest('.mkt-dash-av-head-clickable');
            if (avHead) {
                /* Same cross-listener race as the sellerId branch above
                   (see its comment): app-fixes.js's separate, later-
                   registered `.dashboard-market-card` click handler would
                   otherwise fire navigateTo('marketplace') right after
                   this opens the seller's profile and undo it. */
                if (avHead.closest('#dashboard-market-container')) e._empMktHandled = true;
                _openSellerProfile(avHead.dataset.sellerId || '');
                return;
            }
        });
    });

    /* =========================================================================
       §PREMIUM BADGE  RETIRED (2026-07-28): the verified-seller checkmark is
       restricted to the Seller Profile page (next to the seller's name —
       see mkt-seller-name-row in _renderSellerProfilePage below). It no
       longer appears on the general "My Status" avatar in the app header;
       the markup for that badge has been removed from index.html and its
       CSS from style.css. This is kept as a no-op stub in case anything
       else still calls window._mktRefreshHeaderPremiumBadge.
       ========================================================================= */
    function _refreshHeaderPremiumBadge() {
        var badge = document.getElementById('mkt-premium-seller-badge');
        if (!badge) return; /* element no longer exists — intentionally inert */
    }
    window._mktRefreshHeaderPremiumBadge = _refreshHeaderPremiumBadge;

    /* =========================================================================
       §BOOTSTRAP
       ========================================================================= */
    function _initMarketplaceExtras() {
        _wireMarketplaceSwipe();
        _ensureSwipeBanner();
        _sweepBadges();
        _refreshHeaderPremiumBadge();
    }

    _ready(function () { setTimeout(_initMarketplaceExtras, 500); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_initMarketplaceExtras, 600); });
    document.addEventListener('empyrean-user-ready', function () { setTimeout(_refreshHeaderPremiumBadge, 400); });
    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && ev.detail.section === 'marketplace') setTimeout(_initMarketplaceExtras, 300);
    });

    var _sellersObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes.forEach(function (node) {
                if (!node.querySelectorAll) return;
                node.querySelectorAll('.property-card').forEach(_ensureSellerBadge);
                if (node.classList && node.classList.contains('property-card')) _ensureSellerBadge(node);
            });
        });
    });
    _sellersObserver.observe(document.body, { childList: true, subtree: true });

    console.log('[EmpMarketSellers] ✅ Seller profile page + verified badges + reviews/ratings + swipe-to-verify KYC page active.');

})();