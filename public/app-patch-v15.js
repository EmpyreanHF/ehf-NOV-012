/* =============================================================================
   Empyrean — app-patch-v15.js
   ─────────────────────────────────────────────────────────────────────────
   Load order: AFTER app-patch-v13.js and app-patch-v14.js (they call
   window.EmpAvatar.wire(...) at runtime; definition-order is fine as long
   as this file has executed by the time a person actually opens a group
   chat, which it will since all patch scripts run before any user
   interaction is possible).

   WHAT THIS FILE DOES
   Implements the "Group Chat Avatar Frame" spec item that v13/v14 left a
   placeholder for:

     1. Save — group photo save/error handling itself lives inside
        app-patch-v14.js's _uploadGroupAvatar/_finishGroupAvatarUpload.
     2. Avatar placement — the group chat header (app-patch-v13.js) already
        puts an avatar element in the same row as the group name; this file
        doesn't move anything, it just makes that element (and the matching
        ones in the Group info portal and the "Groups" contact-list
        section) always render as a real circular frame.
     3. Group logo/image display + default placeholder — "no photo
        uploaded" no longer depends on a remote ui-avatars.com fetch (which
        silently fails offline/on a bare localhost dev server). Instead a
        locally-generated initials placeholder renders instantly, with the
        real photo layered on top once (and only if) it loads.
     4. Consistency — one shared window.EmpAvatar.wire() helper is used for
        the chat header, the Group info portal's big avatar, and each row
        in the "Groups" contact-list section.

   ── FIX v18 (redesign: avatar upload silently did nothing for most taps) ──
   Root cause, found by actually tracing the click path instead of guessing
   further: the tappable circle a person sees is THIS WRAPPER (`frame`
   below) — the actual <img> inside it is `display:none` literally any
   time there's no photo yet (the exact case someone tapping this to SET
   a photo for the first time is in). v14.js was attaching its "open the
   photo picker" click listener directly to that <img>, plus a separate
   small camera badge. A hidden element cannot receive clicks, so tapping
   anywhere on the big circle *except* that badge did nothing — and in the
   portal, the badge itself was only ever rendered into the DOM for a
   literal admin, regardless of the "Edit group info: Everyone" setting.

   Rather than patch each of those symptoms again, `wire()` now takes over
   the whole editable affordance in one place: pass `{editable, onEdit}`
   and it attaches the click listener to the WRAPPER itself (always
   present, always the full size of the visible circle, regardless of
   whether the photo underneath has loaded), and manages its own badge —
   so every caller behaves identically and there's exactly one code path
   to get right instead of three.

   window.EmpAvatar.wire(imgEl, name, avatarUrl, opts) is idempotent — safe
   to call again on the same <img> (e.g. every onSnapshot tick, or every
   time editability changes) without re-wrapping or double-binding.
   ============================================================================= */
(function () {
    'use strict';

    function _initials(name) {
        var parts = String(name || 'Group').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'G';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        /* Matches the first-word + last-word convention the app already
           used via ui-avatars.com, so existing groups don't suddenly show
           different initials than people are used to. */
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function _colorFor(name) {
        var str = String(name || 'Group');
        var hash = 0;
        for (var i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        var hue = Math.abs(hash) % 360;
        return 'hsl(' + hue + ', 42%, 40%)';
    }

    /* Wrap an existing <img> (already in the DOM, already sized/positioned
       by its own inline style) with a same-size circular frame that shows
       the group's initials on a deterministic color, and layers the real
       photo on top once it loads. If the photo 404s or the device is
       offline, the img hides itself and the initials show through — never
       a blank box, never a broken-image icon.

       opts (optional):
         editable — if true, the WHOLE frame (not the img) is the tap
                     target, gets a cursor + title + small camera badge.
                     Re-evaluated every call, so it tracks live permission
                     changes without any extra code at the call site.
         onEdit   — called with no arguments when the frame is tapped
                     while editable. */
    function wire(imgEl, name, avatarUrl, opts) {
        if (!imgEl) return;
        /* FIX v16 (avatar upload "opens fine but silently stops saving/
           being tappable"): the group chat header and the Group info
           portal both call wire() on their own schedule — the header's
           very first paint via a one-time `.get()` (no opts, i.e. not
           editable) and the live permission-aware version via
           `.onSnapshot()` (opts.editable/opts.onEdit) — and those two
           calls race. Whichever happens to resolve last used to win
           outright, because every call unconditionally overwrote
           _empEditable/_empOnEdit even when it wasn't given an opts
           argument at all. If the plain one-time call landed after the
           live one, it silently reset the frame back to "not editable"
           — tapping did nothing, with no error, no missing network call,
           nothing to see in a screenshot. Now a call that doesn't pass
           opts leaves whatever editable/onEdit state is already there
           alone, instead of clobbering it back to "off". */
        var hadOpts = !!opts;
        opts = opts || {};

        if (!imgEl._empFrameReady) {
            var wrap = document.createElement('span');
            wrap.className = 'emp-avatar-frame';
            var w = imgEl.style.width || '38px';
            var h = imgEl.style.height || w;
            wrap.style.cssText =
                'position:relative;display:inline-flex;align-items:center;justify-content:center;' +
                'overflow:hidden;border-radius:50%;flex-shrink:0;width:' + w + ';height:' + h + ';' +
                'color:#fff;font-weight:700;line-height:1;font-size:' + (Math.max(parseInt(w, 10) || 38, 20) * 0.42) + 'px;';

            imgEl.parentNode.insertBefore(wrap, imgEl);
            wrap.appendChild(imgEl);
            imgEl.style.position = 'absolute';
            imgEl.style.inset = '0';
            imgEl.style.width = '100%';
            imgEl.style.height = '100%';
            imgEl.style.borderRadius = '50%';
            imgEl.style.pointerEvents = 'none'; /* the WRAPPER is the click target, always — see FIX v18 note above */

            imgEl.addEventListener('error', function () { imgEl.style.display = 'none'; });
            imgEl.addEventListener('load', function () { if (imgEl.getAttribute('src')) imgEl.style.display = 'block'; });

            imgEl._empFrameReady = true;
            imgEl._empFrameWrap = wrap;
        }
        var frame = imgEl._empFrameWrap;

        frame.style.background = _colorFor(name);
        /* textContent would wipe the img out of the DOM, so set it via a
           dedicated text node instead of touching frame.textContent. */
        if (!frame._empTextNode) {
            frame._empTextNode = document.createTextNode('');
            frame.insertBefore(frame._empTextNode, frame.firstChild);
        }
        frame._empTextNode.nodeValue = _initials(name);

        if (avatarUrl) { imgEl.src = avatarUrl; imgEl.style.display = 'block'; }
        else { imgEl.removeAttribute('src'); imgEl.style.display = 'none'; }

        /* ── Editable affordance: badge + click, both on the frame ── */
        if (!frame._empBadge) {
            var badge = document.createElement('span');
            badge.className = 'emp-avatar-badge';
            badge.style.cssText =
                'position:absolute;bottom:0;right:0;width:28%;height:28%;min-width:14px;min-height:14px;' +
                'border-radius:50%;background:#1B2B8B;border:1.5px solid #fff;display:none;' +
                'align-items:center;justify-content:center;pointer-events:none;';
            badge.innerHTML = '<i class="fas fa-camera" style="color:#fff;font-size:60%;"></i>';
            frame.appendChild(badge);
            frame._empBadge = badge;
        }
        if (!frame._empClickWired) {
            frame._empClickWired = true;
            frame.addEventListener('click', function (e) {
                if (!frame._empEditable || typeof frame._empOnEdit !== 'function') return;
                e.stopPropagation();
                frame._empOnEdit();
            });
        }
        if (hadOpts) {
            frame._empEditable = !!opts.editable;
            frame._empOnEdit = opts.onEdit;
            frame.style.cursor = frame._empEditable ? 'pointer' : '';
            frame.title = frame._empEditable ? 'Tap to change photo' : '';
            /* FIX v17: the camera badge overlapped neighboring header text
               (group name/participant count) on narrow screens and was
               visually noisy. The frame itself remains the click target
               and still shows the pointer cursor + tooltip when editable
               — only the badge graphic is hidden. */
            frame._empBadge.style.display = 'none';
        }
    }

    window.EmpAvatar = { initials: _initials, colorFor: _colorFor, wire: wire };
})();

/* =============================================================================
   FEATURE (WhatsApp behaviour): sender avatar only on the LAST message of a
   consecutive run from the same sender — group chat (#v13-grp-body) and 1:1
   (#oc-messages-body). Earlier messages in the run keep the avatar's 36px/34px
   gutter (visibility:hidden, not display:none) so every bubble stays aligned.
   A date separator or a different sender ends a run. Re-evaluated whenever
   rows are added/removed, so a newly arrived message moves the avatar down to
   itself. Rows are tagged with data-sender-id by app-patch-v13.js (group) and
   app-patch-openchat.js (1:1).
   ============================================================================= */
(function () {
    'use strict';
    var SEL = '#v13-grp-body, #oc-messages-body';

    function _avatarOf(row) {
        return row && row.querySelector ? row.querySelector(':scope > .v13-msg-avatar, :scope > .oc-msg-avatar') : null;
    }

    function _fixRuns() {
        var bodies = document.querySelectorAll(SEL);
        Array.prototype.forEach.call(bodies, function (body) {
            var kids = body.children;
            for (var i = 0; i < kids.length; i++) {
                var row = kids[i];
                var av = _avatarOf(row);
                if (!av) continue;
                var next = kids[i + 1], showIt = true;
                if (next && next.dataset && next.dataset.senderId && next.dataset.senderId === row.dataset.senderId && _avatarOf(next)) showIt = false;
                var v = showIt ? 'visible' : 'hidden';
                if (av.style.visibility !== v) av.style.visibility = v;
                av.style.pointerEvents = showIt ? '' : 'none';
            }
        });
    }

    var _t = null;
    function _schedule() { clearTimeout(_t); _t = setTimeout(_fixRuns, 60); }

    function _start() {
        if (!document.body) return;
        new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var t = muts[i].target;
                if (t && t.nodeType === 1 && (t.matches(SEL) || (t.closest && t.closest(SEL)))) { _schedule(); return; }
            }
        }).observe(document.body, { childList: true, subtree: true });
        _schedule();
    }
    if (document.body) _start(); else document.addEventListener('DOMContentLoaded', _start);
    window._empFixAvatarRuns = _fixRuns;
})();