// =====================================================
// APP-GIFTS.JS  —  Empyrean Platform  (Module 0.13)
// Covers: EMPY gift catalog, full-screen catalog modal,
//         quick-send side tab, gift animations (standard
//         + Heart Mills), send-gift handler, recipient
//         crediting, live-goal update integration, and
//         (SECTION 11, new) the profile/birthday "Send a
//         Gift" catalog — the same EMPY-token economy,
//         reused outside of live streaming.
// Depends on: app-state.js, app-wallet.js, app-live.js
// =====================================================
(function initGiftsModule() {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // SECTION 1: Gift Catalog Data
    // Single source of truth — re-exposed on window so any module
    // that loads before or after this one can read it.
    //
    // ICON SET ("real, beautiful, TikTok-style" request):
    // The previous icon set was a small in-house line-art SVG library.
    // Its 'Rose' entry drew a circle + straight stem + one diagonal
    // "thorn" line — which is exactly a padlock-key silhouette once
    // rendered at small size, not a rose. That's why gifts showed up
    // looking like a key in the catalog, quick-send tab and live
    // comment feed (see screenshots): the icon itself was wrong, not
    // a CSS/sizing bug.
    //
    // FIX: replaced the whole hand-drawn line-icon set with real,
    // full-color native emoji glyphs — the same approach TikTok's own
    // "basic" gift tier (Rose, Heart, Like, etc.) effectively renders
    // as: a recognisable, full-color picture of the actual object,
    // not an abstract outline. Modern Android/Chrome/iOS all render
    // these via the system's built-in color emoji font (no external
    // asset/CDN dependency, so nothing to break like the Font Awesome
    // CDN issues elsewhere in this codebase), and every shape here is
    // a real, unambiguous drawing of its name (a rose looks like a
    // rose, a crown looks like a crown, etc).
    //
    // `symbol` is a plain string (was previously an HTML/SVG string).
    // Every call site already does `el.innerHTML = gift.symbol`
    // (kept that way — harmless for plain text, and some legacy
    // callers still pass old SVG markup through the same code path),
    // so no call sites needed to change.
    // ─────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────
    // Premium Rose artwork — original, hand-built SVG (gradient-shaded
    // petals + stem/leaf), not a copy of TikTok's own rose asset. Used
    // everywhere the flat 🌹 glyph used to appear (catalog, quick-send
    // tab, footer quick-rose button, chat gift line) so the single most
    // important gift — the one people tap constantly — reads as a real
    // dimensional illustration instead of a plain emoji character.
    //
    // BUG FIX ("rose renders as a tiny dot"): the gradients used to be
    // declared inside a local <defs> INSIDE the rose SVG markup itself,
    // and that same markup string gets dropped into the page many times
    // over (catalog card, quick-send tab, footer button, every chat
    // gift line...). SVG element IDs are global to the whole document,
    // not scoped to their own <svg>, so every extra copy created a
    // second/third/Nth element with the exact same id="tkRosePetal" —
    // an illegal duplicate. Browsers resolve url(#tkRosePetal) against
    // whichever element with that id they find (often not the "local"
    // one), so the big gradient-filled petal shape silently failed to
    // paint (rendered as invisible/black-on-black) almost everywhere,
    // leaving only the small solid-color highlight ellipse visible —
    // exactly the "tiny dot" seen in the screenshot.
    //
    // FIX: the gradients are now defined exactly ONCE, in a hidden
    // sprite-sheet <svg> injected into <body> on module load (see
    // _ensureRoseGradientDefs below). Every rose instance references
    // those same two ids via url(#tkRosePetal) / url(#tkRoseStem) but
    // never redeclares them, so there's only ever one definition per id
    // no matter how many roses are on screen at once.
    // ─────────────────────────────────────────────────────────────
    function _ensureRoseGradientDefs() {
        if (document.getElementById('tk-rose-gradient-defs')) return;
        const wrap = document.createElement('div');
        wrap.id = 'tk-rose-gradient-defs';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
        wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
            '<radialGradient id="tkRosePetal" cx="38%" cy="32%" r="75%">' +
                '<stop offset="0%" stop-color="#ff8fa3"/>' +
                '<stop offset="35%" stop-color="#f43f5e"/>' +
                '<stop offset="70%" stop-color="#c81e42"/>' +
                '<stop offset="100%" stop-color="#7a0e26"/>' +
            '</radialGradient>' +
            '<linearGradient id="tkRoseStem" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0%" stop-color="#5fbf5a"/>' +
                '<stop offset="100%" stop-color="#1f6d2a"/>' +
            '</linearGradient>' +
        '</defs></svg>';
        (document.body || document.documentElement).appendChild(wrap);
    }
    if (document.body) {
        _ensureRoseGradientDefs();
    } else {
        document.addEventListener('DOMContentLoaded', _ensureRoseGradientDefs);
    }

    const PREMIUM_ROSE_SVG = '<svg class="tk-premium-rose" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M30 34 C27 44 27 52 24 60" fill="none" stroke="url(#tkRoseStem)" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path d="M27 46 C22 45 18 48 16 53 C21 53 25 51 27 46 Z" fill="#2f8c3a"/>' +
        '<g transform="translate(32 26)">' +
            '<path d="M0 -20 C13 -20 20 -10 20 0 C20 12 10 21 0 21 C-10 21 -20 12 -20 0 C-20 -10 -13 -20 0 -20 Z" fill="url(#tkRosePetal)"/>' +
            '<path d="M0 -13 C8 -13 13 -6 13 1 C13 9 6 15 0 15 C-4 15 -8 12 -8 7 C-8 3 -4 2 0 4 C3 5 5 3 4 -1 C3 -5 -2 -6 -6 -3 C-9 -1 -10 -6 -6 -10 C-3 -13 2 -14 0 -13 Z" fill="#ffb3c1" opacity="0.85"/>' +
            '<ellipse cx="-7" cy="-9" rx="4.5" ry="2.6" fill="#ffe1e8" opacity="0.65" transform="rotate(-30 -7 -9)"/>' +
        '</g>' +
    '</svg>';
    window.tkPremiumRoseSVG = PREMIUM_ROSE_SVG;

    // FIX ("rose turns into a gear-ball icon when tapped/re-rendered"):
    // populateGiftCatalog() below is the ACTUAL single source of truth
    // for what every gift tile renders as — it wipes and rebuilds
    // #gift-grid-container from GIFT_ICONS/EMPY_GIFT_CATALOG on every
    // load, tab switch, and balance refresh (see SECTION 4). It was
    // using PREMIUM_ROSE_SVG above for Rose, which is exactly the
    // gradient-shaded SVG already documented a few lines up as having
    // rendered as "a tiny dot" once before, from its gradient defs
    // failing to resolve — the same failure mode produces a dark,
    // lobed, gradient-less blob at 32-48px, which reads as a gear/cog,
    // not a rose. app-live-tiktok-patch.js separately swaps in a known-
    // good PNG rose image (TK_ROSE_IMG) after the catalog modal opens,
    // but only ONCE, on that first open — any later rebuild by THIS
    // function (e.g. the one that runs after tapping a tile) reverts
    // straight back to the fragile SVG above, which is the exact bug
    // reported. Using that same proven PNG here, at the real source of
    // truth, means every rebuild renders it correctly, not just the
    // first one. Identical base64 asset to the one already used
    // reliably for the footer rose button, the guest-request icon, and
    // the "sent Rose" gift-comment rows (see app-live-tiktok-patch.js).
    const ROSE_IMG_DATA_URI = 'data:image/png;base64,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';
    const ROSE_IMG_HTML = '<img class="tk-rose-img" src="' + ROSE_IMG_DATA_URI + '" alt="Rose">';

    // Empy Token (platform coin) gift icon.
    //
    // FIX (reported: "coin sitting in a dark square" in the Send-a-Gift
    // catalog, unlike Rose which has no background at all): this was
    // NOT a CSS/background-color issue — .tk-emoji-3d's own "3D orb"
    // background (see that class's rule below) is the same light glass
    // gradient behind both Rose and Token, and was never dark enough to
    // produce the solid black square seen in the screenshot. The actual
    // cause was the source asset itself: this was previously a JPEG
    // (data:image/jpeg — no alpha channel, so every pixel including the
    // corners around the coin is fully opaque, exported with a solid
    // near-black backing fill baked into the pixel data), while
    // ROSE_IMG_DATA_URI above has always been a PNG with real
    // transparency — that's why only the token showed a dark box and
    // the rose never did. Re-exported this asset as a PNG with the
    // near-black background colour-keyed to transparent (edges checked
    // against both a dark-navy and a bright-magenta test background —
    // no dark fringe/halo). Only the coin's own pixels now render.
    //
    // NOTE: TK_TOKEN_IMG in app-live-tiktok-patch.js (used for the
    // separate support-nudge card, not the gift catalog) is its own
    // deliberately-independent local copy of the OLD jpeg asset — see
    // that file's own comment for why it's not shared with this one.
    // It was NOT touched here since the nudge card wasn't the reported
    // location; if the same dark-box look shows up there too, it needs
    // the identical PNG swap applied to that file's own copy.
    const EMPY_TOKEN_IMG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANwAAADcCAMAAAAshD+zAAADAFBMVEUFBQaTZhCIWAh0SAK0hyyrdxLRqEjImDJpOADRpTWoeSd6UwjnuU/vxlFRKADZtE741nAqGgY3Iwf85oq1hRTwyGmnagsuHAZWNQUiFQebchXImkbIiBG7kzPotzMZEgfOlRWGSwEmFwY1HAQVEAf++ZGSaSUdFAj+5XWZcyj++6vGiy7numVIGwD31VP32ofkqS/GeQcbCgDvxDZjLADZszP/9XXWpRa5lUezikTirEmlWwFvWCj766khCgBYQxPXtWZ2ZC4lDADnqBUsIAikbCUqDADkmhPlmynntRggEgMeDQDUqmT50Tr//cKHWiLWsxeVh1G7lBbHagH941q2p2rYw3PUyYouDQDBi0TcwlOCPQCJeEceGAs8MQtZSCPjihLxzIJOOSNlTSa7oVTFfSTxwRl9YBE8CwBbUigmIQp4ZkJ6cTCegTi8s3fb0YrmrWE1DABDDwCck1SlTQCsf0Okl2LknEDp2qFZUh5/cE+Ga0CagRy9sYHHvYzewDzgiicAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQKmPKAAABAHRSTlMA/////////////////////6/7/////83/bv//////Lv//jfET//9L/////////////y3//////////////1D///9v/8//jf///1lE////////////////q/////9l//////////////r/s////////9j///////////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAw0+P2wAAQ5RJREFUeNrtvYd/20jSLapOaGRCIkBBAEGTkkWTJqlgSaNgj+N4PGnv5Nmcw5fDzffF+/70d06DCvbM7lvZHo/3/l5blkjJonFYVadOVQesrPz/41XGTX66ceN/GTg3lw9uPP/04jt/4wMgbty8+vy91Vu3Vtc2/tew3q32y8Zq+ejz//b11//64x9/882Pf/zw6/88/ed/jtY21/9mYd6g0W6896t/+Pz/+vFu9/bt29vbt7vd7S7G9jYffPP11794dO/B2ubm5p2/PQL55dq9r4nqdnc5Mnzgb3fSvRi7D0+m4+hBubb+t4TwZvmLH797e/sSRvfqY4cryxzUbub9y1RECgjfenyOFn/1+f/97qXFurvFQ+9E6+m0CrXW1ut0imyXP5gA32Qy6Rae1n+ngO9Xm28zNHDIP/76X3dbZNuA1TnRIoqU75e+woj4CY8iwAREOqozYBY3VUXzleX6nbcuws4fvPfox7e3WxcsvDBSJUBFUhiYrGmCwGJoXQn4ofIjEXrFbneXCLuTwsO3BX9jbf2tJJHNXyyN1i1OBC5TyanWdQcjjvm547m/HoZtjKQpK29pwMkk6zRCufEgfWvSxDKfrWz84n/chh22iQxuGE2153Vih8hLOp0kucAX4wcBEWpBF/UKF35ZVgTGGBkx/Mqtt8Q9f0mAtx6BH5HSut4UNpM0WGstfKHdkiC4/IazHT95tZ5GkdAdQsPf2BoXl3iJcuttyA/Ocg/+lQ55e/ck8lNVNZ7zxICgaKvESyYdEQBUJykEf9piaz9pOKjwsgngTYqONkJGGAC4tvk2oNv8z+8y1ghNKXgjgDlHJFU0quPFtEykabZk2yqEXaaFs5wHlvFqiwAEPGe9AtEYRfhQ0b0H5eoPziT/2785GvlDlJZCew4C/jo5UjwUJQwYZ0VXR4w4omw6na4uGxd2QOfZmuEXER59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';
    const EMPY_TOKEN_IMG_HTML = '<img class="tk-empy-token-img" src="' + EMPY_TOKEN_IMG_DATA_URI + '" alt="Empy Token">';

    // PREMIUM Like / Heart icons (2026-11-08). The live gift feed showed the plain 👍 / ❤️ emoji at about half the size of the
    // Empy Token / Rose pictures (an emoji glyph in a 38px box vs a 38px image), so those two rows looked smaller and cheaper than
    // their neighbours. Both are now self-contained SVG images (no icon-font or emoji-font dependency) -- a gold gradient thumb and a
    // ruby gradient heart with a soft gloss -- rendered through the same <img> path as Rose/Token so every context (catalog tile,
    // floating animation, chat-feed row) can give them the same box size.
    const PREMIUM_LIKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF4C2"/><stop offset="0.45" stop-color="#F6C945"/><stop offset="1" stop-color="#B9830B"/></linearGradient>' +
        '<linearGradient id="ls" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.6"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>' +
        '<g transform="translate(6 7) scale(2.17)">' +
        '<path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" fill="url(#lg)" stroke="#8A5A00" stroke-width="0.55" stroke-linejoin="round"/>' +
        '<path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" fill="url(#ls)"/>' +
        '</g></svg>';
    const PREMIUM_HEART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF9DB0"/><stop offset="0.45" stop-color="#E5194F"/><stop offset="1" stop-color="#8C0A2C"/></linearGradient>' +
        '<linearGradient id="hs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.65"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>' +
        '<g transform="translate(5 6) scale(2.25)">' +
        '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="url(#hg)" stroke="#6A0620" stroke-width="0.5" stroke-linejoin="round"/>' +
        '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="url(#hs)"/>' +
        '</g></svg>';
    const LIKE_IMG_HTML  = '<img class="tk-premium-gift-img tk-like-img" src="data:image/svg+xml;utf8,' + encodeURIComponent(PREMIUM_LIKE_SVG) + '" alt="Like">';
    const HEART_IMG_HTML = '<img class="tk-premium-gift-img tk-heart-img" src="data:image/svg+xml;utf8,' + encodeURIComponent(PREMIUM_HEART_SVG) + '" alt="Heart">';

    const GIFT_ICONS = {
        'Empy Token':      EMPY_TOKEN_IMG_HTML,
        'Rose':            ROSE_IMG_HTML,
        'Like':             LIKE_IMG_HTML,
        'Heart':            HEART_IMG_HTML,
        'Coffee':           '☕',
        'Star':             '⭐',
        'Chocolate':        '🍫',
        'Ice Cream':        '🍦',
        'Balloon':          '🎈',
        'Gift Box':         '🎁',
        'Cupcake':          '🧁',
        'Candy':            '🍬',
        'Birthday Cake':    '🎂',
        'Teddy Bear':       '🧸',
        'Pizza Slice':      '🍕',
        'Popcorn':          '🍿',
        'Music Note':       '🎵',
        'Flower Bouquet':   '💐',
        'Football':         '⚽',
        'Sunglasses':       '🕶️',
        'Perfume':          '🧴',
        'Cat':              '🐱',
        'Dog':              '🐶',
        'Hat & Mustache':   '🤠',  // NEW 2026-10-12 — AR gift: hat + moustache that follow the host's face (see empHatMustacheEngine())
        'Diamond Ring':     '💍',
        'Camera':           '📷',
        'Champagne':        '🍾',
        'Heart Mills':      '💖',
        'Guitar':           '🎸',
        'Laptop':           '💻',
        'Gold Medal':       '🥇',
        'Airplane':         '✈️',
        'Luxury Watch':     '⌚',
        'Car':              '🚗',
        'Yacht':            '🛥️',
        'Mansion':          '🏰',
        'Helicopter':       '🚁',
        'Private Jet':      '🛩️',
        'Crown':            '👑',
        'Island':           '🏝️',
        'Diamond Trophy':   '🏆',
        'Money Gun':        '💸',  // NEW 2026-10-10 — full-screen banknote animation, see empMoneyGunEngine()
        'Under Control':    '🎮',  // NEW 2026-10-10 — full-screen 3D gamer video gift (shared video engine)
        'Empyrean Lion':    '🦁',  // NEW 2026-10-10 — full-screen 3D lion video gift (shared video engine)
        'Universe':         '🌌',  // NEW 2026-10-10 — full-screen 3D cinematic video gift, see empUniverseEngine()
        'Penlight':'🔦',  // NEW 2026-10-10 — full-screen 3D concert penlight video gift (shared video engine)
        'Empyrean Castle':  '👸',  // NEW 2026-10-10 — full-screen 3D fairytale castle video gift (shared video engine)
        'Empyrean Helicopter': '🚁', // NEW 2026-10-10 — full-screen 3D helicopter video gift (shared video engine)
        'Empyrean Jet':     '🛫',  // NEW 2026-10-10 — full-screen 3D airliner video gift (shared video engine)
        'Empyrean Yacht':   '⛵',  // NEW 2026-10-10 — full-screen 3D yacht video gift (shared video engine)
        'Diamond Palace':   '💎',  // NEW 2026-10-10 — full-screen 3D crystal palace video gift (shared video engine)
        'Diamond SUV':      '🚙',  // NEW 2026-10-11 — full-screen 3D diamond-studded SUV video gift (shared video engine)
        'Diamond Guitar':   '🎸',  // NEW 2026-10-11 — full-screen 3D crystal guitar video gift (shared video engine)
        'Empyrean Connect': '💻',  // NEW 2026-10-11 — full-screen 3D laptop/dancers video gift (shared video engine)
        'Empyrean Chronometer': '⌚',  // NEW 2026-10-11 — full-screen 3D luxury watch video gift (shared video engine)
        'Empyrean Gold Coin': '🪙',  // NEW 2026-10-11 — full-screen 3D golden EMPY coin video gift (shared video engine)
        'Empyrean Champions Cup': '🏆',  // NEW 2026-10-11 — full-screen 3D diamond trophy video gift (shared video engine)
        'Empyrean Arena': '🏟️',          // NEW 2026-10-11 — full-screen 3D crystal stadium video gift (shared video engine)
        'Empyrean Bouquet': '💐',        // NEW 2026-10-11 — full-screen 3D bouquet video gift (shared video engine)
        'Empyrean Teddy': '🧸',          // NEW 2026-10-11 — full-screen 3D teddy bear video gift (shared video engine)
        'Empyrean Cake': '🎂',           // NEW 2026-10-11 — full-screen 3D celebration cake video gift (shared video engine)
        'Empyrean Cinema': '🎥',         // NEW 2026-10-11 — full-screen 3D cinema camera video gift (shared video engine)
        'Empyrean Ring': '💍',           // NEW 2026-10-11 — full-screen 3D diamond ring video gift (shared video engine)
        'Empyrean Diamond Island': '🏝️',  // NEW 2026-10-11 — full-screen 3D diamond island video gift, 20s clip (shared video engine)
        'Empyrean Movie Night': '🍿',  // NEW 2026-10-12 — full-screen 3D Movie Night video gift (shared video engine)
        'Empyrean Dance': '💃',  // NEW 2026-10-12 — full-screen 3D Dance video gift (shared video engine)
        'Empyrean Victory': '🥇',  // NEW 2026-10-12 — full-screen 3D Victory video gift (shared video engine)
        'Empyrean Shepherd': '🐕',  // NEW 2026-10-12 — full-screen 3D Shepherd video gift (shared video engine)
        'Empyrean Shades': '🕶️',  // NEW 2026-10-12 — full-screen 3D Shades video gift (shared video engine)
        'Victory': '🏅',  // NEW 2026-10-17 — full-screen 3D Victory video gift (shared video engine)
        'Fruit Bowl': '🍇',  // NEW 2026-10-12 — full-screen 3D Fruit Bowl video gift (shared video engine)
        'Royal Drum': '🥁',  // NEW 2026-10-12 — full-screen 3D Royal Drum video gift (shared video engine)
        'Swallow': '🍲'      // NEW 2026-10-13 — full-screen 3D Swallow & soup video gift (shared video engine)
    };

    // Rarity tier per gift — drives the card glow/border colour so the
    // catalog reads visually like TikTok's Common/Rare/Epic/Legendary
    // gift tiers instead of every gift looking the same.
    // NEW 2026-10-13 — DISPLAY ONLY: the catalog shows the gift's own name without the "Empyrean " prefix
    // ("Empyrean Lion" -> "Lion"). The real gift name/id is untouched, so sending, prices, animations, clips,
    // history and every stored record keep working exactly as before.
    function _giftLabel(name) { return String(name == null ? '' : name).replace(/^Empyrean\s+/i, ''); }
    window.empGiftLabel = _giftLabel;

    function _tierForPrice(price) {
        if (price >= 1000) return 'legendary';
        if (price >= 120)  return 'epic';
        if (price >= 25)   return 'rare';
        return 'basic';
    }

    // 2026-10-10: the old emoji Yacht / Mansion / Helicopter / Private Jet tiles were removed from this list because the 3D video
    // gifts (Empyrean Yacht / Castle / Helicopter / Jet) replace them. Their GIFT_ICONS entries above are KEPT on purpose so old
    // gift history / chat lines that already reference those names still render an icon.
    // 2026-10-12 PRICING RULE for the 3D video gifts: priced on the TikTok gift ladder (Rose 1 ... Corgi 299 ... Galaxy 1,000 ... Lion 29,999 ... Universe 34,999),
    // so nothing here exceeds TikTok's top gift. Within that ladder the order follows each item's real-life worth, NOT release date.
    // Classic gifts untouched.
    // 2026-10-12: entries flagged liveHidden are NOT shown in the live-stream gift catalog (the 3D video gifts replace them).
    // They stay in this list on purpose so the profile/birthday gift picker (_pgByNames) and old gift history keep working.
    const EMPY_GIFT_CATALOG = [
        // ── Tier 1: Micro (1–20 EMPY) ──
        { name: 'Empy Token',     symbol: GIFT_ICONS['Empy Token'],     price: 1   },
        { name: 'Rose',           symbol: GIFT_ICONS['Rose'],           price: 1   },
        { name: 'Like',           symbol: GIFT_ICONS['Like'],           price: 2   },
        { name: 'Heart',          symbol: GIFT_ICONS['Heart'],          price: 3   },
        { name: 'Coffee',         symbol: GIFT_ICONS['Coffee'],         price: 5   },
        { name: 'Star',           symbol: GIFT_ICONS['Star'],           price: 7, liveHidden: true },   // 2026-10-13: hidden from the live catalog (kept in the list so old gift history / profile picker still work)
        { name: 'Chocolate',      symbol: GIFT_ICONS['Chocolate'],      price: 10  },
        { name: 'Ice Cream',      symbol: GIFT_ICONS['Ice Cream'],      price: 12  },
        { name: 'Balloon',        symbol: GIFT_ICONS['Balloon'],        price: 15  },
        { name: 'Gift Box',       symbol: GIFT_ICONS['Gift Box'],       price: 16  },
        { name: 'Cupcake',        symbol: GIFT_ICONS['Cupcake'],        price: 18  },
        { name: 'Candy',          symbol: GIFT_ICONS['Candy'],          price: 20  },
        { name: 'Birthday Cake',  symbol: GIFT_ICONS['Birthday Cake'],  price: 22, liveHidden: true },
        // ── Tier 2: Small (25–100 EMPY) ──
        { name: 'Teddy Bear',     symbol: GIFT_ICONS['Teddy Bear'],     price: 25, liveHidden: true },
        { name: 'Pizza Slice',    symbol: GIFT_ICONS['Pizza Slice'],    price: 30  },
        { name: 'Popcorn',        symbol: GIFT_ICONS['Popcorn'],        price: 35, liveHidden: true },
        { name: 'Music Note',     symbol: GIFT_ICONS['Music Note'],     price: 40, liveHidden: true },
        { name: 'Flower Bouquet', symbol: GIFT_ICONS['Flower Bouquet'], price: 50  },
        { name: 'Football',       symbol: GIFT_ICONS['Football'],       price: 60 },  // 2026-10-13: plays its own 3D clip now, so it is shown in the live catalog again (was liveHidden)
        { name: 'Sunglasses',     symbol: GIFT_ICONS['Sunglasses'],     price: 70, liveHidden: true },
        { name: 'Perfume',        symbol: GIFT_ICONS['Perfume'],        price: 80  },
        { name: 'Cat',            symbol: GIFT_ICONS['Cat'],            price: 90, liveHidden: true },
        // NEW 2026-10-12 — AR gift: the host WEARS a cowboy hat + moustache that track their face (see empHatMustacheEngine()).
        // PRICE IS A PLACEHOLDER: change this one number to whatever EMPY amount you want it to cost.
        { name: 'Hat & Mustache', symbol: GIFT_ICONS['Hat & Mustache'], price: 99  },
        { name: 'Dog',            symbol: GIFT_ICONS['Dog'],            price: 100, liveHidden: true },
        // ── Tier 3: Mid (120–999 EMPY) ──
        { name: 'Diamond Ring',   symbol: GIFT_ICONS['Diamond Ring'],   price: 120 },
        { name: 'Camera',         symbol: GIFT_ICONS['Camera'],         price: 150, liveHidden: true },
        { name: 'Champagne',      symbol: GIFT_ICONS['Champagne'],      price: 180, liveHidden: true },
        // NEW 2026-10-10 — plays the 10-second 3D Penlight concert video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (concert light stick ≈ TikTok Passion Rose tier (199)); order follows real-life worth, not release date.
        { name: 'Penlight', symbol: GIFT_ICONS['Penlight'], price: 199 },   // RENAMED 2026-10-14 from 'Empyrean Penlight' (prefix removed)
        { name: 'Heart Mills',    symbol: GIFT_ICONS['Heart Mills'],    price: 200 },
        { name: 'Guitar',         symbol: GIFT_ICONS['Guitar'],         price: 200, liveHidden: true },
        { name: 'Laptop',         symbol: GIFT_ICONS['Laptop'],         price: 250, liveHidden: true },
        // NEW 2026-10-12 — plays the 10-second 3D Empyrean Movie Night video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (cinema date ≈ TikTok Corgi tier (299)); order follows real-life worth, not release date.
        { name: 'Empyrean Movie Night', symbol: GIFT_ICONS['Empyrean Movie Night'], price: 299 },
        { name: 'Gold Medal',     symbol: GIFT_ICONS['Gold Medal'],     price: 300, liveHidden: true },
        { name: 'Airplane',       symbol: GIFT_ICONS['Airplane'],       price: 350, liveHidden: true },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Cake video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (celebration cake, low mid-tier); order follows real-life worth, not release date.
        { name: 'Empyrean Cake', symbol: GIFT_ICONS['Empyrean Cake'], price: 399 },
        { name: 'Luxury Watch',   symbol: GIFT_ICONS['Luxury Watch'],   price: 400, liveHidden: true },
        { name: 'Car',            symbol: GIFT_ICONS['Car'],            price: 450, liveHidden: true },
        // NEW 2026-10-12 — plays the 10-second 3D Fruit Bowl video full-screen on every device (see empUniverseEngine()).
        { name: 'Fruit Bowl', symbol: GIFT_ICONS['Fruit Bowl'], price: 499 },
        // NEW 2026-10-13 — plays the 10-second 3D Swallow video full-screen on every device (see empUniverseEngine()).
        // PRICE IS A PLACEHOLDER: change this one number to whatever EMPY amount you want it to cost.
        { name: 'Swallow', symbol: GIFT_ICONS['Swallow'], price: 549 },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Bouquet video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (luxury bouquet ≈ TikTok Money Rain / Money Gun tier (~500)); order follows real-life worth, not release date.
        { name: 'Empyrean Bouquet', symbol: GIFT_ICONS['Empyrean Bouquet'], price: 599 },
        { name: 'Money Gun',      symbol: GIFT_ICONS['Money Gun'],      price: 600 },
        // NEW 2026-10-12 — plays the 10-second 3D Empyrean Dance video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (dance night ≈ TikTok Trophy tier (699)); order follows real-life worth, not release date.
        { name: 'Empyrean Dance', symbol: GIFT_ICONS['Empyrean Dance'], price: 699 },
        // NEW 2026-10-12 — plays the 10-second 3D Royal Drum video full-screen on every device (see empUniverseEngine()).
        { name: 'Royal Drum', symbol: GIFT_ICONS['Royal Drum'], price: 799 },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Teddy video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (giant teddy, upper mid-tier); order follows real-life worth, not release date.
        { name: 'Empyrean Teddy', symbol: GIFT_ICONS['Empyrean Teddy'], price: 899 },
        // NEW 2026-10-12 — plays the 10-second 3D Empyrean Shades video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (designer sunglasses ≈ TikTok Galaxy tier (1,000)); order follows real-life worth, not release date.
        { name: 'Empyrean Shades', symbol: GIFT_ICONS['Empyrean Shades'], price: 999 },
        // ── Tier 4: Premium (1 000+ EMPY) — TikTok-scale, cheapest first ──
        // NEW 2026-10-12 — plays the 10-second 3D Empyrean Victory video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (gold medal, just above Galaxy tier); order follows real-life worth, not release date.
        { name: 'Empyrean Victory', symbol: GIFT_ICONS['Empyrean Victory'], price: 1499, liveHidden: true },   // 2026-10-17: hidden from the live catalog — its clip did not render well; replaced by the new 'Victory' gift below (the entry stays so old gifts still display)
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Connect video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (premium laptop); order follows real-life worth, not release date.
        { name: 'Empyrean Connect', symbol: GIFT_ICONS['Empyrean Connect'], price: 1999 },
        // NEW 2026-10-12 — plays the 10-second 3D Empyrean Shepherd video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (pedigree German Shepherd puppy); order follows real-life worth, not release date.
        { name: 'Empyrean Shepherd', symbol: GIFT_ICONS['Empyrean Shepherd'], price: 1999 },
        // NEW 2026-10-10 — plays the 10-second 3D "Empyrean Under Control" video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (gaming setup); order follows real-life worth, not release date.
        { name: 'Under Control',  symbol: GIFT_ICONS['Under Control'],  price: 2999 },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Gold Coin video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (1 oz gold coin); order follows real-life worth, not release date.
        { name: 'Empyrean Gold Coin', symbol: GIFT_ICONS['Empyrean Gold Coin'], price: 3999 },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Ring video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (diamond ring ≈ TikTok Drama Queen tier (~5,000)); order follows real-life worth, not release date.
        { name: 'Empyrean Ring', symbol: GIFT_ICONS['Empyrean Ring'], price: 4999 },
        { name: 'Crown',          symbol: GIFT_ICONS['Crown'],          price: 5000, liveHidden: true },
        // NEW 2026-10-11 — plays the 10-second 3D Diamond Guitar video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (luxury guitar); order follows real-life worth, not release date.
        { name: 'Diamond Guitar', symbol: GIFT_ICONS['Diamond Guitar'], price: 5999 },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Chronometer video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (luxury watch ≈ TikTok Sports Car tier (~7,000)); order follows real-life worth, not release date.
        { name: 'Empyrean Chronometer', symbol: GIFT_ICONS['Empyrean Chronometer'], price: 6999 },
        { name: 'Island',         symbol: GIFT_ICONS['Island'],         price: 7500, liveHidden: true },
        // NEW 2026-10-17 — plays the 10-second Victory team-celebration video (gemini_generated_video_f47249d7, mastered) on every device (see empUniverseEngine()).
        { name: 'Victory', symbol: GIFT_ICONS['Victory'], price: 7999 },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Cinema camera video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (cinema camera package); order follows real-life worth, not release date.
        { name: 'Empyrean Cinema', symbol: GIFT_ICONS['Empyrean Cinema'], price: 8999 },
        // NEW 2026-10-11 — plays the 10-second 3D Diamond SUV video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (luxury SUV, top of TikTok luxury 5,000–10,000 tier); order follows real-life worth, not release date.
        { name: 'Diamond SUV', symbol: GIFT_ICONS['Diamond SUV'], price: 9999 },
        // 2026-10-12: emoji Diamond Trophy is hidden from the live catalog; the 3D video trophy below replaces it.
        { name: 'Diamond Trophy', symbol: GIFT_ICONS['Diamond Trophy'], price: 10000, liveHidden: true },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Champions Cup video full-screen on every device (see empUniverseEngine()).
        { name: 'Empyrean Champions Cup', symbol: GIFT_ICONS['Empyrean Champions Cup'], price: 10000 },
        // PRICE re-based to the TikTok gift ladder; set to 10,000 EMPY (2026-10-12) — this video trophy replaces the emoji Diamond Trophy.
        // NEW 2026-10-10 — plays the 10-second 3D Empyrean Helicopter video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (helicopter); order follows real-life worth, not release date.
        { name: 'Empyrean Helicopter', symbol: GIFT_ICONS['Empyrean Helicopter'], price: 12999 },
        // NEW 2026-10-10 — plays the 10-second 3D Empyrean Yacht video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (yacht); order follows real-life worth, not release date.
        { name: 'Empyrean Yacht', symbol: GIFT_ICONS['Empyrean Yacht'], price: 14999 },
        // NEW 2026-10-10 — plays the 10-second 3D Empyrean Castle video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (castle); order follows real-life worth, not release date.
        { name: 'Empyrean Castle', symbol: GIFT_ICONS['Empyrean Castle'], price: 17999 },
        // NEW 2026-10-11 — plays the 20-second 3D Empyrean Diamond Island video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (private island); order follows real-life worth, not release date.
        { name: 'Empyrean Diamond Island', symbol: GIFT_ICONS['Empyrean Diamond Island'], price: 19999 },
        // NEW 2026-10-10 — plays the 10-second 3D Diamond Palace video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (palace); order follows real-life worth, not release date.
        { name: 'Diamond Palace', symbol: GIFT_ICONS['Diamond Palace'], price: 22999 },
        // NEW 2026-10-10 — plays the 10-second 3D Empyrean Jet video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (airliner); order follows real-life worth, not release date.
        { name: 'Empyrean Jet', symbol: GIFT_ICONS['Empyrean Jet'], price: 24999 },
        // NEW 2026-10-11 — plays the 10-second 3D Empyrean Arena (crystal stadium) video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (stadium); order follows real-life worth, not release date.
        { name: 'Empyrean Arena', symbol: GIFT_ICONS['Empyrean Arena'], price: 27999 },
        // NEW 2026-10-10 — plays the 10-second 3D Empyrean Lion video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (matches TikTok Lion (29,999)); order follows real-life worth, not release date.
        { name: 'Empyrean Lion',  symbol: GIFT_ICONS['Empyrean Lion'],  price: 29999 },
        // NEW 2026-10-10 — plays the 10-second 3D "universe" video full-screen on every device (see empUniverseEngine()).
        // PRICE re-based to the TikTok gift ladder (matches TikTok Universe (34,999) — the catalog ceiling); order follows real-life worth, not release date.
        { name: 'Universe',       symbol: GIFT_ICONS['Universe'],       price: 34999 },
    ];

    // Stamp a `tier` onto every entry (used by the card CSS below).
    EMPY_GIFT_CATALOG.forEach(function (g) { g.tier = _tierForPrice(g.price); });

    // Expose catalog so other modules can reference it without duplicating the array
    window.empyGiftCatalog = EMPY_GIFT_CATALOG;

    // Currently selected gift (set by catalog click, consumed by send handler)
    window._selectedGift = null;

    // ─────────────────────────────────────────────────────────────
    // SECTION 2: CSS – inject keyframes once
    // ─────────────────────────────────────────────────────────────
    (function injectGiftStyles() {
        if (document.getElementById('_gift_keyframes')) return;
        const s = document.createElement('style');
        s.id    = '_gift_keyframes';
        s.textContent = `
            /* Base sizing so the SVG scales like a text glyph (1em) in any
               context it's dropped into via gift.symbol — animation layer,
               chat line, catalog card, etc. — without each call site
               needing its own override. */
            svg.tk-premium-rose { width:1em; height:1em; vertical-align:middle; display:inline-block; }

            /* NOTE (session 2026-07-19, fifth follow-up): the floating-gift
               animation CSS (base .gift-animation, .gift-animation-small,
               .gift-animation-token, giftFloat/giftFloatSmall/heartMill
               keyframes) used to live here, injected at runtime via this
               <style> tag. Moved to style.css as a static, linked
               stylesheet instead — a runtime-injected <style> tag is one
               more thing that can silently fail to apply (blocked by a
               strict Content-Security-Policy style-src directive, raced
               by another stylesheet's insertion order, skipped if this
               IIFE errors before reaching document.head.appendChild,
               etc.) with no visible symptom other than "the fix doesn't
               seem to do anything" — which is exactly what kept
               happening across repeated attempts at this fix. A linked
               stylesheet has none of those failure modes. See style.css
               for the actual rules; this file's showGiftAnimation() /
               triggerGiftAnimation() below still add the
               'gift-animation-small' / 'gift-animation-token' classes —
               only where the CSS that responds to them lives has
               changed. */

            /* ── Glossy "3D" emoji badge ──────────────────────────────
               TikTok's own gift glyphs are custom-illustrated, licensed
               image assets — those specific files can't be pulled into
               this codebase. This reproduces the *look* (dimensional,
               glossy, sitting on a little sphere) using the platform's
               native color-emoji glyph on a radial-gradient "orb" with
               a soft specular highlight, so it reads as 3D/colorful
               without depending on any external/TikTok-owned asset. */
            .tk-emoji-3d {
                position: relative; z-index: 1; display: inline-flex;
                align-items: center; justify-content: center;
                line-height: 1; border-radius: 50%;
                background: radial-gradient(circle at 32% 28%, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%),
                            radial-gradient(circle at 50% 60%, rgba(255,255,255,0.10), rgba(0,0,0,0.18) 100%);
                filter: drop-shadow(0 3px 6px rgba(0,0,0,0.45));
            }
            .tk-emoji-3d::after {
                content:''; position:absolute; top:10%; left:18%; width:32%; height:20%;
                background: rgba(255,255,255,0.55); border-radius:50%;
                filter: blur(2px); transform: rotate(-18deg); pointer-events:none;
            }
            .tk-emoji-3d .tk-premium-rose {
                width: 66%; height: 66%; position: relative; z-index: 1;
                filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));
            }

            /* ── Gift catalog grid item — real, colorful, TikTok-style card ── */
            .gift-item {
                position: relative;
                display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
                gap: 2px; padding: 14px 6px 9px; border-radius: 16px; min-height: 96px;
                border: 1.5px solid rgba(255,255,255,0.08); cursor: pointer;
                background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
                transition: transform 0.15s ease, border-color 0.15s, box-shadow 0.15s, background 0.15s;
                user-select: none; overflow: hidden;
                --gift-glow: rgba(245,197,24,0.30);
            }
            .gift-item::before {
                content: ''; position: absolute; top: 6px; left: 50%; width: 46px; height: 46px;
                transform: translateX(-50%);
                background: radial-gradient(circle, var(--gift-glow) 0%, transparent 72%);
                filter: blur(4px); pointer-events: none;
            }
            .gift-item:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.18); }
            .gift-item:active{ transform: scale(0.94); }
            .gift-item.selected {
                border-color: #F5C518;
                background: linear-gradient(180deg, rgba(245,197,24,0.20), rgba(245,197,24,0.04));
                box-shadow: 0 0 0 2px rgba(245,197,24,0.35), 0 4px 16px rgba(245,197,24,0.25);
            }
            /* Rarity tiers — accent glow + border, like TikTok's gift rarity system */
            .gift-item[data-tier="rare"]      { --gift-glow: rgba(88,166,255,0.35); }
            .gift-item[data-tier="epic"]      { --gift-glow: rgba(186,104,255,0.40); border-color: rgba(186,104,255,0.20); }
            .gift-item[data-tier="legendary"] {
                --gift-glow: rgba(255,183,3,0.55); border-color: rgba(255,183,3,0.35);
                background: linear-gradient(180deg, rgba(255,183,3,0.14), rgba(255,255,255,0.02));
            }
            .gift-item[data-tier="legendary"].selected { border-color: #FFB703; box-shadow: 0 0 0 2px rgba(255,183,3,0.45), 0 4px 18px rgba(255,183,3,0.35); }
            .gift-item .symbol {
                position: relative; z-index: 1; line-height: 1; margin-bottom: 4px;
            }
            .gift-item .symbol .tk-emoji-3d { width: 48px; height: 48px; font-size: 1.9rem; }
            /* FIX (reported: Empy Token gift tile rendering oversized,
               filling the whole card instead of sitting inside the
               small circular badge like every other gift): unlike the
               emoji gifts above, EMPY_TOKEN_IMG_HTML is a real <img>,
               so it has its own intrinsic size and does not shrink to
               fit its flex parent on its own — the exact same situation
               Rose (also an <img>) already needed its own explicit size
               rule for. Mirrors that already-proven rule
               (#gift-grid-container .gift-item .symbol .tk-rose-img,
               app-live-tiktok-patch.js) at the identical 48px so both
               image-based gifts match the emoji gifts' size exactly —
               kept here, in this file's own style block, rather than in
               that other file, for the same reason the token asset
               itself was kept as a local copy in this file. */
            #gift-grid-container .gift-item .symbol .tk-empy-token-img {
                width: 48px; height: 48px; margin: 0 auto; display: block; object-fit: contain;
            }
            /* FIX (reported: Rose reads smaller than its neighbors in
               the gift catalog grid): Rose is also an <img> (like the
               token above), and app-live-tiktok-patch.js already ships
               a same-goal rule for it — but that file separately sets
               .tk-footer-icon .tk-rose-img to 68px !important for the
               footer button, and depends on this style block loading
               after that one to win on specificity/order alone (no
               !important of its own). Adding the identical 48px target
               here too, with !important, makes it correct unconditionally
               — regardless of script load order — without editing or
               removing app-live-tiktok-patch.js's own rule, which stays
               exactly as-is for the footer/nudge-card contexts it owns. */
            #gift-grid-container .gift-item .symbol .tk-rose-img {
                width: 48px !important; height: 48px !important; margin: 0 auto; display: block; object-fit: contain;
            }
            /* 2026-11-08: premium Like / Heart icons are <img> too -- same 48px tile box as Rose and the token. */
            #gift-grid-container .gift-item .symbol .tk-premium-gift-img {
                width: 48px !important; height: 48px !important; margin: 0 auto; display: block; object-fit: contain;
            }
            .gift-quick-item .g-sym .tk-premium-gift-img {
                width: 32px; height: 32px; margin: 0 auto; display: block; object-fit: contain;
            }
            .gift-item .name {
                font-size: 0.66rem; font-weight: 700; color: #fff; text-align: center;
                max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .gift-item .price {
                display: flex; align-items: center; gap: 3px;
                font-size: 0.7rem; color: #F5C518; font-weight: 700; margin-top: 2px;
            }
            .gift-item .price i { font-size: 0.62rem; }

            /* ── Quick-send side tab — small matching cards ── */
            .gift-quick-item {
                position: relative;
                display: flex; flex-direction: column; align-items: center;
                gap: 2px; padding: 8px 5px 6px; border-radius: 12px; cursor: pointer;
                background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
                transition: background 0.15s, transform 0.15s; user-select: none;
                --gift-glow: rgba(245,197,24,0.30);
            }
            .gift-quick-item::before {
                content: ''; position: absolute; top: 2px; left: 50%; width: 30px; height: 30px;
                transform: translateX(-50%);
                background: radial-gradient(circle, var(--gift-glow) 0%, transparent 72%);
                filter: blur(3px); pointer-events: none;
            }
            .gift-quick-item[data-tier="rare"]      { --gift-glow: rgba(88,166,255,0.35); }
            .gift-quick-item[data-tier="epic"]      { --gift-glow: rgba(186,104,255,0.40); }
            .gift-quick-item[data-tier="legendary"] { --gift-glow: rgba(255,183,3,0.55); border-color: rgba(255,183,3,0.35); }
            .gift-quick-item:hover  { background: rgba(255,255,255,0.14); }
            .gift-quick-item:active { transform: scale(0.92); }
            .gift-quick-item .g-sym {
                position: relative; z-index: 1; line-height: 1;
            }
            .gift-quick-item .g-sym .tk-emoji-3d { width: 32px; height: 32px; font-size: 1.3rem; }
            .gift-quick-item .g-price {
                font-size: 0.6rem; color: #F5C518; font-weight: 700;
                display: flex; align-items: center; gap: 2px;
            }
        `;
        document.head.appendChild(s);
    })();

    // ─────────────────────────────────────────────────────────────
    // SECTION 3: Animation helpers
    // ─────────────────────────────────────────────────────────────

    /* =========================================================================
       MONEY GUN — TikTok-style gift animation (added 2026-10-10)

       A golden money gun slides in from the left of the live screen, recoils
       on every shot and fires a fan of banknotes + gold coins that tumble,
       sway and drift down. Drawn on ONE <canvas> inside #gift-animation-layer
       (so it's clipped to the live video area and sits at that layer's own
       z-index) — particles are sprites blitted on a canvas, not DOM nodes, so
       a combo of several taps stays smooth on a low-end Android phone.

       HOW IT PLAYS ON EVERY DEVICE: nothing new to sync. Sending the gift
       already writes a `live_gifts` doc, and every viewer's existing sync
       listener (app-live-tiktok-patch.js attachGiftSyncListener) calls
       window.showGiftAnimation(symbol, giftName) for it — which now routes
       giftName === 'Money Gun' here. Same path for the sender's own tap.

       COMBO: tapping the gift again while the gun is still firing queues more
       shots on the SAME session (capped) instead of stacking a second canvas.

       GUN ARTWORK: the official Empyrean Money Gun image, embedded below as a
       transparent WebP data-URI (no extra file). A drawn SVG gun remains as a fallback.
       To use a different image, set window.EMP_MONEY_GUN_IMG = 'path.png'
       (gun must face RIGHT) before the first play. The embedded Empyrean artwork is the default.
       ========================================================================= */
    (function empMoneyGunEngine() {
        'use strict';

        var CFG = window.EMP_MONEY_GUN_CFG = window.EMP_MONEY_GUN_CFG || {
            SHOTS_PER_GIFT:   30,    // shots queued per tap (~1.8s of firing)
            MAX_QUEUED_SHOTS: 120,   // combo cap
            SHOT_INTERVAL_MS: 60,
            BILLS_PER_SHOT:   [2, 4],
            COIN_CHANCE:      0.28,
            MAX_PARTICLES:    200,   // hard cap, protects weak phones
            GUN_LEFT_PCT:     3,     // gun position inside the live layer
            GUN_BOTTOM_PCT:   30
        };
        // Official Empyrean Money Gun artwork (440px WebP with transparent background, embedded so it
        // needs no extra repo file and works offline). Override either global BEFORE the first play to
        // swap the artwork; set EMP_MONEY_GUN_IMG = false to fall back to the drawn SVG gun below.
        // MUZZLE = where banknotes leave the gun, as a fraction of the image (the slot's right end).
        if (window.EMP_MONEY_GUN_IMG === undefined) window.EMP_MONEY_GUN_IMG = 'data:image/webp;base64,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';
        var IMG_MUZZLE = window.EMP_MONEY_GUN_MUZZLE || { x: 0.95, y: 0.27 };
        var GRAVITY = 700, DRAG = 1.8, TERMINAL = 190, MAX_AGE = 7; // px/s based, scaled by screen width below
        var S = null; // the one active session

        // Gun SVG (200x150, faces right, tilted up ~12deg). Muzzle slot ends at ~(178,47).
        var GUN_SVG =
            '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;overflow:visible;">' +
            '<defs>' +
              '<linearGradient id="empMgG1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc86"/><stop offset=".45" stop-color="#d9a93a"/><stop offset="1" stop-color="#8a5a14"/></linearGradient>' +
              '<linearGradient id="empMgG2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c58d27"/><stop offset="1" stop-color="#5e3a0c"/></linearGradient>' +
            '</defs>' +
            '<g transform="rotate(-12 100 75)">' +
              '<path d="M52 100 L90 98 L82 146 Q81 150 76 150 L58 150 Q52 150 53 144 Z" fill="url(#empMgG2)"/>' +
              '<path d="M92 99 L92 119 L114 119 L114 99" fill="none" stroke="#d9a93a" stroke-width="4" stroke-linejoin="round"/>' +
              '<rect x="86" y="96" width="9" height="14" rx="2" fill="#b07a1e"/>' +
              '<path d="M10 52 L118 28 L176 36 Q185 38 185 47 L185 93 Q185 99 178 99 L22 106 Q10 106 10 94 Z" fill="url(#empMgG1)" stroke="#8a5a14" stroke-width="1.5"/>' +
              '<rect x="118" y="60" width="64" height="13" rx="2" fill="#1a1208"/>' +
              '<path d="M118 28 L118 99" stroke="#8a5a14" stroke-width="2" opacity=".6"/>' +
              '<path d="M18 56 L112 34 L112 44 L18 66 Z" fill="#fff6c9" opacity=".35"/>' +
            '</g></svg>';

        function _sprite(w, h, draw) {
            var c = document.createElement('canvas'); c.width = w; c.height = h;
            draw(c.getContext('2d'), w, h); return c;
        }
        function _rr(x, a, b, w, h, r) {
            x.beginPath(); x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r);
            x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h);
            x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r);
            x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b); x.closePath();
        }
        function _bill(back) {
            return _sprite(96, 44, function (x, w, h) {
                var g = x.createLinearGradient(0, 0, w, h);
                g.addColorStop(0, back ? '#2c7a43' : '#58c27a'); g.addColorStop(1, back ? '#1d5630' : '#2f8f50');
                _rr(x, 1, 1, w - 2, h - 2, 5); x.fillStyle = g; x.fill();
                x.lineWidth = 2; x.strokeStyle = '#d4f7de'; x.stroke();
                _rr(x, 7, 7, w - 14, h - 14, 3); x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.45)'; x.stroke();
                x.beginPath(); x.arc(w / 2, h / 2, 12, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,.22)'; x.fill();
                if (!back) { x.fillStyle = '#fff'; x.font = 'bold 20px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', w / 2, h / 2 + 1); }
            });
        }
        function _coin() {
            return _sprite(40, 40, function (x, w, h) {
                var g = x.createRadialGradient(15, 13, 3, 20, 20, 19);
                g.addColorStop(0, '#fff3b0'); g.addColorStop(.6, '#f0b429'); g.addColorStop(1, '#a8700f');
                x.beginPath(); x.arc(20, 20, 18, 0, Math.PI * 2); x.fillStyle = g; x.fill();
                x.lineWidth = 2; x.strokeStyle = '#fff1a8'; x.stroke();
                x.beginPath(); x.arc(20, 20, 11, 0, Math.PI * 2); x.lineWidth = 1.5; x.strokeStyle = 'rgba(138,90,20,.7)'; x.stroke();
            });
        }
        function _sprites() {
            if (!_sprites.c) _sprites.c = { front: _bill(false), back: _bill(true), coin: _coin() };
            return _sprites.c;
        }

        function _build(layer) {
            var root = document.createElement('div');
            root.className = 'emp-mg-root';
            root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
            var cv = document.createElement('canvas');
            cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
            var gun = document.createElement('div');
            var gw = Math.max(130, Math.min(layer.clientWidth * 0.5, 230));
            gun.style.cssText = 'position:absolute;left:' + CFG.GUN_LEFT_PCT + '%;bottom:' + CFG.GUN_BOTTOM_PCT + '%;width:' + gw + 'px;' +
                'transform:translateX(-140%);opacity:0;transition:transform .28s cubic-bezier(.2,.9,.3,1.15),opacity .2s;will-change:transform;' +
                'filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));';
            var img = window.EMP_MONEY_GUN_IMG;
            var inner = document.createElement('div');
            inner.style.cssText = 'will-change:transform;transform-origin:30% 70%;';
            inner.innerHTML = img
                ? '<img src="' + String(img).replace(/"/g, '') + '" alt="" style="width:100%;display:block;">'
                : GUN_SVG;
            gun.appendChild(inner);
            root.appendChild(cv); root.appendChild(gun);
            /* FIX (2026-10-10 — "it didn't make any animation effects, nothing happened"): app-patch-v7.js §F
               runs a MutationObserver on #gift-animation-layer that DELETES any node added there which isn't one
               of the old floating-emoji particles (it removes the node and re-spawns plain emoji bursts instead),
               so a root appended INSIDE the layer was destroyed the instant it appeared. Mount it as a sibling
               in the layer's parent instead — same size/position (the layer is just inset:0 in that parent), same
               stacking (z-index 50, matching v7's own override for the layer), but outside that observer's reach. */
            root.style.zIndex = '50';
            (layer.parentNode || layer).appendChild(root);
            return { root: root, cv: cv, ctx: cv.getContext('2d'), gun: gun, inner: inner, layer: layer,
                     muzzle: img ? IMG_MUZZLE : { x: 0.89, y: 0.31 } };
        }

        function _cleanup() {
            if (!S) return;
            if (S.raf) cancelAnimationFrame(S.raf);
            if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
            S = null;
        }

        function _spawn(muzzleX, muzzleY, sc) {
            var sp = (420 + Math.random() * 460) * sc;
            var a = (22 + Math.random() * 58) * Math.PI / 180;
            var coin = Math.random() < CFG.COIN_CHANCE;
            var bw = Math.max(26, Math.min(40, 34 * sc));
            S.parts.push({
                x: muzzleX, y: muzzleY, vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp,
                rot: Math.random() * 6.28, vr: (Math.random() - .5) * 9,
                flip: Math.random() * 6.28, vf: 5 + Math.random() * 9,
                sw: Math.random() * 6.28, sf: 2 + Math.random() * 2.5, sa: (30 + Math.random() * 50) * sc,
                coin: coin, w: coin ? bw * .5 : bw, h: coin ? bw * .5 : bw * .46, age: 0
            });
        }

        function _frame(now) {
            if (!S) return;
            S.raf = requestAnimationFrame(_frame);
            var root = S.root;
            if (!root.isConnected) { _cleanup(); return; } // live modal was closed/rebuilt
            var dt = Math.min(0.05, (now - S.last) / 1000); S.last = now;
            var W = S.layer.clientWidth, H = S.layer.clientHeight;
            if (!W || !H) return;
            var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
            if (S.cv.width !== Math.round(W * dpr) || S.cv.height !== Math.round(H * dpr)) {
                S.cv.width = Math.round(W * dpr); S.cv.height = Math.round(H * dpr);
            }
            var sc = Math.max(0.7, Math.min(1.4, W / 390));
            var ctx = S.ctx;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);

            // fire
            if (now >= S.startAt && S.shots > 0 && now >= S.nextShot) {
                S.shots--; S.nextShot = now + CFG.SHOT_INTERVAL_MS; S.kick = 1; S.flash = 1; S.lastShot = now;
                var gr = S.gun.getBoundingClientRect(), lr = S.layer.getBoundingClientRect();
                S.mx = gr.left - lr.left + gr.width * S.muzzle.x; S.my = gr.top - lr.top + gr.height * S.muzzle.y;
                var n = CFG.BILLS_PER_SHOT[0] + Math.floor(Math.random() * (CFG.BILLS_PER_SHOT[1] - CFG.BILLS_PER_SHOT[0] + 1));
                for (var i = 0; i < n && S.parts.length < CFG.MAX_PARTICLES; i++) _spawn(S.mx, S.my, sc);
            }

            // gun recoil + slide out once finished
            S.kick = Math.max(0, S.kick - dt * 9);
            S.inner.style.transform = 'translateX(' + (-S.kick * 12) + 'px) rotate(' + (-S.kick * 3) + 'deg)';
            if (S.shots <= 0 && !S.leaving && now - S.lastShot > 260) {
                S.leaving = true; S.gun.style.transform = 'translateX(-140%)'; S.gun.style.opacity = '0';
            }

            // muzzle flash
            if (S.flash > 0 && S.mx != null) {
                var g = ctx.createRadialGradient(S.mx, S.my, 1, S.mx, S.my, 26 * sc);
                g.addColorStop(0, 'rgba(255,240,170,' + (0.9 * S.flash) + ')'); g.addColorStop(1, 'rgba(255,200,60,0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(S.mx, S.my, 26 * sc, 0, 6.2832); ctx.fill();
                S.flash = Math.max(0, S.flash - dt * 12);
            }

            // particles
            var spr = _sprites(), tv = TERMINAL * sc, grav = GRAVITY * sc;
            for (var k = S.parts.length - 1; k >= 0; k--) {
                var p = S.parts[k];
                p.age += dt;
                p.vx *= Math.max(0, 1 - DRAG * dt);
                p.vy += grav * dt; if (p.vy > tv) p.vy = tv;
                p.x += (p.vx + Math.sin(p.age * p.sf + p.sw) * p.sa * (p.age > .35 ? 1 : 0)) * dt;
                p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += p.vf * dt;
                if (p.y > H + 50 || p.x > W + 80 || p.x < -80 || p.age > MAX_AGE) { S.parts.splice(k, 1); continue; }
                var c = Math.cos(p.flip), sh = Math.max(1.5, p.h * Math.abs(c));
                ctx.save();
                ctx.translate(p.x, p.y); ctx.rotate(p.rot);
                if (p.age > MAX_AGE - 1) ctx.globalAlpha = Math.max(0, MAX_AGE - p.age);
                ctx.drawImage(p.coin ? spr.coin : (c >= 0 ? spr.front : spr.back), -p.w / 2, -sh / 2, p.w, p.coin ? p.h * (0.35 + 0.65 * Math.abs(c)) : sh);
                ctx.restore();
            }

            if (S.shots <= 0 && S.leaving && !S.parts.length) _cleanup();
        }

        window.empPlayMoneyGun = function (layer) {
            try {
                layer = layer || document.getElementById('gift-animation-layer');
                if (!layer) return;
                var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                var add = Math.round(CFG.SHOTS_PER_GIFT * (reduce ? 0.5 : 1));
                if (S && S.root.isConnected && S.layer === layer) {          // combo: extend the running session
                    S.shots = Math.min(CFG.MAX_QUEUED_SHOTS, S.shots + add);
                    if (S.leaving) {                                          // gun was on its way out — bring it back
                        S.leaving = false; S.gun.style.transform = 'translateX(0)'; S.gun.style.opacity = '1';
                    }
                    return;
                }
                _cleanup();
                var b = _build(layer);
                S = { root: b.root, cv: b.cv, ctx: b.ctx, gun: b.gun, inner: b.inner, layer: layer, muzzle: b.muzzle,
                      parts: [], shots: add, kick: 0, flash: 0, leaving: false, mx: null, my: null,
                      last: performance.now(), startAt: performance.now() + 300, nextShot: 0, lastShot: performance.now(), raf: 0 };
                requestAnimationFrame(function () { if (S) { S.gun.style.transform = 'translateX(0)'; S.gun.style.opacity = '1'; } });
                S.raf = requestAnimationFrame(_frame);
            } catch (err) {
                console.warn('[MoneyGun] animation failed:', err && err.message);
                _cleanup();
            }
        };
    })();


    /* =========================================================================
       UNIVERSE — full-screen 3D cinematic VIDEO gift (added 2026-10-10)

       (Now a shared engine: also plays the 3D Money Gun clip — see CFG.CLIPS.)
       Plays the supplied "3D animation universe" clip (throne, pegasus, whale,
       orbiting rings) over the live screen, exactly as authored, WITH its own
       soundtrack. The clip is served as a plain static file: public/universe-gift.mp4
       (server.js already serves public/ with HTTP Range support, and its CSP
       mediaSrc allows 'self', so nothing on the server changes).

       HOW IT PLAYS ON EVERY DEVICE: nothing new to sync. Sending the gift already
       writes a `live_gifts` doc, and every viewer's existing sync listener
       (app-live-tiktok-patch.js attachGiftSyncListener) calls
       window.showGiftAnimation(symbol, giftName) for it — which routes
       giftName === 'Universe' here. Same path for the sender's own tap.

       QUEUE: the clip is ~10s, so a second Universe sent while it's playing is
       queued and plays right after (max CFG.MAX_QUEUE waiting) instead of
       stacking or cutting the first one off.

       AUTOPLAY: it first tries to play WITH sound; if the browser refuses
       (e.g. iOS Safari without a fresh tap) it retries muted so the visuals
       still show. If the file can't load at all it falls back to a floating
       🌌 so the gift is never silent/invisible.

       MOUNTING: appended as a SIBLING of #gift-animation-layer (z-index 50),
       NOT inside it — app-patch-v7.js §F runs a MutationObserver that deletes
       any non-particle node added inside that layer (same reason Money Gun
       mounts this way).

       TUNING (set on window.EMP_UNIVERSE_CFG before the first play):
         SRC   — video path (default 'universe-gift.mp4')
         FIT   — 'contain' = whole scene visible, exact composition (default);
                 'cover'   = fills the whole phone screen but crops the sides
         VOLUME, MAX_QUEUE, BACKDROP — see below
       ========================================================================= */
    (function empUniverseEngine() {
        'use strict';

        // Folder this script was served from. The clips sit beside index.html/app-gifts.js, so asking the
        // SAME folder is the one location guaranteed to match wherever the app is hosted (Render root, a
        // local preview server, a sub-folder). Captured now — document.currentScript is only set during load.
        var SCRIPT_BASE = (function () {
            try {
                var sc = document.currentScript || document.querySelector('script[src*="app-gifts.js"]');
                if (sc && sc.src) return String(sc.src).replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
            } catch (e) {}
            return '';
        })();

        var CFG = window.EMP_UNIVERSE_CFG = window.EMP_UNIVERSE_CFG || {
            CLIPS: {                            // gift name -> { file, fallback emoji }. Add another video gift by adding a line here.
                // FIX (2026-10-10 — "gift sends the OLD animation, not the new video"): files are now
                // requested from the site ROOT (a relative name breaks on any non-root URL), and if the
                // clean file name 404s the engine retries the original Gemini export name in `alt`.
                // (A missing file used to hit server.js's SPA catch-all, get index.html back, error out,
                // and silently fall through to the floating-emoji fallback — i.e. the "old" effect.)
                'Universe':  { fx: 'universe-fx.mp4', src: 'universe-gift.mp4', url: '',  alt: ['gemini_generated_video_323a6c4b.mp4', 'gemini_generated_video_d4509e7b.mp4'] },   // REPLACED 2026-10-14: new black-background clip (gemini_generated_video_323a6c4b) saved as universe-gift.mp4 AND universe-fx.mp4 so it plays behind the live
                // REPLACED (2026-10-12): new Money Gun clip (gemini_generated_video_d60c48dc), re-mastered at 1920x1080 / ~10 Mbps for sharpness.
                // Upload money-gun-gift-hq.mp4 to Firebase Storage > gift-videos/. The old money-gun-gift.mp4 and its Gemini name are no longer requested.
                'Money Gun': { alpha: 'money-gun-alpha-v2.webm', fx: 'money-gun-fx-v2.mp4', src: 'money-gun-gift-v2.mp4', url: '', alt: ['money-gun-gift-hq.mp4', 'gemini_generated_video_d60c48dc.mp4'] },   // FIX 2026-10-16: the old money-gun-gift-hq.mp4 was never in the folder/Storage, so nothing played. Now uses the new transparent WebM (Chrome/Edge/Android) + 1080p black-background MP4 (Safari/iPhone/fallback), same as Under Control.
                'Empyrean Lion': { fx: 'lion-fx-v2.mp4', src: 'lion-gift-v2.mp4', url: '', alt: ['lion-gift.mp4', 'empyrean-lion-gift.mp4', 'gemini_generated_video_2fa12c12.mp4', 'gemini_generated_video_47101f16.mp4'] },   // REPLACED 2026-10-16: new black-background clip (gemini_generated_video_47101f16, 10s, 720x1280 portrait, ~3.1 MB), saved as lion-gift-v2.mp4 + lion-fx-v2.mp4 (no "empyrean" prefix; -v2 so it never clashes with the lion-gift.mp4 / lion-fx.mp4 already in Storage, which stay as fallbacks).
                'Under Control': { alpha: 'under-control-alpha-v2.webm', fx: 'under-control-fx-v2.mp4', src: 'under-control-gift-v2.mp4', url: '', alt: ['under-control-gift.mp4', 'gemini_generated_video_1d410cf0.mp4', 'gemini_generated_video_d4718e8e.mp4'] },   // REPLACED 2026-10-16: transparent (alpha) WebM for Chrome/Edge/Android; Safari/iPhone fall back to the black-background MP4 pair (under-control-fx-v2 has its dark shadows lifted so the black jacket stays solid under the luma-key). Earlier: 2026-10-13 sharper clip
                'Penlight': { fx: 'penlight-fx.mp4', src: 'penlight-gift.mp4', url: '', alt: ['empyrean-penlight-gift.mp4', 'gemini_generated_video_029478c3.mp4', 'gemini_generated_video_a2c52c6f.mp4'] },   // REPLACED 2026-10-14: new black-background clip (gemini_generated_video_029478c3), saved as empyrean-penlight-gift.mp4 + penlight-fx.mp4
                'Empyrean Castle': { fx: 'castle-fx-v2.mp4', src: 'castle-gift-v2.mp4', url: '', alt: ['castle-gift.mp4', 'empyrean-castle-gift.mp4', 'gemini_generated_video_e137bc7a.mp4', 'gemini_generated_video_549d8438.mp4', 'gemini_generated_video_fcb76817.mp4'] },   // REPLACED 2026-10-15: new black-background castle clip (gemini_generated_video_e137bc7a), saved as castle-gift-v2.mp4 + castle-fx-v2.mp4 (renamed with -v2 so they don't clash with same-named files already in Storage; earlier: 2026-10-13 sharper clip)
                'Empyrean Helicopter': { src: 'empyrean-helicopter-gift.mp4', url: '', alt: ['gemini_generated_video_afbcfa24.mp4'] },
                'Empyrean Jet': { src: 'empyrean-jet-gift.mp4', url: '', alt: ['gemini_generated_video_c33528dd.mp4'] },
                'Empyrean Yacht': { src: 'empyrean-yacht-gift.mp4', url: '', alt: ['gemini_generated_video_a2cbf585.mp4'] },
                'Diamond Palace': { fx: 'diamond-palace-fx.mp4', src: 'diamond-palace-gift.mp4', url: '', alt: ['gemini_generated_video_b9f174ba.mp4'] },
                'Diamond SUV': { fx: 'diamond-suv-fx.mp4', src: 'diamond-suv-gift.mp4', url: '', alt: ['gemini_generated_video_f3f5bae0.mp4', 'gemini_generated_video_75a7a50d.mp4'] },   // REPLACED 2026-10-14: new black-background clip (gemini_generated_video_75a7a50d, full 10s on pure black), saved as diamond-suv-fx.mp4 so it plays behind the live
                'Diamond Guitar': { fx: 'diamond-guitar-fx.mp4', src: 'diamond-guitar-gift.mp4', url: '', alt: ['gemini_generated_video_2b2c69ec.mp4', 'gemini_generated_video_6627c590.mp4'] },   // REPLACED 2026-10-14: new black-background clip (gemini_generated_video_2b2c69ec); fx entry added so it plays behind the live
                'Empyrean Connect': { fx: 'empyrean-connect-fx.mp4', src: 'empyrean-connect-gift.mp4', url: '', alt: ['gemini_generated_video_086d4418.mp4', 'gemini_generated_video_138ebfb2.mp4'] },   // NEW 2026-10-15: black-background clip (gemini_generated_video_138ebfb2) trimmed to its 4.5s clean wide section (close-up and edge-reaching fireworks removed) and scaled into the safe zone; saved as empyrean-connect-fx.mp4 so it plays behind the live
                'Empyrean Chronometer': { fx: 'empyrean-chronometer-fx.mp4', src: 'empyrean-chronometer-gift.mp4', url: '', alt: ['gemini_generated_video_815b926b.mp4', 'gemini_generated_video_e43ca52b.mp4'] },   // REPLACED 2026-10-15: black-background clip (gemini_generated_video_e43ca52b) with the full-screen dial close-up removed and the picture scaled into the safe zone; saved as empyrean-chronometer-fx.mp4 so it plays behind the live
                'Empyrean Gold Coin': { fx: 'gold-coin-fx-v2.mp4', src: 'gold-coin-gift-v2.mp4', url: '', alt: ['empyrean-gold-coin-gift.mp4', 'gemini_generated_video_4f00ea7c.mp4', 'gemini_generated_video_23708349.mp4'] },   // REPLACED 2026-10-16: new black-background EMPY coin clip (gemini_generated_video_23708349, 10s, 1280x720, ~2.8 MB). The original drifted to a dark teal-grey backdrop in its second half, so the dark background was crushed to true #000000 (coin colours untouched), saved as gold-coin-gift-v2.mp4 + gold-coin-fx-v2.mp4 (no "empyrean" prefix; -v2 so it never clashes with empyrean-gold-coin-gift.mp4 already in Storage, which stays as a fallback).
                // REPLACED 2026-10-17: new Victory clip (gemini_generated_video_11a2a850, 10s, 1280x720, black background) re-mastered: pure #000000 background (clean luma-key), light denoise + sharpen, sound levelled, 5.7 MB -> 3.3 MB. Saved as victory-fx-v6.mp4 AND victory-gift-v6.mp4 (same file; -v6 so it never clashes with the older victory files in Storage). The old Empyrean Victory clip is NOT used as a fallback (it rendered badly).
                'Victory': { fx: 'victory-fx-v6.mp4', src: 'victory-gift-v6.mp4', url: '', alt: ['gemini_generated_video_11a2a850.mp4'] },
                'Empyrean Champions Cup': { alpha: 'champions-cup-alpha-v2.webm', fx: 'champions-cup-fx-v2.mp4', src: 'champions-cup-gift-v2.mp4', url: '', alt: ['empyrean-champions-cup-gift.mp4', 'gemini_generated_video_7b010544.mp4'] },   // REPLACED 2026-10-16: transparent (alpha) WebM for Chrome/Edge/Android; Safari/iPhone fall back to the black-background MP4 pair (no "empyrean" prefix)
                'Empyrean Arena': { alpha: 'arena-alpha-v2.webm', fx: 'arena-fx-v2.mp4', src: 'arena-gift-v2.mp4', url: '', alt: ['empyrean-arena-gift.mp4', 'gemini_generated_video_f8497d11.mp4', 'gemini_generated_video_262a107e.mp4', 'gemini_generated_video_9875fa37.mp4'] },   // REPLACED 2026-10-16: new black-background arena clip (gemini_generated_video_f8497d11, floating arena + light beams + fireworks, 10s, 1280x720). FIX: the earlier mp4-only version showed a dark rectangle in the preview (luma-key not applied there), so it now has a transparent WebM (arena-alpha-v2.webm, black keyed to real alpha) for Chrome/Edge/Android, with the black-background mp4 pair as the Safari/iPhone fallback.
                'Empyrean Bouquet': { src: 'empyrean-bouquet-gift.mp4', url: '', alt: ['gemini_generated_video_b1871a5e.mp4'] },
                'Empyrean Teddy': { src: 'empyrean-teddy-gift.mp4', url: '', alt: ['gemini_generated_video_578f4894.mp4'] },
                'Empyrean Cake': { src: 'empyrean-cake-gift.mp4', url: '', alt: ['gemini_generated_video_5c61185c.mp4'] },
                'Empyrean Cinema': { src: 'empyrean-cinema-gift.mp4', url: '', alt: ['gemini_generated_video_d897ff13.mp4'] },
                'Empyrean Ring': { src: 'empyrean-ring-gift.mp4', url: '', alt: ['gemini_generated_video_4ff60f2b.mp4'] },
                'Empyrean Diamond Island': { fx: 'diamond-island-fx-v2.mp4', src: 'diamond-island-gift.mp4', url: '', alt: ['empyrean-diamond-island-gift.mp4', 'gemini_generated_video_28564cad.mp4', 'gemini_generated_video_04372472.mp4'] },   // REPLACED 2026-10-13: sharper clip. FIX 2026-10-16: fx clip re-saved as diamond-island-fx-v2.mp4 with its edges cleaned (hard crop line under the castle + frame-border edges faded out by fx_edge_clean.py); the normal src clip is unchanged and the old diamond-island-fx.mp4 in Storage is simply no longer requested.
                'Empyrean Movie Night': { fx: 'movie-night-fx-v2.mp4', src: 'movie-night-gift-v2.mp4', url: '', alt: ['empyrean-movie-night-gift.mp4', 'gemini_generated_video_2e7da058.mp4'] },   // REPLACED 2026-10-16: new black-background clip (gemini_generated_video_2e7da058, couple with popcorn, 10s, 1280x720, ~3.7 MB), saved as movie-night-gift-v2 + movie-night-fx-v2 (no "empyrean" prefix).
                'Empyrean Dance': { fx: 'dance-fx-v2.mp4', src: 'dance-gift-v2.mp4', url: '', alt: ['empyrean-dance-gift-v2.mp4', 'empyrean-dance-gift.mp4', 'gemini_generated_video_2e7796fb.mp4'] },   // REPLACED 2026-10-15: new black-background clip (gemini_generated_video_2e7796fb, 10s, 1280x720, ~4.7 MB), saved as -gift-v2 + -fx-v2 (old same-named file stays in Storage, kept as fallback).
                'Empyrean Victory': { alpha: 'victory-alpha-v5.webm', fx: 'victory-fx-v5.mp4', src: 'victory-gift-v5.mp4', url: '', alt: ['victory-gift-v4.mp4', 'victory-gift-v3.mp4', 'victory-gift-v2.mp4', 'empyrean-victory-gift-v2.mp4', 'empyrean-victory-gift.mp4', 'gemini_generated_video_4451d48d.mp4', 'gemini_generated_video_8ad3da48.mp4', 'gemini_generated_video_c7f7f537.mp4'] },   // REPLACED 2026-10-17: victory clip (gemini_generated_video_4451d48d = victory-gift-v4: red-kit team lifting the trophy, confetti, EMPYREAN text) now has a transparent WebM + black-background MP4 so it plays BEHIND the live comments instead of covering the whole screen as a normal clip. 1920x1080, sharpened, scaled into a safe zone with soft edges. victory-alpha-v5.webm / victory-fx-v5.mp4 / victory-gift-v5.mp4; -v5 so it never clashes with earlier files in Storage (kept as fallbacks).
                // PREVIOUS (kept): { src: 'victory-gift-v3.mp4' } - plain full-screen clip, no fx/alpha.
                'Empyrean Shepherd': { fx: 'shepherd-fx-v3.mp4', src: 'shepherd-gift-v3.mp4', url: '', alt: ['shepherd-gift-v2.mp4', 'empyrean-shepherd-gift-v2.mp4', 'empyrean-shepherd-gift.mp4', 'gemini_generated_video_a0a00ec9.mp4', 'gemini_generated_video_adeb2146.mp4'] },   // REPLACED 2026-10-16: new black-background clip (gemini_generated_video_adeb2146, 10s, 720x1280 portrait, ~4.4 MB), saved as shepherd-gift-v3.mp4 + shepherd-fx-v3.mp4 (no "empyrean" prefix; -v3 so it never clashes with the v2 files already in Storage, which stay as fallbacks).
                'Empyrean Shades': { src: 'empyrean-shades-gift.mp4', url: '', alt: [] },
                // NEW (2026-10-12): the four emoji gifts now play full-screen 3D clips (re-mastered 1920x1080). Gift names match the catalog exactly.
                'Gift Box':    { fx: 'gift-box-fx-v2.mp4', src: 'gift-box-gift-v2.mp4', url: '', alt: ['gift-box-gift.mp4', 'gemini_generated_video_fc5a06f5.mp4', 'gemini_generated_video_0cad0043.mp4'] },   // REPLACED 2026-10-16: new black-background clip (gemini_generated_video_0cad0043, red Empyrean gift box opening, 10s, 1280x720, ~3.9 MB), saved as gift-box-gift-v2.mp4 + gift-box-fx-v2.mp4 (no "empyrean" prefix; -v2 so it never clashes with the gift-box-gift.mp4 already in Storage, which stays as a fallback).
                'Ice Cream':   { fx: 'ice-cream-fx-v2.mp4', src: 'ice-cream-gift-v2.mp4', url: '', alt: ['ice-cream-gift.mp4', 'gemini_generated_video_61e93a19.mp4', 'gemini_generated_video_666c0127.mp4'] },   // REPLACED 2026-10-16: new black-background clip (gemini_generated_video_666c0127, ice-cream sundae platter, 10s, 1280x720, ~5.3 MB), saved as ice-cream-gift-v2.mp4 + ice-cream-fx-v2.mp4 (no "empyrean" prefix; -v2 so it never clashes with the ice-cream-gift.mp4 already in Storage, which stays as a fallback).
                'Heart Mills': { src: 'heart-mills-gift.mp4', url: '', alt: ['gemini_generated_video_3dd7ae82.mp4'] },
                'Balloon':     { src: 'balloon-gift.mp4',     url: '', alt: ['gemini_generated_video_d2732d2e.mp4'] },
                // NEW (2026-10-12): two new gifts, saved under their gift names (no Empyrean prefix); ~5.5 MB 720p clips.
                'Fruit Bowl': { fx: 'fruit-bowl-fx-v2.mp4', src: 'fruit-bowl-gift-v2.mp4', url: '', alt: ['fruit-bowl-gift.mp4', 'VID-20261016-WA0001.mp4', 'gemini_generated_video_41eadb3f.mp4', 'gemini_generated_video_21b93016.mp4'] },   // REPLACED 2026-10-16: new black-background clip (VID-20261016-WA0001, 8.6s, 1280x720, ~1.8 MB: fruit tree -> fruit bowl with hearts), saved as fruit-bowl-gift-v2.mp4 + fruit-bowl-fx-v2.mp4 (no "empyrean" prefix); supersedes the 2026-10-15 v2 (gemini_generated_video_41eadb3f).
                'Royal Drum': { fx: 'royal-drum-fx-v2.mp4', src: 'royal-drum-gift-v2.mp4', url: '', alt: ['royal-drum-gift.mp4', 'gemini_generated_video_a29325ba.mp4', 'gemini_generated_video_a2fb26eb.mp4'] },   // RENAMED 2026-10-15: files re-uploaded with a -v2 suffix (old same-named files already in Storage); old names kept as fallbacks.
                  // REPLACED 2026-10-15: new black-background clip (gemini_generated_video_a29325ba, 10s, 1280x720, gold "empyrean" drum with dancers on pure black), saved as royal-drum-gift.mp4 AND royal-drum-fx.mp4 so it plays behind the live comments like the other fx gifts. Upload both files to Firebase Storage > gift-videos/.
                // NEW (2026-10-12): the Chocolate / Cupcake / Perfume emoji gifts now play full-screen 3D clips too (same shared engine).
                // Saved under their plain gift names (no Empyrean prefix); 1280x720, ~4.5 MB each. Upload to Firebase Storage > gift-videos/.
                'Chocolate': { src: 'chocolate-gift.mp4', url: '', alt: ['gemini_generated_video_369d188a.mp4'] },
                'Cupcake':   { fx: 'cupcake-fx-v2.mp4', src: 'cupcake-gift-v2.mp4', url: '', alt: ['cupcake-gift.mp4', 'gemini_generated_video_029f0676.mp4', 'gemini_generated_video_15590ee0.mp4'] },   // REPLACED 2026-10-16: new black-background clip (gemini_generated_video_15590ee0, star-topped cupcake with fireworks, 10s, 1280x720, ~4.4 MB), saved as cupcake-gift-v2.mp4 + cupcake-fx-v2.mp4 (no "empyrean" prefix; -v2 so it never clashes with the cupcake-gift.mp4 already in Storage, which stays as a fallback).
                'Perfume':   { alpha: 'perfume-alpha-v2.webm', fx: 'perfume-fx-v2.mp4', src: 'perfume-gift-v2.mp4', url: '', alt: ['perfume-gift.mp4', 'gemini_generated_video_d8405143.mp4', 'gemini_generated_video_528d21df.mp4'] },   // REPLACED 2026-10-17: new black-background clip (gemini_generated_video_d8405143, gold Empyrean perfume bottle with light trails + fireworks, 10s, 1280x720), saved as perfume-gift-v2.mp4 + perfume-fx-v2.mp4 plus a transparent WebM (perfume-alpha-v2.webm) so it floats over the stream in the preview/Chrome/Android; -v2 so it never clashes with perfume-gift.mp4 already in Storage (kept as fallback).
                // NEW (2026-10-12): Candy / Coffee / Pizza Slice emoji gifts now play full-screen 3D clips (plain gift names, no Empyrean prefix; 1280x720, ~4.5 MB each).
                'Candy':       { src: 'candy-gift.mp4',       url: '', alt: ['gemini_generated_video_9a26a530.mp4'] },
                'Coffee':      { alpha: 'coffee-alpha-v4.webm', fx: 'coffee-fx-v4.mp4', src: 'coffee-gift-v4.mp4', url: '', alt: ['coffee-alpha-v3.webm', 'coffee-fx-v3.mp4', 'coffee-gift-v3.mp4', 'coffee-alpha-v2.webm', 'coffee-fx-v2.mp4', 'coffee-gift-v2.mp4', 'coffee-gift.mp4', 'gemini_generated_video_7d6af919.mp4'] },   // IMPROVED 2026-10-17 (v4): wings / light trails / sparks no longer carry dark shadows - dim glow is now rebuilt as soft light instead of translucent dark brown, hair + face kept solid, no dark blobs. -v4 so it never clashes with the -v3 files (kept as fallbacks).
                // PREVIOUS (v3): 'Coffee':      { alpha: 'coffee-alpha-v3.webm', fx: 'coffee-fx-v3.mp4', src: 'coffee-gift-v3.mp4', url: '', alt: ['coffee-alpha-v2.webm', 'coffee-fx-v2.mp4', 'coffee-gift-v2.mp4', 'coffee-gift.mp4', 'gemini_generated_video_7d6af919.mp4', 'gemini_generated_vide
                // PREVIOUS (kept): 'Coffee':      { alpha: 'coffee-alpha-v2.webm', fx: 'coffee-fx-v2.mp4', src: 'coffee-gift-v2.mp4', url: '', alt: ['coffee-gift.mp4', 'gemini_generated_video_7d6af919.mp4', 'gemini_generated_video_9a6f0e21.mp4'] },
                'Pizza Slice': { src: 'pizza-slice-gift.mp4', url: '', alt: ['gemini_generated_video_c484c94b.mp4'] },
                // NEW (2026-10-13): Football emoji gift plays a full-screen 3D clip (plain gift name, no Empyrean prefix; 1280x720, ~4.4 MB).
                'Football':    { fx: 'football-fx-v2.mp4', src: 'football-gift-v2.mp4', url: '', alt: ['football-gift.mp4', 'gemini_generated_video_a6564f28.mp4'] },   // REPLACED 2026-10-15: new black-background football clip (gemini_generated_video_a6564f28, 10s, 1280x720, ~4.3 MB), saved as football-gift-v2.mp4 + football-fx-v2.mp4 (-v2 so it never clashes with the old football-gift.mp4 in Storage); old name kept as fallback.
                // NEW (2026-10-13): new Swallow gift (plain gift name, no Empyrean prefix; 1280x720, ~4.6 MB).
                'Swallow':     { fx: 'swallow-fx-v3.mp4', src: 'swallow-gift-v3.mp4', url: '', alt: ['swallow-gift-v2.mp4', 'swallow-gift.mp4', 'gemini_generated_video_6fc9c859.mp4', 'gemini_generated_video_b81e79c2.mp4', 'gemini_generated_video_c82be108.mp4'] }   /* REPLACED 2026-10-16: new black-background cooking/serving clip (gemini_generated_video_c82be108, 10s, 1280x720, ~3.5 MB). Pure #000000 background throughout; the grey kitchen cabinet/hood in the top-left corner was removed frame by frame, and swallow-fx-v3.mp4 also has its dark shadows lifted (black hair, dark dress and pot stay solid under the luma-key; the true-black background is untouched). swallow-gift-v3.mp4 is the same clip without the shadow lift, for normal full-screen play. No "empyrean" prefix; -v3 so it never clashes with swallow-gift-v2.mp4 already in Storage, which stays as a fallback. */
            },
            // HOSTING (repo is at GitHub's 100-file limit, so the clips can't be committed; Cloudinary is retired).
            // Clips live in Firebase Storage. Upload the four files to the folder STORAGE_DIR with EXACTLY these
            // names: universe-gift.mp4, money-gun-gift.mp4, empyrean-lion-gift.mp4, under-control-gift.mp4.
            // Lookup order per clip: 1) `url` above if you paste one (Firebase console > the file > copy its
            // download URL — works whatever the Storage rules say), 2) the plain Storage URL built from the app's
            // own storageBucket (needs public read on STORAGE_DIR), 3) files beside app-gifts.js, 4) site root.
            STORAGE_DIR: 'gift-videos',
            BUCKET:    'empyrean-app-afe24.firebasestorage.app',   // the bucket the clips are really in (Firebase console > Storage); tried BEFORE whatever /api/config reports
            VER:       '20261017c',             // cache-buster appended to every clip URL (bump if a clip file is ever replaced)
            FIT:       'contain',               // CHANGED 2026-10-14: was 'auto' (cropped 9:16 clips to fill the screen). 'contain' = the WHOLE video is always shown, nothing cut off                  // 'auto' = fill the screen when little is cropped (portrait clips), else show the whole scene (landscape clips); or force 'cover' / 'contain'
            VOLUME:    1,
            MAX_QUEUE: 3,                       // extra plays allowed to wait behind the current one
            BEHIND_UI: true,                    // NEW 2026-10-14: true = the gift video plays BEHIND the chat comments / buttons (inside .live-body, above the host video); false = old behaviour, on top of everything
            BACKDROP:  'transparent',           // CHANGED 2026-10-14: was rgba(0,0,0,.92), which blacked out the whole live screen. Now nothing dims the stream.
            OPACITY:   0.82,                    // NEW: how solid the effect is while it plays (1 = fully solid, lower = the live stream shows through)
            FX_MODE:   'key',                   // NEW 2026-10-14: how black-background (fx) clips are made transparent: 'key' = luma-key to a real alpha (solid subject, no washed-out ghosting - default) | 'screen' = plain mix-blend-mode:screen (what the sample page uses; goes see-through/white over bright streams)
            FX_GAIN:   3.2,                     // 'key' mode: how fast brightness turns opaque (higher = more solid dark areas, but dark parts of the subject may keep a black edge)
            FX_CUT:    0.10,                    // 'key' mode: brightness below this stays fully transparent (raise it if you see a dark haze around the subject, lower it if the subject's shadows vanish)
            FX_SCALE:  1,                       // CHANGED 2026-10-14: was 1.6 (zoomed black-background clips, cutting off the sides). 1 = no zoom, the full frame is visible                     // NEW: zoom for black-background (fx) clips so the subject isn't tiny on a portrait phone (1 = none)
            FEATHER:   false,                   // CHANGED 2026-10-14: was true (faded the clip's edges, hiding part of the footage). false = full frame, no edge fade                    // NEW: soft-fade the clip's edges into the live stream instead of a hard rectangle
            BLEND:     'normal',                // NEW: CSS mix-blend-mode for the effect: 'normal' | 'screen' (dark areas vanish) | 'lighten' | 'plus-lighter'
            STALL_MS:  45000,                   // give up (fallback emoji) if NO new data has arrived for this long (resets every time bytes arrive)
            ABS_MS:    70000,                   // ...but never wait longer than this in total for a clip to start (slow mobile data)
            MAX_MS:    16000                    // hard safety stop, now counted from when playback STARTS (clip is ~10s)
        };

        // Square tile thumbnail for the gift catalog (a frame from the clip, embedded so it needs no extra request).
        if (window.EMP_UNIVERSE_THUMB === undefined) window.EMP_UNIVERSE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Money Gun catalog tile (frame from its clip, embedded; refreshed 2026-10-12 to the new clip).
        if (window.EMP_MONEY_GUN_THUMB === undefined) window.EMP_MONEY_GUN_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Lion catalog tile (frame from its clip, embedded).
        if (window.EMP_LION_THUMB === undefined) window.EMP_LION_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Under Control catalog tile (frame from its clip, embedded).
        if (window.EMP_UNDERCONTROL_THUMB === undefined) window.EMP_UNDERCONTROL_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Penlight catalog tile (frame from its clip, embedded).
        if (window.EMP_PENLIGHT_THUMB === undefined) window.EMP_PENLIGHT_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Castle catalog tile (frame from its clip, embedded).
        if (window.EMP_CASTLE_THUMB === undefined) window.EMP_CASTLE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Helicopter catalog tile (frame from its clip, embedded).
        if (window.EMP_HELI_THUMB === undefined) window.EMP_HELI_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Jet catalog tile (frame from its clip, embedded).
        if (window.EMP_JET_THUMB === undefined) window.EMP_JET_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Yacht catalog tile (frame from its clip, embedded).
        if (window.EMP_YACHT_THUMB === undefined) window.EMP_YACHT_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Diamond Palace catalog tile (frame from its clip, embedded).
        if (window.EMP_PALACE_THUMB === undefined) window.EMP_PALACE_THUMB = 'data:image/webp;base64,UklGRloOAABXRUJQVlA4IE4OAACwNwCdASqAAIAAPpk4lUgloyIhMHwdKLATCWQAwFwTl5ShuW/Cr5f0/lUPt+kf+8bw3nZtOplOfvvvb8rPyqTi4Pajvc/AHwEfa2/OgG7lf7jzf+0fSJ36NAXxltHH7UkGTfFpPtC8QivCgaTGfOa1/Rt6c0VL6LY2AOc23Pzkuv6EGvV3AtjEjK7i1hkrDCtzKfPY7WQyhyXB9uje7qs76Ugm5n01nSJkSbuX+fkoSomvCbeKcEGnWlXDClr7sC5aK6CbweGhz7mr7eHVCKWzf+LK2wLvUKkJhS+0dpHpdOSa1KMkordWAJHpi7D1B9M4R8C6gHdYsyf55ZsutPcMcKXb87b7/EFsEWKDWgN/36h9lGQwaa+bC9b9uRQmDyINPBnKCD4GK4x919bvS3RfmQZF3zaYiMn7MrcXjzP9JV7bjotlgILYtf2oEuVssUOAJ/OyBLfgM77U/kJq1viGtNgUSYeVPV+VKqwYnXZ0zmE9PUdf9tf0M3RgzN/cLjhD1GvFyuANbg87UZVEUl6GAsXyHnvOzq4meuP3/mFKbHZig+rI5eyjk5HNqcBfpmM22jTdnsUG1EZpk5gOZ7b/f9/HmTeAAP756k8EjxeKr7FWP2gyTx1JociA4EG6hcvaccCvlBAc8Al4VT/0nWzYmaVfmq4bY8DXuF9c6N1FUzpynHQjHmntZFVIiUjOEpFK/bDI67GJG9Rqjv/Ir+6TS1OQLhOfLlcPOIO9FSyEz4+Mc7Zj3Veqf30kUuuPVuBFoYqxMH4ljKU3AyD3Zy6hzhQXrv9Dz4ptYo1GRVxP59WoF3l6HwWetugXTZaJDSzR4hnnHUVJvZELb44M0/FI9rVW5MS1Z14RSs9mLGBGAexGQC6OP51sowXuhdTLixv2ZI/sU47njv1pKQQftewj72cLb9VvC//RUL/Vl1kRyFNQMGR71LqkSsOwHgETokVyEZgm742yA4e38r9ohbz/80IX9e8An3V61Q0TYM4JGJM0OiFBhFg7CwcgtGL34tF6BQtOYIa64R/yngRpIpj3+RVwve78ZaZGvtxTG1uFQJeuv1xBdeesKRm3jDqlRq/YG82pt7MEE8a4YLJTFrWVltLeuCBpSK+SQrpNjyT3gcJ7TwptOXzojmVWrZnSv+WJV91pGGZd7kot84ujHoeU6OGTSFLwRIZKDTW6SBhyU0bE5rQRxTvy0z/f5yrOc4xeetWfL8fSPBmNrzVAY64O9as4eBr8+t7UJzqnUqaVnGqYJkyzIxKLUPgAHRAO1IdN6vAr1qzybyifnmLjESOithNpWSe1ifKMGfnrLs29GPYcDV0gcPiFb3Il8xiGzE/9Fc0sZD9WeDjkG972N74a5urRPZdgFhLE/g6mRX614+s6l7RrYKK3GLahEP5QNuaYc2myIMDnVUwNslhhcHA7hyOxSM9x8WsF+vTES1Yl7ULylor0yaaBfc1YHSGgDCbd3MmFE3DJnfY5hlM60IRphQ4wHAub3nD35fOtpdtyubmQTNV2bxBhTyKIqO8+1V1OlyYdgJ5pqTeWm67K0MCZZjkVdw6+Hx8RiidYv9jJnOVjUdXZRmxwlxyfpEBKT8fa3i24Tn1mJ8nJG30i7Imsn98747zoADcQo8bb8frdz31c7UQPomky6bN9ZLgxXlV0Uf/9teeadu0BSYjwvMno1L5k2nZqosnz1SwrvUz7enpuSDklO4wu36UJ5TEUDi4gu7tRQAswRqWPBOFMMp5U5rnJBWI2BIcNzaq8yhKUM5GJiUeNmcuq/47kWOSA7wWeyDwo7TmhvssSYMDYny7V4iriVoXmSMxECQkBMgVejZHnCLi+r49wLbqucPqZn9ZGwbTb0ZDbkwkMPFOMne3y4J3eqXv2ns8pCuGrEa5WYnby4xO8lBsxv9JNd14ltE2vo3h3+C171ccT5opO9FOTC6JglsKmhHsecHJsoziQmnJOx9Imf0IAX6yMJ5Lgn1Ff03VmXB0Iy6q/Aq47QCus88yDkPrQ4xOyfQbY2A3YoMPsep+Y9uG/0FWFfhO8R4dxWieRZr8CqZ0LI5L9RUgkeuySXxWpGMgjrxiz8s+N0WoNsa4wfKTLsS89qRVOVazi1xeWAjW1vRxLllxXr/S05Oy2GJp1s6w1XB4P74Ogofr1AcfVHVQwU7M1Rav6DriRKv/M8UP+q8ZrUMtQ7Eq+m1lRAGvf89U6/m+ga/mW5uAOLkcs0evIHriTNhz6RzrHBr3DeTyqdi0oyayqwwQMRzQvdLvJ2i/i8ZPkV71tmL+X+32kYdK4xFeHqZOTa9lAaX6wx1eQInZDD4i6d+GB5+9Tr6Fss2fiDP8V20ImHgdZzY/jOvRN5ZqZF98bd8mtvHzovRBEYA05VQc7M2BCsArhpX8TLy6fvd2r3DV6TqmRJWrXjwLrjjFKCIz0loBC1cNrsbXTyx3Nf7AiZtXYVAaA6TmB1X74x8WG/Ee+8uG4LTl/sGek6Rs5tSXyxnwCiEOMp88TrQdPR14uGlOiJmldOzPkLbp0Q5mIgR3V7ssTzXL1hMbgzAHdDYAz8O9cVP1/uVmHXLMmNuqlIlOlZKfMe4kDGeyvPda4oAHHtDLb1j4P/lBRnfVwduYADd1u0JN6oyTDhC3cMaqyj8yZGTxtFEKa1cnlJIZDK70g8W8YdYVbA84NZ0aEAFvIuuIo8s8TdeC/hWJcPIV1ob2910chOfGkSR5FUF7fPH4Bg2Udk+KTGnvqN774v74ExRedT2m2hhi9+l7vgkEoZyadTdtwzCaX5qIhI/cXkb1u+9YIRoaz4HuBQt6PT1I//fESoUn46/6HVY3SHCqtlC6YoS/XFB/KceFbbXJCNDdOqp7sYTLcXKHb8AHS/ApEfPyX+xdWkdI+hZW+JdsB5xRx3oRe7t/gSfN2ty4z/GxMvSSuZ5VpPDNnHebp1SWqJQP8DzggLZm8n8Y68qDhfJRTmb/YMUrpRswarWN0kfxuG6Mx1a2HnhcJjnzS/SUWl+VXSgqe/ZshhV6dPfwIZJnSRKMmMUZd5JG40Rv/AldYpcKpBhR2/YyWHsT5ujfM5H5Qun88w5IKQ+Hnyad0BbCKvtZz1FjLUOsR77vOkXMNl3FZE1WcAVUugzAXrq7f/G3PvTrQ8Ro0UPvk/nKFfWtMSNollt8rnVubskCgIzTkX0tJ1hKz4R5RIv8gzOBmdBUqHr6YCInEgw2EH5YGfyaDtdhm3hnPs6YQ6mMNowXFbRwD862IHPaI/EmOXz74xP7f/PT5ga9nH/oyaAXuBictpqUN3Lagtc71uaw0jkEB5TYiqT8ZE8FMUhAhPGWkafURoFBKCoICXmc9OIOjweiTwWaMSwB5q53UHm4rDMLRAvL4gAj3eUVfCcErEvgcwS8W0wOp4U+STjWzt8i99T1LVpFPDfAde+esns5HSzRERLJsQcPAkOQJFV74XIuAfYqggBW5ohzeLNX8qlcqMOS2cAbea8LOV1viA8y3KSpK1NGBAZwADmCYtzAA3uIAoP6+itHG6wb3waejfENeWZ1tow6ZUZDgRAr3RCX0L8dmIZvP8g8IutPRe3EDMxGZsNXxXNvdh5seQHK8C7VHQ3ZqEtMa6WHgFiv569bqZdGUzfFZYTQ8JT+qqBAMXYRAnqS2RezjTJpRsAfQkOOu5PZU9cqwsRy1kORET7KgJ2GEsPInB8J0wXpY8Hf05ec+vTzy0b/1vFuEwCghnO8aKJXwPjKlITJjTAq9XnAIfxUZrOmKIlYR/JeyRvMLMr5QeSX1qBMRuHwzKgOEi5iML+SuGgv5DItZmLfVVQcj7L/tnEMd0eG+US0e8K40d7yphmm6+wW2+/EcUDM9oyR/X/WMHm8rSPusOhQYX3w52L0Yn1pX4+USNW0u9giL805xRVCiSDsfhmonQTxdm7Gn3ypqBdvVVKtDe/hj6i56Q9utWFZlzDPHfc7CVXM8WSMK50yrjFtSEaItaB9HPlVxeW4OWMhpvIEAIxniFyuI4vHPsSNOFJfpwBnQ2KafW++/g5dOIsTNgFLR8DN2OdKVEhJM4ldqz4JnmUBCocIAbDahZ1LJfFteq8k8UpSmNnv+CKm3R+mc5jkW4j8I1ay4GKd4AFTCCphhPjTtVgY336otz52o4pkbLhXW3hY1gg7Q6m9xEmdRsVONaQfBCNdJ8ENitVL6ZLBIzCoVMWoizjPNheMv8LxQru23rAiOX/s/XMOAo0B2Rlhb9cNZ7vhbkdAY/klgfbv+qiN3YFfut4/7DqMLYB1//z4yELdKEITI4myIdk0/xUvwafjLSHaYItyEHx94jzj/t28rexdjzYoRmOUrOSkQWQ6b7At2f8lkjNrQUFWCoDEaP9dwoUF2hZ7kXWLCiBXh7GTGPkJP83qkTJ+5T44wTxT+BPclRDDks0ZGhK+LtDdB1v3rTvl5SfMnGIbw8PnXGl6g02HPXDlNyqMMFDfhDR/V1CeE6LEoT6w331o3q20hluRu0Y1e1GwxGTZGkGRvKln7JrZTZzBeeGZ0GBmlM7KDIzmVR7+Es7kNBs2nfJrNmRjt3vUa6tevUUYnnNdVZMxH0WcbNEdzkgM/dQkIlL5OWc6OZTgnGnF+a26JpgYaYPN2Q8O99657I7vVkO5Gq5C6ODVAjDxx5Ety4jKaromL21rB1ROQvRBuZdTtlfc73gtw/FOaTiHf6ra1Wq5A2zB0BsbwdTMIGGd64iq6iVBx2EVMVahLW8Q2uqrnENuiCx3BL+vqP52D91s+z7ZFLqnRdkHphg4k7XRteDcZlzTbogrpfguRfzH7KLEvi7ifth+2Ozlk5H1PjaVSB4X/363EjmZmph3MQGGwn0PY7UlIc3qLdJ9xCjbSwkIrl+YLGRF2wfRAAA==';

        // Square tile thumbnail for the Diamond SUV catalog tile (frame from its clip, embedded).
        if (window.EMP_SUV_THUMB === undefined) window.EMP_SUV_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Diamond Guitar catalog tile (frame from its clip, embedded).
        if (window.EMP_GUITAR_THUMB === undefined) window.EMP_GUITAR_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Connect catalog tile (frame from its clip, embedded).
        if (window.EMP_CONNECT_THUMB === undefined) window.EMP_CONNECT_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Chronometer catalog tile (frame from its clip, embedded).
        if (window.EMP_CHRONO_THUMB === undefined) window.EMP_CHRONO_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Gold Coin catalog tile (frame from its clip, embedded).
        if (window.EMP_GOLDCOIN_THUMB === undefined) window.EMP_GOLDCOIN_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Victory catalog tile (frame from its clip, embedded).
        if (window.EMP_WORLDCHAMPS_THUMB === undefined) window.EMP_WORLDCHAMPS_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Champions Cup catalog tile (frame from its clip, embedded).
        if (window.EMP_CUP_THUMB === undefined) window.EMP_CUP_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Arena catalog tile (frame from its clip, embedded).
        if (window.EMP_ARENA_THUMB === undefined) window.EMP_ARENA_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Bouquet catalog tile (frame from its clip, embedded).
        if (window.EMP_BOUQUET_THUMB === undefined) window.EMP_BOUQUET_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Teddy catalog tile (frame from its clip, embedded).
        if (window.EMP_TEDDY_THUMB === undefined) window.EMP_TEDDY_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Cake catalog tile (frame from its clip, embedded).
        if (window.EMP_CAKE_THUMB === undefined) window.EMP_CAKE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Cinema catalog tile (frame from its clip, embedded).
        if (window.EMP_CINEMA_THUMB === undefined) window.EMP_CINEMA_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Ring catalog tile (frame from its clip, embedded).
        if (window.EMP_RING_THUMB === undefined) window.EMP_RING_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Diamond Island catalog tile (frame from its clip, embedded).
        if (window.EMP_DIAMONDISLE_THUMB === undefined) window.EMP_DIAMONDISLE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Movie Night catalog tile (frame from its clip, embedded).
        if (window.EMP_MOVIENIGHT_THUMB === undefined) window.EMP_MOVIENIGHT_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Dance catalog tile (frame from its clip, embedded).
        if (window.EMP_DANCE_THUMB === undefined) window.EMP_DANCE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Victory catalog tile (frame from its clip, embedded).
        if (window.EMP_VICTORY_THUMB === undefined) window.EMP_VICTORY_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Shepherd catalog tile (frame from its clip, embedded).
        if (window.EMP_SHEPHERD_THUMB === undefined) window.EMP_SHEPHERD_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Empyrean Shades catalog tile (frame from its clip, embedded).
        if (window.EMP_SHADES_THUMB === undefined) window.EMP_SHADES_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Gift Box catalog tile (frame from its clip, embedded).
        if (window.EMP_GIFTBOX_THUMB === undefined) window.EMP_GIFTBOX_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Ice Cream catalog tile (frame from its clip, embedded).
        if (window.EMP_ICECREAM_THUMB === undefined) window.EMP_ICECREAM_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Heart Mills catalog tile (frame from its clip, embedded).
        if (window.EMP_HEARTMILLS_THUMB === undefined) window.EMP_HEARTMILLS_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Balloon catalog tile (frame from its clip, embedded).
        if (window.EMP_BALLOON_THUMB === undefined) window.EMP_BALLOON_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Fruit Bowl catalog tile (frame from its clip, embedded).
        if (window.EMP_FRUITBOWL_THUMB === undefined) window.EMP_FRUITBOWL_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Royal Drum catalog tile (frame from its clip, embedded).
        if (window.EMP_ROYALDRUM_THUMB === undefined) window.EMP_ROYALDRUM_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Chocolate catalog tile (frame from its clip, embedded).
        if (window.EMP_CHOCOLATE_THUMB === undefined) window.EMP_CHOCOLATE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Cupcake catalog tile (frame from its clip, embedded).
        if (window.EMP_CUPCAKE_THUMB === undefined) window.EMP_CUPCAKE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Perfume catalog tile (frame from its clip, embedded).
        if (window.EMP_PERFUME_THUMB === undefined) window.EMP_PERFUME_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Candy catalog tile (frame from its clip, embedded).
        if (window.EMP_CANDY_THUMB === undefined) window.EMP_CANDY_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Coffee catalog tile (frame from its clip, embedded).
        if (window.EMP_COFFEE_THUMB === undefined) window.EMP_COFFEE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Pizza Slice catalog tile (frame from its clip, embedded).
        if (window.EMP_PIZZASLICE_THUMB === undefined) window.EMP_PIZZASLICE_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Football catalog tile (frame from its clip, embedded).
        if (window.EMP_FOOTBALL_THUMB === undefined) window.EMP_FOOTBALL_THUMB = 'data:image/webp;base64,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';

        // Square tile thumbnail for the Swallow catalog tile (frame from its clip, embedded).
        if (window.EMP_SWALLOW_THUMB === undefined) window.EMP_SWALLOW_THUMB = 'data:image/webp;base64,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';

        var S = null;          // the one active session
        var queue = [];        // { layer, name } plays waiting behind it (shared by every video gift, played in order)
        var warm = {};         // detached <video>s used only to pre-fetch the files into the HTTP cache

        // NEW (2026-10-14): luma-key filter. A black-background clip has no alpha channel, so 'screen' blending can only ever LIGHTEN
        // the stream - over a bright stream (white wall) the subject turns into a pale ghost. Instead we compute a real alpha from
        // each pixel's brightness (black -> 0, anything lit -> opaque) with an SVG feColorMatrix, so the subject is drawn SOLID and
        // the black is still fully see-through. Pure CSS/SVG: no canvas, no CORS needed, GPU colour-matrix.
        function _ensureKeyFilter() {
            try {
                if (document.getElementById('emp-lumakey-svg')) return 'url(#emp-lumakey)';
                var g = Number(CFG.FX_GAIN) || 3.2, c = Number(CFG.FX_CUT); if (!isFinite(c)) c = 0.10;
                var wr = (0.55 * g).toFixed(3), wg = (0.85 * g).toFixed(3), wb = (0.30 * g).toFixed(3), off = (-c * g).toFixed(3);
                var ns = 'http://www.w3.org/2000/svg';
                var svg = document.createElementNS(ns, 'svg');
                svg.setAttribute('id', 'emp-lumakey-svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
                svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
                svg.innerHTML = '<defs><filter id="emp-lumakey" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">' +
                    '<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ' + wr + ' ' + wg + ' ' + wb + ' 0 ' + off + '"/>' +
                    // brightens the dim, semi-transparent edge pixels so glows don't get a dark fringe (colour only; alpha untouched)
                    '<feComponentTransfer><feFuncR type="gamma" amplitude="1.15" exponent="0.6" offset="0"/><feFuncG type="gamma" amplitude="1.15" exponent="0.6" offset="0"/><feFuncB type="gamma" amplitude="1.15" exponent="0.6" offset="0"/></feComponentTransfer>' +
                    '</filter></defs>';
                (document.body || document.documentElement).appendChild(svg);
                return 'url(#emp-lumakey)';
            } catch (e) { return ''; }
        }
        var _IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        // NEW (2026-10-16): does this browser draw the alpha channel of a VP9 WebM? Chromium engines do; Safari/iOS/Firefox are treated as 'no'.
        function _alphaOK() {
            try {
                if (_IOS) return false;
                var ua = navigator.userAgent || '';
                if (!/Chrome|Chromium|Edg\/|OPR\/|SamsungBrowser/i.test(ua) || /CriOS|FxiOS|Firefox/i.test(ua)) return false;
                var t = document.createElement('video');
                return !!(t.canPlayType && t.canPlayType('video/webm; codecs="vp9"'));
            } catch (e) { return false; }
        }   // iOS WebKit is unreliable with SVG filters on <video> -> stays on 'screen'

        function _clip(name) { if (name === 'Empyrean Penlight') name = 'Penlight'; /* legacy name of the renamed gift (2026-10-14) */ return (CFG.CLIPS && CFG.CLIPS[name]) || CFG.CLIPS['Universe']; }
        function _bucket() {                             // the app's own Firebase Storage bucket (set by /api/config at boot)
            try {
                var b = window._appConfig && window._appConfig.firebase && window._appConfig.firebase.storageBucket;
                if (!b && window.firebase && window.firebase.apps && window.firebase.apps.length) b = window.firebase.app().options.storageBucket;
                return b ? String(b).replace(/^gs:\/\//, '') : '';
            } catch (e) { return ''; }
        }
        function _storageUrl(file, bucket) {             // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<dir%2Ffile>?alt=media
            var b = bucket || _bucket();
            if (!b || !CFG.STORAGE_DIR || !file) return '';
            return 'https://firebasestorage.googleapis.com/v0/b/' + b + '/o/' + encodeURIComponent(CFG.STORAGE_DIR + '/' + file) + '?alt=media&v=' + encodeURIComponent(CFG.VER || '1');
        }
        function _urls(f) {                              // where to look for one file: beside app-gifts.js, then site root
            f = String(f || '');
            if (/^(https?:)?\/\//.test(f) || f.charAt(0) === '/') return [f];
            var q = '?v=' + encodeURIComponent(CFG.VER || '1'), out = [];
            if (SCRIPT_BASE) out.push(SCRIPT_BASE + f + q);
            if (out.indexOf('/' + f + q) === -1) out.push('/' + f + q);
            return out;
        }
        function _srcList(name) {                        // every file name, in Storage first, then beside the script / site root
            var c = _clip(name), files = [c.src].concat(c.alt || []), out = [];
            if (c.url) out.push(String(c.url));
            // FIX (2026-10-13 - Lion never played): only the FIRST file name was ever looked up in Firebase Storage; the
            // alternate names were only tried on the web server, where the clips are not hosted. Now every name is tried
            // in Storage (preferred name first), so a clip saved under any of its names is found.
            files.forEach(function (f) {
                [CFG.BUCKET, _bucket()].forEach(function (bk) {
                    var sb = _storageUrl(f, bk);
                    if (sb && out.indexOf(sb) === -1) out.push(sb);
                });
            });
            files.forEach(function (f) { _urls(f).forEach(function (u) { if (out.indexOf(u) === -1) out.push(u); }); });
            // NEW (2026-10-14): TikTok-style "fx" version. If the gift has a clip shot on a PURE BLACK background (c.fx), it is tried
            // FIRST and played with the 'screen' blend, which makes the black fully transparent so only the effect floats over the
            // live stream. If that file isn't there, the normal clip plays exactly as before (and we remember, to skip the lookup).
            var fxN = 0;
            if (c.fx && !(window._empFxMissing && window._empFxMissing[name])) {
                var fxl = [];
                [CFG.BUCKET, _bucket()].forEach(function (bk) { var sb = _storageUrl(c.fx, bk); if (sb && fxl.indexOf(sb) === -1) fxl.push(sb); });
                _urls(c.fx).forEach(function (u) { if (fxl.indexOf(u) === -1) fxl.push(u); });
                out = fxl.concat(out); fxN = fxl.length;
            }
            // NEW (2026-10-16): TRANSPARENT WebM (VP9 + alpha). Tried FIRST, but only in browsers that really render VP9 transparency
            // (Chromium: Chrome / Edge / Android / Samsung / Opera). Safari + iPhone ignore the alpha channel and Firefox is not trusted,
            // so they skip it and use the black-background fx MP4 above (luma-key / screen) exactly as before. Order in the list:
            // [alpha webm ...][fx mp4 ...][normal clip ...]. alphaCount = how many leading entries are the webm; fxCount = alpha + fx entries.
            var aN = 0;
            if (c.alpha && _alphaOK() && !(window._empAlphaMissing && window._empAlphaMissing[name])) {
                var al = [];
                [CFG.BUCKET, _bucket()].forEach(function (bk) { var sb = _storageUrl(c.alpha, bk); if (sb && al.indexOf(sb) === -1) al.push(sb); });
                _urls(c.alpha).forEach(function (u) { if (al.indexOf(u) === -1) al.push(u); });
                out = al.concat(out); aN = al.length;
            }
            out.alphaCount = aN;
            out.fxCount = fxN + aN;
            return out;
        }
        function _src(name) { return _srcList(name)[0]; }

        // Pre-fetch so the first Universe a viewer sees doesn't stutter. Skipped on Data Saver.
        // FIX (2026-10-10 - new clips never started, even the old ones): this used to create one <video preload="auto">
        // for EVERY clip at the same time. With 10 clips that is 10 parallel downloads to the same Firebase host (phones
        // only allow ~6 connections per host), so the clip that was actually being played waited behind the pre-fetches
        // and never started. Now: clips are pre-fetched ONE AT A TIME, and any pre-fetch in flight is aborted the moment
        // a real gift starts, so the playing clip gets the whole connection. Warming resumes after the gift ends.
        var warmQ = [], warmBusy = null;
        function _warmFinish(w, name, ok) {
            if (!warmBusy || warmBusy.v !== w) return;
            clearTimeout(warmBusy.t);
            warmBusy = null;
            try { w.removeAttribute('src'); w.load(); } catch (e) {}     // release the element; the HTTP cache keeps the bytes
            if (ok) warm[name] = true;
            setTimeout(_warmNext, 300);
        }
        function _warmNext() {
            try {
                if (warmBusy || (S && S.root && S.root.isConnected)) return;   // never compete with a gift that is playing
                var name = warmQ.shift();
                if (!name) return;
                if (warm[name]) return _warmNext();
                var w = document.createElement('video');
                w.preload = 'auto'; w.muted = true; w.setAttribute('playsinline', '');
                warmBusy = { name: name, v: w, t: 0 };
                w.addEventListener('canplaythrough', function () { _warmFinish(w, name, true); });
                w.addEventListener('error', function () { _warmFinish(w, name, false); });
                warmBusy.t = setTimeout(function () { _warmFinish(w, name, false); }, 20000);   // don't let one slow clip block the rest
                w.src = _src(name);
            } catch (e) { warmBusy = null; }
        }
        function _stopWarm() {                           // called right before a real gift video starts
            try {
                if (!warmBusy) return;
                var b = warmBusy; warmBusy = null;
                clearTimeout(b.t);
                try { b.v.removeAttribute('src'); b.v.load(); } catch (e) {}
                warmQ.unshift(b.name);                   // resume with this one later
            } catch (e) { warmBusy = null; }
        }
        window.empPreloadUniverse = function () {
            try {
                var c = navigator.connection;
                if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;
                Object.keys(CFG.CLIPS).forEach(function (name) {
                    if (!warm[name] && warmQ.indexOf(name) === -1 && !(warmBusy && warmBusy.name === name)) warmQ.push(name);
                });
                _warmNext();
            } catch (e) {}
        };

        // Viewers who never open the gift catalog used to download a clip only at the moment the first
        // gift landed (slow start / fallback on mobile data). Warm the clips as soon as the live gift
        // layer is actually on screen instead. Self-contained: checks every 4s, stops after it fires.
        (function _autoWarm() {
            var t = setInterval(function () {
                try {
                    var l = document.getElementById('gift-animation-layer');
                    if (l && l.getClientRects().length > 0 && !document.hidden) {
                        clearInterval(t);
                        if (window.empPreloadUniverse) window.empPreloadUniverse();
                    }
                } catch (e) { clearInterval(t); }
            }, 4000);
        })();

        function _cleanup() {
            if (!S) return;
            clearTimeout(S.stallT); clearTimeout(S.maxT);
            try { S.v.pause(); S.v.removeAttribute('src'); S.v.load(); } catch (e) {}
            if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
            S = null;
        }

        function _next() {
            while (queue.length) {
                var n = queue.shift();
                if (n.layer && n.layer.isConnected) { _start(n.layer, n.name); return; }
            }
        }

        // NEW (2026-10-11): when a clip cannot load/start (missing file, very slow data) the gift used to vanish with no
        // visual at all. Show the gift's floating emoji instead so the host always sees something. Only runs on failure.
        function _fallbackEmoji(layer, name) {
            try {
                var cat = window.empyGiftCatalog || [], sym = '';
                for (var i = 0; i < cat.length; i++) { if (cat[i].name === name) { sym = cat[i].symbol; break; } }
                var host = (layer && layer.parentNode) || layer;
                if (!sym || !host || !host.isConnected) return;
                var el = document.createElement('div');
                el.className = 'emp-universe-fallback';
                el.textContent = sym;
                el.style.cssText = 'position:absolute;left:50%;bottom:24%;transform:translateX(-50%);font-size:84px;line-height:1;z-index:50;pointer-events:none;';
                host.appendChild(el);
                if (el.animate) el.animate([
                    { transform: 'translate(-50%,0) scale(.6)', opacity: 0 },
                    { transform: 'translate(-50%,-60px) scale(1.15)', opacity: 1, offset: 0.25 },
                    { transform: 'translate(-50%,-240px) scale(1)', opacity: 0 }
                ], { duration: 2600, easing: 'ease-out' });
                setTimeout(function () { try { el.remove(); } catch (e) {} }, 3000);
            } catch (e) {}
        }

        function _end(failed) {
            if (!S || S.ending) return;
            S.ending = true;
            var layer = S.layer, name = S.name;
            // CHANGED (2026-10-13): no emoji fallback any more - a clip that cannot load ends silently (and was retried first).
            if (failed && !S.playing) console.warn('[GiftVideo] "' + name + '" could not be played - check the file in Storage > ' + CFG.STORAGE_DIR);
            S.root.style.opacity = '0';                     // soft fade-out, no hard cut
            setTimeout(function () { _cleanup(); _next(); if (!S) setTimeout(_warmNext, 2000); }, 380);
        }

        function _start(layer, name) {
            try {
                _stopWarm();                                    // free the connection for the clip that is about to play
                var srcs = _srcList(name);
                var root = document.createElement('div');
                root.className = 'emp-universe-root';
                root.style.cssText = 'position:absolute;inset:0;z-index:50;pointer-events:none;overflow:hidden;' +
                    'display:flex;align-items:center;justify-content:center;background:' + CFG.BACKDROP + ';' +
                    'opacity:0;transition:opacity .35s ease;' +
                    (CFG.BLEND && CFG.BLEND !== 'normal' ? 'mix-blend-mode:' + CFG.BLEND + ';' : '') +
                    (CFG.FEATHER ? '-webkit-mask-image:radial-gradient(ellipse 82% 82% at 50% 50%,#000 58%,transparent 100%);' +
                                   'mask-image:radial-gradient(ellipse 82% 82% at 50% 50%,#000 58%,transparent 100%);' : '');
                var v = document.createElement('video');
                v.className = 'emp-universe-video';
                v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
                v.playsInline = true; v.preload = 'auto'; v.loop = false; v.controls = false;
                v.disablePictureInPicture = true;
                v.style.cssText = 'width:100%;height:100%;object-fit:' + (CFG.FIT === 'cover' ? 'cover' : 'contain') +
                    ';pointer-events:none;display:block;background:transparent;';
                v.src = srcs[0];
                root.appendChild(v);
                // CHANGED (2026-10-14 - "gift must play in the background, not cover the live stream"): the clip used to be appended to the very
                // end of the live screen at z-index 50, i.e. ON TOP of the chat, the buttons and the host. It is now mounted INSIDE .live-body, right
                // after the host video (z-index 2) and BEFORE the comments list (z-index 3): the effect floats over the picture but BEHIND the chat
                // comments, and the header / footer / host controls (outside .live-body) are never covered. Still a sibling of #gift-animation-layer's
                // content, never inside it (see MOUNTING note above). CFG.BEHIND_UI = false restores the old on-top behaviour.
                (function _mount() {
                    var host = layer.parentNode || layer, body = null, cm = null;
                    try {
                        if (CFG.BEHIND_UI !== false && host.querySelector) {
                            body = host.querySelector('.live-body');
                            cm = body && body.querySelector('.live-comments-container');
                        }
                    } catch (e) { body = null; }
                    if (body) {
                        root.style.zIndex = '3';
                        if (cm && cm.parentNode === body) body.insertBefore(root, cm); else body.appendChild(root);
                    } else {
                        host.appendChild(root);                  // fallback: no .live-body found -> old behaviour
                    }
                })();

                S = { root: root, v: v, layer: layer, name: name, ending: false, stallT: 0, maxT: 0, srcs: srcs, tryIdx: 0 };
                var mine = S;
                // 'fx' (black-background) clip => screen blend, no mask, full opacity; normal clip => the translucent/feathered look.
                function _applyMode() {
                    var alpha = mine.tryIdx < (srcs.alphaCount || 0);      // transparent WebM: draw it as-is (no key, no blend, full opacity)
                    mine.alpha = alpha;
                    var fx = !alpha && mine.tryIdx < (srcs.fxCount || 0);
                    mine.fx = fx;
                    var key = fx && CFG.FX_MODE === 'key' && !_IOS, kf = key ? _ensureKeyFilter() : '';
                    if (key && !kf) key = false;
                    // fx + key    => real alpha from brightness, normal compositing (solid subject)
                    // fx + screen => mix-blend-mode:screen (fallback / iOS)
                    // normal clip => translucent + feathered look
                    root.style.mixBlendMode = (fx && !key) ? 'screen' : (!fx && !alpha && CFG.BLEND && CFG.BLEND !== 'normal' ? CFG.BLEND : '');
                    root.style.webkitMaskImage = root.style.maskImage = (!fx && !alpha && CFG.FEATHER) ? 'radial-gradient(ellipse 82% 82% at 50% 50%,#000 58%,transparent 100%)' : 'none';
                    v.style.filter = key ? kf : '';
                    v.style.webkitFilter = key ? kf : '';
                    if (fx || alpha) v.style.objectFit = 'contain';
                    v.style.transform = fx ? 'scale(' + (CFG.FX_SCALE || 1) + ')' : '';   // black-background clips are small in a 16:9 frame - enlarge them (root clips the overflow)
                }
                _applyMode();

                // Try WITH sound first; if the browser blocks it, retry muted so the visuals still play.
                function _play() {
                    var p;
                    try { v.muted = false; v.volume = Math.max(0, Math.min(1, CFG.VOLUME)); p = v.play(); } catch (e) {}
                    if (p && p.catch) {
                        p.catch(function (err) {
                            if (S !== mine) return;
                            if (err && err.name === 'AbortError') return;     // src swapped / reloaded — the new load plays itself
                            try {
                                v.muted = true;
                                var q = v.play();
                                if (q && q.catch) q.catch(function (e3) { if (S === mine && !(e3 && e3.name === 'AbortError')) _end(true); });
                            } catch (e2) { if (S === mine) _end(true); }
                        });
                    }
                }

                v.addEventListener('playing', function () {
                    if (S !== mine) return;
                    mine.playing = true;
                    clearTimeout(mine.stallT);
                    clearTimeout(mine.maxT);
                    var dur = (isFinite(v.duration) && v.duration > 0) ? v.duration * 1000 : 10000;
                    mine.maxT = setTimeout(function () { if (S === mine) _end(false); }, Math.min(dur + 4000, CFG.MAX_MS + 8000));
                    root.style.opacity = (mine.fx || mine.alpha) ? '1' : String(CFG.OPACITY);
                });
                function _applyFit() {
                    try {
                        // zoom only LANDSCAPE black-background clips (small in a 16:9 frame); a vertical 9:16 fx clip already fills a phone, so no zoom
                        if (mine.fx && v.videoWidth && v.videoHeight) v.style.transform = (v.videoWidth > v.videoHeight && CFG.FX_SCALE) ? 'scale(' + CFG.FX_SCALE + ')' : '';
                        if (CFG.FIT !== 'auto' || !v.videoWidth || !v.videoHeight) return;
                        var bw = root.clientWidth || window.innerWidth, bh = root.clientHeight || window.innerHeight;
                        var a = v.videoWidth / v.videoHeight, b = bw / bh;
                        v.style.objectFit = (Math.min(a / b, b / a) >= 0.7) ? 'cover' : 'contain';
                    } catch (e) {}
                }
                v.addEventListener('loadedmetadata', _applyFit);
                v.addEventListener('playing', _applyFit);
                v.addEventListener('ended', function () { if (S === mine) _end(false); });
                v.addEventListener('error', function () {
                    if (S !== mine) return;
                    console.warn('[GiftVideo] could not load ' + mine.srcs[mine.tryIdx] + ' — the file is missing from that folder (it must sit next to index.html / app-gifts.js)');
                    if (mine.tryIdx + 1 < mine.srcs.length) {       // try the next file name before giving up
                        mine.tryIdx++;
                        if (srcs.alphaCount && mine.tryIdx === srcs.alphaCount) { window._empAlphaMissing = window._empAlphaMissing || {}; window._empAlphaMissing[name] = true; }   // no transparent webm exists / it cannot decode - stop looking for it
                        if (srcs.fxCount && mine.tryIdx === srcs.fxCount) { window._empFxMissing = window._empFxMissing || {}; window._empFxMissing[name] = true; }   // no fx clip exists - stop looking for it
                        _applyMode();
                        try { v.src = mine.srcs[mine.tryIdx]; v.load(); _play(); return; } catch (e) {}
                    }
                    if ((mine.retries || 0) < 2) {                  // NEW: go round the whole list again (flaky mobile data) before giving up
                        mine.retries = (mine.retries || 0) + 1; mine.tryIdx = 0; _applyMode();
                        setTimeout(function () {
                            if (S !== mine) return;
                            try { v.src = mine.srcs[0] + (mine.srcs[0].indexOf('?') > -1 ? '&' : '?') + 'r=' + mine.retries; v.load(); _play(); } catch (e) { _end(true); }
                        }, 1200);
                        return;
                    }
                    _end(true);
                });
                // FIX (2026-10-10 — clips fell back to the emoji on slow mobile data): this used to be one fixed
                // 25s timer, so a clip that WAS downloading, just slowly, was killed at 25s. It is now re-armed every
                // time the browser reports more bytes arriving ('progress'), so it only gives up if the download
                // truly stalls (no new data for STALL_MS) or the total wait passes ABS_MS. Once playback has started
                // the timer is never re-armed.
                mine.t0 = Date.now();
                function _armStall() {
                    clearTimeout(mine.stallT);
                    mine.stallT = setTimeout(function () {
                        if (S === mine && !mine.playing) { console.warn('[GiftVideo] playback did not start in time for "' + name + '" | url=' + (mine.srcs[mine.tryIdx] || '') + ' | readyState=' + v.readyState + ' networkState=' + v.networkState + ' buffered=' + (function () { try { return v.buffered.length ? v.buffered.end(v.buffered.length - 1).toFixed(1) + 's' : '0s'; } catch (e) { return '?'; } })() + ' | waited=' + Math.round((Date.now() - mine.t0) / 1000) + 's'); _end(true); }
                    }, CFG.STALL_MS);
                }
                _armStall();
                v.addEventListener('progress', function () {
                    if (S !== mine || mine.playing) return;
                    if (Date.now() - mine.t0 < (CFG.ABS_MS || 70000)) _armStall();
                });

                _play();
            } catch (err) {
                console.warn('[GiftVideo] animation failed:', err && err.message);
                _cleanup();
            }
        }

        window.empPlayGiftVideo = function (layer, name) {
            try {
                layer = layer || document.getElementById('gift-animation-layer');
                if (!layer) return;
                if (document.hidden) return;                  // tab/app in background: don't build a stale backlog
                if (S && S.root.isConnected) {                // already playing → queue (capped)
                    if (queue.length < CFG.MAX_QUEUE) queue.push({ layer: layer, name: name });
                    return;
                }
                _cleanup();
                _start(layer, name);
            } catch (err) {
                console.warn('[GiftVideo] animation failed:', err && err.message);
                _cleanup();
            }
        };
        window.empPlayUniverse = function (layer) { window.empPlayGiftVideo(layer, 'Universe'); };   // kept for the earlier hook names
        window.empPlayMoneyGunVideo = function (layer) { window.empPlayGiftVideo(layer, 'Money Gun'); };
        window.empPlayLionVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Lion'); };
        window.empPlayUnderControlVideo = function (layer) { window.empPlayGiftVideo(layer, 'Under Control'); };
        window.empPlayPenlightVideo = function (layer) { window.empPlayGiftVideo(layer, 'Penlight'); };
        window.empPlayCastleVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Castle'); };
        window.empPlayHelicopterVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Helicopter'); };
        window.empPlayJetVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Jet'); };
        window.empPlayYachtVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Yacht'); };
        window.empPlayPalaceVideo = function (layer) { window.empPlayGiftVideo(layer, 'Diamond Palace'); };
        window.empPlaySuvVideo = function (layer) { window.empPlayGiftVideo(layer, 'Diamond SUV'); };
        window.empPlayGuitarVideo = function (layer) { window.empPlayGiftVideo(layer, 'Diamond Guitar'); };
        window.empPlayConnectVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Connect'); };
        window.empPlayChronoVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Chronometer'); };
        window.empPlayGoldCoinVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Gold Coin'); };
        window.empPlayCupVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Champions Cup'); };
        window.empPlayWorldChampsVideo = function (layer) { window.empPlayGiftVideo(layer, 'Victory'); };   // NEW 2026-10-17
        window.empPlayArenaVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Arena'); };
        window.empPlayBouquetVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Bouquet'); };
        window.empPlayTeddyVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Teddy'); };
        window.empPlayCakeVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Cake'); };
        window.empPlayCinemaVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Cinema'); };
        window.empPlayRingVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Ring'); };
        window.empPlayDiamondIslandVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Diamond Island'); };
        window.empPlayMovieNightVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Movie Night'); };
        window.empPlayDanceVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Dance'); };
        window.empPlayVictoryVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Victory'); };
        window.empPlayShepherdVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Shepherd'); };
        window.empPlayShadesVideo = function (layer) { window.empPlayGiftVideo(layer, 'Empyrean Shades'); };
        window.empPlayGiftBoxVideo = function (layer) { window.empPlayGiftVideo(layer, 'Gift Box'); };
        window.empPlayIceCreamVideo = function (layer) { window.empPlayGiftVideo(layer, 'Ice Cream'); };
        window.empPlayHeartMillsVideo = function (layer) { window.empPlayGiftVideo(layer, 'Heart Mills'); };
        window.empPlayBalloonVideo = function (layer) { window.empPlayGiftVideo(layer, 'Balloon'); };
        window.empPlayFruitBowlVideo = function (layer) { window.empPlayGiftVideo(layer, 'Fruit Bowl'); };
        window.empPlayRoyalDrumVideo = function (layer) { window.empPlayGiftVideo(layer, 'Royal Drum'); };
        window.empPlayChocolateVideo = function (layer) { window.empPlayGiftVideo(layer, 'Chocolate'); };
        window.empPlayCupcakeVideo = function (layer) { window.empPlayGiftVideo(layer, 'Cupcake'); };
        window.empPlayPerfumeVideo = function (layer) { window.empPlayGiftVideo(layer, 'Perfume'); };
        window.empPlayCandyVideo = function (layer) { window.empPlayGiftVideo(layer, 'Candy'); };
        window.empPlayCoffeeVideo = function (layer) { window.empPlayGiftVideo(layer, 'Coffee'); };
        window.empPlayPizzaSliceVideo = function (layer) { window.empPlayGiftVideo(layer, 'Pizza Slice'); };
        window.empPlayFootballVideo = function (layer) { window.empPlayGiftVideo(layer, 'Football'); };
        window.empPlaySwallowVideo = function (layer) { window.empPlayGiftVideo(layer, 'Swallow'); };
    })();

    /* =========================================================================
       HAT & MUSTACHE — AR "wear it" gift (NEW 2026-10-12)
       -------------------------------------------------------------------------
       When anyone sends "Hat & Mustache" the host's face gets a cowboy hat on
       top of the head and a moustache under the nose, and both FOLLOW the face
       (move / tilt / get bigger as the host leans in) like TikTok's face effects.

       HOW IT STAYS ON THE FACE
         Every device (host + every viewer) runs a tiny face detector on the host
         video it is ALREADY showing and places the two pictures on top of that
         video. Doing it locally (instead of syncing face positions through
         Firestore) means the hat is always perfectly lined up with the video the
         person actually sees — no network lag, no extra Firestore writes/rules.
         The detector (MediaPipe BlazeFace, ~230 KB model + wasm) is downloaded
         once, cached by the browser, and pre-warmed when the gift catalog opens.
         Until it is ready (first time on a very slow connection) the hat is shown
         at a sensible head position, then snaps onto the real face.
         No face in view -> the hat fades out; face back -> it fades back in.

       TUNING (set on window.EMP_HAT_CFG before the first play):
         DURATION_MS — how long the hat stays on (sending again extends it)
         HAT_W / HAT_LIFT / MUSTACHE_W / MUSTACHE_T — size & placement nudges
       ========================================================================= */
    (function empHatMustacheEngine() {
        'use strict';

        var GIFT_NAME = 'Hat & Mustache';
        var HAT_SRC      = 'data:image/webp;base64,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';
        var MUSTACHE_SRC = 'data:image/webp;base64,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';
        window.EMP_HAT_THUMB = window.EMP_HAT_THUMB || 'data:image/webp;base64,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';

        var CFG = window.EMP_HAT_CFG = window.EMP_HAT_CFG || {
            DURATION_MS: 60000,     // hat stays on this long; a new send resets the clock
            DETECT_FPS: 12,         // face-detection rate (rendering itself runs every frame, smoothed)
            LOST_MS: 900,           // face missing this long -> fade the hat out
            HAT_W: 1.9,             // hat width  = face-box width x this
            HAT_ANCHOR_Y: 0.72,     // fraction of the hat picture's height where it meets the head
            HAT_LIFT: 0.82,         // hat sits this many eye-to-mouth distances above the eyes
            MUSTACHE_W: 0.64,       // moustache width = face-box width x this
            MUSTACHE_T: 0.40,       // 0 = at the nose tip, 1 = at the mouth centre
            MP_VERSION: '0.10.14',
            MODEL_URL: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
        };

        /* ---- one-time CSS ---- */
        (function injectCSS() {
            if (document.getElementById('emp-hat-ar-css')) return;
            var s = document.createElement('style');
            s.id = 'emp-hat-ar-css';
            s.textContent =
                '#emp-hat-ar-overlay{position:absolute;inset:0;z-index:6;pointer-events:none;overflow:hidden;}' +
                '#emp-hat-ar-overlay .emp-hat-piece{position:absolute;left:0;top:0;opacity:0;will-change:transform,opacity;' +
                    'transition:opacity .3s ease;filter:drop-shadow(0 4px 6px rgba(0,0,0,.45));}' +
                '#emp-hat-ar-overlay .emp-hat-piece.on{opacity:1;}' +
                '#emp-hat-ar-overlay .emp-hat-piece img{display:block;width:100%;height:auto;-webkit-user-drag:none;user-select:none;}' +
                '#emp-hat-ar-overlay .emp-hat-piece.pop img{animation:empHatPop .6s cubic-bezier(.2,1.5,.4,1) both;}' +
                '@keyframes empHatPop{0%{transform:translateY(-70%) scale(.25);opacity:0;}60%{opacity:1;}100%{transform:none;opacity:1;}}';
            (document.head || document.documentElement).appendChild(s);
        })();

        /* ---- detector loader (MediaPipe tasks-vision, lazy, cached, optional) ---- */
        var _det = null, _detState = 'idle', _detWaiters = [];   // idle | loading | ready | failed
        function _loadDetector() {
            if (_detState === 'ready' || _detState === 'loading') return;
            _detState = 'loading';
            var base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + CFG.MP_VERSION;
            window.__empHatMPDone = function (mp) {
                (async function () {
                    try {
                        var fileset = await mp.FilesetResolver.forVisionTasks(base + '/wasm');
                        var make = function (delegate) {
                            return mp.FaceDetector.createFromOptions(fileset, {
                                baseOptions: { modelAssetPath: CFG.MODEL_URL, delegate: delegate },
                                runningMode: 'VIDEO', minDetectionConfidence: 0.5
                            });
                        };
                        try { _det = await make('GPU'); } catch (eG) { _det = await make('CPU'); }
                        _detState = 'ready';
                    } catch (e) {
                        console.warn('[HatAR] detector init failed — using fixed head position:', e && e.message);
                        _detState = 'failed';
                    }
                })();
            };
            window.__empHatMPFail = function (e) {
                console.warn('[HatAR] could not load face detector — using fixed head position.', e && e.message);
                _detState = 'failed';
            };
            var sc = document.createElement('script');
            sc.type = 'module';
            sc.textContent =
                'import {FilesetResolver, FaceDetector} from "' + base + '/vision_bundle.mjs";' +
                'window.__empHatMPDone({FilesetResolver:FilesetResolver, FaceDetector:FaceDetector});';
            sc.onerror = function () { window.__empHatMPFail(new Error('script load error')); };
            document.head.appendChild(sc);
        }
        // Warm the detector while the catalog is open (skipped when the phone is in data-saver mode).
        window.empPreloadHatAR = function () {
            try {
                var c = navigator.connection;
                if (c && c.saveData) return;
            } catch (e) {}
            _loadDetector();
        };

        /* ---- session state ---- */
        var S = null;   // { until, overlay, hat, must, cur, tgt, lastSeen, shown, detTimer, raf, fake }

        function _meId() { return window.userState && window.userState.id; }
        function _findHostWrapper() {
            var lsd = window.liveStreamData || {};
            var hid = lsd.hostUserId || lsd.hostId;
            var iAmHost = !!(hid && _meId() && hid === _meId());
            var a = document.getElementById('agora-local-video');
            var b = document.getElementById('agora-viewer-video');
            return iAmHost ? (a || b) : (b || a);
        }

        function _buildOverlay() {
            var o = document.createElement('div');
            o.id = 'emp-hat-ar-overlay';
            function piece(src, alt) {
                var p = document.createElement('div');
                p.className = 'emp-hat-piece';
                var i = document.createElement('img');
                i.src = src; i.alt = alt; i.draggable = false;
                p.appendChild(i);
                o.appendChild(p);
                return p;
            }
            S.hat  = piece(HAT_SRC, 'Hat');
            S.must = piece(MUSTACHE_SRC, 'Mustache');
            return o;
        }

        function _attach() {
            var wrap = _findHostWrapper();
            var parent = wrap || (document.querySelector('.live-body .main-host-video') || null);
            if (!parent) return false;
            if (S.overlay.parentNode !== parent) parent.appendChild(S.overlay);
            return true;
        }

        function _isMirrored(video, stopAt) {
            for (var el = video, n = 0; el && el !== stopAt && n < 4; el = el.parentElement, n++) {
                var t = window.getComputedStyle(el).transform;
                if (!t || t === 'none') continue;
                var m = /matrix3d\(([^)]+)\)/.exec(t);
                if (m) { if (parseFloat(m[1].split(',')[0]) < 0) return true; continue; }
                m = /matrix\(([^)]+)\)/.exec(t);
                if (m && parseFloat(m[1].split(',')[0]) < 0) return true;
            }
            return false;
        }

        // keypoints (video px) -> overlay px, honouring object-fit and mirroring
        function _mapper(video, overlay) {
            var vr = video.getBoundingClientRect(), pr = overlay.getBoundingClientRect();
            var Vw = video.videoWidth, Vh = video.videoHeight;
            if (!Vw || !Vh || !vr.width || !vr.height) return null;
            var fit = window.getComputedStyle(video).objectFit || 'cover';
            var sx = vr.width / Vw, sy = vr.height / Vh, sc;
            if (fit === 'fill') { sc = null; }
            else if (fit === 'contain' || fit === 'scale-down') { sc = Math.min(sx, sy); }
            else { sc = Math.max(sx, sy); }
            var kx = sc || sx, ky = sc || sy;
            var ox = (vr.width  - Vw * kx) / 2, oy = (vr.height - Vh * ky) / 2;
            var mirror = _isMirrored(video, overlay.parentElement);
            return {
                scale: kx,
                pt: function (x, y) {
                    var px = ox + x * kx;
                    if (mirror) px = vr.width - px;
                    return { x: vr.left + px - pr.left, y: vr.top + oy + y * ky - pr.top };
                }
            };
        }

        function _poseFromKeypoints(E, N, M, eyeA, eyeB, faceW) {
            var ux = E.x - M.x, uy = E.y - M.y, d = Math.sqrt(ux * ux + uy * uy) || 1;
            ux /= d; uy /= d;                                           // unit "up" (mouth -> eyes)
            var l = eyeA.x < eyeB.x ? eyeA : eyeB, r = eyeA.x < eyeB.x ? eyeB : eyeA;
            var rot = Math.atan2(r.y - l.y, r.x - l.x);                 // head roll, already in screen space
            var hatW = faceW * CFG.HAT_W, mW = faceW * CFG.MUSTACHE_W;
            return {
                hat:  { x: E.x + ux * d * CFG.HAT_LIFT, y: E.y + uy * d * CFG.HAT_LIFT, w: hatW, rot: rot },
                must: { x: N.x + (M.x - N.x) * CFG.MUSTACHE_T, y: N.y + (M.y - N.y) * CFG.MUSTACHE_T, w: mW, rot: rot }
            };
        }

        // Sensible head position for when no detector is available (yet).
        function _fakePose(overlay) {
            var W = overlay.clientWidth || 360, H = overlay.clientHeight || 640;
            var fw = Math.min(W * 0.42, H * 0.26), cx = W / 2;
            var E = { x: cx, y: H * 0.34 }, N = { x: cx, y: H * 0.34 + fw * 0.30 }, M = { x: cx, y: H * 0.34 + fw * 0.52 };
            return _poseFromKeypoints(E, N, M, { x: cx - fw * 0.2, y: E.y }, { x: cx + fw * 0.2, y: E.y }, fw);
        }

        function _detectTick() {
            if (!S) return;
            S.detTimer = setTimeout(_detectTick, Math.round(1000 / CFG.DETECT_FPS));
            if (document.hidden) return;
            if (Date.now() > S.until) { _stop(); return; }
            if (!_attach() && !S.overlay.isConnected) { _stop(); return; }   // stream ended / video gone

            var wrap = S.overlay.parentNode;
            var video = wrap && wrap.querySelector && wrap.querySelector('video');
            var live = video && video.readyState >= 2 && video.videoWidth > 0;

            if (_det && live) {
                var res;
                try { res = _det.detectForVideo(video, performance.now()); } catch (e) { res = null; }
                var f = res && res.detections && res.detections[0];
                var mp = f && _mapper(video, S.overlay);
                if (f && mp && f.keypoints && f.keypoints.length >= 4 && f.boundingBox) {
                    var vw = video.videoWidth, vh = video.videoHeight, k = f.keypoints;
                    var eA = mp.pt(k[0].x * vw, k[0].y * vh), eB = mp.pt(k[1].x * vw, k[1].y * vh);
                    var N  = mp.pt(k[2].x * vw, k[2].y * vh), M  = mp.pt(k[3].x * vw, k[3].y * vh);
                    var E  = { x: (eA.x + eB.x) / 2, y: (eA.y + eB.y) / 2 };
                    S.tgt = _poseFromKeypoints(E, N, M, eA, eB, f.boundingBox.width * mp.scale);
                    S.lastSeen = Date.now();
                }
            } else if (!_det && _detState !== 'ready') {
                // detector still downloading / unavailable: fixed head position
                S.tgt = _fakePose(S.overlay);
                S.lastSeen = Date.now();
            }
        }

        function _lerp(a, b, t) { return a + (b - a) * t; }
        function _apply(piece, cur, aY) {
            var W = cur.w, el = piece.firstChild;
            var H = el.naturalWidth ? W * (el.naturalHeight / el.naturalWidth) : W * 0.5;
            piece.style.width = W + 'px';
            piece.style.transformOrigin = '50% ' + (aY * 100) + '%';
            piece.style.transform = 'translate(' + (cur.x - W / 2) + 'px,' + (cur.y - H * aY) + 'px) rotate(' + cur.rot + 'rad)';
        }
        function _frame() {
            if (!S) return;
            S.raf = requestAnimationFrame(_frame);
            var now = Date.now();
            var visible = S.tgt && (now - S.lastSeen) < CFG.LOST_MS;
            if (S.tgt) {
                if (!S.cur) { S.cur = JSON.parse(JSON.stringify(S.tgt)); }
                else {
                    ['hat', 'must'].forEach(function (k) {
                        var c = S.cur[k], t = S.tgt[k], a = 0.38;
                        c.x = _lerp(c.x, t.x, a); c.y = _lerp(c.y, t.y, a);
                        c.w = _lerp(c.w, t.w, a); c.rot = _lerp(c.rot, t.rot, a);
                    });
                }
                _apply(S.hat,  S.cur.hat,  CFG.HAT_ANCHOR_Y);
                _apply(S.must, S.cur.must, 0.5);
            }
            if (visible && !S.shown) {
                S.shown = true;
                [S.hat, S.must].forEach(function (p, i) {
                    p.classList.remove('pop'); void p.offsetWidth;
                    p.firstChild.style.animationDelay = (i * 0.12) + 's';
                    p.classList.add('pop', 'on');
                });
            } else if (!visible && S.shown) {
                S.shown = false;
                S.cur = null;           // re-acquire cleanly when the face comes back
                S.hat.classList.remove('on'); S.must.classList.remove('on');
            }
        }

        function _stop() {
            if (!S) return;
            clearTimeout(S.detTimer); cancelAnimationFrame(S.raf);
            var o = S.overlay;
            if (o && o.parentNode) {
                o.style.transition = 'opacity .4s ease'; o.style.opacity = '0';
                setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 450);
            }
            S = null;
        }
        window.empStopHatGift = _stop;

        window.empPlayHatGift = function (layer) {
            _loadDetector();
            if (S) { S.until = Date.now() + CFG.DURATION_MS; return; }   // already wearing it — extend
            S = { until: Date.now() + CFG.DURATION_MS, overlay: null, hat: null, must: null,
                  cur: null, tgt: null, lastSeen: 0, shown: false, detTimer: 0, raf: 0 };
            S.overlay = _buildOverlay();
            if (!_attach()) {
                // host video not on screen (e.g. camera off) — fall back to the gift layer so it is still seen
                var host = layer && layer.parentElement;
                if (host) host.appendChild(S.overlay);
            }
            _detectTick();
            S.raf = requestAnimationFrame(_frame);
        };
    })();

    /**
     * showGiftAnimation(symbol, giftName)
     * Plays the floating icon animation inside #gift-animation-layer.
     * Heart Mills triggers the multi-heart shower instead.
     *
     * FIX: `symbol` used to be a plain emoji character, so the special
     * Heart Mills case was detected with `symbol === '💖'`. Now that
     * `symbol` is an SVG markup string (see catalog above), that
     * equality check would never match, silently dropping the heart
     * shower. Detect Heart Mills by name instead — pass giftName at
     * every call site.
     */
    function showGiftAnimation(symbol, giftName) {
        const layer = document.getElementById('gift-animation-layer');
        if (!layer) return;
        if (giftName === 'Money Gun' && window.empPlayMoneyGunVideo) { window.empPlayMoneyGunVideo(layer); return; }  // 3D video replaces the old canvas gun
        if (giftName === 'Money Gun' && window.empPlayMoneyGun) { window.empPlayMoneyGun(layer); return; }
        if (giftName === 'Universe' && window.empPlayUniverse) { window.empPlayUniverse(layer); return; }
        if (giftName === 'Empyrean Lion' && window.empPlayLionVideo) { window.empPlayLionVideo(layer); return; }
        if (giftName === 'Under Control' && window.empPlayUnderControlVideo) { window.empPlayUnderControlVideo(layer); return; }
        if ((giftName === 'Penlight' || giftName === 'Empyrean Penlight') && window.empPlayPenlightVideo) { window.empPlayPenlightVideo(layer); return; }
        if (giftName === 'Empyrean Castle' && window.empPlayCastleVideo) { window.empPlayCastleVideo(layer); return; }
        if (giftName === 'Empyrean Helicopter' && window.empPlayHelicopterVideo) { window.empPlayHelicopterVideo(layer); return; }
        if (giftName === 'Empyrean Jet' && window.empPlayJetVideo) { window.empPlayJetVideo(layer); return; }
        if (giftName === 'Empyrean Yacht' && window.empPlayYachtVideo) { window.empPlayYachtVideo(layer); return; }
        if (giftName === 'Diamond Palace' && window.empPlayPalaceVideo) { window.empPlayPalaceVideo(layer); return; }
        if (giftName === 'Diamond SUV' && window.empPlaySuvVideo) { window.empPlaySuvVideo(layer); return; }
        if (giftName === 'Diamond Guitar' && window.empPlayGuitarVideo) { window.empPlayGuitarVideo(layer); return; }
        if (giftName === 'Empyrean Connect' && window.empPlayConnectVideo) { window.empPlayConnectVideo(layer); return; }
        if (giftName === 'Empyrean Chronometer' && window.empPlayChronoVideo) { window.empPlayChronoVideo(layer); return; }
        if (giftName === 'Empyrean Gold Coin' && window.empPlayGoldCoinVideo) { window.empPlayGoldCoinVideo(layer); return; }
        if (giftName === 'Empyrean Champions Cup' && window.empPlayCupVideo) { window.empPlayCupVideo(layer); return; }
        if (giftName === 'Victory' && window.empPlayWorldChampsVideo) { window.empPlayWorldChampsVideo(layer); return; }
        if (giftName === 'Empyrean Arena' && window.empPlayArenaVideo) { window.empPlayArenaVideo(layer); return; }
        if (giftName === 'Empyrean Bouquet' && window.empPlayBouquetVideo) { window.empPlayBouquetVideo(layer); return; }
        if (giftName === 'Empyrean Teddy' && window.empPlayTeddyVideo) { window.empPlayTeddyVideo(layer); return; }
        if (giftName === 'Empyrean Cake' && window.empPlayCakeVideo) { window.empPlayCakeVideo(layer); return; }
        if (giftName === 'Empyrean Cinema' && window.empPlayCinemaVideo) { window.empPlayCinemaVideo(layer); return; }
        if (giftName === 'Empyrean Ring' && window.empPlayRingVideo) { window.empPlayRingVideo(layer); return; }
        if (giftName === 'Empyrean Diamond Island' && window.empPlayDiamondIslandVideo) { window.empPlayDiamondIslandVideo(layer); return; }
        if (giftName === 'Empyrean Movie Night' && window.empPlayMovieNightVideo) { window.empPlayMovieNightVideo(layer); return; }
        if (giftName === 'Empyrean Dance' && window.empPlayDanceVideo) { window.empPlayDanceVideo(layer); return; }
        if (giftName === 'Empyrean Victory' && window.empPlayVictoryVideo) { window.empPlayVictoryVideo(layer); return; }
        if (giftName === 'Empyrean Shepherd' && window.empPlayShepherdVideo) { window.empPlayShepherdVideo(layer); return; }
        if (giftName === 'Empyrean Shades' && window.empPlayShadesVideo) { window.empPlayShadesVideo(layer); return; }
        if (giftName === 'Gift Box' && window.empPlayGiftBoxVideo) { window.empPlayGiftBoxVideo(layer); return; }
        if (giftName === 'Ice Cream' && window.empPlayIceCreamVideo) { window.empPlayIceCreamVideo(layer); return; }
        if (giftName === 'Heart Mills' && window.empPlayHeartMillsVideo) { window.empPlayHeartMillsVideo(layer); return; }  // 3D clip replaces the old heart shower (shower stays as the fallback below)
        if (giftName === 'Balloon' && window.empPlayBalloonVideo) { window.empPlayBalloonVideo(layer); return; }
        if (giftName === 'Fruit Bowl' && window.empPlayFruitBowlVideo) { window.empPlayFruitBowlVideo(layer); return; }
        if (giftName === 'Royal Drum' && window.empPlayRoyalDrumVideo) { window.empPlayRoyalDrumVideo(layer); return; }
        if (giftName === 'Chocolate' && window.empPlayChocolateVideo) { window.empPlayChocolateVideo(layer); return; }
        if (giftName === 'Cupcake' && window.empPlayCupcakeVideo) { window.empPlayCupcakeVideo(layer); return; }
        if (giftName === 'Perfume' && window.empPlayPerfumeVideo) { window.empPlayPerfumeVideo(layer); return; }
        if (giftName === 'Candy' && window.empPlayCandyVideo) { window.empPlayCandyVideo(layer); return; }
        if (giftName === 'Coffee' && window.empPlayCoffeeVideo) { window.empPlayCoffeeVideo(layer); return; }
        if (giftName === 'Pizza Slice' && window.empPlayPizzaSliceVideo) { window.empPlayPizzaSliceVideo(layer); return; }
        if (giftName === 'Football' && window.empPlayFootballVideo) { window.empPlayFootballVideo(layer); return; }
        if (giftName === 'Swallow' && window.empPlaySwallowVideo) { window.empPlaySwallowVideo(layer); return; }
        if (giftName === 'Hat & Mustache' && window.empPlayHatGift) { window.empPlayHatGift(layer); return; }  // AR: hat + moustache worn by the host

        if (giftName === 'Heart Mills') {
            showHeartMillsAnimation(layer);
        } else {
            const el      = document.createElement('div');
            el.className  = 'gift-animation';

            // PATCH (session 2026-07-19) — see the matching CSS comment
            // above (SECTION 2) for the full rationale. Uses this file's
            // own EMPY_GIFT_CATALOG/.tier directly (the real source of
            // truth) rather than re-deriving thresholds, so it can't drift.
            const _entry = EMPY_GIFT_CATALOG.find(function (g) { return g.name === giftName; });
            if (_entry && (_entry.tier === 'basic' || _entry.tier === 'rare')) {
                el.classList.add('gift-animation-small');
            }
            if (giftName === 'Empy Token' || /class="[^"]*token[^"]*"/i.test(symbol || '')) {
                el.classList.add('gift-animation-token');
            }

            el.innerHTML  = symbol; // symbol is SVG markup, not plain text
            el.dataset.giftName = giftName || '';
            el.style.left = (20 + Math.random() * 60) + '%';
            layer.appendChild(el);
            setTimeout(function () { el.remove(); }, 3000);
        }
    }
    window.showGiftAnimation = showGiftAnimation;

    /**
     * triggerGiftAnimation(symbol, giftName)
     * Alias used by the live quick-send side tab and the quick-rose button.
     * Plays directly inside #gift-animation-layer with giftFloat keyframe.
     */
    function triggerGiftAnimation(symbol, giftName) {
        const layer = document.getElementById('gift-animation-layer');
        if (!layer) return;
        if (giftName === 'Money Gun' && window.empPlayMoneyGunVideo) { window.empPlayMoneyGunVideo(layer); return; }  // 3D video replaces the old canvas gun
        if (giftName === 'Money Gun' && window.empPlayMoneyGun) { window.empPlayMoneyGun(layer); return; }
        if (giftName === 'Universe' && window.empPlayUniverse) { window.empPlayUniverse(layer); return; }
        if (giftName === 'Empyrean Lion' && window.empPlayLionVideo) { window.empPlayLionVideo(layer); return; }
        if (giftName === 'Under Control' && window.empPlayUnderControlVideo) { window.empPlayUnderControlVideo(layer); return; }
        if ((giftName === 'Penlight' || giftName === 'Empyrean Penlight') && window.empPlayPenlightVideo) { window.empPlayPenlightVideo(layer); return; }
        if (giftName === 'Empyrean Castle' && window.empPlayCastleVideo) { window.empPlayCastleVideo(layer); return; }
        if (giftName === 'Empyrean Helicopter' && window.empPlayHelicopterVideo) { window.empPlayHelicopterVideo(layer); return; }
        if (giftName === 'Empyrean Jet' && window.empPlayJetVideo) { window.empPlayJetVideo(layer); return; }
        if (giftName === 'Empyrean Yacht' && window.empPlayYachtVideo) { window.empPlayYachtVideo(layer); return; }
        if (giftName === 'Diamond Palace' && window.empPlayPalaceVideo) { window.empPlayPalaceVideo(layer); return; }
        if (giftName === 'Diamond SUV' && window.empPlaySuvVideo) { window.empPlaySuvVideo(layer); return; }
        if (giftName === 'Diamond Guitar' && window.empPlayGuitarVideo) { window.empPlayGuitarVideo(layer); return; }
        if (giftName === 'Empyrean Connect' && window.empPlayConnectVideo) { window.empPlayConnectVideo(layer); return; }
        if (giftName === 'Empyrean Chronometer' && window.empPlayChronoVideo) { window.empPlayChronoVideo(layer); return; }
        if (giftName === 'Empyrean Gold Coin' && window.empPlayGoldCoinVideo) { window.empPlayGoldCoinVideo(layer); return; }
        if (giftName === 'Empyrean Champions Cup' && window.empPlayCupVideo) { window.empPlayCupVideo(layer); return; }
        if (giftName === 'Victory' && window.empPlayWorldChampsVideo) { window.empPlayWorldChampsVideo(layer); return; }
        if (giftName === 'Empyrean Arena' && window.empPlayArenaVideo) { window.empPlayArenaVideo(layer); return; }
        if (giftName === 'Empyrean Bouquet' && window.empPlayBouquetVideo) { window.empPlayBouquetVideo(layer); return; }
        if (giftName === 'Empyrean Teddy' && window.empPlayTeddyVideo) { window.empPlayTeddyVideo(layer); return; }
        if (giftName === 'Empyrean Cake' && window.empPlayCakeVideo) { window.empPlayCakeVideo(layer); return; }
        if (giftName === 'Empyrean Cinema' && window.empPlayCinemaVideo) { window.empPlayCinemaVideo(layer); return; }
        if (giftName === 'Empyrean Ring' && window.empPlayRingVideo) { window.empPlayRingVideo(layer); return; }
        if (giftName === 'Empyrean Diamond Island' && window.empPlayDiamondIslandVideo) { window.empPlayDiamondIslandVideo(layer); return; }
        if (giftName === 'Empyrean Movie Night' && window.empPlayMovieNightVideo) { window.empPlayMovieNightVideo(layer); return; }
        if (giftName === 'Empyrean Dance' && window.empPlayDanceVideo) { window.empPlayDanceVideo(layer); return; }
        if (giftName === 'Empyrean Victory' && window.empPlayVictoryVideo) { window.empPlayVictoryVideo(layer); return; }
        if (giftName === 'Empyrean Shepherd' && window.empPlayShepherdVideo) { window.empPlayShepherdVideo(layer); return; }
        if (giftName === 'Empyrean Shades' && window.empPlayShadesVideo) { window.empPlayShadesVideo(layer); return; }
        if (giftName === 'Gift Box' && window.empPlayGiftBoxVideo) { window.empPlayGiftBoxVideo(layer); return; }
        if (giftName === 'Ice Cream' && window.empPlayIceCreamVideo) { window.empPlayIceCreamVideo(layer); return; }
        if (giftName === 'Heart Mills' && window.empPlayHeartMillsVideo) { window.empPlayHeartMillsVideo(layer); return; }  // 3D clip replaces the old heart shower (shower stays as the fallback below)
        if (giftName === 'Balloon' && window.empPlayBalloonVideo) { window.empPlayBalloonVideo(layer); return; }
        if (giftName === 'Fruit Bowl' && window.empPlayFruitBowlVideo) { window.empPlayFruitBowlVideo(layer); return; }
        if (giftName === 'Royal Drum' && window.empPlayRoyalDrumVideo) { window.empPlayRoyalDrumVideo(layer); return; }
        if (giftName === 'Chocolate' && window.empPlayChocolateVideo) { window.empPlayChocolateVideo(layer); return; }
        if (giftName === 'Cupcake' && window.empPlayCupcakeVideo) { window.empPlayCupcakeVideo(layer); return; }
        if (giftName === 'Perfume' && window.empPlayPerfumeVideo) { window.empPlayPerfumeVideo(layer); return; }
        if (giftName === 'Candy' && window.empPlayCandyVideo) { window.empPlayCandyVideo(layer); return; }
        if (giftName === 'Coffee' && window.empPlayCoffeeVideo) { window.empPlayCoffeeVideo(layer); return; }
        if (giftName === 'Pizza Slice' && window.empPlayPizzaSliceVideo) { window.empPlayPizzaSliceVideo(layer); return; }
        if (giftName === 'Football' && window.empPlayFootballVideo) { window.empPlayFootballVideo(layer); return; }
        if (giftName === 'Swallow' && window.empPlaySwallowVideo) { window.empPlaySwallowVideo(layer); return; }
        if (giftName === 'Hat & Mustache' && window.empPlayHatGift) { window.empPlayHatGift(layer); return; }  // AR: hat + moustache worn by the host

        if (giftName === 'Heart Mills') {
            showHeartMillsAnimation(layer);
            return;
        }
        const el      = document.createElement('div');
        el.className  = 'gift-animation';

        // PATCH (session 2026-07-19) — same tier/token classification as
        // showGiftAnimation() above, kept in sync since both read the same
        // EMPY_GIFT_CATALOG.
        const _entry = EMPY_GIFT_CATALOG.find(function (g) { return g.name === giftName; });
        if (_entry && (_entry.tier === 'basic' || _entry.tier === 'rare')) {
            el.classList.add('gift-animation-small');
        }
        if (giftName === 'Empy Token' || /class="[^"]*token[^"]*"/i.test(symbol || '')) {
            el.classList.add('gift-animation-token');
        }

        el.innerHTML  = symbol; // symbol is SVG markup, not plain text
        el.dataset.giftName = giftName || '';
        el.style.left = (20 + Math.random() * 60) + '%';
        layer.appendChild(el);
        setTimeout(function () { el.remove(); }, 2200);
    }
    window.triggerGiftAnimation = triggerGiftAnimation;

    /**
     * showHeartMillsAnimation(layer)
     * Spawns 20 animated hearts for the Heart Mills gift (💖).
     */
    function showHeartMillsAnimation(layer) {
        layer = layer || document.getElementById('gift-animation-layer');
        if (!layer) return;
        const HEART_GLYPHS = ['💖', '💗', '❤️', '💕'];
        for (let i = 0; i < 20; i++) {
            const heart       = document.createElement('span');
            heart.className   = 'heart-mill-animation';
            heart.textContent = HEART_GLYPHS[Math.floor(Math.random() * HEART_GLYPHS.length)];
            const startX      = Math.random() * 100;
            const delay       = Math.random() * 2000;
            heart.style.left  = startX + 'vw';
            heart.style.fontSize = (1.1 + Math.random() * 1.2) + 'rem';
            heart.style.animationDelay = delay + 'ms';
            layer.appendChild(heart);
            setTimeout(function () { heart.remove(); }, 4000 + delay);
        }
    }
    window.showHeartMillsAnimation = showHeartMillsAnimation;

    // ─────────────────────────────────────────────────────────────
    // SECTION 4: populateGiftCatalog
    // Renders the full grid inside #gift-grid-container (modal).
    // ─────────────────────────────────────────────────────────────
    // NEW (2026-10-10): the Money Gun tile shows the real Empyrean Money Gun artwork instead of the
    // generic 💸 emoji. ONLY the displayed glyph changes — gift.symbol (and every data-symbol attribute
    // built from it) stays the emoji, so chat lines, notifications and the send handlers are untouched.
    // NEW (2026-10-12): premium vector icons that replace the plain emoji on these catalog tiles (display only —
    // gift.symbol, prices, sending, animations and every other list are unchanged; Diamond Ring is intentionally left as it was).
    var EMP_PREMIUM_ICONS = {
        "Teddy Bear": "<circle cx=\"17\" cy=\"15\" r=\"7\" fill=\"#8a5a33\"/><circle cx=\"47\" cy=\"15\" r=\"7\" fill=\"#8a5a33\"/><circle cx=\"17\" cy=\"15\" r=\"3.6\" fill=\"#e8b98a\"/><circle cx=\"47\" cy=\"15\" r=\"3.6\" fill=\"#e8b98a\"/><ellipse cx=\"32\" cy=\"46\" rx=\"15\" ry=\"14\" fill=\"#a8693a\"/><ellipse cx=\"32\" cy=\"49\" rx=\"9\" ry=\"9\" fill=\"#e8b98a\"/><circle cx=\"32\" cy=\"26\" r=\"15\" fill=\"#b9763f\"/><ellipse cx=\"32\" cy=\"31\" rx=\"7.5\" ry=\"5.5\" fill=\"#f0c9a0\"/><ellipse cx=\"32\" cy=\"28.6\" rx=\"2.6\" ry=\"1.9\" fill=\"#3b2314\"/><circle cx=\"25.5\" cy=\"23\" r=\"2.2\" fill=\"#2a170c\"/><circle cx=\"38.5\" cy=\"23\" r=\"2.2\" fill=\"#2a170c\"/><circle cx=\"26.2\" cy=\"22.3\" r=\".7\" fill=\"#fff\"/><circle cx=\"39.2\" cy=\"22.3\" r=\".7\" fill=\"#fff\"/><path d=\"M29.5 33.2q2.5 2 5 0\" fill=\"none\" stroke=\"#3b2314\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M32 40.5l-9-4.2v8.4zM32 40.5l9-4.2v8.4z\" fill=\"#d6283c\" stroke=\"#f4c542\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><circle cx=\"32\" cy=\"40.5\" r=\"2.4\" fill=\"#f4c542\"/><ellipse cx=\"18\" cy=\"55\" rx=\"5.5\" ry=\"4\" fill=\"#8a5a33\"/><ellipse cx=\"46\" cy=\"55\" rx=\"5.5\" ry=\"4\" fill=\"#8a5a33\"/>",
        "Birthday Cake": "<ellipse cx=\"32\" cy=\"56\" rx=\"26\" ry=\"5\" fill=\"#f4c542\"/><ellipse cx=\"32\" cy=\"55\" rx=\"23\" ry=\"3.6\" fill=\"#ffe08a\"/><rect x=\"10\" y=\"38\" width=\"44\" height=\"16\" rx=\"4\" fill=\"#7b4a2a\"/><path d=\"M10 42q4 5 7 0t7 0t7 0t7 0t7 0t9 0v-4a4 4 0 0 0-4-4H14a4 4 0 0 0-4 4z\" fill=\"#ff8fb3\"/><rect x=\"16\" y=\"24\" width=\"32\" height=\"14\" rx=\"4\" fill=\"#fff2d6\"/><path d=\"M16 28q4 5 8 0t8 0t8 0t8 0v-4a4 4 0 0 0-4-4H20a4 4 0 0 0-4 4z\" fill=\"#ff5c8a\"/><circle cx=\"22\" cy=\"46\" r=\"1.6\" fill=\"#ffd54a\"/><circle cx=\"32\" cy=\"48\" r=\"1.6\" fill=\"#ffd54a\"/><circle cx=\"42\" cy=\"46\" r=\"1.6\" fill=\"#ffd54a\"/><rect x=\"21\" y=\"12\" width=\"4\" height=\"10\" rx=\"1.2\" fill=\"#5ec8ff\"/><rect x=\"30\" y=\"10\" width=\"4\" height=\"12\" rx=\"1.2\" fill=\"#ffd54a\"/><rect x=\"39\" y=\"12\" width=\"4\" height=\"10\" rx=\"1.2\" fill=\"#9be564\"/><path d=\"M23 11c-2-3 0-5 0-6 2 1 3 4 0 6zM32 9c-2-3 0-5 0-6 2 1 3 4 0 6zM41 11c-2-3 0-5 0-6 2 1 3 4 0 6z\" fill=\"#ffb02e\"/>",
        "Camera": "<path d=\"M20 15l3-5h18l3 5z\" fill=\"#2b2f3a\"/><rect x=\"48\" y=\"11\" width=\"6\" height=\"4\" rx=\"1.2\" fill=\"#f4c542\"/><rect x=\"6\" y=\"15\" width=\"52\" height=\"36\" rx=\"7\" fill=\"#2b2f3a\"/><rect x=\"6\" y=\"15\" width=\"52\" height=\"11\" rx=\"6\" fill=\"#3b4150\"/><rect x=\"6\" y=\"40\" width=\"52\" height=\"11\" rx=\"6\" fill=\"#222630\"/><circle cx=\"32\" cy=\"33\" r=\"15\" fill=\"#f4c542\"/><circle cx=\"32\" cy=\"33\" r=\"12.2\" fill=\"#14171e\"/><circle cx=\"32\" cy=\"33\" r=\"8.6\" fill=\"#2f5d9e\"/><circle cx=\"32\" cy=\"33\" r=\"5\" fill=\"#122a4d\"/><circle cx=\"28.4\" cy=\"29.4\" r=\"2.4\" fill=\"#fff\" opacity=\".85\"/><circle cx=\"35.6\" cy=\"36.6\" r=\"1.1\" fill=\"#fff\" opacity=\".6\"/><circle cx=\"13\" cy=\"22\" r=\"2.4\" fill=\"#f4c542\"/>",
        "Flower Bouquet": "<path d=\"M32 62L21 38h22z\" fill=\"#6db84a\"/><path d=\"M24 36q-10-4-12-14q8 2 12 14zM40 36q10-4 12-14q-8 2-12 14z\" fill=\"#4e9a3a\"/><circle cx=\"20\" cy=\"26\" r=\"9\" fill=\"#ff8fb3\"/><circle cx=\"20\" cy=\"26\" r=\"5.2\" fill=\"#ff5c8a\"/><circle cx=\"20\" cy=\"26\" r=\"2\" fill=\"#c42a5e\"/><circle cx=\"44\" cy=\"26\" r=\"9\" fill=\"#ffb86b\"/><circle cx=\"44\" cy=\"26\" r=\"5.2\" fill=\"#ff9638\"/><circle cx=\"44\" cy=\"26\" r=\"2\" fill=\"#c8620e\"/><circle cx=\"32\" cy=\"17\" r=\"10\" fill=\"#e8344f\"/><circle cx=\"32\" cy=\"17\" r=\"6\" fill=\"#c41f3a\"/><circle cx=\"32\" cy=\"17\" r=\"2.4\" fill=\"#8f1229\"/><circle cx=\"31\" cy=\"34\" r=\"6\" fill=\"#b79cff\"/><circle cx=\"31\" cy=\"34\" r=\"3\" fill=\"#8b6df0\"/><path d=\"M32 44l-10 8 5 2 5-4 5 4 5-2z\" fill=\"#f4c542\"/><circle cx=\"32\" cy=\"45\" r=\"3\" fill=\"#ffe08a\"/>",
        "Island": "<circle cx=\"48\" cy=\"14\" r=\"8\" fill=\"#ffd54a\"/><rect x=\"3\" y=\"43\" width=\"58\" height=\"19\" rx=\"9\" fill=\"#2aa7e0\"/><rect x=\"3\" y=\"51\" width=\"58\" height=\"11\" rx=\"5.5\" fill=\"#1d86c0\"/><path d=\"M12 46q8-14 22-14q12 0 18 14q-12 5-20 5q-12 0-20-5z\" fill=\"#f2cf7e\"/><path d=\"M18 45q6-8 16-9q8 0 14 9z\" fill=\"#e0b85c\" opacity=\".6\"/><path d=\"M33 41q-3-12 1-24\" fill=\"none\" stroke=\"#7b4a2a\" stroke-width=\"3.2\" stroke-linecap=\"round\"/><path d=\"M34 17q-9-6-17 0q8-2 17 0zM34 17q9-7 18 0q-9-2-18 0zM34 17q-5-9-14-8q8 2 14 8zM34 17q5-9 14-8q-8 2-14 8z\" fill=\"#3fae49\" stroke=\"#2c8a37\" stroke-width=\".8\" stroke-linejoin=\"round\"/><circle cx=\"31.5\" cy=\"21\" r=\"1.8\" fill=\"#7b4a2a\"/><circle cx=\"36\" cy=\"21.5\" r=\"1.8\" fill=\"#7b4a2a\"/>"
};
    function _premiumGlyph(name) {
        var b = EMP_PREMIUM_ICONS[name];
        if (!b) return null;
        return '<svg class="emp-premium-glyph" role="img" aria-label="' + name + '" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" ' +
            'style="width:84%;height:84%;display:block;position:relative;z-index:1;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));">' + b + '</svg>';
    }

    // NEW (2026-10-13): the Flower Bouquet tile shows a real bouquet photo instead of the vector icon (display only —
    // gift.symbol, price, sending and animations are unchanged).
    if (window.EMP_FLOWER_BOUQUET_THUMB === undefined) window.EMP_FLOWER_BOUQUET_THUMB = 'data:image/webp;base64,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';

    // NEW (2026-10-13): the Diamond Ring tile shows a real diamond-ring photo instead of the 💍 emoji (display only —
    // gift.symbol, price, sending and animations are unchanged).
    if (window.EMP_DIAMOND_RING_THUMB === undefined) window.EMP_DIAMOND_RING_THUMB = 'data:image/webp;base64,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';

    function _giftGlyph(gift) {
        if (gift && gift.name === 'Diamond Ring' && window.EMP_DIAMOND_RING_THUMB) {
            return '<img class="emp-dr-glyph" alt="Diamond Ring" draggable="false" src="' + String(window.EMP_DIAMOND_RING_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(190,225,255,.75);">';
        }
        if (gift && gift.name === 'Flower Bouquet' && window.EMP_FLOWER_BOUQUET_THUMB) {
            return '<img class="emp-fb-glyph" alt="Flower Bouquet" draggable="false" src="' + String(window.EMP_FLOWER_BOUQUET_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,150,190,.7);">';
        }
        if (gift && gift.name === 'Money Gun' && window.EMP_MONEY_GUN_THUMB) {
            return '<img class="emp-mg-glyph" alt="Money Gun" draggable="false" src="' + String(window.EMP_MONEY_GUN_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:22%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,200,80,.6);">';
        }
        if (gift && gift.name === 'Money Gun' && window.EMP_MONEY_GUN_IMG) {
            return '<img class="emp-mg-glyph" alt="Money Gun" draggable="false" src="' + String(window.EMP_MONEY_GUN_IMG).replace(/"/g, '') +
                '" style="width:86%;height:86%;object-fit:contain;position:relative;z-index:1;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));">';
        }
        // NEW (2026-10-10): the Under Control tile shows a frame from its clip (display only — gift.symbol stays 🎮).
        if (gift && gift.name === 'Under Control' && window.EMP_UNDERCONTROL_THUMB) {
            return '<img class="emp-uc-glyph" alt="Under Control" draggable="false" src="' + String(window.EMP_UNDERCONTROL_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(80,200,255,.7);">';
        }
        // NEW (2026-10-10): the Empyrean Lion tile shows a frame from its clip (display only — gift.symbol stays 🦁).
        if (gift && gift.name === 'Empyrean Lion' && window.EMP_LION_THUMB) {
            return '<img class="emp-lion-glyph" alt="Empyrean Lion" draggable="false" src="' + String(window.EMP_LION_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,190,70,.7);">';
        }
        // NEW (2026-10-10): the Universe tile shows a frame from the clip itself (display only — gift.symbol stays 🌌).
        if (gift && gift.name === 'Universe' && window.EMP_UNIVERSE_THUMB) {
            return '<img class="emp-uv-glyph" alt="Universe" draggable="false" src="' + String(window.EMP_UNIVERSE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(120,150,255,.7);">';
        }
        // NEW (2026-10-10): the Penlight tile shows a frame from its clip (display only — gift.symbol stays 🔦).
        if (gift && (gift.name === 'Penlight' || gift.name === 'Empyrean Penlight') && window.EMP_PENLIGHT_THUMB) {
            return '<img class="emp-pl-glyph" alt="Penlight" draggable="false" src="' + String(window.EMP_PENLIGHT_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(90,200,255,.7);">';
        }
        // NEW (2026-10-10): the Empyrean Castle tile shows a frame from its clip (display only — gift.symbol stays 👸).
        if (gift && gift.name === 'Empyrean Castle' && window.EMP_CASTLE_THUMB) {
            return '<img class="emp-cs-glyph" alt="Empyrean Castle" draggable="false" src="' + String(window.EMP_CASTLE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(230,180,255,.7);">';
        }
        // NEW (2026-10-10): the Empyrean Helicopter tile shows a frame from its clip (display only — gift.symbol stays 🚁).
        if (gift && gift.name === 'Empyrean Helicopter' && window.EMP_HELI_THUMB) {
            return '<img class="emp-hc-glyph" alt="Empyrean Helicopter" draggable="false" src="' + String(window.EMP_HELI_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,170,90,.7);">';
        }
        // NEW (2026-10-10): the Empyrean Jet tile shows a frame from its clip (display only — gift.symbol stays 🛫).
        if (gift && gift.name === 'Empyrean Jet' && window.EMP_JET_THUMB) {
            return '<img class="emp-jt-glyph" alt="Empyrean Jet" draggable="false" src="' + String(window.EMP_JET_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,200,140,.7);">';
        }
        // NEW (2026-10-10): the Empyrean Yacht tile shows a frame from its clip (display only — gift.symbol stays ⛵).
        if (gift && gift.name === 'Empyrean Yacht' && window.EMP_YACHT_THUMB) {
            return '<img class="emp-yt-glyph" alt="Empyrean Yacht" draggable="false" src="' + String(window.EMP_YACHT_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,190,120,.7);">';
        }
        // NEW (2026-10-10): the Diamond Palace tile shows a frame from its clip (display only — gift.symbol stays 💎).
        if (gift && gift.name === 'Diamond Palace' && window.EMP_PALACE_THUMB) {
            return '<img class="emp-dp-glyph" alt="Diamond Palace" draggable="false" src="' + String(window.EMP_PALACE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(150,210,255,.7);">';
        }
        // NEW (2026-10-11): the Diamond SUV tile shows a frame from its clip (display only — gift.symbol stays 🚙).
        if (gift && gift.name === 'Diamond SUV' && window.EMP_SUV_THUMB) {
            return '<img class="emp-suv-glyph" alt="Diamond SUV" draggable="false" src="' + String(window.EMP_SUV_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,120,150,.7);">';
        }
        // NEW (2026-10-11): the Diamond Guitar tile shows a frame from its clip (display only — gift.symbol stays 🎸).
        if (gift && gift.name === 'Diamond Guitar' && window.EMP_GUITAR_THUMB) {
            return '<img class="emp-gtr-glyph" alt="Diamond Guitar" draggable="false" src="' + String(window.EMP_GUITAR_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(190,140,255,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Connect tile shows a frame from its clip (display only — gift.symbol stays 💻).
        if (gift && gift.name === 'Empyrean Connect' && window.EMP_CONNECT_THUMB) {
            return '<img class="emp-cnx-glyph" alt="Empyrean Connect" draggable="false" src="' + String(window.EMP_CONNECT_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(90,170,255,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Chronometer tile shows a frame from its clip (display only — gift.symbol stays ⌚).
        if (gift && gift.name === 'Empyrean Chronometer' && window.EMP_CHRONO_THUMB) {
            return '<img class="emp-chr-glyph" alt="Empyrean Chronometer" draggable="false" src="' + String(window.EMP_CHRONO_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(120,220,255,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Gold Coin tile shows a frame from its clip (display only — gift.symbol stays 🪙).
        if (gift && gift.name === 'Empyrean Gold Coin' && window.EMP_GOLDCOIN_THUMB) {
            return '<img class="emp-gcn-glyph" alt="Empyrean Gold Coin" draggable="false" src="' + String(window.EMP_GOLDCOIN_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,205,90,.7);">';
        }
        // NEW (2026-10-17): the Victory tile shows a frame from its clip (display only — gift.symbol stays 🏅).
        if (gift && gift.name === 'Victory' && window.EMP_WORLDCHAMPS_THUMB) {
            return '<img class="emp-wc-glyph" alt="Victory" draggable="false" src="' + String(window.EMP_WORLDCHAMPS_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,200,60,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Champions Cup tile shows a frame from its clip (display only — gift.symbol stays 🏆).
        if (gift && gift.name === 'Empyrean Champions Cup' && window.EMP_CUP_THUMB) {
            return '<img class="emp-cup-glyph" alt="Empyrean Champions Cup" draggable="false" src="' + String(window.EMP_CUP_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,225,130,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Arena tile shows a frame from its clip (display only — gift.symbol stays 🏟️).
        if (gift && gift.name === 'Empyrean Arena' && window.EMP_ARENA_THUMB) {
            return '<img class="emp-arn-glyph" alt="Empyrean Arena" draggable="false" src="' + String(window.EMP_ARENA_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(120,200,255,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Bouquet tile shows a frame from its clip (display only — gift.symbol stays 💐).
        if (gift && gift.name === 'Empyrean Bouquet' && window.EMP_BOUQUET_THUMB) {
            return '<img class="emp-bqt-glyph" alt="Empyrean Bouquet" draggable="false" src="' + String(window.EMP_BOUQUET_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,150,190,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Teddy tile shows a frame from its clip (display only — gift.symbol stays 🧸).
        if (gift && gift.name === 'Empyrean Teddy' && window.EMP_TEDDY_THUMB) {
            return '<img class="emp-tdy-glyph" alt="Empyrean Teddy" draggable="false" src="' + String(window.EMP_TEDDY_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(220,160,90,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Cake tile shows a frame from its clip (display only — gift.symbol stays 🎂).
        if (gift && gift.name === 'Empyrean Cake' && window.EMP_CAKE_THUMB) {
            return '<img class="emp-cke-glyph" alt="Empyrean Cake" draggable="false" src="' + String(window.EMP_CAKE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,190,110,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Cinema tile shows a frame from its clip (display only — gift.symbol stays 🎥).
        if (gift && gift.name === 'Empyrean Cinema' && window.EMP_CINEMA_THUMB) {
            return '<img class="emp-cin-glyph" alt="Empyrean Cinema" draggable="false" src="' + String(window.EMP_CINEMA_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(120,190,255,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Ring tile shows a frame from its clip (display only — gift.symbol stays 💍).
        if (gift && gift.name === 'Empyrean Ring' && window.EMP_RING_THUMB) {
            return '<img class="emp-rng-glyph" alt="Empyrean Ring" draggable="false" src="' + String(window.EMP_RING_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,215,120,.7);">';
        }
        // NEW (2026-10-11): the Empyrean Diamond Island tile shows a frame from its clip (display only — gift.symbol stays 🏝️).
        if (gift && gift.name === 'Empyrean Diamond Island' && window.EMP_DIAMONDISLE_THUMB) {
            return '<img class="emp-dis-glyph" alt="Empyrean Diamond Island" draggable="false" src="' + String(window.EMP_DIAMONDISLE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(150,220,255,.7);">';
        }
        // NEW (2026-10-12): the Empyrean Movie Night tile shows a frame from its clip (display only — gift.symbol stays 🍿).
        if (gift && gift.name === 'Empyrean Movie Night' && window.EMP_MOVIENIGHT_THUMB) {
            return '<img class="emp-mvn-glyph" alt="Empyrean Movie Night" draggable="false" src="' + String(window.EMP_MOVIENIGHT_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,170,90,.7);">';
        }
        // NEW (2026-10-12): the Empyrean Dance tile shows a frame from its clip (display only — gift.symbol stays 💃).
        if (gift && gift.name === 'Empyrean Dance' && window.EMP_DANCE_THUMB) {
            return '<img class="emp-dnc-glyph" alt="Empyrean Dance" draggable="false" src="' + String(window.EMP_DANCE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(190,140,255,.7);">';
        }
        // NEW (2026-10-12): the Empyrean Victory tile shows a frame from its clip (display only — gift.symbol stays 🥇).
        if (gift && gift.name === 'Empyrean Victory' && window.EMP_VICTORY_THUMB) {
            return '<img class="emp-vct-glyph" alt="Empyrean Victory" draggable="false" src="' + String(window.EMP_VICTORY_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,215,120,.7);">';
        }
        // NEW (2026-10-12): the Empyrean Shepherd tile shows a frame from its clip (display only — gift.symbol stays 🐕).
        if (gift && gift.name === 'Empyrean Shepherd' && window.EMP_SHEPHERD_THUMB) {
            return '<img class="emp-shp-glyph" alt="Empyrean Shepherd" draggable="false" src="' + String(window.EMP_SHEPHERD_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(130,220,130,.7);">';
        }
        // NEW (2026-10-12): the Empyrean Shades tile shows a frame from its clip (display only — gift.symbol stays 🕶️).
        if (gift && gift.name === 'Empyrean Shades' && window.EMP_SHADES_THUMB) {
            return '<img class="emp-shd-glyph" alt="Empyrean Shades" draggable="false" src="' + String(window.EMP_SHADES_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,215,120,.7);">';
        }
        // NEW (2026-10-12): the Gift Box tile shows a frame from its clip (display only — gift.symbol stays 🎁).
        if (gift && gift.name === 'Gift Box' && window.EMP_GIFTBOX_THUMB) {
            return '<img class="emp-gbx-glyph" alt="Gift Box" draggable="false" src="' + String(window.EMP_GIFTBOX_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,120,120,.7);">';
        }
        // NEW (2026-10-12): the Ice Cream tile shows a frame from its clip (display only — gift.symbol stays 🍦).
        if (gift && gift.name === 'Ice Cream' && window.EMP_ICECREAM_THUMB) {
            return '<img class="emp-icr-glyph" alt="Ice Cream" draggable="false" src="' + String(window.EMP_ICECREAM_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,150,200,.7);">';
        }
        // NEW (2026-10-12): the Heart Mills tile shows a frame from its clip (display only — gift.symbol stays 💖).
        if (gift && gift.name === 'Heart Mills' && window.EMP_HEARTMILLS_THUMB) {
            return '<img class="emp-hml-glyph" alt="Heart Mills" draggable="false" src="' + String(window.EMP_HEARTMILLS_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,130,170,.7);">';
        }
        // NEW (2026-10-12): the Balloon tile shows a frame from its clip (display only — gift.symbol stays 🎈).
        if (gift && gift.name === 'Balloon' && window.EMP_BALLOON_THUMB) {
            return '<img class="emp-bln-glyph" alt="Balloon" draggable="false" src="' + String(window.EMP_BALLOON_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(120,190,255,.7);">';
        }
        // NEW (2026-10-12): the Fruit Bowl tile shows a frame from its clip (display only — gift.symbol stays 🍇).
        if (gift && gift.name === 'Fruit Bowl' && window.EMP_FRUITBOWL_THUMB) {
            return '<img class="emp-frb-glyph" alt="Fruit Bowl" draggable="false" src="' + String(window.EMP_FRUITBOWL_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(150,220,120,.7);">';
        }
        // NEW (2026-10-12): the Royal Drum tile shows a frame from its clip (display only — gift.symbol stays 🥁).
        if (gift && gift.name === 'Royal Drum' && window.EMP_ROYALDRUM_THUMB) {
            return '<img class="emp-rdr-glyph" alt="Royal Drum" draggable="false" src="' + String(window.EMP_ROYALDRUM_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,190,90,.7);">';
        }
        // NEW (2026-10-12): the Chocolate tile shows a frame from its clip (display only — gift.symbol stays the emoji).
        if (gift && gift.name === 'Chocolate' && window.EMP_CHOCOLATE_THUMB) {
            return '<img class="emp-cho-glyph" alt="Chocolate" draggable="false" src="' + String(window.EMP_CHOCOLATE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(190,120,70,.7);">';
        }
        // NEW (2026-10-12): the Cupcake tile shows a frame from its clip (display only — gift.symbol stays the emoji).
        if (gift && gift.name === 'Cupcake' && window.EMP_CUPCAKE_THUMB) {
            return '<img class="emp-cup-glyph" alt="Cupcake" draggable="false" src="' + String(window.EMP_CUPCAKE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,170,220,.7);">';
        }
        // NEW (2026-10-12): the Perfume tile shows a frame from its clip (display only — gift.symbol stays the emoji).
        if (gift && gift.name === 'Perfume' && window.EMP_PERFUME_THUMB) {
            return '<img class="emp-prf-glyph" alt="Perfume" draggable="false" src="' + String(window.EMP_PERFUME_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,200,110,.7);">';
        }
        // NEW (2026-10-12): the Candy tile shows a frame from its clip (display only — gift.symbol stays the emoji).
        if (gift && gift.name === 'Candy' && window.EMP_CANDY_THUMB) {
            return '<img class="emp-cnd-glyph" alt="Candy" draggable="false" src="' + String(window.EMP_CANDY_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,150,200,.7);">';
        }
        // NEW (2026-10-12): the Coffee tile shows a frame from its clip (display only — gift.symbol stays the emoji).
        if (gift && gift.name === 'Coffee' && window.EMP_COFFEE_THUMB) {
            return '<img class="emp-cof-glyph" alt="Coffee" draggable="false" src="' + String(window.EMP_COFFEE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(200,150,100,.7);">';
        }
        // NEW (2026-10-12): the Pizza Slice tile shows a frame from its clip (display only — gift.symbol stays the emoji).
        if (gift && gift.name === 'Pizza Slice' && window.EMP_PIZZASLICE_THUMB) {
            return '<img class="emp-piz-glyph" alt="Pizza Slice" draggable="false" src="' + String(window.EMP_PIZZASLICE_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(255,170,80,.7);">';
        }
        // NEW (2026-10-13): the Football tile shows a frame from its clip (display only — gift.symbol stays ⚽).
        if (gift && gift.name === 'Football' && window.EMP_FOOTBALL_THUMB) {
            return '<img class="emp-fbl-glyph" alt="Football" draggable="false" src="' + String(window.EMP_FOOTBALL_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(120,220,200,.7);">';
        }
        // NEW (2026-10-13): the Swallow tile shows a frame from its clip (display only — gift.symbol stays 🍲).
        if (gift && gift.name === 'Swallow' && window.EMP_SWALLOW_THUMB) {
            return '<img class="emp-swl-glyph" alt="Swallow" draggable="false" src="' + String(window.EMP_SWALLOW_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:cover;border-radius:50%;position:relative;z-index:1;pointer-events:none;box-shadow:0 0 8px rgba(120,200,150,.7);">';
        }
        // NEW (2026-10-12): the Hat & Mustache tile shows the real hat + moustache artwork (display only — gift.symbol stays 🤠).
        if (gift && gift.name === 'Hat & Mustache' && window.EMP_HAT_THUMB) {
            return '<img class="emp-hat-glyph" alt="Hat & Mustache" draggable="false" src="' + String(window.EMP_HAT_THUMB).replace(/"/g, '') +
                '" style="width:84%;height:84%;object-fit:contain;position:relative;z-index:1;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));">';
        }
        // NEW (2026-10-12): premium vector icon instead of the emoji for the classic gifts below.
        if (gift) { var _pg = _premiumGlyph(gift.name); if (_pg) return _pg; }
        return gift.symbol;
    }

    // NEW (2026-10-10): the chat-feed "sent <gift>" row (built in app-fixes.js's createLiveGiftComment) used to
    // show the plain emoji (💸 🎮 🦁 🌌) for the four video gifts. This returns the same clip-frame picture the
    // picker tile uses, sized for that row's fixed 38px icon box. Returns '' for any other gift so callers keep
    // their normal symbol. Display only — gift.symbol and everything stored/sent stays the emoji.
    window.empGiftRowGlyph = function (name) {
        var map = { 'Money Gun': ['EMP_MONEY_GUN_THUMB', '22%'], 'Under Control': ['EMP_UNDERCONTROL_THUMB', '50%'],
                    'Empyrean Lion': ['EMP_LION_THUMB', '50%'], 'Universe': ['EMP_UNIVERSE_THUMB', '50%'],
                    'Penlight': ['EMP_PENLIGHT_THUMB', '50%'], 'Empyrean Penlight': ['EMP_PENLIGHT_THUMB', '50%'],
                    'Empyrean Castle': ['EMP_CASTLE_THUMB', '50%'],
                    'Empyrean Helicopter': ['EMP_HELI_THUMB', '50%'],
                    'Empyrean Jet': ['EMP_JET_THUMB', '50%'],
                    'Empyrean Yacht': ['EMP_YACHT_THUMB', '50%'],
                    'Diamond Palace': ['EMP_PALACE_THUMB', '50%'],
                    'Diamond SUV': ['EMP_SUV_THUMB', '50%'],
                    'Diamond Guitar': ['EMP_GUITAR_THUMB', '50%'],
                    'Empyrean Connect': ['EMP_CONNECT_THUMB', '50%'],
                    'Empyrean Chronometer': ['EMP_CHRONO_THUMB', '50%'],
                    'Empyrean Gold Coin': ['EMP_GOLDCOIN_THUMB', '50%'],
                    'Empyrean Champions Cup': ['EMP_CUP_THUMB', '50%'],
                    'Victory': ['EMP_WORLDCHAMPS_THUMB', '50%'],
                    'Empyrean Arena': ['EMP_ARENA_THUMB', '50%'],
                    'Empyrean Bouquet': ['EMP_BOUQUET_THUMB', '50%'],
                    'Empyrean Teddy': ['EMP_TEDDY_THUMB', '50%'],
                    'Empyrean Cake': ['EMP_CAKE_THUMB', '50%'],
                    'Empyrean Cinema': ['EMP_CINEMA_THUMB', '50%'],
                    'Empyrean Ring': ['EMP_RING_THUMB', '50%'],
                    'Empyrean Diamond Island': ['EMP_DIAMONDISLE_THUMB', '50%'],
                    'Empyrean Movie Night': ['EMP_MOVIENIGHT_THUMB', '50%'],
                    'Empyrean Dance': ['EMP_DANCE_THUMB', '50%'],
                    'Empyrean Victory': ['EMP_VICTORY_THUMB', '50%'],
                    'Empyrean Shepherd': ['EMP_SHEPHERD_THUMB', '50%'],
                    'Empyrean Shades': ['EMP_SHADES_THUMB', '50%'],
                    'Gift Box': ['EMP_GIFTBOX_THUMB', '50%'], 'Ice Cream': ['EMP_ICECREAM_THUMB', '50%'],
                    'Heart Mills': ['EMP_HEARTMILLS_THUMB', '50%'], 'Balloon': ['EMP_BALLOON_THUMB', '50%'],
                    'Fruit Bowl': ['EMP_FRUITBOWL_THUMB', '50%'], 'Royal Drum': ['EMP_ROYALDRUM_THUMB', '50%'],
                    'Chocolate': ['EMP_CHOCOLATE_THUMB', '50%'], 'Cupcake': ['EMP_CUPCAKE_THUMB', '50%'],
                    'Perfume': ['EMP_PERFUME_THUMB', '50%'],
                    'Candy': ['EMP_CANDY_THUMB', '50%'], 'Coffee': ['EMP_COFFEE_THUMB', '50%'],
                    'Pizza Slice': ['EMP_PIZZASLICE_THUMB', '50%'], 'Football': ['EMP_FOOTBALL_THUMB', '50%'],
                    'Swallow': ['EMP_SWALLOW_THUMB', '50%'],
                    'Flower Bouquet': ['EMP_FLOWER_BOUQUET_THUMB', '50%'],
                    'Diamond Ring': ['EMP_DIAMOND_RING_THUMB', '50%'] };
        if (name === 'Hat & Mustache' && window.EMP_HAT_THUMB) {
            return '<img alt="Hat & Mustache" draggable="false" src="' + String(window.EMP_HAT_THUMB).replace(/"/g, '') +
                '" style="width:38px;height:38px;object-fit:contain;display:block;pointer-events:none;">';
        }
        var m = map[name];
        if (!m || !window[m[0]]) return '';
        return '<img alt="' + name + '" draggable="false" src="' + String(window[m[0]]).replace(/"/g, '') +
            '" style="width:38px;height:38px;object-fit:cover;border-radius:' + m[1] + ';display:block;pointer-events:none;">';
    };

    function populateGiftCatalog() {
        const container = document.getElementById('gift-grid-container');
        if (!container) return;
        container.innerHTML = '';
        if (window.empPreloadUniverse) window.empPreloadUniverse(); // warm the Universe clip while the catalog is open
        if (window.empPreloadHatAR) window.empPreloadHatAR();       // warm the face detector so the Hat & Mustache sticks to the face instantly

        EMPY_GIFT_CATALOG.forEach(function (gift) {
            if (gift.liveHidden) return;   // 2026-10-12: replaced by a 3D video gift — not shown in the live catalog
            const el          = document.createElement('div');
            el.className      = 'gift-item';
            el.dataset.name    = gift.name;
            el.dataset.symbol  = gift.symbol;
            el.dataset.price   = gift.price;
            el.dataset.tier    = gift.tier || _tierForPrice(gift.price);
            el.innerHTML     = `
                <div class="symbol"><span class="tk-emoji-3d">${_giftGlyph(gift)}</span></div>
                <div class="name">${_giftLabel(gift.name)}</div>
                <div class="price"><i class="fa-solid fa-coins"></i> ${gift.price.toLocaleString()}</div>`;
            container.appendChild(el);
        });
        // Safety net: every tile must carry its gift's name (some other script rewrote tiles in the past) — add it back if it is missing.
        setTimeout(function () {
            container.querySelectorAll('.gift-item').forEach(function (t) {
                if (!t.querySelector('.name') && t.dataset.name) {
                    var n = document.createElement('div'); n.className = 'name'; n.textContent = _giftLabel(t.dataset.name);
                    var pr = t.querySelector('.price'); t.insertBefore(n, pr || null);
                }
                t.title = _giftLabel(t.dataset.name) || '';
            });
        }, 80);
    }
    window.populateGiftCatalog = populateGiftCatalog;

    // ─────────────────────────────────────────────────────────────
    // SECTION 5: renderGiftSideTab
    // Populates the quick-send side strip shown during live streams
    // (#live-gift-quick-items). Shows the top 8 gifts by tier order.
    // ─────────────────────────────────────────────────────────────
    function renderGiftSideTab() {
        const container = document.getElementById('live-gift-quick-items');
        if (!container) return;

        const topGifts = EMPY_GIFT_CATALOG.slice(0, 8);
        container.innerHTML = topGifts.map(function (g) {
            return `<div class="gift-quick-item"
                        data-gift-name="${g.name}"
                        data-gift-symbol="${g.symbol}"
                        data-gift-price="${g.price}"
                        data-tier="${g.tier || _tierForPrice(g.price)}"
                        title="${_giftLabel(g.name)} — ${g.price} EMPY">
                        <span class="g-sym"><span class="tk-emoji-3d">${_giftGlyph(g)}</span></span>
                        <span class="g-price">${g.price}
                            <i class="fa-solid fa-coins" style="font-size:0.55rem;margin-left:2px;"></i>
                        </span>
                    </div>`;
        }).join('');

        // Wire quick-send clicks
        container.querySelectorAll('.gift-quick-item').forEach(function (item) {
            item.addEventListener('click', function () {
                // Guest guard
                if (window.isGuest) {
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('Please log in to send gifts.', 'warning');
                    }
                    return;
                }
                const price = parseInt(this.dataset.giftPrice, 10);
                const us    = window.userState || {};
                if ((us.empyBalance || 0) < price) {
                    if (typeof window.showNotification === 'function') {
                        window.showNotification(
                            'Insufficient EMPY. You need ' + price + ' EMPY for this gift.', 'error'
                        );
                    }
                    const buyModal = document.getElementById('buy-empy-modal');
                    if (buyModal) buyModal.classList.add('show');
                    return;
                }

                // Deduct and animate
                us.empyBalance -= price;
                if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

                const hostName = (
                    document.getElementById('live-host-name') || {}
                ).textContent || 'the host';

                if (typeof window.showNotification === 'function') {
                    // FIX: this used to splice `this.dataset.giftSymbol` (now
                    // SVG markup, not a plain emoji character) straight into
                    // a plain-text toast -- showNotification() renders via
                    // textContent, so the raw <svg>...</svg> markup would
                    // have shown up as literal garbled text on screen.
                    window.showNotification(
                        _giftLabel(this.dataset.giftName) + ' sent to ' + hostName + '!', 'success'
                    );
                }
                triggerGiftAnimation(this.dataset.giftSymbol, this.dataset.giftName);

                // Reward sender
                if (typeof window.rewardUserForAction === 'function') {
                    window.rewardUserForAction('SEND_GIFT');
                }

                // Credit live goal
                const lsd = window.liveStreamData;
                if (lsd && lsd.liveGoal) {
                    lsd.liveGoal.currentAmount = (lsd.liveGoal.currentAmount || 0) + price;
                    if (typeof window.updateLiveUI === 'function') window.updateLiveUI();
                }

                // Persist to Firestore
                try {
                    if (window.fbDb && window._firebaseLoaded && lsd) {
                        window.fbDb.collection('live_gifts').add({
                            senderId:   us.id,
                            senderName: us.fullName || us.username || 'Someone',
                            hostId:     lsd.hostUserId || null,
                            streamId:   lsd.streamId   || null,
                            giftName:   this.dataset.giftName,
                            giftSymbol: this.dataset.giftSymbol,
                            amount:     price,
                            createdAt:  new Date().toISOString()
                        }).catch(function () {});
                    }
                } catch (e) {}

                // FIX (2026-08-27 — gifting/earnings consolidation): this
                // quick-send tab never credited the host at all (see
                // _creditGiftEarnings's header comment above). Now credits
                // the host's real, withdrawable giftTokenBalance.
                _creditGiftEarnings(lsd && lsd.hostUserId, us.id, price);
            });
        });
    }
    window.renderGiftSideTab = renderGiftSideTab;

    // ─────────────────────────────────────────────────────────────
    // SHARED: credit a gift recipient's REAL, withdrawable earnings
    // FIX (2026-08-27 — gifting/earnings consolidation): every gift-send
    // path in this app credited the recipient inconsistently. Traced all
    // four:
    //   - SECTION 5 quick-send side tab: only ever wrote a `live_gifts`
    //     LOG doc — no recipient balance was touched anywhere, real or
    //     mock. The host received nothing.
    //   - SECTION 6 handleSendGift (full catalog / live participant
    //     popup): only updated `window.mockUsers[recipientId].empyBalance`,
    //     an in-memory demo object — never reached Firestore, so the
    //     real recipient's balance never moved on any other device.
    //   - SECTION 11 birthday/profile gifts: the ONLY path that actually
    //     wrote to the recipient's real Firestore doc — but credited
    //     `empyBalance` (the general spend balance), not
    //     `giftTokenBalance` (the ledger earnings-routes.js's Gifting &
    //     Tipping withdrawal tier actually reads — see that file's own
    //     header). Crediting empyBalance also would have let a gift
    //     recipient re-spend value the sender already paid for once,
    //     on top of not being withdrawable.
    //   - app-live-tiktok-patch.js's sendQuickRose: debited the sender
    //     and logged a `live_gifts` doc, but credited no one at all.
    // Net effect: a gift/tip/birthday-gift recipient's `giftTokenBalance`
    // never increased no matter how many gifts they received, so
    // "withdraw my gift earnings" always saw $0 available beyond
    // whatever EMPY they'd personally purchased.
    // FIX: one shared, real Firestore credit path, called from every
    // gift-send site below (and exposed on window so
    // app-live-tiktok-patch.js's sendQuickRose can call it too, the
    // same "expose one function, don't duplicate the flow" convention
    // this codebase already uses elsewhere — e.g. app-patch-v37.js's
    // window._empGetGuestClient()). Uses the SAME increase-only,
    // capped Firestore rule (isGiftTokenBalanceCreditOnlyUpdate,
    // firebase-rules.js) already in place for server.js's purchase
    // credit — no rule change needed.
    // ─────────────────────────────────────────────────────────────
    function _creditGiftEarnings(recipientId, senderId, amount) {
        try {
            if (!recipientId || !amount) return;
            if (senderId && recipientId === senderId) return; // never self-credit
            if (!window.fbDb || !window._firebaseLoaded) return;
            var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
            if (!fv) return;
            window.fbDb.collection('users').doc(recipientId).update({
                giftTokenBalance: fv.increment(amount)
            }).catch(function (err) {
                console.warn('[Gifts] recipient giftTokenBalance credit failed:', err && err.message);
            });
        } catch (e) { /* never let a credit failure break the sender's own flow */ }
    }
    window._empCreditGiftEarnings = _creditGiftEarnings;

    // ─────────────────────────────────────────────────────────────
    // SECTION 6: Core send-gift handler
    // Called when user clicks #send-gift-btn inside the full catalog
    // modal (#live-gift-catalog-modal).
    // ─────────────────────────────────────────────────────────────
    window.handleSendGift = function handleSendGift() {
        const gift = window._selectedGift;
        const us   = window.userState || {};

        if (!gift) {
            if (typeof window.showNotification === 'function') {
                window.showNotification('Please select a gift first.', 'error');
            }
            return;
        }
        if ((us.empyBalance || 0) < gift.price) {
            if (typeof window.showNotification === 'function') {
                window.showNotification('Insufficient EMPY balance to send this gift.', 'error');
            }
            return;
        }

        // Deduct sender's balance
        us.empyBalance -= gift.price;

        // Play animation
        showGiftAnimation(gift.symbol, gift.name);

        // Resolve recipient
        const catalogModal  = document.getElementById('live-gift-catalog-modal');
        const lsd           = window.liveStreamData || {};
        const recipientId   = (catalogModal && catalogModal.dataset.recipientId)   || lsd.hostUserId   || null;
        const recipientName = (catalogModal && catalogModal.dataset.recipientName) ||
            (document.getElementById('live-host-name') || {}).textContent || 'host';

        // Clean up modal recipient attrs
        if (catalogModal) {
            delete catalogModal.dataset.recipientId;
            delete catalogModal.dataset.recipientName;
        }

        // Announce in live chat
        if (typeof window.createLiveComment === 'function') {
            // FIX: used to append gift.symbol (now SVG markup) to plain text
            // passed through createLiveComment -> formatWhatsAppText, which
            // HTML-escapes '<'/'>' -- would have shown as literal
            // "&lt;svg..." text in chat. Symbol is decorative only; drop it.
            window.createLiveComment(
                us.fullName || 'Someone',
                'Sent a ' + _giftLabel(gift.name) + ' to ' + recipientName + '!'
            );
        }

        if (typeof window.showNotification === 'function') {
            window.showNotification(
                '🎁 You sent ' + _giftLabel(gift.name) + ' (' + gift.price + ' EMPY) to ' + recipientName + '!',
                'success'
            );
        }

        // Credit recipient's wallet (local mock + REAL Firestore earnings)
        if (recipientId && recipientId !== us.id) {
            const mockUsers   = window.mockUsers || {};
            const recipient   = mockUsers[recipientId];
            if (recipient) {
                recipient.empyBalance = (recipient.empyBalance || 0) + gift.price;
            }
            // FIX (2026-08-27 — gifting/earnings consolidation): the block
            // above only ever touched `window.mockUsers`, an in-memory demo
            // object — it never reached the real recipient's Firestore doc,
            // so gifts sent through the full catalog / live participant
            // popup never actually paid out (see _creditGiftEarnings's
            // header comment above). This is the real, withdrawable credit.
            _creditGiftEarnings(recipientId, us.id, gift.price);
            // Push notification to recipient if they're viewing
            if (typeof window.pushNotification === 'function') {
                window.pushNotification(
                    (us.fullName || 'Someone') + ' sent you a ' + _giftLabel(gift.name) + '! +' + gift.price + ' EMPY',
                    'success'
                );
            }
            // Persist gift transaction
            try {
                if (window.fbDb && window._firebaseLoaded) {
                    window.fbDb.collection('live_gifts').add({
                        senderId:      us.id,
                        senderName:    us.fullName  || us.username || 'Someone',
                        recipientId:   recipientId,
                        recipientName: recipientName,
                        streamId:      lsd.streamId || null,
                        giftName:      gift.name,
                        giftSymbol:    gift.symbol,
                        amount:        gift.price,
                        createdAt:     new Date().toISOString()
                    }).catch(function () {});
                }
            } catch (e) {}
        }

        // Reward sender for gifting
        if (typeof window.rewardUserForAction === 'function') {
            window.rewardUserForAction('SEND_GIFT');
        }

        // Update wallet display
        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

        // Credit live goal
        if (lsd.liveGoal) {
            lsd.liveGoal.currentAmount = (lsd.liveGoal.currentAmount || 0) + gift.price;
            if (typeof window.updateLiveUI === 'function') window.updateLiveUI();
        }

        // Reset selection
        window._selectedGift = null;
        document.querySelectorAll('.gift-item.selected').forEach(function (el) {
            el.classList.remove('selected');
        });

        // Close catalog modal
        if (catalogModal) catalogModal.classList.remove('show');
        document.body.classList.remove('modal-open');
    };

    // ─────────────────────────────────────────────────────────────
    // SECTION 7: openGiftCatalog
    // Opens the full catalog modal, optionally pre-targeting a recipient
    // (used from the participant popup in live streams).
    // ─────────────────────────────────────────────────────────────
    window.openGiftCatalog = function openGiftCatalog(recipientId, recipientName) {
        const modal = document.getElementById('live-gift-catalog-modal');
        if (!modal) return;

        // FIX ("host control: sending gifts worked once, then stopped" —
        // confirmed via console trace: classList.add('show') fires on
        // every tap, but nothing ever reappears after the first close).
        // Some close paths elsewhere in the codebase (a generic capture-
        // phase close-button handler) leave a stale inline
        // style="display:none" on this modal. An inline style always
        // beats the ".live-sub-modal.show { display:flex }" CSS rule, so
        // every open after the first stale close silently failed with no
        // visible error — the class was added correctly, the modal just
        // never became visible. Clearing any stale inline display/
        // visibility HERE, at the one source both entry points (footer
        // button and every guest/grid box gift icon) already funnel
        // through, guarantees every open actually shows the modal
        // regardless of which handler closed it last time.
        modal.style.removeProperty('display');
        modal.style.removeProperty('visibility');

        if (recipientId)   modal.dataset.recipientId   = recipientId;
        if (recipientName) modal.dataset.recipientName = recipientName;

        // Update title if targeting a specific person
        const titleEl = modal.querySelector('h3');
        if (titleEl) {
            titleEl.innerHTML = recipientName
                ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg> Send Gift to ' + recipientName
                : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg> Send a Gift';
        }

        // Ensure grid is populated
        populateGiftCatalog();
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    };

    // ─────────────────────────────────────────────────────────────
    // SECTION 8: Event delegation — catalog item selection & buttons
    // ─────────────────────────────────────────────────────────────
    document.addEventListener('click', function (e) {
        const closest = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };

        // ── Gift item selection (in full catalog modal) ──────────
        // DISABLED (root cause of "gift only works once then freezes",
        // same disease already fixed below for #live-gift-btn):
        // app-fixes.js's master click handler ALSO matches '.gift-item'
        // and immediately calls _empySendGiftNow(selectedGift) to send the
        // gift for real (search app-fixes.js for "disable one-time send
        // gift"). Both listeners are independent and BOTH always ran on
        // every tap -- this copy only set window._selectedGift, while
        // app-fixes.js's copy read its own separate local `selectedGift`
        // variable and sent/debited immediately. Two handlers reacting to
        // one tap, each tracking its own "selected gift" state, is exactly
        // the class of bug that looks like "does nothing" or "sends
        // twice" depending on timing. Disabled here so app-fixes.js's copy
        // is the one and only place a gift tap is handled.
        const giftItem = false && closest('.gift-item');
        if (giftItem) {
            document.querySelectorAll('.gift-item.selected').forEach(function (el) {
                el.classList.remove('selected');
            });
            giftItem.classList.add('selected');
            window._selectedGift = {
                name:   giftItem.dataset.name,
                symbol: giftItem.dataset.symbol,
                price:  parseFloat(giftItem.dataset.price)
            };
            return;
        }

        // ── Send Gift button ─────────────────────────────────────
        // DISABLED (same root cause): app-fixes.js's modalAction chain
        // ALSO handles `#send-gift-btn` (its own "kept for backward
        // compatibility" branch, calling the shared _empySendGiftNow), so
        // a single tap on Send used to fire BOTH window.handleSendGift()
        // here AND app-fixes.js's copy -- a real double-send/double-debit
        // on one tap, not just a cosmetic duplicate. Disabled so
        // app-fixes.js's copy is the sole handler.
        if (false && closest('#send-gift-btn')) {
            e.preventDefault();
            window.handleSendGift();
            return;
        }

        // ── Live "Gift" button toggles full catalog ──────────────
        // DISABLED (root cause of "gift icon works once then freezes"):
        // app-fixes.js's master click handler ALSO does
        // catalogModal.classList.toggle('show') for this exact same
        // button (#live-gift-btn), and both handlers fire on every
        // single tap (they're two independent document click listeners,
        // not one -- both always run). That means every tap toggled the
        // modal open, then immediately closed it again in the same
        // click, back-to-back, silently -- which looks exactly like
        // "does nothing" on a tap. Disabled here so app-fixes.js's copy
        // (which also closes the viewers modal and refreshes the wallet
        // UI) is the single authoritative handler -- same "one
        // authoritative handler" pattern already used elsewhere in this
        // codebase for this exact class of bug (see the disabled
        // .live-viewers block in app-fixes.js).
        if (false && closest('#live-gift-btn')) {
            const catalog = document.getElementById('live-gift-catalog-modal');
            if (catalog) {
                catalog.classList.toggle('show');
                if (catalog.classList.contains('show')) populateGiftCatalog();
            }
            return;
        }

        // ── "All Gifts" tab button in side tab → open full catalog ──
        if (closest('#live-gift-all-btn')) {
            window.openGiftCatalog();
            return;
        }
    });

    // ─────────────────────────────────────────────────────────────
    // SECTION 9: Auto-populate catalog when modal opens (MutationObserver)
    // and show/hide side tab with live modal.
    // ─────────────────────────────────────────────────────────────
    (function wireModals() {
        // Full catalog modal — populate on first show
        const catalogModal = document.getElementById('live-gift-catalog-modal');
        if (catalogModal) {
            const obs = new MutationObserver(function (muts) {
                muts.forEach(function (m) {
                    if (m.attributeName === 'class') {
                        if (catalogModal.classList.contains('show')) {
                            populateGiftCatalog();
                        }
                    }
                });
            });
            obs.observe(catalogModal, { attributes: true, attributeFilter: ['class'] });
        }

        // Live stream modal — show/hide gift side tab
        const liveModal = document.getElementById('go-live-modal-overlay');
        if (liveModal) {
            const obs2 = new MutationObserver(function () {
                const sideTab = document.getElementById('live-gift-side-tab');
                if (liveModal.classList.contains('show')) {
                    renderGiftSideTab();
                    if (sideTab) sideTab.style.display = 'flex';
                } else {
                    if (sideTab) sideTab.style.display = 'none';
                }
            });
            obs2.observe(liveModal, { attributes: true, attributeFilter: ['class'] });
        }
    })();

    // ─────────────────────────────────────────────────────────────
    // SECTION 10: DOMContentLoaded — initial catalog seeding
    // ─────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', populateGiftCatalog);
    } else {
        // DOM already ready (script loaded late)
        populateGiftCatalog();
    }

    // ─────────────────────────────────────────────────────────────
    // SECTION 11: Birthday / Profile Gift Catalog
    // A second, independent "Send a Gift" modal — separate from
    // #live-gift-catalog-modal (live-stream only: targets the live
    // host/a guest, credits `liveStreamIncome`) — for sending a gift
    // to ANY user's profile. Currently opened from app-profile.js's
    // "Send a Gift" button, shown on a profile whose owner's
    // dobMonthDay matches today (the birthday feature).
    //
    // PAYMENT MODEL: same EMPY-token economy as everywhere else in
    // this app, per this session's own direction — nothing new to
    // pay with. Insufficient balance opens the SAME existing
    // #buy-empy-modal (Flutterwave debit/credit-card checkout,
    // server-verified via /api/wallet/confirm-purchase — see
    // app-wallet.js §7/§8) rather than building a second payment
    // path. Sending debits the sender's own empyBalance (self-update,
    // satisfies firebase-rules.js's isSelfEmpyBalanceNonIncreasing)
    // and credits the recipient's REAL empyBalance directly via the
    // existing isEmpyBalanceCreditOnlyUpdate rule — the same
    // already-audited "any signed-in sender may only ever raise this
    // one field on someone else's user doc" mechanism a wallet
    // transfer/escrow release already uses, so no new Firestore rule
    // is needed for /users/{userId} itself.
    //
    // CATALOG: reuses EMPY_GIFT_CATALOG's existing, already-tested
    // icons/prices for all three tabs rather than inventing a second
    // price list. "Virtual Gifts" is the exact four items from the
    // reference mockup (Teddy Bear, Birthday Cake, Flower Bouquet,
    // Gift Box — the latter two added to the shared catalog above).
    // "Gift Cards" and "Real Gifts" are populated with existing
    // mid/high-tier items as symbolic categories — there is no real
    // gift-card vendor or physical-shipping integration anywhere in
    // this codebase, so every tab settles the same way: an instant
    // EMPY-token transfer, recorded as `status:'delivered'` (nothing
    // to fulfill), never `'pending'`.
    //
    // PERSISTENCE: each send writes one `birthday_feed` doc (spec:
    // the wishes/gifts feed for the birthday person) and one `gifts`
    // doc referencing it via birthdayFeedId (spec: gift_id, sender_id,
    // recipient_id, gift_type, message, timestamp, status) — see the
    // matching rules added to firebase-rules.js.
    // ─────────────────────────────────────────────────────────────
    function _authUid() {
        try {
            if (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) {
                return window.fbAuth.currentUser.uid;
            }
        } catch (e) {}
        return (window.userState && window.userState.id) || null;
    }

    function _pgFieldValue() {
        return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
    }

    function _pgByNames(names) {
        return names.map(function (n) {
            return EMPY_GIFT_CATALOG.find(function (g) { return g.name === n; });
        }).filter(Boolean);
    }

    const PROFILE_GIFT_TABS = {
        virtual:  ['Teddy Bear', 'Birthday Cake', 'Flower Bouquet', 'Gift Box'],
        giftcard: ['Perfume', 'Diamond Ring', 'Champagne', 'Luxury Watch'],
        real:     ['Camera', 'Guitar', 'Laptop', 'Car']
    };

    var _pgState = { recipientId: null, recipientName: null, tab: 'virtual', selected: null };

    function _pgEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _ensureProfileGiftModal() {
        if (document.getElementById('profile-gift-catalog-modal')) return;

        var css = document.createElement('style');
        css.id = '_pg_gift_modal_css';
        css.textContent = [
            '#profile-gift-catalog-modal .pg-card { background:#fff; border-radius:18px; max-width:420px; width:92vw; max-height:88vh; overflow-y:auto; padding:22px; position:relative; }',
            '#profile-gift-catalog-modal .pg-close { position:absolute; top:14px; left:16px; font-size:1.3rem; background:none; border:none; cursor:pointer; color:#334; line-height:1; }',
            '#profile-gift-catalog-modal h3 { text-align:center; margin:4px 0 2px; font-size:1.15rem; color:#1B2B8B; }',
            '#profile-gift-catalog-modal .pg-sub { text-align:center; color:#667; font-size:0.85rem; margin-bottom:14px; }',
            '#profile-gift-catalog-modal .pg-tabs { display:flex; gap:8px; margin-bottom:16px; }',
            '#profile-gift-catalog-modal .pg-tab { flex:1; padding:8px 4px; border-radius:10px; border:1px solid rgba(27,43,139,0.2); background:#fff; color:#1B2B8B; font-size:0.8rem; font-weight:700; cursor:pointer; text-align:center; }',
            '#profile-gift-catalog-modal .pg-tab.active { background:#1B2B8B; color:#fff; }',
            '#profile-gift-catalog-modal .pg-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }',
            '#profile-gift-catalog-modal .pg-item { border:1px solid rgba(10,14,39,0.1); border-radius:14px; padding:14px 8px; text-align:center; cursor:pointer; background:#fafbff; }',
            '#profile-gift-catalog-modal .pg-item.selected { border-color:#1B2B8B; background:rgba(27,43,139,0.08); box-shadow:0 0 0 2px rgba(27,43,139,0.25); }',
            '#profile-gift-catalog-modal .pg-item .pg-emoji { font-size:2.1rem; display:block; margin-bottom:6px; }',
            '#profile-gift-catalog-modal .pg-item .pg-name { font-size:0.82rem; font-weight:700; color:#223; }',
            '#profile-gift-catalog-modal .pg-item .pg-price { font-size:0.75rem; color:#8a6d1a; margin-top:2px; }',
            '#profile-gift-catalog-modal textarea#pg-message { width:100%; box-sizing:border-box; border:1px solid rgba(10,14,39,0.15); border-radius:12px; padding:10px 12px; font-size:0.88rem; resize:none; min-height:44px; margin-bottom:14px; font-family:inherit; }',
            '#profile-gift-catalog-modal .pg-send-btn { width:100%; padding:13px; border:none; border-radius:24px; background:linear-gradient(135deg,#1B2B8B,#3B5BDB); color:#fff; font-weight:700; font-size:0.95rem; cursor:pointer; }',
            '#profile-gift-catalog-modal .pg-send-btn:disabled { opacity:0.5; cursor:not-allowed; }',
            '#profile-gift-catalog-modal .pg-confirm-emoji { font-size:4rem; text-align:center; display:block; margin:10px 0; }',
            '#profile-gift-catalog-modal .pg-confirm-sub { text-align:center; font-weight:800; color:#1B2B8B; margin-bottom:16px; }',
            '#profile-gift-catalog-modal .pg-summary { background:#fafbff; border-radius:12px; padding:12px 14px; margin-bottom:16px; font-size:0.85rem; }',
            '#profile-gift-catalog-modal .pg-summary-row { display:flex; justify-content:space-between; margin-bottom:6px; }',
            '#profile-gift-catalog-modal .pg-secondary-btn { width:100%; padding:12px; border:1px solid rgba(10,14,39,0.15); border-radius:24px; background:#fff; color:#334; font-weight:700; font-size:0.9rem; cursor:pointer; margin-top:10px; }'
        ].join('\n');
        document.head.appendChild(css);

        var wrap = document.createElement('div');
        wrap.id = 'profile-gift-catalog-modal';
        wrap.className = 'modal-overlay-container';
        wrap.innerHTML =
            '<div class="pg-card">' +
                '<button class="pg-close" type="button" data-pg-action="close" aria-label="Close">&#8592;</button>' +
                '<div id="pg-view-catalog">' +
                    '<h3><i class="fas fa-gift"></i> Send a Gift</h3>' +
                    '<div class="pg-sub" id="pg-recipient-sub">Select a Gift</div>' +
                    '<div class="pg-tabs">' +
                        '<button type="button" class="pg-tab active" data-pg-tab="virtual">Virtual Gifts</button>' +
                        '<button type="button" class="pg-tab" data-pg-tab="giftcard">Gift Cards</button>' +
                        '<button type="button" class="pg-tab" data-pg-tab="real">Real Gifts</button>' +
                    '</div>' +
                    '<div class="pg-grid" id="pg-grid"></div>' +
                    '<textarea id="pg-message" maxlength="200" placeholder="Add a Personal Message."></textarea>' +
                    '<button type="button" class="pg-send-btn" id="pg-send-btn" data-pg-action="send" disabled>Send Gift</button>' +
                '</div>' +
                '<div id="pg-view-confirm" style="display:none;">' +
                    '<span class="pg-confirm-emoji" id="pg-confirm-emoji"></span>' +
                    '<h3 id="pg-confirm-title">Gift Sent!</h3>' +
                    '<div class="pg-confirm-sub">Your Gift Has Been Sent!</div>' +
                    '<div class="pg-summary" id="pg-summary"></div>' +
                    '<button type="button" class="pg-send-btn" data-pg-action="again">Send Another Gift</button>' +
                    '<button type="button" class="pg-secondary-btn" data-pg-action="close">Done</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(wrap);
    }

    function _renderProfileGiftGrid() {
        var grid = document.getElementById('pg-grid');
        if (!grid) return;
        var items = _pgByNames(PROFILE_GIFT_TABS[_pgState.tab] || []);
        grid.innerHTML = items.map(function (g) {
            var sel = (_pgState.selected && _pgState.selected.name === g.name) ? ' selected' : '';
            return '<div class="pg-item' + sel + '" data-pg-gift="' + _pgEsc(g.name) + '">' +
                '<span class="pg-emoji">' + g.symbol + '</span>' +
                '<div class="pg-name">' + _pgEsc(_giftLabel(g.name)) + '</div>' +
                '<div class="pg-price">' + g.price + ' EMPY</div>' +
                '</div>';
        }).join('');
    }

    function _updatePgSendBtn() {
        var btn = document.getElementById('pg-send-btn');
        if (btn) btn.disabled = !_pgState.selected;
    }

    function _closeProfileGiftModal() {
        var modal = document.getElementById('profile-gift-catalog-modal');
        if (modal) modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }

    window.openProfileGiftCatalog = function (recipientId, recipientName) {
        if (!recipientId) return;
        _ensureProfileGiftModal();
        _pgState.recipientId   = recipientId;
        _pgState.recipientName = recipientName || 'this user';
        _pgState.tab = 'virtual';
        _pgState.selected = null;

        var modal = document.getElementById('profile-gift-catalog-modal');
        document.getElementById('pg-view-catalog').style.display = 'block';
        document.getElementById('pg-view-confirm').style.display = 'none';
        document.getElementById('pg-recipient-sub').textContent = 'Select a Gift for ' + _pgState.recipientName;
        document.getElementById('pg-message').value = '';
        document.querySelectorAll('#profile-gift-catalog-modal .pg-tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.pgTab === 'virtual');
        });
        _renderProfileGiftGrid();
        _updatePgSendBtn();

        // Same stale-inline-style guard openGiftCatalog() already uses
        // (SECTION 7) — a generic close-button handler elsewhere can
        // leave display:none inline, which would otherwise beat the
        // .modal-overlay-container.show CSS rule on every open after
        // the first close.
        modal.style.removeProperty('display');
        modal.style.removeProperty('visibility');
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    };

    async function _sendProfileGift() {
        var gift = _pgState.selected;
        var us   = window.userState || {};
        if (!gift) {
            if (typeof window.showNotification === 'function') window.showNotification('Please select a gift first.', 'error');
            return;
        }
        if (!_pgState.recipientId) return;
        if (_pgState.recipientId === us.id) {
            if (typeof window.showNotification === 'function') window.showNotification("You can't send a gift to yourself.", 'error');
            return;
        }
        if ((us.empyBalance || 0) < gift.price) {
            if (typeof window.showNotification === 'function') window.showNotification('Insufficient EMPY balance — top up to send this gift.', 'error');
            var buyModal = document.getElementById('buy-empy-modal');
            if (buyModal) { buyModal.classList.add('show'); document.body.classList.add('modal-open'); }
            return;
        }

        var message = ((document.getElementById('pg-message') || {}).value || '').trim().slice(0, 200);
        var senderId   = _authUid() || us.id;
        var senderName = us.fullName || us.username || 'Someone';

        var btn = document.getElementById('pg-send-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

        // Debit sender — local display + Firestore self-update. A self
        // update may only ever DECREASE empyBalance (see firebase-rules.js's
        // isSelfEmpyBalanceNonIncreasing on the owner-only /users/{userId}
        // rule), which is exactly what this is.
        us.empyBalance = (us.empyBalance || 0) - gift.price;
        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
        try {
            if (window.fbDb && window._firebaseLoaded && senderId) {
                window.fbDb.collection('users').doc(senderId).update({ empyBalance: us.empyBalance }).catch(function () {});
            }
        } catch (e) {}

        try {
            if (window.fbDb && window._firebaseLoaded) {
                // birthday_feed first so the gifts doc below can link to it
                // (spec: "each gift transaction links to the birthday_feed
                // entry").
                var feedRef = await window.fbDb.collection('birthday_feed').add({
                    birthdayUserId: _pgState.recipientId,
                    type: 'gift',
                    senderId: senderId,
                    senderName: senderName,
                    senderAvatar: us.avatar || '',
                    message: message,
                    giftName: gift.name,
                    giftSymbol: gift.symbol,
                    giftAmount: gift.price,
                    createdAt: new Date().toISOString()
                });

                await window.fbDb.collection('gifts').add({
                    senderId: senderId,
                    recipientId: _pgState.recipientId,
                    giftType: gift.name,
                    giftSymbol: gift.symbol,
                    amount: gift.price,
                    message: message,
                    status: 'delivered', // EMPY-token transfer — nothing physical to fulfill
                    birthdayFeedId: feedRef.id,
                    timestamp: new Date().toISOString()
                });

                // FIX (2026-08-27 — gifting/earnings consolidation): this
                // used to credit `empyBalance` — isEmpyBalanceCreditOnlyUpdate
                // (firebase-rules.js) does allow it, but empyBalance is the
                // general SPEND balance, not the ledger earnings-routes.js's
                // Gifting & Tipping withdrawal tier reads from. Crediting it
                // here would also let the recipient re-spend value the
                // sender already paid for once, instead of being able to
                // withdraw it. Birthday gifts are gift-earnings like any
                // other, so they now go through the same real,
                // withdrawable giftTokenBalance credit every other
                // gift-send path in this file uses — see
                // _creditGiftEarnings's header comment near the top of
                // this file.
                _creditGiftEarnings(_pgState.recipientId, senderId, gift.price);
            }
        } catch (err) {
            console.warn('[ProfileGift] Firestore write failed:', err && err.message);
        }

        if (typeof window.rewardUserForAction === 'function') window.rewardUserForAction('SEND_GIFT');

        // Confirmation screen
        document.getElementById('pg-view-catalog').style.display = 'none';
        document.getElementById('pg-view-confirm').style.display = 'block';
        document.getElementById('pg-confirm-emoji').innerHTML = gift.symbol;
        document.getElementById('pg-confirm-title').textContent = 'Gift Sent to ' + _pgState.recipientName + '!';
        document.getElementById('pg-summary').innerHTML =
            '<div class="pg-summary-row"><span>' + gift.symbol + ' ' + _pgEsc(_giftLabel(gift.name)) + '</span><span>' + gift.price + ' EMPY</span></div>' +
            (message ? '<div><strong>Message:</strong> \u201c' + _pgEsc(message) + '\u201d</div>' : '');

        if (btn) { btn.disabled = false; btn.textContent = 'Send Gift'; }
        if (typeof window.showNotification === 'function') window.showNotification('🎁 Gift sent to ' + _pgState.recipientName + '!', 'success');
    }

    document.addEventListener('click', function (e) {
        var modal = document.getElementById('profile-gift-catalog-modal');
        if (!modal) return;
        var closest = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };

        var tabBtn = closest('#profile-gift-catalog-modal .pg-tab');
        if (tabBtn) {
            _pgState.tab = tabBtn.dataset.pgTab;
            _pgState.selected = null;
            document.querySelectorAll('#profile-gift-catalog-modal .pg-tab').forEach(function (t) {
                t.classList.toggle('active', t === tabBtn);
            });
            _renderProfileGiftGrid();
            _updatePgSendBtn();
            return;
        }

        var itemEl = closest('#profile-gift-catalog-modal .pg-item');
        if (itemEl) {
            var name = itemEl.dataset.pgGift;
            _pgState.selected = EMPY_GIFT_CATALOG.find(function (g) { return g.name === name; }) || null;
            _renderProfileGiftGrid();
            _updatePgSendBtn();
            return;
        }

        var actionEl = closest('[data-pg-action]');
        if (actionEl) {
            var action = actionEl.dataset.pgAction;
            if (action === 'close') {
                _closeProfileGiftModal();
            } else if (action === 'send') {
                _sendProfileGift();
            } else if (action === 'again') {
                _pgState.selected = null;
                document.getElementById('pg-view-catalog').style.display = 'block';
                document.getElementById('pg-view-confirm').style.display = 'none';
                document.getElementById('pg-message').value = '';
                _renderProfileGiftGrid();
                _updatePgSendBtn();
            }
        }
    });

    // ─────────────────────────────────────────────────────────────
    // SECTION 12: Dashboard "Birthdays Today" row + Birthday Wishes feed
    // FEATURE (requested): a horizontally-scrollable row on the general
    // dashboard, visible to EVERYONE (not just followers — that's the
    // existing FCM push's job in server.js; this is the in-app,
    // "everybody can see and scroll through today's birthdays" version).
    // Tapping a thumbnail opens a "Birthday Wishes" feed/comments modal
    // for that person, backed by the SAME `birthday_feed` collection
    // SECTION 11's gift-sending already writes to (type:'gift' there,
    // type:'wish' here for a free-text birthday message with no EMPY
    // cost) — one shared, chronological feed per birthday person, gifts
    // and text wishes interleaved, the same way a Facebook birthday
    // post's comment thread mixes well-wishes and gifts.
    //
    // "DISAPPEARS AFTER 24 HOURS": achieved by construction, not by an
    // expiry timestamp/cleanup job — the row's membership query is
    // `dobMonthDay === today's own local MM-DD`, so a person silently
    // drops out of the row the instant the calendar date changes. The
    // one case that needs explicit handling is a tab left open PAST
    // midnight, where "today" computed once at load would go stale —
    // _armBirthdayRow() re-checks what day it is on an interval (not
    // just once at load) and re-queries whenever the date has actually
    // rolled over, so a long-lived tab correctly empties the row on its
    // own without needing a reload.
    // ─────────────────────────────────────────────────────────────
    function _bdTodayMonthDay() {
        var d = new Date();
        return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    var _bdRow = { day: null, unsub: null, users: [] };
    var _bdFeed = { userId: null, unsub: null };

    function _bdEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _bdTimeAgo(iso) {
        var t = new Date(iso).getTime();
        if (!t || isNaN(t)) return '';
        var diff = Math.max(0, Date.now() - t);
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        var hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        return Math.floor(hrs / 24) + 'd ago';
    }

    (function injectBirthdayRowCSS() {
        if (document.getElementById('_bd_row_css')) return;
        var css = document.createElement('style');
        css.id = '_bd_row_css';
        css.textContent = [
            /* Row card reuses .horizontal-slider-container/-wrapper's own
               overflow-x:auto scrolling — no new scroll mechanism here. */
            '.emp-bday-chip{flex:0 0 auto;width:76px;text-align:center;cursor:pointer;padding:4px 2px;}',
            '.emp-bday-chip-ring{width:64px;height:64px;border-radius:50%;padding:3px;margin:0 auto 6px;',
            'background:linear-gradient(135deg,#F5C518,#F08C1A,#EF4444);display:flex;align-items:center;justify-content:center;position:relative;}',
            '.emp-bday-chip-ring img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;border:2px solid #fff;background:#e2e6f5;}',
            /* PREMIUM PASS (2026-08-25 — "make all the icons premium
               including the cake"): was a flat white circle behind the
               🎂 emoji. Now a gold-gradient badge with a soft pulsing glow
               (matches the new .bd-header-cake-badge below) so the whole
               birthday feature reads as one consistent "premium/VIP" gold
               treatment instead of a plain sticker. */
            '.emp-bday-chip-cake{position:absolute;bottom:-3px;right:-2px;font-size:1rem;',
            'background:radial-gradient(circle at 35% 30%,#FFE9A8,#F5C518 55%,#F08C1A 100%);border-radius:50%;width:22px;height:22px;',
            'display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(240,140,26,0.5),inset 0 0 0 1.5px #fff;',
            'animation:bdCakeGlow 2.4s ease-in-out infinite;}',
            '.emp-bday-chip-name{font-size:0.72rem;font-weight:700;color:var(--text-main,#1B2B8B);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.emp-bday-chip:active .emp-bday-chip-ring{transform:scale(0.94);}',
            /* Dashboard section-header badge (index.html's "Birthdays
               Today" <h3>) — replaces the old flat-colored Font-Awesome
               glyph (see index.html's own FIX comment at that <h3> for why:
               it could render as a broken/tofu box on a slow FA CDN load).
               Same gold-gradient + glow treatment as the chip badge above
               so the header icon and the row icons read as one family. */
            '.bd-header-cake-badge{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;',
            'background:radial-gradient(circle at 35% 30%,#FFE9A8,#F5C518 55%,#F08C1A 100%);box-shadow:0 2px 8px rgba(240,140,26,0.5),inset 0 0 0 1px rgba(255,255,255,0.55);',
            'margin-right:6px;font-size:0.92rem;vertical-align:-6px;animation:bdCakeGlow 2.4s ease-in-out infinite;}',
            '@keyframes bdCakeGlow{0%,100%{box-shadow:0 2px 8px rgba(240,140,26,0.5),inset 0 0 0 1px rgba(255,255,255,0.55);}',
            '50%{box-shadow:0 2px 15px rgba(240,140,26,0.9),inset 0 0 0 1px rgba(255,255,255,0.8);}}'
        ].join('\n');
        document.head.appendChild(css);
    })();

    function _renderBirthdayRow() {
        var container = document.getElementById('dashboard-birthday-container');
        var slider    = document.getElementById('dashboard-birthday-slider');
        if (!container || !slider) return;
        if (!_bdRow.users.length) {
            container.style.display = 'none';
            slider.innerHTML = '';
            return;
        }
        slider.innerHTML = _bdRow.users.map(function (u) {
            var name = _bdEsc(u.fullName || u.username || 'Friend');
            var avatar = _bdEsc(u.avatar || '');
            return '<div class="emp-bday-chip" data-bday-user-id="' + _bdEsc(u.id) + '" ' +
                'data-bday-user-name="' + name + '" data-bday-user-avatar="' + avatar + '">' +
                '<div class="emp-bday-chip-ring"><img src="' + avatar + '" alt="' + name + '" onerror="this.style.visibility=\'hidden\'"><span class="emp-bday-chip-cake">🎂</span></div>' +
                '<div class="emp-bday-chip-name">' + name.split(' ')[0] + '</div>' +
                '</div>';
        }).join('');
        container.style.display = '';
    }

    function _attachBirthdayRowListener() {
        var today = _bdTodayMonthDay();
        if (_bdRow.day === today && _bdRow.unsub) return; // already watching the right day
        if (_bdRow.unsub) { try { _bdRow.unsub(); } catch (e) {} _bdRow.unsub = null; }
        _bdRow.day = today;
        _bdRow.users = [];
        _renderBirthdayRow();

        if (!window.fbDb || !window._firebaseLoaded) return; // will retry via the interval/firebase-ready hook below

        try {
            _bdRow.unsub = window.fbDb.collection('users')
                .where('dobMonthDay', '==', today)
                .onSnapshot(function (snap) {
                    // Re-check the day on every tick too — guards the one edge
                    // case where a snapshot for the OLD listener resolves right
                    // as midnight rolls over and a new one is being attached.
                    if (_bdRow.day !== _bdTodayMonthDay()) return;
                    _bdRow.users = [];
                    snap.forEach(function (doc) {
                        var d = doc.data() || {};
                        _bdRow.users.push({ id: doc.id, fullName: d.fullName, username: d.username, avatar: d.avatar });
                    });
                    _renderBirthdayRow();
                }, function (err) {
                    console.warn('[Birthday] dashboard row listener error:', err && err.message);
                });
        } catch (e) {
            console.warn('[Birthday] could not attach dashboard row listener:', e && e.message);
        }
    }

    function _armBirthdayRow() {
        _attachBirthdayRowListener();
        // Catches (a) firebase not ready yet the first time this fired, and
        // (b) the calendar date rolling over while the tab stays open — see
        // this section's own header note. Checked every 5 minutes; cheap,
        // and Firestore's own listener does the real-time heavy lifting the
        // rest of the time.
        if (!window._empBirthdayRowInterval) {
            window._empBirthdayRowInterval = setInterval(_attachBirthdayRowListener, 5 * 60 * 1000);
        }
    }

    document.addEventListener('empyrean-init-done', function () { setTimeout(_armBirthdayRow, 400); });
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_armBirthdayRow, 50); });
    setTimeout(_armBirthdayRow, 1500); // covers a returning session where firebase is already live by load

    /* ── Birthday Wishes feed modal ───────────────────────────────── */
    function _ensureBirthdayWishesModal() {
        if (document.getElementById('birthday-wishes-modal')) return;

        var css = document.createElement('style');
        css.id = '_bd_wishes_css';
        css.textContent = [
            /* ═══════════════════════════════════════════════════════════
               REDESIGN (2026-08-24 — "premium, sleek, elegant birthday
               card"): full visual pass on the modal, layout unchanged in
               spirit (header → banner → feed → composer) but every piece
               restyled — deep navy/gold "VIP card" palette instead of
               plain white, a single-line name, a taller square avatar,
               a new horizontal "recent pictures" strip, and a
               swipe-to-dismiss/auto-fading banner. See each rule's own
               comment below for what changed and why.
               ═══════════════════════════════════════════════════════════ */
            '#birthday-wishes-modal .bw-card{background:linear-gradient(180deg,#fff,#fbfaf5 60%);border-radius:24px;max-width:430px;width:92vw;',
            'max-height:86vh;display:flex;flex-direction:column;overflow:hidden;position:relative;',
            'box-shadow:0 24px 60px rgba(10,14,39,0.35),0 0 0 1px rgba(245,197,24,0.25);}',
            /* Header — deep navy-to-indigo gradient (the "VIP card" look),
               replacing the old plain-white header so the whole top reads
               as one premium unit rather than a plain form bar. */
            /* FIX ("gift/design-card buttons hidden/cut off"): .bw-card is a
               flex column capped at max-height:86vh with overflow:hidden.
               Without flex-shrink:0 here, the header — avatar, recent-photos
               strip, AND the action-buttons row all together — was one of
               several flex children competing to shrink whenever the modal's
               total content (header + banner + feed + input) exceeded 86vh.
               Flexbox shrinks from the bottom of this block's own overflow,
               which is exactly the action-buttons row, cutting off part of
               "Design Card"/"Gift" behind the message list underneath. Pinning
               the header (and banner/input/composer below, same fix) means
               only .bw-list — which already has overflow-y:auto and is
               DESIGNED to scroll — ever shrinks now, so the header and its
               buttons are always shown in full. */
            '#birthday-wishes-modal .bw-head{padding:20px 44px 16px 18px;background:linear-gradient(135deg,#0A0E27,#1B2B8B 65%,#3B2E8B);position:relative;overflow:hidden;flex-shrink:0;}',
            /* Subtle gold sheen in the corner — the one decorative touch,
               purely cosmetic (a radial glow), never intercepts clicks. */
            '#birthday-wishes-modal .bw-head::before{content:"";position:absolute;top:-40%;right:-20%;width:70%;height:180%;',
            'background:radial-gradient(circle,rgba(245,197,24,0.22),transparent 70%);pointer-events:none;}',
            '#birthday-wishes-modal .bw-head-top{display:flex;align-items:flex-start;gap:12px;position:relative;z-index:1;}',
            /* FEATURE: square (not round) avatar frame, sized up per this
               request ("a little bit larger square box") — a gold-ringed
               squircle instead of the old 48px circle, so it reads as a
               framed portrait rather than a small chat avatar. */
            '#birthday-wishes-modal .bw-head-avatar-ring{width:64px;height:64px;border-radius:16px;padding:3px;flex-shrink:0;',
            'background:linear-gradient(135deg,#F5C518,#F08C1A,#EF4444);box-shadow:0 4px 14px rgba(0,0,0,0.35);}',
            '#birthday-wishes-modal .bw-head-avatar-ring img{width:100%;height:100%;border-radius:13px;object-fit:cover;display:block;',
            'border:2px solid #0A0E27;background:#e2e6f5;}',
            '#birthday-wishes-modal .bw-head-textcol{flex:1;min-width:0;}',
            /* FIX ("name should be on one line at the top"): single line,
               ellipsis instead of wrap — the old title had no white-space
               control at all, so a two-word name like "Allen Akhigbe's"
               wrapped across three lines (see the screenshot this was
               reported from). font-size still scales down slightly via
               clamp() on very narrow screens rather than wrapping. */
            '#birthday-wishes-modal .bw-head-title{font-weight:800;color:#fff;font-size:clamp(1rem,4.6vw,1.15rem);',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.01em;}',
            '#birthday-wishes-modal .bw-head-sub{font-size:0.78rem;color:rgba(255,255,255,0.75);margin-top:2px;font-weight:600;}',
            '#birthday-wishes-modal .bw-close{position:absolute;top:14px;right:14px;font-size:1.15rem;background:rgba(255,255,255,0.12);',
            'border:none;cursor:pointer;color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:2;',
            'transition:background .15s;}',
            '#birthday-wishes-modal .bw-close:active{background:rgba(255,255,255,0.28);}',
            /* FEATURE: "recent pictures, slidable horizontally" — a new
               strip of square thumbnails, populated in
               openBirthdayWishesFeed() from the celebrant's most recent
               posts with photos (falls back to avatar/cover if they have
               none). Sized up from the old single 34px square per this
               request, snap-scrolls like the dashboard's own horizontal
               rows elsewhere in this app. */
            '#birthday-wishes-modal .bw-recent-strip{display:flex;gap:8px;overflow-x:auto;padding:14px 18px 4px;',
            'scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:none;position:relative;z-index:1;}',
            '#birthday-wishes-modal .bw-recent-strip::-webkit-scrollbar{display:none;}',
            '#birthday-wishes-modal .bw-recent-strip img{width:66px;height:66px;border-radius:12px;object-fit:cover;flex-shrink:0;',
            'scroll-snap-align:start;border:1.5px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);}',
            '#birthday-wishes-modal .bw-recent-strip.bw-empty-strip{display:none;}',
            '#birthday-wishes-modal .bw-actions-row{display:flex;gap:10px;padding:14px 18px 18px;position:relative;z-index:1;}',
            '#birthday-wishes-modal .bw-gift-btn{flex:1;border:none;border-radius:22px;padding:10px 14px;font-size:0.82rem;font-weight:800;',
            'background:linear-gradient(135deg,#F5C518,#F08C1A);color:#1B2B8B;cursor:pointer;white-space:nowrap;',
            'display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 12px rgba(240,140,26,0.35);}',
            /* Card-composer entry point — restyled to match the new
               header (translucent glass pill on the navy background)
               instead of the old small solid-purple circle. The FA icon
               is gone (see markup note below — "fix the broken icon"). */
            '#birthday-wishes-modal .bw-card-btn{border:1px solid rgba(255,255,255,0.3);border-radius:22px;padding:10px 16px;',
            'font-size:0.82rem;font-weight:800;background:rgba(255,255,255,0.10);color:#fff;cursor:pointer;white-space:nowrap;',
            'display:flex;align-items:center;justify-content:center;gap:6px;backdrop-filter:blur(6px);}',
            '#birthday-wishes-modal .bw-card-btn:active,#birthday-wishes-modal .bw-gift-btn:active{transform:scale(0.97);}',
            /* Festive banner — now a dismissable "ribbon": swipe
               horizontally or wait ~7s and it slides up + fades out on
               its own (see _armBirthdayBanner() below). translateX during
               a drag is applied inline by the swipe handler; the
               `.bw-banner-leaving` class drives the auto/committed exit
               animation via @keyframes bwBannerExit. */
            '#birthday-wishes-modal .bw-banner-wrap{overflow:hidden;flex-shrink:0;}',
            '#birthday-wishes-modal .bw-banner{margin:12px 16px;padding:12px 16px;border-radius:14px;font-size:0.82rem;line-height:1.45;font-weight:600;',
            'color:#7a5a0a;background:linear-gradient(135deg,rgba(245,197,24,0.18),rgba(240,140,26,0.10));border:1px solid rgba(245,197,24,0.4);',
            'position:relative;cursor:grab;touch-action:pan-y;transition:transform .25s ease;}',
            '#birthday-wishes-modal .bw-banner-leaving{animation:bwBannerExit .45s ease forwards;}',
            '@keyframes bwBannerExit{to{transform:translateY(-14px) scale(0.96);opacity:0;max-height:0;margin-top:0;margin-bottom:0;padding-top:0;padding-bottom:0;}}',
            '#birthday-wishes-modal .bw-banner-dot{position:absolute;bottom:6px;right:10px;display:flex;gap:4px;}',
            '#birthday-wishes-modal .bw-banner-dot span{width:4px;height:4px;border-radius:50%;background:rgba(122,90,10,0.35);}',
            '#birthday-wishes-modal .bw-list{flex:1;overflow-y:auto;padding:4px 16px 12px;display:flex;flex-direction:column;gap:12px;min-height:120px;}',
            '#birthday-wishes-modal .bw-item{display:flex;gap:10px;}',
            '#birthday-wishes-modal .bw-item img{width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#e2e6f5;}',
            '#birthday-wishes-modal .bw-bubble{background:#f4f6fb;border-radius:14px;padding:8px 12px;font-size:0.85rem;flex:1;}',
            '#birthday-wishes-modal .bw-bubble strong{color:#1B2B8B;font-size:0.82rem;}',
            '#birthday-wishes-modal .bw-time{font-size:0.68rem;color:#99a;margin-top:2px;}',
            '#birthday-wishes-modal .bw-gift-line{color:#8a6d1a;font-weight:700;}',
            /* Personalized/custom card entries in the feed — a small colored
               card rendered inline in the thread, distinct from a plain-text
               wish or a gift line. */
            '#birthday-wishes-modal .bw-card-mini{position:relative;border-radius:12px;padding:14px 12px;color:#fff;font-weight:700;font-size:0.85rem;',
            'text-align:center;box-shadow:0 3px 10px rgba(0,0,0,0.14);overflow:hidden;}',
            /* Template-based mini cards (new) get a touch more breathing
               room + the serif greeting-card font so they read the same as
               the composer preview, just smaller — plain-bg legacy cards
               (cardBg only, no cardTemplate) keep the original compact look
               above untouched. */
            '#birthday-wishes-modal .bw-card-mini-tpl{padding:20px 12px;font-family:Georgia,"Times New Roman",serif;font-size:0.88rem;',
            'box-shadow:0 6px 16px rgba(10,14,39,0.22),0 0 0 1px rgba(245,197,24,0.25);}',
            '#birthday-wishes-modal .bw-empty{text-align:center;color:#99a;font-size:0.85rem;padding:24px 12px;}',
            '#birthday-wishes-modal .bw-input-row{display:flex;gap:8px;padding:12px 14px;border-top:1px solid rgba(10,14,39,0.08);flex-shrink:0;}',
            '#birthday-wishes-modal .bw-input-row input{flex:1;border:1px solid rgba(10,14,39,0.15);border-radius:20px;padding:10px 14px;font-size:0.85rem;}',
            '#birthday-wishes-modal .bw-send-btn{border:none;border-radius:50%;width:40px;height:40px;flex-shrink:0;background:#1B2B8B;color:#fff;cursor:pointer;font-size:0.95rem;}',
            '#birthday-wishes-modal .bw-send-btn:disabled{opacity:0.5;cursor:not-allowed;}',
            /* Custom-card composer panel — a small inline view swapped in
               below the feed (feed stays visible above it), matching this
               file's existing convention of hide/show panels rather than a
               second modal-on-top-of-a-modal. */
            /* FIX ("no send button / send is hidden" — a direct consequence
               of the earlier flex-shrink:0 fix on THIS element specifically):
               giving .bw-composer flex-shrink:0 kept it from being crushed,
               but .bw-list stays in the DOM (still visible) behind the
               composer too — nothing hid it when the composer opened — so
               the combined height of head + banner + list(at its 120px
               floor) + this composer's own full natural height could still
               exceed .bw-card's 86vh cap. Since flex-shrink:0 means this
               element refuses to shrink, THAT overflow had nowhere to go but
               clipped by .bw-card's own overflow:hidden — landing squarely
               on whatever is visually last inside the composer, i.e. the
               Cancel/Send Card row. Fix: same pattern .bw-list itself
               already uses successfully — flex:1 + min-height:0 +
               overflow-y:auto, so THIS element (not the outer card) is what
               scrolls, and it can never be clipped by an ancestor's
               overflow:hidden again. Paired with hiding .bw-list/.bw-banner-
               wrap for the composer's own duration (see
               _openBirthdayCardComposer below) so it actually gets the
               room, and the actions row is pinned sticky at the bottom (see
               .bw-composer-actions below) so Send never requires scrolling
               to find in the first place. */
            '#birthday-wishes-modal .bw-composer{padding:12px 16px 16px;border-top:1px solid rgba(10,14,39,0.08);background:#fafbff;flex:1;min-height:0;overflow-y:auto;}',
            '#birthday-wishes-modal .bw-composer-title{font-weight:800;color:#1B2B8B;font-size:0.85rem;margin-bottom:10px;}',
            /* ═══════════════════════════════════════════════════════════
               UPGRADE (real illustrated card library, replacing the old
               5-color swatch row): each entry in BW_CARD_TEMPLATES below is
               a fully "designed" card — its own background, a scattered set
               of decorative glyphs (balloons/confetti/flowers/stars/ribbons/
               etc., all emoji + CSS so nothing depends on an external image
               host ever being reachable, same reasoning this file already
               used to drop the ui-avatars.com dependency elsewhere), and a
               gold foil border so it reads as an actual printed greeting
               card, not a flat color chip. The gallery below shows every
               template as a small live thumbnail (built by the same
               _cardTemplateDecorHTML() the big preview uses, just scaled
               down) so people are picking a real design, not guessing what
               a color swatch will look like once text is on it. */
            '#birthday-wishes-modal .bw-card-gallery-label{font-size:0.72rem;font-weight:800;color:#7a5a0a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;}',
            '#birthday-wishes-modal .bw-card-gallery{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 10px;-webkit-overflow-scrolling:touch;',
            'scroll-snap-type:x proximity;scrollbar-width:thin;}',
            '#birthday-wishes-modal .bw-card-thumb{position:relative;flex-shrink:0;width:78px;height:104px;border-radius:12px;cursor:pointer;',
            'overflow:hidden;box-sizing:border-box;border:2.5px solid transparent;scroll-snap-align:start;',
            'box-shadow:0 3px 8px rgba(10,14,39,0.18);transition:transform .15s,border-color .15s;}',
            '#birthday-wishes-modal .bw-card-thumb:active{transform:scale(0.94);}',
            '#birthday-wishes-modal .bw-card-thumb.selected{border-color:#F5C518;box-shadow:0 0 0 2px rgba(245,197,24,0.35),0 4px 12px rgba(10,14,39,0.3);',
            'transform:translateY(-2px);}',
            '#birthday-wishes-modal .bw-card-thumb-name{position:absolute;left:0;right:0;bottom:0;padding:3px 4px;font-size:0.55rem;font-weight:800;',
            'text-align:center;color:#fff;background:rgba(0,0,0,0.38);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2;}',
            /* The decorative glyphs — shared markup between the small
               gallery thumbnail and the big live preview, just scaled by a
               CSS custom property so one template definition renders both
               without two separate layouts to keep in sync. */
            '#birthday-wishes-modal .bw-card-decor{position:absolute;pointer-events:none;line-height:1;',
            'font-size:calc(var(--bwcd-scale, 1) * 1em);left:var(--bwcd-l);top:var(--bwcd-t);',
            'transform:translate(-50%,-50%) rotate(var(--bwcd-r,0deg));filter:drop-shadow(0 2px 3px rgba(0,0,0,0.25));}',
            '#birthday-wishes-modal .bw-card-foil{position:absolute;inset:0;border-radius:inherit;pointer-events:none;',
            'box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.35);}',
            '#birthday-wishes-modal .bw-card-preview{position:relative;border-radius:16px;padding:22px 16px;text-align:center;font-weight:700;',
            'font-family:Georgia,"Times New Roman",serif;font-size:1rem;min-height:130px;display:flex;align-items:center;justify-content:center;',
            'margin-bottom:10px;overflow:hidden;box-shadow:0 10px 26px rgba(10,14,39,0.28),0 0 0 1px rgba(245,197,24,0.3);}',
            '#birthday-wishes-modal .bw-card-preview-msg{position:relative;z-index:2;word-break:break-word;padding:0 6px;text-shadow:0 1px 3px rgba(0,0,0,0.25);}',
            '#birthday-wishes-modal textarea#bw-card-text{width:100%;box-sizing:border-box;border:1px solid rgba(10,14,39,0.15);border-radius:12px;',
            'padding:10px 12px;font-size:0.85rem;resize:none;min-height:44px;margin-bottom:10px;font-family:inherit;}',
            /* FIX ("no send button"): pinned to the bottom of the now-
               scrollable .bw-composer (see that rule's own comment above)
               with its own opaque background, so Cancel/Send Card stay on
               screen the whole time the composer is open, however tall the
               gallery/preview/textarea above them get — never something the
               person has to scroll down to discover. */
            '#birthday-wishes-modal .bw-composer-actions{display:flex;gap:10px;position:sticky;bottom:0;',
            'margin-top:10px;padding-top:10px;padding-bottom:2px;background:#fafbff;}',
            '#birthday-wishes-modal .bw-composer-actions .bw-secondary-btn{flex:1;padding:10px;border:1px solid rgba(10,14,39,0.15);border-radius:20px;',
            'background:#fff;color:#334;font-weight:700;font-size:0.82rem;cursor:pointer;}',
            '#birthday-wishes-modal .bw-composer-actions .bw-send-btn-wide{flex:2;padding:10px;border:none;border-radius:20px;',
            'background:linear-gradient(135deg,#1B2B8B,#3B5BDB);color:#fff;font-weight:700;font-size:0.82rem;cursor:pointer;}',
            /* ═══════════════════════════════════════════════════════════
               FEATURE (2026-08-25 — "click the picture should expand for a
               better view, swipeable horizontally, then a button to
               navigate back"): a lightbox for the "recent pictures" strip.
               A separate fixed overlay ABOVE #birthday-wishes-modal (which
               stays mounted underneath, untouched — this never rebuilds or
               closes the wishes feed, only covers it) rather than a second
               modal-on-modal, so there's exactly one extra layer to reason
               about. "Swipeable horizontally" is native horizontal scroll
               + scroll-snap on .bw-lb-track (same snap mechanism
               .bw-recent-strip already uses) — no custom touch/drag JS
               needed.

               REDESIGN (2026-08-25 — "covers the full screen, make a
               premium classic elegant frame with the same picture size,
               fix the exit button"): was a plain edge-to-edge black
               fullscreen block. Now a dimmed backdrop behind a centered,
               gold-gilded "picture frame" card (same navy/gold VIP palette
               as .bw-card/.bw-head elsewhere in this modal) sized to the
               picture rather than the viewport — object-fit:contain keeps
               every photo at its own true aspect ratio (never stretched or
               cropped to fill the screen), and tapping the dimmed backdrop
               outside the frame closes it too, same as any standard
               lightbox. The back button lives in the frame's own header
               bar instead of floating loose over the image.

               FIX ("back navigation is not working"): the back button's
               data-bw-action was never firing — the shared click-delegation
               handler below only matched `#birthday-wishes-modal
               [data-bw-action]`, and #bw-lightbox is a SIBLING of that
               modal (both direct children of <body>), not a descendant of
               it, so the selector could never match anything inside the
               lightbox. Fixed at the delegation handler itself (see the
               `bwAction` selector further down this file) to also match
               `#bw-lightbox [data-bw-action]`.

               REDESIGN #2 (2026-08-25 — "still covers too much of the
               screen, reduce it; give the expansion a birthday card feel"):
               shrunk the frame from ~92vw/86vh down to a genuinely
               card-sized ~76vw/62vh (image capped at 42vh, down from
               70vh) so it reads as a picture popping up over the feed, not
               a takeover. Added actual party dressing on top of the same
               gold frame rather than a new component: two balloon emoji
               anchored to the frame's top corners (poking outside it, like
               they're tied to the frame), a shimmering gold "🎉 Happy
               Birthday 🎉" ribbon between the header and the picture, and a
               small glowing cake medallion overlapping the frame's bottom
               edge — the same gold-glow badge treatment as the dashboard
               row's cake badges (.emp-bday-chip-cake / .bd-header-cake-
               badge), so this reads as the same "premium birthday" family,
               not a separate style. All three are decorative-only
               (pointer-events:none / not part of any click target), so
               none of them can intercept a tap meant for the picture, the
               back button, or the backdrop-dismiss. ═══════════════════ */
            '#bw-lightbox{position:fixed;inset:0;z-index:100000;background:rgba(6,9,26,0.92);backdrop-filter:blur(3px);',
            'display:none;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box;}',
            '#bw-lightbox.bw-lightbox-open{display:flex;}',
            /* Gilded outer edge — the "frame" itself, a slim gold-gradient
               border wrapping a dark inner mat, so the picture reads as
               displayed in a frame rather than floating loose on black.
               Card-sized, not viewport-sized — see REDESIGN #2 above. */
            '#bw-lightbox .bw-lb-frame{position:relative;width:min(76vw,340px);max-height:62vh;border-radius:22px;padding:7px;',
            'background:linear-gradient(135deg,#F5C518,#F08C1A 55%,#C9A66B);box-shadow:0 22px 60px rgba(0,0,0,0.55),0 0 0 1px rgba(245,197,24,0.35);',
            'display:flex;flex-direction:column;}',
            '#bw-lightbox .bw-lb-inner{background:#0A0E27;border-radius:17px;overflow:hidden;display:flex;flex-direction:column;min-height:0;}',
            '#bw-lightbox .bw-lb-top{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;',
            'background:linear-gradient(135deg,#0A0E27,#1B2B8B 65%,#3B2E8B);flex-shrink:0;}',
            '#bw-lightbox .bw-lb-back{border:none;background:rgba(255,255,255,0.14);color:#fff;width:34px;height:34px;border-radius:50%;',
            'display:flex;align-items:center;justify-content:center;font-size:1.05rem;cursor:pointer;flex-shrink:0;}',
            '#bw-lightbox .bw-lb-back:active{background:rgba(255,255,255,0.3);transform:scale(0.92);}',
            '#bw-lightbox .bw-lb-counter{color:#fff;font-size:0.76rem;font-weight:800;background:rgba(255,255,255,0.12);padding:5px 13px;',
            'border-radius:20px;letter-spacing:0.02em;}',
            /* Shimmering gold ribbon — the "birthday card" banner, sitting
               between the header bar and the picture itself. */
            '#bw-lightbox .bw-lb-ribbon{background:linear-gradient(90deg,#F5C518,#F08C1A,#EF4444,#F08C1A,#F5C518);background-size:250% 100%;',
            'color:#3a1e00;font-weight:800;font-size:0.68rem;letter-spacing:0.03em;text-align:center;padding:5px 8px;flex-shrink:0;',
            'animation:bdLbRibbonShine 3.2s linear infinite;}',
            '@keyframes bdLbRibbonShine{0%{background-position:0% 0;}100%{background-position:250% 0;}}',
            /* Balloons tied to the frame's top corners — decorative only,
               pointer-events:none so they can never eat a tap meant for
               the picture/back button/backdrop underneath them. */
            '#bw-lightbox .bw-lb-balloon{position:absolute;font-size:1.6rem;pointer-events:none;',
            'filter:drop-shadow(0 4px 6px rgba(0,0,0,0.35));z-index:1;}',
            '#bw-lightbox .bw-lb-balloon-l{top:-16px;left:8px;transform:rotate(-12deg);}',
            '#bw-lightbox .bw-lb-balloon-r{top:-14px;right:6px;transform:rotate(10deg);}',
            /* Glowing cake medallion overlapping the frame's bottom edge —
               same gold-glow badge language as the dashboard's cake
               badges, so this whole feature reads as one family. */
            '#bw-lightbox .bw-lb-seal{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);width:30px;height:30px;border-radius:50%;',
            'background:radial-gradient(circle at 35% 30%,#FFE9A8,#F5C518 55%,#F08C1A 100%);display:flex;align-items:center;justify-content:center;',
            'font-size:1rem;box-shadow:0 3px 10px rgba(240,140,26,0.55),inset 0 0 0 2px #fff;pointer-events:none;z-index:1;',
            'animation:bdLbSealGlow 2.4s ease-in-out infinite;}',
            '@keyframes bdLbSealGlow{0%,100%{box-shadow:0 3px 10px rgba(240,140,26,0.55),inset 0 0 0 2px #fff;}',
            '50%{box-shadow:0 3px 16px rgba(240,140,26,0.9),inset 0 0 0 2px #fff;}}',
            /* Picture area — sized to the picture, not the viewport.
               object-fit:contain preserves each photo's own aspect ratio
               ("the same picture size", never stretched/cropped/zoomed to
               fill the frame). max-height caps it (shrunk in REDESIGN #2)
               so the whole card — ribbon, picture, header — fits well
               inside the smaller frame. */
            '#bw-lightbox .bw-lb-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;',
            'min-height:0;}',
            '#bw-lightbox .bw-lb-track::-webkit-scrollbar{display:none;}',
            '#bw-lightbox .bw-lb-slide{flex:0 0 100%;scroll-snap-align:center;display:flex;align-items:center;justify-content:center;',
            'box-sizing:border-box;padding:8px;}',
            '#bw-lightbox .bw-lb-slide img{max-width:100%;max-height:42vh;object-fit:contain;display:block;border-radius:8px;}'
        ].join('\n');
        document.head.appendChild(css);

        var wrap = document.createElement('div');
        wrap.id = 'birthday-wishes-modal';
        wrap.className = 'modal-overlay-container';
        wrap.innerHTML =
            '<div class="bw-card">' +
                '<div class="bw-head">' +
                    '<button type="button" class="bw-close" data-bw-action="close" aria-label="Close">&times;</button>' +
                    '<div class="bw-head-top">' +
                        '<div class="bw-head-avatar-ring"><img id="bw-head-avatar" src="" alt=""></div>' +
                        '<div class="bw-head-textcol">' +
                            '<div class="bw-head-title" id="bw-head-title">Birthday</div>' +
                            '<div class="bw-head-sub">🎂 Birthday wishes</div>' +
                        '</div>' +
                    '</div>' +
                    /* "Recent pictures" — slidable horizontal strip,
                       populated per-recipient in openBirthdayWishesFeed(). */
                    '<div class="bw-recent-strip" id="bw-recent-strip"></div>' +
                    '<div class="bw-actions-row">' +
                        /* FIX ("broken icon"): the palette glyph was a
                           Font-Awesome <i> icon, which renders as a blank/
                           broken box for a moment (or entirely, on a poor
                           connection — see this session's own bottom-nav
                           fallback fix) until the webfont finishes
                           downloading. Replaced with a plain emoji glyph,
                           which is part of the text itself and can never
                           fail to load — same reasoning app-fix-final.js's
                           bottom-nav rebuild already uses inline SVG for
                           ("never depends on Font Awesome loading"). */
                        '<button type="button" class="bw-card-btn" id="bw-card-btn" data-bw-action="open-card" title="Design a birthday card">🎨 Design Card</button>' +
                        '<button type="button" class="bw-gift-btn" id="bw-gift-btn">🎁 Gift</button>' +
                    '</div>' +
                '</div>' +
                '<div class="bw-banner-wrap"><div class="bw-banner" id="bw-banner"></div></div>' +
                '<div class="bw-list" id="bw-list"></div>' +
                '<div class="bw-input-row" id="bw-input-row">' +
                    '<input type="text" id="bw-input" maxlength="200" placeholder="Write a birthday wish…">' +
                    '<button type="button" class="bw-send-btn" id="bw-send-btn" data-bw-action="send"><i class="fas fa-paper-plane"></i></button>' +
                '</div>' +
                /* Custom card composer — hidden until "Design a birthday
                   card" is tapped; see §Section 12's card-composer wiring
                   below (_openBirthdayCardComposer / _sendBirthdayCard). */
                '<div class="bw-composer" id="bw-composer" style="display:none;">' +
                    '<div class="bw-composer-title">🎨 Design a Birthday Card</div>' +
                    '<div class="bw-card-gallery-label">Choose a card design</div>' +
                    '<div class="bw-card-gallery" id="bw-card-gallery"></div>' +
                    '<div class="bw-card-preview" id="bw-card-preview"></div>' +
                    '<textarea id="bw-card-text" maxlength="140" placeholder="Write your personalized card message…"></textarea>' +
                    '<div class="bw-composer-actions">' +
                        '<button type="button" class="bw-secondary-btn" data-bw-action="close-card">Cancel</button>' +
                        '<button type="button" class="bw-send-btn-wide" data-bw-action="send-card"><i class="fas fa-paper-plane"></i> Send Card</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(wrap);

        /* Recent-pictures lightbox — see the "FEATURE"/"REDESIGN" comment
           on its CSS above. Built once alongside the wishes modal, reused
           for every open (populated fresh each time by
           _openBirthdayLightbox). Tapping the dimmed backdrop itself
           (outside the frame) also closes it — handled by an exact
           e.target === overlay check in the click delegation below, NOT
           via data-bw-action/closest(), since closest() would match the
           overlay as an ancestor of every click inside the frame too
           (image, back button, everything) and close on any tap at all. */
        var lb = document.createElement('div');
        lb.id = 'bw-lightbox';
        lb.innerHTML =
            '<div class="bw-lb-frame">' +
                '<span class="bw-lb-balloon bw-lb-balloon-l" aria-hidden="true">🎈</span>' +
                '<span class="bw-lb-balloon bw-lb-balloon-r" aria-hidden="true">🎈</span>' +
                '<div class="bw-lb-inner">' +
                    '<div class="bw-lb-top">' +
                        '<button type="button" class="bw-lb-back" data-bw-action="close-lightbox" aria-label="Back">&larr;</button>' +
                        '<span class="bw-lb-counter" id="bw-lb-counter"></span>' +
                    '</div>' +
                    '<div class="bw-lb-ribbon">🎉 Happy Birthday 🎉</div>' +
                    '<div class="bw-lb-track" id="bw-lb-track"></div>' +
                '</div>' +
                '<span class="bw-lb-seal" aria-hidden="true">🎂</span>' +
            '</div>';
        document.body.appendChild(lb);
    }

    function _renderBirthdayFeedItems(items) {
        var list = document.getElementById('bw-list');
        if (!list) return;
        if (!items.length) {
            list.innerHTML = '<div class="bw-empty">No wishes yet — be the first to say Happy Birthday! 🎉</div>';
            return;
        }
        // Sorted client-side (newest last, reads like a chat thread) rather
        // than via a Firestore orderBy — avoids requiring a new composite
        // index on birthday_feed (equality on birthdayUserId + orderBy a
        // different field) just for this one feed.
        list.innerHTML = items.map(function (it) {
            var name = _bdEsc(it.senderName || 'Someone');
            var avatar = _bdEsc(it.senderAvatar || '');
            var body = it.type === 'gift'
                ? '<span class="bw-gift-line">' + _bdEsc(it.giftSymbol || '🎁') + ' sent ' + _bdEsc(_giftLabel(it.giftName) || 'a gift') + '</span>' +
                  (it.message ? '<br>' + _bdEsc(it.message) : '')
                // FEATURE (customized birthday cards): a 'card' entry (see
                // _sendBirthdayCard() below) renders as its own small
                // illustrated card inline in the thread, instead of the
                // plain text bubble a free-text wish gets — so a
                // personalized card visually stands out the way it's meant
                // to. `cardTemplate` (new) renders the full design library
                // card (decorative glyphs + gold foil border, same markup
                // the composer's live preview uses); older cards sent
                // before this upgrade only have `cardBg` on file, so they
                // still fall back to a plain colored chip rather than
                // breaking or showing nothing.
                : it.type === 'card'
                ? (it.cardTemplate
                    ? '<div class="bw-card-mini bw-card-mini-tpl" style="background:' + _bdEsc(_findCardTemplate(it.cardTemplate).bg) + ';color:' + _bdEsc(_findCardTemplate(it.cardTemplate).color) + ';">' +
                        _cardTemplateDecorHTML(_findCardTemplate(it.cardTemplate), 0.6) +
                        '<span class="bw-card-preview-msg">' + _bdEsc(it.message || '') + '</span></div>'
                    : '<div class="bw-card-mini" style="background:' + _bdEsc(it.cardBg || 'linear-gradient(135deg,#1B2B8B,#5B0EA6)') + ';">🎉 ' + _bdEsc(it.message || '') + '</div>')
                : _bdEsc(it.message || '');
            return '<div class="bw-item"><img src="' + avatar + '" alt="' + name + '" onerror="this.style.visibility=\'hidden\'">' +
                '<div class="bw-bubble"><strong>' + name + '</strong><br>' + body +
                '<div class="bw-time">' + _bdEsc(_bdTimeAgo(it.createdAt)) + '</div></div></div>';
        }).join('');
        list.scrollTop = list.scrollHeight;
    }

    function _detachBirthdayFeedListener() {
        if (_bdFeed.unsub) { try { _bdFeed.unsub(); } catch (e) {} _bdFeed.unsub = null; }
        _bdFeed.userId = null;
    }

    // ─────────────────────────────────────────────────────────────
    // "Recent pictures, slidable horizontally" (requested addition):
    // pulls the celebrant's most recent photo posts and renders them as
    // a horizontal snap-scroll strip in the header. A SEPARATE, one-shot
    // .get() per open (not a live listener — this is a static "recent
    // photos" glance, not a feed that needs to update in real time while
    // the modal is open) using a single .where() with no chained
    // .orderBy() — same "avoid needing a composite Firestore index"
    // reasoning this section's own birthday_feed listener already uses
    // (see that query's own comment) — sorted client-side instead.
    // ─────────────────────────────────────────────────────────────
    var _bdRecentPicsToken = 0; // staleness guard — a fast second open shouldn't have an earlier fetch overwrite it

    // Holds the CURRENT strip's urls so the click handler (which only sees
    // the tapped <img>'s index) can hand the whole gallery + a start index
    // to _openBirthdayLightbox(). Reset on every render, same lifetime as
    // the strip itself.
    var _bdRecentPicUrls = [];

    function _renderBirthdayRecentPics(urls) {
        var strip = document.getElementById('bw-recent-strip');
        if (!strip) return;
        _bdRecentPicUrls = urls || [];
        if (!urls.length) { strip.classList.add('bw-empty-strip'); strip.innerHTML = ''; return; }
        strip.classList.remove('bw-empty-strip');
        // FEATURE ("click the picture should expand for a better view,
        // swipeable horizontally, then a button to navigate back"): each
        // thumbnail now carries its own index so a tap can open the full
        // gallery (_openBirthdayLightbox) starting on the exact picture
        // that was tapped, not just the first one.
        strip.innerHTML = urls.map(function (u, i) {
            return '<img src="' + _bdEsc(u) + '" alt="" loading="lazy" data-bd-pic-index="' + i + '" onerror="this.remove()">';
        }).join('');
    }

    /* ── Recent-pictures lightbox: tap → full view, swipe → next/prev,
       back button → return to the wishes feed underneath (never closed). */
    function _openBirthdayLightbox(urls, startIndex) {
        var lb = document.getElementById('bw-lightbox');
        var track = document.getElementById('bw-lb-track');
        var counter = document.getElementById('bw-lb-counter');
        if (!lb || !track || !urls || !urls.length) return;
        startIndex = Math.max(0, Math.min(urls.length - 1, startIndex || 0));

        track.innerHTML = urls.map(function (u) {
            return '<div class="bw-lb-slide"><img src="' + _bdEsc(u) + '" alt=""></div>';
        }).join('');
        if (counter) counter.textContent = (startIndex + 1) + ' / ' + urls.length;
        lb.classList.add('bw-lightbox-open');

        // Jump to the tapped picture instantly (no scroll animation) — the
        // slides don't have real width until the innerHTML write above has
        // been laid out, so this waits one frame rather than racing it.
        requestAnimationFrame(function () {
            track.scrollLeft = startIndex * track.clientWidth;
        });

        // Keep the counter in sync while swiping — one shared handler,
        // rewired per open rather than stacked, since track is reused.
        if (track._bdScrollHandler) track.removeEventListener('scroll', track._bdScrollHandler);
        track._bdScrollHandler = function () {
            if (!track.clientWidth) return;
            var idx = Math.round(track.scrollLeft / track.clientWidth);
            idx = Math.max(0, Math.min(urls.length - 1, idx));
            if (counter) counter.textContent = (idx + 1) + ' / ' + urls.length;
        };
        track.addEventListener('scroll', track._bdScrollHandler, { passive: true });
    }

    function _closeBirthdayLightbox() {
        var lb = document.getElementById('bw-lightbox');
        if (lb) lb.classList.remove('bw-lightbox-open');
    }

    function _loadBirthdayRecentPics(userId, fallbackAvatar) {
        var myToken = ++_bdRecentPicsToken;
        var strip = document.getElementById('bw-recent-strip');
        if (strip) { strip.classList.add('bw-empty-strip'); strip.innerHTML = ''; } // clear the PREVIOUS person's photos immediately

        var mu = window.mockUsers || {};
        var fullUser = mu[userId] || {};
        var fallbacks = [fullUser.coverPhoto, fallbackAvatar].filter(Boolean);

        if (!window.fbDb || !window._firebaseLoaded) { _renderBirthdayRecentPics(fallbacks); return; }

        window.fbDb.collection('posts').where('userId', '==', userId).limit(20).get()
            .then(function (snap) {
                if (myToken !== _bdRecentPicsToken) return; // superseded by a later open
                var posts = [];
                snap.forEach(function (doc) { posts.push(doc.data() || {}); });
                posts.sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
                var VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;
                var urls = [];
                posts.forEach(function (p) {
                    (p.media || []).forEach(function (u) {
                        if (u && !VIDEO_EXT.test(u) && urls.length < 8) urls.push(u);
                    });
                });
                _renderBirthdayRecentPics(urls.length ? urls : fallbacks);
            })
            .catch(function (err) {
                console.warn('[Birthday] recent-pics fetch failed:', err && err.message);
                if (myToken === _bdRecentPicsToken) _renderBirthdayRecentPics(fallbacks);
            });
    }

    // ─────────────────────────────────────────────────────────────
    // Banner — "scrollable/slidable then disappear with animation"
    // (requested change): the festive intro banner can now be swiped
    // away (left or right, either direction dismisses — this is a single
    // one-off message, not a multi-page carousel, so direction doesn't
    // carry separate meaning) or it fades/slides itself out on its own
    // after a few seconds so it never permanently occupies space once
    // its one job (announcing the birthday) is done.
    // ─────────────────────────────────────────────────────────────
    var _bdBannerTimer = null;
    var _bdBannerDrag = null; // {startX, active}

    function _dismissBirthdayBanner(bannerEl) {
        if (!bannerEl || bannerEl.classList.contains('bw-banner-leaving')) return;
        bannerEl.style.transform = ''; // clear any in-progress drag offset before the exit keyframe takes over
        bannerEl.classList.add('bw-banner-leaving');
    }

    function _armBirthdayBanner() {
        var bannerEl = document.getElementById('bw-banner');
        if (!bannerEl) return;
        clearTimeout(_bdBannerTimer);
        bannerEl.classList.remove('bw-banner-leaving');
        bannerEl.style.transform = '';

        // Auto-dismiss after a few seconds of dwell time — long enough to
        // read, short enough that it doesn't sit there forever eating
        // space above the wishes feed.
        _bdBannerTimer = setTimeout(function () { _dismissBirthdayBanner(bannerEl); }, 7000);

        // Swipe-to-dismiss, wired once (idempotent via _bdSwipeWired) —
        // touch-only (mouse users have the auto-dismiss timer and can
        // simply scroll past it; this file's other swipe-ish surfaces in
        // this app are touch-first too).
        if (bannerEl._bdSwipeWired) return;
        bannerEl._bdSwipeWired = true;
        bannerEl.addEventListener('touchstart', function (e) {
            _bdBannerDrag = { startX: e.touches[0].clientX, active: true };
            clearTimeout(_bdBannerTimer); // a person actively touching it shouldn't have it vanish mid-swipe
        }, { passive: true });
        bannerEl.addEventListener('touchmove', function (e) {
            if (!_bdBannerDrag || !_bdBannerDrag.active) return;
            var dx = e.touches[0].clientX - _bdBannerDrag.startX;
            bannerEl.style.transform = 'translateX(' + dx + 'px)';
            bannerEl.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 160));
        }, { passive: true });
        bannerEl.addEventListener('touchend', function (e) {
            if (!_bdBannerDrag) return;
            var dx = (e.changedTouches[0].clientX - _bdBannerDrag.startX);
            _bdBannerDrag = null;
            if (Math.abs(dx) > 60) {
                _dismissBirthdayBanner(bannerEl);
            } else {
                bannerEl.style.transform = '';
                bannerEl.style.opacity = '';
                // Swipe was too short to count as a dismiss — resume the
                // auto-dismiss countdown from a fresh window rather than
                // leaving it disarmed.
                clearTimeout(_bdBannerTimer);
                _bdBannerTimer = setTimeout(function () { _dismissBirthdayBanner(bannerEl); }, 7000);
            }
        }, { passive: true });
    }

    window.openBirthdayWishesFeed = function (userId, userName, userAvatar) {
        if (!userId) return;
        _ensureBirthdayWishesModal();
        _detachBirthdayFeedListener();

        var name = userName || 'Friend';
        // FIX ("name should be at the top, on one line"): the header CSS
        // (.bw-head-title) now enforces white-space:nowrap + ellipsis, so
        // this can stay a normal textContent assignment — the overflow
        // handling lives entirely in CSS rather than truncating the
        // string here, so a tooltip/copy of the full name is never lost.
        document.getElementById('bw-head-title').textContent = name + '\u2019s Birthday 🎂';
        document.getElementById('bw-head-avatar').src = userAvatar || '';
        _loadBirthdayRecentPics(userId, userAvatar);
        // Festive community banner — the requested pop-up message, now a
        // dismissable/auto-fading ribbon (see _armBirthdayBanner below).
        var bannerEl = document.getElementById('bw-banner');
        if (bannerEl) bannerEl.textContent = name + ', your birthday is today and the Empyrean community is glad to celebrate with you. Please everyone should wish him or her well.';
        _armBirthdayBanner();
        document.getElementById('bw-list').innerHTML = '<div class="bw-empty">Loading wishes…</div>';
        document.getElementById('bw-input').value = '';
        _closeBirthdayCardComposer(); // reset composer to closed/blank on every open

        var giftBtn = document.getElementById('bw-gift-btn');
        var cardBtn = document.getElementById('bw-card-btn');
        var us = window.userState || {};
        var isSelf = userId === us.id;
        giftBtn.style.display = isSelf ? 'none' : '';
        giftBtn.onclick = function () {
            if (typeof window.openProfileGiftCatalog === 'function') window.openProfileGiftCatalog(userId, userName);
        };
        // A person can still design a card for their OWN birthday thread
        // (friends read it same as any other card) — only gifting yourself
        // is blocked, same restriction _sendProfileGift() already enforces.
        if (cardBtn) cardBtn.style.display = '';

        var modal = document.getElementById('birthday-wishes-modal');
        modal.dataset.bwUserId = userId;
        modal.dataset.bwUserName = userName || 'Friend';
        modal.style.removeProperty('display');
        modal.style.removeProperty('visibility');
        modal.classList.add('show');
        document.body.classList.add('modal-open');

        if (!window.fbDb || !window._firebaseLoaded) return;
        _bdFeed.userId = userId;
        try {
            _bdFeed.unsub = window.fbDb.collection('birthday_feed')
                .where('birthdayUserId', '==', userId)
                .onSnapshot(function (snap) {
                    var items = [];
                    snap.forEach(function (doc) { items.push(doc.data() || {}); });
                    items.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
                    _renderBirthdayFeedItems(items);
                }, function (err) {
                    console.warn('[Birthday] wishes feed listener error:', err && err.message);
                });
        } catch (e) {
            console.warn('[Birthday] could not attach wishes feed listener:', e && e.message);
        }
    };

    function _closeBirthdayWishesModal() {
        var modal = document.getElementById('birthday-wishes-modal');
        if (modal) modal.classList.remove('show');
        document.body.classList.remove('modal-open');
        _detachBirthdayFeedListener();
        clearTimeout(_bdBannerTimer); // don't let a stale timer fire against a closed/reused modal
        _closeBirthdayLightbox(); // belt-and-suspenders — don't leave the lightbox open over a re-opened modal later
    }

    async function _sendBirthdayWish() {
        var modal = document.getElementById('birthday-wishes-modal');
        var input = document.getElementById('bw-input');
        if (!modal || !input) return;
        var recipientId = modal.dataset.bwUserId;
        var us = window.userState || {};
        if (!recipientId) return;
        if (recipientId === us.id) {
            if (typeof window.showNotification === 'function') window.showNotification("This is your own birthday — friends can leave their wishes here!", 'info');
            return;
        }
        var message = (input.value || '').trim().slice(0, 200);
        if (!message) return;

        var btn = document.getElementById('bw-send-btn');
        if (btn) btn.disabled = true;
        input.value = '';

        try {
            if (window.fbDb && window._firebaseLoaded) {
                await window.fbDb.collection('birthday_feed').add({
                    birthdayUserId: recipientId,
                    type: 'wish',
                    senderId: _authUid() || us.id,
                    senderName: us.fullName || us.username || 'Someone',
                    senderAvatar: us.avatar || '',
                    message: message,
                    createdAt: new Date().toISOString()
                });
            }
        } catch (err) {
            console.warn('[Birthday] wish send failed:', err && err.message);
            if (typeof window.showNotification === 'function') window.showNotification('Could not send your wish — try again.', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Customized birthday cards — "design and send a personalized card"
    // FEATURE (requested addition): a lightweight inline composer inside
    // the same Birthday Wishes modal (see #bw-composer above) — pick a
    // background from a small palette, write a message, preview it live,
    // and send. Persists as a `birthday_feed` doc with type:'card' (the
    // same collection/thread every wish and gift already writes to — see
    // this section's own header note on that shared feed), so a card
    // shows up interleaved with wishes and gifts, in order, exactly like
    // a Facebook birthday post's comment thread. No EMPY cost — this is
    // a free, creative way to participate distinct from the paid gift
    // catalog (SECTION 11) above.
    // ─────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────
    // UPGRADE (2026-08-25 — "generate a library of beautiful real-life
    // birthday cards to select and send instead of text formatting"):
    // BW_CARD_BGS (5 flat color gradients) replaced with a real library of
    // fully "designed" cards — each one a background PLUS a scattered set
    // of decorative glyphs (balloons, confetti, flowers, stars, ribbons,
    // a cake, etc.) and a thin gold-foil inner border, so picking one looks
    // and feels like choosing an actual printed greeting card, not a color
    // chip. Built entirely from CSS + emoji (no external image host — this
    // app already avoids exactly that dependency elsewhere, see
    // app-patch-v15.js's own note on dropping ui-avatars.com), so every
    // design always renders, even offline, with nothing to fetch or fail
    // to load. `decor` positions are in percent (top/left within the card)
    // so the exact same template renders correctly at both the small
    // gallery-thumbnail size and the big live-preview size — see
    // _cardTemplateDecorHTML() below.
    // ─────────────────────────────────────────────────────────────
    var BW_CARD_TEMPLATES = [
        {
            id: 'golden-confetti', name: 'Golden Confetti',
            bg: 'linear-gradient(160deg,#1B2B8B 0%,#3B2E8B 48%,#0A0E27 100%)', color: '#fff',
            decor: [
                { e: '🎉', t: 10, l: 14, s: 1.5, r: -12 }, { e: '✨', t: 14, l: 82, s: 1.1, r: 10 },
                { e: '🎊', t: 86, l: 20, s: 1.5, r: 8 },   { e: '⭐', t: 82, l: 78, s: 1.0, r: -6 },
                { e: '✨', t: 50, l: 8,  s: 0.8, r: 0 },    { e: '🎈', t: 24, l: 90, s: 1.2, r: 14 }
            ]
        },
        {
            id: 'balloon-bash', name: 'Balloon Bash',
            bg: 'linear-gradient(160deg,#8EC5FC 0%,#E0C3FC 55%,#FBC2EB 100%)', color: '#3a2060',
            decor: [
                { e: '🎈', t: 16, l: 20, s: 1.7, r: -10 }, { e: '🎈', t: 12, l: 50, s: 1.4, r: 8 },
                { e: '🎈', t: 18, l: 80, s: 1.6, r: 12 },  { e: '🎉', t: 84, l: 16, s: 1.2, r: -6 },
                { e: '🎊', t: 86, l: 82, s: 1.2, r: 8 }
            ]
        },
        {
            id: 'rose-garden', name: 'Rose Garden',
            bg: 'linear-gradient(160deg,#FDEBD3 0%,#FBC7D4 55%,#F7A8B8 100%)', color: '#7a1f3d',
            decor: [
                { e: '🌸', t: 10, l: 12, s: 1.3, r: -8 },  { e: '🌷', t: 88, l: 14, s: 1.4, r: 6 },
                { e: '🌹', t: 12, l: 86, s: 1.3, r: 10 },  { e: '🌸', t: 88, l: 84, s: 1.2, r: -10 },
                { e: '🦋', t: 46, l: 90, s: 1.0, r: 0 }
            ]
        },
        {
            id: 'tropical-paradise', name: 'Tropical Paradise',
            bg: 'linear-gradient(160deg,#0BA360 0%,#3CBA92 55%,#F5C518 130%)', color: '#0A2E1F',
            decor: [
                { e: '🌴', t: 14, l: 14, s: 1.6, r: -8 },  { e: '🍍', t: 84, l: 82, s: 1.4, r: 10 },
                { e: '☀️', t: 12, l: 82, s: 1.3, r: 0 },   { e: '🌺', t: 86, l: 16, s: 1.2, r: -6 }
            ]
        },
        {
            id: 'starry-wish', name: 'Starry Night Wish',
            bg: 'linear-gradient(160deg,#0A0E27 0%,#241654 55%,#3B2E8B 100%)', color: '#fff',
            decor: [
                { e: '🌙', t: 14, l: 82, s: 1.6, r: 0 },   { e: '⭐', t: 12, l: 16, s: 1.0, r: 0 },
                { e: '✨', t: 30, l: 8,  s: 0.8, r: 0 },    { e: '✨', t: 84, l: 20, s: 0.9, r: 0 },
                { e: '⭐', t: 88, l: 84, s: 1.1, r: 0 },    { e: '🌠', t: 50, l: 90, s: 1.2, r: -14 }
            ]
        },
        {
            id: 'classic-ribbon', name: 'Classic Ribbon',
            bg: 'linear-gradient(160deg,#7A1F2B 0%,#A62639 55%,#C9A66B 130%)', color: '#fff',
            decor: [
                { e: '🎀', t: 12, l: 50, s: 1.7, r: 0 },   { e: '🎁', t: 86, l: 18, s: 1.4, r: -8 },
                { e: '🎁', t: 86, l: 82, s: 1.3, r: 8 }
            ]
        },
        {
            id: 'rainbow-pop', name: 'Rainbow Pop',
            bg: 'linear-gradient(120deg,#FF5F6D 0%,#FFC371 30%,#F9F871 55%,#37D67A 75%,#3B5BDB 100%)', color: '#1B2B8B',
            decor: [
                { e: '🎂', t: 82, l: 50, s: 1.7, r: 0 },   { e: '🎉', t: 12, l: 16, s: 1.3, r: -10 },
                { e: '🎊', t: 14, l: 84, s: 1.3, r: 10 }
            ]
        },
        {
            id: 'gold-foil-luxe', name: 'Elegant Gold Foil',
            bg: 'linear-gradient(160deg,#0A0A0A 0%,#1a1a1a 55%,#2b2b2b 100%)', color: '#F5D98A',
            decor: [
                { e: '👑', t: 14, l: 50, s: 1.6, r: 0 },   { e: '✨', t: 84, l: 18, s: 1.0, r: 0 },
                { e: '✨', t: 84, l: 82, s: 1.0, r: 0 },    { e: '✨', t: 50, l: 10, s: 0.8, r: 0 },
                { e: '✨', t: 50, l: 90, s: 0.8, r: 0 }
            ]
        }
    ];
    var _bdCardState = { templateId: BW_CARD_TEMPLATES[0].id };

    function _findCardTemplate(id) {
        for (var i = 0; i < BW_CARD_TEMPLATES.length; i++) if (BW_CARD_TEMPLATES[i].id === id) return BW_CARD_TEMPLATES[i];
        return BW_CARD_TEMPLATES[0];
    }

    // Shared between the small gallery thumbnail and the big live preview —
    // `scale` multiplies each decor glyph's own font-size so the identical
    // template definition looks right at either size (thumbnail glyphs use
    // a smaller absolute em, preview glyphs the full size).
    function _cardTemplateDecorHTML(tpl, scale) {
        return (tpl.decor || []).map(function (d) {
            return '<span class="bw-card-decor" style="--bwcd-t:' + d.t + '%;--bwcd-l:' + d.l + '%;' +
                '--bwcd-scale:' + (d.s * scale) + ';--bwcd-r:' + (d.r || 0) + 'deg;">' + d.e + '</span>';
        }).join('') + '<span class="bw-card-foil"></span>';
    }

    function _renderCardGallery() {
        var wrap = document.getElementById('bw-card-gallery');
        if (!wrap) return;
        wrap.innerHTML = BW_CARD_TEMPLATES.map(function (tpl) {
            var sel = tpl.id === _bdCardState.templateId ? ' selected' : '';
            return '<div class="bw-card-thumb' + sel + '" data-bw-tpl="' + tpl.id + '" style="background:' + tpl.bg + ';" title="' + _bdEsc(tpl.name) + '">' +
                _cardTemplateDecorHTML(tpl, 0.42) +
                '<span class="bw-card-thumb-name">' + _bdEsc(tpl.name) + '</span>' +
                '</div>';
        }).join('');
    }

    function _updateCardPreview() {
        var preview = document.getElementById('bw-card-preview');
        var textEl  = document.getElementById('bw-card-text');
        if (!preview) return;
        var tpl = _findCardTemplate(_bdCardState.templateId);
        preview.style.background = tpl.bg;
        preview.style.color = tpl.color;
        preview.innerHTML = _cardTemplateDecorHTML(tpl, 1) +
            '<span class="bw-card-preview-msg">' + (_bdEsc((textEl && textEl.value.trim()) || '') || 'Your message will appear here…') + '</span>';
    }

    function _openBirthdayCardComposer() {
        var composer = document.getElementById('bw-composer');
        var inputRow = document.getElementById('bw-input-row');
        // FIX ("no send button / send is hidden"): .bw-list (the message
        // feed) was never hidden while the composer was open — it stayed
        // in the flex layout taking up its own space (down to its 120px
        // floor) right alongside the composer, which is exactly what left
        // too little room for the composer's own content and pushed its
        // Send button out of view. Hiding the feed + banner for the
        // composer's duration gives it the room it actually needs; both
        // are restored untouched in _closeBirthdayCardComposer below.
        var list = document.getElementById('bw-list');
        var bannerWrap = document.querySelector('#birthday-wishes-modal .bw-banner-wrap');
        if (!composer) return;
        _bdCardState.templateId = BW_CARD_TEMPLATES[0].id;
        var textEl = document.getElementById('bw-card-text');
        if (textEl) textEl.value = '';
        _renderCardGallery();
        _updateCardPreview();
        composer.style.display = 'block';
        if (inputRow) inputRow.style.display = 'none'; // one composing surface at a time
        if (list) list.style.display = 'none';
        if (bannerWrap) bannerWrap.style.display = 'none';
    }

    function _closeBirthdayCardComposer() {
        var composer = document.getElementById('bw-composer');
        var inputRow = document.getElementById('bw-input-row');
        var list = document.getElementById('bw-list');
        var bannerWrap = document.querySelector('#birthday-wishes-modal .bw-banner-wrap');
        if (composer) composer.style.display = 'none';
        if (inputRow) inputRow.style.display = '';
        if (list) list.style.display = '';
        if (bannerWrap) bannerWrap.style.display = '';
    }

    async function _sendBirthdayCard() {
        var modal = document.getElementById('birthday-wishes-modal');
        var textEl = document.getElementById('bw-card-text');
        if (!modal || !textEl) return;
        var recipientId = modal.dataset.bwUserId;
        var us = window.userState || {};
        if (!recipientId) return;

        var message = (textEl.value || '').trim().slice(0, 140);
        if (!message) {
            if (typeof window.showNotification === 'function') window.showNotification('Write a message for your card first.', 'error');
            return;
        }

        var btn = document.querySelector('#birthday-wishes-modal [data-bw-action="send-card"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

        try {
            if (window.fbDb && window._firebaseLoaded) {
                var sendTpl = _findCardTemplate(_bdCardState.templateId);
                await window.fbDb.collection('birthday_feed').add({
                    birthdayUserId: recipientId,
                    type: 'card',
                    senderId: _authUid() || us.id,
                    senderName: us.fullName || us.username || 'Someone',
                    senderAvatar: us.avatar || '',
                    message: message,
                    cardTemplate: sendTpl.id,
                    // cardBg kept alongside cardTemplate for backward
                    // compatibility — app-profile.js's own (simpler, text-
                    // only) birthday feed rendering reads cardBg directly
                    // and doesn't know about the template library, so it
                    // still shows a correctly-colored card rather than a
                    // blank/default one for cards sent from here.
                    cardBg: sendTpl.bg,
                    createdAt: new Date().toISOString()
                });
            }
            if (typeof window.showNotification === 'function') window.showNotification('🎉 Your personalized card was sent!', 'success');
            _closeBirthdayCardComposer();
        } catch (err) {
            console.warn('[Birthday] card send failed:', err && err.message);
            if (typeof window.showNotification === 'function') window.showNotification('Could not send your card — try again.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Card'; }
        }
    }

    document.addEventListener('click', function (e) {
        var closest = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };

        var chip = closest('.emp-bday-chip');
        if (chip) {
            window.openBirthdayWishesFeed(chip.dataset.bdayUserId, chip.dataset.bdayUserName, chip.dataset.bdayUserAvatar);
            return;
        }

        var pic = closest('.bw-recent-strip img');
        if (pic) {
            _openBirthdayLightbox(_bdRecentPicUrls, parseInt(pic.dataset.bdPicIndex, 10) || 0);
            return;
        }

        // Tap on the lightbox's dimmed backdrop itself (outside the framed
        // picture) closes it too — checked via an EXACT target match, not
        // closest(), since the overlay is an ancestor of the whole frame
        // and closest() would otherwise match (and close) on every tap
        // inside it, including the picture and the back button.
        if (e.target && e.target.id === 'bw-lightbox') {
            _closeBirthdayLightbox();
            return;
        }

        var thumb = closest('#birthday-wishes-modal .bw-card-thumb');
        if (thumb) {
            _bdCardState.templateId = thumb.dataset.bwTpl || BW_CARD_TEMPLATES[0].id;
            _renderCardGallery();
            _updateCardPreview();
            return;
        }

        // FIX ("back navigation is not working"): was scoped to only
        // `#birthday-wishes-modal [data-bw-action]`. #bw-lightbox is a
        // SIBLING of that modal (both appended directly to <body> — see
        // _ensureBirthdayWishesModal()), not a descendant of it, so the
        // lightbox's own back button could never match this selector and
        // its click was silently swallowed. Now matches both scopes.
        var bwAction = closest('#birthday-wishes-modal [data-bw-action], #bw-lightbox [data-bw-action]');
        if (bwAction) {
            var action = bwAction.dataset.bwAction;
            if (action === 'close') _closeBirthdayWishesModal();
            else if (action === 'send') _sendBirthdayWish();
            else if (action === 'open-card') _openBirthdayCardComposer();
            else if (action === 'close-card') _closeBirthdayCardComposer();
            else if (action === 'send-card') _sendBirthdayCard();
            else if (action === 'close-lightbox') _closeBirthdayLightbox();
            return;
        }
    });
    document.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'bw-card-text') _updateCardPreview();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var lb = document.getElementById('bw-lightbox');
            if (lb && lb.classList.contains('bw-lightbox-open')) { _closeBirthdayLightbox(); return; }
        }
        if (e.key !== 'Enter') return;
        if (e.target && e.target.id === 'bw-input') { e.preventDefault(); _sendBirthdayWish(); }
    });

    console.log('[Gifts] Module 0.14 loaded — ' + EMPY_GIFT_CATALOG.length + ' gifts in catalog (incl. profile/birthday catalog + dashboard Birthdays Today row/wishes feed + custom card composer + recent-pictures lightbox + premium gold cake badges). ✅');
})();