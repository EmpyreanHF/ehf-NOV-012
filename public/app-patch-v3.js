/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v3
   app-patch-v3.js

   FIXES & ADDITIONS
   ─────────────────
   [1] Business Page — Share button + Promotion Campaign modal
       • Share button injected into action row (beside Follow / Edit Page)
       • Promotion Campaign modal: budget, duration, audience targeting,
         campaign objective — writes to Firestore `promotions` collection
         (owner-only; shown via "Promote Page" button in action row)

   [2] Quote Tweet modal — missing send button fix
       • Re-wires .vf-th-quote-submit via event delegation so that
         app-fix-final.js mining wrapper override of window._submitQuote
         is always honoured (old direct-reference bind was stale)
       • Adds a visible paper-plane Send icon to the Quote button so the
         button is unmistakably a "send" action
   ============================================================================= */

(function empyreanPatchV3() {
    'use strict';

    /* ── helpers (mirror what app-business.js uses) ── */
    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    function _isGuest() { var s = _S(); return s.isGuest != null ? !!s.isGuest : !!window.isGuest; }
    function _isAdmin() { return !!(window.isAdmin || _S().isAdmin); }
    function _fbOk()    { return !!(window._firebaseLoaded && window.fbDb); }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }


    /* =========================================================================
       PATCH 1 — BUSINESS PAGE: SHARE BUTTON + PROMOTION CAMPAIGN
       ========================================================================= */

    (function patchBusinessPage() {

        /* ── Inject styles (once) ── */
        _ready(function () {
            if (document.getElementById('_biz_patch_v3_css')) return;
            var s = document.createElement('style');
            s.id = '_biz_patch_v3_css';
            s.textContent = [
                /* Share button */
                '#biz-share-btn{',
                '  padding:9px 22px;border-radius:50px;font-size:0.88rem;font-weight:700;',
                '  background:rgba(27,43,139,0.07);color:#1B2B8B;',
                '  border:2px solid rgba(27,43,139,0.2);cursor:pointer;',
                '  display:inline-flex;align-items:center;gap:6px;',
                '  transition:background 0.18s,transform 0.15s;',
                '}',
                '#biz-share-btn:hover{background:rgba(27,43,139,0.14);transform:translateY(-1px);}',
                '#biz-share-btn:active{transform:translateY(0);}',

                /* Promote button */
                '#biz-promote-btn{',
                '  padding:9px 22px;border-radius:50px;font-size:0.88rem;font-weight:700;',
                '  background:linear-gradient(135deg,#F5C518,#e6a800);color:#0A0E27;',
                '  border:none;cursor:pointer;',
                '  display:inline-flex;align-items:center;gap:6px;',
                '  box-shadow:0 4px 14px rgba(245,197,24,0.35);',
                '  transition:opacity 0.18s,transform 0.15s;',
                '}',
                '#biz-promote-btn:hover{opacity:0.9;transform:translateY(-1px);}',
                '#biz-promote-btn:active{transform:translateY(0);}',

                /* ── Promotion Campaign Modal ── */
                '#biz-promo-modal{',
                '  display:none;position:fixed;inset:0;z-index:200000;',
                '  background:rgba(10,14,39,0.7);backdrop-filter:blur(6px);',
                '  align-items:center;justify-content:center;padding:16px;',
                '}',
                '#biz-promo-modal.vf-open{display:flex;}',
                '#biz-promo-inner{',
                '  background:#fff;border-radius:24px;width:100%;max-width:480px;',
                '  max-height:90vh;overflow-y:auto;',
                '  box-shadow:0 24px 80px rgba(10,14,39,0.3);',
                '  animation:promoSlideUp 0.28s cubic-bezier(0.34,1.56,0.64,1);',
                '}',
                '@keyframes promoSlideUp{',
                '  from{opacity:0;transform:translateY(40px) scale(0.97);}',
                '  to{opacity:1;transform:translateY(0) scale(1);}',
                '}',
                '#biz-promo-header{',
                '  padding:22px 24px 0;',
                '  display:flex;align-items:center;justify-content:space-between;',
                '}',
                '#biz-promo-header h3{',
                '  margin:0;font-size:1.1rem;font-weight:900;color:#0A0E27;',
                '  display:flex;align-items:center;gap:9px;',
                '}',
                '#biz-promo-close{',
                '  background:rgba(10,14,39,0.06);border:none;',
                '  width:32px;height:32px;border-radius:50%;',
                '  display:flex;align-items:center;justify-content:center;',
                '  cursor:pointer;color:#6B7280;font-size:0.9rem;',
                '  transition:background 0.15s;',
                '}',
                '#biz-promo-close:hover{background:rgba(10,14,39,0.12);}',
                '#biz-promo-body{padding:20px 24px 24px;}',
                '.biz-promo-field{margin-bottom:18px;}',
                '.biz-promo-field label{',
                '  display:block;font-size:0.78rem;font-weight:800;',
                '  color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;',
                '}',
                '.biz-promo-field input,.biz-promo-field select,.biz-promo-field textarea{',
                '  width:100%;box-sizing:border-box;',
                '  border:1.5px solid rgba(10,14,39,0.12);border-radius:12px;',
                '  padding:11px 14px;font-size:0.9rem;color:#374151;',
                '  background:#F9FAFB;outline:none;font-family:inherit;',
                '  transition:border-color 0.18s;',
                '}',
                '.biz-promo-field input:focus,.biz-promo-field select:focus,.biz-promo-field textarea:focus{',
                '  border-color:#1B2B8B;background:#fff;',
                '}',
                /* Budget tiles */
                '.biz-promo-budgets{display:flex;gap:8px;flex-wrap:wrap;}',
                '.biz-promo-budget-tile{',
                '  flex:1 1 80px;padding:10px 6px;border-radius:12px;',
                '  border:2px solid rgba(10,14,39,0.1);',
                '  background:#F9FAFB;cursor:pointer;text-align:center;',
                '  font-size:0.82rem;font-weight:700;color:#374151;',
                '  transition:all 0.15s;',
                '}',
                '.biz-promo-budget-tile:hover{border-color:#1B2B8B;background:rgba(27,43,139,0.06);}',
                '.biz-promo-budget-tile.selected{',
                '  border-color:#1B2B8B;background:rgba(27,43,139,0.1);color:#1B2B8B;',
                '  box-shadow:0 0 0 3px rgba(27,43,139,0.15);',
                '}',
                '.biz-promo-budget-tile .tile-amount{font-size:1rem;font-weight:900;display:block;}',
                '.biz-promo-budget-tile .tile-label{font-size:0.67rem;color:#9CA3AF;font-weight:600;}',
                /* Duration tiles */
                '.biz-promo-durations{display:flex;gap:8px;flex-wrap:wrap;}',
                '.biz-promo-dur-tile{',
                '  flex:1 1 60px;padding:10px 6px;border-radius:12px;',
                '  border:2px solid rgba(10,14,39,0.1);',
                '  background:#F9FAFB;cursor:pointer;text-align:center;',
                '  font-size:0.82rem;font-weight:700;color:#374151;',
                '  transition:all 0.15s;',
                '}',
                '.biz-promo-dur-tile:hover{border-color:#5B0EA6;background:rgba(91,14,166,0.06);}',
                '.biz-promo-dur-tile.selected{',
                '  border-color:#5B0EA6;background:rgba(91,14,166,0.1);color:#5B0EA6;',
                '  box-shadow:0 0 0 3px rgba(91,14,166,0.15);',
                '}',
                /* Payment method tiles */
                '.biz-promo-pays{display:flex;gap:8px;}',
                '.biz-promo-pay-tile{',
                '  flex:1 1 50%;padding:12px 10px;border-radius:12px;',
                '  border:2px solid rgba(10,14,39,0.1);',
                '  background:#F9FAFB;cursor:pointer;text-align:center;',
                '  font-size:0.82rem;font-weight:700;color:#374151;',
                '  transition:all 0.15s;',
                '}',
                '.biz-promo-pay-tile i{display:block;font-size:1.1rem;margin-bottom:4px;}',
                '.biz-promo-pay-tile:hover{border-color:#0E8A4B;background:rgba(14,138,75,0.06);}',
                '.biz-promo-pay-tile.selected{',
                '  border-color:#0E8A4B;background:rgba(14,138,75,0.1);color:#0E8A4B;',
                '  box-shadow:0 0 0 3px rgba(14,138,75,0.15);',
                '}',
                '.biz-promo-pay-tile .tile-sub{display:block;font-size:0.66rem;font-weight:600;color:#9CA3AF;margin-top:2px;}',
                /* Audience chips */
                '.biz-promo-audiences{display:flex;gap:7px;flex-wrap:wrap;}',
                '.biz-promo-aud{',
                '  padding:7px 14px;border-radius:20px;font-size:0.78rem;font-weight:700;',
                '  border:1.5px solid rgba(10,14,39,0.1);background:#F9FAFB;',
                '  cursor:pointer;color:#374151;transition:all 0.15s;',
                '}',
                '.biz-promo-aud:hover{border-color:#1B2B8B;background:rgba(27,43,139,0.07);}',
                '.biz-promo-aud.selected{',
                '  border-color:#1B2B8B;background:#1B2B8B;color:#fff;',
                '}',
                /* Objective radio cards */
                '.biz-promo-objectives{display:flex;flex-direction:column;gap:8px;}',
                '.biz-promo-obj{',
                '  display:flex;align-items:center;gap:12px;',
                '  padding:12px 14px;border-radius:12px;',
                '  border:1.5px solid rgba(10,14,39,0.1);background:#F9FAFB;',
                '  cursor:pointer;transition:all 0.15s;',
                '}',
                '.biz-promo-obj:hover{border-color:#1B2B8B;}',
                '.biz-promo-obj.selected{border-color:#1B2B8B;background:rgba(27,43,139,0.07);}',
                '.biz-promo-obj-icon{',
                '  width:38px;height:38px;border-radius:10px;flex-shrink:0;',
                '  display:flex;align-items:center;justify-content:center;',
                '  background:rgba(27,43,139,0.1);color:#1B2B8B;font-size:1rem;',
                '}',
                '.biz-promo-obj.selected .biz-promo-obj-icon{background:#1B2B8B;color:#fff;}',
                '.biz-promo-obj-label{font-size:0.86rem;font-weight:700;color:#0A0E27;}',
                '.biz-promo-obj-desc{font-size:0.73rem;color:#6B7280;margin-top:2px;}',
                /* Submit row */
                '#biz-promo-submit-row{',
                '  display:flex;gap:10px;justify-content:flex-end;',
                '  padding-top:18px;border-top:1px solid rgba(10,14,39,0.07);margin-top:4px;',
                '}',
                '#biz-promo-cancel{',
                '  padding:11px 22px;border-radius:50px;',
                '  border:1.5px solid rgba(10,14,39,0.15);background:none;',
                '  font-size:0.88rem;font-weight:700;color:#6B7280;cursor:pointer;',
                '}',
                '#biz-promo-launch{',
                '  padding:11px 28px;border-radius:50px;border:none;',
                '  background:linear-gradient(135deg,#1B2B8B,#5B0EA6);',
                '  color:#fff;font-size:0.88rem;font-weight:700;cursor:pointer;',
                '  display:inline-flex;align-items:center;gap:7px;',
                '  box-shadow:0 4px 16px rgba(91,14,166,0.3);',
                '  transition:opacity 0.18s;',
                '}',
                '#biz-promo-launch:disabled{opacity:0.55;cursor:not-allowed;}',

                /* ── Share sheet ── */
                '#biz-share-sheet{',
                '  display:none;position:fixed;inset:0;z-index:200001;',
                '  background:rgba(10,14,39,0.55);backdrop-filter:blur(5px);',
                '  align-items:flex-end;justify-content:center;',
                '}',
                '#biz-share-sheet.vf-open{display:flex;}',
                '#biz-share-inner{',
                '  background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:520px;',
                '  padding:20px 20px 32px;',
                '  animation:shareSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);',
                '}',
                '@keyframes shareSlideUp{',
                '  from{transform:translateY(100%);}',
                '  to{transform:translateY(0);}',
                '}',
                '#biz-share-inner h4{margin:0 0 16px;font-size:1rem;font-weight:900;color:#0A0E27;}',
                '.biz-share-row{display:flex;gap:12px;flex-wrap:wrap;}',
                '.biz-share-opt{',
                '  flex:0 0 auto;display:flex;flex-direction:column;align-items:center;',
                '  gap:7px;padding:12px 16px;border-radius:16px;',
                '  border:1.5px solid rgba(10,14,39,0.08);background:#F9FAFB;',
                '  cursor:pointer;transition:all 0.18s;min-width:70px;',
                '}',
                '.biz-share-opt:hover{background:rgba(27,43,139,0.06);border-color:rgba(27,43,139,0.2);transform:translateY(-2px);}',
                '.biz-share-opt i{font-size:1.3rem;}',
                '.biz-share-opt span{font-size:0.7rem;font-weight:700;color:#374151;}',
                '#biz-share-url-row{margin-top:16px;display:flex;gap:8px;align-items:center;}',
                '#biz-share-url-inp{',
                '  flex:1;border:1.5px solid rgba(10,14,39,0.1);border-radius:10px;',
                '  padding:10px 12px;font-size:0.8rem;color:#374151;background:#F9FAFB;outline:none;',
                '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
                '}',
                '#biz-share-copy-btn{',
                '  padding:10px 16px;border-radius:10px;border:none;',
                '  background:#1B2B8B;color:#fff;font-size:0.8rem;font-weight:700;cursor:pointer;',
                '  white-space:nowrap;transition:opacity 0.15s;',
                '}',
                '#biz-share-copy-btn:active{opacity:0.75;}',
                '#biz-share-dismiss{',
                '  display:block;width:100%;margin-top:14px;padding:11px;',
                '  border-radius:14px;border:none;background:rgba(10,14,39,0.05);',
                '  font-size:0.88rem;font-weight:700;color:#6B7280;cursor:pointer;',
                '}',
            ].join('\n');
            document.head.appendChild(s);
        });

        /* ── Ensure Promotion modal exists ── */
        function _ensurePromoModal() {
            if (document.getElementById('biz-promo-modal')) return document.getElementById('biz-promo-modal');

            var modal = document.createElement('div');
            modal.id = 'biz-promo-modal';
            modal.innerHTML = [
                '<div id="biz-promo-inner">',
                '  <div id="biz-promo-header">',
                '    <h3><i class="fas fa-rocket" style="color:#F5C518;"></i>Launch Promotion</h3>',
                '    <button id="biz-promo-close" aria-label="Close"><i class="fas fa-times"></i></button>',
                '  </div>',
                '  <div id="biz-promo-body">',

                /* Objective */
                '    <div class="biz-promo-field">',
                '      <label>Campaign Objective</label>',
                '      <div class="biz-promo-objectives">',
                '        <div class="biz-promo-obj selected" data-obj="awareness">',
                '          <div class="biz-promo-obj-icon"><i class="fas fa-bullhorn"></i></div>',
                '          <div><div class="biz-promo-obj-label">Brand Awareness</div>',
                '            <div class="biz-promo-obj-desc">Reach more people & grow visibility</div></div>',
                '        </div>',
                '        <div class="biz-promo-obj" data-obj="followers">',
                '          <div class="biz-promo-obj-icon"><i class="fas fa-user-plus"></i></div>',
                '          <div><div class="biz-promo-obj-label">Grow Followers</div>',
                '            <div class="biz-promo-obj-desc">Drive page follows & engagement</div></div>',
                '        </div>',
                '        <div class="biz-promo-obj" data-obj="sales">',
                '          <div class="biz-promo-obj-icon"><i class="fas fa-shopping-bag"></i></div>',
                '          <div><div class="biz-promo-obj-label">Drive Sales</div>',
                '            <div class="biz-promo-obj-desc">Promote products & offers</div></div>',
                '        </div>',
                '        <div class="biz-promo-obj" data-obj="traffic">',
                '          <div class="biz-promo-obj-icon"><i class="fas fa-globe"></i></div>',
                '          <div><div class="biz-promo-obj-label">Website Traffic</div>',
                '            <div class="biz-promo-obj-desc">Send visitors to your website</div></div>',
                '        </div>',
                '      </div>',
                '    </div>',

                /* Budget */
                '    <div class="biz-promo-field">',
                '      <label>Daily Budget (EMPY)</label>',
                '      <div class="biz-promo-budgets">',
                '        <div class="biz-promo-budget-tile selected" data-budget="50">',
                '          <span class="tile-amount">50</span><span class="tile-label">Starter</span>',
                '        </div>',
                '        <div class="biz-promo-budget-tile" data-budget="150">',
                '          <span class="tile-amount">150</span><span class="tile-label">Growth</span>',
                '        </div>',
                '        <div class="biz-promo-budget-tile" data-budget="300">',
                '          <span class="tile-amount">300</span><span class="tile-label">Boost</span>',
                '        </div>',
                '        <div class="biz-promo-budget-tile" data-budget="500">',
                '          <span class="tile-amount">500</span><span class="tile-label">Pro</span>',
                '        </div>',
                '        <div class="biz-promo-budget-tile" data-budget="custom">',
                '          <span class="tile-amount"><i class="fas fa-pen" style="font-size:0.75rem;"></i></span><span class="tile-label">Custom</span>',
                '        </div>',
                '      </div>',
                '      <input type="number" id="biz-promo-custom-budget" placeholder="Enter custom amount…"',
                '        min="10" style="margin-top:10px;display:none;">',
                '    </div>',

                /* Duration */
                '    <div class="biz-promo-field">',
                '      <label>Campaign Duration</label>',
                '      <div class="biz-promo-durations">',
                '        <div class="biz-promo-dur-tile selected" data-days="3">3 days</div>',
                '        <div class="biz-promo-dur-tile" data-days="7">7 days</div>',
                '        <div class="biz-promo-dur-tile" data-days="14">14 days</div>',
                '        <div class="biz-promo-dur-tile" data-days="30">30 days</div>',
                '      </div>',
                '    </div>',

                /* Payment method — EMPY wallet or Fiat (card/bank via Flutterwave) */
                '    <div class="biz-promo-field">',
                '      <label>Pay With</label>',
                '      <div class="biz-promo-pays">',
                '        <div class="biz-promo-pay-tile selected" data-pay="wallet">',
                '          <i class="fas fa-coins"></i>EMPY Wallet<span class="tile-sub">from your balance</span>',
                '        </div>',
                '        <div class="biz-promo-pay-tile" data-pay="card">',
                '          <i class="fas fa-credit-card"></i>Card / Bank<span class="tile-sub">Naira via Flutterwave</span>',
                '        </div>',
                '      </div>',
                '    </div>',

                /* Target audience */
                '    <div class="biz-promo-field">',
                '      <label>Target Audience</label>',
                '      <div class="biz-promo-audiences">',
                '        <div class="biz-promo-aud selected" data-aud="all">All users</div>',
                '        <div class="biz-promo-aud" data-aud="followers">My followers</div>',
                '        <div class="biz-promo-aud" data-aud="similar">Similar pages</div>',
                '        <div class="biz-promo-aud" data-aud="local">Local users</div>',
                '        <div class="biz-promo-aud" data-aud="interests">By interests</div>',
                '      </div>',
                '    </div>',

                /* Ad headline */
                '    <div class="biz-promo-field">',
                '      <label>Ad Headline <span style="font-weight:400;color:#9CA3AF;font-size:0.7rem;text-transform:none;">(optional)</span></label>',
                '      <input type="text" id="biz-promo-headline" placeholder="e.g. 50% Off This Week Only!" maxlength="80">',
                '    </div>',

                /* Call to action */
                '    <div class="biz-promo-field">',
                '      <label>Call to Action</label>',
                '      <select id="biz-promo-cta">',
                '        <option value="learn_more">Learn More</option>',
                '        <option value="follow">Follow Page</option>',
                '        <option value="shop_now">Shop Now</option>',
                '        <option value="visit_website">Visit Website</option>',
                '        <option value="contact_us">Contact Us</option>',
                '        <option value="get_offer">Get Offer</option>',
                '      </select>',
                '    </div>',

                /* Summary + submit */
                '    <div id="biz-promo-summary" style="',
                '      margin-bottom:16px;padding:14px;border-radius:14px;',
                '      background:linear-gradient(135deg,rgba(27,43,139,0.05),rgba(91,14,166,0.05));',
                '      border:1px solid rgba(27,43,139,0.12);font-size:0.82rem;color:#374151;',
                '      line-height:1.7;',
                '    "></div>',

                '    <div id="biz-promo-submit-row">',
                '      <button id="biz-promo-cancel">Cancel</button>',
                '      <button id="biz-promo-launch">',
                '        <i class="fas fa-rocket"></i> Launch Campaign',
                '      </button>',
                '    </div>',

                '  </div>',
                '</div>',
            ].join('');
            document.body.appendChild(modal);

            /* State */
            var _state = { obj: 'awareness', budget: 50, days: 3, audiences: ['all'], cta: 'learn_more', headline: '', pay: 'wallet' };

            function _empyToNgn(empy) {
                var usdRate = window.EMPY_RATE_USD   || 0.10;
                var ngnRate = window.USD_TO_NGN_RATE || 1500;
                return Math.round(empy * usdRate * ngnRate);
            }

            function _updateSummary() {
                var totalCost = _state.budget * _state.days;
                var objLabels = { awareness:'Brand Awareness', followers:'Grow Followers', sales:'Drive Sales', traffic:'Website Traffic' };
                var el = document.getElementById('biz-promo-summary');
                if (!el) return;
                var costLine = (_state.pay === 'card')
                    ? '<strong>' + _state.budget + ' EMPY/day × ' + _state.days + ' days ≈ ₦' + _empyToNgn(totalCost).toLocaleString() + ' total</strong>'
                    : '<strong>' + _state.budget + ' EMPY/day × ' + _state.days + ' days = ' + totalCost + ' EMPY total</strong>';
                el.innerHTML =
                    '<strong>📊 Campaign Summary</strong><br>' +
                    '<i class="fas fa-crosshairs" style="width:14px;color:#1B2B8B;margin-right:4px;"></i> Objective: <strong>' + (objLabels[_state.obj] || _state.obj) + '</strong><br>' +
                    '<i class="fas fa-coins" style="width:14px;color:#1B2B8B;margin-right:4px;"></i> Budget: ' + costLine + '<br>' +
                    '<i class="fas fa-users" style="width:14px;color:#1B2B8B;margin-right:4px;"></i> Audience: <strong>' + _state.audiences.join(', ') + '</strong><br>' +
                    '<i class="fas fa-wallet" style="width:14px;color:#1B2B8B;margin-right:4px;"></i> Payment: <strong>' + (_state.pay === 'card' ? 'Card / Bank (Naira)' : 'EMPY Wallet') + '</strong>';
            }

            /* Objective tiles */
            modal.querySelectorAll('.biz-promo-obj').forEach(function (tile) {
                tile.addEventListener('click', function () {
                    modal.querySelectorAll('.biz-promo-obj').forEach(function (t) { t.classList.remove('selected'); });
                    tile.classList.add('selected');
                    _state.obj = tile.dataset.obj;
                    _updateSummary();
                });
            });

            /* Budget tiles */
            var customBudgetInp = document.getElementById('biz-promo-custom-budget');
            modal.querySelectorAll('.biz-promo-budget-tile').forEach(function (tile) {
                tile.addEventListener('click', function () {
                    modal.querySelectorAll('.biz-promo-budget-tile').forEach(function (t) { t.classList.remove('selected'); });
                    tile.classList.add('selected');
                    if (tile.dataset.budget === 'custom') {
                        customBudgetInp.style.display = 'block';
                        customBudgetInp.focus();
                    } else {
                        customBudgetInp.style.display = 'none';
                        _state.budget = parseInt(tile.dataset.budget, 10);
                        _updateSummary();
                    }
                });
            });
            if (customBudgetInp) {
                customBudgetInp.addEventListener('input', function () {
                    var v = parseInt(customBudgetInp.value, 10);
                    if (v > 0) { _state.budget = v; _updateSummary(); }
                });
            }

            /* Duration tiles */
            modal.querySelectorAll('.biz-promo-dur-tile').forEach(function (tile) {
                tile.addEventListener('click', function () {
                    modal.querySelectorAll('.biz-promo-dur-tile').forEach(function (t) { t.classList.remove('selected'); });
                    tile.classList.add('selected');
                    _state.days = parseInt(tile.dataset.days, 10);
                    _updateSummary();
                });
            });

            /* Payment method tiles */
            modal.querySelectorAll('.biz-promo-pay-tile').forEach(function (tile) {
                tile.addEventListener('click', function () {
                    modal.querySelectorAll('.biz-promo-pay-tile').forEach(function (t) { t.classList.remove('selected'); });
                    tile.classList.add('selected');
                    _state.pay = tile.dataset.pay;
                    _updateSummary();
                });
            });


            /* Audience chips (multi-select) */
            modal.querySelectorAll('.biz-promo-aud').forEach(function (chip) {
                chip.addEventListener('click', function () {
                    chip.classList.toggle('selected');
                    _state.audiences = Array.from(modal.querySelectorAll('.biz-promo-aud.selected')).map(function (c) { return c.dataset.aud; });
                    if (!_state.audiences.length) {
                        chip.classList.add('selected');
                        _state.audiences = [chip.dataset.aud];
                    }
                    _updateSummary();
                });
            });

            /* CTA select */
            var ctaSel = document.getElementById('biz-promo-cta');
            if (ctaSel) ctaSel.addEventListener('change', function () { _state.cta = ctaSel.value; });

            /* Headline */
            var headlineInp = document.getElementById('biz-promo-headline');
            if (headlineInp) headlineInp.addEventListener('input', function () { _state.headline = headlineInp.value; });

            /* Close */
            document.getElementById('biz-promo-close').addEventListener('click', _closePromo);
            document.getElementById('biz-promo-cancel').addEventListener('click', _closePromo);
            modal.addEventListener('click', function (e) { if (e.target === modal) _closePromo(); });

            /* Launch */
            document.getElementById('biz-promo-launch').addEventListener('click', function () {
                var btn = document.getElementById('biz-promo-launch');
                if (!_fbOk()) { _notify('Not connected — please try again.', 'error'); return; }

                var bizId   = window._activeBizPageId || '';
                var bizData = window._activeBizData   || {};
                var us      = _us();

                if (!bizId) { _notify('No active business page.', 'error'); return; }
                if (!us.id) { _notify('Please sign in first.', 'error'); return; }

                /* Clamp to sane bounds — the custom-budget input only ever
                   checked `v > 0` client-side, so a stray value (or a
                   direct SDK call bypassing the UI entirely) could ask for
                   an arbitrarily large dailyBudget. This doesn't replace a
                   real server-side check (added to firebase-rules.js for
                   the wallet path, and enforced server-side for the card
                   path below) — it just keeps the UI itself from ever
                   proposing something either guard would reject anyway. */
                var dailyBudget  = Math.min(1000000, Math.max(1, parseInt(_state.budget, 10) || 0));
                var durationDays = Math.min(90, Math.max(1, parseInt(_state.days, 10) || 0));
                var totalCost    = dailyBudget * durationDays;

                function _resetBtn() {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-rocket"></i> Launch Campaign';
                }

                var basePromo = {
                    pageId: bizId,
                    pageName: bizData.name || '',
                    ownerId: us.id,
                    objective: _state.obj,
                    durationDays: durationDays,
                    audiences: _state.audiences,
                    cta: _state.cta,
                    headline: _state.headline || ''
                };

                /* ── PAY WITH EMPY WALLET ── */
                if (_state.pay === 'wallet') {

                    /* Fast, optimistic pre-check against the local wallet
                       cache so an obviously-insufficient balance fails
                       instantly without waiting on a round trip — NOT the
                       real guard, see the transaction below for that. */
                    if ((us.empyBalance || 0) < totalCost) {
                        _notify('Insufficient EMPY balance. You need ' + totalCost + ' EMPY.', 'error');
                        return;
                    }

                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Launching…';

                    var promoId = 'promo-' + Date.now() + '-' + (Math.random() * 1e6 | 0);
                    var promoDoc = Object.assign({}, basePromo, {
                        id: promoId,
                        dailyBudget: dailyBudget,
                        totalBudget: totalCost,
                        status: 'active',
                        impressions: 0,
                        clicks: 0,
                        fundedVia: 'wallet',
                        createdAt: Date.now(),
                        endsAt: Date.now() + durationDays * 86400000
                    });

                    /* FIX (2026-08-08 — balance deduction never actually
                       persisted): this used to `.set()` the promotion doc,
                       then deduct `totalCost` only from the in-memory
                       `us.empyBalance` object — no write ever went back to
                       the user's Firestore doc, so the deduction silently
                       reverted on the next page load/refresh (the wallet
                       always re-hydrates its balance from Firestore) while
                       the campaign itself stayed live for free.

                       Fix: read the CURRENT Firestore balance (not the
                       possibly-stale local `us` cache), verify it, write
                       the promotion doc, and decrement the balance — all
                       inside one Firestore transaction, so a double-click
                       or two tabs can't both pass a balance check against
                       the same stale number and overdraw the account. */
                    var userRef  = window.fbDb.collection('users').doc(us.id);
                    var promoRef = window.fbDb.collection('promotions').doc(promoId);

                    window.fbDb.runTransaction(function (tx) {
                        return tx.get(userRef).then(function (userSnap) {
                            var currentBalance = (userSnap.exists && userSnap.data().empyBalance) || 0;
                            if (currentBalance < totalCost) {
                                var err = new Error('Insufficient EMPY balance. You need ' + totalCost + ' EMPY.');
                                err.code = 'INSUFFICIENT_BALANCE';
                                throw err;
                            }
                            var newBalance = currentBalance - totalCost;
                            tx.set(promoRef, promoDoc);
                            tx.update(userRef, { empyBalance: newBalance });
                            return newBalance;
                        });
                    }).then(function (newBalance) {
                        us.empyBalance = newBalance;
                        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
                        _notify('🚀 Campaign launched! Your page is now being promoted.', 'success');
                        _closePromo();
                    }).catch(function (err) {
                        _notify(
                            (err && err.code === 'INSUFFICIENT_BALANCE') ? err.message : 'Could not launch campaign: ' + ((err && err.message) || 'error'),
                            'error'
                        );
                        _resetBtn();
                    });
                    return;
                }

                /* ── PAY WITH CARD / BANK (Fiat, via Flutterwave) ──
                   ADDED (2026-08-08 — Fiat funding for business campaigns):
                   mirrors the payment-method choice app-fixes.js's post-
                   boost finalize form already offers (wallet vs card), and
                   reuses the SAME server-side verification pattern as
                   /api/marketplace/order/confirm and
                   /api/wallet/confirm-purchase — never the trust-the-
                   client-callback shortcut the post-boost card path takes
                   today (see its own comment recommending exactly this).

                   The EMPY-denominated dailyBudget/totalBudget shown here
                   are for display only. The promotion doc actually written
                   is built server-side, in /api/promotion/confirm, from
                   Flutterwave's OWN confirmed charged amount — never from
                   anything this client sends — so a manipulated request
                   can't claim a bigger campaign than was actually paid
                   for. No empyBalance is touched on this path. */
                if (typeof FlutterwaveCheckout !== 'function') {
                    _notify('Payment gateway not loaded. Please refresh and try again.', 'error');
                    return;
                }
                var fwKey = (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '';
                if (!fwKey) {
                    _notify('Card payment is not configured — please pay with EMPY wallet instead.', 'error');
                    return;
                }

                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Launching…';

                var totalNgn = _empyToNgn(totalCost);
                var txRef = 'EMPY-BIZPROMO-' + Date.now() + '-' + (Math.random() * 1e6 | 0);

                FlutterwaveCheckout({
                    public_key: fwKey,
                    tx_ref: txRef,
                    amount: totalNgn,
                    currency: 'NGN',
                    payment_options: 'card,banktransfer,ussd',
                    customer: {
                        email: us.email || 'user@empyrean.com',
                        name:  us.fullName || us.username || 'Empyrean User'
                    },
                    customizations: {
                        title: 'Empyrean Business Promotion',
                        description: 'Promote "' + (bizData.name || 'your page') + '" for ' + durationDays + ' day(s)',
                        logo: 'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
                    },
                    callback: function (data) {
                        if (data.status !== 'successful' && data.status !== 'completed') {
                            _notify('Payment was not completed.', 'error');
                            _resetBtn();
                            return;
                        }
                        fetch('/api/promotion/confirm', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                txRef: data.tx_ref || data.transaction_ref || txRef,
                                promo: basePromo
                            })
                        }).then(function (r) { return r.json(); }).then(function (result) {
                            if (result && result.ok) {
                                _notify('🚀 Campaign launched! Your page is now being promoted.', 'success');
                                _closePromo();
                            } else {
                                console.error('[BizPromo] confirm failed:', result);
                                _notify('Payment succeeded, but we couldn\u2019t verify/launch the campaign automatically. Contact support with your reference: ' + (data.tx_ref || txRef) + '.', 'warning');
                                _resetBtn();
                            }
                        }).catch(function (err) {
                            console.error('[BizPromo] confirm request failed:', err);
                            _notify('Payment succeeded, but we couldn\u2019t reach the server to record it. Contact support with your reference: ' + (data.tx_ref || txRef) + '.', 'warning');
                            _resetBtn();
                        });
                    },
                    onclose: function () {
                        _resetBtn();
                    }
                });
            });

            /* Initial summary */
            _updateSummary();
            return modal;
        }

        function _closePromo() {
            var m = document.getElementById('biz-promo-modal');
            if (m) m.classList.remove('vf-open');
        }
        function _openPromo() {
            _ensurePromoModal();
            var m = document.getElementById('biz-promo-modal');
            if (m) m.classList.add('vf-open');
        }

        /* ── Ensure Share sheet exists ──
           FIX (2026-10-27): icons are inline SVG — Font Awesome's brand font fails to load on weak connections
           and left these options with a label but no logo. */
        function _ensureShareSheet() {
            if (document.getElementById('biz-share-sheet')) return;
            var sheet = document.createElement('div');
            sheet.id = 'biz-share-sheet';
            sheet.innerHTML = [
                '<div id="biz-share-inner">',
                '  <h4><i class="fas fa-share-alt" style="margin-right:8px;color:#1B2B8B;"></i>Share Business Page</h4>',
                '  <div class="biz-share-row">',
                '    <div class="biz-share-opt" data-method="copy">',
                '      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1B2B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg><span>Copy Link</span>',
                '    </div>',
                '    <div class="biz-share-opt" data-method="native">',
                '      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#5B0EA6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg><span>Share</span>',
                '    </div>',
                '    <div class="biz-share-opt" data-method="whatsapp">',
                '      <svg viewBox="0 0 24 24" width="22" height="22" fill="#25D366" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg><span>WhatsApp</span>',
                '    </div>',
                '    <div class="biz-share-opt" data-method="twitter">',
                '      <svg viewBox="0 0 24 24" width="22" height="22" fill="#0A0E27" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg><span>X / Twitter</span>',
                '    </div>',
                '    <div class="biz-share-opt" data-method="facebook">',
                '      <svg viewBox="0 0 320 512" width="22" height="22" fill="#1877F2" aria-hidden="true"><path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z"/></svg><span>Facebook</span>',
                '    </div>',
                '    <div class="biz-share-opt" data-method="linkedin">',
                '      <svg viewBox="0 0 24 24" width="22" height="22" fill="#0A66C2" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/></svg><span>LinkedIn</span>',
                '    </div>',
                '  </div>',
                '  <div id="biz-share-url-row">',
                '    <input type="text" id="biz-share-url-inp" readonly>',
                '    <button id="biz-share-copy-btn"><i class="fas fa-copy"></i> Copy</button>',
                '  </div>',
                '  <button id="biz-share-dismiss">Dismiss</button>',
                '</div>',
            ].join('');
            document.body.appendChild(sheet);

            sheet.addEventListener('click', function (e) { if (e.target === sheet) _closeShareSheet(); });
            document.getElementById('biz-share-dismiss').addEventListener('click', _closeShareSheet);
            document.getElementById('biz-share-copy-btn').addEventListener('click', function () {
                var inp = document.getElementById('biz-share-url-inp');
                if (!inp) return;
                inp.select();
                try { document.execCommand('copy'); } catch (_e) { navigator.clipboard && navigator.clipboard.writeText(inp.value); }
                _notify('Link copied to clipboard!', 'success');
                _closeShareSheet();
            });

            sheet.querySelectorAll('.biz-share-opt').forEach(function (opt) {
                opt.addEventListener('click', function () {
                    var method = opt.dataset.method;
                    var url    = document.getElementById('biz-share-url-inp').value;
                    var bizData = window._activeBizData || {};
                    var name   = bizData.name || 'Business Page';
                    var text   = 'Check out ' + name + ' on Empyrean!';

                    if (method === 'copy') {
                        try { navigator.clipboard.writeText(url); } catch (_e) { /* fall through */ }
                        _notify('Link copied!', 'success');
                        _closeShareSheet();
                    } else if (method === 'native' && navigator.share) {
                        navigator.share({ title: name, text: text, url: url }).catch(function () {});
                        _closeShareSheet();
                    } else if (method === 'whatsapp') {
                        window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank');
                        _closeShareSheet();
                    } else if (method === 'twitter') {
                        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url), '_blank');
                        _closeShareSheet();
                    } else if (method === 'facebook') {
                        window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url), '_blank');
                        _closeShareSheet();
                    } else if (method === 'linkedin') {
                        window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url), '_blank');
                        _closeShareSheet();
                    }
                });
            });
        }

        function _openShareSheet(bizId, bizData) {
            _ensureShareSheet();
            var pageUrl = window.location.origin + window.location.pathname + '?page=' + encodeURIComponent(bizId || '');
            var inp = document.getElementById('biz-share-url-inp');
            if (inp) inp.value = pageUrl;
            var sheet = document.getElementById('biz-share-sheet');
            if (sheet) sheet.classList.add('vf-open');
        }
        function _closeShareSheet() {
            var s = document.getElementById('biz-share-sheet');
            if (s) s.classList.remove('vf-open');
        }

        /* ── Inject Share + Promote buttons into the action row after renderBusinessPage ── */
        function _injectBizActionButtons() {
            var sec = document.getElementById('business-page');
            if (!sec) return;

            /* Don't double-inject */
            if (sec.querySelector('#biz-share-btn')) return;

            var actionRow = sec.querySelector('[style*="justify-content:flex-end"]');
            if (!actionRow) return;

            var bizId   = window._activeBizPageId || '';
            var bizData = window._activeBizData   || {};
            var us      = _us();
            var isOwner = _isAdmin()
                || (us.id && bizData.ownerId && bizData.ownerId === us.id)
                || (us.id && us.businessPage && (
                    (typeof us.businessPage === 'object' && us.businessPage.id === bizId)
                    || us.businessPage === bizId
                ));

            /* Share button — always visible */
            var shareBtn = document.createElement('button');
            shareBtn.id = 'biz-share-btn';
            shareBtn.innerHTML = '<i class="fas fa-share-alt"></i> Share';
            shareBtn.addEventListener('click', function () {
                _openShareSheet(bizId, bizData);
            });
            actionRow.prepend(shareBtn);

            /* Promote button — owner only */
            if (isOwner) {
                var promoteBtn = document.createElement('button');
                promoteBtn.id = 'biz-promote-btn';
                promoteBtn.innerHTML = '<i class="fas fa-rocket"></i> Promote';
                promoteBtn.addEventListener('click', function () {
                    if (_isGuest()) { _notify('Please log in to run a promotion.', 'info'); return; }
                    _openPromo();
                });
                /* Insert after the Edit Page btn, before share btn */
                actionRow.appendChild(promoteBtn);
            }
        }

        /* ── Hook into renderBusinessPage ── */
        function _patchRenderBusinessPage() {
            var orig = window.renderBusinessPage;
            if (!orig || orig._pv3SharePatched) return;
            window.renderBusinessPage = function () {
                var result = orig.apply(this, arguments);
                /* Buttons are injected after a short tick so the DOM is settled */
                setTimeout(_injectBizActionButtons, 250);
                return result;
            };
            window.renderBusinessPage._pv3SharePatched = true;
            window.renderBusinessPage._bizModuleV3     = true;
        }

        /* ── Wire on section-change + init ── */
        document.addEventListener('empyrean-section-change', function (ev) {
            if (ev && ev.detail && ev.detail.section === 'business-page') {
                _patchRenderBusinessPage();
                setTimeout(_injectBizActionButtons, 400);
            }
        });
        _ready(function () {
            setTimeout(function () {
                _patchRenderBusinessPage();
                if (document.getElementById('business-page')) _injectBizActionButtons();
            }, 900);
        });
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(function () {
                _patchRenderBusinessPage();
                _injectBizActionButtons();
            }, 500);
        });

    })(); /* end patchBusinessPage */


    /* =========================================================================
       PATCH 2 — QUOTE TWEET MODAL: MISSING SEND BUTTON FIX
       =========================================================================
       Root cause:
         The .vf-th-quote-submit click listener in _ensureThread() binds to the
         local `_submitQuote` reference at creation time.  When app-fix-final.js
         wraps `window._submitQuote` for mining, the DOM button still calls the
         original unwrapped function — and the button label ("Quote") has no
         visible send icon so it doesn't look like a send action.

       Fix:
         1. Replace the direct binding with an indirected call through
            window._submitQuote so any wrapping is always honoured.
         2. Upgrade the button to show a paper-plane icon (matching the rest of
            the app's send UX) and rename it to "Send Quote".
         3. Also handle the edge case where _ensureThread() has already run
            (DOM already exists) — re-wire immediately.
         4. Re-apply on empyrean-init-done in case app-fix-final patches late.
       ========================================================================= */

    (function patchQuoteModal() {

        /* Inject upgraded styles for the quote modal (once) */
        _ready(function () {
            if (document.getElementById('_quote_patch_v3_css')) return;
            var s = document.createElement('style');
            s.id = '_quote_patch_v3_css';
            s.textContent = [
                /* Make the submit button look like a proper Send action */
                '.vf-th-quote-submit{',
                '  padding:10px 22px;border-radius:24px;border:none;',
                '  background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;',
                '  font-size:0.88rem;font-weight:700;cursor:pointer;',
                '  display:inline-flex;align-items:center;gap:7px;',
                '  box-shadow:0 4px 14px rgba(27,43,139,0.3);',
                '  transition:opacity 0.18s,transform 0.15s;',
                '}',
                '.vf-th-quote-submit:hover{opacity:0.9;transform:translateY(-1px);}',
                '.vf-th-quote-submit:active{opacity:0.8;transform:translateY(0);}',
                /* Textarea — give it a bit more height and better focus ring */
                '#vf-th-quote-inp{',
                '  min-height:90px;resize:vertical;',
                '  border:1.5px solid rgba(10,14,39,0.12);border-radius:14px;',
                '  padding:12px 14px;font-size:0.9rem;color:#374151;',
                '  background:#F9FAFB;outline:none;font-family:inherit;',
                '  width:100%;box-sizing:border-box;',
                '  transition:border-color 0.18s;',
                '}',
                '#vf-th-quote-inp:focus{border-color:#1B2B8B;background:#fff;}',
                /* Quote preview card */
                '#vf-th-quote-preview{',
                '  padding:12px 14px;border-radius:12px;',
                '  background:rgba(27,43,139,0.05);',
                '  border:1.5px solid rgba(27,43,139,0.15);',
                '  font-size:0.83rem;color:#374151;margin-bottom:12px;',
                '  line-height:1.5;',
                '}',
                '#vf-th-quote-preview strong{color:#0A0E27;display:block;margin-bottom:3px;font-size:0.82rem;}',
                /* Actions row */
                '#vf-th-quote-actions{',
                '  display:flex;gap:10px;justify-content:flex-end;',
                '  padding-top:12px;border-top:1px solid rgba(10,14,39,0.07);',
                '  margin-top:8px;',
                '}',
            ].join('\n');
            document.head.appendChild(s);
        });

        /* Core re-wiring logic */
        function _rewireQuoteSubmitBtn() {
            var qm = document.getElementById('vf-th-quote-modal');
            if (!qm) return; /* modal not yet created — will be done after _ensureThread fires */

            var btn = qm.querySelector('.vf-th-quote-submit');
            if (!btn) return;

            /* Upgrade button label (idempotent — check for icon already present) */
            if (!btn.querySelector('i.fa-paper-plane')) {
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Quote';
            }

            /* Remove all existing click listeners by replacing the node clone */
            if (!btn._pv3Fixed) {
                var clone = btn.cloneNode(true);
                btn.parentNode.replaceChild(clone, btn);
                clone._pv3Fixed = true;
                /* Bind via indirection so mining wrapper is always called */
                clone.addEventListener('click', function () {
                    if (typeof window._submitQuote === 'function') {
                        window._submitQuote();
                    }
                });
                /* Also wire Enter key in the textarea */
                var inp = document.getElementById('vf-th-quote-inp');
                if (inp && !inp._pv3KeyWired) {
                    inp._pv3KeyWired = true;
                    inp.addEventListener('keydown', function (e) {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            if (typeof window._submitQuote === 'function') window._submitQuote();
                        }
                    });
                }
            }
        }

        /*
         * Also patch _ensureThread itself so the modal is always created with
         * the correct binding even on first call.
         * We do this by observing the DOM for #vf-th-quote-modal being added.
         */
        var _quoteModalObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.id === 'vf-th-quote-modal' || (node.querySelector && node.querySelector('#vf-th-quote-modal'))) {
                        setTimeout(_rewireQuoteSubmitBtn, 0);
                    }
                });
            });
        });
        _quoteModalObserver.observe(document.body, { childList: true, subtree: false });

        /* Apply immediately if modal already in DOM (page refresh scenario) */
        _ready(function () {
            setTimeout(_rewireQuoteSubmitBtn, 500);
        });
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(_rewireQuoteSubmitBtn, 800);
        });
        document.addEventListener('empyrean-section-change', function () {
            setTimeout(_rewireQuoteSubmitBtn, 300);
        });

    })(); /* end patchQuoteModal */


    console.log('[EmpyreanPatchV3] ✅ Business Share+Promotion + Quote modal send button fix loaded.');

})();