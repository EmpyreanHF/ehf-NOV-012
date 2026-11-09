/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v32
   app-patch-v32.js  |  Load LAST (after app-patch-v31.js)

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #1 — "Add bio data to the live streaming host preview card"
   ═══════════════════════════════════════════════════════════════════════
   app-live-tiktok-patch.js's openHostPreviewModal() (the sheet that opens
   when a viewer taps the host avatar/name in the live header) already
   renders Follow / Message, followers/following counts, and a Bio/
   Profession/Location block. Requested additions, layered on WITHOUT
   touching that function's own innerHTML build (wrapped, not replaced —
   composes with it the same way v29 wraps openGiftCatalog):
     - Likes added to the stats line (Followers | Likes | Following) —
       total lifetime likes, read from whatever field already holds it
       on the account, never a fabricated number.
     - 📍 pin in front of the existing Location row.
     - 🔗 Copy Link button next to the existing Follow/Message buttons.
     - 🌐 Website — public, shown to any viewer.
     - 📞 Phone / 📧 Email — OPT-IN, OWNER-CONTROLLED (2026-07-16 update
       per explicit request): hidden from viewers by default. Two new
       Firestore fields on the user doc, `showPhoneToViewers` /
       `showEmailToViewers` (booleans, default false/absent = hidden),
       gate whether a viewer sees them at all. When viewing your OWN
       preview card (isMe), you always see your own phone/email (if set)
       PLUS a toggle switch right there to turn viewer-visibility on/off
       — writes straight to your Firestore user doc via
       fbDb.collection('users').doc(uid).update(...), the same call
       pattern app-fixes.js already uses for every other profile-field
       save, so it isn't a second, competing way of persisting profile
       data. If the field is unset (never toggled), it defaults to
       hidden — an account never becomes newly exposed just because this
       patch shipped.
     - ⭐ "Exclusive content — tap the link" banner, shown only when a
       website is actually on record, linking to it.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #2 — "Avatar only responds to tap once, then stops working"
   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE: openHostPreviewModal() ends with
   `modal.classList.add('show')` — it never clears a stale inline
   `display:none` first. This is the exact same bug shape v29's header
   already diagnosed and fixed for the gift-catalog modal: an inline
   style always beats the `.live-sub-modal.show{display:flex}` CSS rule,
   so the very first close that leaves that inline style behind makes
   every later `.classList.add('show')` a no-op visually — tap keeps
   "working" (class gets added, confirmed the same way v29 confirmed it
   for the gift modal) but nothing ever shows again. The host-preview
   modal just wasn't covered by v29's fix (that one only wrapped
   window.openGiftCatalog).

   FIX: wrap window.openHostPreviewModal with the same one-line cleanup,
   applied to #live-host-preview-modal specifically, right before/after
   the original runs. No duplicate rendering logic — this only closes the
   same gap v29 already closed for a different modal.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #3 (2026-07-16 addition) — redesign mic / camera / "return back"
   (exit-guest-slot) buttons to match the reference call-UI screenshot
   ═══════════════════════════════════════════════════════════════════════
   Requested look: a plain dark, semi-transparent circle with a white icon
   for mic/camera (matches the reference screenshot's mute button), and a
   solid red circle with a white hang-up-style icon for the "return back"
   control (matches the reference screenshot's red decline/end-call
   button).

   Pure presentation change — CSS only for the mic/camera buttons
   (#live-mic-toggle, #live-video-toggle), plus a one-line icon swap for
   the exit button (#tk-exit-guest-btn) so it reads as "leave/hang up"
   rather than the generic sign-out glyph it had. Nothing about WHEN these
   buttons show, what they're wired to, or their ids/classes changes —
   app-live.js's mic/camera Agora handlers and app-live-tiktok-patch.js's
   exitGuestSlot() (both keyed off these same ids/classes via
   e.target.closest(...)) are completely untouched, so this can't disrupt
   anything currently working. Added here per explicit instruction to keep
   it inside this same patch rather than opening a new one.

   NOTE: #live-mic-toggle / #live-video-toggle are the same two buttons
   app-live-final.js already documents as shared between host and
   accepted-guest-broadcaster (the host control panel is shown to both,
   per its own "guest video and voice panel" fix) — so this new look
   applies to both host and guest, not guest-only. That's a byproduct of
   there being exactly one button per control already, not a new
   host/guest split introduced here.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #3, rev.2 (2026-07-16) — premium custom icon set replaces the
   plain Font Awesome glyphs; also now covers the guest's own self-preview
   box (.emp-self-mic-btn / .emp-self-cam-btn from app-live-final.js), not
   just the shared host-control-panel buttons
   ═══════════════════════════════════════════════════════════════════════
   Two reference images were supplied (a muted-mic glyph, a camera glyph)
   purely as a STYLE reference — not to be embedded as photos/raster
   files. Rasterizing a 1024×1024 photo down to a ~22px button icon would
   look soft/blurry at that size, so instead this draws crisp, original,
   vector (SVG) icons in the same premium spirit: bold white glyph, dark
   glass badge, both mic and camera rendered in the same plain white so
   neither one draws more visual weight than the other ("maintain
   balance" — no gold/blue/colour accents on the camera glyph).

   HOW THIS AVOIDS BREAKING ANYTHING ALREADY WORKING: the original
   `<i class="fas fa-microphone">` / `fa-video` elements are left FULLY
   INTACT in the DOM — only `visibility:hidden` is added to them. That
   matters because several other files determine mic/camera on-off state
   by reading these buttons' innerHTML/class list as plain text:
     - app-live-final.js's _syncSelfControlIcons() does
       `micToggle.innerHTML.indexOf('fa-microphone-slash')`
     - this same file's own §4 below does
       `mic.querySelector('.fa-microphone-slash')`
   Deleting or replacing that class would silently break both. Instead,
   the real SVG glyph is painted via a `::before` pseudo-element with a
   data-URI background-image, keyed off the very same `.pv32-off` class
   §4 already maintains — so the underlying FA class stays exactly where
   every other file expects to find it, and only the pixels on screen
   change. Zero markup, ids, classes (other than the additive
   `.pv32-off`/`.pv32-self-off` flags this patch already owned), or click
   wiring touched in app-live.js / app-live-tiktok-patch.js /
   app-live-final.js.
   ============================================================================= */

(function empyreanPatchV32() {
    'use strict';

    if (window._empPatchV32Loaded) {
        console.warn('[V32] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV32Loaded = true;

    function log(msg) { console.log('[V32] ' + msg); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmt(n) {
        n = Number(n) || 0;
        try { return n.toLocaleString(); } catch (e) { return String(n); }
    }

    /* =========================================================================
       §1 — bio data: appended after the original modal build runs, plus
       the same stale-inline-display cleanup v29 proved correct for the
       gift catalog, applied here to #live-host-preview-modal.
       ========================================================================= */
    function enhanceHostPreviewModal(hostId) {
        var modal = document.getElementById('live-host-preview-modal');
        if (!modal) return;

        // FIX (avatar-tap-once bug — see header): clear any stale inline
        // display left behind by a prior close, so the CSS .show rule
        // governs visibility again on every open, not just the first.
        modal.style.removeProperty('display');

        var mu = (typeof window.mockUsers === 'object' && window.mockUsers) || {};
        var us = window.userState || {};
        var user = mu[hostId] || {};
        var isMe = !!us.id && hostId === us.id;

        // Likes total — only ever read from an existing field, never
        // invented. Checks the couple of field names this codebase has
        // used elsewhere for a lifetime total.
        var likesRaw = user.totalLikes != null ? user.totalLikes
            : (user.likesCount != null ? user.likesCount
                : (user.likeCount != null ? user.likeCount : null));

        var followerCount = user.followerCount || 0;
        var followingCount = (user.followedUserIds && user.followedUserIds.size) || 0;

        // ── Rebuild the stats line to add Likes, if we have a real value ──
        var statsEl = modal.querySelector('#tk-hp-following-toggle');
        if (statsEl && likesRaw != null) {
            var statsRow = statsEl.parentElement;
            if (statsRow && !statsRow.querySelector('.pv32-likes-stat')) {
                var likesSpan = document.createElement('span');
                likesSpan.className = 'pv32-likes-stat';
                likesSpan.textContent = fmt(likesRaw) + ' likes';
                statsRow.insertBefore(likesSpan, statsEl);
            }
        }

        // ── 📍 pin in front of the existing Location row's value ──
        var bioBlock = modal.querySelector('div[style*="overflow-y:auto"][style*="flex:1"]');
        if (bioBlock) {
            var rows = bioBlock.querySelectorAll('span');
            rows.forEach(function (labelSpan) {
                if (labelSpan.textContent.trim().toUpperCase() === 'LOCATION') {
                    var valEl = labelSpan.nextElementSibling;
                    if (valEl && valEl.textContent.indexOf('\uD83D\uDCCD') !== 0) {
                        valEl.textContent = '\uD83D\uDCCD ' + valEl.textContent;
                    }
                }
            });
        }

        // ── Extra bio panel: Copy Link, Website (public), Phone/Email
        //    (owner-only), CTA banner. Rebuilt fresh every open since the
        //    whole modal's innerHTML is rebuilt fresh every open too. ──
        var extra = document.createElement('div');
        extra.id = 'pv32-extra-bio';

        var rowsHTML = '';
        if (user.website) {
            rowsHTML += '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">'
                + '<span style="font-size:0.68rem;color:#aaa;text-transform:uppercase;letter-spacing:0.4px;">Website</span>'
                + '<div style="font-size:0.9rem;"><a href="' + esc(user.website) + '" target="_blank" rel="noopener" style="color:#F5C518;">\uD83C\uDF10 ' + esc(user.website) + '</a></div></div>';
        }
        // Phone/Email — opt-in, owner-controlled. See header comment.
        // Viewers only ever see these if the owner has explicitly turned
        // visibility on (default: hidden). The owner always sees their
        // own values on their own card, plus a toggle to control what
        // viewers see.
        function contactRow(kind, icon, label, value, visibleToViewers) {
            var toggleHTML = isMe
                ? '<label class="pv32-contact-toggle" style="display:flex;align-items:center;gap:6px;font-size:0.68rem;color:#aaa;cursor:pointer;user-select:none;">'
                    + '<input type="checkbox" class="pv32-contact-toggle-input" data-kind="' + kind + '" data-host-id="' + esc(hostId) + '" ' + (visibleToViewers ? 'checked' : '') + ' style="accent-color:#F5C518;">'
                    + 'Visible to viewers</label>'
                : '';
            return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:10px;">'
                + '<div style="min-width:0;"><span style="font-size:0.68rem;color:#aaa;text-transform:uppercase;letter-spacing:0.4px;">' + label + '</span>'
                + '<div style="font-size:0.9rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + icon + ' ' + esc(value) + '</div></div>'
                + toggleHTML + '</div>';
        }

        var phoneVisible = !!user.showPhoneToViewers;
        var emailVisible = !!user.showEmailToViewers;

        if (user.phone && (isMe || phoneVisible)) {
            rowsHTML += contactRow('phone', '\uD83D\uDCDE', 'Phone', user.phone, phoneVisible);
        }
        if (user.email && (isMe || emailVisible)) {
            rowsHTML += contactRow('email', '\uD83D\uDCE7', 'Email', user.email, emailVisible);
        }

        var ctaHTML = '';
        if (user.website) {
            ctaHTML = '<a href="' + esc(user.website) + '" target="_blank" rel="noopener" style="display:block;margin-top:10px;padding:10px 12px;border-radius:10px;background:linear-gradient(90deg,#F5C518,#f7a600);color:#1a1a1a;font-weight:700;font-size:0.82rem;text-align:center;text-decoration:none;">'
                + '\u2B50\uFE0F Exclusive Content &amp; Updates \u2192 Tap Here \u2B07\uFE0F</a>';
        }

        extra.innerHTML = rowsHTML + ctaHTML;

        // Copy Link button — inserted into the existing Follow/Message row
        // when it exists (viewer looking at someone else); otherwise placed
        // on its own for the isMe case (Follow/Message row doesn't render
        // for your own preview).
        var actionsRow = null;
        var followBtn = modal.querySelector('.follow-btn');
        if (followBtn && followBtn.parentElement) actionsRow = followBtn.parentElement;

        if (!modal.querySelector('#pv32-copy-link-btn')) {
            var copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.id = 'pv32-copy-link-btn';
            copyBtn.dataset.hostId = hostId;
            copyBtn.className = 'btn btn-small';
            copyBtn.style.cssText = 'flex:1;background:#3c3c42;color:#fff;';
            copyBtn.innerHTML = '\uD83D\uDD17 Copy Link';
            if (actionsRow) {
                actionsRow.appendChild(copyBtn);
            } else {
                var wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;gap:10px;margin-bottom:12px;';
                wrap.appendChild(copyBtn);
                modal.insertBefore(wrap, extra);
            }
        }

        modal.appendChild(extra);
    }

    function wrapOpenHostPreviewModal() {
        var orig = window.openHostPreviewModal;
        if (typeof orig !== 'function' || orig._pv32Wrapped) return;
        var wrapped = function (hostId) {
            var result = orig.apply(this, arguments);
            try { enhanceHostPreviewModal(hostId); } catch (e) { console.warn('[V32] enhanceHostPreviewModal failed:', e); }
            return result;
        };
        wrapped._pv32Wrapped = true;
        window.openHostPreviewModal = wrapped;
        log('wrapped window.openHostPreviewModal — bio data extended + stale inline display cleared on every open.');
    }
    wrapOpenHostPreviewModal();
    setTimeout(wrapOpenHostPreviewModal, 500);
    setTimeout(wrapOpenHostPreviewModal, 1500);
    document.addEventListener('empyrean-init-done', function () { setTimeout(wrapOpenHostPreviewModal, 200); });

    /* =========================================================================
       §1b — owner toggle: persists showPhoneToViewers / showEmailToViewers
       straight to the user's own Firestore doc, the same
       fbDb.collection('users').doc(uid).update(...) pattern app-fixes.js
       already uses for every other profile-field save (e.g. the
       followedUserIds sync in app-fix-final.js). Also updates the local
       mockUsers/userState copy immediately so the switch doesn't visually
       revert before the network call resolves, and reverts it back if the
       write actually fails.
       ========================================================================= */
    document.addEventListener('change', function (e) {
        var input = e.target && e.target.closest && e.target.closest('.pv32-contact-toggle-input');
        if (!input) return;
        var kind = input.dataset.kind; // 'phone' | 'email'
        var hostId = input.dataset.hostId;
        var field = kind === 'phone' ? 'showPhoneToViewers' : 'showEmailToViewers';
        var newVal = !!input.checked;

        var mu = (typeof window.mockUsers === 'object' && window.mockUsers) || {};
        if (mu[hostId]) mu[hostId][field] = newVal;
        if (window.userState && window.userState.id === hostId) window.userState[field] = newVal;

        function revert(msg) {
            input.checked = !newVal;
            if (mu[hostId]) mu[hostId][field] = !newVal;
            if (window.userState && window.userState.id === hostId) window.userState[field] = !newVal;
            if (typeof window.showNotification === 'function') window.showNotification(msg || 'Could not save that setting.', 'error');
        }

        if (!window.fbDb || !window._firebaseLoaded || !hostId) {
            revert('Not connected — try again in a moment.');
            return;
        }
        var payload = {};
        payload[field] = newVal;
        window.fbDb.collection('users').doc(hostId).update(payload).then(function () {
            log('saved ' + field + ' = ' + newVal + ' for ' + hostId + '.');
            if (typeof window.showNotification === 'function') {
                window.showNotification(newVal ? 'Viewers can now see your ' + kind + '.' : 'Your ' + kind + ' is hidden from viewers again.', 'success');
            }
        }).catch(function (err) {
            console.warn('[V32] failed to save ' + field + ':', err);
            revert();
        });
    }, true);

    /* =========================================================================
       §2 — Copy Link + diagnostics. Read-only-safe: never stopPropagation
       on the avatar tap itself, so the existing handler in
       app-live-tiktok-patch.js (which already owns opening the modal) is
       untouched — this only adds the one control that was missing.
       ========================================================================= */
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;

        var copyBtn = e.target.closest('#pv32-copy-link-btn');
        if (copyBtn) {
            e.stopPropagation();
            e.preventDefault();
            var hostId = copyBtn.dataset.hostId || '';
            var mu = (typeof window.mockUsers === 'object' && window.mockUsers) || {};
            var user = mu[hostId] || {};
            var link = (user.username ? (location.origin + location.pathname + '#profile/' + user.username) : location.href);
            var done = function () {
                if (typeof notify === 'function') notify('Link copied.', 'success');
                else if (typeof window.showNotification === 'function') window.showNotification('Link copied.', 'success');
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(done).catch(function () {
                    if (typeof window.showNotification === 'function') window.showNotification('Could not copy link.', 'error');
                });
            } else {
                try {
                    var ta = document.createElement('textarea');
                    ta.value = link;
                    ta.style.cssText = 'position:fixed;opacity:0;top:-9999px;';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    done();
                } catch (e2) {
                    if (typeof window.showNotification === 'function') window.showNotification('Could not copy link.', 'error');
                }
            }
            return;
        }

        // Diagnostic only — never stops or prevents anything, so it can't
        // change behavior even if the theory above is wrong for some taps.
        // If the avatar ever stops opening the sheet again after this
        // patch, check the console for this line: if it logs on every tap
        // but the sheet doesn't show, the cause is downstream of the tap
        // itself (worth a follow-up); if it stops logging altogether after
        // the first tap, something is intercepting the click before it
        // gets here.
        if (e.target.closest('#live-host-profile-link')) {
            log('avatar tapped (diagnostic — modal open itself is still owned by app-live-tiktok-patch.js).');
        }
    }, true);

    /* =========================================================================
       §3 — mic / camera button redesign: premium dark-glass squircle badge
       with an original, hand-drawn SVG glyph (not a raster of the
       reference images — see header note). CSS + one data-URI background
       per icon/state — no markup, wiring, ids, or the underlying FA
       classes touched, so every existing on/off-state reader and every
       existing click handler keeps working unmodified.
       ========================================================================= */
    // Plain white line-icons, deliberately identical stroke weight/size for
    // mic and camera so neither one reads as "heavier" than the other —
    // this is the literal "maintain balance" ask.
    var PV32_SVG = {
        micOn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<rect x="9" y="2" width="6" height="12" rx="3" fill="#fff"/>' +
            '<path d="M5 11a7 7 0 0 0 14 0" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M12 18v3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M8.5 21h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
        micOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<path d="M15 9.4V5a3 3 0 0 0-5.94-.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M9 9v2a3 3 0 0 0 4.24 2.74" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M5 11a7 7 0 0 0 10.6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M19 11a6.98 6.98 0 0 1-.6 2.8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M12 18v3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M8.5 21h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M3 3l18 18" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/></svg>',
        // Camera kept plain white (no gold/blue accents) so it visually
        // balances the mic glyph — see header note.
        camOn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<rect x="2.5" y="6" width="13" height="12" rx="3.5" fill="#fff"/>' +
            '<path d="M18.5 9.3l3.3-2.1c.6-.4 1.4.05 1.4.77v8.06c0 .72-.8 1.17-1.4.77l-3.3-2.1V9.3z" fill="#fff"/></svg>',
        camOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<rect x="2.5" y="6" width="13" height="12" rx="3.5" fill="#fff"/>' +
            '<path d="M18.5 9.3l3.3-2.1c.6-.4 1.4.05 1.4.77v8.06c0 .72-.8 1.17-1.4.77l-3.3-2.1V9.3z" fill="#fff"/>' +
            '<path d="M3 3l18 18" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/></svg>'
    };
    function pv32DataUri(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }

    (function injectCallStyleButtons() {
        if (document.getElementById('pv32-call-style-css')) return;
        var css = document.createElement('style');
        css.id = 'pv32-call-style-css';
        css.textContent =
            /* Mic + camera — dark glass SQUIRCLE badge (matches the
               rounded-square reference look, not a plain circle),
               original vector glyph painted via ::before. !important
               needed to beat the existing #host-control-panel
               .live-action-btn rule in style.css, the same way
               app-live-tiktok-patch.js's own injected CSS already
               overrides .tk-exit-guest-btn. */
            '#live-mic-toggle, #live-video-toggle, .live-footer #live-mic-toggle, .live-footer #live-video-toggle {' +
            '  background: linear-gradient(145deg, rgba(46,46,52,0.62), rgba(16,16,20,0.78)) !important;' +
            '  -webkit-backdrop-filter: blur(10px);' +
            '  backdrop-filter: blur(10px);' +
            '  border: 1px solid rgba(255,255,255,0.10) !important;' +
            '  border-radius: 16px !important;' +
            '  width: 54px !important; height: 54px !important;' +
            '  color: #fff !important;' +
            '  position: relative;' +
            '  box-shadow: 0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08);' +
            '}' +
            /* The real FA <i> stays in the DOM (see header note) — only
               hidden visually. visibility (not display:none) keeps its
               box in the layout and keeps it fully readable to any code
               that inspects innerHTML/classList as text. */
            '#live-mic-toggle i, #live-video-toggle i { visibility: hidden; }' +
            '#live-mic-toggle::before, #live-video-toggle::before {' +
            '  content: ""; position: absolute; inset: 0; margin: auto;' +
            '  width: 23px; height: 23px; background-repeat: no-repeat;' +
            '  background-position: center; background-size: contain;' +
            '}' +
            '#live-mic-toggle::before { background-image: url("' + pv32DataUri(PV32_SVG.micOn) + '"); }' +
            '#live-mic-toggle.pv32-off::before { background-image: url("' + pv32DataUri(PV32_SVG.micOff) + '"); }' +
            '#live-video-toggle::before { background-image: url("' + pv32DataUri(PV32_SVG.camOn) + '"); }' +
            '#live-video-toggle.pv32-off::before { background-image: url("' + pv32DataUri(PV32_SVG.camOff) + '"); }' +
            '#live-mic-toggle:active, #live-video-toggle:active { transform: scale(0.94); }' +
            /* Muted/off state — same badge, a touch darker so the state is
               still readable at a glance, plus the SVG swap above already
               shows the crossed-out glyph. Driven by a JS-toggled class
               (below) rather than :has(), since :has() support can't be
               assumed on every Android WebView version this app is
               tested on. */
            '#live-mic-toggle.pv32-off, #live-video-toggle.pv32-off {' +
            '  background: linear-gradient(145deg, rgba(30,30,34,0.75), rgba(12,12,14,0.85)) !important;' +
            '}' +
            /* Guest's own self-preview box mic/cam mini-badges
               (.emp-self-mic-btn / .emp-self-cam-btn, app-live-final.js)
               — same glyph set, scaled down for the 20px badge. The
               red "muted" highlight app-live-final.js already applies
               via inline style on this same element is untouched; this
               only adds the crisp icon on top of it. */
            '.emp-self-mic-btn, .emp-self-cam-btn { position: relative; }' +
            '.emp-self-mic-btn i, .emp-self-cam-btn i { visibility: hidden; }' +
            '.emp-self-mic-btn::before, .emp-self-cam-btn::before {' +
            '  content: ""; position: absolute; inset: 0; margin: auto;' +
            '  width: 12px; height: 12px; background-repeat: no-repeat;' +
            '  background-position: center; background-size: contain;' +
            '}' +
            '.emp-self-mic-btn::before { background-image: url("' + pv32DataUri(PV32_SVG.micOn) + '"); }' +
            '.emp-self-mic-btn.pv32-self-off::before { background-image: url("' + pv32DataUri(PV32_SVG.micOff) + '"); }' +
            '.emp-self-cam-btn::before { background-image: url("' + pv32DataUri(PV32_SVG.camOn) + '"); }' +
            '.emp-self-cam-btn.pv32-self-off::before { background-image: url("' + pv32DataUri(PV32_SVG.camOff) + '"); }' +
            /* "Return back" (leave guest slot) — solid red hang-up circle,
               matches the reference screenshot's decline/end-call button.
               Overrides app-live-tiktok-patch.js's injected
               .tk-exit-guest-btn rule (also !important), same size as
               mic/camera for a consistent row. */
            '#tk-exit-guest-btn.tk-exit-guest-btn {' +
            '  background: #FF3B5C !important;' +
            '  color: #fff !important;' +
            '  border: none !important;' +
            '  width: 54px !important; height: 54px !important;' +
            '  box-shadow: 0 2px 10px rgba(255,59,92,0.45);' +
            '}' +
            '#tk-exit-guest-btn.tk-exit-guest-btn i { font-size: 1.35rem; transform: rotate(135deg); display: inline-block; }' +
            '#tk-exit-guest-btn.tk-exit-guest-btn:active { transform: scale(0.94); }';
        document.head.appendChild(css);
        log('injected premium call-style CSS + custom SVG icon set for mic/camera (host-control-panel + guest self-preview badges) and the return-back button.');
    })();

    /* =========================================================================
       §4 — "return back" icon swap: fa-sign-out-alt \u2192 a phone glyph
       (rotated 135deg by the CSS above) so it reads as "hang up" like the
       reference screenshot, instead of a generic sign-out icon. Only ever
       touches this one button's innerHTML; exitGuestSlot() and every
       existing click handler select this button by id/class, not by its
       icon markup, so behavior is unchanged.

       Also syncs .pv32-off on #live-mic-toggle / #live-video-toggle from
       their current icon (fa-microphone-slash / fa-video-slash), read-only
       — this never sets the icon itself, only mirrors whatever app-live.js
       / app-live-tiktok-patch.js already put there into a class the CSS
       above can key off, since :has() can't be assumed on every Android
       WebView version.

       rev.2 addition: the exact same read-only mirroring, applied to the
       guest's own self-preview badges (.emp-self-mic-btn/.emp-self-cam-btn)
       — app-live-final.js's own _syncSelfControlIcons() already sets
       fa-microphone-slash/fa-video-slash on the <i> inside those two
       elements; this only reads that back into .pv32-self-off for the CSS
       above to key off, same pattern, same reasoning.
       ========================================================================= */
    function restyleExitBtnIcon() {
        var btn = document.getElementById('tk-exit-guest-btn');
        if (!btn || btn._pv32IconSet) return;
        var icon = btn.querySelector('i');
        if (icon && !icon.classList.contains('fa-phone')) {
            icon.className = 'fas fa-phone';
        }
        btn._pv32IconSet = true;
    }
    function syncMicCamOffClass() {
        var mic = document.getElementById('live-mic-toggle');
        if (mic) mic.classList.toggle('pv32-off', !!mic.querySelector('.fa-microphone-slash'));
        var cam = document.getElementById('live-video-toggle');
        if (cam) cam.classList.toggle('pv32-off', !!cam.querySelector('.fa-video-slash'));
        var selfMic = document.querySelector('.emp-self-mic-btn');
        if (selfMic) selfMic.classList.toggle('pv32-self-off', !!selfMic.querySelector('.fa-microphone-slash'));
        var selfCam = document.querySelector('.emp-self-cam-btn');
        if (selfCam) selfCam.classList.toggle('pv32-self-off', !!selfCam.querySelector('.fa-video-slash'));
    }
    function runIconSync() { restyleExitBtnIcon(); syncMicCamOffClass(); }
    runIconSync();
    setTimeout(runIconSync, 500);
    setTimeout(runIconSync, 1500);
    document.addEventListener('empyrean-init-done', function () { setTimeout(runIconSync, 200); });
    // The exit button is created lazily by app-live-tiktok-patch.js the
    // first time the live screen initializes (ensureInjectedUI()), and the
    // host/guest-broadcaster mic/camera icon swap (app-fixes.js) replaces
    // the whole <i>...</i> innerHTML on every mute/unmute tap — both are
    // childList changes, so one MutationObserver on the live screen
    // container catches them instead of a growing pile of one-off
    // listeners.
    document.addEventListener('DOMContentLoaded', function () {
        var target = document.getElementById('live-stream-screen') || document.body;
        new MutationObserver(function () { runIconSync(); })
            .observe(target, { childList: true, subtree: true });
    });
    if (document.readyState !== 'loading') {
        new MutationObserver(function () { runIconSync(); })
            .observe(document.getElementById('live-stream-screen') || document.body, { childList: true, subtree: true });
    }
    // rev.2: the guest self-preview badges are different — app-live-final.js's
    // _syncSelfControlIcons() sets `icon.className` on the SAME, already-
    // existing <i> node (an attribute change, not a childList change), so
    // the MutationObserver above — deliberately scoped to childList only,
    // to stay cheap — can't see it. A light poll at the same 800ms cadence
    // that file already uses for its own state watch keeps the self-preview
    // badge glyphs correctly in sync without needing a second, heavier
    // attribute-subtree observer.
    setInterval(runIconSync, 800);

    console.log('[EmpyreanPatchV32] \u2705 Host preview sheet: bio data extended (likes, pin, copy link, website, opt-in owner-controlled phone/email with a visible toggle, exclusive-content banner) + stale inline display cleared on every open (same fix shape as v29\u2019s gift-modal fix, applied here). Mic/camera buttons (host-control-panel + guest self-preview badges) now render a premium custom SVG icon set matching the reference call-UI screenshot; return-back button restyled to match too.');

})();