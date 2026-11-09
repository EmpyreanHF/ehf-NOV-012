/* ═══════════════════════════════════════════════════════════════════
   EMPYREAN — NAV PATCH  (v4 — Midnight Navy & Prestige Gold Edition)
   Palette: Deep Navy + Prestige Gold + Royal Blue
   Background:  #0B1437 / #102057 / #1A3380
   Accent:      #F5C518 (gold) / #FFD95A (bright gold)
   Secondary:   #2563EB (royal blue) / #38BDF8 (sky sapphire)
   Text:        #E8F0FF (frost white)
   ═══════════════════════════════════════════════════════════════════ */

:root {
    /* ── Core palette ───────────────────────────────────────────── */
    --nav-bg:               #0B1437;
    --nav-surface:          #102057;
    --nav-surface-2:        #1A3380;

    /* Gold accent (active states, brand) */
    --nav-accent:           #F5C518;
    --nav-accent-light:     #FFD95A;

    /* Royal blue (secondary, admin, info) */
    --nav-blue:             #2563EB;
    --nav-blue-light:       #38BDF8;

    /* Text */
    --nav-text:             #E8F0FF;
    --nav-text-muted:       rgba(232,240,255,0.52);

    /* States */
    --nav-active-bg:        rgba(245,197,24,0.11);
    --nav-active-color:     #FFD95A;
    --nav-icon-active-bg:   rgba(245,197,24,0.20);
    --nav-icon-bg:          rgba(232,240,255,0.07);
    --nav-hover-bg:         rgba(232,240,255,0.06);

    /* Sizes */
    --nav-icon-size:        32px;
    --nav-transition:       0.18s ease;

    /* Mobile nav */
    --mobile-nav-bg:        #0B1437;
    --mobile-nav-active:    #F5C518;
    --mobile-nav-border:    rgba(245,197,24,0.14);
}


/* ═══════════════════════════════════════════════════════════════════
   LOADING SCREEN OVERRIDE
   Replaces the old purple-orange scheme with Midnight Navy + Gold
   ═══════════════════════════════════════════════════════════════════ */

#app-loading-screen {
    background: linear-gradient(145deg, #0B1437 0%, #102057 50%, #0B1437 100%) !important;
    background-size: 100% 100% !important;
    animation: empLoadBgPulse 6s ease-in-out infinite !important;
}

/* Subtle radial overlays — royal blue + gold, no purple/orange */
#app-loading-screen::before {
    content: '' !important;
    position: absolute !important;
    inset: 0 !important;
    background:
        radial-gradient(ellipse 70% 55% at 20% 20%, rgba(37,99,235,0.14) 0%, transparent 65%),
        radial-gradient(ellipse 55% 70% at 80% 80%, rgba(245,197,24,0.10) 0%, transparent 65%),
        radial-gradient(ellipse 40% 40% at 50% 50%, rgba(26,51,128,0.35) 0%, transparent 70%) !important;
    animation: empBgBreath 6s ease-in-out infinite alternate !important;
    pointer-events: none !important;
}

/* Star-particle overlay — cleaner, white + gold + blue */
.loading-particles {
    background-image:
        radial-gradient(1px 1px at 18% 18%, rgba(255,255,255,0.65) 0%, transparent 100%),
        radial-gradient(1px 1px at 82% 78%, rgba(255,255,255,0.45) 0%, transparent 100%),
        radial-gradient(1px 1px at 50% 8%,  rgba(255,255,255,0.55) 0%, transparent 100%),
        radial-gradient(1px 1px at 10% 62%, rgba(255,255,255,0.30) 0%, transparent 100%),
        radial-gradient(1px 1px at 88% 42%, rgba(255,255,255,0.40) 0%, transparent 100%),
        radial-gradient(2px 2px at 33% 77%, rgba(245,197,24,0.55) 0%, transparent 100%),
        radial-gradient(2px 2px at 67% 24%, rgba(37,99,235,0.60) 0%, transparent 100%) !important;
}

/* Outer orbit ring — gold */
#app-loading-screen > div [style*="border:1.5px solid rgba(255,87,34"],
#app-loading-screen > div [style*="border-top:1.5px solid rgba(255,255,255"] {
    border-color: rgba(245,197,24,0.45) !important;
    border-top-color: rgba(255,255,255,0.80) !important;
    box-shadow: 0 0 22px rgba(245,197,24,0.25) !important;
}

/* Middle ring — royal blue */
#app-loading-screen > div [style*="border:1px solid rgba(142,36,170"] {
    border-color: rgba(37,99,235,0.35) !important;
    border-bottom-color: rgba(255,255,255,0.45) !important;
}

/* Core circle — navy gradient, no purple/orange */
#app-loading-screen > div [style*="background:linear-gradient(145deg,rgba(255,255,255,0.12),rgba(91,14,166"] {
    background: linear-gradient(145deg,
        rgba(255,255,255,0.10),
        rgba(26,51,128,0.55),
        rgba(37,99,235,0.35)) !important;
    border-color: rgba(255,255,255,0.28) !important;
    box-shadow:
        0 0 50px rgba(37,99,235,0.60),
        0 0 100px rgba(245,197,24,0.20),
        inset 0 0 30px rgba(255,255,255,0.07) !important;
}

/* Logo polygon facets — royal blue instead of orange */
#app-loading-screen polygon[fill*="255,87,34"] {
    fill: rgba(37,99,235,0.55) !important;
}

/* Loading bar — gold → sky blue → gold */
#loading-bar {
    background: linear-gradient(90deg, #F5C518, #38BDF8, #F5C518) !important;
    background-size: 200% 100% !important;
    box-shadow: 0 0 12px rgba(245,197,24,0.50) !important;
}

/* Brand name gradient — white → bright gold → sky sapphire */
#app-loading-screen h1,
#app-loading-screen [style*="font-family:'Playfair Display'"] {
    background: linear-gradient(135deg,
        #ffffff 0%,
        #FFD95A 40%,
        #38BDF8 75%,
        #ffffff 100%) !important;
    -webkit-background-clip: text !important;
    -webkit-text-fill-color: transparent !important;
    background-clip: text !important;
}

@keyframes empLoadBgPulse {
    0%, 100% { background-position: 0% 50%; }
    50%       { background-position: 100% 50%; }
}
@keyframes empBgBreath {
    0%   { opacity: 0.7; }
    100% { opacity: 1; }
}


/* ═══════════════════════════════════════════════════════════════════
   QUICK-POST FAB — royal blue instead of purple
   ═══════════════════════════════════════════════════════════════════ */
#quick-post-fab {
    background: linear-gradient(135deg, #1A3380, #2563EB) !important;
    box-shadow: 0 4px 18px rgba(37,99,235,0.60), 0 0 0 3px rgba(37,99,235,0.18) !important;
    border-color: rgba(255,255,255,0.35) !important;
}
#quick-post-fab:hover {
    background: linear-gradient(135deg, #2563EB, #38BDF8) !important;
    box-shadow: 0 6px 24px rgba(37,99,235,0.75) !important;
}


/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════════ */

.sidebar {
    background: linear-gradient(180deg, #0B1437 0%, #102057 55%, #0B1437 100%) !important;
    border-right: 1px solid rgba(245,197,24,0.10) !important;
    box-shadow: 4px 0 40px rgba(0,0,0,0.45) !important;
}

/* Brand / logo title */
.sidebar-header h2,
.sidebar-brand-text,
.sidebar .brand-name,
.sidebar-logo span {
    background: linear-gradient(135deg, #FFD95A 0%, #F5C518 50%, #ffffff 100%) !important;
    -webkit-background-clip: text !important;
    -webkit-text-fill-color: transparent !important;
    background-clip: text !important;
    letter-spacing: 2.5px !important;
}

/* Header divider — gold shimmer line */
.sidebar-header::after {
    background: linear-gradient(90deg,
        transparent,
        rgba(245,197,24,0.55),
        transparent) !important;
}


/* ── Strip all emoji pseudo-elements ─────────────────────────────── */
.sidebar-nav li a::before,
.sidebar-nav li a::after,
.mobile-nav-item::before,
.mobile-nav-item::after { font-family: inherit; content: none !important; }


/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR NAV ITEMS
   ═══════════════════════════════════════════════════════════════════ */

.sidebar-nav li { list-style: none !important; margin: 0 !important; }

.sidebar-nav li a {
    display:         flex !important;
    align-items:     center !important;
    padding:         9px 14px !important;
    margin:          2px 10px !important;
    border-radius:   10px !important;
    color:           var(--nav-text-muted) !important;
    font-size:       0.86rem !important;
    font-weight:     500 !important;
    letter-spacing:  0.015em !important;
    border:          none !important;
    text-decoration: none !important;
    gap:             0 !important;
    position:        relative !important;
    transition:      background var(--nav-transition),
                     color var(--nav-transition),
                     box-shadow var(--nav-transition) !important;
    white-space:     nowrap !important;
    overflow:        hidden !important;
}

.sidebar-nav li a:hover {
    background: var(--nav-hover-bg) !important;
    color:      rgba(232,240,255,0.92) !important;
}


/* ── Active state — gold left bar ────────────────────────────────── */
.sidebar-nav li a.active {
    background:  var(--nav-active-bg) !important;
    color:       var(--nav-active-color) !important;
    font-weight: 600 !important;
    box-shadow:
        inset 0 0 0 1px rgba(245,197,24,0.20),
        0 2px 14px rgba(245,197,24,0.08) !important;
}

.sidebar-nav li a.active::before {
    content:       '' !important;
    position:      absolute !important;
    left:          0 !important;
    top:           18% !important;
    bottom:        18% !important;
    width:         3px !important;
    border-radius: 0 3px 3px 0 !important;
    background:    var(--nav-accent) !important;
}


/* ── Icon box ─────────────────────────────────────────────────────── */
.sidebar-nav li a .nav-icon-box {
    width:           var(--nav-icon-size) !important;
    height:          var(--nav-icon-size) !important;
    border-radius:   8px !important;
    background:      var(--nav-icon-bg) !important;
    display:         flex !important;
    align-items:     center !important;
    justify-content: center !important;
    margin-right:    11px !important;
    flex-shrink:     0 !important;
    transition:      background var(--nav-transition),
                     box-shadow var(--nav-transition) !important;
}

.sidebar-nav li a.active .nav-icon-box {
    background: var(--nav-icon-active-bg) !important;
    box-shadow: 0 3px 12px rgba(245,197,24,0.28) !important;
}

.sidebar-nav li a:hover .nav-icon-box {
    background: rgba(232,240,255,0.11) !important;
}

/* Icon inside box */
.sidebar-nav li a .nav-icon-box i,
.sidebar-nav li a .nav-icon-box svg {
    font-size:   0.92rem !important;
    line-height: 1 !important;
    margin:      0 !important;
    width:       auto !important;
    color:       inherit !important;
}

.sidebar-nav li a.active .nav-icon-box i {
    color: var(--nav-accent) !important;
}

/* Direct <i> tags without icon box (legacy) */
.sidebar-nav li a > i:first-child {
    width:           var(--nav-icon-size) !important;
    height:          var(--nav-icon-size) !important;
    display:         flex !important;
    align-items:     center !important;
    justify-content: center !important;
    font-size:       0.92rem !important;
    margin-right:    11px !important;
    flex-shrink:     0 !important;
    border-radius:   8px !important;
    background:      var(--nav-icon-bg) !important;
}

.sidebar-nav li a.active > i:first-child {
    background: var(--nav-icon-active-bg) !important;
    box-shadow: 0 3px 12px rgba(245,197,24,0.28) !important;
    color:      var(--nav-accent) !important;
}


/* ═══════════════════════════════════════════════════════════════════
   MOBILE BOTTOM NAV — Facebook-style (white bg, blue active, badges)
   ═══════════════════════════════════════════════════════════════════ */

#mobile-bottom-nav {
    position:        fixed !important;
    bottom:          0 !important;
    left:            0 !important;
    right:           0 !important;
    background:      #ffffff !important;
    border-top:      1px solid rgba(0,0,0,0.12) !important;
    display:         flex !important;
    align-items:     stretch !important;
    justify-content: space-around !important;
    z-index:         9990 !important;
    height:          60px !important;
    padding:         0 !important;
    padding-bottom:  env(safe-area-inset-bottom, 0px) !important;
    box-shadow:      0 -2px 12px rgba(0,0,0,0.08) !important;
    overflow-x:      auto !important;
    scrollbar-width: none !important;
}
#mobile-bottom-nav::-webkit-scrollbar { display: none; }

.mobile-nav-item {
    flex:            1 0 52px !important;
    min-width:       52px !important;
    max-width:       96px !important;
    display:         flex !important;
    flex-direction:  column !important;
    align-items:     center !important;
    justify-content: center !important;
    background:      none !important;
    border:          none !important;
    cursor:          pointer !important;
    padding:         6px 4px !important;
    gap:             2px !important;
    color:           #65676b !important;
    font-size:       0.58rem !important;
    font-weight:     600 !important;
    min-height:      60px !important;
    border-radius:   0 !important;
    letter-spacing:  0.01em !important;
    transition:      color 0.15s !important;
    white-space:     nowrap !important;
    position:        relative !important;
    -webkit-tap-highlight-color: transparent !important;
}

.mobile-nav-item i,
.mobile-nav-item svg {
    font-size:     1.45rem !important;
    line-height:   1 !important;
    margin-bottom: 0 !important;
    color:         #65676b !important;
    transition:    color 0.15s !important;
}

.mobile-nav-item span {
    font-size:     0.58rem !important;
    white-space:   nowrap !important;
    overflow:      hidden !important;
    text-overflow: ellipsis !important;
    max-width:     100% !important;
    color:         #65676b !important;
}

.mobile-nav-item.active {
    color:       #1877f2 !important;
    border-top:  3px solid #1877f2 !important;
}

.mobile-nav-item.active i {
    color: #1877f2 !important;
    filter: none !important;
}

.mobile-nav-item.active > span {
    color: #1877f2 !important;
}

.mobile-nav-item *::before,
.mobile-nav-item *::after { content: none !important; }

/* Icon + badge wrapper */
.v8-nav-icon-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

/* Notification badge */
.v8-nav-badge {
    position:   absolute !important;
    top:        -5px !important;
    right:      -8px !important;
    background: #e41e3f !important;
    color:      white !important;
    font-size:  0.58rem !important;
    font-weight:700 !important;
    min-width:  16px !important;
    height:     16px !important;
    padding:    0 3px !important;
    border-radius: 10px !important;
    display:    flex !important;
    align-items:center !important;
    justify-content:center !important;
    border:     1.5px solid #fff !important;
    line-height:1 !important;
}

/* Profile avatar in nav */
.v8-nav-avatar {
    width:        28px !important;
    height:       28px !important;
    border-radius:50% !important;
    object-fit:   cover !important;
    border:       2px solid transparent !important;
    display:      block !important;
}
.mobile-nav-item.active .v8-nav-avatar {
    border-color: #1877f2 !important;
}


/* ═══════════════════════════════════════════════════════════════════
   MOBILE HAMBURGER TOGGLE
   ═══════════════════════════════════════════════════════════════════ */

.mobile-menu-toggle {
    display:         none;
    position:        fixed;
    top:             12px;
    left:            12px;
    width:           40px;
    height:          40px;
    align-items:     center;
    justify-content: center;
    background:      #0B1437 !important;
    color:           #E8F0FF !important;
    border:          1px solid rgba(245,197,24,0.30) !important;
    border-radius:   10px !important;
    z-index:         9998;
    cursor:          pointer;
    box-shadow:      0 4px 18px rgba(0,0,0,0.40) !important;
    font-size:       1rem !important;
}

@media (max-width: 992px) {
    .mobile-menu-toggle { display: flex !important; }
    .sidebar {
        transform: translateX(-100%);
        transition: transform 0.26s ease !important;
    }
    .sidebar.open {
        transform: translateX(0) !important;
        box-shadow: 8px 0 40px rgba(0,0,0,0.50) !important;
    }
    .main-content { margin-left: 0 !important; }
}


/* ═══════════════════════════════════════════════════════════════════
   SECTION FADE-IN
   ═══════════════════════════════════════════════════════════════════ */

.content-section { display: none; animation: empNavFadeIn 0.20s ease; }
.content-section.active { display: block !important; }

@keyframes empNavFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0);   }
}


/* ═══════════════════════════════════════════════════════════════════
   LAYOUT HELPERS
   ═══════════════════════════════════════════════════════════════════ */

.main-content {
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px)) !important;
}

/* App body background — light blue-white instead of harsh grey */
body {
    background: #F0F4FF !important;
}


/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR SEARCH BOX
   ═══════════════════════════════════════════════════════════════════ */

#sidebar-search-input,
.sidebar-search input {
    background:    rgba(232,240,255,0.06) !important;
    border:        1px solid rgba(245,197,24,0.14) !important;
    color:         var(--nav-text) !important;
    border-radius: 10px !important;
}
#sidebar-search-input::placeholder,
.sidebar-search input::placeholder {
    color: var(--nav-text-muted) !important;
}
#sidebar-search-input:focus,
.sidebar-search input:focus {
    border-color: rgba(245,197,24,0.50) !important;
    outline:      none !important;
    box-shadow:   0 0 0 3px rgba(245,197,24,0.09) !important;
}


/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR SCROLLBAR
   ═══════════════════════════════════════════════════════════════════ */

.sidebar::-webkit-scrollbar { width: 4px; }
.sidebar::-webkit-scrollbar-thumb {
    background:    rgba(245,197,24,0.20);
    border-radius: 4px;
}
.sidebar::-webkit-scrollbar-track { background: transparent; }


/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR SOCIAL LINKS FOOTER
   ═══════════════════════════════════════════════════════════════════ */

.sidebar .social-links a {
    color:      rgba(232,240,255,0.42) !important;
    transition: color 0.15s !important;
}
.sidebar .social-links a:hover {
    color: var(--nav-accent) !important;
}


/* ═══════════════════════════════════════════════════════════════════
   ACCENT / BUTTON OVERRIDES — swap purple out for royal blue
   ═══════════════════════════════════════════════════════════════════ */

/* Buttons that were purple-gradient */
.btn-accent,
button.btn-accent {
    background: linear-gradient(135deg, #1A3380, #2563EB) !important;
    color: #fff !important;
    border: none !important;
    box-shadow: 0 4px 16px rgba(37,99,235,0.35) !important;
}
.btn-accent:hover,
button.btn-accent:hover {
    background: linear-gradient(135deg, #2563EB, #38BDF8) !important;
    box-shadow: 0 6px 22px rgba(37,99,235,0.50) !important;
}

/* Admin PIN overlay accent */
#admin-pin-overlay h3 { color: var(--nav-accent) !important; }
.pin-dot { border-color: var(--nav-accent) !important; }
.pin-dot.filled { background: var(--nav-accent) !important; }

/* KYC / Settings active tab */
.kyc-entity-btn.active,
.settings-tab.active {
    background: #102057 !important;
    color: #FFD95A !important;
    box-shadow: 0 2px 12px rgba(37,99,235,0.25) !important;
}

/* Profile active tab underline */
.profile-tab.active {
    border-bottom: 3px solid var(--nav-accent) !important;
    color: #0B1437 !important;
    font-weight: 700 !important;
}

/* Live action buttons */
.live-action-btn:hover {
    background: rgba(245,197,24,0.18) !important;
    border-color: rgba(245,197,24,0.40) !important;
}

/* Gift button */
.gift-button {
    background: linear-gradient(135deg, #F5C518, #FFD95A) !important;
    color: #0B1437 !important;
}

/* Message bubbles */
.message-bubble.sent {
    background: linear-gradient(135deg, #102057, #1A3380) !important;
    color: white !important;
}

/* Media upload button */
.btn-media-upload {
    background: rgba(37,99,235,0.06) !important;
    color: #2563EB !important;
    border: 1.5px dashed rgba(37,99,235,0.25) !important;
}
.btn-media-upload:hover {
    background: rgba(37,99,235,0.11) !important;
    border-color: #2563EB !important;
}

/* Table headers in admin/grant */
.grant-table th {
    background: #102057 !important;
    color: #FFD95A !important;
}

/* Contact item active */
.contact-item.active {
    background: rgba(37,99,235,0.06) !important;
    border-left: 3px solid #2563EB !important;
}

/* Form feedback links */
.form-feedback.info {
    background: rgba(37,99,235,0.06) !important;
    border-color: #2563EB !important;
    color: #1A3380 !important;
}