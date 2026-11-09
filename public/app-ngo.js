/* =============================================================================
   EMPYREAN INTERNATIONAL — NGO & GRANT DISBURSEMENT PORTAL
   app-ngo.js  |  v2.0 — International Best Practice Overhaul
   =============================================================================

   PURPOSE
   ───────
   Complete, production-grade NGO and Grant Disbursement system. Covers:

     PRESERVED FROM v1
     • renderGrantLedger()           — on-chain grant disbursement table
     • renderCommunityTasks()        — social-media task list (earn EMPY)
     • renderNgoGrid()               — NGO partner card grid
     • renderNgoProfile(ngoId)       — detailed NGO profile with feed
     • Community task click handler  — open URL + award EMPY (once per task)
     • NGO card click → renderNgoProfile
     • Back-to-grid navigation
     • Donate button → donation modal (SOS escrow)
     • SOS donation Flutterwave form submit
     • Firestore NGO loader

     NEW IN v2
     • renderGrantDashboard()        — live analytics dashboard with charts
     • renderNgoVerificationQueue()  — admin KYC queue for NGO onboarding
     • renderIndividualGrantPanel()  — individual recipient disbursement panel
     • _submitNgoApplication()       — NGO self-registration + document upload
     • _approveNgoApplication()      — admin approve/reject NGO applications
     • _createGrantAllocation()      — admin create grant allocations
     • _submitIndividualGrantReq()   — individual grant request portal
     • _approveIndividualGrant()     — admin approve individual grant requests
     • _verifyDisbursement()         — multi-sig verification stub
     • _exportGrantReport()          — CSV/PDF audit trail export
     • renderGrantAnalytics()        — real-time fund utilisation charts
     • renderNgoPublicProfile()      — public-facing NGO transparency page
     • renderImpactReports()         — NGO impact report submission & display
     • _loadGrantApplications()      — Firestore grant application loader
     • _loadIndividualGrantQueue()   — Firestore individual grant queue loader
     • _ngoKycDocumentUpload()       — document upload for NGO KYC
     • renderAdminGrantControlPanel()— unified admin control panel
     • Real-time Firestore listeners  — live disbursement status updates
     • Multi-currency support         — NGN, USD, EMPY (in-house token)
       (CRYPTO_HIDDEN_FOR_PLAY_STORE: on-chain audit hash display and
       external USDT support are hidden for now — see the matching
       markers throughout this file — and restored once the platform
       is ready to comply with app-store crypto/exchange policy.)

   LOAD ORDER
   ──────────
   Must come AFTER: firebase-init, app-state, app-helpers, app-contracts,
   app-notifications, app-auth, app-feed, app-wallet, app-admin.

   DEPENDS ON
   ──────────
   • window.EmpState / window.userState / window.isGuest / window.isAdmin
   • window.mockNgoPartners / window.mockGrantLedger / window.mockCommunityTasks
   • window.fbDb / window._firebaseLoaded / window.fbStorage
   • window.formatUsdPrice   (app-helpers.js or inline)
   • window.showNotification (app-helpers.js)
   • window.updateWalletUI   (app-wallet.js)
   • window.createNewPostElement (app-feed.js)
   • window.uploadToCloudinary (app-dom.js)
   • window.initiateFlutterwavePayment (app-admin.js)

   PUBLIC API
   ──────────
   window.renderGrantLedger()
   window.renderCommunityTasks()
   window.renderNgoGrid()
   window.renderNgoProfile(ngoId)
   window.renderGrantDashboard()
   window.renderNgoVerificationQueue()
   window.renderIndividualGrantPanel()
   window.renderAdminGrantControlPanel()
   window.renderGrantAnalytics()
   window.renderImpactReports(ngoId)
   window.openNgoApplicationModal()
   window.openIndividualGrantModal()
   window._approveNgoApplication(appId, action)
   window._approveIndividualGrant(grantId, action)
   window._exportGrantReport(format)
   window._refreshGrantDashboard()

   SECTION MAP
   ───────────
   §1   Core utilities & state accessors
   §2   renderGrantLedger           (enhanced v2)
   §3   renderCommunityTasks        (preserved v1)
   §4   renderNgoGrid               (enhanced v2)
   §5   renderNgoProfile            (enhanced v2)
   §6   renderGrantDashboard        (NEW)
   §7   renderNgoVerificationQueue  (NEW)
   §8   renderIndividualGrantPanel  (NEW)
   §9   renderAdminGrantControlPanel(NEW)
   §10  renderGrantAnalytics        (NEW)
   §11  renderImpactReports         (NEW)
   §12  NGO application modal & form (NEW)
   §13  Individual grant request modal (NEW)
   §14  Firestore loaders (NGO partners, grant apps, individual queue)
   §15  Community task click handler
   §16  NGO card click + back-to-grid
   §17  Donate button → donation modal
   §18  SOS donation Flutterwave form handler
   §19  Admin action handlers (approve/reject, export)
   §20  Real-time listeners
   §21  Bootstrap

   ============================================================================= */

(function empyreanNgoModuleV2() {
    'use strict';

    if (window._empyreanNgoLoaded) {
        console.warn('[EmpNgo] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanNgoLoaded = true;

    /* =========================================================================
       §1  CORE UTILITIES & STATE ACCESSORS
       ========================================================================= */

    function _S()        { return window.EmpState  || {}; }
    function _us()       { return _S().userState   || window.userState    || {}; }
    function _isGuest()  { var s = _S(); return s.isGuest != null ? s.isGuest : !!window.isGuest; }
    function _isAdmin()  { var s = _S(); return s.isAdmin != null ? s.isAdmin : !!window.isAdmin; }
    function _partners() { return (_S().mockNgoPartners)  || window.mockNgoPartners || {}; }
    function _ledger()   { return (_S().mockGrantLedger)  || window.mockGrantLedger  || []; }
    function _tasks()    { return (_S().mockCommunityTasks) || window.mockCommunityTasks || []; }
    function _db()       { return window.fbDb; }
    // FIX (2026-08-13 — "[GrantLedger] sponsorship_proposals (SOS) query
    // failed ... Reason: permission-denied", and the same class of
    // failure on every other Firestore call in this file gated by
    // _fbOk()): this only confirmed Firestore itself was initialized, not
    // that a real Firebase Auth session (anonymous or signed-in) actually
    // existed yet — every collection this file reads/writes
    // (sponsorship_proposals, disbursements, etc.) requires request.auth
    // != null (firebase-rules.js). All 28 call sites in this file use
    // _fbOk() as their "is it safe to call Firestore" guard, so fixing it
    // once here covers all of them consistently, the same way the
    // equivalent gate was fixed in app-fixes.js/app-donors.js/etc. this
    // session.
    function _fbOk()     { return !!(window._firebaseLoaded && window.fbAuth && window.fbAuth.currentUser); }

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
        else console.log('[NGO Notification]', type, msg);
    }

    function _serverTs() {
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
                return firebase.firestore.FieldValue.serverTimestamp();
        } catch(e) {}
        return new Date();
    }

    function _fmtAmount(amount, currency) {
        currency = currency || 'NGN';
        var n = parseFloat(amount) || 0;
        if (currency === 'NGN') return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (currency === 'USD') return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (currency === 'EMPY' || currency === 'USDT') return n.toLocaleString('en', { maximumFractionDigits: 4 }) + ' ' + currency;
        return n.toLocaleString() + ' ' + currency;
    }

    function _shortHash(hash) {
        if (!hash) return '—';
        return hash.length > 18 ? hash.substring(0, 10) + '…' + hash.slice(-6) : hash;
    }

    function _statusBadge(status) {
        var map = {
            'completed':  { color: 'var(--success-color, #22c55e)', bg: 'rgba(34,197,94,0.12)',  icon: 'fa-check-circle',   label: 'Completed'  },
            'pending':    { color: '#F59E0B',                        bg: 'rgba(245,158,11,0.12)', icon: 'fa-clock',          label: 'Pending'    },
            'approved':   { color: '#3B82F6',                        bg: 'rgba(59,130,246,0.12)', icon: 'fa-thumbs-up',      label: 'Approved'   },
            'rejected':   { color: 'var(--danger-color, #ef4444)',   bg: 'rgba(239,68,68,0.12)',  icon: 'fa-times-circle',   label: 'Rejected'   },
            'verified':   { color: 'var(--success-color, #22c55e)', bg: 'rgba(34,197,94,0.12)',  icon: 'fa-shield-check',   label: 'Verified'   },
            'under_review':{ color: '#8B5CF6',                      bg: 'rgba(139,92,246,0.12)', icon: 'fa-search',         label: 'In Review'  },
            'disbursed':  { color: '#00D4AA',                        bg: 'rgba(0,212,170,0.12)',  icon: 'fa-paper-plane',    label: 'Disbursed'  },
            'held':       { color: '#F59E0B',                        bg: 'rgba(245,158,11,0.12)', icon: 'fa-lock',           label: 'Held'       }
        };
        var s = map[String(status).toLowerCase()] || { color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', icon: 'fa-circle', label: status || '—' };
        return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.76rem;font-weight:700;'
            + 'color:' + s.color + ';background:' + s.bg + ';padding:3px 9px;border-radius:50px;border:1px solid ' + s.color + '44;">'
            + '<i class="fas ' + s.icon + '"></i> ' + s.label + '</span>';
    }

    /* Disbursement-type badge — gives the "Disbursement Type" ledger column
       clear at-a-glance visibility into whether a row is an NGO partner
       disbursement or a direct individual beneficiary disbursement. */
    function _typeBadge(type) {
        var isIndividual = String(type || 'NGO').toLowerCase().indexOf('individual') === 0;
        var color = isIndividual ? '#8A6D3B' : '#1B2B8B';
        var bg    = isIndividual ? 'rgba(201,166,107,0.16)' : 'rgba(27,43,139,0.08)';
        var icon  = isIndividual ? 'fa-user' : 'fa-building';
        var label = isIndividual ? 'Individual' : (type || 'NGO Partner');
        return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;font-weight:700;'
            + 'color:' + color + ';background:' + bg + ';padding:3px 10px;border-radius:50px;border:1px solid ' + color + '33;white-space:nowrap;">'
            + '<i class="fas ' + icon + '"></i> ' + _esc(label) + '</span>';
    }

    /* Generate a unique grant ID */
    function _genGrantId() {
        return 'GRN-' + Date.now().toString(36).toUpperCase().slice(-6);
    }

    /* Upload a file to Cloudinary via the existing app-dom.js function */
    async function _uploadDoc(file) {
        if (!file || !(file instanceof File)) return typeof file === 'string' ? file : '';
        if (typeof window.uploadToCloudinary !== 'function') return '';
        try { return await window.uploadToCloudinary(file, null); }
        catch(e) { console.warn('[NGO Upload]', e.message); return ''; }
    }


    /* =========================================================================
       §2  renderGrantLedger  (ENHANCED v2)
       Populates #grant-ledger-body with rich grant disbursement records.
       Now includes: multi-currency, status badges, advanced filters, and
       live Firestore integration.
       NOTE (CRYPTO_HIDDEN_FOR_PLAY_STORE): this ledger used to display an
       on-chain "Blockchain Proof" column (tx hash + polygonscan.com link).
       Crypto disbursement is not launched yet, so that column has been
       replaced with the NGO/Individual/SOS breakdown columns the row
       renderer (_renderLedgerRows) already produces — this also fixes a
       pre-existing mismatch where the header only had 8 columns but the
       rows it fed always rendered 9. Restore the on-chain column instead
       of (or alongside) these when crypto disbursement goes live.
       ========================================================================= */

    function renderGrantLedger() {
        var tbody = document.getElementById('grant-ledger-body');
        if (!tbody) return;

        /* Load from Firestore first if connected */
        if (_fbOk() && _db()) {
            var disbursementsP = _db().collection('disbursements')
                .orderBy('createdAt', 'desc')
                .limit(100)
                .get()
                .then(function(snap) {
                    var entries = [];
                    if (!snap.empty) {
                        snap.forEach(function(doc) {
                            var d = doc.data();
                            entries.push({
                                id:       d.grantId || _genGrantId(),
                                ngo:      d.recipientName || d.ngoName || '—',
                                project:  d.purpose || d.projectName || '—',
                                amount:   d.amountFormatted || _fmtAmount(d.amount, d.currency || 'NGN'),
                                txHash:   d.txHash || d.txRef || '',
                                status:   d.status  || 'completed',
                                dateTs:   d.createdAt && d.createdAt.toDate ? d.createdAt.toDate() : null,
                                date:     d.createdAt && d.createdAt.toDate
                                    ? d.createdAt.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
                                    : (d.date || '—'),
                                currency: d.currency || d.token || 'NGN',
                                type:     d.type || 'NGO',
                                /* Raw numeric amount for charting (trend/projection sums this;
                                   `amount` above stays a display-formatted string). */
                                amountRaw: Number(d.amount) || 0,
                                /* Unique beneficiary key — used to count distinct recipients
                                   for the live beneficiary pie chart, independent of how many
                                   grants that same recipient has received. */
                                beneficiaryId: d.recipientId || d.recipientName || d.ngoName || _genGrantId()
                            });
                        });
                    }
                    return entries;
                })
                .catch(function(e) {
                    console.error('[GrantLedger] disbursements query failed — falling back to empty mock ledger. Reason:', e && e.code, e && e.message);
                    return _ledger();
                });

            /* SOS Individual Request Empowerment — pulls from the SAME signal
               app-donors.js's donor wall already treats as "money actually
               moved": sponsorship_proposals where targetType === 'sos' and
               status is 'funded' or 'completed' (see app-donors.js's own
               schema doc for sponsorship_proposals/{id}). Each such record
               is one individual empowered through an SOS request — kept as
               its own stream so it's never confused with NGO grants or
               individual grants, which move through a completely different
               approval flow (the individual_grants queue below). */
            var sosEmpowermentP = _db().collection('sponsorship_proposals')
                .where('targetType', '==', 'sos')
                .where('status', 'in', ['funded', 'completed'])
                .limit(200)
                .get()
                .then(function(snap) {
                    var entries = [];
                    if (!snap.empty) {
                        snap.forEach(function(doc) {
                            var d   = doc.data() || {};
                            var ts  = d.decidedAt || d.fundedAt || d.createdAt;
                            var amt = (d.amountFunded != null ? d.amountFunded : d.pledgedAmount) || 0;
                            entries.push({
                                id:       'SOS-' + doc.id.slice(-6).toUpperCase(),
                                ngo:      d.targetLabel || 'SOS Individual Request',
                                project:  'SOS Empowerment' + (d.donorName ? ' — via ' + d.donorName : ''),
                                amount:   _fmtAmount(amt, d.currency || 'NGN'),
                                txHash:   '',
                                status:   d.status === 'completed' ? 'completed' : 'disbursed',
                                dateTs:   ts && ts.toDate ? ts.toDate() : null,
                                date:     ts && ts.toDate
                                    ? ts.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
                                    : '—',
                                currency: d.currency || 'NGN',
                                type:     'SOS',
                                amountRaw: Number(amt) || 0,
                                beneficiaryId: d.targetId || doc.id
                            });
                        });
                    }
                    return entries;
                })
                .catch(function(e) {
                    console.error('[GrantLedger] sponsorship_proposals (SOS) query failed — falling back to empty list. Reason:', e && e.code, e && e.message,
                        (e && e.code === 'failed-precondition') ? '— this compound where() query needs a Firestore composite index; check for a "create it here" link in this error.' : '');
                    return [];
                });

            Promise.all([disbursementsP, sosEmpowermentP]).then(function(results) {
                var merged = results[0].concat(results[1]).sort(function(a, b) {
                    return (b.dateTs ? b.dateTs.getTime() : 0) - (a.dateTs ? a.dateTs.getTime() : 0);
                });
                _renderLedgerRows(tbody, merged);
            }).catch(function(e) {
                console.error('[GrantLedger] Promise.all failed unexpectedly — falling back to empty mock ledger. Reason:', e && e.message);
                _renderLedgerRows(tbody, _ledger());
            });
        } else {
            console.warn('[GrantLedger] Firebase not ready/connected (_fbOk()=' + _fbOk() + ', _db()=' + !!_db() + ') — rendering empty mock ledger instead of live data.');
            _renderLedgerRows(tbody, _ledger());
        }
    }

    /* Which of the three coexisting disbursement columns a row's amount
       belongs in. Kept as its own helper so the ledger table, the CSV
       export, and any future summary card all agree on the same rule. */
    function _ledgerTypeBucket(type) {
        var t = String(type || 'NGO').toLowerCase();
        if (t.indexOf('sos') === 0) return 'sos';
        if (t.indexOf('individual') === 0) return 'individual';
        return 'ngo';
    }

    function _renderLedgerRows(tbody, grants) {
        /* The disbursement log must always render — even if Chart.js is
           unavailable, a canvas fails to size, or anything else goes wrong
           in the chart code below. Isolate that failure so it can never
           blank out the table itself. */
        try { _renderBeneficiaryPie(grants || []); }
        catch (e) { console.error('[GrantLedger] chart rendering failed (ledger table unaffected):', e && e.message); }

        if (!grants || !grants.length) {
            tbody.innerHTML = '<tr class="gtp-empty-row"><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted);">'
                + '<i class="fas fa-file-invoice-dollar" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.4;"></i>'
                + '<strong>No grants disbursed yet.</strong><br>'
                + '<span style="font-size:0.83rem;">Approved disbursements will appear here as a publicly auditable record.</span>'
                + '</td></tr>';
            return;
        }
        tbody.innerHTML = grants.map(function(grant) {
            var amtDisplay = '<i class="fas fa-coins" style="color:var(--nav-accent,#00D4AA);margin-right:4px;font-size:0.8rem;"></i>'
                + _esc(typeof grant.amount === 'string' ? grant.amount : _fmtAmount(grant.amount, grant.currency));
            var dash = '<span style="color:var(--text-muted);opacity:0.5;">—</span>';
            var bucket = _ledgerTypeBucket(grant.type);

            /* Three coexisting amount columns — only the column matching this
               row's own disbursement category is populated, the other two
               show a dash. This gives clear, at-a-glance visibility into
               exactly how much of each grant allocation went to NGOs, to
               individually-approved grants, and to SOS-empowered individuals,
               without needing to cross-reference the Type badge column.
               data-label lets the narrow-screen CSS (injected below) render
               each cell as a labeled row inside a card instead of relying on
               sideways scrolling, which was hiding these two columns
               entirely on phones. */
            var ngoCol   = '<td data-label="NGO Grant Disbursement" style="padding:10px 14px;font-weight:700;color:var(--g-navy,#1B2B8B);">'   + (bucket === 'ngo'        ? amtDisplay : dash) + '</td>';
            var indivCol = '<td data-label="Individual Disbursement" style="padding:10px 14px;font-weight:700;color:#8A6D3B;">'                  + (bucket === 'individual' ? amtDisplay : dash) + '</td>';
            var sosCol   = '<td data-label="SOS Empowerment" style="padding:10px 14px;font-weight:700;color:var(--danger-color,#EF4444);">' + (bucket === 'sos' ? amtDisplay : dash) + '</td>';

            return '<tr style="border-bottom:1px solid rgba(10,14,39,0.06);transition:background 0.15s;" '
                + 'onmouseenter="this.style.background=\'rgba(0,212,170,0.04)\'" onmouseleave="this.style.background=\'\'">'
                + '<td data-label="Grant ID" style="padding:10px 14px;font-family:monospace;font-size:0.80rem;color:var(--text-muted);">' + _esc(grant.id || '—') + '</td>'
                + '<td data-label="Recipient" style="padding:10px 14px;font-weight:600;">' + _esc(grant.ngo || '—') + '</td>'
                + '<td data-label="Project" style="padding:10px 14px;">' + _esc(grant.project || '—') + '</td>'
                + ngoCol
                + indivCol
                + sosCol
                + '<td data-label="Status" style="padding:10px 14px;">' + _statusBadge(grant.status || 'completed') + '</td>'
                + '<td data-label="Disbursement Type" style="padding:10px 14px;">' + _typeBadge(grant.type || 'NGO') + '</td>'
                + '<td data-label="Date" style="padding:10px 14px;font-size:0.82rem;white-space:nowrap;">' + _esc(grant.date || '—') + '</td>'
                + '</tr>';
        }).join('');
    }

    /* =========================================================================
       §2c  Mobile card layout for the ledger table
       On phones the 10-column ledger table can't fit — it was falling back
       to sideways scrolling with no visual cue, which made the Individual
       and SOS Empowerment columns (and the whole empty-state message)
       invisible unless someone happened to scroll right. Below ~700px this
       turns each <tr> into its own labeled card instead — every column,
       including Individual/SOS, is always visible without scrolling.
       Injected from JS rather than edited into style.css, per convention
       (style.css/token.css are never edited directly). Idempotent — safe
       if renderGrantLedger() runs more than once.
       ========================================================================= */
    (function _injectGtpMobileCardCss() {
        if (document.getElementById('_ngo_gtp_mobile_css')) return;
        var s = document.createElement('style');
        s.id = '_ngo_gtp_mobile_css';
        s.textContent = [
            '@media (max-width: 700px) {',
            '  .gtp-table thead { display: none; }',
            '  .gtp-table, .gtp-table tbody, .gtp-table tr, .gtp-table td { display: block; width: 100%; }',
            '  .gtp-table tbody tr {',
            '    border: 1px solid rgba(10,14,39,0.08); border-radius: 14px;',
            '    margin-bottom: 12px; padding: 4px 0; box-shadow: 0 2px 8px rgba(10,14,39,0.05);',
            '  }',
            '  .gtp-table tbody tr:last-of-type { margin-bottom: 0; }',
            '  .gtp-table td {',
            '    display: flex !important; justify-content: space-between; align-items: center; gap: 12px;',
            '    text-align: right; border-bottom: 1px solid rgba(10,14,39,0.05);',
            '  }',
            '  .gtp-table td:last-child { border-bottom: none; }',
            '  .gtp-table td[data-label]::before {',
            '    content: attr(data-label); text-align: left; flex-shrink: 0;',
            '    font-family: "Inter", sans-serif; font-size: 0.68rem; font-weight: 700;',
            '    text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted);',
            '  }',
            /* The empty-state row is a single centered message, not a
               labeled field — keep it as plain centered content. */
            '  .gtp-table tbody tr.gtp-empty-row { border: none; box-shadow: none; padding: 0; }',
            '  .gtp-table tbody tr.gtp-empty-row td { display: block !important; text-align: center; }',
            '  .gtp-table tbody tr.gtp-empty-row td::before { content: none; }',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();

    /* =========================================================================
       §2c-2  Layout CSS for the 3-pie row + trend chart card
       Same JS-injection convention as _injectGtpMobileCardCss above. The base
       .gtp-grid rule (in style.css) is a fixed 2-column pie+table layout;
       these two new rows need their own grid shape, and Chart.js canvases
       need an explicitly-sized parent to render into (responsive:true +
       maintainAspectRatio:false alone isn't enough without one).
       ========================================================================= */
    (function _injectGtpChartsCss() {
        if (document.getElementById('_ngo_gtp_charts_css')) return;
        var s = document.createElement('style');
        s.id = '_ngo_gtp_charts_css';
        s.textContent = [
            '.gtp-pies-row { grid-template-columns: repeat(3, 1fr); gap: 16px; }',
            '@media (max-width: 900px) {',
            '  .gtp-pies-row {',
            '    display: flex; grid-template-columns: none; overflow-x: auto; overflow-y: hidden;',
            '    gap: 12px; padding: 4px 4px 12px; margin: 0 -4px;',
            '    scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;',
            '  }',
            '  .gtp-pies-row .gtp-pie-card {',
            '    flex: 0 0 78%; scroll-snap-align: start; scroll-snap-stop: always;',
            '  }',
            '  .gtp-pies-row::after { content: ""; flex: 0 0 4px; }',
            '  .gtp-swipe-hint { display: block !important; color: var(--text-muted); font-size: 0.78rem; margin: 0 0 8px; }',
            '}',
            '@media (max-width: 560px) { .gtp-pies-row .gtp-pie-card { flex-basis: 84%; } }',
            '.gtp-pies-row .gtp-pie-card { padding: 16px; }',
            '.gtp-pies-row .gtp-pie-card h4 { margin-bottom: 10px; font-size: 0.92rem; }',
            '.gtp-pies-row .gtp-pie-svg-wrap { width: 140px; height: 140px; }',
            '.gtp-pies-row .gtp-pie-row { gap: 16px; }',
            '.gtp-pies-row .gtp-pie-legend { min-width: 130px; gap: 8px; }',
            '.gtp-trend-row { grid-template-columns: 1fr; }',
            '.gtp-trend-canvas-wrap { position: relative; width: 100%; height: 260px; }',
            '@media (max-width: 700px) { .gtp-trend-canvas-wrap { height: 200px; } }',
            /* Compact designed placeholder — fills the chart\'s own footprint
               instead of leaving dead whitespace when there is no data yet
               or Chart.js failed to load. */
            '.gtp-chart-placeholder {',
            '  position: absolute; inset: 0; display: none; flex-direction: column;',
            '  align-items: center; justify-content: center; gap: 8px; text-align: center;',
            '  padding: 10px; border-radius: 12px; background: rgba(10,14,39,0.02);',
            '  border: 1px dashed rgba(10,14,39,0.12);',
            '}',
            '.gtp-pie-svg-wrap .gtp-chart-placeholder { border-radius: 50%; }',
            '.gtp-chart-placeholder i { font-size: 1.3rem; color: var(--text-muted); opacity: 0.55; }',
            '.gtp-chart-placeholder span { font-size: 0.72rem; line-height: 1.35; color: var(--text-muted); max-width: 120px; }',
            '.gtp-trend-canvas-wrap .gtp-chart-placeholder span { max-width: 220px; font-size: 0.8rem; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();

    /* =========================================================================
       §2b  _renderBeneficiaryPie
       Draws the live beneficiary breakdown donut (NGO partners vs individual
       recipients) on the public Grant Transparency Portal, and updates the
       hero stat counters (total grants disbursed / total beneficiaries
       reached). Pure CSS conic-gradient — no chart library required.
       Safe to call with an empty array (renders an empty-state placeholder).
       ========================================================================= */

    function _renderBeneficiaryPie(grants) {
        var statGrants  = document.getElementById('gtp-stat-total-grants');
        var statBenef   = document.getElementById('gtp-stat-total-beneficiaries');
        var statSos     = document.getElementById('gtp-stat-sos-empowered');

        if (statGrants) statGrants.textContent = (grants ? grants.length : 0).toLocaleString();

        var seen = {};
        var ngoCount = 0, indivCount = 0, sosCount = 0;
        (grants || []).forEach(function(g) {
            var key = g.beneficiaryId || g.ngo;
            if (!key || seen[key]) return;
            seen[key] = true;
            var bucket = _ledgerTypeBucket(g.type);
            if (bucket === 'sos') sosCount++;
            else if (bucket === 'individual') indivCount++;
            else ngoCount++;
        });
        var total = ngoCount + indivCount + sosCount;

        /* SOS individuals empowered gets its own live hero counter, in
           addition to being folded into the overall "Beneficiaries Reached"
           total and the three category pies below. */
        if (statSos) statSos.textContent = sosCount.toLocaleString();
        if (statBenef) statBenef.textContent = total.toLocaleString();

        _renderCategoryPies(grants || []);
        _renderTrendChart(grants || []);
    }
    window._renderBeneficiaryPie = _renderBeneficiaryPie;

    /* =========================================================================
       §2d  _renderCategoryPies  (Chart.js)
       Three separate per-category pies — NGO / Individual / SOS — each broken
       down by disbursement status within that category (completed, pending,
       disbursed, etc.), replacing the old single combined donut. Chart
       instances are cached so repeat calls (live Firestore snapshot updates)
       redraw in place instead of stacking duplicate canvases or hitting
       Chart.js's "Canvas is already in use" error.
       ========================================================================= */
    var _gtpCharts = {};
    var _GTP_STATUS_COLORS = {
        completed: '#22c55e', disbursed: '#00D4AA', pending: '#F59E0B',
        held: '#F59E0B', approved: '#3B82F6', under_review: '#8B5CF6',
        verified: '#22c55e', rejected: '#EF4444'
    };
    function _gtpStatusColor(status) { return _GTP_STATUS_COLORS[String(status || '').toLowerCase()] || '#94A3B8'; }
    function _gtpStatusLabel(status) {
        return String(status || 'completed').toLowerCase().split('_')
            .map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
    }

    function _gtpSetPlaceholder(wrapEl, iconClass, text) {
        if (!wrapEl) return;
        var ph = wrapEl.querySelector('.gtp-chart-placeholder');
        if (!ph) {
            ph = document.createElement('div');
            ph.className = 'gtp-chart-placeholder';
            wrapEl.appendChild(ph);
        }
        ph.innerHTML = '<i class="fas ' + iconClass + '"></i><span>' + text + '</span>';
        ph.style.display = 'flex';
    }
    function _gtpClearPlaceholder(wrapEl) {
        if (!wrapEl) return;
        var ph = wrapEl.querySelector('.gtp-chart-placeholder');
        if (ph) ph.style.display = 'none';
    }

    function _renderOneCategoryPie(bucketKey, canvasId, valueElId, legendElId, grants) {
        var canvas   = document.getElementById(canvasId);
        var valueEl  = document.getElementById(valueElId);
        var legendEl = document.getElementById(legendElId);
        if (!canvas) return; /* this pie isn't on screen */
        var wrapEl = canvas.closest('.gtp-pie-svg-wrap');

        var byStatus = {};
        grants.forEach(function(g) {
            if (_ledgerTypeBucket(g.type) !== bucketKey) return;
            var s = String(g.status || 'completed').toLowerCase();
            byStatus[s] = (byStatus[s] || 0) + 1;
        });
        var labels = Object.keys(byStatus);
        var counts = labels.map(function(s) { return byStatus[s]; });
        var colors = labels.map(_gtpStatusColor);
        var total  = counts.reduce(function(a, b) { return a + b; }, 0);

        if (valueEl) valueEl.textContent = total.toLocaleString();

        if (_gtpCharts[canvasId]) { _gtpCharts[canvasId].destroy(); _gtpCharts[canvasId] = null; }

        if (!window.Chart) {
            wrapEl && wrapEl.classList.add('gtp-pie-empty-ring');
            if (legendEl) legendEl.innerHTML = '<div class="gtp-pie-empty"><i class="fas fa-plug-circle-xmark"></i><br>Charts unavailable — count above is still accurate</div>';
            return;
        }
        if (!total) {
            wrapEl && wrapEl.classList.add('gtp-pie-empty-ring');
            if (legendEl) legendEl.innerHTML = '<div class="gtp-pie-empty"><i class="fas fa-inbox"></i><br>No records yet</div>';
            return; /* leave the ring as a clean dashed placeholder rather than draw a fake chart */
        }

        wrapEl && wrapEl.classList.remove('gtp-pie-empty-ring');
        _gtpCharts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: labels.map(_gtpStatusLabel), datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: { legend: { display: false }, tooltip: { enabled: true } }
            }
        });

        if (legendEl) {
            legendEl.innerHTML = labels.map(function(s, i) {
                return '<div class="gtp-legend-item"><span class="gtp-legend-dot" style="background:' + colors[i] + ';"></span>'
                    + '<span>' + _gtpStatusLabel(s) + '</span><strong>' + counts[i].toLocaleString() + '</strong></div>';
            }).join('');
        }
    }

    function _renderCategoryPies(grants) {
        _renderOneCategoryPie('ngo',        'gtp-pie-ngo',        'gtp-pie-ngo-value',        'gtp-pie-ngo-legend',        grants);
        _renderOneCategoryPie('individual', 'gtp-pie-individual', 'gtp-pie-individual-value', 'gtp-pie-individual-legend', grants);
        _renderOneCategoryPie('sos',        'gtp-pie-sos',        'gtp-pie-sos-value',        'gtp-pie-sos-legend',        grants);
    }

    /* =========================================================================
       §2e  _renderTrendChart  (Chart.js)
       Historical disbursement totals bucketed by month (solid line), plus a
       projected trend extending 3 months forward via simple linear-regression
       over the historical monthly totals (dashed line). This is a directional
       estimate from past activity, not a financial forecast — labeled as such
       in the card's subtitle. Renders nothing if there's no dated data yet,
       rather than fabricate a trend from zero points.
       ========================================================================= */
    function _renderTrendChart(grants) {
        var canvas = document.getElementById('gtp-trend-chart');
        if (!canvas) return;
        var wrapEl = canvas.closest('.gtp-trend-canvas-wrap');

        if (_gtpCharts['gtp-trend-chart']) { _gtpCharts['gtp-trend-chart'].destroy(); _gtpCharts['gtp-trend-chart'] = null; }

        if (!window.Chart) {
            _gtpSetPlaceholder(wrapEl, 'fa-plug-circle-xmark', 'Trend chart unavailable right now');
            return;
        }

        var byMonth = {};
        grants.forEach(function(g) {
            if (!g.dateTs) return;
            var key = g.dateTs.getFullYear() + '-' + String(g.dateTs.getMonth() + 1).padStart(2, '0');
            byMonth[key] = (byMonth[key] || 0) + (g.amountRaw || 0);
        });
        var months = Object.keys(byMonth).sort();

        if (!months.length) {
            _gtpSetPlaceholder(wrapEl, 'fa-chart-line', 'Trend appears once disbursements are dated and recorded');
            return;
        }
        _gtpClearPlaceholder(wrapEl);

        var historical = months.map(function(m) { return byMonth[m]; });
        var n = historical.length;
        var projectedMonths = [], projectedValues = [];

        if (n >= 2) {
            var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            historical.forEach(function(y, x) { sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; });
            var denom = (n * sumXX - sumX * sumX) || 1;
            var slope = (n * sumXY - sumX * sumY) / denom;
            var intercept = (sumY - slope * sumX) / n;

            var lastParts = months[months.length - 1].split('-');
            var y = Number(lastParts[0]), m = Number(lastParts[1]);
            for (var i = 1; i <= 3; i++) {
                m += 1;
                if (m > 12) { m = 1; y += 1; }
                projectedMonths.push(y + '-' + String(m).padStart(2, '0'));
                projectedValues.push(Math.max(0, Math.round(slope * (n - 1 + i) + intercept)));
            }
        }

        var allLabels = months.concat(projectedMonths);
        var historicalSeries = historical.concat(projectedMonths.map(function() { return null; }));
        var projectedSeries = months.slice(0, -1).map(function() { return null; });
        /* Anchor the dashed line to the last real point so it visually connects,
           then continue with the projected values. */
        if (months.length) projectedSeries.push(historical[historical.length - 1]);
        projectedSeries = projectedSeries.concat(projectedValues.length ? projectedValues : projectedMonths.map(function() { return null; }));

        _gtpCharts['gtp-trend-chart'] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: allLabels,
                datasets: [
                    { label: 'Actual disbursed', data: historicalSeries, borderColor: '#1B2B8B', backgroundColor: 'rgba(27,43,139,0.08)', fill: true, tension: 0.25 },
                    { label: 'Projected (trend estimate)', data: projectedSeries, borderColor: '#C9A66B', borderDash: [6, 4], backgroundColor: 'transparent', fill: false, tension: 0.25 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    window.renderGrantLedger = renderGrantLedger;


    /* =========================================================================
       §3  renderCommunityTasks
       FIX (2026-07-25 — premium redesign / broken icons): this is the
       renderer actually wired to #community-tasks-list on the live app
       (app-auth.js's own module map names this file for it). A parallel
       "FIX 9" block inside app-fixes.js was redesigned earlier this
       session under the mistaken assumption IT was the active renderer —
       it wasn't; this one runs after it and overwrites the container,
       which is why that earlier redesign never appeared live. Root cause
       identified via a byte-level fetch of the served app-fixes.js/
       style.css (confirmed up to date) plus a stack-trace-on-write watch
       on #community-tasks-list.innerHTML, then chasing renderCommunityTasks'
       real definition through app-auth.js's own module map comment to here.

       Markup/classes below are the same premium redesign already shipped
       in style.css (.comm-task-item / .comm-task-icon / .comm-task-cta /
       etc. — those rules are already live, confirmed via fetch, so no
       CSS changes are needed here, only this template). Icons are inline
       SVG instead of Font Awesome brand glyphs for the same reason the
       SOS/Crisis forms were switched earlier this session: no external
       font request, so no risk of a broken "tofu" glyph on a slow
       connection — task.icon's FA class string (e.g. "fab fa-twitter")
       is mapped to a matching SVG by its icon name below.

       BEHAVIOR PRESERVED EXACTLY (do not change without checking
       §15 COMMUNITY TASK CLICK HANDLER above, which this depends on):
         • the button keeps the "community-task-btn" class — the
           delegated click listener selects on that class, not an id.
         • data-task-id / data-reward / data-url attributes, unchanged.
         • completed tasks are still filtered OUT of `incomplete` and
           never rendered — there is no completed/"Done" state row here,
           matching the click handler's own re-render-after-complete flow.
       ========================================================================= */

    var _commTaskIcons = {
        'twitter':        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 3H22l-7.6 8.7L23 21h-6.6l-5.2-6.5L5.2 21H2l8.1-9.3L1.6 3h6.8l4.7 5.9L18.9 3Zm-1.2 16h1.8L7.4 4.9H5.5L17.7 19Z"/></svg>',
        'x-twitter':      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 3H22l-7.6 8.7L23 21h-6.6l-5.2-6.5L5.2 21H2l8.1-9.3L1.6 3h6.8l4.7 5.9L18.9 3Zm-1.2 16h1.8L7.4 4.9H5.5L17.7 19Z"/></svg>',
        'instagram':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>',
        'youtube':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9.3v5.4l4.8-2.7-4.8-2.7Z" fill="currentColor" stroke="none"/></svg>',
        'linkedin':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="7.5" y1="10.2" x2="7.5" y2="17"/><circle cx="7.5" cy="6.8" r="0.9" fill="currentColor" stroke="none"/><path d="M11.3 17v-4.3c0-1.6 1-2.4 2.3-2.4 1.3 0 2.2.8 2.2 2.4V17"/><line x1="11.3" y1="10.2" x2="11.3" y2="17"/></svg>',
        'telegram':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
        'telegram-plane': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
        'facebook':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 21v-8h2.7l.4-3.2h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.6V3.5c-.3 0-1.2-.1-2.3-.1-2.4 0-4 1.4-4 4.1v2.3H8.7V13h2.7v8h3.1Z"/></svg>',
        'facebook-f':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 21v-8h2.7l.4-3.2h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.6V3.5c-.3 0-1.2-.1-2.3-.1-2.4 0-4 1.4-4 4.1v2.3H8.7V13h2.7v8h3.1Z"/></svg>',
        'tiktok':         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v11.2a3.7 3.7 0 1 1-3.7-3.7"/><path d="M14 3c.3 2.4 1.9 4.1 4.5 4.3"/></svg>',
        'whatsapp':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>'
    };
    var _commTaskArrowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

    function _commTaskIconSvg(iconClass) {
        var m = /fa-([a-z0-9-]+)/i.exec(iconClass || '');
        var key = m ? m[1].toLowerCase() : '';
        return _commTaskIcons[key] || _commTaskArrowIcon;
    }

    function renderCommunityTasks() {
        var container = document.getElementById('community-tasks-list');
        if (!container) return;

        var us             = _us();
        var completedTasks = us.completedTasks instanceof Set
            ? us.completedTasks
            : new Set(Array.isArray(us.completedTasks) ? us.completedTasks : []);

        var allTasks   = _tasks();
        var incomplete = allTasks.filter(function(t) { return !completedTasks.has(t.id); });

        if (!incomplete.length) {
            container.innerHTML =
                '<p style="text-align:center;padding:20px;color:var(--text-muted);">'
                + '<i class="fas fa-check-circle" style="color:var(--success-color);font-size:1.5rem;display:block;margin-bottom:8px;"></i>'
                + 'All tasks completed! Check back later for more.</p>';
            return;
        }

        container.innerHTML = incomplete.map(function(task) {
            return '<li class="comm-task-item" data-task-id="' + _esc(task.id) + '">'
                + '<div class="comm-task-info">'
                + '<span class="comm-task-icon" data-brand="' + _esc(task.icon) + '">' + _commTaskIconSvg(task.icon) + '</span>'
                + '<div class="comm-task-text">'
                + '<strong>' + _esc(task.text) + '</strong>'
                + '<span class="comm-task-reward-amt">+' + _esc(String(task.reward)) + ' EMPY</span>'
                + '</div>'
                + '</div>'
                + '<button class="community-task-btn comm-task-cta" '
                + 'data-url="' + _esc(task.url) + '" '
                + 'data-reward="' + _esc(String(task.reward)) + '" '
                + 'data-task-id="' + _esc(task.id) + '">'
                + 'Go &amp; Earn ' + _commTaskArrowIcon
                + '</button>'
                + '</li>';
        }).join('');
    }
    window.renderCommunityTasks = renderCommunityTasks;


    /* =========================================================================
       §4  renderNgoGrid  (ENHANCED v2)
       Renders the NGO partner card grid with enhanced verification badges,
       search/filter, impact stats preview, and public application CTA.
       ========================================================================= */

    function renderNgoGrid() {
        var container = document.getElementById('ngo-grid-container');
        if (!container) return;

        var partners = Object.values(_partners());

        if (!partners.length) {
            container.innerHTML =
                '<div style="text-align:center;padding:40px 24px;">'
                + '<div style="width:80px;height:80px;border-radius:50%;background:rgba(0,212,170,0.1);'
                + 'display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:2rem;">'
                + '<i class="fas fa-building" style="color:var(--nav-accent,#00D4AA);"></i></div>'
                + '<h4 style="font-weight:700;margin-bottom:8px;">No NGO Partners Yet</h4>'
                + '<p style="color:var(--text-muted);font-size:0.88rem;max-width:360px;margin:0 auto 20px;">'
                + 'Verified NGO partners will appear here. Are you an NGO? Apply to become a partner.</p>'
                + '<button class="btn btn-accent" onclick="window.openNgoApplicationModal && window.openNgoApplicationModal()">'
                + '<i class="fas fa-plus-circle"></i> Apply as NGO Partner</button>'
                + '</div>';
            return;
        }

        /* Search / filter bar injection (once only) */
        var searchBar = document.getElementById('ngo-search-bar');
        if (!searchBar) {
            var filterHTML =
                '<div id="ngo-search-bar" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;">'
                + '<div style="position:relative;flex:1;min-width:200px;">'
                + '<i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.85rem;pointer-events:none;"></i>'
                + '<input id="ngo-search-input" type="text" placeholder="Search NGO partners…" '
                + 'style="width:100%;padding:9px 12px 9px 34px;border:1.5px solid rgba(0,212,170,0.2);'
                + 'border-radius:10px;background:rgba(232,240,255,0.05);color:inherit;font-size:0.88rem;"'
                + ' oninput="window._filterNgoGrid && window._filterNgoGrid(this.value)"></div>'
                + '<select id="ngo-sector-filter" style="padding:9px 12px;border:1.5px solid rgba(0,212,170,0.2);'
                + 'border-radius:10px;background:rgba(232,240,255,0.05);color:inherit;font-size:0.85rem;"'
                + ' onchange="window._filterNgoGrid && window._filterNgoGrid(document.getElementById(\'ngo-search-input\').value)">'
                + '<option value="">All Sectors</option>'
                + '<option value="health">Health</option>'
                + '<option value="education">Education</option>'
                + '<option value="food">Food Security</option>'
                + '<option value="environment">Environment</option>'
                + '<option value="shelter">Shelter</option>'
                + '<option value="gender">Gender Equality</option>'
                + '<option value="youth">Youth Development</option>'
                + '</select>'
                + '<button class="btn btn-accent" onclick="window.openNgoApplicationModal && window.openNgoApplicationModal()" '
                + 'style="white-space:nowrap;font-size:0.85rem;padding:9px 16px;">'
                + '<i class="fas fa-plus-circle"></i> Register NGO</button>'
                + '</div>';
            container.insertAdjacentHTML('beforebegin', filterHTML);
        }

        container.innerHTML = partners.map(function(ngo) {
            var desc = (ngo.description || '').length > 90
                ? ngo.description.substring(0, 88) + '…'
                : (ngo.description || '');
            var totalRaised = ngo.stats && ngo.stats.raised
                ? _fmtAmount(ngo.stats.raised, ngo.stats.raisedCurrency || 'USD')
                : null;
            var grantsReceived = ngo.grantsTotal || 0;
            var isVerified = ngo.isVerified !== false;
            var sector = _esc(ngo.sector || ngo.category || '');

            return '<div class="ngo-card card" data-ngo-id="' + _esc(ngo.id) + '" '
                + 'data-sector="' + sector.toLowerCase() + '" '
                + 'data-name="' + _esc((ngo.name||'').toLowerCase()) + '" '
                + 'style="cursor:pointer;padding:0;transition:transform 0.2s,box-shadow 0.2s;overflow:hidden;position:relative;">'
                /* Teal accent top bar */
                + '<div style="height:4px;background:linear-gradient(90deg,var(--nav-accent,#00D4AA),#7EEEDD);"></div>'
                + '<div style="padding:20px;">'
                /* Verification badge */
                + (isVerified
                    ? '<div style="position:absolute;top:14px;right:14px;font-size:0.68rem;font-weight:700;color:#22c55e;'
                    + 'background:rgba(34,197,94,0.12);padding:2px 8px;border-radius:50px;border:1px solid rgba(34,197,94,0.3);">'
                    + '<i class="fas fa-shield-alt"></i> VERIFIED</div>'
                    : '<div style="position:absolute;top:14px;right:14px;font-size:0.68rem;font-weight:700;color:#F59E0B;'
                    + 'background:rgba(245,158,11,0.12);padding:2px 8px;border-radius:50px;border:1px solid rgba(245,158,11,0.3);">'
                    + '<i class="fas fa-clock"></i> PENDING</div>')
                /* Logo */
                + '<div style="width:68px;height:68px;border-radius:14px;margin:0 auto 14px;overflow:hidden;'
                + 'background:linear-gradient(135deg,rgba(0,212,170,0.15),rgba(0,212,170,0.05));'
                + 'border:2px solid rgba(0,212,170,0.2);display:flex;align-items:center;justify-content:center;">'
                + '<img src="' + _esc(ngo.logo || '') + '" alt="' + _esc(ngo.name) + '" '
                + 'loading="lazy" style="width:100%;height:100%;object-fit:cover;" '
                + 'onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'<i class=\\\"fas fa-building\\\" style=\\\"font-size:1.6rem;color:var(--nav-accent,#00D4AA);\\\"></i>\'">'
                + '</div>'
                /* Name & desc */
                + '<h4 style="font-weight:700;text-align:center;margin-bottom:6px;">' + _esc(ngo.name) + '</h4>'
                + (sector ? '<div style="text-align:center;margin-bottom:8px;"><span style="font-size:0.72rem;font-weight:600;color:var(--nav-accent,#00D4AA);'
                + 'background:rgba(0,212,170,0.1);padding:2px 10px;border-radius:50px;">' + _esc(ngo.sector || ngo.category || '') + '</span></div>' : '')
                + '<p style="font-size:0.82rem;color:var(--text-muted);line-height:1.5;text-align:center;margin-bottom:14px;">' + _esc(desc) + '</p>'
                /* Mini stats */
                + '<div style="display:flex;gap:12px;justify-content:center;border-top:1px solid rgba(0,212,170,0.1);padding-top:12px;">'
                + (totalRaised
                    ? '<div style="text-align:center;"><div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Raised</div>'
                    + '<div style="font-size:0.9rem;font-weight:700;color:var(--nav-accent,#00D4AA);">' + _esc(totalRaised) + '</div></div>'
                    : '')
                + (grantsReceived
                    ? '<div style="text-align:center;"><div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Grants</div>'
                    + '<div style="font-size:0.9rem;font-weight:700;">' + grantsReceived + '</div></div>'
                    : '')
                + (ngo.stats && ngo.stats.peopleHelped
                    ? '<div style="text-align:center;"><div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Helped</div>'
                    + '<div style="font-size:0.9rem;font-weight:700;">' + (ngo.stats.peopleHelped).toLocaleString() + '</div></div>'
                    : '')
                + '</div>'
                /* Bank account info (shown when available) */
                + (ngo.bankAccountNumber || ngo.bankName
                    ? '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(0,212,170,0.05);border:1px solid rgba(0,212,170,0.12);font-size:0.78rem;">'
                    + '<div style="font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;font-size:0.68rem;">'
                    + '<i class="fas fa-university" style="color:var(--nav-accent,#00D4AA);margin-right:4px;"></i>Bank Details</div>'
                    + (ngo.bankAccountName ? '<div style="margin-bottom:2px;"><span style="color:var(--text-muted);">Name:</span> <strong>' + _esc(ngo.bankAccountName) + '</strong></div>' : '')
                    + (ngo.bankAccountNumber ? '<div style="margin-bottom:2px;"><span style="color:var(--text-muted);">Account:</span> <strong>' + _esc(ngo.bankAccountNumber) + '</strong></div>' : '')
                    + (ngo.bankName ? '<div><span style="color:var(--text-muted);">Bank:</span> <strong>' + _esc(ngo.bankName) + '</strong></div>' : '')
                    + '</div>'
                    : '')
                + '</div>'
                + '</div>';
        }).join('');
    }
    window.renderNgoGrid = renderNgoGrid;

    /* NGO grid client-side filter */
    window._filterNgoGrid = function(query) {
        var q      = (query || '').toLowerCase().trim();
        var sector = (document.getElementById('ngo-sector-filter') || {}).value || '';
        document.querySelectorAll('.ngo-card').forEach(function(card) {
            var name   = (card.dataset.name   || '').toLowerCase();
            var cardSector = (card.dataset.sector || '').toLowerCase();
            var matchQ = !q || name.includes(q);
            var matchS = !sector || cardSector.includes(sector.toLowerCase());
            card.style.display = (matchQ && matchS) ? '' : 'none';
        });
    };


    /* =========================================================================
       §5  renderNgoProfile  (ENHANCED v2)
       Detailed NGO profile with impact stats, grant history, impact reports,
       verification status, and public documents section.
       ========================================================================= */

    function renderNgoProfile(ngoId) {
        var ngo = _partners()[ngoId];
        if (!ngo) {
            _notify('NGO profile not found.', 'error');
            return;
        }

        var gridView    = document.getElementById('ngo-grid-view');
        var backBtn     = document.getElementById('back-to-ngo-grid');
        var profileView = document.getElementById('ngo-profile-view');
        if (!profileView) return;

        if (gridView)  gridView.style.display  = 'none';
        if (backBtn)   backBtn.style.display    = 'inline-flex';
        profileView.style.display = 'block';

        var stats        = ngo.stats || {};
        var raised       = stats.raised       || 0;
        var projects     = stats.projects     || 0;
        var peopleHelped = stats.peopleHelped || 0;
        var raisedStr    = typeof window.formatUsdPrice === 'function'
            ? window.formatUsdPrice(raised)
            : '$' + raised.toLocaleString();
        var isVerified   = ngo.isVerified !== false;
        var regNumber    = ngo.registrationNumber || ngo.regNumber || '—';
        var country      = ngo.country || ngo.location || '—';
        var website      = ngo.website || '';
        var grantHist    = Array.isArray(ngo.grantHistory) ? ngo.grantHistory : [];

        profileView.innerHTML =
            /* Header card */
            '<div class="card" style="margin-bottom:16px;overflow:hidden;">'
            + '<div style="height:5px;background:linear-gradient(90deg,var(--nav-accent,#00D4AA),#7EEEDD,var(--nav-accent,#00D4AA));"></div>'
            + '<div class="card-content">'
            + '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">'
            /* Logo */
            + '<div style="width:90px;height:90px;border-radius:16px;overflow:hidden;flex-shrink:0;'
            + 'border:2px solid rgba(0,212,170,0.3);background:rgba(0,212,170,0.08);'
            + 'display:flex;align-items:center;justify-content:center;">'
            + '<img src="' + _esc(ngo.logo || '') + '" alt="' + _esc(ngo.name) + '" '
            + 'loading="lazy" style="width:100%;height:100%;object-fit:cover;" '
            + 'onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'<i class=\\\"fas fa-building\\\" style=\\\"font-size:2rem;color:var(--nav-accent,#00D4AA);\\\"></i>\'">'
            + '</div>'
            /* Info */
            + '<div style="flex:1;min-width:200px;">'
            + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">'
            + '<h2 style="font-family:\'Syne\',sans-serif;font-weight:800;margin:0;">' + _esc(ngo.name) + '</h2>'
            + (isVerified
                ? '<span style="font-size:0.72rem;font-weight:700;color:#22c55e;background:rgba(34,197,94,0.12);'
                + 'padding:3px 10px;border-radius:50px;border:1px solid rgba(34,197,94,0.3);">'
                + '<i class="fas fa-shield-alt"></i> Verified Partner</span>'
                : '<span style="font-size:0.72rem;font-weight:700;color:#F59E0B;background:rgba(245,158,11,0.12);'
                + 'padding:3px 10px;border-radius:50px;border:1px solid rgba(245,158,11,0.3);">'
                + '<i class="fas fa-clock"></i> Pending Verification</span>')
            + '</div>'
            + '<p style="color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin:0 0 12px;">' + _esc(ngo.description || '') + '</p>'
            + '<div style="display:flex;flex-wrap:wrap;gap:16px;">'
            + (regNumber !== '—' ? '<div style="font-size:0.8rem;"><i class="fas fa-id-card" style="color:var(--nav-accent,#00D4AA);margin-right:5px;"></i><strong>Reg No:</strong> ' + _esc(regNumber) + '</div>' : '')
            + '<div style="font-size:0.8rem;"><i class="fas fa-map-marker-alt" style="color:var(--nav-accent,#00D4AA);margin-right:5px;"></i>' + _esc(country) + '</div>'
            + (ngo.sector ? '<div style="font-size:0.8rem;"><i class="fas fa-tag" style="color:var(--nav-accent,#00D4AA);margin-right:5px;"></i>' + _esc(ngo.sector) + '</div>' : '')
            + (website ? '<div style="font-size:0.8rem;"><a href="' + _esc(website) + '" target="_blank" rel="noopener" style="color:var(--nav-accent,#00D4AA);">'
            + '<i class="fas fa-globe" style="margin-right:5px;"></i>Website</a></div>' : '')
            + '</div>'
            /* Bank Account Details */
            + (ngo.bankAccountNumber || ngo.bankName
                ? '<div style="margin-top:14px;padding:12px 16px;border-radius:12px;background:rgba(0,212,170,0.06);border:1px solid rgba(0,212,170,0.18);">'
                + '<div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">'
                + '<i class="fas fa-university" style="color:var(--nav-accent,#00D4AA);margin-right:5px;"></i>Bank Account Details</div>'
                + '<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:0.84rem;">'
                + (ngo.bankAccountName ? '<div><span style="color:var(--text-muted);">Account Name:</span> <strong>' + _esc(ngo.bankAccountName) + '</strong></div>' : '')
                + (ngo.bankAccountNumber ? '<div><span style="color:var(--text-muted);">Account Number:</span> <strong style="font-family:monospace;">' + _esc(ngo.bankAccountNumber) + '</strong></div>' : '')
                + (ngo.bankName ? '<div><span style="color:var(--text-muted);">Bank:</span> <strong>' + _esc(ngo.bankName) + '</strong></div>' : '')
                + '</div>'
                + '</div>'
                : '')
            + '</div>'
            /* Donate button */
            + '<div style="display:flex;flex-direction:column;gap:8px;">'
            + '<button class="btn btn-accent" style="white-space:nowrap;" '
            + 'onclick="window._openNgoDonationModal && window._openNgoDonationModal(\'' + _esc(ngoId) + '\')">'
            + '<i class="fas fa-hand-holding-heart"></i> Donate to ' + _esc(ngo.name.split(' ')[0])
            + '</button>'
            + '</div>'
            + '</div>'
            + '</div>'
            + '</div>'

            /* Impact stats */
            + '<div class="card" style="margin-bottom:16px;">'
            + '<div class="card-content">'
            + '<h3 style="margin-bottom:16px;font-family:\'Syne\',sans-serif;">'
            + '<i class="fas fa-chart-bar" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Impact At a Glance</h3>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px;">'
            + _statCard('Total Raised', raisedStr, 'fa-coins', '#00D4AA')
            + _statCard('Projects Funded', projects.toLocaleString(), 'fa-project-diagram', '#3B82F6')
            + _statCard('People Helped', peopleHelped.toLocaleString(), 'fa-users', '#22c55e')
            + _statCard('Grants Received', (ngo.grantsTotal || 0).toString(), 'fa-donate', '#F59E0B')
            + '</div>'
            + '</div>'
            + '</div>'

            /* Grant History */
            + (grantHist.length
                ? '<div class="card" style="margin-bottom:16px;">'
                + '<div class="card-content">'
                + '<h3 style="margin-bottom:14px;font-family:\'Syne\',sans-serif;">'
                + '<i class="fas fa-history" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Grant History</h3>'
                + '<div style="overflow-x:auto;">'
                + '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">'
                + '<thead><tr style="border-bottom:2px solid rgba(0,212,170,0.15);">'
                + '<th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600;">Grant ID</th>'
                + '<th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600;">Amount</th>'
                + '<th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600;">Purpose</th>'
                + '<th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600;">Status</th>'
                + '<th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600;">Date</th>'
                + '</tr></thead><tbody>'
                + grantHist.map(function(g) {
                    return '<tr style="border-bottom:1px solid rgba(10,14,39,0.06);">'
                        + '<td style="padding:8px 12px;font-family:monospace;font-size:0.78rem;color:var(--text-muted);">' + _esc(g.id || '—') + '</td>'
                        + '<td style="padding:8px 12px;font-weight:700;">' + _esc(_fmtAmount(g.amount, g.currency)) + '</td>'
                        + '<td style="padding:8px 12px;">' + _esc(g.purpose || '—') + '</td>'
                        + '<td style="padding:8px 12px;">' + _statusBadge(g.status || 'completed') + '</td>'
                        + '<td style="padding:8px 12px;font-size:0.8rem;">' + _esc(g.date || '—') + '</td>'
                        + '</tr>';
                }).join('')
                + '</tbody></table>'
                + '</div>'
                + '</div>'
                + '</div>'
                : '')

            /* Project reports feed */
            + '<div class="card">'
            + '<div class="card-content">'
            + '<h3 style="margin-bottom:16px;font-family:\'Syne\',sans-serif;">'
            + '<i class="fas fa-stream" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Project Reports &amp; Updates</h3>'
            + '<div id="ngo-feed-container" style="margin-top:4px;"></div>'
            + '</div></div>';

        /* Populate feed */
        var feedContainer = document.getElementById('ngo-feed-container');
        if (feedContainer && ngo.posts && ngo.posts.length) {
            ngo.posts.forEach(function(postData) {
                if (typeof window.createNewPostElement === 'function') {
                    var author   = { id: ngo.id, fullName: ngo.name, avatar: ngo.logo };
                    var mediaObjs = (postData.media || []).map(function(u) {
                        return { _cloudUrl: u, url: u, type: 'image/jpeg' };
                    });
                    var postEl = window.createNewPostElement(postData.content || '', mediaObjs, author);
                    feedContainer.appendChild(postEl);
                }
            });
        } else if (feedContainer) {
            feedContainer.innerHTML =
                '<p style="text-align:center;padding:24px;color:var(--text-muted);">'
                + '<i class="fas fa-file-alt" style="font-size:1.5rem;display:block;margin-bottom:8px;opacity:0.4;"></i>'
                + 'No project reports published yet.</p>';
        }
    }
    window.renderNgoProfile = renderNgoProfile;

    /* Helper — compact stat card */
    function _statCard(label, value, icon, color) {
        return '<div style="text-align:center;padding:16px;border-radius:12px;background:rgba(0,212,170,0.04);border:1px solid rgba(0,212,170,0.1);">'
            + '<div style="width:38px;height:38px;border-radius:10px;background:' + (color || 'var(--nav-accent,#00D4AA)') + '22;'
            + 'display:flex;align-items:center;justify-content:center;margin:0 auto 8px;">'
            + '<i class="fas ' + icon + '" style="color:' + (color || 'var(--nav-accent,#00D4AA)') + ';font-size:1rem;"></i></div>'
            + '<div style="font-size:1.3rem;font-weight:800;font-family:\'Syne\',sans-serif;">' + value + '</div>'
            + '<div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">' + label + '</div>'
            + '</div>';
    }


    /* =========================================================================
       §6  renderGrantDashboard  (NEW)
       Top-level analytics dashboard for the Grant Portal.
       Shows live KPIs, fund allocation donut, disbursement timeline.
       ========================================================================= */

    function renderGrantDashboard() {
        var container = document.getElementById('grant-dashboard-container');
        if (!container) return;

        /* Pull live stats from Firestore */
        var totalDisbursed = 0, totalNgos = 0, totalIndividuals = 0, pendingCount = 0;
        var ledger = _ledger();
        ledger.forEach(function(g) { totalDisbursed += parseFloat(String(g.amount || '0').replace(/[^0-9.]/g, '')) || 0; });
        totalNgos = Object.keys(_partners()).length;

        container.innerHTML =
            /* KPI row */
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px;">'
            + _kpiCard('Total Disbursed', _fmtAmount(totalDisbursed, 'NGN'), 'fa-paper-plane', '#00D4AA', '+12% this month')
            + _kpiCard('Active NGOs', totalNgos.toString(), 'fa-building', '#3B82F6', 'Verified partners')
            + _kpiCard('Individual Grants', '—', 'fa-user-check', '#22c55e', 'Direct recipients')
            + _kpiCard('Pending Approvals', '—', 'fa-clock', '#F59E0B', 'Awaiting review')
            + '</div>'
            /* Ledger table */
            + '<div class="card">'
            + '<div class="card-content">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">'
            + '<h3 style="font-family:\'Syne\',sans-serif;margin:0;">'
            + '<i class="fas fa-link" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>'
            + 'Grant Transparency Ledger <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400;margin-left:6px;">Public Audit Record</span></h3>'
            + '<div style="display:flex;gap:8px;">'
            + '<button class="btn btn-small" style="font-size:0.78rem;" onclick="window.renderGrantLedger && window.renderGrantLedger()">'
            + '<i class="fas fa-sync-alt"></i> Refresh</button>'
            + '<button class="btn btn-small btn-accent" style="font-size:0.78rem;" onclick="window._exportGrantReport && window._exportGrantReport(\'csv\')">'
            + '<i class="fas fa-download"></i> Export CSV</button>'
            + '</div>'
            + '</div>'
            + '<div style="overflow-x:auto;">'
            + '<table style="width:100%;border-collapse:collapse;font-size:0.84rem;">'
            + '<thead><tr style="border-bottom:2px solid rgba(0,212,170,0.15);">'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">Grant ID</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">Recipient</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">Project/Purpose</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">NGO Grant</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">Individual Grant</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">SOS Empowerment</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">Status</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">Type</th>'
            + '<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;">Date</th>'
            + '</tr></thead>'
            + '<tbody id="grant-ledger-body"><tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);">'
            + '<i class="fas fa-circle-notch fa-spin"></i> Loading ledger…</td></tr></tbody>'
            + '</table>'
            + '</div>'
            + '</div>'
            + '</div>';

        /* Now load the ledger rows */
        setTimeout(renderGrantLedger, 200);

        /* Pull live pending count from Firestore */
        _refreshDashboardKPIs();
    }
    window.renderGrantDashboard = renderGrantDashboard;

    function _kpiCard(label, value, icon, color, sub) {
        return '<div style="padding:18px;border-radius:14px;background:rgba(0,212,170,0.04);border:1px solid rgba(0,212,170,0.12);">'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
            + '<div style="width:36px;height:36px;border-radius:10px;background:' + color + '22;'
            + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
            + '<i class="fas ' + icon + '" style="color:' + color + ';font-size:0.95rem;"></i></div>'
            + '<div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">' + label + '</div>'
            + '</div>'
            + '<div style="font-size:1.6rem;font-weight:800;font-family:\'Syne\',sans-serif;color:' + color + ';">' + value + '</div>'
            + (sub ? '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;">' + sub + '</div>' : '')
            + '</div>';
    }

    function _refreshDashboardKPIs() {
        if (!_fbOk() || !_db()) return;
        /* Update pending approvals */
        _db().collection('grant_applications').where('status', '==', 'pending').get()
            .then(function(s) {
                var els = document.querySelectorAll('[data-kpi="pending"]');
                els.forEach(function(el) { el.textContent = s.size || '0'; });
            }).catch(function() {});
        /* Update individual grant count */
        _db().collection('individual_grants').where('status', '==', 'disbursed').get()
            .then(function(s) {
                var els = document.querySelectorAll('[data-kpi="individuals"]');
                els.forEach(function(el) { el.textContent = s.size || '0'; });
            }).catch(function() {});
    }
    window._refreshGrantDashboard = function() { renderGrantDashboard(); };


    /* =========================================================================
       §7  renderNgoVerificationQueue  (NEW)
       Admin-only panel showing pending NGO applications with KYC docs.
       ========================================================================= */

    function renderNgoVerificationQueue() {
        var container = document.getElementById('ngo-verification-queue-container');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">'
            + '<i class="fas fa-circle-notch fa-spin"></i> Loading verification queue…</div>';

        if (!_fbOk() || !_db()) {
            container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">'
                + '<i class="fas fa-wifi" style="font-size:1.5rem;display:block;margin-bottom:8px;opacity:0.4;"></i>'
                + 'Firebase not connected. Verification queue unavailable.</div>';
            return;
        }

        _db().collection('ngo_applications')
            .orderBy('submittedAt', 'desc')
            .limit(50)
            .get()
            .then(function(snap) {
                if (snap.empty) {
                    container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);">'
                        + '<i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.3;"></i>'
                        + '<strong>No pending applications</strong><br>'
                        + '<span style="font-size:0.83rem;">New NGO applications will appear here for review.</span></div>';
                    return;
                }

                var cards = [];
                snap.forEach(function(doc) {
                    var d  = doc.data();
                    var dt = d.submittedAt && d.submittedAt.toDate
                        ? d.submittedAt.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
                        : '—';
                    var statusBadge = _statusBadge(d.status || 'pending');
                    var docs = Array.isArray(d.documents) ? d.documents : [];

                    cards.push(
                        '<div class="card" style="margin-bottom:14px;border-left:4px solid '
                        + (d.status === 'pending' ? '#F59E0B' : d.status === 'approved' ? '#22c55e' : '#ef4444')
                        + ';" id="ngo-app-' + doc.id + '">'
                        + '<div style="padding:16px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">'
                        /* NGO info */
                        + '<div style="flex:1;min-width:220px;">'
                        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">'
                        + '<strong style="font-size:1rem;">' + _esc(d.orgName || d.name || 'Unnamed NGO') + '</strong>'
                        + statusBadge
                        + '</div>'
                        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:0.82rem;color:var(--text-muted);">'
                        + '<div><i class="fas fa-id-card" style="width:14px;color:var(--nav-accent,#00D4AA);"></i> ' + _esc(d.regNumber || '—') + '</div>'
                        + '<div><i class="fas fa-map-marker-alt" style="width:14px;color:var(--nav-accent,#00D4AA);"></i> ' + _esc(d.country || '—') + '</div>'
                        + '<div><i class="fas fa-envelope" style="width:14px;color:var(--nav-accent,#00D4AA);"></i> ' + _esc(d.email || '—') + '</div>'
                        + '<div><i class="fas fa-tag" style="width:14px;color:var(--nav-accent,#00D4AA);"></i> ' + _esc(d.sector || '—') + '</div>'
                        + '<div><i class="fas fa-calendar" style="width:14px;color:var(--nav-accent,#00D4AA);"></i> ' + dt + '</div>'
                        + '<div><i class="fas fa-phone" style="width:14px;color:var(--nav-accent,#00D4AA);"></i> ' + _esc(d.phone || '—') + '</div>'
                        + '</div>'
                        + (d.mission ? '<p style="font-size:0.82rem;margin:8px 0 0;color:var(--text-muted);line-height:1.5;">' + _esc(d.mission.substring(0, 200)) + (d.mission.length > 200 ? '…' : '') + '</p>' : '')
                        /* Bank account details */
                        + (d.bankAccountNumber || d.bankName
                            ? '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(0,212,170,0.05);border:1px solid rgba(0,212,170,0.12);font-size:0.8rem;">'
                            + '<div style="font-weight:700;color:var(--nav-accent,#00D4AA);margin-bottom:4px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">'
                            + '<i class="fas fa-university" style="margin-right:4px;"></i>Bank Details</div>'
                            + (d.bankAccountName ? '<div><span style="color:var(--text-muted);">Name:</span> <strong>' + _esc(d.bankAccountName) + '</strong></div>' : '')
                            + (d.bankAccountNumber ? '<div><span style="color:var(--text-muted);">Acc No:</span> <strong style="font-family:monospace;">' + _esc(d.bankAccountNumber) + '</strong></div>' : '')
                            + (d.bankName ? '<div><span style="color:var(--text-muted);">Bank:</span> <strong>' + _esc(d.bankName) + '</strong></div>' : '')
                            + '</div>'
                            : '')
                        + '</div>'
                        /* Documents */
                        + '<div style="min-width:160px;">'
                        + '<div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">KYC Documents</div>'
                        + (docs.length
                            ? docs.map(function(docUrl, i) {
                                return '<a href="' + _esc(docUrl) + '" target="_blank" rel="noopener" '
                                    + 'style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--nav-accent,#00D4AA);margin-bottom:4px;">'
                                    + '<i class="fas fa-file-pdf"></i> Document ' + (i + 1) + '</a>';
                            }).join('')
                            : '<span style="font-size:0.78rem;color:var(--text-muted);">No documents uploaded</span>')
                        + '</div>'
                        /* Actions */
                        + (d.status === 'pending'
                            ? '<div style="display:flex;flex-direction:column;gap:8px;">'
                            + '<button class="btn btn-small" style="background:var(--success-color,#22c55e);color:#fff;font-size:0.8rem;" '
                            + 'onclick="window._approveNgoApplication(\'' + doc.id + '\',\'approve\')">'
                            + '<i class="fas fa-check"></i> Approve</button>'
                            + '<button class="btn btn-small" style="background:var(--danger-color,#ef4444);color:#fff;font-size:0.8rem;" '
                            + 'onclick="window._approveNgoApplication(\'' + doc.id + '\',\'reject\')">'
                            + '<i class="fas fa-times"></i> Reject</button>'
                            + '<button class="btn btn-small" style="font-size:0.8rem;" '
                            + 'onclick="window._requestMoreNgoInfo && window._requestMoreNgoInfo(\'' + doc.id + '\')">'
                            + '<i class="fas fa-question-circle"></i> Request Info</button>'
                            + '</div>'
                            : '<div style="font-size:0.78rem;color:var(--text-muted);">Reviewed on<br>' + _esc(d.reviewedAt || '—') + '</div>')
                        + '</div>'
                        + '</div>'
                    );
                });
                container.innerHTML = cards.join('');
            })
            .catch(function(e) {
                container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--danger-color);">'
                    + 'Error loading queue: ' + _esc(e.message || 'Unknown error') + '</div>';
            });
    }
    window.renderNgoVerificationQueue = renderNgoVerificationQueue;


    /* =========================================================================
       §8  renderIndividualGrantPanel  (NEW)
       Admin panel for individual grant disbursement requests.
       ========================================================================= */

    function renderIndividualGrantPanel() {
        var container = document.getElementById('individual-grant-panel-container');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">'
            + '<i class="fas fa-circle-notch fa-spin"></i> Loading individual grant requests…</div>';

        if (!_fbOk() || !_db()) {
            container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Firebase not connected.</div>';
            return;
        }

        _db().collection('individual_grants')
            .orderBy('submittedAt', 'desc')
            .limit(50)
            .get()
            .then(function(snap) {
                if (snap.empty) {
                    container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);">'
                        + '<i class="fas fa-users" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.3;"></i>'
                        + '<strong>No individual grant requests</strong><br>'
                        + '<span style="font-size:0.83rem;">Individual grant applications will appear here.</span>'
                        + '<br><br><button class="btn btn-accent" onclick="window.openIndividualGrantModal && window.openIndividualGrantModal()">'
                        + '<i class="fas fa-plus-circle"></i> Apply for Individual Grant</button></div>';
                    return;
                }

                /* ---- Bulk-select toolbar (sticky above the list) ------------------
                   Selectable = pending/approved rows only (same set the single
                   Disburse button already applies to). Each selected recipient is
                   still paid in THEIR OWN stored amount/currency/method — this
                   batches the *sending*, it doesn't merge amounts together. */
                var toolbar = '<div id="ind-grant-bulk-bar" style="display:flex;align-items:center;gap:12px;'
                    + 'flex-wrap:wrap;padding:12px 14px;margin-bottom:14px;border-radius:12px;'
                    + 'background:rgba(0,212,170,0.06);border:1px solid rgba(0,212,170,0.18);">'
                    + '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;font-weight:700;cursor:pointer;margin:0;">'
                    + '<input type="checkbox" id="ind-grant-select-all" onchange="window._toggleAllIndividualGrantChecks(this.checked)" '
                    + 'style="width:16px;height:16px;accent-color:var(--nav-accent,#00D4AA);"> Select all eligible</label>'
                    + '<span id="ind-grant-selected-count" style="font-size:0.8rem;color:var(--text-muted);">0 selected</span>'
                    + '<button class="btn btn-small" id="ind-grant-bulk-disburse-btn" disabled '
                    + 'style="margin-left:auto;background:#22c55e;color:#fff;font-size:0.8rem;opacity:0.5;" '
                    + 'onclick="window._bulkDisburseIndividualGrants()">'
                    + '<i class="fas fa-paper-plane"></i> Disburse Selected</button>'
                    + '</div>'
                    + '<div id="ind-grant-bulk-feedback" style="display:none;margin-bottom:14px;padding:10px 14px;border-radius:10px;font-size:0.85rem;"></div>';

                var rows = '';
                snap.forEach(function(doc) {
                    var d  = doc.data();
                    var dt = d.submittedAt && d.submittedAt.toDate
                        ? d.submittedAt.toDate().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})
                        : '—';
                    var payMethod = d.paymentMethod || d.method || '—';
                    var eligible  = (d.status === 'pending' || d.status === 'approved');

                    rows += '<div class="card" style="margin-bottom:12px;border-left:4px solid '
                        + (d.status === 'pending' ? '#F59E0B' : d.status === 'disbursed' ? '#22c55e' : '#3B82F6')
                        + ';" id="ind-grant-' + doc.id + '">'
                        + '<div style="padding:14px 16px;display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;">'
                        /* Row checkbox — only for eligible (pending/approved) rows */
                        + (eligible
                            ? '<input type="checkbox" class="ind-grant-chk" data-id="' + doc.id + '" '
                            + 'onchange="window._onIndividualGrantCheckChange()" '
                            + 'style="width:17px;height:17px;margin-top:12px;accent-color:var(--nav-accent,#00D4AA);flex-shrink:0;">'
                            : '<div style="width:17px;flex-shrink:0;"></div>')
                        /* Avatar & name */
                        + '<div style="width:44px;height:44px;border-radius:50%;background:rgba(0,212,170,0.1);'
                        + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
                        + '<i class="fas fa-user" style="color:var(--nav-accent,#00D4AA);"></i></div>'
                        + '<div style="flex:1;min-width:200px;">'
                        + '<div style="font-weight:700;margin-bottom:4px;">' + _esc(d.fullName || d.applicantName || 'Unknown Applicant') + '</div>'
                        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:0.8rem;color:var(--text-muted);">'
                        + '<div><i class="fas fa-coins" style="color:var(--nav-accent,#00D4AA);width:12px;"></i> ' + _esc(_fmtAmount(d.amount, d.currency)) + '</div>'
                        + '<div><i class="fas fa-bullseye" style="color:var(--nav-accent,#00D4AA);width:12px;"></i> ' + _esc(d.purpose || '—') + '</div>'
                        + '<div><i class="fas fa-university" style="color:var(--nav-accent,#00D4AA);width:12px;"></i> ' + _esc(payMethod) + '</div>'
                        + '<div><i class="fas fa-calendar" style="color:var(--nav-accent,#00D4AA);width:12px;"></i> ' + dt + '</div>'
                        + '</div>'
                        + (d.reason ? '<p style="font-size:0.80rem;color:var(--text-muted);margin:6px 0 0;line-height:1.5;">' + _esc(d.reason.substring(0, 180)) + '</p>' : '')
                        + '<div id="ind-grant-status-' + doc.id + '" style="font-size:0.78rem;margin-top:6px;"></div>'
                        + '</div>'
                        + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
                        + _statusBadge(d.status || 'pending')
                        + (eligible
                            ? '<button class="btn btn-small" style="background:#22c55e;color:#fff;font-size:0.78rem;" '
                            + 'onclick="window._approveIndividualGrant(\'' + doc.id + '\',\'disburse\')">'
                            + '<i class="fas fa-paper-plane"></i> Disburse</button>'
                            + '<button class="btn btn-small" style="background:#ef4444;color:#fff;font-size:0.78rem;" '
                            + 'onclick="window._approveIndividualGrant(\'' + doc.id + '\',\'reject\')">'
                            + '<i class="fas fa-times"></i> Reject</button>'
                            : '')
                        + '</div>'
                        + '</div>'
                        + '</div>';
                });
                container.innerHTML = toolbar + rows;
                window._onIndividualGrantCheckChange();
            })
            .catch(function(e) {
                container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--danger-color);">'
                    + 'Error: ' + _esc(e.message || 'Unknown error') + '</div>';
            });
    }
    window.renderIndividualGrantPanel = renderIndividualGrantPanel;

    /* Select-all / selection-count wiring for the bulk toolbar */
    window._toggleAllIndividualGrantChecks = function(checked) {
        document.querySelectorAll('.ind-grant-chk').forEach(function(chk) { chk.checked = checked; });
        window._onIndividualGrantCheckChange();
    };
    window._onIndividualGrantCheckChange = function() {
        var boxes     = document.querySelectorAll('.ind-grant-chk');
        var checked   = document.querySelectorAll('.ind-grant-chk:checked');
        var countEl   = document.getElementById('ind-grant-selected-count');
        var btn       = document.getElementById('ind-grant-bulk-disburse-btn');
        var selectAll = document.getElementById('ind-grant-select-all');
        if (countEl) countEl.textContent = checked.length + ' selected';
        if (btn) {
            btn.disabled      = checked.length === 0;
            btn.style.opacity = checked.length === 0 ? '0.5' : '1';
        }
        if (selectAll) selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
    };


    /* =========================================================================
       §9  renderAdminGrantControlPanel  (NEW)
       Unified admin grant command centre injected into the existing
       #admin-disburse-tab panel (extends app-admin.js disbursement section).
       ========================================================================= */

    function renderAdminGrantControlPanel() {
        var container = document.getElementById('admin-grant-control-container');
        if (!container) return;

        container.innerHTML =
            /* Tabs */
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">'
            + ['Overview','NGO Applications','Individual Grants','Create Allocation','Audit Export','Account Form'].map(function(tab, i) {
                return '<button class="btn btn-small admin-grant-tab" data-tab="agc-' + i + '" '
                    + 'style="font-size:0.80rem;' + (i === 0 ? 'background:var(--nav-accent,#00D4AA);color:#0A0F1E;' : '') + '">'
                    + tab + '</button>';
            }).join('')
            + '</div>'
            /* Tab panels */
            + '<div id="agc-0" class="agc-panel" style="display:block;">'
            + '<div id="grant-dashboard-container"></div>'
            + '</div>'
            + '<div id="agc-1" class="agc-panel" style="display:none;">'
            + '<div id="ngo-verification-queue-container"></div>'
            + '</div>'
            + '<div id="agc-2" class="agc-panel" style="display:none;">'
            + '<div id="bulk-disburse-panel-container"></div>'
            + '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">'
            + '<button class="btn btn-small btn-accent" onclick="window.openIndividualGrantModal && window.openIndividualGrantModal()">'
            + '<i class="fas fa-plus-circle"></i> New Request</button></div>'
            + '<div id="individual-grant-panel-container"></div>'
            + '</div>'
            + '<div id="agc-3" class="agc-panel" style="display:none;padding-bottom:120px;">'
            + _renderCreateAllocationForm()
            + '</div>'
            + '<div id="agc-4" class="agc-panel" style="display:none;">'
            + _renderAuditExportPanel()
            + '</div>'
            + '<div id="agc-5" class="agc-panel" style="display:none;">'
            + _renderIndividualAccountAdminPanel()
            + '</div>';

        _wireAllocationForm();

        /* Wire tab switching */
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.admin-grant-tab');
            if (!btn) return;
            var tabId = btn.dataset.tab;
            container.querySelectorAll('.agc-panel').forEach(function(p) { p.style.display = 'none'; });
            container.querySelectorAll('.admin-grant-tab').forEach(function(b) {
                b.style.background = '';
                b.style.color      = '';
            });
            var panel = document.getElementById(tabId);
            if (panel) panel.style.display = 'block';
            btn.style.background = 'var(--nav-accent,#00D4AA)';
            btn.style.color      = '#0A0F1E';

            if (tabId === 'agc-0') renderGrantDashboard();
            if (tabId === 'agc-1') renderNgoVerificationQueue();
            if (tabId === 'agc-2') { renderIndividualGrantPanel(); if (window.renderBulkDisbursePanel) window.renderBulkDisbursePanel(); }
            if (tabId === 'agc-3') {
                if (window._allocLoadNgoList)   window._allocLoadNgoList();
                if (window._allocFlushPending)  window._allocFlushPending();
            }
            if (tabId === 'agc-5') _renderIndAcctBanner(); /* refresh status on tab open */
        });

        /* Load default tab */
        renderGrantDashboard();
    }
    window.renderAdminGrantControlPanel = renderAdminGrantControlPanel;

    function _renderCreateAllocationForm() {
        return '<div class="card"><div class="card-content">'
            + '<h3 style="font-family:\'Syne\',sans-serif;margin-bottom:16px;">'
            + '<i class="fas fa-plus-circle" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Create Grant Allocation</h3>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;">'
            + _frmField('alloc-recipient-type', 'Recipient Type', 'select',
                '<option value="ngo">NGO Partner</option><option value="individual">Individual</option>')
            + _frmField('alloc-amount', 'Amount', 'number', null, 'e.g. 500000')
            + _frmField('alloc-currency', 'Currency', 'select',
                /* CRYPTO_HIDDEN_FOR_PLAY_STORE: <option value="USDT">USDT</option> removed —
                   real external crypto not launched yet. EMPY Token stays: it's this
                   platform's own in-house currency, not a blockchain feature. */
                '<option value="NGN">NGN (Naira)</option><option value="USD">USD</option><option value="EMPY">EMPY Token</option>')
            + _frmField('alloc-purpose', 'Purpose / Project Name', 'text', null, 'e.g. Clean Water Initiative')
            + _frmField('alloc-ngo-id', 'NGO Partner (if NGO)', 'select',
                '<option value="">Loading NGO partners…</option>', '', 'alloc-ngo-wrap')
            + _frmField('alloc-recipient-name', 'Recipient Full Name', 'text', null, 'Legal name')
            /* CRYPTO_HIDDEN_FOR_PLAY_STORE: 'alloc-wallet' (crypto wallet address) field
               removed from this form — crypto disbursement not launched yet. Restore
               alongside the currency option above when it goes live. */
            + _frmField('alloc-bank-account', 'Bank Account No / Mobile Money', 'text', null, 'Account number')
            + _frmField('alloc-disbursement-date', 'Scheduled Disbursement Date', 'date', null, '')
            + _frmField('alloc-notes', 'Admin Notes', 'text', null, 'Internal notes…')
            + '</div>'
            + '<div style="margin-top:14px;display:flex;gap:10px;">'
            + '<button class="btn btn-accent" id="alloc-create-btn" onclick="window._createGrantAllocation && window._createGrantAllocation()">'
            + '<i class="fas fa-save"></i> Create Allocation</button>'
            + '<button class="btn" onclick="window._allocLoadNgoList && window._allocLoadNgoList(true)">'
            + '<i class="fas fa-sync-alt"></i> Refresh NGO List</button>'
            + '</div>'
            + '<div id="alloc-feedback" style="display:none;margin-top:12px;padding:10px 14px;border-radius:10px;font-size:0.85rem;"></div>'
            + '<div id="alloc-pending" style="display:none;margin-top:12px;padding:10px 14px;border-radius:10px;font-size:0.85rem;'
            + 'background:rgba(245,158,11,0.1);color:#d97706;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;"></div>'
            + '</div></div>';
    }

    function _frmField(id, label, type, options, placeholder, wrapId) {
        var inner = type === 'select'
            ? '<select id="' + id + '" style="width:100%;padding:9px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;background:rgba(232,240,255,0.05);color:inherit;font-size:0.88rem;">' + (options || '') + '</select>'
            : '<input type="' + type + '" id="' + id + '" placeholder="' + (placeholder || '') + '" '
            + 'style="width:100%;padding:9px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;background:rgba(232,240,255,0.05);color:inherit;font-size:0.88rem;">';
        return '<div' + (wrapId ? ' id="' + wrapId + '"' : '') + '>'
            + '<label style="display:block;font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;">' + label + '</label>'
            + inner
            + '</div>';
    }

    function _renderAuditExportPanel() {
        return '<div class="card"><div class="card-content">'
            + '<h3 style="font-family:\'Syne\',sans-serif;margin-bottom:16px;">'
            + '<i class="fas fa-file-export" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Audit Trail Export</h3>'
            + '<p style="color:var(--text-muted);font-size:0.88rem;line-height:1.6;margin-bottom:18px;">'
            + 'Export immutable grant disbursement records for compliance reporting, external audits, and regulatory submissions.</p>'
            + '<div style="display:flex;flex-wrap:wrap;gap:12px;">'
            + '<button class="btn btn-accent" onclick="window._exportGrantReport(\'csv\')" style="gap:8px;">'
            + '<i class="fas fa-file-csv"></i> Export CSV</button>'
            + '<button class="btn" onclick="window._exportGrantReport(\'json\')" style="gap:8px;">'
            + '<i class="fas fa-file-code"></i> Export JSON</button>'
            + '<button class="btn" onclick="window._exportGrantReport(\'pdf\')" style="gap:8px;">'
            + '<i class="fas fa-file-pdf"></i> Generate PDF Report</button>'
            + '</div>'
            + '<div style="margin-top:20px;padding:14px;border-radius:12px;background:rgba(0,212,170,0.05);border:1px solid rgba(0,212,170,0.15);font-size:0.83rem;">'
            + '<i class="fas fa-shield-alt" style="color:var(--nav-accent,#00D4AA);margin-right:6px;"></i>'
            + '<strong>Ledger Integrity</strong> — Every disbursement includes a Flutterwave transaction reference '
            + 'and is recorded in the audit trail below for full traceability.'
            + '</div>'
            + '</div></div>';
    }


    /* =========================================================================
       §10  renderGrantAnalytics  (NEW — chart-free, SVG mini-chart)
       ========================================================================= */

    function renderGrantAnalytics() {
        var container = document.getElementById('grant-analytics-container');
        if (!container) return;

        container.innerHTML =
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">'
            /* Fund allocation breakdown */
            + '<div class="card"><div class="card-content">'
            + '<h4 style="margin-bottom:14px;font-family:\'Syne\',sans-serif;">'
            + '<i class="fas fa-chart-pie" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Fund Allocation</h4>'
            + _renderAllocationBars()
            + '</div></div>'
            /* Disbursement by currency */
            + '<div class="card"><div class="card-content">'
            + '<h4 style="margin-bottom:14px;font-family:\'Syne\',sans-serif;">'
            + '<i class="fas fa-coins" style="color:#F59E0B;margin-right:8px;"></i>By Payment Channel</h4>'
            + _renderChannelStats()
            + '</div></div>'
            + '</div>';
    }
    window.renderGrantAnalytics = renderGrantAnalytics;

    function _renderAllocationBars() {
        var allocations = [
            { label: 'Health & Medical', pct: 35, color: '#22c55e' },
            { label: 'Education',        pct: 25, color: '#3B82F6' },
            { label: 'Food Security',    pct: 20, color: '#F59E0B' },
            { label: 'Shelter',          pct: 12, color: '#8B5CF6' },
            { label: 'Environment',      pct: 8,  color: '#00D4AA' }
        ];
        return allocations.map(function(a) {
            return '<div style="margin-bottom:10px;">'
                + '<div style="display:flex;justify-content:space-between;font-size:0.80rem;margin-bottom:4px;">'
                + '<span>' + a.label + '</span><span style="font-weight:700;">' + a.pct + '%</span></div>'
                + '<div style="height:8px;border-radius:50px;background:rgba(232,240,255,0.08);overflow:hidden;">'
                + '<div style="height:100%;border-radius:50px;background:' + a.color + ';width:' + a.pct + '%;transition:width 0.8s ease;"></div>'
                + '</div></div>';
        }).join('');
    }

    function _renderChannelStats() {
        // CRYPTO_HIDDEN_FOR_PLAY_STORE: this used to also show a "USDT
        // Stablecoin" channel (real external crypto) — removed. "EMPY
        // Token" stays: it's this platform's own in-house currency (funded
        // by card/bank, same as a TikTok-style coin balance), not a
        // blockchain/crypto feature, so it isn't part of this hide.
        var channels = [
            { label: 'Fiat (NGN via Flutterwave)', icon: 'fa-money-bill-wave', color: '#22c55e', value: '78%' },
            { label: 'EMPY Wallet Balance',         icon: 'fa-coins',           color: '#00D4AA', value: '20%' },
            { label: 'Mobile Money',                icon: 'fa-mobile-alt',      color: '#F59E0B', value: '2%'  }
        ];
        return channels.map(function(c) {
            return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(0,212,170,0.08);">'
                + '<div style="width:36px;height:36px;border-radius:10px;background:' + c.color + '22;flex-shrink:0;'
                + 'display:flex;align-items:center;justify-content:center;">'
                + '<i class="fas ' + c.icon + '" style="color:' + c.color + ';font-size:0.85rem;"></i></div>'
                + '<div style="flex:1;"><div style="font-size:0.83rem;font-weight:600;">' + c.label + '</div>'
                + '<div style="font-size:0.75rem;color:var(--text-muted);">of total disbursements</div></div>'
                + '<div style="font-size:1.1rem;font-weight:800;color:' + c.color + ';">' + c.value + '</div>'
                + '</div>';
        }).join('');
    }


    /* =========================================================================
       §11  renderImpactReports  (NEW)
       NGO impact report submission and display.
       ========================================================================= */

    function renderImpactReports(ngoId) {
        var container = document.getElementById('impact-reports-container');
        if (!container) return;

        var submitSection = _isAdmin() || (ngoId && _us().ngoId === ngoId)
            ? '<div class="card" style="margin-bottom:16px;"><div class="card-content">'
            + '<h4 style="margin-bottom:12px;font-family:\'Syne\',sans-serif;">'
            + '<i class="fas fa-plus-circle" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Submit Impact Report</h4>'
            + '<textarea id="impact-report-text" rows="4" placeholder="Describe the project outcomes, beneficiaries reached, funds utilised…" '
            + 'style="width:100%;padding:10px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;'
            + 'background:rgba(232,240,255,0.04);color:inherit;font-size:0.88rem;resize:vertical;"></textarea>'
            + '<div style="display:flex;gap:10px;margin-top:10px;">'
            + '<button class="btn btn-accent" onclick="window._submitImpactReport && window._submitImpactReport(\'' + (ngoId || '') + '\')">'
            + '<i class="fas fa-paper-plane"></i> Submit Report</button>'
            + '</div></div></div>'
            : '';

        container.innerHTML = submitSection
            + '<div id="impact-reports-list">'
            + '<div style="text-align:center;padding:24px;color:var(--text-muted);">'
            + '<i class="fas fa-circle-notch fa-spin"></i> Loading reports…</div>'
            + '</div>';

        if (_fbOk() && _db()) {
            var q = ngoId
                ? _db().collection('impact_reports').where('ngoId', '==', ngoId).orderBy('createdAt', 'desc').limit(20)
                : _db().collection('impact_reports').orderBy('createdAt', 'desc').limit(20);
            q.get().then(function(snap) {
                var list = document.getElementById('impact-reports-list');
                if (!list) return;
                if (snap.empty) {
                    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">No impact reports published yet.</div>';
                    return;
                }
                var html = '';
                snap.forEach(function(doc) {
                    var d  = doc.data();
                    var dt = d.createdAt && d.createdAt.toDate
                        ? d.createdAt.toDate().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})
                        : '—';
                    html += '<div class="card" style="margin-bottom:12px;"><div style="padding:14px 16px;">'
                        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">'
                        + '<strong>' + _esc(d.ngoName || 'NGO Partner') + '</strong>'
                        + '<span style="font-size:0.75rem;color:var(--text-muted);">' + dt + '</span>'
                        + '</div>'
                        + '<p style="font-size:0.85rem;line-height:1.6;color:var(--text-muted);margin:0;">' + _esc(d.content || '') + '</p>'
                        + (d.peopleReached ? '<div style="margin-top:8px;font-size:0.78rem;color:var(--nav-accent,#00D4AA);font-weight:700;">'
                        + '<i class="fas fa-users"></i> ' + d.peopleReached.toLocaleString() + ' people reached</div>' : '')
                        + '</div></div>';
                });
                list.innerHTML = html;
            }).catch(function() {
                var list = document.getElementById('impact-reports-list');
                if (list) list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Could not load reports.</div>';
            });
        }
    }
    window.renderImpactReports = renderImpactReports;

    /* Submit impact report */
    window._submitImpactReport = function(ngoId) {
        var ta = document.getElementById('impact-report-text');
        var content = ta ? ta.value.trim() : '';
        if (!content) { _notify('Please write the impact report content.', 'error'); return; }
        if (_isGuest()) { _notify('Please log in to submit reports.', 'error'); return; }

        var us = _us();
        var ngo = _partners()[ngoId] || {};
        var record = {
            ngoId:         ngoId || us.ngoId || '',
            ngoName:       ngo.name || us.ngoName || us.fullName || 'NGO',
            content:       content,
            authorId:      us.id || 'unknown',
            authorName:    us.fullName || 'Unknown',
            createdAt:     _serverTs()
        };

        if (_fbOk() && _db()) {
            _db().collection('impact_reports').add(record)
                .then(function() {
                    _notify('✅ Impact report submitted successfully!', 'success');
                    if (ta) ta.value = '';
                    renderImpactReports(ngoId);
                })
                .catch(function(e) { _notify('Failed to submit report: ' + e.message, 'error'); });
        } else {
            _notify('Impact report saved locally (Firebase offline).', 'info');
            if (ta) ta.value = '';
        }
    };


    /* =========================================================================
       §12  NGO APPLICATION MODAL  (NEW)
       Self-registration flow for NGOs wanting to become verified partners.
       Renders a modal for NGO application submission with document upload.
       ========================================================================= */

    window.openNgoApplicationModal = function() {
        if (_isGuest()) {
            _notify('Please log in to apply as an NGO partner.', 'info');
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }

        /* Remove any stale modal */
        var existing = document.getElementById('ngo-application-modal');
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = 'ngo-application-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,30,0.85);backdrop-filter:blur(4px);'
            + 'z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;';

        modal.innerHTML =
            '<div style="background:var(--card-bg,#111827);border-radius:20px;width:100%;max-width:600px;'
            + 'border:1px solid rgba(0,212,170,0.2);overflow:hidden;animation:empNavFadeIn 0.2s ease;">'
            + '<div style="height:4px;background:linear-gradient(90deg,var(--nav-accent,#00D4AA),#7EEEDD);"></div>'
            + '<div style="padding:24px;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">'
            + '<h3 style="font-family:\'Syne\',sans-serif;font-weight:800;margin:0;">'
            + '<i class="fas fa-building" style="color:var(--nav-accent,#00D4AA);margin-right:10px;"></i>NGO Partner Application</h3>'
            + '<button id="ngo-app-close-x" '
            + 'style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.2rem;padding:4px;">'
            + '<i class="fas fa-times"></i></button>'
            + '</div>'
            + '<p style="color:var(--text-muted);font-size:0.85rem;line-height:1.6;margin-bottom:20px;">'
            + 'Complete this form to apply for NGO partner verification. Your application will be reviewed within 3-5 business days. '
            + 'Approved partners gain access to grant funding and appear in the Partner NGO Directory.</p>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
            + _modalField('ngo-app-orgname',   'Organisation Name *', 'text', 'Legal registered name')
            + _modalField('ngo-app-regnumber', 'Registration Number *', 'text', 'NGO/CAC reg number')
            + _modalField('ngo-app-country',   'Country *', 'text', 'Country of registration')
            + _modalField('ngo-app-sector',    'Primary Sector *', 'select',
                '<option value="">Select sector…</option>'
                + '<option value="health">Health</option><option value="education">Education</option>'
                + '<option value="food">Food Security</option><option value="environment">Environment</option>'
                + '<option value="shelter">Shelter</option><option value="gender">Gender Equality</option>'
                + '<option value="youth">Youth Development</option><option value="other">Other</option>')
            + _modalField('ngo-app-email', 'Official Email *', 'email', 'contact@yourNGO.org')
            + _modalField('ngo-app-phone', 'Phone Number', 'tel', '+234…')
            + _modalField('ngo-app-website', 'Website', 'url', 'https://yourNGO.org')
            /* CRYPTO_HIDDEN_FOR_PLAY_STORE: 'ngo-app-wallet' (crypto wallet address)
               field removed — crypto grants not launched yet. Bank account details
               below cover fiat disbursement. Restore this field when crypto goes live. */
            + '</div>'
            /* Bank account details section */
            + '<div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:rgba(0,212,170,0.04);border:1px solid rgba(0,212,170,0.15);">'
            + '<div style="font-size:0.78rem;font-weight:700;color:var(--nav-accent,#00D4AA);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">'
            + '<i class="fas fa-university" style="margin-right:6px;"></i>Bank Account for Disbursement</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
            + _modalField('ngo-app-bank-account-number', 'Account Number', 'text', 'e.g. 0123456789')
            + _modalField('ngo-app-bank-account-name',   'Account Name',   'text', 'Name on bank account')
            + _modalField('ngo-app-bank-name',           'Bank Name',      'text', 'e.g. Access Bank')
            + '</div>'
            + '</div>'
            + '<div style="margin-top:12px;">'
            + '<label style="display:block;font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;">Mission Statement *</label>'
            + '<textarea id="ngo-app-mission" rows="3" placeholder="Describe your NGO\'s mission and the communities you serve…" '
            + 'style="width:100%;padding:10px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;'
            + 'background:rgba(232,240,255,0.04);color:inherit;font-size:0.88rem;resize:vertical;"></textarea>'
            + '</div>'
            + '<div style="margin-top:12px;">'
            + '<label style="display:block;font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;">'
            + 'KYC Documents (PDF/Image) *</label>'
            + '<div style="border:2px dashed rgba(0,212,170,0.3);border-radius:12px;padding:20px;text-align:center;cursor:pointer;" '
            + 'onclick="document.getElementById(\'ngo-app-docs\').click()">'
            + '<i class="fas fa-cloud-upload-alt" style="font-size:1.5rem;color:var(--nav-accent,#00D4AA);margin-bottom:8px;display:block;"></i>'
            + '<div style="font-size:0.85rem;font-weight:600;">Click to upload documents</div>'
            + '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">CAC certificate, board resolution, tax clearance, ID of directors (max 10MB each)</div>'
            + '<div id="ngo-app-doc-list" style="margin-top:8px;font-size:0.78rem;color:var(--nav-accent,#00D4AA);"></div>'
            + '</div>'
            + '<input type="file" id="ngo-app-docs" multiple accept=".pdf,.jpg,.jpeg,.png" style="display:none;" '
            + 'onchange="window._previewNgoDocs && window._previewNgoDocs(this)">'
            + '</div>'
            + '<div id="ngo-app-feedback" style="display:none;margin-top:12px;padding:10px 14px;border-radius:10px;font-size:0.85rem;"></div>'
            + '<div style="display:flex;gap:10px;margin-top:20px;">'
            + '<button class="btn btn-accent" id="ngo-app-submit-btn" '
            + 'onclick="window._submitNgoApplication && window._submitNgoApplication()" style="flex:1;">'
            + '<i class="fas fa-paper-plane"></i> Submit Application</button>'
            + '<button class="btn" id="ngo-app-cancel-btn">'
            + 'Cancel</button>'
            + '</div>'
            + '</div></div>';

        document.body.appendChild(modal);
        document.body.classList.add('modal-open');

        /* ── Wire close buttons via addEventListener (not inline onclick) ──
           Inline onclick is swallowed by capture-phase stopImmediatePropagation
           in the delete-post listener. addEventListener on the element itself
           fires before the delegated capture handler can block it.           */
        function _closeNgoModal() {
            modal.remove();
            document.body.classList.remove('modal-open');
        }
        var _xBtn = modal.querySelector('#ngo-app-close-x');
        if (_xBtn) {
            _xBtn.addEventListener('click', function(e) { e.stopPropagation(); _closeNgoModal(); });
        }
        var _cancelBtn = modal.querySelector('#ngo-app-cancel-btn');
        if (_cancelBtn) {
            _cancelBtn.addEventListener('click', function(e) { e.stopPropagation(); _closeNgoModal(); });
        }

        /* Close on backdrop click */
        modal.addEventListener('click', function(e) {
            if (e.target === modal) { _closeNgoModal(); }
        });
    };

    function _modalField(id, label, type, placeholder_or_options) {
        var isSelect = type === 'select';
        var inner = isSelect
            ? '<select id="' + id + '" style="width:100%;padding:9px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;background:rgba(232,240,255,0.04);color:inherit;font-size:0.88rem;">' + placeholder_or_options + '</select>'
            : '<input type="' + type + '" id="' + id + '" placeholder="' + (placeholder_or_options || '') + '" '
            + 'style="width:100%;padding:9px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;background:rgba(232,240,255,0.04);color:inherit;font-size:0.88rem;">';
        return '<div style="grid-column:' + (type === 'select' || id.includes('orgname') ? 'span 1' : 'span 1') + ';">'
            + '<label style="display:block;font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;">' + label + '</label>'
            + inner + '</div>';
    }

    /* Preview selected doc filenames */
    window._previewNgoDocs = function(input) {
        var list = document.getElementById('ngo-app-doc-list');
        if (!list || !input.files) return;
        list.textContent = Array.from(input.files).map(function(f) { return '📎 ' + f.name; }).join(' · ');
    };

    /* Submit NGO application to Firestore */
    window._submitNgoApplication = async function() {
        var btn = document.getElementById('ngo-app-submit-btn');
        var fb  = document.getElementById('ngo-app-feedback');

        function _setFb(msg, type) {
            if (!fb) return;
            fb.style.display    = 'block';
            fb.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : type === 'success' ? 'rgba(0,212,170,0.1)' : 'rgba(245,158,11,0.1)';
            fb.style.color      = type === 'error' ? 'var(--danger-color,#ef4444)' : type === 'success' ? 'var(--nav-accent,#00D4AA)' : '#d97706';
            fb.innerHTML        = msg;
        }

        var orgName  = (document.getElementById('ngo-app-orgname')   || {}).value || '';
        var regNum   = (document.getElementById('ngo-app-regnumber') || {}).value || '';
        var country  = (document.getElementById('ngo-app-country')   || {}).value || '';
        var sector   = (document.getElementById('ngo-app-sector')    || {}).value || '';
        var email    = (document.getElementById('ngo-app-email')     || {}).value || '';
        var phone    = (document.getElementById('ngo-app-phone')     || {}).value || '';
        var website  = (document.getElementById('ngo-app-website')   || {}).value || '';
        var wallet   = (document.getElementById('ngo-app-wallet')    || {}).value || '';
        var mission  = (document.getElementById('ngo-app-mission')   || {}).value || '';
        var docsInput= document.getElementById('ngo-app-docs');
        var bankAccountNumber = (document.getElementById('ngo-app-bank-account-number') || {}).value || '';
        var bankAccountName   = (document.getElementById('ngo-app-bank-account-name')   || {}).value || '';
        var bankName          = (document.getElementById('ngo-app-bank-name')           || {}).value || '';

        if (!orgName.trim() || !regNum.trim() || !country.trim() || !sector || !email.trim() || !mission.trim()) {
            _setFb('⚠ Please fill in all required fields (marked with *).', 'error'); return;
        }
        if (!docsInput || !docsInput.files || !docsInput.files.length) {
            _setFb('⚠ Please upload at least one KYC document.', 'error'); return;
        }

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting…'; }
        _setFb('<i class="fas fa-circle-notch fa-spin"></i> Uploading documents…', 'info');

        /* Upload documents to Cloudinary */
        var docUrls = [];
        try {
            docUrls = await Promise.all(Array.from(docsInput.files).map(_uploadDoc));
            docUrls = docUrls.filter(Boolean);
        } catch(uploadErr) {
            console.warn('[NGO App] Upload error:', uploadErr);
        }

        var application = {
            orgName:      orgName.trim(),
            regNumber:    regNum.trim(),
            country:      country.trim(),
            sector:       sector,
            email:        email.trim(),
            phone:        phone.trim(),
            website:      website.trim(),
            walletAddress: wallet.trim(),
            bankAccountNumber: bankAccountNumber.trim(),
            bankAccountName:   bankAccountName.trim(),
            bankName:          bankName.trim(),
            mission:      mission.trim(),
            documents:    docUrls,
            status:       'pending',
            applicantId:  _us().id || 'guest',
            applicantEmail: _us().email || email.trim(),
            submittedAt:  _serverTs()
        };

        if (_fbOk() && _db()) {
            _db().collection('ngo_applications').add(application)
                .then(function(ref) {
                    _setFb('✅ Application submitted successfully! Reference: <strong>' + ref.id + '</strong><br>'
                        + 'Your application will be reviewed within 3-5 business days.', 'success');
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Submitted'; }
                    _notify('NGO application submitted! ID: ' + ref.id, 'success');
                    setTimeout(function() {
                        var modal = document.getElementById('ngo-application-modal');
                        if (modal) { modal.remove(); document.body.classList.remove('modal-open'); }
                    }, 4000);
                })
                .catch(function(e) {
                    _setFb('❌ Submission failed: ' + e.message, 'error');
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Application'; }
                });
        } else {
            /* Offline fallback */
            _setFb('✅ Application saved locally. Will sync when online.', 'success');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Saved Locally'; }
            _notify('NGO application saved (offline mode).', 'info');
        }
    };


    /* =========================================================================
       §13b  INDIVIDUAL ACCOUNT INFORMATION MODULE  (NEW)
       Admin-controlled form for collecting individual bank/personal details
       linked to disbursement. The form is hidden by default and only appears
       on the general dashboard when enabled by an admin.
       ========================================================================= */

    /* ── State key used across session ── */
    var _IND_ACCT_KEY    = 'empyrean_ind_acct_form_enabled';
    var _indSnapUnsub    = null;   /* onSnapshot unsubscribe handle */
    var _bannerGuardObs  = null;   /* MutationObserver that re-asserts display */
    var _indCdTimer      = null;   /* 1s countdown interval for the banner's LIVE badge */

    /* ── Single source of truth ──────────────────────────────────────────
       Priority: localStorage (persists across refreshes/tabs) → false.
       EmpState is no longer checked first because it resets on every page
       load and can be stale; localStorage is always authoritative locally
       while Firestore is the cross-device authority.                      */
    window._indAcctFormEnabled = function() {
        try { return localStorage.getItem(_IND_ACCT_KEY) === '1'; } catch(e) {}
        return false;
    };

    /* ── Write state to BOTH Firestore documents ─────────────────────────
       app-fix-final.js reads  app_config/individual_form  { active }
       app-ngo.js reads        app_settings/individual_account_form { enabled }
       They are DIFFERENT documents. Both must be kept in sync or they
       fight each other and flip the banner on/off.                        */
    function _writeIndAcctState(enable, db) {
        var payload  = { updatedAt: _serverTs(), updatedBy: _us().id || 'admin' };
        var p1 = db.collection('app_settings').doc('individual_account_form')
                   .set(Object.assign({}, payload, { enabled: enable }), { merge: true });
        var p2 = db.collection('app_config').doc('individual_form')
                   .set(Object.assign({}, payload, { active: enable }),  { merge: true });
        return Promise.all([p1, p2]).catch(function(e) {
            console.warn('[IndAcct] Firestore write failed:', e.message);
        });
    }

    /* ── Admin toggle ────────────────────────────────────────────────────*/
    window._toggleIndAcctForm = async function(enable) {
        if (!_isAdmin()) { _notify('Admin access required.', 'error'); return; }
        enable = !!enable;

        /* Update localStorage immediately so the UI responds at once */
        try { localStorage.setItem(_IND_ACCT_KEY, enable ? '1' : '0'); } catch(e) {}
        if (window.EmpState) window.EmpState.indAcctFormEnabled = enable;
        _renderIndAcctBanner();

        /* Write to both Firestore docs */
        if (_fbOk() && _db()) await _writeIndAcctState(enable, _db());

        _notify(
            enable ? '✅ Individual Account form is now ACTIVE on the dashboard.'
                   : '⏸ Individual Account form has been deactivated.',
            enable ? 'success' : 'info'
        );

        /* Refresh admin toggle button */
        var tog = document.getElementById('ind-acct-admin-toggle-btn');
        if (tog) {
            tog.innerHTML = enable ? '<i class="fas fa-toggle-on"></i> Deactivate Form'
                                   : '<i class="fas fa-toggle-off"></i> Activate Form';
            tog.style.background = enable ? 'rgba(239,68,68,0.12)' : 'var(--nav-accent,#00D4AA)';
            tog.style.color      = enable ? '#ef4444' : '#0A0F1E';
            tog.onclick = function() { window._toggleIndAcctForm(!enable); };
        }
    };

    /* ── Real-time listener (cross-device) ───────────────────────────────
       Listens to app_settings/individual_account_form.
       When any admin toggles on any device, every open session updates
       within seconds.  Also ensures app_config/individual_form stays in
       sync so app-fix-final.js's _checkIndFormState never overrides us.  */
    function _startIndAcctListener() {
        if (!_fbOk() || !_db()) return;
        if (typeof _indSnapUnsub === 'function') { try { _indSnapUnsub(); } catch(e) {} }
        try {
            _indSnapUnsub = _db().collection('app_settings').doc('individual_account_form')
                .onSnapshot(function(doc) {
                    var enabled = doc.exists ? !!doc.data().enabled : false;
                    /* Sync localStorage — the local read authority */
                    try { localStorage.setItem(_IND_ACCT_KEY, enabled ? '1' : '0'); } catch(e) {}
                    if (window.EmpState) window.EmpState.indAcctFormEnabled = enabled;
                    /* Admin-set category / reason / closing time ride on the same doc */
                    window._indAcctMeta = doc.exists ? { category: doc.data().category || '', reason: doc.data().reason || '', deadline: Number(doc.data().deadline) || 0 } : {};
                    /* Keep app_config/individual_form in sync so app-fix-final.js agrees */
                    if (enabled && _fbOk() && _db()) {
                        _db().collection('app_config').doc('individual_form')
                             .set({ active: true }, { merge: true }).catch(function(){});
                    }
                    _renderIndAcctBanner();
                }, function(err) {
                    console.warn('[IndAcct] onSnapshot error:', err.message);
                });
        } catch(e) { console.warn('[IndAcct] Could not start listener:', e.message); }
    }

    /* Called on boot — starts the real-time listener */
    function _loadIndAcctFormState() {
        _startIndAcctListener();
    }

    /* ── MutationObserver guard ──────────────────────────────────────────
       app-fix-final.js can set banner.style.display='none' if its own
       _checkIndFormState fires and finds app_config/individual_form stale.
       This observer watches for that and immediately corrects it back.    */
    function _attachBannerGuard(banner) {
        if (_bannerGuardObs) { try { _bannerGuardObs.disconnect(); } catch(e) {} }
        _bannerGuardObs = new MutationObserver(function() {
            if (window._indAcctFormEnabled() && banner.style.display === 'none') {
                banner.style.display = '';
            }
        });
        _bannerGuardObs.observe(banner, { attributes: true, attributeFilter: ['style'] });
    }

    /* ── Individual form: LIVE countdown card, admin category/deadline, invite-link success view ── */
    window._indAcctMeta = window._indAcctMeta || {};
    var _IND_ACCT_CATS = ['Grant', 'Empowerment', 'Government Palliative', 'Scholarship', 'Business Support',
                          'Healthcare', 'Agricultural Support', 'Emergency Relief', 'Stipend'];

    function _indAcctInjectStyle() {
        if (document.getElementById('ind-acct-style')) return;
        try {
            var lk = document.createElement('link');
            lk.rel = 'stylesheet';
            lk.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap';
            document.head.appendChild(lk);
        } catch (e) {}
        var st = document.createElement('style');
        st.id = 'ind-acct-style';
        st.textContent = '@keyframes indAcctPulse{0%{box-shadow:0 0 0 0 rgba(220,38,38,.55)}70%{box-shadow:0 0 0 7px rgba(220,38,38,0)}100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}}'
            + '.ind-acct-live{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:#fff;border:1px solid #E9DDBE;font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.1em;color:#0B1E3F;white-space:nowrap}'
            + '.ind-acct-live .ind-acct-dot{width:8px;height:8px;border-radius:50%;background:#DC2626;animation:indAcctPulse 1.6s infinite}'
            + '.ind-acct-live.ind-acct-closed .ind-acct-dot{background:#94A3B8;animation:none}'
            + '.ind-acct-live .ind-acct-cd-t{font-variant-numeric:tabular-nums;color:#8A6A22}';
        document.head.appendChild(st);
    }

    function _indAcctTick() {
        var el = document.getElementById('ind-acct-cd-text');
        if (!el) { clearInterval(_indCdTimer); _indCdTimer = null; return; }
        var dl = Number((window._indAcctMeta || {}).deadline) || 0;
        if (!dl) { el.textContent = '· Open now'; return; }
        var ms = dl - Date.now();
        if (ms <= 0) {
            el.textContent = '· Closed';
            var badge = document.getElementById('ind-acct-cd'); if (badge) badge.classList.add('ind-acct-closed');
            var cta = document.getElementById('ind-acct-cta');
            if (cta) { cta.disabled = true; cta.style.opacity = '0.55'; cta.style.cursor = 'not-allowed'; }
            clearInterval(_indCdTimer); _indCdTimer = null;
            return;
        }
        var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
            mi = Math.floor((s % 3600) / 60), se = s % 60;
        function p(n) { return n < 10 ? '0' + n : '' + n; }
        el.textContent = '· Closes in ' + (d > 0 ? d + 'd ' : '') + p(h) + ':' + p(mi) + ':' + p(se);
    }
    function _startIndAcctCountdown() {
        if (_indCdTimer) { clearInterval(_indCdTimer); _indCdTimer = null; }
        _indAcctTick();
        if (document.getElementById('ind-acct-cd-text')) _indCdTimer = setInterval(_indAcctTick, 1000);
    }

    function _indAcctRenderBanner(banner) {
        _indAcctInjectStyle();
        var m = window._indAcctMeta || {};
        var NAVY = '#0B1E3F';
        var eyebrow = _esc(String(m.category || 'Disbursement').toUpperCase());
        function step(n, label, on) {
            return '<span style="display:flex;align-items:center;gap:6px;' + (on ? '' : 'color:#5B6577;') + '">'
                + '<span style="width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;'
                + (on ? 'background:' + NAVY + ';color:#E8CF8E;border:1px solid ' + NAVY + ';' : 'border:1px solid #C9BFA6;') + '">' + n + '</span>' + label + '</span>';
        }
        var rule = '<span style="flex:1;height:1px;background:#D9C28A;margin:0 8px;"></span>';
        var atm = '<div style="width:124px;height:78px;flex:none;border-radius:12px;background:linear-gradient(135deg,#07152B 0%,#0B1E3F 55%,#173A6E 100%);border:1px solid #C9A24D;padding:9px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;color:#fff;position:relative;overflow:hidden;box-shadow:0 8px 18px rgba(11,30,63,.3);">'
            + '<div style="position:absolute;right:-20px;top:-22px;width:74px;height:74px;border-radius:50%;background:rgba(201,162,77,.16);"></div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center;position:relative;"><span style="font-size:8px;letter-spacing:.24em;font-weight:700;color:#E8CF8E;">EMPYREAN</span><span style="width:21px;height:15px;border-radius:3px;background:linear-gradient(135deg,#FBEFC6,#D9AE4A);"></span></div>'
            + '<div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.14em;font-weight:700;position:relative;">&bull;&bull;&bull;&bull; 2027</div>'
            + '<div style="display:flex;justify-content:space-between;font-size:6.5px;letter-spacing:.08em;font-weight:600;position:relative;"><span>YOUR OWN NAME ONLY</span><span>PAYOUT</span></div></div>';
        var seal = '<div style="width:42px;height:42px;flex:none;border-radius:50%;border:1.5px solid #C9A24D;background:linear-gradient(135deg,#0B1E3F,#173A6E);display:flex;align-items:center;justify-content:center;">'
            + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E8CF8E" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-6 9 6M4.5 21V10.5M19.5 21V10.5M8.25 21v-8.25M12 21v-8.25M15.75 21v-8.25M3 21h18"/></svg></div>';
        banner.innerHTML =
            '<div style="background:linear-gradient(165deg,#FFFFFF 0%,#FBF6E8 100%);border:1px solid #D9C28A;border-radius:22px;box-shadow:0 0 0 4px #fff,0 0 0 5px #E9DDBE,0 14px 34px rgba(11,30,63,.09);position:relative;overflow:hidden;margin:0 5px 22px;font-family:Inter,system-ui,sans-serif;color:#0B1E3F;">'
            + '<div style="height:3px;background:linear-gradient(90deg,#C9A24D,#F1E4BC,#C9A24D);"></div>'
            + '<div style="padding:18px 18px 16px;">'
            + '<div style="display:flex;align-items:center;gap:12px;">' + seal
            + '<div style="min-width:0;flex:1;"><div style="font-size:9.5px;letter-spacing:.16em;font-weight:700;color:#8A6A22;">' + eyebrow + '</div>'
            + '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:25px;font-weight:700;line-height:1.05;margin-top:2px;">Account Details Required</div></div></div>'
            + '<div style="margin-top:12px;"><span class="ind-acct-live" id="ind-acct-cd"><span class="ind-acct-dot"></span>LIVE<span class="ind-acct-cd-t" id="ind-acct-cd-text"></span></span></div>'
            + '<div style="height:1px;background:linear-gradient(90deg,transparent,#D9C28A,transparent);margin:14px 0;"></div>'
            + '<div style="display:flex;gap:14px;align-items:center;">' + atm
            + '<div style="font-size:12.5px;line-height:1.5;color:#3F4A5E;">Submit the bank account where your approved payout should be sent. It must be in your own legal name.'
            + (m.reason ? '<div style="margin-top:4px;font-style:italic;color:#5B6577;">' + _esc(m.reason) + '</div>' : '') + '</div></div>'
            + '<div style="display:flex;align-items:center;margin:16px 0 14px;font-size:10px;font-weight:700;letter-spacing:.1em;">'
            + step('I', 'SUBMIT', true) + rule + step('II', 'VERIFY', false) + rule + step('III', 'RECEIVE', false) + '</div>'
            + '<button type="button" id="ind-acct-cta" onclick="window.openIndividualAccountForm &amp;&amp; window.openIndividualAccountForm()" '
            + 'style="width:100%;height:46px;border-radius:12px;border:1px solid #C9A24D;background:linear-gradient(135deg,#0B1E3F,#173A6E);color:#fff;font-size:11px;font-weight:700;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 16px rgba(11,30,63,.14);">'
            + 'ADD ACCOUNT DETAILS <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E8CF8E" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>'
            + '<div style="font-size:11px;line-height:1.5;color:#5B6577;text-align:center;margin-top:12px;">Your details are used only for this disbursement.</div>'
            + '</div></div>';
        _startIndAcctCountdown();
    }

    function _indAcctLocalInput(ms) {
        var d = new Date(ms); if (isNaN(d.getTime())) return '';
        function p(n) { return n < 10 ? '0' + n : '' + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    var _IND_ACCT_BANKS = ['Access Bank', 'Citibank Nigeria', 'Ecobank Nigeria', 'Fidelity Bank', 'First Bank of Nigeria',
        'First City Monument Bank (FCMB)', 'Globus Bank', 'Guaranty Trust Bank (GTBank)', 'Heritage Bank', 'Jaiz Bank',
        'Keystone Bank', 'Kuda Microfinance Bank', 'Moniepoint MFB', 'OPay', 'PalmPay', 'Polaris Bank', 'Providus Bank',
        'Stanbic IBTC Bank', 'Standard Chartered Bank', 'Sterling Bank', 'SunTrust Bank', 'Titan Trust Bank',
        'Union Bank of Nigeria', 'United Bank for Africa (UBA)', 'Unity Bank', 'Wema Bank', 'Zenith Bank'];

    /* Admin "Category & Reason" card — chip selector (cream / gold / navy, matches the dashboard card) */
    function _indAcctChipStyle(on) {
        return 'height:46px;padding:0 8px;border-radius:14px;font:' + (on ? '600' : '400') + ' 14.5px/1.15 Inter,system-ui,sans-serif;color:#0B1E3F;text-align:center;cursor:pointer;'
            + (on ? 'background:#FBF1D6;border:1.5px solid #C9A24D;' : 'background:#fff;border:1px solid #E2DAC6;');
    }
    var _indAcctFieldCss = 'width:100%;box-sizing:border-box;border-radius:14px;border:1.5px solid #E2DAC6;background:#fff;color:#0B1E3F;font:400 15px/1.4 Inter,system-ui,sans-serif;padding:0 14px;outline:none;';
    function _indAcctAdminMetaHtml() {
        _indAcctInjectStyle();
        var m = window._indAcctMeta || {};
        var cur = String(m.category || '');
        var known = _IND_ACCT_CATS.indexOf(cur) !== -1;
        var sel = known ? cur : (cur ? '__other' : '');
        var lbl = 'font:700 11px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;color:#3F4A5E;margin:16px 0 8px;';
        var chips = _IND_ACCT_CATS.concat(['__other']).map(function(c) {
            return '<button type="button" class="ind-acct-chip" data-cat="' + _esc(c) + '" onclick="window._indAcctPickCat(this)" style="' + _indAcctChipStyle(c === sel) + '">'
                + (c === '__other' ? 'Other (type your own)' : _esc(c)) + '</button>';
        }).join('');
        return '<div style="margin-top:14px;background:linear-gradient(165deg,#FFFFFF 0%,#FBF6E8 100%);border:1px solid #D9C28A;border-radius:22px;box-shadow:0 0 0 4px #fff,0 0 0 5px #E9DDBE;overflow:hidden;color:#0B1E3F;font-family:Inter,system-ui,sans-serif;">'
            + '<div style="height:3px;background:linear-gradient(90deg,#C9A24D,#F1E4BC,#C9A24D);"></div>'
            + '<div style="padding:18px;">'
            + '<div style="font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.18em;color:#8A6A22;">NEW DISBURSEMENT</div>'
            + '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:30px;font-weight:700;line-height:1.1;margin-top:4px;">Category &amp; Reason</div>'
            + '<div style="' + lbl + '">CATEGORY</div>'
            + '<div id="ind-acct-cat-chips" data-sel="' + _esc(sel) + '" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' + chips + '</div>'
            + '<div id="ind-acct-cat-other-wrap" style="display:' + (sel === '__other' ? 'block' : 'none') + ';">'
            + '<div style="' + lbl + '">YOUR OWN CATEGORY</div>'
            + '<input id="ind-acct-cat-other" type="text" placeholder="e.g. Widows\' Support Fund" value="' + (cur && !known ? _esc(cur) : '') + '" style="' + _indAcctFieldCss + 'height:50px;border-color:#C9A24D;"></div>'
            + '<div style="' + lbl + '">REASON</div>'
            + '<textarea id="ind-acct-reason" rows="3" placeholder="Reason shown on the card (optional)" style="' + _indAcctFieldCss + 'padding:12px 14px;resize:none;">' + _esc(m.reason || '') + '</textarea>'
            + '<div style="' + lbl + '">CLOSES AT <span style="font-weight:500;letter-spacing:.04em;color:#5B6577;">(leave empty for no countdown)</span></div>'
            + '<input id="ind-acct-deadline" type="datetime-local" value="' + (m.deadline ? _indAcctLocalInput(m.deadline) : '') + '" style="' + _indAcctFieldCss + 'height:48px;">'
            + '<button type="button" id="ind-acct-meta-save" onclick="window._saveIndAcctMeta()" style="width:100%;height:54px;margin-top:20px;border-radius:14px;border:1.5px solid #C9A24D;background:#fff;color:#0B1E3F;font:700 12px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;cursor:pointer;box-shadow:0 6px 16px rgba(201,162,77,.18);">SAVE &amp; REQUEST ACCOUNT DETAILS</button>'
            + '</div></div>';
    }
    window._indAcctPickCat = function(btn) {
        var box = document.getElementById('ind-acct-cat-chips'); if (!box || !btn) return;
        var v = btn.getAttribute('data-cat');
        box.setAttribute('data-sel', v);
        Array.prototype.forEach.call(box.querySelectorAll('.ind-acct-chip'), function(b) { b.setAttribute('style', _indAcctChipStyle(b === btn)); });
        var w = document.getElementById('ind-acct-cat-other-wrap'); if (w) w.style.display = v === '__other' ? 'block' : 'none';
        if (v === '__other') { var o = document.getElementById('ind-acct-cat-other'); if (o) o.focus(); }
    };
    window._saveIndAcctMeta = async function() {
        if (!_isAdmin()) { _notify('Admin access required.', 'error'); return; }
        var box   = document.getElementById('ind-acct-cat-chips');
        var sel   = (box && box.getAttribute('data-sel')) || '';
        var other = ((document.getElementById('ind-acct-cat-other') || {}).value || '').trim();
        var reason = ((document.getElementById('ind-acct-reason') || {}).value || '').trim();
        var dlv   = (document.getElementById('ind-acct-deadline') || {}).value || '';
        var category = sel === '__other' ? other : sel;
        if (!category) { _notify(sel === '__other' ? 'Type your own category.' : 'Choose a category.', 'error'); return; }
        var deadline = dlv ? new Date(dlv).getTime() : 0;
        if (dlv && !isFinite(deadline)) { _notify('Enter a valid closing date.', 'error'); return; }
        var sbtn = document.getElementById('ind-acct-meta-save');
        if (sbtn) { sbtn.disabled = true; sbtn.style.opacity = '0.6'; }
        window._indAcctMeta = { category: category, reason: reason, deadline: deadline };
        _renderIndAcctBanner();
        if (_fbOk() && _db()) {
            try {
                await _db().collection('app_settings').doc('individual_account_form').set(
                    { category: category, reason: reason, deadline: deadline, updatedAt: _serverTs(), updatedBy: _us().id || 'admin' }, { merge: true });
                _notify('Category, reason and closing time saved.', 'success');
                /* "Request account details" = make sure the dashboard card is live */
                if (!window._indAcctFormEnabled()) await window._toggleIndAcctForm(true);
            } catch (e) { _notify('Could not save: ' + e.message, 'error'); }
        }
        if (sbtn) { sbtn.disabled = false; sbtn.style.opacity = ''; }
    };

    /* ── Invite link (after a successful application) ── */
    function _indAcctNewInviteCode() {
        var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', out = '', i;
        try { var a = new Uint8Array(8); (window.crypto || window.msCrypto).getRandomValues(a); for (i = 0; i < 8; i++) out += A.charAt(a[i] % A.length); }
        catch (e) { out = ''; for (i = 0; i < 8; i++) out += A.charAt(Math.floor(Math.random() * A.length)); }
        return out;
    }
    function _indAcctStoredInvite() { try { return localStorage.getItem('empyrean_invite_code') || ''; } catch (e) { return ''; } }
    function _indAcctInviteUrl(code) {
        var base = 'https://joinempyrean.com';
        try { if (/^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) base = location.origin; } catch (e) {}
        return base + '/?invite=' + encodeURIComponent(code);
    }
    window._indAcctSetSyncNote = function(state) {
        var el = document.getElementById('ind-acct-sync-note'); if (!el) return;
        el.style.display = 'block';
        if (state === 'sent') { el.style.background = 'rgba(0,212,170,0.12)'; el.style.color = '#0f766e'; el.textContent = '\u2713 Your details have been sent for verification.'; }
        else { el.style.background = '#FFF4E0'; el.style.color = '#B45309'; el.textContent = '\u23F3 Still sending \u2014 your details are saved on this device and will go through automatically once your connection improves. Keep the app open. Your invite link already works.'; }
    };
    function _indAcctShowInvite(code, pending) {
        var modal = document.getElementById('ind-acct-modal'); if (!modal || !code) return;
        var box = modal.firstElementChild; if (!box) return;
        var url = _indAcctInviteUrl(code);
        var cat = String((window._indAcctMeta || {}).category || '').trim();
        window._indAcctInvite = { url: url, text: 'You are invited to apply' + (cat ? ' for ' + cat : '') + ' on Empyrean. Register here:' };
        _indAcctInjectStyle();
        box.style.background = 'linear-gradient(165deg,#FFFFFF 0%,#FBF6E8 100%)';
        box.style.border = '1px solid #D9C28A';
        box.style.color = '#0B1E3F';
        modal.style.alignItems = 'flex-start'; modal.style.padding = '16px 16px 32px';
        box.style.margin = 'auto'; box.style.borderRadius = '22px'; box.style.maxWidth = '440px';
        box.style.boxShadow = '0 0 0 4px #fff,0 0 0 5px #E9DDBE,0 14px 34px rgba(11,30,63,.18)';
        function sb(k, label) {
            return '<button type="button" onclick="window._indAcctShare(\'' + k + '\')" style="height:40px;padding:0 14px;border-radius:20px;border:1px solid #E2DAC6;background:#fff;color:#0B1E3F;font-size:12.5px;font-weight:600;cursor:pointer;">' + label + '</button>';
        }
        var host = ''; try { host = new URL(url).host; } catch (e) { host = 'joinempyrean.com'; }
        var pTitle = cat || 'Disbursement';
        var preview =
            '<div style="text-align:left;font-size:10px;font-weight:700;letter-spacing:.18em;color:#5B6577;margin:0 0 8px;">WHAT FRIENDS SEE WHEN YOU SHARE</div>'
            + '<div style="text-align:left;border-radius:16px;overflow:hidden;border:1px solid #E2DAC6;background:#fff;box-shadow:0 8px 20px rgba(11,30,63,.08);">'
            + '<div style="position:relative;overflow:hidden;padding:18px 18px 22px;min-height:150px;box-sizing:border-box;background:linear-gradient(135deg,#07152B 0%,#0B1E3F 55%,#173A6E 100%);border-bottom:3px solid #C9A24D;">'
            + '<div style="position:absolute;right:-34px;top:-40px;width:150px;height:150px;border-radius:50%;background:rgba(201,162,77,.14);"></div>'
            + '<div style="position:relative;font-size:10px;letter-spacing:.3em;font-weight:700;color:#E8CF8E;">EMPYREAN</div>'
            + '<div style="position:relative;font-family:\'Cormorant Garamond\',Georgia,serif;font-size:30px;font-weight:700;line-height:1.05;color:#fff;margin-top:14px;max-width:80%;">' + _esc(pTitle) + '</div>'
            + '<div style="position:relative;font-size:10.5px;letter-spacing:.22em;font-weight:600;color:#E8CF8E;margin-top:10px;">REGISTRATION NOW OPEN</div>'
            + '<div style="position:absolute;right:14px;bottom:12px;width:58px;height:38px;border-radius:7px;border:1px solid #C9A24D;background:rgba(255,255,255,.08);"><span style="position:absolute;left:7px;top:7px;width:13px;height:9px;border-radius:2px;background:linear-gradient(135deg,#FBEFC6,#D9AE4A);"></span></div>'
            + '</div>'
            + '<div style="padding:11px 14px 13px;">'
            + '<div style="font-size:10.5px;letter-spacing:.16em;color:#5B6577;">' + _esc(host.toUpperCase()) + '</div>'
            + '<div style="font-size:14px;font-weight:700;line-height:1.3;color:#0B1E3F;margin-top:3px;">' + _esc(pTitle) + ' &mdash; Register on Empyrean</div>'
            + '<div style="font-size:12.5px;line-height:1.45;color:#3F4A5E;margin-top:2px;">You have been invited to apply. Tap to register and submit your details.</div>'
            + '</div></div>';
        box.innerHTML =
            '<div style="height:3px;background:linear-gradient(90deg,#C9A24D,#F1E4BC,#C9A24D);"></div>'
            + '<div style="padding:24px 22px;text-align:center;font-family:Inter,system-ui,sans-serif;">'
            + '<div style="width:52px;height:52px;margin:0 auto 12px;border-radius:50%;border:1.5px solid #C9A24D;background:linear-gradient(135deg,#0B1E3F,#173A6E);display:flex;align-items:center;justify-content:center;">'
            + '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E8CF8E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>'
            + '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:28px;font-weight:700;line-height:1.05;">Application Submitted</div>'
            + '<div style="font-size:12.5px;line-height:1.5;color:#3F4A5E;margin:8px 8px 18px;">Your details are being verified. Invite others to apply for this opportunity.</div>'
            + '<div id="ind-acct-sync-note" style="display:none;text-align:left;font-size:12px;line-height:1.5;padding:10px 12px;border-radius:12px;margin:-6px 0 16px;"></div>'
            + '<div style="text-align:left;font-size:10px;font-weight:700;letter-spacing:.18em;color:#5B6577;margin-bottom:7px;">YOUR INVITE LINK</div>'
            + '<div style="display:flex;gap:8px;"><input id="ind-acct-invite-link" type="text" readonly value="' + _esc(url) + '" style="flex:1;min-width:0;box-sizing:border-box;height:44px;border-radius:12px;border:1.5px solid #E2DAC6;background:#fff;padding:0 12px;font-size:13px;color:#0B1E3F;">'
            + '<button type="button" onclick="window._indAcctShare(\'copy\')" style="height:44px;padding:0 16px;border-radius:12px;border:1px solid #C9A24D;background:linear-gradient(135deg,#0B1E3F,#173A6E);color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;cursor:pointer;">COPY</button></div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:12px 0 16px;">'
            + sb('wa', 'WhatsApp') + sb('fb', 'Facebook') + sb('x', 'X') + sb('tg', 'Telegram') + sb('more', 'More') + '</div>'
            + preview + '<div style="height:16px;"></div>'
            + '<button type="button" onclick="document.getElementById(\'ind-acct-modal\').style.display=\'none\'" style="height:42px;padding:0 22px;border-radius:12px;border:1px solid #E2DAC6;background:#fff;color:#0B1E3F;font-size:12px;font-weight:700;cursor:pointer;">Done</button>'
            + '</div>';
        window._indAcctInviteShown = true;
        if (pending) window._indAcctSetSyncNote('pending');
    }
    window._indAcctShare = function(kind) {
        var inv = window._indAcctInvite || {}; if (!inv.url) return;
        var u = encodeURIComponent(inv.url), t = encodeURIComponent(inv.text);
        var map = {
            wa: 'https://wa.me/?text=' + encodeURIComponent(inv.text + ' ' + inv.url),
            fb: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
            x:  'https://twitter.com/intent/tweet?text=' + t + '&url=' + u,
            tg: 'https://t.me/share/url?url=' + u + '&text=' + t
        };
        if (kind === 'more' && navigator.share) { navigator.share({ title: 'Empyrean', text: inv.text, url: inv.url }).catch(function() {}); return; }
        if (map[kind]) { window.open(map[kind], '_blank', 'noopener'); return; }
        function fallback() {
            var el = document.getElementById('ind-acct-invite-link');
            if (el) { el.focus(); el.select(); try { document.execCommand('copy'); _notify('Invite link copied.', 'success'); } catch (e) {} }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inv.url).then(function() { _notify('Invite link copied.', 'success'); }, fallback);
        else fallback();
    };
    /* Someone opens a shared "?invite=CODE" link: remember the code, then guide them to register / apply. */
    function _indAcctHandleInviteLanding() {
        var code = '';
        try { code = new URLSearchParams(location.search).get('invite') || ''; } catch (e) {}
        if (!/^[A-Za-z0-9]{6,12}$/.test(code)) return;
        try { localStorage.setItem('empyrean_invite_code', code.toUpperCase()); } catch (e) {}
        setTimeout(function() {
            if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('register'); }
            else if (window._indAcctFormEnabled() && typeof window.openIndividualAccountForm === 'function') window.openIndividualAccountForm();
        }, 1500);
    }

    /* ── Render / refresh the dashboard banner ───────────────────────────
       Self-creates the banner div if not yet in the DOM, places it just
       before the Community Feed card inside .dashboard-grid.              */
    function _renderIndAcctBanner() {
        var enabled = window._indAcctFormEnabled();

        var banner = document.getElementById('ind-acct-dashboard-banner');
        if (!banner) {
            /* Find .dashboard-grid (direct parent of the Community Feed card) */
            var grid = document.querySelector('#dashboard .dashboard-grid');
            if (!grid) return;
            banner = document.createElement('div');
            banner.id = 'ind-acct-dashboard-banner';
            banner.style.cssText = 'display:none;';
            /* Insert before the card that contains #feed-container */
            var feedEl = document.getElementById('feed-container');
            var anchor = null;
            if (feedEl) {
                var node = feedEl;
                while (node && node.parentNode !== grid) node = node.parentNode;
                if (node && node.parentNode === grid) anchor = node;
            }
            if (anchor) grid.insertBefore(banner, anchor);
            else grid.prepend(banner);
            /* Attach the guard now that the element exists */
            _attachBannerGuard(banner);
        }

        banner.style.display = enabled ? '' : 'none';
        if (!enabled) return;
        if (false) banner.innerHTML =
            '<div style="background:linear-gradient(135deg,rgba(0,212,170,0.12),rgba(59,130,246,0.10));'
            + 'border:1.5px solid rgba(0,212,170,0.3);border-radius:16px;padding:0;overflow:hidden;margin-bottom:20px;">'
            /* Accent bar */
            + '<div style="height:4px;background:linear-gradient(90deg,var(--nav-accent,#00D4AA),#3B82F6,var(--nav-accent,#00D4AA));"></div>'
            + '<div style="padding:18px 20px;">'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">'
            + '<div style="width:38px;height:38px;border-radius:10px;background:rgba(0,212,170,0.15);'
            + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--nav-accent,#00D4AA);">'
            + '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">'
            + '<path d="M7 6V5.5C7 4.67157 7.67157 4 8.5 4H15.5C16.3284 4 17 4.67157 17 5.5V6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<rect x="3" y="6" width="18" height="13.5" rx="2.75" stroke="currentColor" stroke-width="1.6"/>'
            + '<path d="M3 10.25H21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
            + '<circle cx="16.75" cy="14.85" r="1.4" fill="currentColor"/>'
            + '</svg></div>'
            + '<div>'
            + '<div style="font-weight:800;font-family:\'Syne\',sans-serif;font-size:1rem;">Account Information Required</div>'
            + '<div style="font-size:0.80rem;color:var(--text-muted);">Please submit your bank details to receive your disbursement</div>'
            + '</div>'
            + '</div>'
            + '<button class="btn btn-accent" style="font-size:0.88rem;" '
            + 'onclick="window.openIndividualAccountForm && window.openIndividualAccountForm()">'
            + '<i class="fas fa-edit"></i> Fill Account Form</button>'
            + '</div>'
            + '</div>';

        /* Redesigned white / gold / navy card with LIVE countdown (old markup above is guarded off) */
        _indAcctRenderBanner(banner);
    }
    window._renderIndAcctBanner = _renderIndAcctBanner;

    /* Open the individual account information form modal */
    window.openIndividualAccountForm = function() {
        if (_isGuest()) {
            _notify('Please log in to submit your account information.', 'info');
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }

        var existing = document.getElementById('ind-acct-modal');
        if (existing) { existing.style.display = 'flex'; return; }

        var us    = _us();
        window._indAcctInviteShown = false;
        _indAcctInjectStyle();
        var modal = document.createElement('div');
        modal.id  = 'ind-acct-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,30,0.55);backdrop-filter:blur(3px);'
            + 'z-index:100002;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-top:12px;box-sizing:border-box;';
        var catLabel = String((window._indAcctMeta || {}).category || 'Disbursement').toUpperCase();
        var bankOpts = '<option value="">Select your bank</option>' + _IND_ACCT_BANKS.map(function(b) {
            return '<option value="' + _esc(b) + '">' + _esc(b) + '</option>';
        }).join('');
        var fld = 'width:100%;box-sizing:border-box;height:56px;padding:0 18px;border-radius:16px;border:1.5px solid #E9DDBE;background:#FBF8F0;color:#0B1E3F;font:400 16.5px/1 Inter,system-ui,sans-serif;outline:none;';
        function lbl(t) { return '<div style="font:700 12px/1 Inter,system-ui,sans-serif;letter-spacing:.2em;color:#3F4A5E;margin:20px 0 8px;">' + t + '</div>'; }
        var chev = 'appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%230B1E3F%27 stroke-width=%272.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M6 9l6 6 6-6%27/%3E%3C/svg%3E&quot;);background-repeat:no-repeat;background-position:right 18px center;padding-right:44px;';
        function sec(t) { return '<div style="font:700 11px/1 Inter,system-ui,sans-serif;letter-spacing:.2em;color:#8A6A22;margin:26px 0 2px;padding-top:14px;border-top:1px solid #E3D3A8;">' + t + '</div>'; }
        function txt(id, ph, val, type) { return '<input id="' + id + '" type="' + (type || 'text') + '" autocomplete="off" placeholder="' + ph + '" value="' + _esc(val || '') + '" style="' + fld + '">'; }
        function selx(id, opts) { return '<select id="' + id + '" style="' + fld + chev + '">' + opts + '</select>'; }

        modal.innerHTML =
            '<div style="background:#fff;border-radius:28px 28px 0 0;width:100%;max-width:560px;margin-top:auto;box-shadow:0 -10px 40px rgba(11,30,63,.18);animation:empNavFadeIn 0.2s ease;overflow:hidden;">'
            + '<div style="position:relative;padding:12px 24px calc(32px + env(safe-area-inset-bottom,0px));font-family:Inter,system-ui,sans-serif;color:#0B1E3F;">'
            + '<button type="button" aria-label="Close" onclick="document.getElementById(\'ind-acct-modal\').style.display=\'none\'" style="position:absolute;top:8px;right:14px;width:36px;height:36px;border-radius:50%;border:1px solid #E9DDBE;background:#FBF8F0;color:#0B1E3F;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B1E3F" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'
            + '<div style="width:52px;height:5px;border-radius:3px;background:#E3DCCB;margin:0 auto 30px;"></div>'
            + '<div style="display:flex;align-items:center;gap:14px;">'
            + '<div style="width:56px;height:56px;flex:none;border-radius:50%;border:1.5px solid #C9A24D;background:#fff;display:flex;align-items:center;justify-content:center;">'
            + '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8A6A22" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-6 9 6M4.5 21V10.5M19.5 21V10.5M8.25 21v-8.25M12 21v-8.25M15.75 21v-8.25M3 21h18"/></svg></div>'
            + '<div style="min-width:0;"><div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:34px;font-weight:700;line-height:1;">Account Details</div>'
            + '<div style="font:700 12px/1.3 Inter,system-ui,sans-serif;letter-spacing:.18em;color:#8A6A22;margin-top:6px;">' + _esc(catLabel) + ' &middot; STEP 1 OF 2</div></div></div>'
            + '<div style="height:1px;background:#E3D3A8;margin:18px 0 18px;"></div>'
            + '<div style="text-align:center;font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:.22em;color:#3F4A5E;">A NOTE FROM THE DISBURSEMENT OFFICE</div>'
            + '<div style="text-align:center;font-family:\'Cormorant Garamond\',Georgia,serif;font-style:italic;font-weight:600;font-size:22px;line-height:1.45;color:#1d2a44;margin:10px 0 0;">'
            + '&ldquo;Your approved payout is ready for release. To pay you directly and securely, we require a verified bank account in your own name.&rdquo;</div>'
            + sec('PERSONAL DETAILS')
            + lbl('FULL NAME') + txt('ind-acct-fullname', 'Legal full name', us.fullName)
            + lbl('PHONE NUMBER') + txt('ind-acct-phone', '+234…', us.phone, 'tel')
            + lbl('GENDER') + selx('ind-acct-gender', '<option value="">Select…</option><option value="male">Male</option><option value="female">Female</option><option value="non-binary">Non-binary</option><option value="prefer_not">Prefer not to say</option>')
            + lbl('OCCUPATION') + txt('ind-acct-occupation', 'e.g. Teacher, Nurse, Farmer')
            + lbl('HIGHEST EDUCATION') + selx('ind-acct-education', '<option value="">Select…</option><option value="no_formal">No Formal Education</option><option value="primary">Primary</option><option value="secondary">Secondary / WAEC</option><option value="diploma">Diploma / OND</option><option value="undergraduate">Undergraduate / HND</option><option value="postgraduate">Postgraduate</option><option value="other">Other</option>')
            + lbl('PURPOSE OF SUBSCRIPTION') + txt('ind-acct-purpose', 'Why are you applying for this disbursement?')
            + sec('BANK ACCOUNT DETAILS')
            + lbl('BANK')
            + '<select id="ind-acct-bank-name" style="' + fld + chev + '">' + bankOpts + '</select>'
            + lbl('ACCOUNT NUMBER')
            + '<input id="ind-acct-bank-account-number" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="10-digit account number" oninput="this.value=this.value.replace(/\\D/g,\'\').slice(0,10)" style="' + fld + '">'
            + lbl('ACCOUNT NAME')
            + '<input id="ind-acct-bank-account-name" type="text" autocomplete="off" value="" placeholder="Account name as on your bank account" style="' + fld + '">'
            + '<label style="display:flex;align-items:flex-start;gap:14px;margin:22px 0 0;cursor:pointer;">'
            + '<input id="ind-acct-confirm" type="checkbox" style="width:26px;height:26px;flex:none;margin:1px 0 0;accent-color:#0B1E3F;cursor:pointer;">'
            + '<span style="font-size:15.5px;line-height:1.45;color:#3F4A5E;">I confirm this account is held in my own name and the details are correct.</span></label>'
            + '<div id="ind-acct-feedback" style="display:none;margin-top:14px;padding:10px 14px;border-radius:10px;font-size:0.85rem;"></div>'
            + '<button type="button" id="ind-acct-submit-btn" onclick="window._submitIndividualAccountForm && window._submitIndividualAccountForm()" '
            + 'style="width:100%;height:60px;margin-top:22px;border-radius:18px;border:1.5px solid #C9A24D;background:linear-gradient(135deg,#0B1E3F,#0F2A56);color:#fff;font:700 13px/1 Inter,system-ui,sans-serif;letter-spacing:.2em;cursor:pointer;box-shadow:0 10px 22px rgba(11,30,63,.22);">'
            + 'SUBMIT FOR VERIFICATION &rarr;</button>'
            + '<div style="text-align:center;font-size:14px;color:#5B6577;margin-top:14px;">Encrypted &middot; Seen only by the disbursement office</div>'
            + '</div></div>';

        document.body.appendChild(modal);
        document.body.classList.add('modal-open');

        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.style.display = 'none';
        });

        /* CRYPTO_HIDDEN_FOR_PLAY_STORE: this used to wire a wallet-address
           placeholder hint to the (now-removed, see note above) crypto
           currency/wallet fields. Both elements no longer exist in the
           DOM, so this whole listener is dead weight — removed rather
           than left as a silent no-op. Restore alongside the fields
           above when crypto disbursement goes live. */
    };

    /* Submit individual account information */
    window._submitIndividualAccountForm = async function() {
        var btn = document.getElementById('ind-acct-submit-btn');
        var fb  = document.getElementById('ind-acct-feedback');

        function _setFb(msg, type) {
            if (!fb) return;
            fb.style.display    = 'block';
            fb.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : type === 'success' ? 'rgba(0,212,170,0.1)' : 'rgba(245,158,11,0.1)';
            fb.style.color      = type === 'error' ? 'var(--danger-color,#ef4444)' : type === 'success' ? 'var(--nav-accent,#00D4AA)' : '#d97706';
            fb.innerHTML        = msg;
        }

        var fullName    = (document.getElementById('ind-acct-fullname')            || {}).value || '';
        var phone       = (document.getElementById('ind-acct-phone')               || {}).value || '';
        var gender      = (document.getElementById('ind-acct-gender')              || {}).value || '';
        var occupation  = (document.getElementById('ind-acct-occupation')          || {}).value || '';
        var education   = (document.getElementById('ind-acct-education')           || {}).value || '';
        var purpose     = (document.getElementById('ind-acct-purpose')             || {}).value || '';
        var acctName    = (document.getElementById('ind-acct-bank-account-name')   || {}).value || '';
        var acctNumber  = (document.getElementById('ind-acct-bank-account-number') || {}).value || '';
        var bankName    = (document.getElementById('ind-acct-bank-name')           || {}).value || '';
        var confirmed   = !!(document.getElementById('ind-acct-confirm') || {}).checked;

        if (!fullName.trim() || !phone.trim() || !gender || !occupation.trim() || !education || !purpose.trim()
            || !bankName || !acctName.trim() || !acctNumber.trim()) {
            _setFb('⚠ Please complete every field — personal details and bank details are all required.', 'error');
            return;
        }
        if (!/^\d{10}$/.test(acctNumber.replace(/\s/g,''))) {
            _setFb('⚠ Please enter a valid 10-digit bank account number.', 'error');
            return;
        }
        if (!confirmed) {
            _setFb('⚠ Please confirm the account is held in your own name.', 'error');
            return;
        }

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting…'; }

        var record = {
            fullName:          fullName.trim(),
            phone:             phone.trim(),
            gender:            gender,
            occupation:        occupation.trim(),
            education:         education,
            purposeOfSubscription: purpose.trim(),
            bankAccountName:   acctName.trim(),
            bankAccountNumber: acctNumber.replace(/\s/g,''),
            bankName:          bankName.trim(),
            userId:            _us().id || 'guest',
            userEmail:         _us().email || '',
            submittedAt:       _serverTs(),
            inviteCode:        (window._indAcctPendingCode = window._indAcctPendingCode || _indAcctNewInviteCode()),
            invitedBy:         _indAcctStoredInvite(),
            category:          String((window._indAcctMeta || {}).category || ''),
            status:            'pending'
        };

        if (_fbOk() && _db()) {
            try {
                /* Firestore persistence is on (index.html), so on a weak connection set()/add() stays pending until the
                   server acknowledges — the button used to sit on "Submitting…" indefinitely. The doc id is now fixed
                   per attempt (retries overwrite the same doc, never duplicate), and after 12s the user is told the
                   write is queued on this device; the success view still appears the moment the server confirms. */
                var ref = window._indAcctPendingRef || (window._indAcctPendingRef = _db().collection('individual_account_info').doc());
                var _finishOk = function() {
                    window._indAcctPendingRef = null; window._indAcctPendingCode = null; window._indAcctPendingWrite = null;
                    try { localStorage.removeItem('empyrean_invite_code'); } catch (_ls) {}
                    if (window._indAcctInviteShown) { window._indAcctSetSyncNote('sent'); _notify('Account information sent. Reference: ' + ref.id, 'success'); return; }
                    _setFb('✅ Account information submitted successfully! Reference: <strong>' + ref.id + '</strong>', 'success');
                    if (btn) { btn.disabled = false; btn.innerHTML = 'SUBMITTED'; }
                    _notify('Account information saved. Reference: ' + ref.id, 'success');
                    /* Success view: shareable invite link (replaces the old auto-close) */
                    try { _indAcctShowInvite(record.inviteCode); } catch (_iv) {}
                };
                /* firestore.rules: individual_account_info is create-only for users (update = admin), so a retry must
                   WAIT on the write already in flight — never send a second set() for the same doc. */
                var _writeP = window._indAcctPendingWrite || (window._indAcctPendingWrite = ref.set(record));
                var _res = await Promise.race([_writeP.then(function() { return 'ok'; }), new Promise(function(r) { setTimeout(function() { r('slow'); }, 6000); })]);
                if (_res === 'ok') { _finishOk(); }
                else {
                    /* Weak connection: the invite code is generated on this device and the write is queued locally
                       (Firestore persistence), so don't hold the applicant on the form — go straight to the invite
                       screen, flagged "still sending", and flip it to "sent" when the server confirms. */
                    try { _indAcctShowInvite(record.inviteCode, true); } catch (_iv2) {}
                    _writeP.then(_finishOk).catch(function(e2) {
                        window._indAcctPendingRef = null; window._indAcctPendingCode = null; window._indAcctPendingWrite = null;
                        var n = document.getElementById('ind-acct-sync-note');
                        if (n) { n.style.display = 'block'; n.style.background = '#fee2e2'; n.style.color = '#991b1b'; n.textContent = 'Sending failed: ' + (e2 && e2.message || 'unknown error') + '. Please close this and submit again.'; }
                        else _setFb('❌ Submission failed: ' + _esc(e2 && e2.message || ''), 'error');
                    });
                }
            } catch(e) {
                window._indAcctPendingRef = null; window._indAcctPendingCode = null; window._indAcctPendingWrite = null;
                _setFb('❌ Submission failed: ' + _esc(e.message), 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = 'SUBMIT FOR VERIFICATION &rarr;'; }
            }
        } else {
            _setFb('✅ Information saved locally (offline mode). Will sync when online.', 'success');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Saved'; }
        }
    };

    /* Admin control panel section for the Individual Account Form toggle */
    function _renderIndividualAccountAdminPanel() {
        var enabled = window._indAcctFormEnabled();
        return '<div class="card" style="margin-bottom:16px;">'
            + '<div style="height:3px;background:linear-gradient(90deg,var(--nav-accent,#00D4AA),#3B82F6);"></div>'
            + '<div class="card-content">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px;">'
            + '<div>'
            + '<h3 style="font-family:\'Syne\',sans-serif;margin:0 0 4px;">'
            + '<i class="fas fa-user-circle" style="color:var(--nav-accent,#00D4AA);margin-right:8px;"></i>Individual Account Form</h3>'
            + '<p style="color:var(--text-muted);font-size:0.83rem;margin:0;">'
            + 'Activate to display the individual account information form on the general dashboard. '
            + 'When active, a banner will guide users to fill in their bank details for disbursement.</p>'
            + '</div>'
            + '<button id="ind-acct-admin-toggle-btn" class="btn" '
            + 'style="white-space:nowrap;flex-shrink:0;font-size:0.85rem;'
            + (enabled ? 'background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);' : 'background:var(--nav-accent,#00D4AA);color:#0A0F1E;')
            + '" onclick="window._toggleIndAcctForm(' + !enabled + ')">'
            + (enabled ? '<i class="fas fa-toggle-on"></i> Deactivate Form' : '<i class="fas fa-toggle-off"></i> Activate Form')
            + '</button>'
            + '</div>'
            /* Status indicator */
            + '<div style="padding:10px 14px;border-radius:10px;font-size:0.83rem;'
            + 'background:' + (enabled ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.08)') + ';'
            + 'border:1px solid ' + (enabled ? 'rgba(34,197,94,0.2)' : 'rgba(148,163,184,0.2)') + ';'
            + 'color:' + (enabled ? '#22c55e' : 'var(--text-muted)') + ';">'
            + '<i class="fas ' + (enabled ? 'fa-circle' : 'fa-circle') + '" style="font-size:0.5rem;vertical-align:middle;margin-right:6px;"></i>'
            + (enabled ? '<strong>ACTIVE</strong> — The form and banner are currently visible on the dashboard homepage.'
                       : '<strong>INACTIVE</strong> — The form is hidden. Only you can see it here in the admin panel.')
            + '</div>'
            + _indAcctAdminMetaHtml()
            /* View submissions */
            + '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">'
            + '<button class="btn btn-small" onclick="window._loadIndAcctSubmissions && window._loadIndAcctSubmissions()">'
            + '<i class="fas fa-list"></i> View Submissions</button>'
            + '<button class="btn btn-small" onclick="window._exportIndAcctData && window._exportIndAcctData()">'
            + '<i class="fas fa-download"></i> Export CSV</button>'
            + '</div>'
            + '<div id="ind-acct-submissions-container" style="margin-top:14px;"></div>'
            + '</div></div>';
    }

    /* Load individual account form submissions for admin */
    window._loadIndAcctSubmissions = function() {
        var container = document.getElementById('ind-acct-submissions-container');
        if (!container) return;

        if (!_fbOk() || !_db()) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Firebase not connected.</p>';
            return;
        }
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;"><i class="fas fa-circle-notch fa-spin"></i> Loading…</p>';

        _db().collection('individual_account_info').orderBy('submittedAt', 'desc').limit(100).get()
            .then(function(snap) {
                if (snap.empty) {
                    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">No submissions yet.</p>';
                    return;
                }
                var rows = '';
                snap.forEach(function(doc) {
                    var d  = doc.data();
                    var dt = d.submittedAt && d.submittedAt.toDate
                        ? d.submittedAt.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
                        : '—';
                    rows += '<tr style="border-bottom:1px solid rgba(0,212,170,0.07);">'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(d.fullName || '—') + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(d.phone || '—') + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;font-family:monospace;">' + _esc(d.bankAccountNumber || '—') + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(d.bankAccountName || '—') + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(d.bankName || '—') + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">'
                        + (d.cryptoCurrency
                            ? '<span style="display:inline-block;padding:1px 7px;border-radius:6px;background:rgba(0,212,170,0.12);color:var(--nav-accent,#00D4AA);font-weight:700;font-size:0.72rem;margin-right:5px;">' + _esc(d.cryptoCurrency) + '</span><span style="font-family:monospace;word-break:break-all;">' + _esc(d.cryptoWalletAddress || '—') + '</span>'
                            : '—')
                        + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(d.occupation || '—') + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(dt) + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(d.category || '—') + '</td>'
                        + '<td style="padding:8px 10px;font-size:0.82rem;">' + _esc(d.status || '—') + '</td>'
                        + '</tr>';
                });
                container.innerHTML = '<div style="overflow-x:auto;margin-top:4px;">'
                    + '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">'
                    + '<thead><tr style="border-bottom:2px solid rgba(0,212,170,0.15);">'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Full Name</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Phone</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Account No.</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Account Name</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Bank</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Other Payout Info</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Occupation</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Date</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Category</th>'
                    + '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;">Status</th>'
                    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
                    + '<p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;">' + snap.size + ' submission(s) total.</p>';
            })
            .catch(function(e) {
                container.innerHTML = '<p style="color:var(--danger-color);font-size:0.85rem;">Error: ' + _esc(e.message) + '</p>';
            });
    };

    /* Export individual account submissions as CSV */
    window._exportIndAcctData = function() {
        if (!_fbOk() || !_db()) { _notify('Firebase not connected.', 'error'); return; }
        _db().collection('individual_account_info').orderBy('submittedAt', 'desc').limit(500).get()
            .then(function(snap) {
                if (snap.empty) { _notify('No submissions to export.', 'info'); return; }
                var keys = ['fullName','phone','gender','occupation','education','purposeOfSubscription',
                    'bankAccountName','bankAccountNumber','bankName','cryptoCurrency','cryptoWalletAddress',
                    'userEmail','submittedAt','category','status','inviteCode','invitedBy','amount'];
                var header = keys.join(',');
                var csvRows = [];
                snap.forEach(function(doc) {
                    var d = doc.data();
                    csvRows.push(keys.map(function(k) {
                        var v = d[k];
                        if (v && v.toDate) v = v.toDate().toISOString().split('T')[0];
                        return '"' + String(v !== undefined ? v : '').replace(/"/g,'""') + '"';
                    }).join(','));
                });
                var blob = new Blob([[header].concat(csvRows).join('\n')], { type: 'text/csv;charset=utf-8;' });
                var url  = URL.createObjectURL(blob);
                var a    = document.createElement('a');
                a.href = url; a.download = 'individual-account-info-' + Date.now() + '.csv';
                a.style.display = 'none';
                document.body.appendChild(a); a.click();
                setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
                _notify('✅ CSV export ready — ' + snap.size + ' records.', 'success');
            })
            .catch(function(e) { _notify('Export failed: ' + e.message, 'error'); });
    };


    /* =========================================================================
       §13  INDIVIDUAL GRANT REQUEST MODAL  (NEW)
       Public-facing modal for individuals to apply for grant funding.
       ========================================================================= */

    window.openIndividualGrantModal = function() {
        if (_isGuest()) {
            _notify('Please log in to apply for an individual grant.', 'info');
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }

        var existing = document.getElementById('individual-grant-modal');
        if (existing) existing.remove();

        var us    = _us();
        var modal = document.createElement('div');
        modal.id  = 'individual-grant-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,30,0.85);backdrop-filter:blur(4px);'
            + 'z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;';

        modal.innerHTML =
            '<div style="background:var(--card-bg,#111827);border-radius:20px;width:100%;max-width:540px;'
            + 'border:1px solid rgba(0,212,170,0.2);overflow:hidden;animation:empNavFadeIn 0.2s ease;">'
            + '<div style="height:4px;background:linear-gradient(90deg,#22c55e,#00D4AA);"></div>'
            + '<div style="padding:24px;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">'
            + '<h3 style="font-family:\'Syne\',sans-serif;font-weight:800;margin:0;">'
            + '<i class="fas fa-user-check" style="color:#22c55e;margin-right:10px;"></i>Individual Grant Application</h3>'
            + '<button onclick="document.getElementById(\'individual-grant-modal\').remove()" '
            + 'style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.2rem;padding:4px;">'
            + '<i class="fas fa-times"></i></button>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
            + _modalField('ind-grant-name',    'Full Legal Name *', 'text', us.fullName || 'Your full name')
            + _modalField('ind-grant-email',   'Email Address *',  'email', us.email || 'your@email.com')
            + _modalField('ind-grant-phone',   'Phone Number *', 'tel', '+234…')
            + _modalField('ind-grant-amount',  'Grant Amount Requested *', 'number', 'e.g. 150000')
            + _modalField('ind-grant-currency','Currency', 'select',
                /* CRYPTO_HIDDEN_FOR_PLAY_STORE: <option value="USDT">USDT</option> removed —
                   real external crypto not launched yet. EMPY Token stays (in-house currency). */
                '<option value="NGN">NGN (₦ Naira)</option>'
                + '<option value="USD">USD ($)</option>'
                + '<option value="EMPY">EMPY Token</option>')
            + _modalField('ind-grant-purpose', 'Grant Purpose *', 'text', 'e.g. Medical treatment, Education fees')
            + '</div>'
            + '<div style="margin-top:12px;">'
            + '<label style="display:block;font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;">Reason / Justification *</label>'
            + '<textarea id="ind-grant-reason" rows="3" placeholder="Explain why you need this grant and how the funds will be used…" '
            + 'style="width:100%;padding:10px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;'
            + 'background:rgba(232,240,255,0.04);color:inherit;font-size:0.88rem;resize:vertical;"></textarea>'
            + '</div>'
            + '<div style="margin-top:12px;">'
            + '<label style="display:block;font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;">Preferred Payment Method *</label>'
            + '<select id="ind-grant-method" style="width:100%;padding:9px 12px;border:1.5px solid rgba(0,212,170,0.2);border-radius:10px;background:rgba(232,240,255,0.04);color:inherit;font-size:0.88rem;">'
            + '<option value="bank">Bank Transfer</option>'
            + '<option value="mobile_money">Mobile Money</option>'
            /* CRYPTO_HIDDEN_FOR_PLAY_STORE: <option value="crypto_wallet">Crypto Wallet</option>
               removed — crypto payout not launched yet; restore alongside
               _executeIndividualGrantDisbursement's 'crypto_wallet' branch when it does. */
            + '<option value="flutterwave">Flutterwave Disbursement</option>'
            + '</select>'
            + '</div>'
            + '<div style="margin-top:10px;" id="ind-grant-wallet-row" style="display:none;">'
            + _modalField('ind-grant-wallet',  'Account Details', 'text', 'Bank account number or mobile money number')
            + '</div>'
            + '<div style="padding:10px 14px;border-radius:10px;background:rgba(0,212,170,0.05);border:1px solid rgba(0,212,170,0.15);margin-top:12px;font-size:0.80rem;">'
            + '<i class="fas fa-lock" style="color:var(--nav-accent,#00D4AA);margin-right:6px;"></i>'
            + 'Your application is encrypted and reviewed by our compliance team. '
            + 'Identity verification may be required before disbursement.'
            + '</div>'
            + '<div id="ind-grant-feedback" style="display:none;margin-top:12px;padding:10px 14px;border-radius:10px;font-size:0.85rem;"></div>'
            + '<div style="display:flex;gap:10px;margin-top:20px;">'
            + '<button class="btn btn-accent" id="ind-grant-submit-btn" '
            + 'onclick="window._submitIndividualGrantReq && window._submitIndividualGrantReq()" style="flex:1;background:#22c55e;">'
            + '<i class="fas fa-paper-plane"></i> Submit Application</button>'
            + '<button class="btn" onclick="document.getElementById(\'individual-grant-modal\').remove()">Cancel</button>'
            + '</div>'
            + '</div></div>';

        document.body.appendChild(modal);
        document.body.classList.add('modal-open');

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { modal.remove(); document.body.classList.remove('modal-open'); }
        });
    };

    /* Submit individual grant request */
    window._submitIndividualGrantReq = function() {
        var btn = document.getElementById('ind-grant-submit-btn');
        var fb  = document.getElementById('ind-grant-feedback');

        function _setFb(msg, type) {
            if (!fb) return;
            fb.style.display    = 'block';
            fb.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)';
            fb.style.color      = type === 'error' ? 'var(--danger-color,#ef4444)' : type === 'success' ? '#22c55e' : '#d97706';
            fb.textContent      = msg;
        }

        var fullName  = (document.getElementById('ind-grant-name')     || {}).value || '';
        var email     = (document.getElementById('ind-grant-email')    || {}).value || '';
        var phone     = (document.getElementById('ind-grant-phone')    || {}).value || '';
        var amount    = parseFloat((document.getElementById('ind-grant-amount')  || {}).value || '0');
        var currency  = (document.getElementById('ind-grant-currency') || {}).value || 'NGN';
        var purpose   = (document.getElementById('ind-grant-purpose')  || {}).value || '';
        var reason    = (document.getElementById('ind-grant-reason')   || {}).value || '';
        var method    = (document.getElementById('ind-grant-method')   || {}).value || 'bank';
        var wallet    = (document.getElementById('ind-grant-wallet')   || {}).value || '';

        if (!fullName.trim() || !email.trim() || !phone.trim() || !amount || !purpose.trim() || !reason.trim()) {
            _setFb('⚠ Please fill in all required fields.', 'error'); return;
        }
        if (amount < 1000) { _setFb('⚠ Minimum grant request is ' + _fmtAmount(1000, currency) + '.', 'error'); return; }

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting…'; }

        var record = {
            fullName:      fullName.trim(),
            email:         email.trim(),
            phone:         phone.trim(),
            amount:        amount,
            currency:      currency,
            purpose:       purpose.trim(),
            reason:        reason.trim(),
            paymentMethod: method,
            walletOrAccount: wallet.trim(),
            applicantId:   _us().id || 'guest',
            status:        'pending',
            submittedAt:   _serverTs()
        };

        if (_fbOk() && _db()) {
            _db().collection('individual_grants').add(record)
                .then(function(ref) {
                    _setFb('✅ Application submitted! Reference: ' + ref.id + '. We will contact you within 5 business days.', 'success');
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Submitted'; }
                    _notify('Individual grant application submitted. ID: ' + ref.id, 'success');
                    setTimeout(function() {
                        var modal = document.getElementById('individual-grant-modal');
                        if (modal) { modal.remove(); document.body.classList.remove('modal-open'); }
                    }, 4000);
                })
                .catch(function(e) {
                    _setFb('❌ Submission failed: ' + e.message, 'error');
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Application'; }
                });
        } else {
            _setFb('✅ Application saved locally (offline mode). Will sync when online.', 'success');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Saved'; }
        }
    };


    /* =========================================================================
       §14  FIRESTORE LOADERS
       ========================================================================= */

    /* Load verified NGO partners from Firestore (v1 preserved + enhanced) */
    function _loadNgoPartners() {
        if (!_fbOk() || !_db()) return;
        if (window._ngoPartnersLoaded) return;

        _db().collection('ngo_partners')
            .where('isVerified', '==', true)
            .limit(100)
            .get()
            .then(function(snap) {
                if (!snap || snap.empty) return;
                var partners = (_S().mockNgoPartners) || window.mockNgoPartners || {};
                snap.forEach(function(doc) {
                    var data = doc.data();
                    data.id  = data.id || doc.id;
                    if (data.id) partners[data.id] = data;
                });
                if (window.EmpState) window.EmpState.mockNgoPartners = partners;
                else                 window.mockNgoPartners           = partners;
                window._ngoPartnersLoaded = true;
                renderNgoGrid();
            })
            .catch(function(e) { console.warn('[NGO] Firestore load failed:', e && e.message); });
    }

    /* Load grant applications for the admin queue */
    function _loadGrantApplications() {
        if (!_fbOk() || !_db()) return;
        renderNgoVerificationQueue();
    }

    /* Load individual grant queue */
    function _loadIndividualGrantQueue() {
        if (!_fbOk() || !_db()) return;
        renderIndividualGrantPanel();
    }


    /* =========================================================================
       §15  COMMUNITY TASK CLICK HANDLER  (v1 preserved — unchanged)
       ========================================================================= */

    document.addEventListener('click', function(e) {
        var taskBtn = e.target.closest('.community-task-btn');
        if (!taskBtn) return;
        e.preventDefault();

        if (_isGuest()) {
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }

        var taskId = taskBtn.dataset.taskId;
        var reward = parseInt(taskBtn.dataset.reward, 10) || 0;
        var url    = taskBtn.dataset.url || '#';
        var us     = _us();

        if (!us.completedTasks) us.completedTasks = new Set();

        if (us.completedTasks.has(taskId)) {
            _notify('Task already completed! Reward already earned.', 'info');
            if (url && url !== '#') window.open(url, '_blank');
            return;
        }

        us.empyBalance = (us.empyBalance || 0) + reward;
        us.completedTasks.add(taskId);
        if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
        _notify('+' + reward + ' EMPY! Task completed. Reward earned once.', 'success');

        try {
            if (us.id && _fbOk() && _db()) {
                _db().collection('users').doc(us.id).update({
                    completedTasks: Array.from(us.completedTasks),
                    empyBalance:    us.empyBalance
                }).catch(function() {});
            }
        } catch(err) {}

        if (url && url !== '#') window.open(url, '_blank');
        renderCommunityTasks();
    });


    /* =========================================================================
       §16  NGO CARD CLICK + BACK-TO-GRID  (v1 preserved — unchanged)
       ========================================================================= */

    document.addEventListener('click', function(e) {
        var ngoCard = e.target.closest('.ngo-card');
        if (ngoCard && ngoCard.dataset.ngoId) {
            e.preventDefault();
            renderNgoProfile(ngoCard.dataset.ngoId);
            return;
        }
        if (e.target.closest('#back-to-ngo-grid')) {
            e.preventDefault();
            var gridView    = document.getElementById('ngo-grid-view');
            var profileView = document.getElementById('ngo-profile-view');
            var backBtn     = document.getElementById('back-to-ngo-grid');
            if (gridView)    gridView.style.display    = 'block';
            if (profileView) profileView.style.display = 'none';
            if (backBtn)     backBtn.style.display     = 'none';
        }
    });


    /* =========================================================================
       §17  DONATE BUTTON → DONATION MODAL  (v1 preserved + NGO donate path)
       ========================================================================= */

    document.addEventListener('click', function(e) {
        var donateBtn = e.target.closest('.donate-post-btn, .help-now-btn, .sos-button');
        if (!donateBtn) return;

        if (_isGuest()) {
            _notify('Please log in to donate.', 'info');
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }

        var modal = document.getElementById('donation-modal-overlay')
            || document.getElementById('sos-donation-modal');
        if (!modal) return;

        var postCard   = donateBtn.closest('.impact-story');
        var authorName = postCard
            ? ((postCard.querySelector('.story-user-info strong') || {}).textContent || 'this cause')
            : 'this cause';
        var sosUserId  = (postCard && postCard.dataset.userId)  || '';
        var sosPostId  = (postCard && postCard.dataset.postId)  || '';
        var sosUsername= (postCard && postCard.dataset.username) || authorName;

        window._sosDonationContext = { userId: sosUserId, postId: sosPostId, username: sosUsername };

        var titleEl = document.getElementById('donation-modal-title');
        var descEl  = document.getElementById('donation-modal-description');
        if (titleEl) titleEl.textContent = 'Support ' + authorName;
        if (descEl)  descEl.textContent  = 'Your donation is held in escrow and disbursed directly to '
            + sosUsername + ' after admin verification.';

        modal.style.display = 'flex';
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    });

    /* NGO-specific donation modal */
    window._openNgoDonationModal = function(ngoId) {
        if (_isGuest()) {
            _notify('Please log in to donate.', 'info');
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }
        var ngo   = _partners()[ngoId] || { name: 'NGO Partner' };
        var modal = document.getElementById('donation-modal-overlay') || document.getElementById('sos-donation-modal');
        if (!modal) { _notify('Donation modal not available.', 'error'); return; }

        window._sosDonationContext = { userId: ngoId, postId: '', username: ngo.name, type: 'ngo' };

        var titleEl = document.getElementById('donation-modal-title');
        var descEl  = document.getElementById('donation-modal-description');
        if (titleEl) titleEl.textContent = 'Donate to ' + ngo.name;
        if (descEl)  descEl.textContent  = 'Your donation supports ' + ngo.name + '\'s programs. '
            + 'Funds are held in escrow and disbursed with full transparency.';

        modal.style.display = 'flex';
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    };


    /* =========================================================================
       §18  SOS DONATION FLUTTERWAVE FORM HANDLER  (v1 preserved — unchanged)
       ========================================================================= */

    document.addEventListener('submit', function(e) {
        var form   = e.target;
        var formId = form && form.id;
        if (formId !== 'sos-donation-form' && formId !== 'donation-form') return;
        e.preventDefault();

        var amountInput  = form.querySelector('[name="donation-amount"], #donation-amount');
        var nameInput    = form.querySelector('[name="donor-name"], #donor-name');
        var emailInput   = form.querySelector('[name="donor-email"], #donor-email');
        var phoneInput   = form.querySelector('[name="donor-phone"], #donor-phone');
        var methodSelect = form.querySelector('[name="payment-method"], #donation-payment-method');

        var amount     = parseFloat(amountInput   ? amountInput.value   : 0);
        var donorName  = (nameInput  ? nameInput.value.trim()  : '') || (_us().fullName || 'Anonymous');
        var donorEmail = (emailInput ? emailInput.value.trim() : '') || (_us().email    || 'donor@empyrean.com');
        var donorPhone = (phoneInput ? phoneInput.value.trim() : '') || (_us().phone    || '');
        var method     = methodSelect ? methodSelect.value : 'flutterwave';

        if (!amount || amount < 100) { _notify('Minimum donation is ₦100.', 'error'); return; }
        if (method === 'bank')       { _notify('Please follow the bank transfer instructions on screen.', 'info'); return; }

        var ctx         = window._sosDonationContext || {};
        var donateTxRef = 'EMPY-DON-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
        var submitBtn   = form.querySelector('button[type="submit"]');

        function _restoreBtn() {
            if (!submitBtn) return;
            submitBtn.disabled  = false;
            submitBtn.innerHTML = '<i class="fas fa-hand-holding-heart"></i> Donate Now via Flutterwave';
        }
        function _closeModal() {
            var m = form.closest('.modal-overlay-container, #sos-donation-modal, #donation-modal-overlay');
            if (m) { m.classList.remove('show'); m.style.display = 'none'; }
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }
        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Opening Payment…';
        }

        function _launchFlutterwave() {
            try {
                FlutterwaveCheckout({
                    public_key:      (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '',
                    tx_ref:          donateTxRef,
                    amount:          amount,
                    currency:        'NGN',
                    payment_options: 'card,banktransfer,ussd,mobilemoney,barter,nqr',
                    customer: { email: donorEmail, phone_number: donorPhone, name: donorName },
                    customizations: {
                        title:       'Empyrean — ' + (ctx.type === 'ngo' ? 'NGO Donation' : 'SOS Donation'),
                        description: 'Donation to ' + (ctx.username || 'SOS cause') + ' held in escrow',
                        logo:        'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
                    },
                    meta: {
                        source: ctx.type === 'ngo' ? 'ngo_donation' : 'sos_donation',
                        userId:    (_us().id) || 'guest',
                        sosUserId: ctx.userId || '',
                        sosPostId: ctx.postId || '',
                        ngoId:     ctx.type === 'ngo' ? (ctx.userId || '') : ''
                    },
                    callback: function(data) {
                        _restoreBtn();
                        if (data.status === 'successful' || data.status === 'completed') {
                            try {
                                if (_fbOk() && _db()) {
                                    _db().collection('flw_transactions').doc(donateTxRef).set({
                                        txRef: donateTxRef, flwRef: data.flw_ref || '',
                                        amount: amount, currency: 'NGN',
                                        purpose: ctx.type === 'ngo' ? 'ngo_donation' : 'sos_donation',
                                        status: 'held',
                                        donorName: donorName, donorEmail: donorEmail,
                                        donorUserId: (_us().id) || 'guest',
                                        recipientUserId: ctx.userId || '', recipientType: ctx.type || 'individual',
                                        sosPostId: ctx.postId || '', createdAt: _serverTs()
                                    }).catch(function() {});
                                }
                            } catch(err) {}
                            _notify('✅ Thank you! ₦' + amount.toLocaleString() + ' donated to '
                                + (ctx.username || 'this cause') + '. Held in escrow pending verification.', 'success');
                            window._sosDonationContext = null;
                            form.reset();
                            _closeModal();
                        } else {
                            _notify('Donation was not completed. Please try again.', 'error');
                        }
                    },
                    onclose: function() { _restoreBtn(); _notify('Payment window closed.', 'info'); }
                });
            } catch(flwErr) {
                _restoreBtn();
                _notify('Payment gateway error. Please try again.', 'error');
            }
        }

        if (typeof FlutterwaveCheckout !== 'undefined') {
            _launchFlutterwave();
        } else {
            _notify('Loading payment gateway…', 'info');
            var script    = document.createElement('script');
            script.src    = 'https://checkout.flutterwave.com/v3.js';
            script.onload = _launchFlutterwave;
            script.onerror = function() {
                _restoreBtn();
                _notify('Payment gateway unavailable. Please try again.', 'error');
            };
            document.head.appendChild(script);
        }
    });


    /* =========================================================================
       §19  ADMIN ACTION HANDLERS  (NEW)
       ========================================================================= */

    /* Approve / Reject an NGO application */
    window._approveNgoApplication = function(appId, action) {
        if (!_isAdmin()) { _notify('Admin access required.', 'error'); return; }
        if (!_fbOk() || !_db()) { _notify('Firebase not connected.', 'error'); return; }

        var newStatus   = action === 'approve' ? 'approved' : 'rejected';
        var updateData  = {
            status:     newStatus,
            reviewedBy: (_us().id)   || 'admin',
            reviewedAt: new Date().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}),
            reviewedTs: _serverTs()
        };

        _db().collection('ngo_applications').doc(appId).update(updateData)
            .then(function() {
                _notify('✅ NGO application ' + newStatus + ' successfully.', 'success');

                /* If approved: promote to ngo_partners collection */
                if (action === 'approve') {
                    _db().collection('ngo_applications').doc(appId).get()
                        .then(function(doc) {
                            if (!doc.exists) return;
                            var d = doc.data();
                            return _db().collection('ngo_partners').doc(appId).set({
                                id:                appId,
                                name:              d.orgName || '',
                                description:       d.mission || '',
                                sector:            d.sector  || '',
                                country:           d.country || '',
                                email:             d.email   || '',
                                phone:             d.phone   || '',
                                website:           d.website || '',
                                walletAddress:     d.walletAddress || '',
                                registrationNumber: d.regNumber || '',
                                documents:         d.documents || [],
                                isVerified:        true,
                                verifiedAt:        _serverTs(),
                                grantsTotal:       0,
                                stats: { raised: 0, projects: 0, peopleHelped: 0 }
                            }, { merge: true });
                        })
                        .then(function() {
                            _notify('✅ NGO added to verified partners directory.', 'success');
                            window._ngoPartnersLoaded = false;
                            _loadNgoPartners();
                        })
                        .catch(function(e) { console.warn('[NGO Approve] Partner record error:', e.message); });
                }

                /* Update card in DOM */
                var card = document.getElementById('ngo-app-' + appId);
                if (card) {
                    card.style.borderLeftColor = action === 'approve' ? '#22c55e' : '#ef4444';
                    var actionArea = card.querySelector('[style*="flex-direction:column"]');
                    if (actionArea) actionArea.innerHTML =
                        '<span style="font-size:0.78rem;font-weight:700;color:' + (action === 'approve' ? '#22c55e' : '#ef4444') + ';">'
                        + (action === 'approve' ? '✅ Approved' : '❌ Rejected') + '</span>';
                }
            })
            .catch(function(e) { _notify('Action failed: ' + e.message, 'error'); });
    };

    /* Request more information from NGO applicant */
    window._requestMoreNgoInfo = function(appId) {
        var note = prompt('Enter information request message (will be stored in the application record):');
        if (!note || !note.trim()) return;
        if (!_fbOk() || !_db()) { _notify('Firebase not connected.', 'error'); return; }

        _db().collection('ngo_applications').doc(appId).update({
            status:           'under_review',
            infoRequest:      note.trim(),
            infoRequestedAt:  _serverTs(),
            infoRequestedBy:  (_us().id) || 'admin'
        }).then(function() {
            _notify('Information request recorded for application ' + appId, 'info');
            renderNgoVerificationQueue();
        }).catch(function(e) { _notify('Error: ' + e.message, 'error'); });
    };

    /* =========================================================================
       Core disbursement executor — shared by the single "Disburse" button
       and the bulk "Disburse Selected" action, so both paths move real
       money the same way instead of the single-row button just flipping a
       Firestore status flag.

       Fiat methods (bank / mobile_money / flutterwave) route through the
       same window.initiateFlutterwavePayment used by the admin Initiate
       Disbursement panel (app-admin.js). Crypto wallet requests need a
       connected signer (MetaMask) per-transaction and can't be sent
       headless in a batch, so those are reported back as "needs manual
       crypto payout" rather than silently skipped or faked as sent.
       ========================================================================= */
    function _executeIndividualGrantDisbursement(grantId, d) {
        return new Promise(function(resolve, reject) {
            var method = (d.paymentMethod || 'bank').toLowerCase();

            if (method === 'crypto_wallet') {
                /* CRYPTO_HIDDEN_FOR_PLAY_STORE: this option is no longer offered on the
                   application form, but a record saved before this change may still
                   carry it — kept as a safe manual-review fallback rather than silently
                   dropping or misrouting an old request. */
                reject({ manual: true, message: 'This request was submitted for crypto payout, which is not currently available — please contact the applicant to arrange bank transfer or mobile money instead.' });
                return;
            }

            if (typeof window.initiateFlutterwavePayment !== 'function') {
                reject({ manual: false, message: 'Payment gateway not available. Please refresh and try again.' });
                return;
            }

            window.initiateFlutterwavePayment({
                amount:      d.amount || 0,
                currency:    d.currency || 'NGN',
                email:       d.email || (window.userState && window.userState.email) || 'admin@empyrean.com',
                name:        d.fullName || 'Individual Recipient',
                description: d.purpose || 'Individual Grant',
                purpose:     d.purpose || 'Individual Grant',
                onSuccess: function(response, txRef) {
                    var gid = _genGrantId();
                    _db().collection('disbursements').add({
                        grantId:         gid,
                        recipientId:     d.applicantId || grantId,
                        recipientName:   d.fullName     || 'Individual',
                        amount:          d.amount       || 0,
                        amountFormatted: _fmtAmount(d.amount, d.currency),
                        currency:        d.currency     || 'NGN',
                        purpose:         d.purpose      || 'Individual Grant',
                        mode:            'individual',
                        token:           d.currency     || 'NGN',
                        paymentMethod:   d.paymentMethod || '—',
                        txRef:           txRef,
                        flwRef:          response.flw_ref || '',
                        status:          'completed',
                        type:            'Individual',
                        adminId:         (_us().id) || 'admin',
                        createdAt:       _serverTs()
                    }).catch(function(e) { console.warn('[IndGrant] Ledger write error:', e.message); });

                    _db().collection('individual_grants').doc(grantId).update({
                        status:     'disbursed',
                        reviewedBy: (_us().id) || 'admin',
                        reviewedTs: _serverTs(),
                        txRef:      txRef
                    }).catch(function(e) { console.warn('[IndGrant] Status update error:', e.message); });

                    resolve({ txRef: txRef });
                },
                onFailure: function(res) { reject({ manual: false, message: res.message || 'Payment failed' }); },
                onClose:   function()    { reject({ manual: false, message: 'Payment window closed before completing' }); }
            });
        });
    }

    /* Approve / Disburse / Reject a single individual grant */
    window._approveIndividualGrant = function(grantId, action) {
        if (!_isAdmin()) { _notify('Admin access required.', 'error'); return; }
        if (!_fbOk() || !_db()) { _notify('Firebase not connected.', 'error'); return; }

        if (action === 'reject') {
            _db().collection('individual_grants').doc(grantId).update({
                status:     'rejected',
                reviewedBy: (_us().id) || 'admin',
                reviewedTs: _serverTs()
            }).then(function() {
                _notify('Individual grant rejected.', 'success');
                var card = document.getElementById('ind-grant-' + grantId);
                if (card) {
                    var actionArea = card.querySelector('[style*="display:flex;align-items:center;gap:10px"]');
                    if (actionArea) actionArea.innerHTML = _statusBadge('rejected');
                }
            }).catch(function(e) { _notify('Action failed: ' + e.message, 'error'); });
            return;
        }

        /* action === 'disburse' — actually send the money */
        _db().collection('individual_grants').doc(grantId).get().then(function(doc) {
            if (!doc.exists) { _notify('Grant not found.', 'error'); return; }
            var d = doc.data();
            var statusEl = document.getElementById('ind-grant-status-' + grantId);
            if (statusEl) statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing payment…';

            _executeIndividualGrantDisbursement(grantId, d)
                .then(function() {
                    _notify('✅ ' + (d.fullName || 'Recipient') + ' disbursed.', 'success');
                    renderGrantLedger();
                    var card = document.getElementById('ind-grant-' + grantId);
                    if (card) {
                        var actionArea = card.querySelector('[style*="display:flex;align-items:center;gap:10px"]');
                        if (actionArea) actionArea.innerHTML = _statusBadge('disbursed');
                    }
                    if (statusEl) statusEl.innerHTML = '';
                })
                .catch(function(err) {
                    var msg = (err && err.message) || 'Disbursement failed';
                    _notify('❌ ' + (d.fullName || 'Recipient') + ': ' + msg, 'error');
                    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger-color,#ef4444);"><i class="fas fa-exclamation-circle"></i> ' + _esc(msg) + '</span>';
                });
        }).catch(function(e) { _notify('Could not load grant: ' + e.message, 'error'); });
    };

    /* Bulk-disburse every checked row, one payment at a time so each
       recipient gets their own Flutterwave checkout / result, and a
       running summary is shown as it goes. */
    window._bulkDisburseIndividualGrants = async function() {
        if (!_isAdmin()) { _notify('Admin access required.', 'error'); return; }
        if (!_fbOk() || !_db()) { _notify('Firebase not connected.', 'error'); return; }

        var ids = Array.prototype.map.call(document.querySelectorAll('.ind-grant-chk:checked'), function(chk) { return chk.dataset.id; });
        if (!ids.length) return;

        var btn = document.getElementById('ind-grant-bulk-disburse-btn');
        var fb  = document.getElementById('ind-grant-bulk-feedback');
        function _setFb(msg, type) {
            if (!fb) return;
            fb.style.display    = 'block';
            fb.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)';
            fb.style.color      = type === 'error' ? 'var(--danger-color,#ef4444)' : type === 'success' ? '#22c55e' : '#d97706';
            fb.innerHTML        = msg;
        }
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing…'; }

        var done = 0, failed = 0, manual = 0;
        for (var i = 0; i < ids.length; i++) {
            var grantId  = ids[i];
            var statusEl = document.getElementById('ind-grant-status-' + grantId);
            _setFb('<i class="fas fa-circle-notch fa-spin"></i> Disbursing ' + (i + 1) + ' of ' + ids.length + '…', 'info');
            if (statusEl) statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing payment…';

            try {
                var doc = await _db().collection('individual_grants').doc(grantId).get();
                if (!doc.exists) { failed++; continue; }
                var d = doc.data();
                await _executeIndividualGrantDisbursement(grantId, d);
                done++;
                var card = document.getElementById('ind-grant-' + grantId);
                if (card) {
                    var actionArea = card.querySelector('[style*="display:flex;align-items:center;gap:10px"]');
                    if (actionArea) actionArea.innerHTML = _statusBadge('disbursed');
                }
                if (statusEl) statusEl.innerHTML = '<span style="color:#22c55e;"><i class="fas fa-check-circle"></i> Disbursed</span>';
            } catch (err) {
                if (err && err.manual) manual++; else failed++;
                var msg = (err && err.message) || 'Disbursement failed';
                if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger-color,#ef4444);"><i class="fas fa-exclamation-circle"></i> ' + _esc(msg) + '</span>';
            }
        }

        if (btn) { btn.innerHTML = '<i class="fas fa-paper-plane"></i> Disburse Selected'; }
        window._onIndividualGrantCheckChange();
        renderGrantLedger();

        var summary = '✅ ' + done + ' disbursed';
        if (manual) summary += ', ' + manual + ' need manual crypto payout';
        if (failed) summary += ', ' + failed + ' failed';
        _setFb(summary + '.', failed ? 'error' : (manual ? 'warning' : 'success'));
        _notify(summary + '.', failed ? 'error' : 'success');
    };

    /* =========================================================================
       Create Allocation tab — NGO picker, duplicate guard, offline queue
       ========================================================================= */
    var _ALLOC_QUEUE_KEY = 'emp_pending_allocations_v1';
    var _allocSaving     = false;
    var _allocFlushing   = false;
    var _allocNgos       = [];
    var _allocLastFp     = { key: '', at: 0 };

    function _allocSetFb(msg, type) {
        var fb = document.getElementById('alloc-feedback');
        if (!fb) return;
        fb.style.display    = 'block';
        fb.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : type === 'success' ? 'rgba(0,212,170,0.1)' : 'rgba(245,158,11,0.1)';
        fb.style.color      = type === 'error' ? 'var(--danger-color,#ef4444)' : type === 'success' ? 'var(--nav-accent,#00D4AA)' : '#d97706';
        fb.textContent      = msg;
    }

    function _allocQueueRead() {
        try {
            var a = JSON.parse(localStorage.getItem(_ALLOC_QUEUE_KEY) || '[]');
            return Array.isArray(a) ? a : [];
        } catch (e) { return []; }
    }
    function _allocQueueWrite(arr) {
        try { localStorage.setItem(_ALLOC_QUEUE_KEY, JSON.stringify(arr)); return true; }
        catch (e) { return false; }
    }
    function _allocRenderPending() {
        var el = document.getElementById('alloc-pending');
        if (!el) return;
        var n = _allocQueueRead().length;
        if (!n) { el.style.display = 'none'; el.innerHTML = ''; return; }
        el.style.display = 'flex';
        el.innerHTML = '<span><i class="fas fa-clock"></i> ' + n
            + ' allocation(s) saved on this device, waiting to upload.</span>'
            + '<button class="btn btn-small" onclick="window._allocFlushPending(true)">'
            + '<i class="fas fa-sync-alt"></i> Sync now</button>';
    }
    function _allocClientId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    function _allocIsNetworkError(e) {
        return !!e && (e.code === 'unavailable' || e.code === 'deadline-exceeded'
            || /network|offline|failed to fetch|timeout/i.test(e.message || ''));
    }

    /* Idempotent write: the doc id comes from clientRequestId, so a retry (or a
       write that actually landed after we gave up waiting) can never create a
       second record. */
    function _allocWrite(rec) {
        var data = Object.assign({}, rec, { createdAt: _serverTs() });
        return _db().collection('disbursements').doc('alloc_' + rec.clientRequestId).set(data);
    }

    window._allocFlushPending = function(announce) {
        if (_allocFlushing) return Promise.resolve();
        var q = _allocQueueRead();
        if (!q.length) { _allocRenderPending(); return Promise.resolve(); }
        if (!(_fbOk() && _db()) || navigator.onLine === false) {
            if (announce) _allocSetFb('Still offline — saved allocations will upload automatically once you are connected.', 'warning');
            return Promise.resolve();
        }
        _allocFlushing = true;
        var sent = 0;
        return q.reduce(function(chain, rec) {
            return chain.then(function() {
                return _allocWrite(rec).then(function() {
                    sent++;
                    _allocQueueWrite(_allocQueueRead().filter(function(r) {
                        return r.clientRequestId !== rec.clientRequestId;
                    }));
                }).catch(function() { /* leave it queued, retry later */ });
            });
        }, Promise.resolve()).then(function() {
            _allocFlushing = false;
            _allocRenderPending();
            if (sent) {
                _allocSetFb('✅ Uploaded ' + sent + ' saved allocation(s).', 'success');
                _notify('Uploaded ' + sent + ' saved grant allocation(s).', 'success');
                if (typeof renderGrantLedger === 'function') renderGrantLedger();
            } else if (announce) {
                _allocSetFb('Could not upload yet — will retry automatically.', 'error');
            }
        });
    };

    /* NGO partner dropdown (Firestore ngo_partners + mockNgoPartners fallback) */
    window._allocLoadNgoList = function(announce) {
        var sel = document.getElementById('alloc-ngo-id');
        if (!sel) return Promise.resolve();
        var prev = sel.value;
        sel.innerHTML = '<option value="">Loading NGO partners…</option>';
        var ngos = [];
        var fetchP = (_fbOk() && _db())
            ? _db().collection('ngo_partners').limit(100).get().then(function(snap) {
                snap.forEach(function(doc) {
                    var d = doc.data() || {};
                    ngos.push({ id: doc.id, name: d.name || d.orgName || doc.id });
                });
            }).catch(function() {})
            : Promise.resolve();
        return fetchP.then(function() {
            if (window.mockNgoPartners && typeof window.mockNgoPartners === 'object') {
                Object.keys(window.mockNgoPartners).forEach(function(k) {
                    var n = window.mockNgoPartners[k] || {};
                    var id = n.id || k;
                    if (!ngos.some(function(x) { return x.id === id; })) ngos.push({ id: id, name: n.name || id });
                });
            }
            ngos.sort(function(a, b) { return String(a.name).localeCompare(String(b.name)); });
            _allocNgos = ngos;
            sel.innerHTML = '<option value="">' + (ngos.length ? '— Select NGO partner —' : 'No NGO partners found') + '</option>'
                + ngos.map(function(n) {
                    return '<option value="' + _esc(n.id) + '">' + _esc(n.name) + '</option>';
                }).join('');
            if (prev && ngos.some(function(n) { return n.id === prev; })) sel.value = prev;
            if (announce) {
                _allocSetFb(ngos.length ? '✅ Loaded ' + ngos.length + ' NGO partner(s).'
                                        : 'No NGO partners found. Register partners first.',
                            ngos.length ? 'success' : 'warning');
            }
        });
    };

    function _wireAllocationForm() {
        var typeSel = document.getElementById('alloc-recipient-type');
        var ngoSel  = document.getElementById('alloc-ngo-id');
        var nameInp = document.getElementById('alloc-recipient-name');

        function syncType() {
            var wrap  = document.getElementById('alloc-ngo-wrap');
            var isNgo = !typeSel || typeSel.value === 'ngo';
            if (wrap) wrap.style.display = isNgo ? '' : 'none';
            if (!isNgo && ngoSel) ngoSel.value = '';
        }
        if (typeSel) typeSel.addEventListener('change', syncType);

        /* Picking an NGO fills the recipient name (unless the admin typed their own) */
        if (ngoSel && nameInp) ngoSel.addEventListener('change', function() {
            var opt  = ngoSel.selectedOptions && ngoSel.selectedOptions[0];
            var auto = ngoSel.dataset.autoName || '';
            if (!ngoSel.value) {
                if (nameInp.value === auto) nameInp.value = '';
                ngoSel.dataset.autoName = '';
                return;
            }
            if (!nameInp.value.trim() || nameInp.value === auto) {
                nameInp.value = opt ? opt.textContent : '';
                ngoSel.dataset.autoName = nameInp.value;
            }
        });

        syncType();
        window._allocLoadNgoList();
        _allocRenderPending();
        if (!window._allocOnlineBound) {
            window._allocOnlineBound = true;
            window.addEventListener('online', function() { window._allocFlushPending(); });
        }
        window._allocFlushPending();
    }

    /* Create a new grant allocation from the admin panel */
    window._createGrantAllocation = function() {
        if (_allocSaving) return;   /* already saving — ignore extra taps */

        var recipType = (document.getElementById('alloc-recipient-type') || {}).value || 'ngo';
        var amount    = parseFloat((document.getElementById('alloc-amount')   || {}).value || '0');
        var currency  = (document.getElementById('alloc-currency')            || {}).value || 'NGN';
        var purpose   = (document.getElementById('alloc-purpose')             || {}).value || '';
        var ngoSel    = document.getElementById('alloc-ngo-id');
        var ngoId     = recipType === 'ngo' && ngoSel ? (ngoSel.value || '') : '';
        var ngoOpt    = ngoSel && ngoSel.selectedOptions && ngoSel.selectedOptions[0];
        var ngoName   = ngoId && ngoOpt ? ngoOpt.textContent : '';
        var recipName = (document.getElementById('alloc-recipient-name')      || {}).value || '';
        var wallet    = (document.getElementById('alloc-wallet')              || {}).value || '';
        var bankAcct  = (document.getElementById('alloc-bank-account')        || {}).value || '';
        var disbDate  = (document.getElementById('alloc-disbursement-date')   || {}).value || '';
        var notes     = (document.getElementById('alloc-notes')               || {}).value || '';

        if (!amount || amount < 1) { _allocSetFb('⚠ Invalid amount.', 'error'); return; }
        if (!purpose.trim())       { _allocSetFb('⚠ Purpose is required.', 'error'); return; }
        if (!recipName.trim())     { _allocSetFb('⚠ Recipient name is required.', 'error'); return; }
        if (recipType === 'ngo' && _allocNgos.length && !ngoId) {
            _allocSetFb('⚠ Select the NGO partner this grant is for.', 'error'); return;
        }

        /* Same allocation submitted again within 5 minutes? Ask first. */
        var fp = [recipType, ngoId, recipName.trim().toLowerCase(), amount, currency, purpose.trim().toLowerCase()].join('|');
        if (fp === _allocLastFp.key && Date.now() - _allocLastFp.at < 5 * 60 * 1000) {
            if (!window.confirm('An identical allocation (' + _fmtAmount(amount, currency) + ' to '
                + recipName.trim() + ') was just created. Create another one?')) return;
        }

        var rec = {
            clientRequestId: _allocClientId(),
            grantId:        _genGrantId(),
            type:           recipType === 'ngo' ? 'NGO' : 'Individual',
            ngoId:          ngoId || null,
            ngoName:        ngoName || null,
            recipientName:  recipName.trim(),
            amount:         amount,
            amountFormatted: _fmtAmount(amount, currency),
            currency:       currency,
            purpose:        purpose.trim(),
            walletAddress:  wallet.trim() || null,
            bankAccount:    bankAcct.trim() || null,
            scheduledDate:  disbDate || null,
            adminNotes:     notes.trim() || null,
            status:         'approved',
            createdBy:      (_us().id) || 'admin'
        };

        var btn = document.getElementById('alloc-create-btn');
        _allocSaving = true;
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        function _unlock() {
            _allocSaving = false;
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        }
        function _clearForm() {
            ['alloc-amount', 'alloc-purpose', 'alloc-recipient-name', 'alloc-bank-account',
             'alloc-disbursement-date', 'alloc-notes'].forEach(function(id) {
                var el = document.getElementById(id); if (el) el.value = '';
            });
            if (ngoSel) { ngoSel.value = ''; ngoSel.dataset.autoName = ''; }
        }
        function _onSaved() {
            _allocLastFp = { key: fp, at: Date.now() };
            _clearForm();
            _allocSetFb('✅ Grant allocation created. ID: ' + rec.grantId, 'success');
            if (typeof renderGrantLedger === 'function') renderGrantLedger();
            _notify('Grant allocation created: ' + rec.grantId, 'success');
            _unlock();
        }
        function _queueLocally() {
            var q = _allocQueueRead();
            rec.queuedAt = new Date().toISOString();
            q.push(rec);
            if (_allocQueueWrite(q)) {
                _allocLastFp = { key: fp, at: Date.now() };
                _clearForm();
                _allocRenderPending();
                _allocSetFb('📥 No connection. Allocation ' + rec.grantId + ' is saved on this device and will upload '
                    + 'automatically when you are back online. Keep this browser open.', 'warning');
            } else {
                _allocSetFb('❌ No connection and this browser could not store a local copy. Nothing was saved — please try again when online.', 'error');
            }
            _unlock();
        }

        if (_fbOk() && _db() && navigator.onLine !== false) {
            /* Don't hang forever on a bad connection: after 15s fall back to the local
               queue. The write is idempotent (fixed doc id), so if it still lands later
               the queued retry just overwrites the same record. */
            var timeout = new Promise(function(_, reject) {
                setTimeout(function() { var e = new Error('timeout'); e.code = 'unavailable'; reject(e); }, 15000);
            });
            Promise.race([_allocWrite(rec), timeout])
                .then(_onSaved)
                .catch(function(e) {
                    if (_allocIsNetworkError(e)) { _queueLocally(); return; }
                    _allocSetFb('❌ Failed: ' + ((e && e.message) || 'Unknown error'), 'error');
                    _unlock();
                });
        } else {
            _queueLocally();
        }
    };

    /* Export grant ledger as CSV/JSON. Mirrors renderGrantLedger()/
       _renderLedgerRows() exactly — same two Firestore streams merged
       (disbursements + SOS-empowerment sponsorship_proposals), same
       _ledgerTypeBucket() call to decide which of the three disbursement
       columns (NGO / Individual / SOS) an amount belongs in — so what a
       person exports to Excel always matches what's on screen. Previously
       this only queried 'disbursements', so every SOS-empowerment row
       silently never made it into the export. */
    window._exportGrantReport = function(format) {
        format = format || 'csv';

        if (!_fbOk() || !_db()) {
            /* Export mock data */
            _exportFromData(_toExportRows(_ledger()), format);
            return;
        }

        var disbursementsP = _db().collection('disbursements')
            .orderBy('createdAt', 'desc').limit(500).get()
            .then(function(snap) {
                var entries = [];
                snap.forEach(function(doc) {
                    var d = doc.data();
                    entries.push({
                        id:       d.grantId || doc.id,
                        ngo:      d.recipientName || d.ngoName || '—',
                        project:  d.purpose || d.projectName || '—',
                        amount:   d.amountFormatted || _fmtAmount(d.amount, d.currency || 'NGN'),
                        currency: d.currency || d.token || 'NGN',
                        txHash:   d.txHash || d.txRef || '',
                        status:   d.status || 'completed',
                        type:     d.type || 'NGO',
                        date:     d.createdAt && d.createdAt.toDate
                            ? d.createdAt.toDate().toISOString().split('T')[0]
                            : '—'
                    });
                });
                return entries;
            })
            .catch(function() { return []; });

        var sosEmpowermentP = _db().collection('sponsorship_proposals')
            .where('targetType', '==', 'sos')
            .where('status', 'in', ['funded', 'completed'])
            .limit(200).get()
            .then(function(snap) {
                var entries = [];
                snap.forEach(function(doc) {
                    var d   = doc.data() || {};
                    var ts  = d.decidedAt || d.fundedAt || d.createdAt;
                    var amt = (d.amountFunded != null ? d.amountFunded : d.pledgedAmount) || 0;
                    entries.push({
                        id:       'SOS-' + doc.id.slice(-6).toUpperCase(),
                        ngo:      d.targetLabel || 'SOS Individual Request',
                        project:  'SOS Empowerment' + (d.donorName ? ' — via ' + d.donorName : ''),
                        amount:   _fmtAmount(amt, d.currency || 'NGN'),
                        currency: d.currency || 'NGN',
                        txHash:   '',
                        status:   d.status === 'completed' ? 'completed' : 'disbursed',
                        type:     'SOS',
                        date:     ts && ts.toDate ? ts.toDate().toISOString().split('T')[0] : '—'
                    });
                });
                return entries;
            })
            .catch(function() { return []; });

        Promise.all([disbursementsP, sosEmpowermentP]).then(function(results) {
            var merged = results[0].concat(results[1]);
            var rows = _toExportRows(merged);
            _exportFromData(rows, format);
            _notify('✅ Export ready — ' + rows.length + ' records.', 'success');
        }).catch(function(e) { _notify('Export failed: ' + (e && e.message), 'error'); });
    };

    /* Shared row-shaping step: buckets every record into its NGO/Individual/
       SOS amount column exactly the way _renderLedgerRows() does on screen,
       so the exported spreadsheet and the live table can never disagree. */
    function _toExportRows(entries) {
        return (entries || []).map(function(g) {
            var bucket = _ledgerTypeBucket(g.type);
            return {
                grantId:          g.id || '—',
                recipient:        g.ngo || '—',
                project:          g.project || '—',
                ngoAmount:        bucket === 'ngo'        ? (g.amount || '—') : '',
                individualAmount: bucket === 'individual' ? (g.amount || '—') : '',
                sosAmount:        bucket === 'sos'         ? (g.amount || '—') : '',
                currency:         g.currency || '—',
                status:           g.status || '—',
                type:             g.type || '—',
                date:             g.date || '—'
            };
        });
    }

    function _exportFromData(data, format) {
        if (!data || !data.length) { _notify('No data to export.', 'info'); return; }

        if (format === 'json') {
            var jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            _downloadBlob(jsonBlob, 'empyrean-grant-ledger-' + Date.now() + '.json');
            return;
        }

        if (format === 'pdf') {
            _notify('PDF generation requires the print dialog. Use CSV for programmatic use.', 'info');
            window.print();
            return;
        }

        /* CSV — one column per disbursement type (NGO/Individual/SOS), same
           split as the on-screen ledger table, so it opens straight into
           Excel ready for pivot tables without further reshaping. */
        var keys   = ['grantId','recipient','project','ngoAmount','individualAmount','sosAmount','currency','status','type','date'];
        var labels = ['Grant ID','Recipient','Project','NGO Grant Disbursement','Individual Disbursement','SOS Empowerment','Currency','Status','Disbursement Type','Date'];
        var header = labels.map(function(l) { return '"' + l.replace(/"/g, '""') + '"'; }).join(',');
        var csvRows = data.map(function(row) {
            return keys.map(function(k) {
                var val = String(row[k] !== undefined ? row[k] : '').replace(/"/g, '""');
                return '"' + val + '"';
            }).join(',');
        });
        var csv  = [header].concat(csvRows).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        _downloadBlob(blob, 'empyrean-grant-ledger-' + Date.now() + '.csv');
    }

    function _downloadBlob(blob, filename) {
        var url  = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href     = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(function() { document.body.removeChild(link); URL.revokeObjectURL(url); }, 1000);
    }


    /* =========================================================================
       §20  REAL-TIME FIRESTORE LISTENERS  (NEW)
       ========================================================================= */

    var _ngoListeners = [];

    function _startRealTimeListeners() {
        if (!_fbOk() || !_db()) return;

        /* Listen for new disbursements → update ledger row count badge */
        try {
            var unsubDisburse = _db().collection('disbursements')
                .orderBy('createdAt', 'desc')
                .limit(1)
                .onSnapshot(function(snap) {
                    snap.docChanges().forEach(function(change) {
                        if (change.type === 'added') {
                            /* Append to ledger if the table is visible */
                            var tbody = document.getElementById('grant-ledger-body');
                            if (tbody && !document.hidden) {
                                renderGrantLedger();
                            }
                        }
                    });
                }, function(e) { console.warn('[NGO Listener] Disbursement snapshot error:', e.message); });
            _ngoListeners.push(unsubDisburse);
        } catch(e) {}

        /* Listen for NGO application status changes */
        try {
            var unsubApps = _db().collection('ngo_applications')
                .where('status', '==', 'pending')
                .onSnapshot(function(snap) {
                    var badge = document.getElementById('ngo-pending-badge');
                    if (badge) badge.textContent = snap.size || '';
                    if (snap.size > 0) badge && (badge.style.display = 'inline-flex');
                }, function() {});
            _ngoListeners.push(unsubApps);
        } catch(e) {}
    }

    /* Clean up listeners on logout */
    document.addEventListener('empyrean-logout', function() {
        _ngoListeners.forEach(function(unsub) { try { unsub(); } catch(e) {} });
        _ngoListeners = [];
        window._ngoPartnersLoaded = false;
    });


    /* =========================================================================
       §21  BOOTSTRAP
       ========================================================================= */

    document.addEventListener('empyrean-init-done', function() {
        setTimeout(function() {
            _loadNgoPartners();
            renderGrantLedger();
            renderCommunityTasks();
            renderNgoGrid();
            _loadIndAcctFormState();
            _renderIndAcctBanner();
            _indAcctHandleInviteLanding();
            if (typeof window.renderGrantDashboard === 'function' && document.getElementById('grant-dashboard-container')) {
                renderGrantDashboard();
            }
        }, 500);
    });

    /* Re-render banner every time user navigates to dashboard.
       Two timeouts: 300ms for fast renders, 1000ms for slow Firebase. */
    document.addEventListener('empyrean-section-change', function(ev) {
        if (ev && ev.detail && ev.detail.section === 'dashboard') {
            setTimeout(_renderIndAcctBanner, 300);
            setTimeout(_renderIndAcctBanner, 1000);
        }
    });

    /* If Firebase wasn't ready at init-done, start the listener as soon as it is */
    window.addEventListener('empyrean:firebase-ready', function() {
        setTimeout(_startIndAcctListener, 300);
    });

    document.addEventListener('empyrean-user-ready', function() {
        setTimeout(function() {
            window._ngoPartnersLoaded = false;
            _loadNgoPartners();
            renderCommunityTasks();
            _startRealTimeListeners();
            /* Admin-only panels */
            if (_isAdmin()) {
                if (document.getElementById('ngo-verification-queue-container')) renderNgoVerificationQueue();
                if (document.getElementById('individual-grant-panel-container'))  renderIndividualGrantPanel();
                if (document.getElementById('admin-grant-control-container'))     renderAdminGrantControlPanel();
            }
        }, 700);
    });

    /* Also hook into the existing admin disburse tab switch (app-admin.js compatibility) */
    var _origSwitchAdminTab = window._switchAdminTab;
    window._switchAdminTab = function(targetId) {
        if (typeof _origSwitchAdminTab === 'function') _origSwitchAdminTab(targetId);
        if (targetId === 'admin-disburse-tab') {
            setTimeout(function() {
                if (document.getElementById('admin-grant-control-container')) renderAdminGrantControlPanel();
            }, 100);
        }
    };

    console.log('[EmpNgo v2] ✅ NGO & Grant Disbursement Portal ready. Debug: window._empyreanDebug()');

})();