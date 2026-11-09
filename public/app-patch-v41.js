/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v41
   app-patch-v41.js  |  Load LAST — after app-patch-v40.js, app-patch-calls-log.js,
   app-patch-v14.js, app-patch-openchat.js, app-chat.js, app-feed.js, app-fixes.js.

   Six independent, purely-additive features. None of them edit any existing
   file — each attaches via the same public window.* hooks / DOM-observer
   pattern already used throughout this codebase.

   §1  RICH TEXT FORMATTING
       Overrides window.formatWhatsAppText + window.handleYoutubeEmbed (both
       originally defined in app-fixes.js, and already called everywhere via
       `typeof window.X === 'function'` checks — app-chat.js, app-feed.js,
       app-patch-openchat.js — so overriding the window reference is enough
       to upgrade every existing call site with zero other edits).
       Adds: reliable link detection for https/http/www + per-platform icon
       for YouTube, X/Twitter, WhatsApp, Facebook, Instagram, LinkedIn,
       TikTok; WhatsApp-style *bold*, _italic_, __underline__, ~strikethrough~,
       `code`; a ">" block-quote line style and a "<...>" wrapped (can span
       multiple lines) block-quote style; multi-video YouTube/Shorts
       embedding (old version only ever embedded the FIRST match and threw
       away formatting for every other line of text).

       UPDATE (2026-09-03 -- News Feed / quick-post / announcement / SOS
       feed markdown+link parsing): window.formatWhatsAppText is the single
       function every one of those surfaces already calls at render time
       (createNewPostElement + buildSosPostElement + buildCrisisPostElement
       in app-feed.js, buildAnnouncementFeedHTML in app-fixes.js, comments in
       app-news.js/app-thread.js, app-sos.js) -- since this file loads LAST
       and nothing after it reassigns window.formatWhatsAppText or
       window.handleYoutubeEmbed (verified against every script tag after
       this one in index.html), extending _richFormatText here reaches every
       one of those surfaces with no other file touched. Added:
         * YouTube/Shorts links now get an embedded player wherever
           formatWhatsAppText runs, not just from the separate
           handleYoutubeEmbed() call createNewPostElement already used --
           SOS story text, crisis descriptions, announcement bodies and
           comments only ever got a plain link before this.
         * Email addresses -> clickable mailto: links.
         * Bare ".com" domains (no http/https/www prefix) -> clickable links.
         * A link ending in .pdf/.doc/.docx now renders as a distinct
           colour-coded file chip (red/blue file-page icon + filename)
           instead of the generic platform-link icon.
         * Standard markdown **bold** now works alongside this app's
           existing *bold* convention (unchanged, so nothing already
           written that way regresses).
         * Every generated embed/link is now routed through an internal
           stash/placeholder step before the bold/italic/mention/hashtag
           passes run, so none of those can ever re-match text sitting
           inside an already-built <a href="..."> -- this also fixes a
           latent bug where a URL containing a "#fragment" (e.g.
           example.com/page#section) could get its fragment turned into a
           bogus clickable #hashtag.
       Blockquote ("> text" and the "<...>" wrapped form) was already
       implemented and is unchanged.

   §2  CALLS LOG — GROUP JOIN OPENS A FRESH TAB
       app-patch-calls-log.js already opens a fresh tab for a 1:1 call-back
       (see its own §5). This adds the same behaviour for the "Ongoing"
       group-call Join button / row tap, via a window-capture listener that
       pre-empts that file's own bubble-phase Join handler (identical
       guaranteed-first-listener technique documented in app-patch-v16.js).

   §3  GROUP CHAT HEADER — PREMIUM REDESIGN
       app-patch-v14.js's "Group info" portal (#v14-portal) is watched via
       MutationObserver and, once its body renders, is enhanced in place:
       hand-drawn SVG icons instead of Font Awesome glyphs, a description/
       about block with Read-more, an "Add to lists" row, a real "Media,
       links and docs" horizontal strip (queried straight from the existing
       groups/{id}/messages collection — no new writes), and a WhatsApp-
       style settings list (Manage storage, Notifications, Media visibility,
       Encryption, Disappearing messages, Chat lock, Advanced chat privacy).
       Nothing here touches v14's own member list / permissions / exit-
       group logic — this only decorates the same panel.

   §4  CONTACT INFO — ENRICHED BIO
       app-patch-openchat.js's #oc-profile-panel (1:1 "Contact info") is
       watched the same way: adds a Message/Voice/Video quick-action row
       (taps the SAME chat-header buttons that file's own call code already
       owns — no calling logic duplicated), a mutual-connections line
       computed from the two already-fetched followedUserIds arrays, and a
       friendlier default when a field is empty instead of just omitting it.

   §5  CONTACT LIST — BIO SNIPPET
       app-chat.js's renderContactList() 1:1 rows (#contacts-inner
       .contact-item) get a one-line bio/profession snippet under the
       existing last-message preview, sourced from the same window.mockUsers
       cache that file already reads — no extra Firestore calls.

   §6  COMPOSER TEXT FORMATTING TOOLBAR
       Selecting text inside app-patch-openchat.js's message composer
       (#oc-text-input) or its edit-message textarea (#oc-edit-textarea)
       now shows a small Bold/Italic/Underline/Strikethrough/Code toolbar
       (WhatsApp-style) that wraps the selection with the exact same
       *bold*, _italic_, __underline__, ~strikethrough~, `code` markdown
       §1's formatWhatsAppText already renders on the sent bubble — so
       what gets selected and tapped here is exactly what shows up
       formatted for the recipient. Tapping a still-active format again
       un-wraps it (bold → un-bold), same convention as toggling in
       WhatsApp/Notion. Anchored BELOW the composer row (not above) to
       stay clear of where the native OS selection bubble usually lands.
       NOTE: this can't suppress or be added into the OS/browser's own
       native text-selection popup (the "Cut / Copy / Paste" bubble
       Android/Opera Mini renders outside the page on any plain
       <textarea>) — that surface has no web API a page can reach. This
       toolbar is a separate control that appears alongside it.

       Also adds auto-continuing numbered ("1. ", "2. "…) and bulleted
       ("- ") lists in both textareas: press Enter after a list line and
       the next line starts with the next number/bullet automatically;
       pressing Enter on an empty list line ends the list, same
       convention as WhatsApp/Notion.
   ============================================================================= */

(function empyreanPatchV41() {
    'use strict';

    if (window._empyreanV41Loaded) { console.warn('[v41] Already loaded — skipping duplicate.'); return; }
    window._empyreanV41Loaded = true;

    function log(msg) { console.log('[v41] ' + msg); }
    function warn(msg, err) { console.warn('[v41] ' + msg, err && (err.message || err)); }
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _authUid() { try { return (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || null; } catch (e) { return null; } }
    function _us() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _myId() { return _authUid() || _us().id || ''; }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function _ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }

    /* =========================================================================
       Shared premium SVG icon set — 20x20 viewBox, currentColor stroke, used
       throughout §3/§4 in place of Font Awesome glyphs.
       ========================================================================= */
    var ICONS = {
        headset:   '<path d="M4 12v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="12" width="4" height="6" rx="1.6"/><rect x="17.5" y="12" width="4" height="6" rx="1.6"/><path d="M21.5 18v1.2a2.8 2.8 0 0 1-2.8 2.8h-4"/>',
        userPlus:  '<circle cx="9" cy="8" r="3.4"/><path d="M2.7 20c0-3.6 2.8-6 6.3-6s6.3 2.4 6.3 6"/><path d="M18.5 8v5M16 10.5h5"/>',
        search:    '<circle cx="10.2" cy="10.2" r="6.6"/><path d="M20 20l-4.9-4.9"/>',
        link:      '<path d="M9.5 14.5l5-5"/><path d="M7.4 12.8l-1.9 1.9a3.2 3.2 0 0 0 4.5 4.5l3-3a3.2 3.2 0 0 0 0-4.5"/><path d="M16.6 11.2l1.9-1.9a3.2 3.2 0 0 0-4.5-4.5l-3 3a3.2 3.2 0 0 0 0 4.5"/>',
        list:      '<path d="M4 6h1M4 12h1M4 18h1"/><path d="M8.5 6h11M8.5 12h11M8.5 18h11"/>',
        storage:   '<rect x="3" y="4" width="18" height="6" rx="1.6"/><rect x="3" y="14" width="18" height="6" rx="1.6"/><circle cx="7" cy="7" r=".9" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r=".9" fill="currentColor" stroke="none"/>',
        bell:      '<path d="M6 9a6 6 0 0 1 12 0c0 4 1.6 5.4 1.6 5.4H4.4S6 13 6 9z"/><path d="M9.6 17.5a2.5 2.5 0 0 0 4.8 0"/>',
        image:     '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.7"/><path d="M4 18l5.5-5.5a2 2 0 0 1 2.8 0L15 15l1.6-1.6a2 2 0 0 1 2.8 0L21 15.5"/>',
        lock:      '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>',
        shieldLock:'<path d="M12 3l7.5 3v5.4c0 5-3.2 8.4-7.5 9.6-4.3-1.2-7.5-4.6-7.5-9.6V6z"/><rect x="9.3" y="11" width="5.4" height="4.6" rx="1"/><path d="M10.4 11V9.5a1.6 1.6 0 0 1 3.2 0V11"/>',
        eyeOff:    '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c5 0 9 3.6 10 7-0.5 1.6-1.4 3-2.7 4.2M6.3 6.6C3.9 8.1 2.3 10.4 2 12c.9 3 4.3 6.5 9 7 1.3 0 2.5-.2 3.6-.6"/><path d="M9.5 10a3.4 3.4 0 0 0 4.8 4.8"/>',
        chevron:   '<path d="M8 5l7 7-7 7"/>',
        pencil:    '<path d="M4 20l.9-3.6L15.4 6a1.8 1.8 0 0 1 2.6 0l.1.1a1.8 1.8 0 0 1 0 2.6L7.6 19.1z"/><path d="M13.6 8l2.5 2.5"/>',
        mail:      '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M4 6.5l8 6.4 8-6.4"/>',
        phone:     '<path d="M6.6 4.5h3l1.4 4.6-2.2 1.9a13 13 0 0 0 5.7 5.7l1.9-2.2 4.6 1.4v3a1.8 1.8 0 0 1-2 1.8 16.4 16.4 0 0 1-14-14 1.8 1.8 0 0 1 1.8-2z"/>',
        video:     '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M18.5 10.2l3-2v7.6l-3-2z"/>',
        message:   '<path d="M4 5.5h16a1.6 1.6 0 0 1 1.6 1.6v9.4a1.6 1.6 0 0 1-1.6 1.6H9l-5 3.8v-3.8H4A1.6 1.6 0 0 1 2.4 16.5V7.1A1.6 1.6 0 0 1 4 5.5z"/>',
        users2:    '<circle cx="8" cy="8.4" r="3"/><circle cx="16.5" cy="9" r="2.4"/><path d="M2.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M14.3 14.2c2.7.3 4.7 2.3 4.7 4.8"/>',
        calendar:  '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
        badge:     '<path d="M12 3.5l2 1.7 2.6-.4 1 2.4 2.3 1.2-.7 2.6.7 2.6-2.3 1.2-1 2.4-2.6-.4-2 1.7-2-1.7-2.6.4-1-2.4-2.3-1.2.7-2.6-.7-2.6 2.3-1.2 1-2.4 2.6.4z"/><path d="M9.3 12.3l1.8 1.8 3.4-3.6"/>',
        folder:    '<path d="M3.5 6.5a1.6 1.6 0 0 1 1.6-1.6h4.2l1.8 2.2h9a1.6 1.6 0 0 1 1.6 1.6v9.7a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z"/>',
        /* FEATURE (feed/quick-post/announcement/SOS markdown+link parsing) —
           one "page with folded corner" outline reused for both the PDF and
           Word/DOC link chips in _richFormatText below; colour alone tells
           them apart (see _fileLinkIcon()) so this single path covers both
           instead of duplicating the outline per file type. */
        fileGeneric: '<path d="M6 2.5h8.2L19 7.3V20a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 20V4.1A1.6 1.6 0 0 1 6 2.5z"/><path d="M14 2.5v4.3a.5.5 0 0 0 .5.5H19"/>'
    };
    function svgIcon(name, size, strokeW) {
        var body = ICONS[name] || ICONS.link;
        size = size || 18; strokeW = strokeW || 1.8;
        return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
            '" fill="none" stroke="currentColor" stroke-width="' + strokeW +
            '" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    }

    /* =========================================================================
       §1  RICH TEXT FORMATTING
       ========================================================================= */
    var PLATFORM_ICONS = [
        { re: /(youtube\.com|youtu\.be)/i, svg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="#FF0000"><path d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 4 12 4 12 4s-7.5 0-9.4.4A3 3 0 0 0 .5 6.5 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1C4.5 20 12 20 12 20s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.5zM9.6 15.5v-7l6.3 3.5z"/></svg>' },
        { re: /(twitter\.com|x\.com)/i, svg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M18.2 3h3.2l-7 8 8.2 10.7h-6.4l-5-6.6-5.7 6.6H1.3l7.5-8.6L1 3h6.5l4.5 6z"/></svg>' },
        { re: /(whatsapp\.com|wa\.me)/i, svg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="#25D366"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.1 8.1 0 0 1-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1s-.7.8-.9 1c-.2.2-.3.2-.6.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.4 0-.5s-.6-1.4-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4s-.9.9-.9 2.1.9 2.5 1.1 2.7a7.7 7.7 0 0 0 3.3 3c1.6.7 1.6.5 1.9.4.3 0 1-.4 1.1-.8.1-.4.1-.7.1-.8s-.2-.1-.4-.2z"/></svg>' },
        { re: /instagram\.com/i, svg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2 0 1.9.2 2.4.4a4.8 4.8 0 0 1 2.7 2.7c.2.5.4 1.2.4 2.4.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.9-.4 2.4a4.8 4.8 0 0 1-2.7 2.7c-.5.2-1.2.4-2.4.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.9-.2-2.4-.4a4.8 4.8 0 0 1-2.7-2.7c-.2-.5-.4-1.2-.4-2.4C1.5 15.6 1.5 15.2 1.5 12s0-3.6.1-4.9c0-1.2.2-1.9.4-2.4A4.8 4.8 0 0 1 4.7 2c.5-.2 1.2-.4 2.4-.4C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.1 0-3.5 0-4.7.1-1 0-1.5.2-1.9.3a3 3 0 0 0-1.7 1.7c-.1.4-.3.9-.3 1.9-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c0 1 .2 1.5.3 1.9a3 3 0 0 0 1.7 1.7c.4.1.9.3 1.9.3 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c1 0 1.5-.2 1.9-.3a3 3 0 0 0 1.7-1.7c.1-.4.3-.9.3-1.9.1-1.2.1-1.6.1-4.7s0-3.5-.1-4.7c0-1-.2-1.5-.3-1.9a3 3 0 0 0-1.7-1.7c-.4-.1-.9-.3-1.9-.3-1.2-.1-1.6-.1-4.7-.1zm0 4.3a5.7 5.7 0 1 1 0 11.4 5.7 5.7 0 0 1 0-11.4zm0 1.8a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8zm5.9-2a1.3 1.3 0 1 1 0 2.7 1.3 1.3 0 0 1 0-2.7z"/></svg>' },
        { re: /linkedin\.com/i, svg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="#0A66C2"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zm7 0h3.8v1.7h.1c.5-1 1.9-2 3.8-2 4 0 4.8 2.6 4.8 6.1V21h-4v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21h-4z"/></svg>' },
        { re: /(facebook\.com|fb\.watch|fb\.com)/i, svg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="#1877F2"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12z"/></svg>' },
        { re: /tiktok\.com/i, svg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M16.5 2h-3v13.5a2.8 2.8 0 1 1-2-2.7V9.6a6 6 0 1 0 5 5.9V8.9a7.6 7.6 0 0 0 4.5 1.5V7.3A4.7 4.7 0 0 1 16.5 2z"/></svg>' }
    ];
    function _platformIcon(href) {
        for (var i = 0; i < PLATFORM_ICONS.length; i++) if (PLATFORM_ICONS[i].re.test(href)) return PLATFORM_ICONS[i].svg;
        return svgIcon('link', 13, 2);
    }

    /* FEATURE (2026-09-03 — feed/quick-post/announcement/SOS markdown+link
       parsing): distinct-coloured file-type icon for a link that resolves
       to a .pdf or .doc(x) — same "page, folded corner" outline
       (ICONS.fileGeneric above), red for PDF / blue for Word, so a file
       reference reads as a document chip instead of a generic web link. */
    function _fileLinkIcon(isPdf) {
        var color = isPdf ? '#E53935' : '#2B579A';
        return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="' + color +
            '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS.fileGeneric + '</svg>';
    }

    var YT_RE = /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:youtube\.com\/(?:shorts\/|(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=))|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi;
    var URL_RE = /\b(?:https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+\.[a-z]{2,}[^\s<>"'`]*)/gi;
    /* FEATURE (2026-09-03) — email address auto-linking (mailto:). Runs
       AFTER the URL pass (see _richFormatText) so it never competes with
       it; a normal email has no http/www prefix so the two never match
       the same text anyway, but the ordering also means EMAIL_RE only
       ever sees text the URL pass didn't already turn into an <a> (that
       text is stashed as an opaque placeholder by then — see _stash()). */
    var EMAIL_RE = /\b[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+\b/g;
    /* FEATURE (2026-09-03) — bare ".com" domain mentions with no protocol
       and no "www." (e.g. "check empyrean.com") — the one bare-domain
       pattern this task actually asked for. Deliberately scoped to just
       ".com" (not every possible TLD) to keep this from ever mistaking an
       ordinary sentence fragment (versions, abbreviations, etc.) for a
       link; a real https://, http:// or www. address of ANY TLD is
       already covered by URL_RE above regardless of this list. Runs LAST
       of the three link passes so it only ever sees whatever's left after
       full URLs and email addresses have already been stashed out. */
    var BARE_DOMAIN_RE = /\b((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+com)\b/g;

    function _richFormatText(text) {
        if (typeof text !== 'string' || !text) return '';

        // Escape HTML first — everything downstream operates on the escaped string.
        var t = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        /* FEATURE (2026-09-03) — opaque placeholder stash. Every pass below
           that generates real HTML (YouTube embed, a linkified URL/email/
           bare domain) pushes its markup here and leaves a token with no
           @ # * _ ~ ` < > characters in the text instead. That guarantees
           every LATER pass in this function — including the other link
           passes themselves — can never re-match text that's already
           sitting inside a finished <a href="..."> (its href attribute,
           or its own visible label) and mangle it with a second, nested
           tag. _unstash() puts the real markup back as the very last step. */
        var _stashed = [];
        function _stash(html) {
            var token = '\u0000LNK' + _stashed.length + '\u0000';
            _stashed.push(html);
            return token;
        }
        function _unstash(str) {
            return str.replace(/\u0000LNK(\d+)\u0000/g, function (m, i) { return _stashed[+i]; });
        }

        // Angle-bracket block quote: "<...possibly multi-line...>" → same
        // styled quote block as the "> text" line convention below, but
        // for a whole wrapped span rather than a per-line prefix (a "<"
        // opener was showing up as a bare literal character with nothing
        // done with it — this gives it a defined, visible meaning instead
        // of just being escaped text). Runs BEFORE the per-line ">" rule
        // so a matched block's own closing "&gt;" isn't re-matched by it.
        //
        // FIX (report — "some posts, admin announcements and quick posts
        // don't expand/collapse"): every call site that renders this
        // formatted output wraps it in a single '<p>...</p>' (app-feed.js's
        // createNewPostElement/buildSosPostElement/buildCrisisPostElement,
        // app-fixes.js's buildAnnouncementFeedHTML, comments in
        // app-thread.js/app-news.js — see those files' own '<p>' + this
        // function's output + '</p>' call sites). A <div> is block-level,
        // non-phrasing content, which is NOT legal inside a <p> per the
        // HTML5 content model — the browser's own parser reacts by
        // silently closing the <p> right before the <div> and never
        // reopening one for whatever text follows it. That splits what was
        // meant to be one paragraph into several sibling nodes, only the
        // FIRST of which is still a real <p> — exactly what both the
        // universal line-clamp engine (_empInitLineClampInner, this same
        // file's own :scope > p query) and the announcement-specific one
        // (_wireAnnouncementBodyToggle, which reads a single .ann-body <p>)
        // measure/clamp against. Text or embeds after a blockquote/YouTube
        // link ended up outside that measured element — invisible to the
        // clamp height, permanently un-collapsible, and throwing off
        // whether a toggle even appears. A <span> is phrasing content, so
        // it's legal inside a <p> and the parser leaves the paragraph
        // intact — forcing display:block via inline CSS still renders it
        // exactly like a <div> visually, so nothing about the actual quote
        // block's appearance changes, only its tag name.
        t = t.replace(/&lt;([\s\S]*?)&gt;/g, function (m, inner) {
            return '<span style="display:block;border-left:3px solid #1B2B8B;background:rgba(27,43,139,0.06);' +
                'padding:6px 10px;margin:4px 0;border-radius:0 6px 6px 0;color:#4B5563;font-size:0.92em;' +
                'white-space:pre-wrap;">' + inner + '</span>';
        });

        // Block-quote lines: "> quoted text" (own line) → styled quote bar,
        // WhatsApp/Slack convention, requested as "the quote they used".
        // Same <span style="display:block"> fix as the angle-bracket
        // variant above, and for the same reason.
        t = t.replace(/(^|\n)&gt;\s?([^\n]+)/g, function (m, pre, quoted) {
            return pre + '<span style="display:block;border-left:3px solid #1B2B8B;background:rgba(27,43,139,0.06);' +
                'padding:6px 10px;margin:4px 0;border-radius:0 6px 6px 0;color:#4B5563;font-size:0.92em;">' +
                quoted + '</span>';
        });

        // FEATURE (2026-09-03) — YouTube/Shorts links get an embedded
        // player, not just a clickable link, wherever formatWhatsAppText
        // runs (feed posts already got this via the separate
        // handleYoutubeEmbed() wrapper below, but SOS story text, crisis
        // descriptions, announcement bodies and comments all call
        // formatWhatsAppText directly — see app-feed.js/app-fixes.js/
        // app-news.js/app-thread.js call sites — so without this they only
        // ever got a plain link). Multiple links in the same text each get
        // their own embed. Stashed immediately so the URL pass right below
        // can never re-match the URL this just consumed.
        //
        // FIX (same report as the blockquote fix just above): this stash
        // used to be a <div class="story-youtube-embed">, which hits the
        // identical div-inside-p problem whenever a caller wraps this
        // function's return value in '<p>...</p>' directly (every caller
        // that does NOT go through the separate handleYoutubeEmbed()
        // wrapper below — which is exactly the announcement/SOS/crisis/
        // comment case this comment already flags as calling
        // formatWhatsAppText directly). Same <span style="display:block">
        // fix, same reasoning — style.css's '.story-youtube-embed' rule is
        // a class selector (tag-independent) and the aspect-ratio
        // padding-bottom trick it uses works identically on any element
        // CSS has turned into a block box, so nothing about how the
        // embed looks or sizes changes.
        t = t.replace(YT_RE, function (full, id) {
            return _stash('<span class="story-youtube-embed" style="display:block;"><iframe src="https://www.youtube.com/embed/' + id +
                '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></span>');
        });


        // Auto-link https/http/www with a per-platform icon — and, when the
        // link resolves to a .pdf/.doc(x) file, a distinct file-type chip
        // instead (FEATURE 2026-09-03: "detect and render links to .pdf and
        // .doc files appropriately").
        /* FEATURE 2026-10-03 (link thumbnail cards): the FIRST plain web
           link in a piece of text also gets an empty, hidden placeholder
           span stashed right after its <a>. The hydrator at the bottom of
           this file (§7) fills it in with a WhatsApp/Facebook-style
           thumbnail card fetched from server.js's /api/link-preview, but
           only where the placeholder sits inside a feed post body
           (.story-content / .news-item-content) — in chat bubbles,
           comments etc. it stays an inert hidden span. A <span> (not a
           <div>) so it's legal inside the callers' '<p>...</p>' wrapper,
           same reason as the blockquote/YouTube fixes above. One card per
           post keeps long link lists from turning into a wall of cards. */
        var _cardDone = false;
        function _cardMarker(href) {
            if (_cardDone) return '';
            var pathOnly = href.split(/[?#]/)[0];
            if (/\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|mp3|wav|zip|apk)$/i.test(pathOnly)) return '';
            _cardDone = true;
            return _stash('<span class="emp-linkcard-ph" data-url="' + href + '" style="display:none;"></span>');
        }

        t = t.replace(URL_RE, function (url) {
            var href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
            // File-link check runs against the path only (query/hash stripped)
            // so "?download=1" or "#page=2" after ".pdf"/".doc" doesn't hide it.
            var pathOnly = href.split(/[?#]/)[0];
            var fileExt = /\.(pdf|docx?)$/i.exec(pathOnly);
            var label = url.length > 45 ? url.slice(0, 45) + '\u2026' : url;
            if (fileExt) {
                var isPdf = /^pdf$/i.test(fileExt[1]);
                var fname = decodeURIComponent(pathOnly.split('/').pop() || (isPdf ? 'document.pdf' : 'document.doc'));
                return _stash('<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="elp-file-link" ' +
                    'style="color:' + (isPdf ? '#E53935' : '#2B579A') + ';text-decoration:none;font-weight:600;' +
                    'display:inline-flex;align-items:center;gap:5px;vertical-align:middle;background:rgba(10,14,39,0.05);' +
                    'border-radius:6px;padding:2px 8px 2px 6px;">' + _fileLinkIcon(isPdf) + ' ' + fname + '</a>');
            }
            var icon = _platformIcon(href);
            return _stash('<a href="' + href + '" target="_blank" rel="noopener noreferrer" ' +
                'style="color:var(--secondary,#1B2B8B);text-decoration:underline;font-weight:500;' +
                'display:inline-flex;align-items:center;gap:4px;vertical-align:middle;' +
                /* FIX (2026-10-04): a long URL (e.g. a Facebook /share/r/... link) made this inline-flex
                   anchor wider than the post card and spill past its edge. Cap it at the container
                   width and let the label wrap anywhere. */
                'max-width:100%;overflow-wrap:anywhere;word-break:break-all;">' + icon + ' ' + label + '</a>') + _cardMarker(href);
        });

        // FEATURE (2026-09-03) — email address → clickable mailto: link.
        t = t.replace(EMAIL_RE, function (addr) {
            return _stash('<a href="mailto:' + addr + '" ' +
                'style="color:var(--secondary,#1B2B8B);text-decoration:underline;font-weight:500;' +
                'display:inline-flex;align-items:center;gap:4px;vertical-align:middle;">' + svgIcon('mail', 13, 2) + ' ' + addr + '</a>');
        });

        // FEATURE (2026-09-03) — bare ".com" domain (no http/https/www
        // prefix) → clickable link, same visual treatment as a normal URL.
        t = t.replace(BARE_DOMAIN_RE, function (domain) {
            var href = 'https://' + domain;
            return _stash('<a href="' + href + '" target="_blank" rel="noopener noreferrer" ' +
                'style="color:var(--secondary,#1B2B8B);text-decoration:underline;font-weight:500;' +
                'display:inline-flex;align-items:center;gap:4px;vertical-align:middle;">' + _platformIcon(href) + ' ' + domain + '</a>');
        });

        /* FIX (2026-10-25 — "WhatsApp number still shows as plain text, no banner"):
           this function REPLACES app-fixes.js's formatWhatsAppText (see the
           window.formatWhatsAppText assignment below — this file loads last), and
           the phone/WhatsApp-number pass that lived in app-fixes.js's version was
           never carried over, so no feed post ever got the number markup that
           app-link-preview.js §9/§10 turns into a tap-to-call link, a WhatsApp
           chip, or the Chat on WhatsApp banner. Same detection rules as the
           original, ported here and stashed like every other link pass:
             • a number written as a WhatsApp number ("WhatsApp: 0801 234 5678",
               "0801 234 5678 (WhatsApp)") -> <span class="emp-wa"> chip + QR button
             • any other phone-looking number -> tel: link
           Conservative on purpose: a bare digit run only counts with a leading "+",
           a local 0-number, the 234 country code, or a nearby call/tel/phone/
           WhatsApp word. Dates, IPs, prices and long ids are left alone. Local
           numbers starting with 0 use window._EMP_DEFAULT_CC (default "234"). */
        t = t.replace(/(?<![\w.@\/:=#\u0000\u20A6$\u00A3\u20AC])(\+?\(?\d[\d\s().\-]{6,18}\d)(?![\w%])/g, function (m, g, off, whole) {
            var raw = m.trim();
            var digits = raw.replace(/\D/g, '');
            if (digits.length < 8 || digits.length > 15) return m;
            if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw) || /^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(raw) || /^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return m;
            var before = whole.slice(Math.max(0, off - 40), off).replace(/\u0000LNK\d+\u0000/g, ' ');
            var after = whole.slice(off + m.length, off + m.length + 26);
            var isWa = /(?:whats\s?-?app|whatsap|wassap|\bwa\s*[:\-\u2013])[^\d\n]{0,18}$/i.test(before)
                    || /^\s*[(\[\-\u2013\u2014:,]?\s*(?:on\s+|via\s+)?(?:whats\s?-?app|whatsap|wassap)\b/i.test(after);
            var hasPlus = raw.charAt(0) === '+';
            var local0 = /^0\d{9,10}$/.test(digits);
            var ng234 = /^234\d{10}$/.test(digits);
            var kw = /(?:call|tel|phone|mobile|contact|dial|sms|text|reach|whats\s?-?app)\b[^\d\n]{0,18}$/i.test(before);
            if (!(hasPlus || local0 || ng234 || isWa || kw)) return m;
            var intl;
            if (hasPlus) intl = digits;
            else if (digits.indexOf('00') === 0) intl = digits.slice(2);
            else if (digits.charAt(0) === '0') intl = (window._EMP_DEFAULT_CC || '234') + digits.slice(1);
            else intl = digits;
            var lead = m.slice(0, m.indexOf(raw)), tail = m.slice(m.indexOf(raw) + raw.length);
            var html;
            if (isWa) {
                html = '<span class="emp-wa"><a class="emp-wa-chip" href="https://wa.me/' + intl + '" data-wa="' + intl + '" data-wa-label="' + raw + '" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i> ' + raw + '</a>'
                     + '<button type="button" class="emp-wa-qr" data-wa="' + intl + '" data-wa-label="' + raw + '" title="Show WhatsApp QR code" aria-label="Show WhatsApp QR code"><i class="fas fa-qrcode"></i></button></span>';
            } else {
                var telHref = (hasPlus || local0 || ng234 || digits.indexOf('00') === 0) ? '+' + intl : digits;
                html = '<a class="emp-link emp-tel" href="tel:' + telHref + '" style="color:#1A73E8;text-decoration:underline;font-weight:500;"><i class="fas fa-phone"></i> ' + raw + '</a>';
            }
            return lead + _stash(html) + tail;
        });

        // WhatsApp-style inline formatting. Order matters: double-asterisk
        // (standard markdown bold) is consumed before single-asterisk
        // (this app's existing *bold* convention, unchanged so nothing
        // already written this way regresses), double-underscore
        // (underline) before single-underscore (italic), and highlight
        // (==) before nothing else conflicts. Every <a> generated above is
        // sitting behind an opaque placeholder token right now (see
        // _stash()), so none of these patterns can ever fire inside a
        // link's own href/label — including a URL that happens to contain
        // a literal *, _, ~ or ` in its query string.
        t = t
            .replace(/==(.*?)==/g, '<mark style="background:rgba(245,197,24,0.32);padding:1px 4px;border-radius:3px;">$1</mark>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<u>$1</u>')
            .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
            .replace(/~(.*?)~/g, '<s>$1</s>')
            .replace(/`(.*?)`/g, '<code style="background:rgba(10,14,39,0.08);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.88em;">$1</code>')
            .replace(/\n/g, '<br>');

        // @mention — clickable, navigates to user profile.
        t = t.replace(/@([a-zA-Z0-9_.]+)/g, function (m, u) {
            return '<a href="#" class="mention-tag" data-username="' + u + '" ' +
                'style="color:var(--secondary,#1B2B8B);font-weight:700;text-decoration:none;' +
                'background:rgba(27,43,139,0.09);border-radius:4px;padding:1px 4px;">@' + u + '</a>';
        });
        // #hashtag
        // FIX (bug: pasted CSS/style text showing "#1B2B8B)" rendered as a
        // blue clickable link): a bare 3- or 6-digit hex sequence right
        // after "#" is character-for-character indistinguishable from a
        // real hashtag to /#([a-zA-Z0-9_]+)/ alone, so any hex color code
        // in text (from pasted CSS, a copied bug report, etc.) was getting
        // turned into a hashtag-tag link. Skipping exact 3/6-hex-digit
        // matches removes that false-positive without touching real
        // hashtags (which are essentially never a bare hex triple/sextet)
        // or @mention, which is untouched above. A "#" that's part of a
        // URL fragment (e.g. example.com/page#section) can't reach this
        // rule at all any more — that whole URL is already a stashed
        // placeholder by this point, same protection described above.
        t = t.replace(/#([a-zA-Z0-9_]+)/g, function (m, tag) {
            if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(tag)) return m;
            return '<a href="#" class="hashtag-tag" data-tag="' + tag + '" ' +
                'style="color:var(--accent-color,#F5C518);font-weight:700;text-decoration:none;' +
                'background:rgba(245,197,24,0.12);border-radius:4px;padding:1px 4px;">#' + tag + '</a>';
        });

        // Restore every stashed embed/link now that no further pass can
        // accidentally re-match text inside it.
        t = _unstash(t);
        return t;
    }
    window.formatWhatsAppText = _richFormatText;

    function _richYoutubeEmbed(text) {
        if (typeof text !== 'string' || !text) return { html: '', found: false };
        var matches = [];
        var m;
        YT_RE.lastIndex = 0;
        while ((m = YT_RE.exec(text))) matches.push({ full: m[0], id: m[1] });
        if (!matches.length) return { html: '<p>' + _richFormatText(text) + '</p>', found: false };

        // Replace every matched YouTube/Shorts URL with an embed, then run the
        // REST of the text (surrounding words, other links, formatting,
        // mentions/hashtags) through the full rich formatter too — the old
        // version dropped that entirely once a video was found.
        var remaining = text;
        var embeds = '';
        matches.forEach(function (mt) {
            remaining = remaining.replace(mt.full, '');
            embeds += '<div class="story-youtube-embed"><iframe src="https://www.youtube.com/embed/' + mt.id +
                '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
        });
        var textHtml = remaining.trim() ? '<p>' + _richFormatText(remaining.trim()) + '</p>' : '';
        return { html: textHtml + embeds, found: true };
    }
    window.handleYoutubeEmbed = _richYoutubeEmbed;

    log('Rich text formatting installed (links + platform icons + bold/italic/underline/strike/code/quote).');


    /* =========================================================================
       §2  CALLS LOG — GROUP JOIN OPENS A FRESH TAB
       ========================================================================= */
    function _openCallsSectionInNewTab(extraParams) {
        var url = location.origin + location.pathname + '?showCalls=1' + (extraParams || '');
        window.open(url, '_blank');
    }

    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.emp-call-status-ring')) return; // status tap keeps its own action

        // 1:1 "Recent" row / call-back button — same fresh-tab idea, now also
        // landing on the Calls section first instead of dialing silently.
        var backBtn = e.target.closest('.emp-call-back-btn');
        var recentRow = e.target.closest('.emp-call-row');
        if (backBtn || recentRow) {
            var targetRow = backBtn ? backBtn.closest('.emp-call-row') : recentRow;
            if (!targetRow) return;
            var otherId = targetRow.dataset.otherId;
            var isVideoCall = targetRow.dataset.isVideo === '1';
            if (!otherId) return;
            e.preventDefault(); e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            _openCallsSectionInNewTab('&callBack=' + encodeURIComponent(otherId) + '&callType=' + (isVideoCall ? 'video' : 'voice'));
            return;
        }

        // Ongoing group-call row / Join button.
        var joinBtn = e.target.closest('.emp-call-join-btn');
        var row = joinBtn ? joinBtn.closest('#emp-calls-ongoing > div[style*="border-radius:14px"]') : e.target.closest('#emp-calls-ongoing > div[style*="border-radius:14px"]');
        if (!row) return;

        var gid = (joinBtn && joinBtn.dataset.groupId) || (row.querySelector('.emp-call-join-btn') && row.querySelector('.emp-call-join-btn').dataset.groupId);
        if (!gid) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        _openCallsSectionInNewTab('&joinGroupCall=' + encodeURIComponent(gid));
    }, true); // capture — runs before calls-log's own bubble-phase handlers

    // Fresh-tab bootstrap: lands on Messages > Calls, then either joins the
    // requested group call (public window._empGroupCallStart) or opens the
    // 1:1 chat and taps its own existing call button — same call path a
    // person would use manually, just kicked off from the Calls list.
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () {
            try {
                var params = new URLSearchParams(location.search);
                if (!params.has('showCalls')) return;
                if (typeof window.navigateTo === 'function') window.navigateTo('messages');
                setTimeout(function () {
                    var tabBtn = document.getElementById('emp-calls-tab');
                    if (tabBtn) tabBtn.click();

                    var gid = params.get('joinGroupCall');
                    if (gid) {
                        setTimeout(function () {
                            if (typeof window._empGroupCallStart === 'function') window._empGroupCallStart(gid);
                            else _notify('Group calling isn\u2019t available right now.', 'warning');
                        }, 500);
                        return;
                    }

                    var otherId = params.get('callBack');
                    if (otherId) {
                        var isVideo = params.get('callType') === 'video';
                        setTimeout(function () {
                            if (typeof window.openChat !== 'function') return;
                            window.openChat(otherId);
                            setTimeout(function () {
                                var sel = isVideo ? '.oc-header-btn[title="Video call"]' : '.oc-header-btn[title="Voice call"]';
                                var btn = document.querySelector('#oc-chat-header ' + sel) || document.querySelector(sel);
                                if (btn) btn.click();
                                else _notify('Chat opened — tap the call icon at the top to call back.', 'info');
                            }, 450);
                        }, 500);
                    }
                }, 350);
            } catch (e) {}
        }, 1200);
    });

    log('Calls log: tapping any call (1:1 or group) now opens the Calls section in a fresh tab before acting.');


    /* =========================================================================
       §3  GROUP CHAT HEADER — PREMIUM REDESIGN (enhances #v14-portal)
       ========================================================================= */
    // v14's own management-portal opener isn't exposed on window, so the
    // groupId is instead captured here the same way v14 itself captured it
    // from v13 — by wrapping window.openGroupChat one layer further (same
    // chaining pattern v14 already uses over v13's original). Whichever
    // group is currently open is whichever group's portal gets opened next,
    // so this is a reliable, additive way to know which id the panel that
    // appears in the DOM shortly after belongs to.
    var _priorOpenGroupChat = window.openGroupChat;
    if (typeof _priorOpenGroupChat === 'function') {
        window.openGroupChat = function (groupId) {
            window._empActiveGroupId = groupId;
            return _priorOpenGroupChat(groupId);
        };
    }

    function _findGroupIdFromPanel(panel) {
        if (window._empActiveGroupId) return window._empActiveGroupId;
        var view = document.getElementById('v13-group-view');
        return (view && view.dataset && view.dataset.groupId) || null;
    }

    function _fmtBytes(n) {
        if (!n) return '0 MB';
        var mb = n / (1024 * 1024);
        return mb < 1 ? Math.max(1, Math.round(n / 1024)) + ' KB' : mb.toFixed(1) + ' MB';
    }

    function _settingsRow(opts) {
        // opts: { icon, title, subtitle, right: 'chevron'|'toggle'|htmlString, toggled }
        var right = '';
        if (opts.right === 'chevron') right = '<span style="color:#C4C8D1;">' + svgIcon('chevron', 16) + '</span>';
        else if (opts.right === 'toggle') {
            right = '<span class="v41-toggle" data-key="' + _esc(opts.key || '') + '" style="width:38px;height:22px;border-radius:20px;background:' +
                (opts.toggled ? '#1B2B8B' : '#D8DBE3') + ';position:relative;cursor:pointer;flex-shrink:0;transition:background .15s;display:inline-block;">' +
                '<span style="position:absolute;top:2px;left:' + (opts.toggled ? '18px' : '2px') + ';width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);transition:left .15s;"></span></span>';
        } else if (typeof opts.right === 'string') right = opts.right;

        return '<div class="v41-settings-row" data-row="' + _esc(opts.key || '') + '" style="display:flex;align-items:center;gap:14px;padding:13px 16px;cursor:' + (opts.clickable ? 'pointer' : 'default') + ';">' +
            '<span style="width:36px;height:36px;border-radius:10px;background:rgba(27,43,139,0.08);color:#1B2B8B;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + svgIcon(opts.icon, 18) + '</span>' +
            '<div style="flex:1;min-width:0;">' +
            '<div class="v41-row-title" style="font-size:0.9rem;color:#111827;font-weight:600;">' + _esc(opts.title) + '</div>' +
            (opts.subtitle ? '<div class="v41-row-subtitle" style="font-size:0.78rem;color:#6B7280;margin-top:1px;line-height:1.35;">' + _esc(opts.subtitle) + '</div>' : '') +
            '</div>' + right + '</div>';
    }

    function _enhanceGroupPortal(panel) {
        if (panel.dataset.v41Enhanced === '1') return;
        var body = panel.querySelector('#v14-body');
        if (!body || !body.querySelector('#v14-copy-link')) return; // not rendered yet
        panel.dataset.v41Enhanced = '1';

        var gid = _findGroupIdFromPanel(panel);

        /* FIX (avoiding a duplicate-feature conflict): the premium SVG
           pill icons and the group description/About field were BOTH
           originally planned to live here, behind this MutationObserver.
           Once the "premium icons broken" / "group description missing"
           bugs were actually reported, they were fixed directly at the
           source in app-patch-v14.js's own _renderPortalBody instead
           (real SVG icons on #v14-qa-voice/-add/-search, plus a working
           #v14-group-desc tap-to-edit field wired to groups/{id}.description)
           — the same "fix at the source, don't stack another layer on
           top" precedent this codebase already established in
           app-patch-v33.js/v37.js's own headers. Re-doing either one
           here would render two different description UIs on the same
           screen and repaint an already-correct icon with a second,
           slightly different one, so both are skipped. Everything below
           (Add to lists, the media/links/docs strip, the settings list)
           has no v14.js equivalent and is kept as originally built. */

        // Stable anchors: the link/created-by card and the permissions card,
        // found by their actual content rather than guessed position/style.
        var linkCard = body.querySelector('#v14-copy-link') && body.querySelector('#v14-copy-link').closest('div[style*="border-bottom:8px solid"]');
        var permsCard = body.querySelector('.v14-perm-row') && body.querySelector('.v14-perm-row').closest('div[style*="border-bottom:8px solid"]');

        // ── 3c. "Add to lists" row, appended inside the existing link card ──
        if (linkCard && !body.querySelector('#v41-add-to-lists')) {
            var addRow = document.createElement('button');
            addRow.id = 'v41-add-to-lists';
            addRow.type = 'button';
            addRow.style.cssText = 'width:100%;text-align:left;background:none;border:none;border-top:1px solid #eee;padding:14px 16px;font-size:0.88rem;color:#111827;cursor:pointer;display:flex;align-items:center;gap:12px;';
            addRow.innerHTML = '<span style="width:30px;height:30px;border-radius:9px;background:rgba(27,43,139,0.08);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:#1B2B8B;">' + svgIcon('list', 15) + '</span> Add to lists';
            addRow.addEventListener('click', function () { _notify('Lists let you organize chats into custom folders — coming soon.', 'info'); });
            linkCard.appendChild(addRow);
        }

        // ── 3d. Media, links and docs strip — inserted right before the
        //        Permissions card (falls back to appending after the link
        //        card if, for some reason, no permissions rows exist yet). ──
        if (!body.querySelector('#v41-media-card')) {
            var mediaCard = document.createElement('div');
            mediaCard.id = 'v41-media-card';
            mediaCard.style.cssText = 'background:#fff;border-bottom:8px solid #F0F0F0;padding:14px 0 16px;';
            mediaCard.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;padding:0 16px 10px;">' +
                '<span style="font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;">Media, links, and docs</span>' +
                '</div>' +
                '<div id="v41-media-strip" style="display:flex;gap:10px;overflow-x:auto;padding:0 16px 4px;scrollbar-width:thin;">' +
                '<div style="color:#9CA3AF;font-size:0.8rem;padding:20px 4px;">Loading\u2026</div></div>';
            if (permsCard && permsCard.parentElement) permsCard.parentElement.insertBefore(mediaCard, permsCard);
            else if (linkCard && linkCard.parentElement) linkCard.parentElement.insertBefore(mediaCard, linkCard.nextSibling);
            else body.appendChild(mediaCard);
        }

        // ── 3e. Settings list: Manage storage / Notifications / Media
        //        visibility / Encryption / Disappearing messages / Chat
        //        lock / Advanced chat privacy — inserted right after the
        //        media strip and before Permissions, so v14's own admin
        //        controls stay exactly where they were. ──
        if (!body.querySelector('#v41-settings-card')) {
            var lockKey = 'emp_group_chatlock_' + (gid || 'x');
            var lockOn = false;
            try { lockOn = localStorage.getItem(lockKey) === '1'; } catch (e) {}

            var settingsCard = document.createElement('div');
            settingsCard.id = 'v41-settings-card';
            settingsCard.style.cssText = 'background:#fff;border-bottom:8px solid #F0F0F0;';
            settingsCard.innerHTML =
                _settingsRow({ icon: 'folder', title: 'Manage storage', subtitle: '\u2014', key: 'storage', right: 'chevron', clickable: true }) +
                _settingsRow({ icon: 'bell', title: 'Notifications', subtitle: 'Highlights', key: 'notifications', right: 'chevron', clickable: true }) +
                _settingsRow({ icon: 'image', title: 'Media visibility', key: 'mediavis', right: 'chevron', clickable: true }) +
                '<div style="height:8px;background:#F7F7F8;"></div>' +
                _settingsRow({ icon: 'shieldLock', title: 'Encryption', subtitle: 'Messages and calls in this group are end-to-end encrypted. Tap to learn more.', key: 'encryption', right: 'chevron', clickable: true }) +
                _settingsRow({ icon: 'eyeOff', title: 'Disappearing messages', subtitle: 'Off', key: 'disappearing', right: 'chevron', clickable: true }) +
                _settingsRow({ icon: 'lock', title: 'Chat lock', subtitle: 'Lock and hide this group on this device.', key: 'chatlock', right: 'toggle', toggled: lockOn }) +
                _settingsRow({ icon: 'shieldLock', title: 'Advanced chat privacy', subtitle: 'Off', key: 'advprivacy', right: 'chevron', clickable: true });
            var mediaCardEl = body.querySelector('#v41-media-card');
            if (mediaCardEl && mediaCardEl.parentElement) mediaCardEl.parentElement.insertBefore(settingsCard, mediaCardEl.nextSibling);
            else body.appendChild(settingsCard);

            var toggle = settingsCard.querySelector('.v41-toggle[data-key="chatlock"]');
            if (toggle) toggle.addEventListener('click', function () {
                var on = toggle.style.background !== 'rgb(27, 43, 139)' && toggle.style.background !== '#1B2B8B';
                toggle.style.background = on ? '#1B2B8B' : '#D8DBE3';
                toggle.firstElementChild.style.left = on ? '18px' : '2px';
                try { localStorage.setItem(lockKey, on ? '1' : '0'); } catch (e) {}
                _notify(on ? 'This group is now locked on this device.' : 'Chat lock turned off.', 'info');
            });
            settingsCard.querySelectorAll('.v41-settings-row[data-row="encryption"], .v41-settings-row[data-row="storage"], .v41-settings-row[data-row="notifications"], .v41-settings-row[data-row="mediavis"], .v41-settings-row[data-row="disappearing"], .v41-settings-row[data-row="advprivacy"]').forEach(function (row) {
                row.addEventListener('click', function () { _notify('This setting is informational for now — full controls are coming soon.', 'info'); });
            });
        }

        // ── Populate media strip from real groups/{id}/messages ──
        var strip = body.querySelector('#v41-media-strip');
        if (strip && gid && _fbOk()) {
            window.fbDb.collection('groups').doc(gid).collection('messages')
                .orderBy('createdAt', 'desc').limit(60).get().then(function (snap) {
                    var items = [];
                    snap.forEach(function (doc) {
                        var d = doc.data() || {};
                        if (d.mediaUrl && (d.mediaType === 'image' || d.mediaType === 'video' || d.mediaType === 'audio')) items.push(d);
                    });
                    var storageBytes = items.length * 900000; // rough estimate for the "Manage storage" row only
                    var storageRow = body.querySelector('.v41-settings-row[data-row="storage"] .v41-row-subtitle');
                    if (storageRow) storageRow.textContent = _fmtBytes(storageBytes);

                    if (!items.length) {
                        strip.innerHTML = '<div style="color:#9CA3AF;font-size:0.8rem;padding:20px 4px;">No shared media yet.</div>';
                        return;
                    }
                    strip.innerHTML = items.slice(0, 20).map(function (d) {
                        if (d.mediaType === 'image') {
                            return '<img src="' + _esc(d.mediaUrl) + '" style="width:76px;height:76px;border-radius:10px;object-fit:cover;flex-shrink:0;cursor:pointer;" data-full="' + _esc(d.mediaUrl) + '">';
                        }
                        if (d.mediaType === 'video') {
                            return '<div style="width:76px;height:76px;border-radius:10px;background:#111;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;color:#fff;" data-full="' + _esc(d.mediaUrl) + '">' + svgIcon('video', 24) + '</div>';
                        }
                        return '<div style="width:76px;height:76px;border-radius:10px;background:#F5C518;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;color:#111;" data-full="' + _esc(d.mediaUrl) + '"><svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M12 3a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4z"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3"/></svg></div>';
                    }).join('');
                    strip.querySelectorAll('[data-full]').forEach(function (el) {
                        el.addEventListener('click', function () { window.open(el.dataset.full, '_blank'); });
                    });
                }).catch(function () {
                    strip.innerHTML = '<div style="color:#9CA3AF;font-size:0.8rem;padding:20px 4px;">Could not load media.</div>';
                });
        }

        log('Group info portal enhanced (Add to lists, media strip, settings list — premium icons and description are handled directly by app-patch-v14.js now).');
    }

    var _portalObserver = new MutationObserver(function () {
        var panel = document.getElementById('v14-portal');
        if (panel) _enhanceGroupPortal(panel);
    });
    _ready(function () { _portalObserver.observe(document.body, { childList: true, subtree: true }); });


    /* =========================================================================
       §4  CONTACT INFO — ENRICHED BIO (enhances #oc-profile-panel)
       ========================================================================= */
    function _mutualCount(theirFollowed) {
        try {
            var mine = _us().followedUserIds;
            var mineArr = mine instanceof Set ? Array.from(mine) : (Array.isArray(mine) ? mine : []);
            var theirs = Array.isArray(theirFollowed) ? theirFollowed : [];
            var theirSet = new Set(theirs);
            return mineArr.filter(function (id) { return theirSet.has(id); }).length;
        } catch (e) { return 0; }
    }

    function _enhanceContactInfo(panel) {
        if (panel.dataset.v41Enhanced === '1') return;
        var followersEl = panel.querySelector('#oc-profile-followers');
        if (!followersEl) return;
        panel.dataset.v41Enhanced = '1';

        var statsCard = followersEl.closest('div[style*="border-radius:20px"]');
        if (!statsCard) return;

        // ── Quick-action row: Message / Voice call / Video call ──
        if (!panel.querySelector('#v41-contact-actions')) {
            var actions = document.createElement('div');
            actions.id = 'v41-contact-actions';
            actions.style.cssText = 'display:flex;border-top:1px solid rgba(10,14,39,0.06);margin-top:2px;';
            [['message', 'Message'], ['phone', 'Voice'], ['video', 'Video']].forEach(function (pair) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.action = pair[0];
                btn.style.cssText = 'flex:1;background:none;border:none;padding:14px 4px 12px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;color:#1B2B8B;';
                btn.innerHTML = svgIcon(pair[0] === 'phone' ? 'phone' : pair[0], 19) + '<span style="font-size:0.72rem;font-weight:700;color:#374151;">' + pair[1] + '</span>';
                actions.appendChild(btn);
            });
            statsCard.appendChild(actions);

            actions.addEventListener('click', function (e) {
                var btn = e.target.closest('button[data-action]');
                if (!btn) return;
                var peerId = (panel.querySelector('.follow-btn') || {}).dataset && panel.querySelector('.follow-btn').dataset.userId;
                if (!peerId) { _notify('Open this from a chat to message or call.', 'info'); return; }
                if (btn.dataset.action === 'message') {
                    panel.remove();
                    if (typeof window.openChat === 'function') window.openChat(peerId);
                    return;
                }
                var isVideo = btn.dataset.action === 'video';
                if (typeof window.openChat === 'function') window.openChat(peerId);
                panel.remove();
                setTimeout(function () {
                    var sel = isVideo ? '.oc-header-btn[title="Video call"]' : '.oc-header-btn[title="Voice call"]';
                    var callBtn = document.querySelector('#oc-chat-header ' + sel) || document.querySelector(sel);
                    if (callBtn) callBtn.click();
                }, 400);
            });
        }

        // ── Mutual connections row + friendlier "Member Since" always shown ──
        if (_fbOk()) {
            var peerId = (panel.querySelector('.follow-btn') || {}).dataset && panel.querySelector('.follow-btn').dataset.userId;
            if (peerId) {
                window.fbDb.collection('users').doc(peerId).get().then(function (doc) {
                    if (!doc.exists) return;
                    var d = doc.data() || {};
                    var mutual = _mutualCount(d.followedUserIds);
                    var detailsCard = document.getElementById('oc-profile-details-card');
                    if (detailsCard && mutual > 0 && !panel.querySelector('#v41-mutual-row')) {
                        var row = document.createElement('div');
                        row.id = 'v41-mutual-row';
                        row.style.cssText = 'display:flex;align-items:flex-start;gap:14px;padding:13px 4px;border-bottom:1px solid rgba(10,14,39,0.06);';
                        row.innerHTML = '<div style="width:34px;height:34px;border-radius:10px;background:rgba(27,43,139,0.08);color:#1B2B8B;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + svgIcon('users2', 16) + '</div>' +
                            '<div><div style="font-size:0.68rem;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:#9CA3AF;">Mutual connections</div>' +
                            '<div style="font-size:0.92rem;color:#111827;margin-top:2px;">' + mutual + ' in common</div></div>';
                        detailsCard.insertBefore(row, detailsCard.firstChild);
                        detailsCard.style.display = 'block';
                    }

                    // Friendlier bio fallback instead of the card just staying hidden.
                    var bioCard = document.getElementById('oc-profile-bio-card');
                    if (bioCard && bioCard.style.display === 'none') {
                        bioCard.style.display = 'block';
                        bioCard.style.color = '#9CA3AF';
                        bioCard.style.fontStyle = 'italic';
                        bioCard.textContent = 'No bio yet.';
                    }
                }).catch(function () {});
            }
        }
    }

    var _contactInfoObserver = new MutationObserver(function () {
        var panel = document.getElementById('oc-profile-panel');
        if (panel) _enhanceContactInfo(panel);
    });
    _ready(function () { _contactInfoObserver.observe(document.body, { childList: true, subtree: true }); });


    /* =========================================================================
       §5  CONTACT LIST — BIO SNIPPET on 1:1 chat rows
       ========================================================================= */
    function _bioSnippetHtml(u) {
        var bits = [];
        if (u.profession) bits.push(_esc(u.profession));
        else if (u.bio) bits.push(_esc(u.bio.length > 42 ? u.bio.slice(0, 42) + '\u2026' : u.bio));
        if (!bits.length) return '';
        var verified = u.isVerified
            ? '<span style="color:#1B2B8B;display:inline-flex;">' + svgIcon('badge', 11, 2.4) + '</span> '
            : '';
        return '<div class="v41-contact-bio" style="font-size:0.72rem;color:#9CA3AF;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:3px;">' +
            verified + bits.join(' \u00b7 ') + '</div>';
    }

    function _enhanceContactRow(row) {
        if (row.dataset.v41Bio === '1') return;
        var uid = row.dataset.userId;
        var mu = window.mockUsers || {};
        var u = mu[uid];
        if (!u) return;
        var html = _bioSnippetHtml(u);
        if (!html) { row.dataset.v41Bio = '1'; return; }
        var infoBlock = row.querySelector('div[style*="flex:1;min-width:0;"]');
        if (!infoBlock) return;
        row.dataset.v41Bio = '1';
        infoBlock.insertAdjacentHTML('beforeend', html);
    }

    var _contactListObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes && m.addedNodes.forEach(function (node) {
                if (node.nodeType !== 1) return;
                if (node.classList && node.classList.contains('contact-item')) _enhanceContactRow(node);
                else if (node.querySelectorAll) node.querySelectorAll('.contact-item').forEach(_enhanceContactRow);
            });
        });
    });
    function _bootContactListObserver() {
        var inner = document.getElementById('contacts-inner');
        if (!inner) { setTimeout(_bootContactListObserver, 500); return; }
        inner.querySelectorAll('.contact-item').forEach(_enhanceContactRow);
        _contactListObserver.observe(inner, { childList: true });
    }
    _ready(function () { setTimeout(_bootContactListObserver, 500); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_bootContactListObserver, 300); });

    /* =========================================================================
       §6  COMPOSER TEXT FORMATTING TOOLBAR  (see header block for full notes)
       ========================================================================= */
    var FMT_ACTIONS = [
        { label: 'B',   title: 'Bold',          mark: '*',  weight: '700', style: '' },
        { label: 'I',   title: 'Italic',        mark: '_',  weight: '400', style: 'font-style:italic;' },
        { label: 'U',   title: 'Underline',     mark: '__', weight: '400', style: 'text-decoration:underline;' },
        { label: 'S',   title: 'Strikethrough', mark: '~',  weight: '400', style: 'text-decoration:line-through;' },
        { label: '</>', title: 'Monospace',     mark: '`',  weight: '400', style: 'font-family:monospace;font-size:0.78rem;' }
    ];

    /* Wraps the current selection in `mark…mark`, or un-wraps it if the
       selection is already exactly wrapped in that mark (toggle behavior).
       Re-selects the (un)wrapped text afterward and fires a synthetic
       'input' event so app-patch-openchat.js's own listeners (textarea
       auto-grow height, mic↔send button swap) still run correctly. */
    function _wrapOrUnwrapSelection(ta, mark) {
        var start = ta.selectionStart, end = ta.selectionEnd;
        if (start === end) return;
        var val = ta.value;
        var selected = val.slice(start, end);
        var before = val.slice(0, start);
        var after = val.slice(end);
        var already = selected.length > mark.length * 2 &&
            selected.slice(0, mark.length) === mark &&
            selected.slice(-mark.length) === mark;
        var next = already ? selected.slice(mark.length, selected.length - mark.length) : (mark + selected + mark);
        ta.value = before + next + after;
        ta.focus();
        ta.setSelectionRange(start, start + next.length);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function _buildFmtToolbar(ta) {
        var bar = document.createElement('div');
        bar.className = 'v41-fmt-toolbar';
        bar.style.cssText = 'display:none;align-items:center;gap:6px;padding:7px 10px;background:#EEF0FB;' +
            'border-top:2px solid #1B2B8B;box-shadow:0 2px 6px rgba(27,43,139,0.12);flex-shrink:0;position:relative;z-index:5;';
        FMT_ACTIONS.forEach(function (f) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.title = f.title;
            btn.textContent = f.label;
            btn.style.cssText = 'min-width:30px;height:30px;padding:0 8px;border-radius:7px;border:none;' +
                'background:#fff;color:#1B2B8B;font-size:0.8rem;font-weight:' + f.weight + ';box-shadow:0 1px 2px rgba(0,0,0,0.08);' + f.style;
            /* mousedown/touchstart (not click), preventDefault'd — tapping
               a button normally blurs the textarea first, which collapses
               selectionStart/End to the same value before a click handler
               ever runs. Firing on the earlier event, before blur lands,
               is what keeps the real selection available to wrap. */
            function _run(e) { e.preventDefault(); _wrapOrUnwrapSelection(ta, f.mark); }
            btn.addEventListener('mousedown', _run);
            btn.addEventListener('touchstart', _run, { passive: false });
            bar.appendChild(btn);
        });
        return bar;
    }

    function _wireFmtToolbar(ta) {
        if (!ta || ta.dataset.v41FmtWired === '1') return;
        ta.dataset.v41FmtWired = '1';
        var bar = _buildFmtToolbar(ta);
        /* FIX (feedback: "the normal toolbar is black — the one you
           created" / custom toolbar getting visually buried): the
           Android/Opera Mini native selection bubble (Cut/Copy/Paste/⋮)
           is OS chrome, not part of the page — it always renders above
           every other layer no matter what z-index this bar uses, and it
           anchors right next to the selection, which for a short 1-3 line
           composer is usually near the TOP of the textarea. Placing our
           bar above the composer (the original v41 layout) put it in
           that exact same screen area, so the native bubble was landing
           on top of it and only a sliver of our buttons peeked out —
           which is what looked like "the toolbar is black". Moving it
           BELOW the whole composer row instead (still inside
           #oc-composer-wrap, right under #oc-composer) keeps it out of
           that collision zone in the common case. It can't be a 100%
           guarantee — Android is free to draw its bubble below the
           selection if there isn't room above — but this is the
           placement least likely to overlap for a typical short message.
           NOTE: there is no web API that can add buttons into that native
           Cut/Copy/Paste bubble itself — it's owned entirely by the OS/
           browser, not the page, so it can't be extended or restyled
           from here. This toolbar is the closest achievable equivalent:
           a separate control that appears whenever text is selected. */
        var wrapCol = document.getElementById('oc-composer-wrap');
        var composerRow = document.getElementById('oc-composer');
        if (ta.id === 'oc-text-input' && wrapCol && composerRow && composerRow.parentNode === wrapCol) {
            if (composerRow.nextSibling) wrapCol.insertBefore(bar, composerRow.nextSibling);
            else wrapCol.appendChild(bar);
        } else if (ta.nextSibling) {
            ta.parentNode.insertBefore(bar, ta.nextSibling);
        } else if (ta.parentNode) {
            ta.parentNode.appendChild(bar);
        }

        function _sync() {
            var active = document.activeElement === ta && ta.selectionStart !== ta.selectionEnd;
            bar.style.display = active ? 'flex' : 'none';
        }
        document.addEventListener('selectionchange', _sync);
        ta.addEventListener('keyup', _sync);
        ta.addEventListener('mouseup', _sync);
        ta.addEventListener('touchend', function () { setTimeout(_sync, 30); });
        /* Keep the bar up through the blur a toolbar-button tap causes, but
           hide it once focus has genuinely moved elsewhere. */
        ta.addEventListener('blur', function () {
            setTimeout(function () { if (document.activeElement !== ta) bar.style.display = 'none'; }, 150);
        });
    }

    /* =========================================================================
       §6b  AUTO-CONTINUING NUMBERED / BULLETED LISTS
       Requested: "once a user types the first number [e.g. '1. '] and
       presses Enter (or the blue arrow/Go key on the Android keyboard),
       it should automatically number 2, 3, 4… as they keep writing" —
       same convention WhatsApp/Notion use. Pressing Enter on an EMPTY list
       line (marker with nothing typed after it) ends the list instead of
       continuing it, same as those apps.

       Implemented via 'beforeinput' with inputType 'insertLineBreak',
       rather than a keydown handler — app-patch-openchat.js's own comments
       already document that the Android keyboard's Enter/Go key doesn't
       reliably dispatch a keydown Enter event, but every browser that can
       run this app dispatches 'beforeinput' for a real newline regardless
       of whether it came from a physical Enter key or a virtual keyboard's
       action button. It only ever fires when a newline is actually about
       to be inserted, so it can't interfere with the existing send-on-
       Enter (desktop, no Shift) logic in app-patch-openchat.js — that
       handler already calls preventDefault() and sends before a newline
       would ever be inserted, so 'beforeinput' never fires for that case. */
    var NUM_MARKER_RE    = /^(\s*)(\d+)([.)])[ \t]+/;
    var BULLET_MARKER_RE = /^(\s*)([-*\u2022])[ \t]+/;

    function _currentLineBeforeCaret(ta) {
        var pos = ta.selectionStart;
        var val = ta.value;
        var lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        return { lineStart: lineStart, line: val.slice(lineStart, pos), pos: pos };
    }

    function _wireListContinuation(ta) {
        if (!ta || ta.dataset.v41ListWired === '1') return;
        ta.dataset.v41ListWired = '1';
        ta.addEventListener('beforeinput', function (e) {
            var isNewline = e.inputType === 'insertLineBreak' ||
                (e.inputType === 'insertText' && e.data === '\n');
            if (!isNewline) return;

            var info = _currentLineBeforeCaret(ta);
            var numMatch = info.line.match(NUM_MARKER_RE);
            var bulletMatch = !numMatch ? info.line.match(BULLET_MARKER_RE) : null;
            if (!numMatch && !bulletMatch) return; /* not in a list — let the newline happen normally */

            e.preventDefault();
            var marker = numMatch || bulletMatch;
            var indent = marker[1];
            var contentAfterMarker = info.line.slice(marker[0].length);
            var val = ta.value;
            var after = val.slice(info.pos);

            if (contentAfterMarker.trim() === '') {
                /* Empty list item + Enter = end the list: strip the bare
                   marker line and drop to a clean new line, cursor there. */
                var beforeLine = val.slice(0, info.lineStart);
                ta.value = beforeLine + '\n' + after;
                var pos1 = beforeLine.length + 1;
                ta.setSelectionRange(pos1, pos1);
            } else {
                var nextMarker = numMatch
                    ? indent + (parseInt(numMatch[2], 10) + 1) + numMatch[3] + ' '
                    : indent + bulletMatch[2] + ' ';
                var before = val.slice(0, info.pos);
                ta.value = before + '\n' + nextMarker + after;
                var pos2 = before.length + 1 + nextMarker.length;
                ta.setSelectionRange(pos2, pos2);
            }
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    function _scanForComposerInputs(root) {
        if (!root || root.nodeType !== 1 || !root.querySelectorAll) return;
        if (root.id === 'oc-text-input' || root.id === 'oc-edit-textarea') { _wireFmtToolbar(root); _wireListContinuation(root); return; }
        var t1 = root.querySelector('#oc-text-input');
        if (t1) { _wireFmtToolbar(t1); _wireListContinuation(t1); }
        var t2 = root.querySelector('#oc-edit-textarea');
        if (t2) { _wireFmtToolbar(t2); _wireListContinuation(t2); }
    }

    _ready(function () {
        _scanForComposerInputs(document.body);
        var fmtObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes && m.addedNodes.forEach(function (node) { _scanForComposerInputs(node); });
            });
        });
        fmtObserver.observe(document.body, { childList: true, subtree: true });
    });

    /* =========================================================================
       §7  LINK THUMBNAIL CARDS (2026-10-03)
       Report: pasting an Empyrean / Facebook / Instagram / X link into a
       public feed post only highlighted it and made it tappable — no
       thumbnail card like WhatsApp/Facebook build. §1's _richFormatText
       now leaves an empty .emp-linkcard-ph placeholder after the first
       plain link in a post; this fills it in. The card data comes from
       server.js's /api/link-preview (the browser can't read another
       site's Open Graph tags itself — CORS). Everything shown is written
       with textContent / property assignment, never innerHTML, since the
       title/description/image come from a third-party page.
       ========================================================================= */
    (function linkCardHydrator() {
        if (window._empLinkCardHydrator) return;
        window._empLinkCardHydrator = true;

        var BODY_SEL = '.story-content, .news-item-content';
        var _mem = {};        // url -> data | false (failed)
        var _inflight = {};   // url -> Promise

        function _apiBase() {
            try { return (typeof window._empApiBase === 'function') ? window._empApiBase() : ''; } catch (e) { return ''; }
        }

        function _fetchPreview(url) {
            if (_mem.hasOwnProperty(url)) return Promise.resolve(_mem[url]);
            try {
                var raw = sessionStorage.getItem('emp_lp1:' + url);
                if (raw) { var o = JSON.parse(raw); _mem[url] = o; return Promise.resolve(o); }
            } catch (e) {}
            if (_inflight[url]) return _inflight[url];
            _inflight[url] = fetch(_apiBase() + '/api/link-preview?url=' + encodeURIComponent(url))
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    var ok = d && d.ok && (d.title || d.image) ? d : false;
                    _mem[url] = ok;
                    try { if (ok) sessionStorage.setItem('emp_lp1:' + url, JSON.stringify(ok)); } catch (e) {}
                    return ok;
                })
                .catch(function () { return false; })   // network/server issue: no card, link stays a normal link
                .then(function (v) { delete _inflight[url]; return v; });
            return _inflight[url];
        }

        function _buildCard(d) {
            var a = document.createElement('a');
            a.className = 'emp-linkcard';
            a.href = d.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'display:block;margin:10px 0 4px;border:1px solid rgba(10,14,39,0.12);' +
                'border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;background:#fff;' +
                'max-width:520px;box-shadow:0 1px 3px rgba(10,14,39,0.06);';
            a.addEventListener('click', function (e) { e.stopPropagation(); });

            if (d.image) {
                var wrap = document.createElement('div');
                wrap.style.cssText = 'width:100%;aspect-ratio:1.91/1;background:#eef0f6;overflow:hidden;';
                var img = document.createElement('img');
                img.loading = 'lazy';
                img.alt = '';
                img.referrerPolicy = 'no-referrer'; // Facebook/Instagram CDNs often refuse hotlinks with a referrer
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                img.onerror = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
                img.src = d.image;
                wrap.appendChild(img);
                a.appendChild(wrap);
            }

            var body = document.createElement('div');
            body.style.cssText = 'padding:10px 12px;';
            var dom = document.createElement('div');
            dom.textContent = (d.siteName || d.domain || '').toUpperCase();
            dom.style.cssText = 'font-size:0.68rem;letter-spacing:0.04em;color:#6b7280;margin-bottom:2px;' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            body.appendChild(dom);
            if (d.title) {
                var ti = document.createElement('div');
                ti.textContent = d.title;
                ti.style.cssText = 'font-weight:700;font-size:0.92rem;line-height:1.3;color:#111827;' +
                    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
                body.appendChild(ti);
            }
            if (d.description) {
                var de = document.createElement('div');
                de.textContent = d.description;
                de.style.cssText = 'font-size:0.8rem;line-height:1.35;color:#4b5563;margin-top:3px;' +
                    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
                body.appendChild(de);
            }
            a.appendChild(body);
            return a;
        }

        /* FIX (2026-10-04): once the thumbnail card exists, the raw URL it was
           built from is redundant (and was overflowing). Hide just that link --
           _cardMarker places the placeholder directly after its <a> -- and, if
           the paragraph is left with nothing but stray punctuation (e.g. a
           leading "-"), hide the paragraph too so no empty gap/dash remains.
           Display-only: the stored post text is untouched, and the card itself
           links to the same URL. Any surrounding sentence text is kept. */
        function _hideCardLink(ph) {
            var a = ph.previousElementSibling;
            if (!a || a.tagName !== 'A') return;
            a.style.display = 'none';
            var p = ph.closest('p');
            if (!p) return;
            var rest = '';
            for (var n = p.firstChild; n; n = n.nextSibling) {
                if (n === a || n === ph) continue;
                rest += n.textContent || '';
            }
            if (/^[\s\-\u2013\u2014\u2022:|\u00b7]*$/.test(rest)) p.style.display = 'none';
        }

        function _hydrate(ph) {
            if (!ph || ph.dataset.lpDone) return;
            ph.dataset.lpDone = '1';
            var url = ph.dataset.url;
            if (!url) return;
            _fetchPreview(url).then(function (d) {
                if (!d || !ph.isConnected) return;
                var host = ph.closest('p') || ph;
                var next = host.nextElementSibling;
                if (next && next.classList && next.classList.contains('emp-linkcard')) return; // already has one
                if (!host.parentNode) return;
                host.parentNode.insertBefore(_buildCard(d), host.nextSibling);
                _hideCardLink(ph);
            });
        }

        function _scan(root) {
            var scope = (root && root.querySelectorAll) ? root : document;
            var list = scope.querySelectorAll('.emp-linkcard-ph:not([data-lp-seen])');
            for (var i = 0; i < list.length; i++) {
                var ph = list[i];
                ph.setAttribute('data-lp-seen', '1');
                if (!ph.closest(BODY_SEL)) continue;   // chat / comment / etc. — leave inert
                if (_ioEl) {
                    // The placeholder itself is display:none (can't intersect),
                    // so watch its visible parent paragraph instead.
                    var watch = ph.closest('p') || ph.parentNode;
                    if (watch) {
                        watch._empLpPh = (watch._empLpPh || []);
                        watch._empLpPh.push(ph);
                        _ioWatch(watch);
                    }
                } else {
                    _hydrate(ph);
                }
            }
        }

        var _watched = typeof WeakSet === 'function' ? new WeakSet() : null;
        function _ioWatch(el) {
            if (_watched) { if (_watched.has(el)) return; _watched.add(el); }
            if (!el._empLpObs) {
                el._empLpObs = true;
                _ioEl.observe(el);
            }
        }
        var _ioEl = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                _ioEl.unobserve(en.target);
                (en.target._empLpPh || []).forEach(_hydrate);
            });
        }, { rootMargin: '400px 0px' }) : null;

        var _timer = null;
        function _schedule() {
            if (_timer) return;
            _timer = setTimeout(function () { _timer = null; _scan(document); }, 200);
        }

        _ready(function () {
            _scan(document);
            new MutationObserver(function (muts) {
                for (var i = 0; i < muts.length; i++) {
                    if (muts[i].addedNodes && muts[i].addedNodes.length) { _schedule(); return; }
                }
            }).observe(document.body, { childList: true, subtree: true });
        });
    })();

    console.log('[EmpyreanPatchV41] \u2705 Rich text formatting, calls-log new-tab group join, premium group header, enriched contact info/list, composer formatting toolbar, and auto-continuing lists installed \u2014 no existing file edited.');

})();