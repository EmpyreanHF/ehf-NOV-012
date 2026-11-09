/* =============================================================================
   EMPYREAN INTERNATIONAL — app-patch-v22.js
   "Business Page — Item Details (currency/phone/address/edit/delete) +
   Create-Page button consolidation"
   =============================================================================

   This is ONE module (single IIFE, single guard, shared helpers) covering
   two fixes to the Business Page area that were requested together. It
   replaces the earlier two-file version of this patch — everything now
   lives under one guard flag and one set of helper functions instead of
   being duplicated across two separate closures.

   PART A — Item Details: currency, phone/address, edit & delete
   ────────────────────────────────────────────────────────────
   app-business.js already writes a `products` array on every
   business_posts document ({ url, isVideo, name, price }) but never shows
   name/price/anything back on the page, and never lets an owner edit or
   delete a single item. This adds:
     • A currency selector (₦ NGN / $ USD / £ GBP / € EUR) + Phone +
       Address fields in the post composer
     • A rendered "Item Details" row under every listing's media, showing
       name, formatted price, a tel: linked phone, and address
     • Owner-only Edit (name/price/currency/phone/address) and Delete
       (removes just that item; removes the whole post if it was the last
       item) buttons per row
   window.submitBusinessPost is fully replaced with an extended version to
   carry the three new fields — same dedup guard, upload flow, and reset
   behaviour as the original. Rendering the Item Details row is done via a
   MutationObserver over #vf-biz-posts-list, so app-business.js's private
   card-building function is never touched directly (same approach already
   used for chat segmentation in app-patch-v18/19/20).

   Scope: the same post-card markup renders in two places — the Business
   Page's own list AND the general public dashboard/home feed (shared card
   component). The Item Details row (price/name/phone/address, plus
   edit/delete) is only ever attached to cards inside #vf-biz-posts-list;
   anything rendered in the public feed is left completely untouched, so
   strangers scrolling the dashboard never see another user's contact
   details or edit/delete controls.

   PART B — "Create Business Page" button: one consolidated opener
   ─────────────────────────────────────────────────────────────
   Root cause of the production-only "button doesn't respond" bug: across
   this codebase's history, FIVE different id/class variants of this same
   button accumulated (app-business.js's inline-onclick version with no
   id/class at all; app-fix-final.js's #open-create-biz-page-btn, wired to
   only ever call classList.add('show') without style.display; app-fixes.js's
   #create-page-btn with the same classList-only bug; plus
   #biz-mypage-create-tile and a couple of data-action variants). Whichever
   one actually ends up rendered on a given page load can have incomplete
   wiring — no console error, the click just doesn't make anything visible.

   Fix: ONE delegated click listener, attached to document the instant this
   script runs (no timers, no waiting on init/section-change events), that
   recognises every known variant PLUS a text-based fallback (matches any
   short <button>/<a> whose text is unmistakably "Create Business Page",
   in case a not-yet-seen sixth variant exists in one of the patch files
   this fix didn't have visibility into). On match, it always opens the
   modal the most complete way possible: inline display:flex AND the .show
   class AND body.modal-open — so it can't silently no-op again regardless
   of which variant fired or what the deployed CSS does or doesn't define.

   SECTION MAP
   ───────────
   §1  Guard + shared helpers
   §2  Currency helpers
   §3  Composer — inject Phone / Address / Currency fields
   §4  submitBusinessPost — extended replacement
   §5  Item Details row — render, Edit modal, Delete
   §6  MutationObserver — attach Item Details to every post card, present + future
   §7  Create Business Page button — one consolidated opener for every known variant
   ============================================================================= */

(function empyreanBusinessPatchV22() {
    'use strict';

    /* FIX (2026-07-21 — echo/frozen-tap follow-up audit): this file had no
       guard against running twice on the same page load (the same re-
       execution behavior documented in app-patch-v35.js's header, and the
       same mechanism fixed at the source in app-live.js/app-fix-final.js
       this session). A second execution would re-register this file's
       document-level click listener(s) on top of the first copy. Guarding
       here matches the convention already used by app-patch-v30.js onward. */
    if (window._empPatchV22Loaded) {
        console.warn('[V22] Already loaded — skipping duplicate execution (prevents duplicate click listeners).');
        return;
    }
    window._empPatchV22Loaded = true;

    /* =========================================================================
       §1  GUARD + SHARED HELPERS
       (used by every section below — defined once, not duplicated)
       ========================================================================= */
    if (window._empBusinessPatchV22Loaded) {
        console.warn('[BizPatch v22] Already loaded — skipping duplicate.');
        return;
    }
    window._empBusinessPatchV22Loaded = true;

    function _S()        { return window.EmpState || {}; }
    function _us()        { return _S().userState || window.userState || {}; }
    function _isGuest()   { return (_S().isGuest != null) ? !!_S().isGuest : !!window.isGuest; }
    function _isAdmin()   { return !!(window.isAdmin || _S().isAdmin); }
    function _fbOk()      { return !!(window._firebaseLoaded && window.fbDb); }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function _esc(s)      { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _attr(s)     { return String(s || '').replace(/"/g, '&quot;'); }
    function ready(fn)    { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }


    /* =========================================================================
       §2  CURRENCY HELPERS
       ========================================================================= */
    var CURRENCIES = {
        NGN: { symbol: '₦', label: 'Naira (₦)'     },
        USD: { symbol: '$', label: 'US Dollar ($)' },
        GBP: { symbol: '£', label: 'Pound (£)'     },
        EUR: { symbol: '€', label: 'Euro (€)'      }
    };
    var DEFAULT_CURRENCY = 'NGN';

    function _currencySelectHTML(id, selected) {
        selected = selected || DEFAULT_CURRENCY;
        var opts = Object.keys(CURRENCIES).map(function (code) {
            return '<option value="' + code + '"' + (code === selected ? ' selected' : '') + '>'
                + _esc(CURRENCIES[code].label) + '</option>';
        }).join('');
        return '<select id="' + id + '" style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);'
            + 'border-radius:10px;padding:9px 10px;font-size:0.85rem;color:#374151;outline:none;background:#fff;">'
            + opts + '</select>';
    }

    function _fmtPrice(price, currency) {
        if (!price && price !== 0) return '';
        var c = CURRENCIES[currency] || CURRENCIES[DEFAULT_CURRENCY];
        return c.symbol + String(price).trim();
    }
    window._empFmtPrice = _fmtPrice;

    /* =========================================================================
       PRICE DISPLAY FIX (2026-08-07)
       ────────────────────────────────────────────────────────────────────
       NGOs and other service-rendering organisations don't sell a priced,
       shippable item — app-business.js already has this exact rule for its
       OWN composer's Listing Details block (_showListingDetails, gated on
       _resolveCategory(data) === 'product') and app-business-feedcard.js
       has it for the feed card (_hidePriceForCategory). This file's own
       "Listing Details (optional)" injection (§3, _injectComposerFields)
       and its rendered "Item Details" row (§5, _buildItemRow) were the two
       places that rule was never applied — both show unconditionally,
       regardless of category, which is exactly what the screenshot showed
       for an NGO business page (phone/address/Naira-currency fields still
       present on the composer, price still shown on the Item Details row).
       Reuses window._bizResolveCategory (app-business.js's own resolver,
       exposed globally) rather than adding a second, parallel category
       concept. Fails OPEN (treats as priced) only when that resolver isn't
       available yet — silently hiding a real price because the category
       couldn't be resolved would be a worse surprise than occasionally
       showing one it shouldn't, same posture app-business-feedcard.js's
       own version of this gate already documents. */
    function _isPricedCategory(bizData) {
        if (typeof window._bizResolveCategory !== 'function') return true; // fail open — resolver not loaded yet
        return window._bizResolveCategory(bizData || {}) === 'product';
    }
    /* Resolves the category for a SPECIFIC post's own business page (by
       pageId, via the same page-data cache app-business-feedcard.js reads),
       falling back to the currently open page's data — the item rows this
       feeds are only ever attached inside #vf-biz-posts-list (see §6),
       i.e. always the page currently being viewed, so the fallback is
       correct even when the pageId lookup misses (e.g. cache not
       populated yet). */
    function _resolveItemBizData(post) {
        var pages = window._firestoreBusinessPages || [];
        var doc = (post && post.pageId) ? pages.find(function (p) { return p.id === post.pageId; }) : null;
        return doc || window._activeBizData || {};
    }


    /* =========================================================================
       §3  COMPOSER — INJECT PHONE / ADDRESS / CURRENCY FIELDS
       ========================================================================= */

    function _injectComposerFields() {
        var composer = document.getElementById('biz-post-composer');
        var preview   = document.getElementById('biz-media-preview');
        if (!composer || !preview) return;

        var bizData = window._activeBizData || {};
        var existing = document.getElementById('biz-item-extra-fields');

        /* PRICE DISPLAY FIX (2026-08-07): NGOs / service-rendering
           organisations don't sell a priced, shippable item — omit this
           whole Listing Details block (phone/address/currency all exist
           only to support a price) for those categories, exactly like
           app-business.js's own composer already gates its OWN Listing
           Details block via _showListingDetails. This was the block still
           showing unconditionally for every category — confirmed via
           screenshot (an NGO page still showed Phone/Address/Naira
           fields) — since it's injected separately from, and after,
           app-business.js's render. If the category changes after this
           already ran (e.g. the owner edits their page's category), the
           stale block is removed instead of left behind. */
        if (!_isPricedCategory(bizData)) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        var wrap = document.createElement('div');
        wrap.id = 'biz-item-extra-fields';
        wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 10px;';
        wrap.innerHTML =
            '<div style="grid-column:1 / -1;font-size:0.72rem;font-weight:800;color:#6B7280;'
            + 'text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Listing Details (optional)</div>'
            + '<input type="tel" id="biz-item-phone" placeholder="Contact phone number" value="' + _attr(bizData.phone || '') + '"'
            + ' style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;'
            + 'padding:9px 10px;font-size:0.85rem;color:#374151;outline:none;">'
            + '<input type="text" id="biz-item-address" placeholder="Address / location" value="' + _attr(bizData.address || '') + '"'
            + ' style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;'
            + 'padding:9px 10px;font-size:0.85rem;color:#374151;outline:none;">'
            + '<div style="grid-column:1 / -1;">' + _currencySelectHTML('biz-item-currency') + '</div>';

        preview.parentNode.insertBefore(wrap, preview.nextSibling);
    }

    ready(function () { setTimeout(_injectComposerFields, 450); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_injectComposerFields, 350); });
    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && ev.detail.section === 'business-page') {
            setTimeout(_injectComposerFields, 250);
        }
    });


    /* =========================================================================
       §4  submitBusinessPost — EXTENDED REPLACEMENT
       (adds phone / address / currency onto every product entry; everything
       else is identical to app-business.js's version)
       ========================================================================= */

    var _lastBizPostContent = '';
    var _lastBizPostTime    = 0;

    async function submitBusinessPostExtended() {
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
        var now = Date.now();
        if (content === _lastBizPostContent && now - _lastBizPostTime < 6000) {
            _notify('Post already submitted — please wait.', 'info'); return;
        }
        _lastBizPostContent = content;
        _lastBizPostTime    = now;

        var phone    = (document.getElementById('biz-item-phone')    || {}).value || '';
        var address  = (document.getElementById('biz-item-address')  || {}).value || '';
        var currency = (document.getElementById('biz-item-currency') || {}).value || DEFAULT_CURRENCY;

        var submitBtn = document.getElementById('biz-post-submit-btn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting…'; }

        var mediaUrls = [];
        var products  = [];
        try {
            if (files.length) {
                /* SPEED FIX (2026-08-06 — "uploads are very slow"): this used
                   to be a sequential `for` loop with `await` on each file —
                   file 2 didn't even START uploading until file 1 fully
                   finished, so N images took roughly N× as long as one. On a
                   weak mobile connection (the exact condition this app is
                   used under — see app-patch-v26/v31/v35's own diagnosis of
                   this device's signal) that's the difference between a
                   3-photo listing taking ~6s vs ~18s. Firebase Storage (and
                   the compression added in app-business.js's _uploadMedia)
                   has no problem with several concurrent PUTs, so this now
                   fires all of them at once via Promise.all and rebuilds
                   `products` in the ORIGINAL file order afterward — order
                   must not depend on network completion order, since each
                   product's name/price fields were entered against a
                   specific file index in the composer UI. */
                _notify('Uploading media…', 'info');
                var uploadedUrls = await Promise.all(
                    Array.prototype.map.call(files, function (f) { return window._bizUploadMedia(f); })
                );
                for (var i = 0; i < files.length; i++) {
                    var url = uploadedUrls[i];
                    mediaUrls.push(url);
                    products.push({
                        url: url,
                        isVideo: !!(files[i].type && files[i].type.startsWith('video/')),
                        name: (files[i]._bizProductName  || '').trim(),
                        price: (files[i]._bizProductPrice || '').trim(),
                        currency: currency,
                        phone: phone.trim(),
                        address: address.trim()
                    });
                }
            }
        } catch (err) {
            _notify('Media upload failed: ' + (err.message || 'unknown'), 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i>Post'; }
            return;
        }

        var postId  = 'bizpost-' + Date.now() + '-' + (Math.random() * 1e6 | 0);
        var pageName   = bizData.name    || bizData.businessName || 'Business';
        var pageAvatar = bizData.profilePhoto || bizData.logo    || '';
        var pageCover  = bizData.coverPhoto   || bizData.coverImage || '';

        var doc = {
            id: postId,
            pageId: bizId,
            userId: us.id || '',
            username: us.username || us.fullName || 'User',
            pageName: pageName,
            pageAvatar: pageAvatar,
            pageCover: pageCover,
            text: content.trim(),
            media: mediaUrls,
            products: products,
            /* Post-level convenience copies (matches every item when
               there's only one — kept in sync with per-item values on
               edit). */
            phone: phone.trim(),
            address: address.trim(),
            currency: currency,
            likes: 0,
            comments: [],
            createdAt: Date.now()
        };

        window.fbDb.collection('business_posts').doc(postId).set(doc)
            .then(function () {
                _notify('Post published!', 'success');
                var ta = document.getElementById('business-post-content');
                if (ta) ta.value = '';
                window._bizPendingMedia = [];
                var preview = document.getElementById('biz-media-preview');
                if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
                /* Let app-business.js's own re-render pick this up — the
                   simplest reliable way to get an identical card (with our
                   Item Details row attached via the observer in §6) is to
                   just re-run the page's post loader. */
                if (typeof window.renderBusinessPage === 'function' && bizId) {
                    setTimeout(function () { window.renderBusinessPage(bizId); }, 150);
                }
            })
            .catch(function (err) {
                _notify('Could not save post: ' + (err.message || 'error'), 'error');
            })
            .finally(function () {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i>Post'; }
            });
    }

    window.submitBusinessPost = submitBusinessPostExtended;

    /* The original submit button was already wired to whatever
       window.submitBusinessPost pointed to at click-time by app-business.js's
       _wirePostComposer, so re-pointing the global (above) is enough on its
       own. Belt-and-suspenders: re-wire the button directly too, in case a
       future render recreates it or another patch captured the function by
       value instead of by name. */
    function _rewireSubmitBtn() {
        var submitBtn = document.getElementById('biz-post-submit-btn');
        if (!submitBtn || submitBtn._v22Wired) return;
        submitBtn._v22Wired = true;
        submitBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            submitBusinessPostExtended();
        }, true);
    }
    ready(function () { setTimeout(_rewireSubmitBtn, 450); });
    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && ev.detail.section === 'business-page') setTimeout(_rewireSubmitBtn, 250);
    });


    /* =========================================================================
       §5  ITEM DETAILS ROW — RENDER, EDIT MODAL, DELETE
       ========================================================================= */

    function _isOwnerOfPost(post) {
        if (_isAdmin()) return true;
        var us  = _us();
        var biz = window._activeBizData || {};
        if (biz.ownerId && us.id && biz.ownerId === us.id) return true;
        return !!(post.userId && us.id && post.userId === us.id);
    }

    function _buildItemRow(post, product, idx, isOwner) {
        var row = document.createElement('div');
        row.className = 'biz-item-row';
        row.dataset.idx = idx;
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 10px;'
            + 'border-radius:12px;background:#F9FAFB;border:1px solid rgba(0,0,0,0.05);';

        var thumb = product.url
            ? '<img src="' + _attr(product.url) + '" style="width:44px;height:44px;border-radius:9px;object-fit:cover;flex-shrink:0;">'
            : '<div style="width:44px;height:44px;border-radius:9px;background:rgba(27,43,139,0.08);'
              + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
              + '<i class="fas fa-box" style="color:#1B2B8B;font-size:0.9rem;"></i></div>';

        /* PRICE DISPLAY FIX (2026-08-07): NGOs / service-rendering
           organisations don't show listing price details — resolve the
           category for THIS item's own business page (falls back to the
           currently open page's data; see _resolveItemBizData) and blank
           the price string for non-product categories. Name/phone/address
           are left exactly as before — only price is affected, per spec. */
        var priceStr = _isPricedCategory(_resolveItemBizData(post))
            ? _fmtPrice(product.price, product.currency)
            : '';
        var metaBits = [];
        if (priceStr) metaBits.push('<strong style="color:#1B2B8B;">' + _esc(priceStr) + '</strong>');
        if (product.phone) metaBits.push('<a href="tel:' + _attr(product.phone) + '" style="color:#374151;text-decoration:none;">'
            + '<i class="fas fa-phone" style="font-size:0.68rem;margin-right:3px;"></i>' + _esc(product.phone) + '</a>');
        if (product.address) metaBits.push('<span style="color:#6B7280;"><i class="fas fa-map-marker-alt" style="font-size:0.68rem;margin-right:3px;"></i>'
            + _esc(product.address) + '</span>');

        row.innerHTML =
            thumb
            + '<div style="flex:1;min-width:0;">'
            + '<div style="font-size:0.84rem;font-weight:700;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
            + (product.name ? _esc(product.name) : '<span style="color:#9CA3AF;font-weight:500;">Untitled item</span>') + '</div>'
            + '<div style="font-size:0.72rem;display:flex;flex-wrap:wrap;gap:8px;margin-top:2px;">' + metaBits.join('') + '</div>'
            + '</div>'
            + (isOwner
                ? '<div style="display:flex;gap:6px;flex-shrink:0;">'
                  + '<button class="biz-item-edit-btn" title="Edit item" style="width:30px;height:30px;border-radius:8px;'
                  + 'border:none;background:rgba(27,43,139,0.08);color:#1B2B8B;cursor:pointer;"><i class="fas fa-pen" style="font-size:0.75rem;"></i></button>'
                  + '<button class="biz-item-delete-btn" title="Delete item" style="width:30px;height:30px;border-radius:8px;'
                  + 'border:none;background:rgba(239,68,68,0.08);color:#EF4444;cursor:pointer;"><i class="fas fa-trash" style="font-size:0.75rem;"></i></button>'
                  + '</div>'
                : '');

        return row;
    }

    function _openItemEditModal(postId, idx, product, onSaved) {
        var existing = document.getElementById('biz-item-edit-panel');
        if (existing) existing.remove();

        var panel = document.createElement('div');
        panel.id = 'biz-item-edit-panel';
        panel.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(10,14,39,0.65);'
            + 'display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);';
        var inner = document.createElement('div');
        inner.style.cssText = 'background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;'
            + 'max-height:88vh;overflow-y:auto;padding:22px 20px 30px;box-shadow:0 -8px 40px rgba(10,14,39,0.22);';

        function field(label, id, val) {
            return '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.72rem;font-weight:800;'
                + 'color:#374151;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">' + label + '</label>'
                + '<input type="text" id="' + id + '" value="' + _attr(val || '') + '" style="width:100%;box-sizing:border-box;'
                + 'border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;padding:9px 12px;font-size:0.88rem;'
                + 'color:#374151;outline:none;"></div>';
        }

        /* PRICE DISPLAY FIX (2026-08-07): this modal only ever opens for
           the owner from a row already inside #vf-biz-posts-list — i.e.
           always the page currently being viewed — so window._activeBizData
           is the right source, same as _isOwnerOfPost() above already
           assumes for the same reason. Price/Currency fields are omitted
           entirely for NGO/service categories rather than just hidden, to
           match app-business.js's own composer convention for the same
           rule. */
        var _showPriceFields = _isPricedCategory(window._activeBizData || {});

        inner.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
            + '<h3 style="margin:0;font-size:1rem;font-weight:900;color:#0A0E27;"><i class="fas fa-pen" style="color:#1B2B8B;margin-right:8px;"></i>Edit Item</h3>'
            + '<button id="biz-item-edit-close" style="background:rgba(10,14,39,0.07);border:none;width:32px;height:32px;'
            + 'border-radius:50%;font-size:0.95rem;cursor:pointer;color:#6B7280;"><i class="fas fa-times"></i></button></div>'
            + field('Item name', 'biz-item-edit-name', product.name)
            + (_showPriceFields ? field('Price', 'biz-item-edit-price', product.price) : '')
            + (_showPriceFields
                ? '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.72rem;font-weight:800;color:#374151;'
                  + 'text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">Currency</label>'
                  + _currencySelectHTML('biz-item-edit-currency', product.currency) + '</div>'
                : '')
            + field('Phone', 'biz-item-edit-phone', product.phone)
            + field('Address / location', 'biz-item-edit-address', product.address)
            + '<button id="biz-item-edit-save" style="width:100%;padding:12px;border-radius:12px;'
            + 'background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;border:none;font-weight:800;'
            + 'font-size:0.9rem;cursor:pointer;margin-top:6px;"><i class="fas fa-save" style="margin-right:7px;"></i>Save Item</button>';

        panel.appendChild(inner);
        document.body.appendChild(panel);
        document.getElementById('biz-item-edit-close').addEventListener('click', function () { panel.remove(); });
        panel.addEventListener('click', function (e) { if (e.target === panel) panel.remove(); });

        document.getElementById('biz-item-edit-save').addEventListener('click', function () {
            var saveBtn = this;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:7px;"></i>Saving…';

            var updated = {
                name:     (document.getElementById('biz-item-edit-name')     || {}).value || '',
                price:    (document.getElementById('biz-item-edit-price')    || {}).value || '',
                currency: (document.getElementById('biz-item-edit-currency') || {}).value || DEFAULT_CURRENCY,
                phone:    (document.getElementById('biz-item-edit-phone')    || {}).value || '',
                address:  (document.getElementById('biz-item-edit-address') || {}).value || ''
            };

            if (!_fbOk()) { _notify('Not connected — please try again.', 'error'); saveBtn.disabled = false; return; }

            window.fbDb.collection('business_posts').doc(postId).get().then(function (d) {
                if (!d.exists) throw new Error('Post no longer exists');
                var data = d.data();
                var products = Array.isArray(data.products) ? data.products.slice() : [];
                if (!products[idx]) throw new Error('Item no longer exists');
                products[idx] = Object.assign({}, products[idx], updated);
                return window.fbDb.collection('business_posts').doc(postId).update({ products: products })
                    .then(function () { return products[idx]; });
            }).then(function (savedProduct) {
                panel.remove();
                _notify('Item updated!', 'success');
                if (typeof onSaved === 'function') onSaved(savedProduct);
            }).catch(function (err) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save" style="margin-right:7px;"></i>Save Item';
                _notify('Failed to save: ' + (err && err.message ? err.message : 'please try again.'), 'error');
            });
        });
    }

    function _deleteItem(postId, idx, cardEl, rowEl) {
        if (!confirm('Delete this item?')) return;
        if (!_fbOk()) { _notify('Not connected — please try again.', 'error'); return; }

        window.fbDb.collection('business_posts').doc(postId).get().then(function (d) {
            if (!d.exists) throw new Error('Post no longer exists');
            var data     = d.data();
            var products = Array.isArray(data.products) ? data.products.slice() : [];
            var media    = Array.isArray(data.media)    ? data.media.slice()    : [];
            products.splice(idx, 1);
            if (media[idx] !== undefined) media.splice(idx, 1);

            if (!products.length) {
                /* Last item in the post — remove the whole post, same as
                   the existing "delete post" action elsewhere in the app. */
                return window.fbDb.collection('business_posts').doc(postId).delete().then(function () {
                    return { deletedWholePost: true };
                });
            }
            return window.fbDb.collection('business_posts').doc(postId).update({ products: products, media: media })
                .then(function () { return { deletedWholePost: false }; });
        }).then(function (result) {
            _notify('Item deleted.', 'success');
            if (result.deletedWholePost && cardEl) {
                cardEl.remove();
            } else if (rowEl) {
                rowEl.remove();
            }
        }).catch(function (err) {
            _notify('Failed to delete: ' + (err && err.message ? err.message : 'please try again.'), 'error');
        });
    }

    function _renderItemsBlock(card, post) {
        var products = Array.isArray(post.products) ? post.products : [];
        /* Only show items that actually carry a name, price, phone or
           address — plain photo/video posts with no product info stay
           exactly as app-business.js already renders them. */
        var meaningful = products.filter(function (p) {
            return p && (p.name || p.price || p.phone || p.address);
        });
        if (!meaningful.length) return;

        var isOwner = _isOwnerOfPost(post);
        var block = document.createElement('div');
        block.className = 'biz-items-block';
        block.style.cssText = 'padding:0 16px 14px;display:flex;flex-direction:column;gap:8px;';

        function _wireRow(row, currentProduct, idx) {
            var editBtn = row.querySelector('.biz-item-edit-btn');
            var delBtn  = row.querySelector('.biz-item-delete-btn');
            if (editBtn) {
                editBtn.addEventListener('click', function () {
                    _openItemEditModal(post.id, idx, currentProduct, function (savedProduct) {
                        var fresh = _buildItemRow(post, savedProduct, idx, isOwner);
                        row.replaceWith(fresh);
                        _wireRow(fresh, savedProduct, idx);
                    });
                });
            }
            if (delBtn) {
                delBtn.addEventListener('click', function () {
                    _deleteItem(post.id, idx, card, row);
                });
            }
        }

        products.forEach(function (product, idx) {
            if (!product || !(product.name || product.price || product.phone || product.address)) return;
            var row = _buildItemRow(post, product, idx, isOwner);
            block.appendChild(row);
            if (isOwner) _wireRow(row, product, idx);
        });

        /* Insert right after the media grid (or after the header if no
           media), before the like/comment/share action bar. */
        var actionBar = card.querySelector('[style*="justify-content:space-around"]');
        if (actionBar) {
            card.insertBefore(block, actionBar);
        } else {
            card.appendChild(block);
        }
    }


    /* =========================================================================
       §6  MUTATION OBSERVER — ATTACH ITEM DETAILS TO BUSINESS-PAGE CARDS ONLY
       ────────────────────────────────────────────────────────────────────
       IMPORTANT: business post cards (.biz-post-card) render in TWO places —
       inside the Business Page's own "Posts & Listings" list
       (#vf-biz-posts-list), AND as ordinary posts in the general public
       dashboard/home feed (the same card markup gets reused there). The
       Item Details row (price/name/phone/address + edit/delete) must only
       ever show up in the first location — a stranger scrolling the public
       feed has no business seeing another user's edit/delete controls, or
       even the phone number laid out like that outside its own page
       context. So every card is checked against #vf-biz-posts-list before
       anything gets attached; cards anywhere else are left completely
       untouched.
       ========================================================================= */

    function _isInsideBusinessPageList(card) {
        return !!(card.closest && card.closest('#vf-biz-posts-list'));
    }

    function _fetchAndEnhanceCard(card) {
        if (!_isInsideBusinessPageList(card)) return;
        var postId = card.dataset.postId;
        if (!postId || card._itemsEnhanced) return;
        card._itemsEnhanced = true;
        if (!_fbOk()) return;
        window.fbDb.collection('business_posts').doc(postId).get().then(function (d) {
            if (!d.exists) return;
            var post = d.data();
            post.id = d.id;
            _renderItemsBlock(card, post);
        }).catch(function (err) {
            console.warn('[BizPatch v22] could not load item details:', err && err.message);
        });
    }

    function _scanForCards(root) {
        var list = document.getElementById('vf-biz-posts-list');
        if (!list) return; // not currently on the Business Page — nothing to do
        if (root.querySelectorAll) {
            root.querySelectorAll('.biz-post-card').forEach(_fetchAndEnhanceCard);
        }
        if (root.classList && root.classList.contains('biz-post-card')) _fetchAndEnhanceCard(root);
    }

    /* FIX (composer silently losing phone/address/currency + Item Details
       after some re-renders): _rewireSubmitBtn/_injectComposerFields were
       only ever re-run on `ready()` (once) and on the 'empyrean-section-
       change' event. app-business.js's renderBusinessPage() replaces the
       ENTIRE #business-page section's innerHTML — including #biz-post-
       submit-btn and #biz-post-composer — on several OTHER paths that
       don't fire that event: right after a post is submitted, after
       "Edit Page" saves, from the "My Pages" switcher, and from the
       owner-detection safety-net re-render. Each of those left a brand
       new submit button with only app-business.js's own bubble-phase
       listener attached, not this file's capture-phase override — so the
       extended (Listing Details–aware) submit path would silently stop
       being used until the user happened to navigate away and back.
       Folding this into the same MutationObserver that already watches
       #vf-biz-posts-list for new cards means every re-render re-arms both,
       regardless of which code path triggered it. */
    function _rewireOnRerender(root) {
        if (!document.getElementById('business-post-content')) return; // not on Business Page
        _injectComposerFields();
        _rewireSubmitBtn();
    }

    var _itemsObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes && m.addedNodes.forEach(function (node) {
                if (node.nodeType !== 1) return;
                _scanForCards(node);
                _rewireOnRerender(node);
            });
        });
    });
    _itemsObserver.observe(document.body, { childList: true, subtree: true });

    /* Initial pass in case cards already exist when this script loads. */
    ready(function () { setTimeout(function () { _scanForCards(document.body); }, 600); });


    /* =========================================================================
       §7  CREATE BUSINESS PAGE BUTTON — ONE CONSOLIDATED OPENER
       ========================================================================= */

    /* Every id/class/attribute this button has been given across the
       codebase's history, plus the inline-onclick variant (matched via an
       attribute-contains selector, since that one has no id or class at
       all). */
    var CREATE_BIZ_BTN_SELECTOR = [
        '#open-create-biz-page-btn',
        '#create-business-page-btn',
        '#create-page-btn',
        '#biz-mypage-create-tile',
        '[data-action="open-biz-modal"]',
        '[data-action="create-business-page"]',
        '.open-create-biz-btn',
        '.create-biz-page-btn',
        '.create-business-page-btn',
        'button[onclick*="create-business-page-modal"]'
    ].join(',');

    /* Belt-and-suspenders fallback: any short button/link whose visible
       text is unmistakably this action, even under an id/class this list
       doesn't know about — in case a not-yet-seen variant exists in one of
       the many patch files (v2–v21, app-business-feedcard.js) this fix
       didn't have visibility into. Length-capped so it can't fire on a
       paragraph that merely mentions the phrase. */
    function _looksLikeCreateBizButton(el) {
        if (!el || !el.tagName) return false;
        var tag = el.tagName.toLowerCase();
        if (tag !== 'button' && tag !== 'a') return false;
        var t = (el.textContent || '').trim().toLowerCase();
        if (t.length > 40) return false;
        return /create\s+(a\s+)?(new\s+)?business\s+page/.test(t);
    }

    function _forceOpenCreateBizModal() {
        var m = document.getElementById('create-business-page-modal');
        if (!m) return false;
        m.style.display = 'flex';
        m.classList.add('show');
        document.body.classList.add('modal-open');
        return true;
    }

    /* Capture phase, attached the instant this script runs — no waiting on
       DOMContentLoaded, empyrean-init-done, or section-change, so it can't
       lose a timing race on a slower production load. Capture phase also
       means it runs before any other click handler on the same button, so
       even if that handler's own logic no-ops, the modal still opens. */
    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest(CREATE_BIZ_BTN_SELECTOR);
        if (!btn) {
            var node = e.target, hops = 0;
            while (node && hops < 4) {
                if (_looksLikeCreateBizButton(node)) { btn = node; break; }
                node = node.parentElement;
                hops++;
            }
        }
        if (!btn) return;

        if (_isGuest()) {
            _notify('Please log in to create a business page.', 'info');
            return;
        }
        _forceOpenCreateBizModal();
    }, true);

    console.log('[BizPatch v22] ✅ Item Details (currency/phone/address/edit/delete) + Create-Page button consolidation active.');

})();