/* =============================================================================
   EMPYREAN INTERNATIONAL — BULK CSV/EXCEL DISBURSEMENT (frontend card)
   app-bulk-disburse.js  |  standalone module

   This is the UI half of bulk-disburse-routes.js. The backend endpoints
   (/api/admin/bulk-disburse/upload, /:id/execute, /:id/status,
   /:id/failed-csv) already exist and are already mounted in server.js —
   this file is what was missing: nothing in the browser ever called them.

   Mounts into #bulk-disburse-panel-container, which lives inside the
   "Individual Grants" tab (agc-2) of the Grant Disbursement Control Panel.
   Rendered by window.renderBulkDisbursePanel(), called from app-ngo.js's
   admin-grant-tab click handler whenever that tab opens.

   Flow: pick file -> POST /upload (validates only, no money moves) ->
   show preview (valid/invalid counts, total amount, sample errors) ->
   admin clicks Confirm -> POST /:id/execute -> poll /:id/status every 2s
   until done -> offer /:id/failed-csv download for any rows that failed.

   LOAD ORDER: after firebase-init, app-ngo.js (uses its container + tab hook).
   ============================================================================= */

(function empyreanBulkDisburseModule() {
    'use strict';

    if (window._empyreanBulkDisburseLoaded) {
        console.warn('[BulkDisburse] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanBulkDisburseLoaded = true;

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _apiBase() {
        // Same Render backend the rest of the app already talks to
        // (see _agoraApiBase() in app-fixes.js for the sibling pattern).
        return window._empApiBase() + '/api/admin/bulk-disburse';
    }

    function _fmtNaira(n) {
        return '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 });
    }

    function _getIdToken() {
        if (!window.fbAuth || !window.fbAuth.currentUser) {
            return Promise.reject(new Error('Not signed in as admin.'));
        }
        return window.fbAuth.currentUser.getIdToken();
    }

    function _authedFetch(url, opts) {
        opts = opts || {};
        return _getIdToken().then(function (token) {
            opts.headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + token });
            return fetch(url, opts);
        });
    }

    // Module-local state for the batch currently in flight.
    var _state = { batchId: null, pollTimer: null };

    /* ---- rendering ---------------------------------------------------------- */

    function renderBulkDisbursePanel() {
        var container = document.getElementById('bulk-disburse-panel-container');
        if (!container) return;

        container.innerHTML =
            '<div class="card" style="margin-bottom:16px;background:rgba(0,212,170,0.05);border:1px solid rgba(0,212,170,0.18);">'
            + '<div class="card-content" style="padding:16px;">'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
            + '<i class="fas fa-file-csv" style="color:var(--nav-accent,#00D4AA);font-size:1.1rem;"></i>'
            + '<strong style="font-size:0.95rem;">Import Beneficiary List (CSV / Excel)</strong>'
            + '</div>'
            + '<p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 12px;">'
            + 'Upload a .csv, .xlsx, or .xls file with columns for name, account number, bank name, and amount. '
            + 'Nothing is sent until you review the preview and confirm.</p>'
            + '<div id="bd-drop-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
            + '<input type="file" id="bd-file-input" accept=".csv,.xlsx,.xls" style="flex:1;min-width:220px;font-size:0.85rem;">'
            + '<button class="btn btn-small btn-accent" id="bd-upload-btn" onclick="window._bdUploadFile()">'
            + '<i class="fas fa-upload"></i> Upload &amp; Validate</button>'
            + '</div>'
            + '<div id="bd-feedback" style="display:none;margin-top:12px;padding:10px 14px;border-radius:10px;font-size:0.85rem;"></div>'
            + '<div id="bd-preview" style="display:none;margin-top:14px;"></div>'
            + '<div id="bd-progress" style="display:none;margin-top:14px;"></div>'
            + '</div></div>';
    }
    window.renderBulkDisbursePanel = renderBulkDisbursePanel;

    function _feedback(msg, type) {
        var el = document.getElementById('bd-feedback');
        if (!el) return;
        var colors = {
            error:   ['#fee2e2', '#991b1b'],
            success: ['rgba(0,212,170,0.12)', '#0f766e'],
            info:    ['rgba(59,130,246,0.1)', '#1d4ed8']
        };
        var c = colors[type] || colors.info;
        el.style.display    = 'block';
        el.style.background = c[0];
        el.style.color      = c[1];
        el.innerHTML = _esc(msg);
    }

    /* ---- step 1: upload + validate ------------------------------------------ */

    window._bdUploadFile = function () {
        var input = document.getElementById('bd-file-input');
        var file  = input && input.files && input.files[0];
        if (!file) { _feedback('Choose a CSV or Excel file first.', 'error'); return; }

        var btn = document.getElementById('bd-upload-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Validating…'; }
        _feedback('Validating rows and matching bank names…', 'info');
        document.getElementById('bd-preview').style.display = 'none';
        document.getElementById('bd-progress').style.display = 'none';

        var fd = new FormData();
        fd.append('file', file);

        _authedFetch(_apiBase() + '/upload', { method: 'POST', body: fd })
            .then(function (r) {
                return r.json().then(function (data) {
                    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                    return data;
                });
            })
            .then(function (data) {
                _state.batchId = data.batchId;
                _feedback('Validated ' + data.totalRows + ' row(s).', 'success');
                _renderPreview(data);
            })
            .catch(function (err) {
                _feedback('Upload failed: ' + (err.message || 'Unknown error'), 'error');
            })
            .finally(function () {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Upload &amp; Validate'; }
            });
    };

    function _renderPreview(data) {
        var el = document.getElementById('bd-preview');
        if (!el) return;

        var errRows = (data.sampleErrors || []).map(function (r) {
            return '<tr><td style="padding:6px 10px;">' + r.row + '</td>'
                + '<td style="padding:6px 10px;">' + _esc(r.name || '—') + '</td>'
                + '<td style="padding:6px 10px;color:#991b1b;">' + _esc((r.errors || []).join('; ')) + '</td></tr>';
        }).join('');

        el.innerHTML =
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:12px;">'
            + _statCard('Total Rows', data.totalRows, '#3B82F6')
            + _statCard('Valid', data.validRows, '#22c55e')
            + _statCard('Invalid', data.invalidRows, data.invalidRows ? '#ef4444' : '#94a3b8')
            + _statCard('Total Amount', _fmtNaira(data.totalAmount), '#C9A66B')
            + '</div>'
            + (errRows
                ? '<div style="max-height:220px;overflow:auto;border:1px solid rgba(10,14,39,0.1);border-radius:10px;margin-bottom:12px;">'
                + '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;">'
                + '<thead><tr style="background:rgba(10,14,39,0.04);text-align:left;">'
                + '<th style="padding:6px 10px;">Row</th><th style="padding:6px 10px;">Name</th><th style="padding:6px 10px;">Error(s)</th>'
                + '</tr></thead><tbody>' + errRows + '</tbody></table></div>'
                : '')
            + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
            + (data.validRows > 0
                ? '<button class="btn btn-small" style="background:#22c55e;color:#fff;" onclick="window._bdConfirmExecute(' + data.validRows + ',\'' + _esc(_fmtNaira(data.totalAmount)) + '\')">'
                + '<i class="fas fa-paper-plane"></i> Confirm &amp; Send ' + data.validRows + ' Payment(s)</button>'
                : '<span style="font-size:0.82rem;color:var(--text-muted);">No valid rows to disburse — fix the errors above and re-upload.</span>')
            + '</div>';
        el.style.display = 'block';
    }

    function _statCard(label, value, color) {
        return '<div style="background:rgba(10,14,39,0.03);border-radius:10px;padding:10px 12px;">'
            + '<div style="font-size:0.7rem;color:var(--text-muted);font-weight:700;letter-spacing:0.04em;">' + label.toUpperCase() + '</div>'
            + '<div style="font-size:1.05rem;font-weight:800;color:' + color + ';">' + _esc(value) + '</div></div>';
    }

    /* ---- step 2: confirm + execute ------------------------------------------ */

    window._bdConfirmExecute = function (validCount, totalAmountStr) {
        if (!_state.batchId) return;
        var ok = window.confirm(
            'This will send real payments to ' + validCount + ' recipient(s) totalling ' + totalAmountStr + '. '
            + 'This cannot be undone. Continue?'
        );
        if (!ok) return;

        _feedback('Starting batch — payments are being submitted…', 'info');
        document.getElementById('bd-preview').style.display = 'none';

        _authedFetch(_apiBase() + '/' + _state.batchId + '/execute', { method: 'POST' })
            .then(function (r) {
                return r.json().then(function (data) {
                    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                    return data;
                });
            })
            .then(function () {
                _startPolling();
            })
            .catch(function (err) {
                _feedback('Could not start batch: ' + (err.message || 'Unknown error'), 'error');
            });
    };

    /* ---- step 3: poll status -------------------------------------------------- */

    function _startPolling() {
        var progEl = document.getElementById('bd-progress');
        progEl.style.display = 'block';
        _renderProgress({ status: 'processing', processed: 0, succeeded: 0, failed: 0, validRows: 0, totalRows: 0 });

        function poll() {
            _authedFetch(_apiBase() + '/' + _state.batchId + '/status')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    _renderProgress(data);
                    if (data.status === 'processing') {
                        _state.pollTimer = setTimeout(poll, 2000);
                    } else {
                        clearTimeout(_state.pollTimer);
                        if (data.status === 'completed') {
                            _feedback('Batch complete — ' + data.succeeded + ' succeeded, ' + data.failed + ' failed.',
                                data.failed ? 'info' : 'success');
                        } else if (data.status === 'error') {
                            _feedback('Batch failed: ' + (data.error || 'Unknown error'), 'error');
                        }
                        if (data.failed > 0 || data.invalidRowsAtUpload) {
                            _renderFailedDownload();
                        }
                    }
                })
                .catch(function (err) {
                    clearTimeout(_state.pollTimer);
                    _feedback('Lost connection while polling status: ' + (err.message || 'Unknown error'), 'error');
                });
        }
        poll();
    }

    function _renderProgress(data) {
        var el = document.getElementById('bd-progress');
        if (!el) return;
        var pct = data.validRows ? Math.round((data.processed / data.validRows) * 100) : 0;
        el.innerHTML =
            '<div style="font-size:0.82rem;font-weight:700;margin-bottom:6px;">'
            + (data.status === 'processing' ? 'Processing…' : data.status === 'completed' ? 'Completed' : 'Error')
            + ' — ' + data.processed + ' / ' + data.validRows + '</div>'
            + '<div style="background:rgba(10,14,39,0.08);border-radius:8px;height:10px;overflow:hidden;">'
            + '<div style="background:var(--nav-accent,#00D4AA);height:100%;width:' + pct + '%;transition:width .3s;"></div></div>'
            + '<div style="display:flex;gap:16px;margin-top:8px;font-size:0.8rem;">'
            + '<span style="color:#22c55e;"><i class="fas fa-check-circle"></i> ' + data.succeeded + ' succeeded</span>'
            + '<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> ' + data.failed + ' failed</span>'
            + '</div>'
            + '<div id="bd-failed-dl"></div>';
    }

    function _renderFailedDownload() {
        var el = document.getElementById('bd-failed-dl');
        if (!el || !_state.batchId) return;
        _getIdToken().then(function (token) {
            // Direct link download can't carry a bearer header, so fetch as a
            // blob and trigger the save client-side instead.
            el.innerHTML = '<button class="btn btn-small" style="margin-top:10px;" onclick="window._bdDownloadFailed()">'
                + '<i class="fas fa-download"></i> Download Failed/Invalid Rows CSV</button>';
        });
    }

    window._bdDownloadFailed = function () {
        if (!_state.batchId) return;
        _authedFetch(_apiBase() + '/' + _state.batchId + '/failed-csv')
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.blob();
            })
            .then(function (blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'failed-disbursements-' + _state.batchId + '.csv';
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            })
            .catch(function (err) {
                _feedback('Could not download failed rows: ' + (err.message || 'Unknown error'), 'error');
            });
    };

})();