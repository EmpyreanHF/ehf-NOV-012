/* =============================================================================
   EMPYREAN INTERNATIONAL — BULK CSV DISBURSEMENT (backend)
   bulk-disburse-routes.js  |  Node/Express router. Mount in server.js.

   This is the server-to-server half the frontend card in app-bulk-disburse.js
   (previously uploaded under this same filename by mistake — that file is the
   UI card, this one is the actual backend) talks to. It is the ONLY place
   FLW_SECRET_KEY is used for disbursement — it never reaches the browser.

   Uses Flutterwave's TRANSFERS API (POST /v3/transfers), not the Checkout
   popup — Transfers is the server-side "push money out" endpoint and is the
   only one that can run unattended in a loop. Checkout is payer-facing
   "pull money in" and requires a human click per transaction, which is why
   it can't be reused for this.

   Endpoints (all require a Firebase ID token for an admin user):
     POST /upload            multipart CSV -> validates, returns a preview.
                              No money moves here.
     POST /:id/execute       fires the batch in the background.
     GET  /:id/status        poll progress.
     GET  /:id/failed-csv    download failed/invalid rows for re-upload.

   Known limitation: Flutterwave transfers are asynchronous on their end —
   a "success" response here means the transfer was ACCEPTED for processing,
   not that it has settled. Final settlement (and any later reversal) arrives
   via Flutterwave's transfer webhook, which this file does not implement.
   If/when a webhook route exists, it should update the matching
   `disbursements` doc (keyed by txRef) rather than trusting this response
   as final. Said plainly in the code so it isn't mistaken for done-done.
   ============================================================================= */

'use strict';

const express = require('express');
const multer  = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap — plenty for 10k rows either format
    fileFilter: (req, file, cb) => {
        const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname || '');
        cb(ok ? null : new Error('Only .csv, .xlsx, or .xls files are accepted'), ok);
    }
});

// Same two admin identities firebase-rules.js's isAdmin() trusts, plus the
// `admin: true` custom claim path. Mirrored here on purpose — the browser's
// Firestore rules and this server endpoint must agree on who's an admin,
// since this route (unlike a Firestore write) can actually send money.
const ADMIN_EMAILS = ['chiefadmin@empyreanhumanitarianfoundation.com', 'admin@empyrean.com'];

const MAX_ROWS = 10000;
const CONCURRENCY = 5;          // simultaneous Flutterwave calls in flight
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
const BATCH_TTL_MS = 48 * 60 * 60 * 1000; // keep finished batches around 48h for status/CSV re-download

// In-memory batch store. Fine for a single Render instance (this app's
// current render.yaml defines exactly one web service); if this ever scales
// to multiple instances, batches need to move to Firestore/Redis so any
// instance can serve /status and /execute for the same batchId.
const _batches = new Map();

const HEADER_SYNONYMS = {
    name:           ['name', 'beneficiary_name', 'full_name', 'recipient_name'],
    account_number: ['account_number', 'account_no', 'acct_number', 'accountnumber', 'account'],
    bank_name:      ['bank_name', 'bank', 'bankname'],
    bank_code:      ['bank_code', 'bankcode'],
    amount:         ['amount', 'amt'],
    currency:       ['currency', 'curr'],
    purpose:        ['purpose', 'narration', 'description']
};

// Common Nigerian fintech/bank aliases that don't literally substring-match
// Flutterwave's official bank list names. Best-effort — anything not caught
// here still gets a fuzzy substring match below, and anything that STILL
// doesn't match shows up as an invalid row with the raw text so an admin can
// fix the CSV rather than the transfer silently going to the wrong bank.
const BANK_ALIASES = {
    'GTBANK': 'GUARANTY TRUST BANK', 'GTB': 'GUARANTY TRUST BANK',
    'UBA': 'UNITED BANK FOR AFRICA',
    'FIRST BANK': 'FIRST BANK OF NIGERIA', 'FIRSTBANK': 'FIRST BANK OF NIGERIA',
    'OPAY': 'PAYCOM',
    'MONIEPOINT': 'MONIEPOINT MICROFINANCE BANK',
    'KUDA': 'KUDA MICROFINANCE BANK',
    'ZENITH': 'ZENITH BANK',
    'ACCESS': 'ACCESS BANK',
    'STERLING': 'STERLING BANK',
    'FIDELITY': 'FIDELITY BANK',
    'UNION BANK': 'UNION BANK OF NIGERIA',
    'POLARIS': 'POLARIS BANK',
    'WEMA': 'WEMA BANK',
    'STANBIC': 'STANBIC IBTC BANK',
    'ECOBANK': 'ECOBANK NIGERIA',
    'FCMB': 'FIRST CITY MONUMENT BANK'
};

/* ---- small helpers ------------------------------------------------------ */

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _escCsv(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }

// Minimal RFC4180 CSV parser — handles quoted fields, embedded commas, and
// escaped "" quotes, without pulling in a dependency for something this
// small. Not a general CSV library; just enough for name/account/bank/amount
// rows.
function _parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\r') {
            // skip — \n (handled next) closes the row
        } else if (c === '\n') {
            row.push(field); rows.push(row); row = []; field = '';
        } else {
            field += c;
        }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function _buildHeaderIndex(headerRow) {
    const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '_');
    const rawIdx = {};
    headerRow.forEach((h, i) => { rawIdx[norm(h)] = i; });
    const idx = {};
    for (const canon in HEADER_SYNONYMS) {
        for (const syn of HEADER_SYNONYMS[canon]) {
            if (rawIdx[syn] != null) { idx[canon] = rawIdx[syn]; break; }
        }
    }
    return idx;
}

function _normalizeBankName(name) {
    return String(name || '')
        .toUpperCase()
        .replace(/\bPLC\b|\bLIMITED\b|\bLTD\b|\bNIGERIA\b|\bMICROFINANCE\b|\bMFB\b|\bBANK\b/g, '')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
}

function _resolveBankCode(bankNameRaw, bankList) {
    if (!bankNameRaw) return null;
    let bankName = String(bankNameRaw).trim();
    const alias = BANK_ALIASES[bankName.toUpperCase()];
    if (alias) bankName = alias;
    const target = _normalizeBankName(bankName);
    if (!target) return null;
    for (const b of bankList) if (_normalizeBankName(b.name) === target) return b;
    for (const b of bankList) {
        const bn = _normalizeBankName(b.name);
        if (bn && (bn.includes(target) || target.includes(bn))) return b;
    }
    return null;
}

function _validateRow(rawRow, headerIdx, bankList, rowNum) {
    const get = key => {
        const i = headerIdx[key];
        return i == null ? '' : String(rawRow[i] || '').trim();
    };
    const name          = get('name');
    const accountNumber = get('account_number').replace(/\D/g, '');
    const bankNameRaw    = get('bank_name');
    const bankCodeRaw    = get('bank_code');
    const amountRaw      = get('amount');
    const currency       = (get('currency') || 'NGN').toUpperCase();
    const purpose        = get('purpose') || 'Bulk Disbursement';

    const errors = [];
    if (!name) errors.push('Missing name');

    if (!accountNumber) errors.push('Missing account number');
    else if (currency === 'NGN' && accountNumber.length !== 10) errors.push('Account number must be 10 digits (NUBAN) for NGN');

    let bankCode = bankCodeRaw;
    let bankName = bankNameRaw;
    if (!bankCode) {
        if (!bankNameRaw) {
            errors.push('Missing bank name');
        } else {
            const match = _resolveBankCode(bankNameRaw, bankList);
            if (!match) errors.push('Unrecognized bank name: "' + bankNameRaw + '" — use the exact bank name or add a bank_code column');
            else { bankCode = match.code; bankName = match.name; }
        }
    }

    const amount = Number(String(amountRaw).replace(/[,₦\s]/g, ''));
    if (!amountRaw) errors.push('Missing amount');
    else if (!Number.isFinite(amount) || amount <= 0) errors.push('Invalid amount');
    else if (amount > 50000000) errors.push('Amount exceeds ₦50,000,000 safety cap — check for a typo (extra zero?)');

    return {
        row: rowNum, name, accountNumber, bankName, bankCode,
        amount: Number.isFinite(amount) ? amount : 0, currency, purpose,
        valid: errors.length === 0, errors, status: 'pending'
    };
}

/* ---- Flutterwave calls --------------------------------------------------- */

let _bankListCache = { data: null, fetchedAt: 0 };

async function _getBankList() {
    const now = Date.now();
    if (_bankListCache.data && (now - _bankListCache.fetchedAt) < 12 * 60 * 60 * 1000) return _bankListCache.data;
    const res = await fetch('https://api.flutterwave.com/v3/banks/NG', {
        headers: { Authorization: 'Bearer ' + process.env.FLW_SECRET_KEY }
    });
    const json = await res.json();
    if (!res.ok || json.status !== 'success') throw new Error((json && json.message) || 'Could not fetch bank list');
    _bankListCache = { data: json.data, fetchedAt: now };
    return json.data;
}

// Precondition check the spec asks for: confirm the account actually
// resolves to a real name at that bank BEFORE money moves, not after.
async function _resolveAccount(row) {
    const res = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.FLW_SECRET_KEY },
        body: JSON.stringify({ account_number: row.accountNumber, account_bank: row.bankCode })
    });
    const json = await res.json();
    if (!res.ok || json.status !== 'success') throw new Error((json && json.message) || 'Account could not be resolved');
    return json.data.account_name;
}

async function _transfer(row, reference) {
    const res = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.FLW_SECRET_KEY },
        body: JSON.stringify({
            account_bank:   row.bankCode,
            account_number: row.accountNumber,
            amount:         row.amount,
            currency:       row.currency,
            debit_currency: row.currency,
            narration:      row.purpose,
            reference:      reference
        })
    });
    let json = {};
    try { json = await res.json(); } catch (e) { /* non-JSON error body */ }
    return { ok: res.ok && json.status === 'success', status: res.status, json };
}

/* ---- batch lifecycle ------------------------------------------------------ */

function _scheduleCleanup(batchId) {
    const t = setTimeout(() => _batches.delete(batchId), BATCH_TTL_MS);
    if (t.unref) t.unref();
}

async function _processRow(row, batch, getAdmin) {
    const reference = 'BULK-' + batch.id + '-' + row.row;
    row.reference = reference;

    try {
        row.resolvedName = await _resolveAccount(row);
    } catch (err) {
        row.status = 'failed';
        row.error = 'Account check failed: ' + err.message;
        batch.failed++;
        return;
    }

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const result = await _transfer(row, reference);
            if (result.ok) {
                row.status = 'success';
                row.txRef  = reference;
                row.flwRef = result.json.data && result.json.data.reference;
                row.flwId  = result.json.data && result.json.data.id;
                batch.succeeded++;
                _logToLedger(row, batch, getAdmin);
                return;
            }
            lastErr = (result.json && result.json.message) || ('HTTP ' + result.status);
            if (RETRYABLE_STATUSES.includes(result.status)) { await _sleep(attempt * 1500); continue; }
            break; // permanent failure (bad account, insufficient balance, etc.) — don't retry
        } catch (err) {
            lastErr = err.message;
            await _sleep(attempt * 1500);
        }
    }
    row.status = 'failed';
    row.error = lastErr || 'Transfer failed';
    batch.failed++;
}

function _logToLedger(row, batch, getAdmin) {
    try {
        const admin = getAdmin();
        if (!admin) return;
        admin.firestore().collection('disbursements').add({
            grantId:         row.reference,
            recipientId:     '',
            recipientName:   row.name,
            amount:          row.amount,
            amountFormatted: row.currency + ' ' + row.amount.toLocaleString(),
            currency:        row.currency,
            purpose:         row.purpose,
            mode:            'bulk_csv',
            token:           row.currency,
            paymentMethod:   'flutterwave_transfer',
            txRef:           row.reference,
            flwRef:          row.flwRef || '',
            status:          'completed', // "accepted by Flutterwave" — see webhook note at top of file
            type:            'Bulk CSV',
            batchId:         batch.id,
            adminId:         batch.createdBy,
            createdAt:       admin.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn('[BulkDisburse] ledger write failed:', e.message));
    } catch (e) { /* ledger write is best-effort — never block the actual payout on it */ }
}

async function _runBatch(batch, getAdmin) {
    const validRows = batch.rows.filter(r => r.valid);
    let cursor = 0;

    async function worker() {
        while (cursor < validRows.length) {
            const row = validRows[cursor++];
            await _processRow(row, batch, getAdmin);
            batch.processed++;
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, validRows.length) }, worker));
    batch.status = 'completed';

    try {
        const admin = getAdmin();
        if (admin) {
            admin.firestore().collection('bulk_disburse_batches').doc(batch.id).update({
                status: 'completed', succeeded: batch.succeeded, failed: batch.failed,
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(() => {});
        }
    } catch (e) { /* audit write only */ }
}

/* ---- admin auth ----------------------------------------------------------- */

async function _requireAdmin(req, res, getAdmin) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) { res.status(401).json({ error: 'Missing bearer token' }); return null; }

    const admin = getAdmin();
    if (!admin) { res.status(500).json({ error: 'Firebase Admin not configured on server (FIREBASE_SERVICE_ACCOUNT_JSON missing)' }); return null; }

    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        const isAdmin = decoded.admin === true || ADMIN_EMAILS.includes(decoded.email);
        if (!isAdmin) { res.status(403).json({ error: 'Admin access required' }); return null; }
        return decoded;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}

/* ---- router ---------------------------------------------------------------
   Exported as a factory so server.js can hand it the SAME lazy Firebase
   Admin getter it already uses for /api/notify and the OGP routes, instead
   of this file initializing a second independent Admin SDK instance. See
   the server.js integration note at the bottom of this file.
   ============================================================================= */

module.exports = function createBulkDisburseRouter(getAdmin) {
    const router = express.Router();

    router.post('/upload', upload.single('file'), async (req, res) => {
        const decoded = await _requireAdmin(req, res, getAdmin);
        if (!decoded) return;

        if (!process.env.FLW_SECRET_KEY) return res.status(500).json({ error: 'FLW_SECRET_KEY not configured on server' });
        if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded (field name: file)' });

        let bankList;
        try {
            bankList = await _getBankList();
        } catch (err) {
            return res.status(502).json({ error: 'Could not reach Flutterwave to validate bank names: ' + err.message });
        }

        const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM (Excel CSV exports add one)
        const table = _parseCSV(text);
        if (!table.length) return res.status(400).json({ error: 'CSV is empty' });

        const headerIdx = _buildHeaderIndex(table[0]);
        const missing = ['name', 'account_number', 'bank_name', 'amount'].filter(c => headerIdx[c] == null);
        if (missing.length) return res.status(400).json({ error: 'CSV missing required column(s): ' + missing.join(', ') });

        const dataRows = table.slice(1);
        if (dataRows.length > MAX_ROWS) {
            return res.status(400).json({ error: 'CSV has ' + dataRows.length + ' rows — maximum is ' + MAX_ROWS + ' per batch. Split into multiple files.' });
        }

        const rows = dataRows.map((r, i) => _validateRow(r, headerIdx, bankList, i + 2)); // +2: row 1 is the header
        const validRows = rows.filter(r => r.valid);
        const invalidRows = rows.filter(r => !r.valid);
        const totalAmount = validRows.reduce((s, r) => s + r.amount, 0);

        const batchId = 'bd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        const batch = {
            id: batchId, createdAt: Date.now(), createdBy: decoded.uid, createdByEmail: decoded.email || '',
            rows, status: 'validated', processed: 0, succeeded: 0, failed: 0
        };
        _batches.set(batchId, batch);
        _scheduleCleanup(batchId);

        try {
            const admin = getAdmin();
            if (admin) {
                admin.firestore().collection('bulk_disburse_batches').doc(batchId).set({
                    createdBy: decoded.uid, createdByEmail: decoded.email || '',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    totalRows: rows.length, validRows: validRows.length, invalidRows: invalidRows.length,
                    totalAmount, status: 'validated'
                }).catch(() => {});
            }
        } catch (e) { /* audit write only — upload still succeeds without it */ }

        res.json({
            batchId,
            totalRows: rows.length,
            validRows: validRows.length,
            invalidRows: invalidRows.length,
            totalAmount,
            sampleErrors: invalidRows.slice(0, 25).map(r => ({ row: r.row, name: r.name, errors: r.errors }))
        });
    });

    router.post('/:id/execute', async (req, res) => {
        const decoded = await _requireAdmin(req, res, getAdmin);
        if (!decoded) return;

        const batch = _batches.get(req.params.id);
        if (!batch) return res.status(404).json({ error: 'Batch not found or expired' });
        if (batch.status === 'processing') return res.status(409).json({ error: 'Batch already processing' });
        if (batch.status === 'completed') return res.status(409).json({ error: 'Batch already completed' });

        batch.status = 'processing';
        res.json({ started: true, batchId: batch.id, validRows: batch.rows.filter(r => r.valid).length });

        _runBatch(batch, getAdmin).catch(err => {
            console.error('[BulkDisburse] batch ' + batch.id + ' crashed:', err);
            batch.status = 'error';
            batch.error = err.message;
        });
    });

    router.get('/:id/status', async (req, res) => {
        const decoded = await _requireAdmin(req, res, getAdmin);
        if (!decoded) return;

        const batch = _batches.get(req.params.id);
        if (!batch) return res.status(404).json({ error: 'Batch not found or expired' });

        res.json({
            status:    batch.status,
            processed: batch.processed,
            succeeded: batch.succeeded,
            failed:    batch.failed,
            validRows: batch.rows.filter(r => r.valid).length,
            totalRows: batch.rows.length,
            error:     batch.error || null
        });
    });

    router.get('/:id/failed-csv', async (req, res) => {
        const decoded = await _requireAdmin(req, res, getAdmin);
        if (!decoded) return;

        const batch = _batches.get(req.params.id);
        if (!batch) return res.status(404).json({ error: 'Batch not found or expired' });

        const failedRows = batch.rows.filter(r => !r.valid || r.status === 'failed');
        const header = 'name,account_number,bank_name,amount,currency,purpose,error\n';
        const body = failedRows.map(r => [
            r.name, r.accountNumber, r.bankName, r.amount, r.currency, r.purpose,
            r.error || (r.errors || []).join('; ')
        ].map(_escCsv).join(',')).join('\n');

        res.set('Content-Type', 'text/csv');
        res.set('Content-Disposition', 'attachment; filename="failed-disbursements-' + batch.id + '.csv"');
        res.send(header + body);
    });

    return router;
};

// ── Reusable exports for server.js's /api/admin/withdrawals/:id/payout ─────
// That route needs the exact same "resolve bank -> resolve account -> fire
// transfer" sequence this file already uses per-row in a bulk batch, so it
// reuses these directly instead of a second, drifting Flutterwave
// integration. Attached as properties on the exported factory function
// (rather than a second module.exports shape) so the existing
// `require('./bulk-disburse-routes')` call site in server.js keeps working
// unchanged — createBulkDisburseRouter is still callable as
// createBulkDisburseRouter(getAdmin), AND now also carries these four
// functions as named properties, e.g. createBulkDisburseRouter.transfer(...).
module.exports.getBankList     = _getBankList;
module.exports.resolveBankCode = _resolveBankCode;
module.exports.resolveAccount  = _resolveAccount;
module.exports.transfer        = _transfer;

/* ---- server.js integration -------------------------------------------------
   Add near the other /api routes (after /api/agora-token is fine), reusing
   the same lazy Firebase Admin getter server.js already builds for the OGP
   preview routes — do NOT create a second admin.initializeApp() call.

   1) Factor server.js's existing inline _getAdmin() (currently private to
      the OGP section) so this router can reuse it — it's already exactly
      what's needed, just pass it in:

        const createBulkDisburseRouter = require('./bulk-disburse-routes');
        app.use('/api/admin/bulk-disburse', createBulkDisburseRouter(_getAdmin));

      Place that app.use(...) line any time after _getAdmin is defined
      (it's defined further down, near the OGP section) and before the
      `app.use(express.static(...))` line — Express only needs the route
      registered before the static/SPA fallback catches everything.

   2) No new Render env vars needed — this reuses FLW_SECRET_KEY and
      FIREBASE_SERVICE_ACCOUNT_JSON, both already in render.yaml.

   3) package.json needs "multer" added to dependencies (see patch note).
   ============================================================================= */