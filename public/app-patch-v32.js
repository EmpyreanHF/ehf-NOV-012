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

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #4 (2026-07-16, follow-up) — extend the premium badge treatment
   to the REST of the guest-screen footer bar (.live-footer), not just
   the mic/camera pair
   ═══════════════════════════════════════════════════════════════════════
   Reference: screenshot of the "Live participants" screen's bottom bar —
   leave/hang-up, mic, request-to-join, rose, gift, and share all sitting
   in one row. Right now those buttons are NOT visually one family:
   style.css's base `.live-footer .live-action-btn` rule and
   app-live-tiktok-patch.js's own injected `.tk-footer-icon` rule
   deliberately made every one of them a faint, barely-visible "backing
   plate" (background alpha as low as 0.16 — see that file's own comment,
   "background should be silent and not too visible", a prior, different
   request), and #live-gift-btn additionally carries its own gold-tinted
   background on top of that. Next to the bold dark-glass squircle badge
   §3 just gave mic/camera, that made the rest of the row look
   unfinished/inconsistent, not premium.

   FIX: one additional CSS-only rule set, scoped to `.live-footer`, gives
   every footer icon button (`#tk-exit-guest-btn` already covered by §3,
   `.live-action-btn`, `.tk-footer-icon`, and `#live-gift-btn`
   specifically since its own rule needs beating too) the exact same
   dark-glass squircle badge as mic/camera — same gradient, blur, border,
   radius, shadow — so the whole bar finally reads as one consistent,
   premium button family instead of one polished pair next to five faint
   ones. Each icon's own GLYPH/artwork (rose image, gold gift box, share
   arrow, request-to-join gradient icon) is left completely untouched —
   only the badge behind it changes — so nothing about what each icon
   communicates changes, and no ids/classes/click wiring in
   app-live-tiktok-patch.js are touched (that file's click handlers all
   select by id, same as mic/camera did).

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #4, rev.2 (2026-07-16, this session) — the paragraph above was
   written when Issue #4 was diagnosed but the actual CSS rule was never
   added to this file (confirmed by re-reading it before starting this
   session — §3 below only ever contained rules for mic/camera/exit).
   This revision writes the rule the header already promised.
   ═══════════════════════════════════════════════════════════════════════
   Reference: screenshot of the guest live screen's bottom bar, supplied
   again this session. Confirmed against it directly (not guessed): the
   comment composer pill is working as intended and is NOT part of this
   fix — only the four true icon buttons in that row still carry the old
   faint 0.16-alpha "backing plate" look style.css/app-live-tiktok-patch.js
   gave every `.live-footer .live-action-btn`/`.tk-footer-icon`:
     - #tk-rose-quick-btn   (.tk-footer-icon — send-a-rose)
     - #live-gift-btn       (opens the gift catalog)
     - .share-live-btn      (share the stream)
     - #live-request-join-btn (visible only to a viewer who hasn't
       joined yet — same badge applied for whenever it IS shown, so the
       row is consistent in every state, not just this one screenshot's)
   #tk-exit-guest-btn / #live-mic-toggle / #live-video-toggle are already
   covered by §3/§4 above and are deliberately excluded from the new rule
   below so this can't ever double-apply or fight those buttons' own
   (already-correct) styling.

   FIX: one new CSS block (§5), scoped to the four selectors above,
   giving each the exact same dark-glass squircle badge as mic/camera —
   same gradient/blur/border/radius/shadow. Each icon's own artwork (the
   rose image, the gold-gradient gift box, the share arrow, the pink/cyan
   request-to-join gradient icon) is untouched — only the plate behind it
   changes — and #live-gift-btn / #live-request-join-btn keep a subtle
   tint of their own accent color on the badge itself (gold / gradient-
   matched) so they're still instantly distinguishable from a plain
   button at a glance, not flattened into visual sameness. Pure CSS,
   !important + later-in-source only to beat the existing faint-plate
   rules already in app-live-tiktok-patch.js's own injected stylesheet
   (same technique §3 already uses against that same file's rules) — no
   ids, classes, or click wiring touched, so app-live-tiktok-patch.js's
   click handlers (all id-based) and the composer/input keep working
   exactly as before.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #5 (this session) — guest-screen footer icons rendering broken
   (a red "no-entry" 🚫 glyph, a blank circle) on weak-connection devices;
   redesign exit/mic/camera as one premium icon family
   ═══════════════════════════════════════════════════════════════════════
   Reported with a screenshot of the guest "Live participants" screen
   (app-live-final.js's own grid overlay — confirmed by that exact string
   in its source, not guessed) taken on a weak connection. Traced to a
   real, confirmed root cause, not a style nitpick:

   index.html ships an offline Font-Awesome fallback stylesheet
   (`#fa-fallback`, enabled via the CDN <link>'s onerror handler — i.e. it
   activates exactly when the connection is too weak/blocked to load the
   webfont, matching the reported condition). That fallback maps BOTH
   `.fa-microphone-slash:before` and `.fa-video-slash:before` to the
   literal "🚫" (NO ENTRY) unicode glyph. So the moment a guest's camera
   is off (the default state) and Font Awesome fails to load, the camera
   button doesn't show a crossed-out-camera icon — it shows a plain red
   "no entry" sign, which is exactly the broken icon visible in the
   screenshot. (Several other unrelated `.fa-*` classes are deliberately
   mapped to an EMPTY string in that same fallback block — harmless for
   the icons that use them elsewhere today, but a reminder that any
   footer icon still rendered as a bare `<i class="fas ...">` is exposed
   to this exact failure mode the instant the CDN doesn't load.)

   §3 above already solved this correctly for the mic/camera PAIR by
   painting the real glyph via a CSS ::before data-URI background-image
   instead of relying on the webfont glyph at all (a background-image
   from a data: URI has no network dependency and can't be affected by
   the Font-Awesome CDN failing) — so once this file is loaded, the
   camera-off button can no longer show "🚫" regardless of connection
   quality. This revision does two things on top of that:

     1. Extends the SAME "never depends on an external font" technique to
        #tk-exit-guest-btn, which §4 only partially fixed — it swapped in
        a real Font-Awesome class (`icon.className = 'fas fa-phone'`),
        which happens to be safe from the specific "🚫" failure mode
        (fa-phone isn't mapped to it) but is still a webfont glyph, not a
        guaranteed-to-render vector. Replaced here with a fully
        self-contained inline SVG hang-up glyph, painted the same
        ::before way — zero font dependency, exactly like
        tk-end-live-btn's own icon already works (see that button's own
        comment for the same reasoning, applied consistently here).
     2. Redraws the mic/camera glyphs with a touch more polish (soft
        gradient fill + inner highlight instead of flat white) so
        exit/mic/camera now read as one deliberately-matched premium icon
        family instead of three separately-styled pieces — the explicit
        ask this session, using the two supplied reference images purely
        as a STYLE cue (glossy dark badge, confident bold glyph), never
        embedded or traced directly, per the standing instruction not to
        reuse the uploaded icons themselves.

   SCOPE, deliberately guest-screen-only per this session's instruction:
   #tk-exit-guest-btn only ever exists/shows for a guest in a broadcast
   slot (app-live-tiktok-patch.js creates it once, keeps it display:none
   until exitGuestSlot() logic shows it) — never part of the host's own
   exit flow (host uses #live-close-btn / #tk-end-live-btn, both
   untouched here). #live-mic-toggle / #live-video-toggle remain the one
   shared pair between host and guest-broadcaster documented in §3's own
   note; a more premium finish therefore benefits both, same as §3 already
   did — no new host/guest split is introduced by this revision.

   Rose / gift / share (already real inline SVG/image assets, not
   FA-dependent, per index.html) and the comment composer are confirmed
   untouched — nothing about their markup, click wiring, or the composer's
   expand/collapse behavior (app-live-tiktok-patch.js's own
   `tk-composer-expanded` logic) is touched by this revision. No new ids,
   classes, or role labels (HOST/YOU) are introduced — app-live-final.js's
   grid tagging (`p.kind === 'host'` / `p.isMe`) has no existing co-host or
   admin distinction in its data model today, so inventing one here would
   be a fabricated state, not a real feature; left untouched pending an
   actual co-host/admin field to key off.
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
    // Soft-gradient line-icons (rev.2, this session): same silhouette and
    // identical stroke weight/size between mic and camera as before (still
    // "maintain balance" — neither reads heavier), now with a subtle
    // white→light-grey gradient fill + a thin inner highlight stroke, the
    // same "glossy dark badge, confident glyph" polish the two supplied
    // reference images used as a STYLE cue — hand-drawn here, not traced
    // or embedded from those images. Every glyph carries its own <defs>,
    // so each is a fully independent SVG document (safe to reuse the same
    // short gradient id across icons — they never share a DOM, each is
    // rendered from its own data: URI as a background-image).
    var PV32_SVG = {
        micOn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#d7d9df"/></linearGradient></defs>' +
            '<rect x="9" y="2" width="6" height="12" rx="3" fill="url(#g)"/>' +
            '<rect x="10" y="3" width="1.4" height="9" rx="0.7" fill="#fff" opacity="0.55"/>' +
            '<line x1="9.6" y1="6.4" x2="14.4" y2="6.4" stroke="#9a9ca3" stroke-width="0.55" opacity="0.7"/>' +
            '<line x1="9.6" y1="8.8" x2="14.4" y2="8.8" stroke="#9a9ca3" stroke-width="0.55" opacity="0.7"/>' +
            '<path d="M5 11a7 7 0 0 0 14 0" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M12 18v3" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M8 21.4h8" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/></svg>',
        micOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#d7d9df"/></linearGradient></defs>' +
            '<path d="M15 9.4V5a3 3 0 0 0-5.94-.6" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M9 9v2a3 3 0 0 0 4.24 2.74" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M5 11a7 7 0 0 0 10.6 6" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M19 11a6.98 6.98 0 0 1-.6 2.8" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M12 18v3" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M8 21.4h8" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M3 3l18 18" stroke="#ff5c72" stroke-width="2.3" stroke-linecap="round"/></svg>',
        // Camera refined this session with an actual lens-ring + iris dot
        // (previously a flat "flag" shape with no lens detail at all) so
        // it reads as a proper camera at a glance rather than an abstract
        // rounded rectangle — same plain grey/white tone as the mic, no
        // gold/blue accents, so the pair still visually balances (see
        // header note on "maintain balance").
        camOn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#d7d9df"/></linearGradient></defs>' +
            '<rect x="2.3" y="6.3" width="13.4" height="11.4" rx="3.4" fill="url(#g)"/>' +
            '<circle cx="9" cy="12" r="3.15" fill="none" stroke="#9a9ca3" stroke-width="0.85" opacity="0.85"/>' +
            '<circle cx="9" cy="12" r="1.35" fill="#6c6f78"/>' +
            '<rect x="4" y="7.4" width="4.5" height="1.5" rx="0.75" fill="#fff" opacity="0.55"/>' +
            '<path d="M18.5 9.3l3.3-2.1c.6-.4 1.4.05 1.4.77v8.06c0 .72-.8 1.17-1.4.77l-3.3-2.1V9.3z" fill="url(#g)"/></svg>',
        camOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#d7d9df"/></linearGradient></defs>' +
            '<rect x="2.3" y="6.3" width="13.4" height="11.4" rx="3.4" fill="url(#g)"/>' +
            '<circle cx="9" cy="12" r="3.15" fill="none" stroke="#9a9ca3" stroke-width="0.85" opacity="0.55"/>' +
            '<path d="M18.5 9.3l3.3-2.1c.6-.4 1.4.05 1.4.77v8.06c0 .72-.8 1.17-1.4.77l-3.3-2.1V9.3z" fill="url(#g)"/>' +
            '<path d="M3 3l18 18" stroke="#ff5c72" stroke-width="2.3" stroke-linecap="round"/></svg>',
        // New (this session) — self-contained hang-up glyph for
        // #tk-exit-guest-btn. Classic tilted-handset "end call" silhouette,
        // matching mic/camera's own gradient treatment so all three read
        // as one family; sits on the button's existing solid-red badge
        // (see CSS below) rather than the dark-glass one, so it keeps its
        // own "danger" identity within that shared family.
        exitCall: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#f3d6da"/></linearGradient></defs>' +
            '<path d="M4.5 12.8c3-3 6-4.6 7.5-4.6s4.5 1.6 7.5 4.6c.6.6.5 1.6-.2 2.1l-2.2 1.6c-.5.4-1.2.3-1.6-.2l-1-1.3c-.3-.4-.9-.5-1.4-.3-.7.3-1.7.3-2.4 0-.5-.2-1.1-.1-1.4.3l-1 1.3c-.4.5-1.1.6-1.6.2l-2.2-1.6c-.7-.5-.8-1.5-.2-2.1z" ' +
            'fill="url(#g)" transform="rotate(135 12 12)"/></svg>'
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
            /* FIX ("make sure all footer buttons are same size, background,
               height, width"): 54px -> 32px, matching the unified size now
               used by every other footer button (rose/gift/share/request/
               exit — see app-live-tiktok-patch.js's base .live-action-btn/
               .tk-footer-icon rule and the exit-button override, both
               updated to 32px alongside this). Squircle shape is KEPT
               (user's explicit choice) — only width/height/border-radius
               and the inner glyph size are scaled down to match; the
               dark-glass background/border treatment is untouched, so it
               already matches the other buttons' family. */
            '#live-mic-toggle, #live-video-toggle, .live-footer #live-mic-toggle, .live-footer #live-video-toggle {' +
            '  background: linear-gradient(145deg, rgba(46,46,52,0.62), rgba(16,16,20,0.78)) !important;' +
            '  -webkit-backdrop-filter: blur(10px);' +
            '  backdrop-filter: blur(10px);' +
            '  border: 1px solid rgba(255,255,255,0.10) !important;' +
            '  border-radius: 10px !important;' +
            '  width: 32px !important; height: 32px !important;' +
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
               .tk-exit-guest-btn rule (also !important).
               FIX (bug report: "end button too large"): this used to
               match mic/camera's 54px badge, which — being solid red and
               first in the row — visually dominated the whole footer far
               more than mic/camera's dark-glass badges did at the same
               size. Sized down to sit closer to the other 40px footer
               icons (rose/gift/share) while staying a hair larger, so it
               still reads as the one "danger" control without visually
               overpowering everything next to it.
               FIX 2026-07-17 ("reduce the end button and make it same
               size with others"): the "hair larger" 42px compromise
               above is no longer wanted — sized down further to the
               exact same 40px every other footer icon already uses
               (matches ".live-footer .live-action-btn, .live-footer
               .tk-footer-icon" in app-live-tiktok-patch.js). The glyph
               inside is trimmed 18px -> 16px to keep the same visual
               margin around it at the smaller box size.
               FIX 2026-07-17 (round 3 — "still too large, use black
               background like others"): sized down again, 32px -> 26px.
               Also swapping the solid red gradient background for the
               SAME dark-glass background #live-mic-toggle/#live-video-
               toggle already use just above in this file (linear-
               gradient(145deg, rgba(46,46,52,0.62), rgba(16,16,20,0.78))
               + the same 1px translucent-white border) — so this button
               now matches its neighbors' family instead of being the one
               loud, differently-styled control in the row. The hang-up
               glyph itself (PV32_SVG.exitCall, defined above) keeps its
               own red/pink gradient fill, so "this ends the call" is
               still communicated through icon color, just without a
               solid red backing plate behind it. Glyph trimmed
               proportionally, 13px -> 11px, for the smaller 26px box. */
            '#tk-exit-guest-btn.tk-exit-guest-btn {' +
            '  background: linear-gradient(145deg, rgba(46,46,52,0.62), rgba(16,16,20,0.78)) !important;' +
            '  color: #fff !important;' +
            '  border: 1px solid rgba(255,255,255,0.10) !important;' +
            '  width: 26px !important; height: 26px !important;' +
            '  position: relative;' +
            '  box-shadow: 0 3px 10px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08);' +
            '}' +
            /* FIX (Issue #5): the old rule rotated whatever webfont glyph
               happened to be inside the <i> — safe from the "🚫" failure
               mode this session diagnosed (fa-phone isn't mapped to it),
               but still a webfont glyph, not a guaranteed-to-render
               vector. Same visibility:hidden + ::before data-URI technique
               §3 already uses for mic/camera — zero font dependency,
               can never show a broken/missing glyph on any connection. */
            '#tk-exit-guest-btn.tk-exit-guest-btn i { visibility: hidden; }' +
            '#tk-exit-guest-btn.tk-exit-guest-btn::before {' +
            '  content: ""; position: absolute; inset: 0; margin: auto;' +
            '  width: 11px; height: 11px; background-repeat: no-repeat;' +
            '  background-position: center; background-size: contain;' +
            '  background-image: url("' + pv32DataUri(PV32_SVG.exitCall) + '");' +
            '}' +
            '#tk-exit-guest-btn.tk-exit-guest-btn:active { transform: scale(0.94); }';
        document.head.appendChild(css);
        log('injected premium gradient SVG icon set for mic/camera (host-control-panel + guest self-preview badges) and the return-back button — exit button now painted via a font-independent ::before data-URI, closing the FA-fallback "🚫" gap (Issue #5).');
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
        // NOTE (Issue #5, this session): the visible glyph now comes from
        // the ::before data-URI CSS rule above (font-independent) — this
        // class swap is kept only so the hidden <i> holds a sensible,
        // recognizable class rather than the original fa-sign-out-alt, in
        // case any future code ever inspects it. It has no visual effect
        // of its own any more (the <i> is visibility:hidden).
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

    /* =========================================================================
       §5 — completes Issue #4: dark-glass squircle badge extended to the
       rest of the guest-screen footer row (rose / gift / share / request-
       to-join). Written this session — see the Issue #4 rev.2 header note
       above for why this wasn't already here. CSS-only, additive, and
       deliberately excludes #tk-exit-guest-btn / #live-mic-toggle /
       #live-video-toggle (already themed by §3/§4) so it can never
       double-apply. The comment composer (#live-comment-form /
       #live-comment-input) is intentionally NOT touched here — confirmed
       against the supplied screenshot that it's a working input pill, not
       an icon needing this treatment.
       ========================================================================= */
    (function injectFooterBadgeCompletionCSS() {
        if (document.getElementById('pv32-footer-badge-css')) return;
        var css = document.createElement('style');
        css.id = 'pv32-footer-badge-css';
        css.textContent =
            /* Same recipe as §3's mic/camera badge (gradient, blur, border,
               radius, shadow) — this is the literal "one consistent,
               premium button family" the Issue #4 header already asked
               for. !important + appended after app-live-tiktok-patch.js's
               own <style> in the document beats that file's 0.16-alpha
               "faint backing plate" rule on the same selectors (same
               beat-it-by-source-order technique §3 already relies on). */
            '.live-footer #tk-rose-quick-btn.tk-footer-icon,' +
            '.live-footer .share-live-btn,' +
            '.live-footer #live-gift-btn,' +
            '#live-request-join-btn.tk-request-premium {' +
            '  background: linear-gradient(145deg, rgba(46,46,52,0.62), rgba(16,16,20,0.78)) !important;' +
            '  -webkit-backdrop-filter: blur(10px);' +
            '  backdrop-filter: blur(10px);' +
            '  border: 1px solid rgba(255,255,255,0.10) !important;' +
            '  border-radius: 16px !important;' +
            '  width: 46px !important; height: 46px !important;' +
            '  box-shadow: 0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08) !important;' +
            '}' +
            '.live-footer #tk-rose-quick-btn.tk-footer-icon:active,' +
            '.live-footer .share-live-btn:active,' +
            '.live-footer #live-gift-btn:active,' +
            '#live-request-join-btn.tk-request-premium:active { transform: scale(0.90); }' +
            /* Gift keeps a thin gold edge on the same badge shape, so it's
               still instantly identifiable as the gift entry point next
               to its now-matching neighbors, not flattened to sameness. */
            '.live-footer #live-gift-btn {' +
            '  border-color: rgba(245,197,24,0.30) !important;' +
            '}';
            // Request-to-join keeps its own pink/cyan gradient glyph
            // (untouched, drawn inline in index.html) but now sits on the
            // same badge as its neighbors. app-live-tiktok-patch.js's own
            // #live-request-join-btn[data-requested="1"] (pending state)
            // rule is a separate, higher-specificity attribute selector
            // and is unaffected by this.
            // Icon glyph sizes (rose 68px bleed, gift 28px, share 18px)
            // were already tuned to their old 40px badge and still sit
            // comfortably centered in the new 46px one — left untouched.
        document.head.appendChild(css);
        log('injected premium dark-glass badge CSS for the rose / gift / share / request-to-join footer buttons — completes Issue #4 (mic/camera/exit were already done). Comment composer left untouched.');
    })();

    console.log('[EmpyreanPatchV32] \u2705 Host preview sheet: bio data extended (likes, pin, copy link, website, opt-in owner-controlled phone/email with a visible toggle, exclusive-content banner) + stale inline display cleared on every open (same fix shape as v29\u2019s gift-modal fix, applied here). Mic/camera buttons (host-control-panel + guest self-preview badges) now render a premium gradient SVG icon set matching the reference call-UI screenshot; the exit/return-back button is now painted the same font-independent way, fixing the "🚫" no-entry glyph that Font-Awesome\u2019s offline fallback was showing for a muted camera on weak connections (Issue #5). Rose/gift/share/request-to-join footer icons now share that same premium dark-glass badge, completing the guest-screen footer row.');

})();