/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v49 + v50 (merged)
   app-patch-v49-v50.js  |  Load LAST (after app-patch-v48.js)

   MERGE NOTE (2026-09-22): combined into one file — this repo is already
   at GitHub's 100-file cap, so no new patch file can be added; the same
   reasoning already used for app-patch-v8-v19.js and app-patch-v30-v46.js
   applies here. app-patch-v49.js is reproduced below UNCHANGED, still in
   its own IIFE with its own idempotency guard (window._empPatchV49Loaded)
   — untouched, not re-reviewed, not refactored. app-patch-v50 (the 2027
   election hub) is appended below it as a second, independent IIFE with
   its own guard (window._empPatchV50Loaded). Verified no other file reads
   either guard flag directly or reaches into either closure, so
   concatenating them changes nothing about what either does or when it
   can run — only that they now load from one <script> tag instead of two.

   Original v49 header: real wallet-to-wallet transfers + EMPY-wallet SOS
   donations (see that block's own header below for the full write-up).
   Original v50 header: 2027 election hub — candidate support-card
   generator + live results dashboard (see that block's own header below).
   INDEX.HTML: rename the existing
       <script src="app-patch-v49.js?v=20260731a"></script>
   to
       <script src="app-patch-v49-v50.js?v=20260922a"></script>
   — one line changed, no new <script> tag added, file count unchanged.
   ============================================================================= */

/* =============================================================================
   EMPYREAN — app-patch-v49.js
   REAL wallet-to-wallet transfers + EMPY-wallet SOS donations.

   Load order: after app-wallet.js, app-sos.js, and app-patch-v48.js (this
   file follows the exact same "capture-phase override, purely additive,
   never edit the file it's patching" approach v48 established for the
   withdrawal form — see that file's own header comment for the full
   rationale).

   ═══════════════════════════════════════════════════════════════════════
   PART 1 — WALLET-TO-WALLET TRANSFER (real, replaces fake UI)
   ═══════════════════════════════════════════════════════════════════════
   BACKGROUND: the "Internal Transfer (Wallet to Wallet)" card in index.html
   says "Send EMPY tokens to another user on the Empyrean platform" but its
   #p2p-transfer-form actually asked for a "Polygon Wallet Address" (0x...)
   — a field the submit handler (app-fixes.js, case 'p2p-transfer-form')
   never even read. That handler just deducted the sender's local
   userState.empyBalance and showed a success toast. No recipient was ever
   looked up, no Firestore write ever happened, and the balance change
   didn't survive a page refresh. Nobody ever actually received anything.

   FIX: index.html's #transfer-address field is repurposed as a plain
   username (see the matching index.html edit — label/placeholder changed,
   id kept as 'transfer-address' so this file doesn't depend on a second,
   riskier HTML edit). This file intercepts the form submit in the CAPTURE
   phase and calls stopImmediatePropagation() before app-fixes.js's
   bubble-phase switch-case ever runs, then does the real thing: look up
   the recipient by username, move the balance with a Firestore
   transaction (atomic — no double-spend if the sender fires two transfers
   back to back), and write an audit record to wallet_transfers.

   Firestore rule this depends on (already added to firebase-rules.js):
   isEmpyBalanceCreditOnlyUpdate — lets the sender's client credit the
   recipient's empyBalance (a field on a doc they don't own) without
   opening general write access, and without ever allowing a debit.

   ═══════════════════════════════════════════════════════════════════════
   PART 2 — SOS DONATIONS FROM EMPY WALLET BALANCE
   ═══════════════════════════════════════════════════════════════════════
   BACKGROUND: app-sos.js's donation modal (#sos-donation-modal) only ever
   offers card/crypto/bank — every path funnels into Flutterwave. There
   was no way to donate straight from an EMPY balance you already hold.

   FIX: a fourth "EMPY Wallet" tab is added to the existing payment-tabs
   in that modal (see index.html edit — the tab-switching JS in
   app-wallet.js §10 is already generic and needs no changes). This file
   intercepts #donation-form's submit in the capture phase ONLY when that
   tab is the active one (checked via the .payment-method-content.active
   class the existing tab-switcher already maintains); for every other
   tab it does nothing and app-sos.js's own handler runs exactly as
   before. When the EMPY tab is active: validates balance, credits the
   SOS requester's empyBalance directly via the same transaction pattern
   as Part 1 (no card/chargeback risk here — the donor's balance already
   proves the funds exist, so there's no need to hold it in a "pending
   verification" limbo the way the cash-donation escrow currently does),
   and writes an audit record to sos_donations_empy.
   ============================================================================= */

(function empyreanPatchV49() {
    'use strict';

    if (window._empPatchV49Loaded) {
        console.warn('[V49] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV49Loaded = true;

    function _us()   { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _guest(){ var s = window.EmpState || {}; return s.isGuest != null ? s.isGuest : !!window.isGuest; }
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _fv()   { return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null; }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); }
    function _openAuth() {
        var m = document.getElementById('auth-modal-overlay');
        if (m) { m.style.display = 'flex'; m.classList.add('show'); document.body.classList.add('modal-open'); }
    }

    /* =========================================================================
       Shared: look up a user by username, atomically move EMPY between two
       user docs, and return the resolved names for the success toast.
       ========================================================================= */
    function _findUserByUsername(handle) {
        return window.fbDb.collection('users').where('username', '==', handle).limit(1).get()
            .then(function (snap) {
                if (snap.empty) return null;
                var doc = snap.docs[0];
                return Object.assign({ id: doc.id }, doc.data() || {});
            });
    }

    // amount moves OUT of fromUserId's empyBalance and INTO toUserId's.
    // Runs as a single Firestore transaction so two transfers fired in
    // quick succession can't both read a stale "sufficient balance" and
    // both succeed (classic double-spend race) — the transaction retries
    // automatically on a conflicting concurrent write.
    function _runEmpyTransfer(fromUserId, toUserId, amount) {
        var fromRef = window.fbDb.collection('users').doc(fromUserId);
        var toRef   = window.fbDb.collection('users').doc(toUserId);

        return window.fbDb.runTransaction(function (tx) {
            return Promise.all([tx.get(fromRef), tx.get(toRef)]).then(function (results) {
                var fromSnap = results[0], toSnap = results[1];
                if (!fromSnap.exists) throw new Error('Your account could not be loaded — please try again.');
                if (!toSnap.exists)   throw new Error('Recipient account could not be loaded.');

                var fromBal = Number((fromSnap.data() || {}).empyBalance || 0);
                var toBal   = Number((toSnap.data()   || {}).empyBalance || 0);
                if (fromBal < amount) throw new Error('INSUFFICIENT_BALANCE');

                tx.update(fromRef, { empyBalance: fromBal - amount });
                tx.update(toRef,   { empyBalance: toBal + amount });
                return true;
            });
        });
    }

    /* =========================================================================
       PART 1 — Wallet-to-wallet transfer
       ========================================================================= */
    function _submitWalletTransfer(form) {
        if (_guest()) { _openAuth(); return; }
        if (!_fbOk()) { _notify('Offline — cannot send a transfer right now.', 'error'); return; }

        var us = _us();
        var handleInput = form.querySelector('#transfer-address');
        var amountInput = form.querySelector('#transfer-amount');
        var handle = ((handleInput && handleInput.value) || '').trim().replace(/^@/, '');
        var amount = parseFloat((amountInput && amountInput.value) || 0);

        if (!handle) { _notify('Enter the recipient\u2019s username.', 'error'); return; }
        if (!amount || amount <= 0) { _notify('Enter a valid amount to send.', 'error'); return; }
        if (handle.toLowerCase() === String(us.username || '').toLowerCase()) {
            _notify('You can\u2019t send EMPY to yourself.', 'error'); return;
        }
        if (Number(us.empyBalance || 0) < amount) {
            _notify('Insufficient EMPY balance for this transfer.', 'error'); return;
        }

        var btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.dataset._origLabel = btn.innerHTML; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending…'; }
        function _restore() { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset._origLabel || 'Send EMPY'; } }

        _findUserByUsername(handle)
            .then(function (recipient) {
                if (!recipient) { throw new Error('NOT_FOUND'); }
                if (recipient.id === us.id) { throw new Error('SELF'); }
                return _runEmpyTransfer(us.id, recipient.id, amount).then(function () {
                    return recipient;
                });
            })
            .then(function (recipient) {
                // Reflect locally right away rather than waiting on a reload.
                us.empyBalance = Number(us.empyBalance || 0) - amount;
                if (window.userState) window.userState.empyBalance = us.empyBalance;
                if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

                window.fbDb.collection('wallet_transfers').add({
                    fromUserId:   us.id,
                    fromUsername: us.username || us.fullName || '',
                    toUserId:     recipient.id,
                    toUsername:   recipient.username || recipient.fullName || handle,
                    amount:       amount,
                    createdAt:    new Date().toISOString()
                }).catch(function () {}); // audit-only write; never blocks the already-completed transfer

                _notify('\u2705 ' + amount.toLocaleString() + ' EMPY sent to ' + (recipient.username || handle) + '!', 'success');
                form.reset();
                if (typeof window.updateTransferPreview === 'function') window.updateTransferPreview();
            })
            .catch(function (err) {
                var msg = err && err.message;
                if (msg === 'NOT_FOUND') _notify('No Empyrean user found with that username.', 'error');
                else if (msg === 'SELF') _notify('You can\u2019t send EMPY to yourself.', 'error');
                else if (msg === 'INSUFFICIENT_BALANCE') _notify('Insufficient EMPY balance for this transfer.', 'error');
                else {
                    console.error('[V49] Wallet transfer failed:', msg);
                    _notify('Transfer failed: ' + (msg || 'Unknown error'), 'error');
                }
            })
            .finally(_restore);
    }

    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form || form.id !== 'p2p-transfer-form') return;
        // Capture phase, fires before app-fixes.js's bubble-phase switch-case
        // for the same form id — stop it before it can also run and produce
        // a second, fake, non-persisted "deduction".
        e.preventDefault();
        e.stopImmediatePropagation();
        _submitWalletTransfer(form);
    }, true);

    /* =========================================================================
       PART 2 — SOS donation from EMPY wallet balance
       ========================================================================= */
    function _empyDonationTabActive(form) {
        var panel = form.querySelector('#empy-payment-sos');
        return !!(panel && panel.classList.contains('active'));
    }

    function _submitEmpyDonation(form) {
        if (_guest()) { _openAuth(); return; }
        if (!_fbOk()) { _notify('Offline — cannot process a wallet donation right now.', 'error'); return; }

        var us  = _us();
        var ctx = window._sosDonationContext || {};
        if (!ctx.userId) { _notify('Could not identify who this donation is for — please reopen the request.', 'error'); return; }
        if (ctx.userId === us.id) { _notify('You can\u2019t donate to your own SOS request.', 'error'); return; }

        var amountInput = form.querySelector('#donate-amount-empy');
        var amount = parseFloat((amountInput && amountInput.value) || 0);
        if (!amount || amount < 1) { _notify('Minimum wallet donation is 1 EMPY.', 'error'); return; }
        if (Number(us.empyBalance || 0) < amount) { _notify('Insufficient EMPY balance for this donation.', 'error'); return; }

        var btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.dataset._origLabel = btn.innerHTML; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending…'; }
        function _restore() { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset._origLabel || 'Donate Now'; } }

        _runEmpyTransfer(us.id, ctx.userId, amount)
            .then(function () {
                us.empyBalance = Number(us.empyBalance || 0) - amount;
                if (window.userState) window.userState.empyBalance = us.empyBalance;
                if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

                window.fbDb.collection('sos_donations_empy').add({
                    donorUserId:     us.id,
                    donorUsername:   us.username || us.fullName || 'Anonymous',
                    recipientUserId: ctx.userId,
                    sosPostId:       ctx.postId || '',
                    amount:          amount,
                    status:          'completed',
                    createdAt:       new Date().toISOString()
                }).catch(function () {});

                _notify('Thank you! ' + amount.toLocaleString() + ' EMPY donated to ' + (ctx.username || 'this cause') + '.', 'success');
                window._sosDonationContext = null;
                form.reset();
                var modal = form.closest('.modal-overlay-container');
                if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; }
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
            })
            .catch(function (err) {
                var msg = err && err.message;
                if (msg === 'INSUFFICIENT_BALANCE') _notify('Insufficient EMPY balance for this donation.', 'error');
                else {
                    console.error('[V49] EMPY donation failed:', msg);
                    _notify('Donation failed: ' + (msg || 'Unknown error'), 'error');
                }
            })
            .finally(_restore);
    }

    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form || form.id !== 'donation-form') return;
        if (!_empyDonationTabActive(form)) return; // any other tab: let app-sos.js's own handler run untouched
        e.preventDefault();
        e.stopImmediatePropagation();
        _submitEmpyDonation(form);
    }, true);

    /* =========================================================================
       Correct the transfer preview text — no real fee applies to an
       internal balance move, so app-wallet.js's leftover "Network Fee
       (Polygon)" line is no longer accurate. Runs after app-wallet.js's own
       listener on the same event (registered earlier), overwriting its
       output rather than trying to intercept a same-file closure call.
       ========================================================================= */
    document.addEventListener('input', function (e) {
        if (!e.target || e.target.id !== 'transfer-amount') return;
        var previewEl = document.getElementById('transfer-preview');
        if (!previewEl) return;
        var amount = parseFloat(e.target.value) || 0;
        previewEl.innerHTML = amount > 0
            ? '<p>Amount to Send: <strong>' + amount.toLocaleString() + ' EMPY</strong></p><p>Fee: <strong>None</strong> — internal transfers are free.</p><p>Recipient Receives: <strong>' + amount.toLocaleString() + ' EMPY</strong></p>'
            : '<p>Enter an amount to see transaction details.</p>';
    });

    document.addEventListener('click', function (e) {
        var tab = e.target.closest && e.target.closest('.payment-tab');
        if (!tab) return;
        // Only react to tabs inside the SOS donation modal, not other
        // .payment-tabs groups elsewhere on the page (e.g. buy-EMPY tabs).
        if (!tab.closest('#sos-donation-modal')) return;
        var donationForm = document.getElementById('donation-form');
        if (!donationForm) return;
        var submitBtn = donationForm.querySelector('button[type="submit"]');
        if (!submitBtn) return;
        if (tab.dataset.target === 'empy-payment-sos') {
            submitBtn.innerHTML = '<i class="fas fa-coins"></i> Donate from Wallet';
        } else {
            submitBtn.innerHTML = '<i class="fas fa-hand-holding-heart"></i> Donate Now via Flutterwave';
        }
    });

    console.log('[EmpyreanPatchV49] \u2705 Real wallet-to-wallet transfers and EMPY-wallet SOS donations wired.');

})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v50
   app-patch-v50 block (now shipped inside app-patch-v49-v50.js — see the
   merge note at the top of this file)

   FEATURE — 2027 ELECTION HUB: candidate support card + live results
   dashboard

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS IS ADDITIVE, NOT AN EDIT INTO app-status.js / app-analytics.js
   ═══════════════════════════════════════════════════════════════════════
   This reaches OUT to two already-public hooks app-status.js/app-dom.js
   expose for exactly this kind of external caller —

       window.uploadToCloudinary(blob)         (app-dom.js)
       window._empAttachRemoteStatusMedia(url)  (app-status.js)

   — rather than editing either file's own closure, markup, or posting
   logic (the same trap app-patch-v33.js's and v37.js's own headers
   describe running into and deliberately avoiding).

   Server-side, this now talks to a route added DIRECTLY in server.js
   (GET /api/election/results, appended near the other route
   definitions — see server.js's own comment at that spot) rather than a
   separate router file, for the same file-count reason this frontend
   half was merged into app-patch-v49.js instead of shipping as
   app-patch-v50.js on its own.

   ═══════════════════════════════════════════════════════════════════════
   DATA CORRECTION vs the original mock-up brief
   ═══════════════════════════════════════════════════════════════════════
   The brief's candidate/party table (Atiku→PDP, Obi→NDC) does not match
   INEC's actual final published candidates' list for the January 16,
   2027 general election (confirmed via INEC's own list, reported by
   multiple outlets this week):

       Bola Tinubu      → APC (All Progressives Congress)
       Atiku Abubakar   → ADC (African Democratic Congress)  — NOT PDP
       Peter Obi        → NDC (Nigeria Democratic Congress)
       Omoyele Sowore   → AAC (African Action Congress)

   This is what CANDIDATES below uses. Party marks are drawn as coloured
   badges (initials on each party's real brand colour) rather than as
   reproductions of the parties' logo artwork — this avoids depending on
   a specific uploaded image file existing at a specific path in
   /public (which would silently break the whole card if that path is
   ever wrong) and avoids reproducing third-party logo graphics
   pixel-for-pixel. If real logo PNGs are added to the app under
   /party-logos/<id>.png, just fill in `logoUrl` below — everything else
   already prefers it over the drawn badge when present.
   ============================================================================= */

/* =============================================================================
   FIX (2026-09-23 — "results uploader / State dropdown is empty"): §3.5's
   renderPuUploader() below has always read `window._NIGERIA_STATES_LGAS`
   for its State/Local-Government-Area cascade, but nothing in this codebase
   ever actually defined that global — every earlier session left it as a
   TODO and the uploader shipped reading `{}`, so the State <select> silently
   rendered with zero <option>s, the LGA <select> could never be enabled, and
   the whole per-polling-unit uploader was unusable (Submit Result always
   failed the "fill in every field" check). This is the one genuinely missing
   piece of an otherwise-complete implementation — filling it in here, as a
   plain data global defined BEFORE the v50 IIFE runs (so `STATE_LGAS =
   window._NIGERIA_STATES_LGAS || {}` inside it picks up the real data),
   finishes the feature without touching any other file. Standard 36 states +
   FCT, official LGA lists. Only written if some other, earlier-loaded script
   hasn't already supplied it. */
if (!window._NIGERIA_STATES_LGAS) {
    window._NIGERIA_STATES_LGAS = {
        'Abia': ['Aba North','Aba South','Arochukwu','Bende','Ikwuano','Isiala Ngwa North','Isiala Ngwa South','Isuikwuato','Obi Ngwa','Ohafia','Osisioma','Ugwunagbo','Ukwa East','Ukwa West','Umuahia North','Umuahia South','Umu Nneochi'],
        'Adamawa': ['Demsa','Fufure','Ganye','Gayuk','Gombi','Grie','Hong','Jada','Lamurde','Madagali','Maiha','Mayo-Belwa','Michika','Mubi North','Mubi South','Numan','Shelleng','Song','Toungo','Yola North','Yola South'],
        'Akwa Ibom': ['Abak','Eastern Obolo','Eket','Esit Eket','Essien Udim','Etim Ekpo','Etinan','Ibeno','Ibesikpo Asutan','Ibiono-Ibom','Ika','Ikono','Ikot Abasi','Ikot Ekpene','Ini','Itu','Mbo','Mkpat-Enin','Nsit-Atai','Nsit-Ibom','Nsit-Ubium','Obot Akara','Okobo','Onna','Oron','Oruk Anam','Udung-Uko','Ukanafun','Uruan','Urue-Offong/Oruko','Uyo'],
        'Anambra': ['Aguata','Anambra East','Anambra West','Anaocha','Awka North','Awka South','Ayamelum','Dunukofia','Ekwusigo','Idemili North','Idemili South','Ihiala','Njikoka','Nnewi North','Nnewi South','Ogbaru','Onitsha North','Onitsha South','Orumba North','Orumba South','Oyi'],
        'Bauchi': ['Alkaleri','Bauchi','Bogoro','Damban','Darazo','Dass','Gamawa','Ganjuwa','Giade','Itas/Gadau',"Jama'are",'Katagum','Kirfi','Misau','Ningi','Shira','Tafawa Balewa','Toro','Warji','Zaki'],
        'Bayelsa': ['Brass','Ekeremor','Kolokuma/Opokuma','Nembe','Ogbia','Sagbama','Southern Ijaw','Yenagoa'],
        'Benue': ['Ado','Agatu','Apa','Buruku','Gboko','Guma','Gwer East','Gwer West','Katsina-Ala','Konshisha','Kwande','Logo','Makurdi','Obi','Ogbadibo','Ohimini','Oju','Okpokwu','Otukpo','Tarka','Ukum','Ushongo','Vandeikya'],
        'Borno': ['Abadam','Askira/Uba','Bama','Bayo','Biu','Chibok','Damboa','Dikwa','Gubio','Guzamala','Gwoza','Hawul','Jere','Kaga','Kala/Balge','Konduga','Kukawa','Kwaya Kusar','Mafa','Magumeri','Maiduguri','Marte','Mobbar','Monguno','Ngala','Nganzai','Shani'],
        'Cross River': ['Abi','Akamkpa','Akpabuyo','Bakassi','Bekwarra','Biase','Boki','Calabar Municipal','Calabar South','Etung','Ikom','Obanliku','Obubra','Obudu','Odukpani','Ogoja','Yakuur','Yala'],
        'Delta': ['Aniocha North','Aniocha South','Bomadi','Burutu','Ethiope East','Ethiope West','Ika North East','Ika South','Isoko North','Isoko South','Ndokwa East','Ndokwa West','Okpe','Oshimili North','Oshimili South','Patani','Sapele','Udu','Ughelli North','Ughelli South','Ukwuani','Uvwie','Warri North','Warri South','Warri South West'],
        'Ebonyi': ['Abakaliki','Afikpo North','Afikpo South','Ebonyi','Ezza North','Ezza South','Ikwo','Ishielu','Ivo','Izzi','Ohaozara','Ohaukwu','Onicha'],
        'Edo': ['Akoko-Edo','Egor','Esan Central','Esan North-East','Esan South-East','Esan West','Etsako Central','Etsako East','Etsako West','Igueben','Ikpoba-Okha','Orhionmwon','Oredo','Ovia North-East','Ovia South-West','Owan East','Owan West','Uhunmwonde'],
        'Ekiti': ['Ado Ekiti','Efon','Ekiti East','Ekiti South-West','Ekiti West','Emure','Gbonyin','Ido Osi','Ijero','Ikere','Ikole','Ilejemeje','Irepodun/Ifelodun','Ise/Orun','Moba','Oye'],
        'Enugu': ['Aninri','Awgu','Enugu East','Enugu North','Enugu South','Ezeagu','Igbo Etiti','Igbo Eze North','Igbo Eze South','Isi Uzo','Nkanu East','Nkanu West','Nsukka','Oji River','Udenu','Udi','Uzo Uwani'],
        'Gombe': ['Akko','Balanga','Billiri','Dukku','Funakaye','Gombe','Kaltungo','Kwami','Nafada','Shongom','Yamaltu/Deba'],
        'Imo': ['Aboh Mbaise','Ahiazu Mbaise','Ehime Mbano','Ezinihitte','Ideato North','Ideato South','Ihitte/Uboma','Ikeduru','Isiala Mbano','Isu','Mbaitoli','Ngor Okpala','Njaba','Nkwerre','Nwangele','Obowo','Oguta','Ohaji/Egbema','Okigwe','Onuimo','Orlu','Orsu','Oru East','Oru West','Owerri Municipal','Owerri North','Owerri West'],
        'Jigawa': ['Auyo','Babura','Biriniwa','Birnin Kudu','Buji','Dutse','Gagarawa','Garki','Gumel','Guri','Gwaram','Gwiwa','Hadejia','Jahun','Kafin Hausa','Kaugama','Kazaure','Kiri Kasama','Kiyawa','Maigatari','Malam Madori','Miga','Ringim','Roni','Sule Tankarkar','Taura','Yankwashi'],
        'Kaduna': ['Birnin Gwari','Chikun','Giwa','Igabi','Ikara','Jaba',"Jema'a",'Kachia','Kaduna North','Kaduna South','Kagarko','Kajuru','Kaura','Kauru','Kubau','Kudan','Lere','Makarfi','Sabon Gari','Sanga','Soba','Zangon Kataf','Zaria'],
        'Kano': ['Ajingi','Albasu','Bagwai','Bebeji','Bichi','Bunkure','Dala','Dambatta','Dawakin Kudu','Dawakin Tofa','Doguwa','Fagge','Gabasawa','Garko','Garun Mallam','Gaya','Gezawa','Gwale','Gwarzo','Kabo','Kano Municipal','Karaye','Kibiya','Kiru','Kumbotso','Kunchi','Kura','Madobi','Makoda','Minjibir','Nasarawa','Rano','Rimin Gado','Rogo','Shanono','Sumaila','Takai','Tarauni','Tofa','Tsanyawa','Tudun Wada','Ungogo','Warawa','Wudil'],
        'Katsina': ['Bakori','Batagarawa','Batsari','Baure','Bindawa','Charanchi','Dandume','Danja','Dan Musa','Daura','Dutsi',"Dutsin-Ma",'Faskari','Funtua','Ingawa','Jibia','Kafur','Kaita','Kankara','Kankia','Katsina','Kurfi','Kusada',"Mai'Adua",'Malumfashi','Mani','Mashi','Matazu','Musawa','Rimi','Sabuwa','Safana','Sandamu','Zango'],
        'Kebbi': ['Aleiro','Arewa Dandi','Argungu','Augie','Bagudo','Birnin Kebbi','Bunza','Dandi','Fakai','Gwandu','Jega','Kalgo','Koko/Besse','Maiyama','Ngaski','Sakaba','Shanga','Suru','Wasagu/Danko','Yauri','Zuru'],
        'Kogi': ['Adavi','Ajaokuta','Ankpa','Bassa','Dekina','Ibaji','Idah','Igalamela Odolu','Ijumu','Kabba/Bunu','Kogi','Lokoja','Mopa Muro','Ofu','Ogori/Magongo','Okehi','Okene','Olamaboro','Omala','Yagba East','Yagba West'],
        'Kwara': ['Asa','Baruten','Edu','Ekiti','Ifelodun','Ilorin East','Ilorin South','Ilorin West','Irepodun','Isin','Kaiama','Moro','Offa','Oke Ero','Oyun','Pategi'],
        'Lagos': ['Agege','Ajeromi-Ifelodun','Alimosho','Amuwo-Odofin','Apapa','Badagry','Epe','Eti Osa','Ibeju-Lekki','Ifako-Ijaiye','Ikeja','Ikorodu','Kosofe','Lagos Island','Lagos Mainland','Mushin','Ojo','Oshodi-Isolo','Shomolu','Surulere'],
        'Nasarawa': ['Akwanga','Awe','Doma','Karu','Keana','Keffi','Kokona','Lafia','Nasarawa','Nasarawa Egon','Obi','Toto','Wamba'],
        'Niger': ['Agaie','Agwara','Bida','Borgu','Bosso','Chanchaga','Edati','Gbako','Gurara','Katcha','Kontagora','Lapai','Lavun','Magama','Mariga','Mashegu','Mokwa','Moya','Paikoro','Rafi','Rijau','Shiroro','Suleja','Tafa','Wushishi'],
        'Ogun': ['Abeokuta North','Abeokuta South','Ado-Odo/Ota','Egbado North','Egbado South','Ewekoro','Ifo','Ijebu East','Ijebu North','Ijebu North East','Ijebu Ode','Ikenne','Imeko Afon','Ipokia','Obafemi Owode','Odeda','Odogbolu','Ogun Waterside','Remo North','Shagamu'],
        'Ondo': ['Akoko North-East','Akoko North-West','Akoko South-East','Akoko South-West','Akure North','Akure South','Ese Odo','Idanre','Ifedore','Ilaje','Ile Oluji/Okeigbo','Irele','Odigbo','Okitipupa','Ondo East','Ondo West','Ose','Owo'],
        'Osun': ['Atakunmosa East','Atakunmosa West','Aiyedaade','Aiyedire','Boluwaduro','Boripe','Ede North','Ede South','Egbedore','Ejigbo','Ife Central','Ife East','Ife North','Ife South','Ifedayo','Ifelodun','Ila','Ilesa East','Ilesa West','Irepodun','Irewole','Isokan','Iwo','Obokun','Odo Otin','Ola Oluwa','Olorunda','Oriade','Orolu','Osogbo'],
        'Oyo': ['Afijio','Akinyele','Atiba','Atisbo','Egbeda','Ibadan North','Ibadan North-East','Ibadan North-West','Ibadan South-East','Ibadan South-West','Ibarapa Central','Ibarapa East','Ibarapa North','Ido','Irepo','Iseyin','Itesiwaju','Iwajowa','Kajola','Lagelu','Ogbomosho North','Ogbomosho South','Ogo Oluwa','Olorunsogo','Oluyole','Ona Ara','Orelope','Ori Ire','Oyo East','Oyo West','Saki East','Saki West','Surulere'],
        'Plateau': ['Barkin Ladi','Bassa','Bokkos','Jos East','Jos North','Jos South','Kanam','Kanke','Langtang North','Langtang South','Mangu','Mikang','Pankshin',"Qua'an Pan",'Riyom','Shendam','Wase'],
        'Rivers': ['Abua/Odual','Ahoada East','Ahoada West','Akuku-Toru','Andoni','Asari-Toru','Bonny','Degema','Eleme','Emuoha','Etche','Gokana','Ikwerre','Khana','Obio/Akpor','Ogba/Egbema/Ndoni','Ogu/Bolo','Okrika','Omuma','Opobo/Nkoro','Oyigbo','Port Harcourt','Tai'],
        'Sokoto': ['Binji','Bodinga','Dange Shuni','Gada','Goronyo','Gudu','Gwadabawa','Illela','Isa','Kebbe','Kware','Rabah','Sabon Birni','Shagari','Silame','Sokoto North','Sokoto South','Tambuwal','Tangaza','Tureta','Wamako','Wurno','Yabo'],
        'Taraba': ['Ardo Kola','Bali','Donga','Gashaka','Gassol','Ibi','Jalingo','Karim Lamido','Kumi','Lau','Sardauna','Takum','Ussa','Wukari','Yorro','Zing'],
        'Yobe': ['Bade','Bursari','Damaturu','Fika','Fune','Geidam','Gujba','Gulani','Jakusko','Karasuwa','Machina','Nangere','Nguru','Potiskum','Tarmuwa','Yunusari','Yusufari'],
        'Zamfara': ['Anka','Bakura','Birnin Magaji/Kiyaw','Bukkuyum','Bungudu','Gummi','Gusau','Kaura Namoda','Maradun','Maru','Shinkafi','Talata Mafara','Tsafe','Zurmi'],
        'FCT - Abuja': ['Abaji','Abuja Municipal','Bwari','Gwagwalada','Kuje','Kwali']
    };
}

(function empyreanPatchV50() {
    'use strict';

    if (window._empPatchV50Loaded) {
        console.warn('[V50] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV50Loaded = true;

    function log(msg) { console.log('[V50-Election] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    var ELECTION_LABEL = '#Vote2027';

    /* Fill in logoUrl (e.g. '/party-logos/apc.png') to use a real logo
       image instead of the drawn initials badge — see header note. */
    var CANDIDATES = [
        { id: 'tinubu', name: 'Bola Ahmed Tinubu', party: 'APC', partyFull: 'All Progressives Congress', color: '#00853F', accent: '#E4292C', photoUrl: /* was '/candidates/tinubu.jpg' (file never existed on the server) -- now embedded so it needs no request and can't fail/lag */ 'data:image/jpeg;base64,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', initials: 'APC', logoUrl: 'data:image/png;base64,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' },
        { id: 'atiku',  name: 'Atiku Abubakar',     party: 'ADC', partyFull: 'African Democratic Congress', color: '#1E7A3D', accent: '#0B3D24', photoUrl: /* was '/candidates/atiku.jpg' (file never existed on the server) -- now embedded so it needs no request and can't fail/lag */ 'data:image/jpeg;base64,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', initials: 'ADC', logoUrl: 'data:image/png;base64,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' },
        { id: 'obi',    name: 'Peter Obi',          party: 'NDC', partyFull: 'Nigeria Democratic Congress', color: '#1B2260', accent: '#D22B2B', photoUrl: /* was '/candidates/obi.jpg' (file never existed on the server) -- now embedded so it needs no request and can't fail/lag */ 'data:image/jpeg;base64,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', initials: 'NDC', logoUrl: 'data:image/png;base64,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' },
        { id: 'sowore', name: 'Omoyele Sowore',     party: 'AAC', partyFull: 'African Action Congress', color: '#5C4033', accent: '#D9A441', photoUrl: /* was '/candidates/sowore.jpg' (file never existed on the server) -- now embedded so it needs no request and can't fail/lag */ 'data:image/jpeg;base64,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', initials: 'AAC', logoUrl: 'data:image/png;base64,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' },
        { id: 'makinde', name: 'Seyi Makinde', party: 'APM', partyFull: 'Allied Peoples Movement', color: '#0F2A5C', accent: '#2E9E4F', photoUrl: 'data:image/jpeg;base64,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', initials: 'APM', logoUrl: 'data:image/jpeg;base64,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' },
        { id: 'duke', name: 'Donald Duke', party: 'PRP', partyFull: 'Peoples Redemption Party', color: '#B3202A', accent: '#111111', photoUrl: 'data:image/jpeg;base64,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', initials: 'PRP', logoUrl: 'data:image/jpeg;base64,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' }
    ];

    function candidateById(id) {
        for (var i = 0; i < CANDIDATES.length; i++) if (CANDIDATES[i].id === id) return CANDIDATES[i];
        return null;
    }

    /* =========================================================================
       §0.5 — ELECTION REGISTRY (admin-managed portal switch, elections and
       candidates).

       Until now the six 2027 Nigerian presidential candidates were hard-coded
       here and the portal was always on. The Admin Panel -> Election tab now
       manages three small Firestore collections, read live here:
         election_config/active    { portalActive, defaultElectionId }
         election_events/{id}      { country, countryName, office, officeLabel,
                                     year, region, label, hashtag, open }
         election_candidates/{id}  { electionId, name, party, partyFull, color,
                                     accent, photoUrl, manifesto, order, removed }
       The built-in 2027 Nigeria presidential race below is the "legacy"
       election: it keeps its original Firestore shapes (aggregate doc
       election_results/current, un-prefixed polling-unit keys, no extra
       fields) so nothing already stored, or already enforced by the Firestore
       rules, changes. Admin candidate docs with the same id override a
       built-in candidate; { removed:true } hides one. Every other election
       is scoped by its own id (aggregate election_results/{id}, polling-unit
       docs {id}__{key} carrying electionId).

       If the three collections cannot be read (offline / rules not yet
       deployed) the registry simply stays on its built-in defaults: portal
       on, legacy election, the six built-in candidates.
       ========================================================================= */
    var LEGACY_EVENT_ID = 'ng-president-2027';
    var BUILTIN_CANDIDATES = CANDIDATES.slice();
    var BUILTIN_EVENT = { id: LEGACY_EVENT_ID, legacy: true, country: 'NG', countryName: 'Nigeria', office: 'president',
        officeLabel: 'Presidential', year: 2027, region: '', label: 'Nigeria Presidential Election 2027', hashtag: '#Vote2027', open: true, createdAt: '' };
    var REG = { config: {}, alt: null, eventDocs: [], candDocs: [], events: [BUILTIN_EVENT], activeId: LEGACY_EVENT_ID, started: false, sigs: {}, viewSig: '', cacheEv: LEGACY_EVENT_ID, tpl: {} };

    function _isAdminUser() { return !!(window.isAdmin || (window.EmpState && window.EmpState.isAdmin)); }
    /* FIX (2026-11-06 - "insufficient permission" when switching the portal OFF): the switch lives in election_config/active, but that
       collection's Firestore rules were rejecting the admin write (and may reject the public read too), so the flag never changed. The admin
       panel now falls back to app_config/branding (already admin-writable and publicly readable - the header-logo feature uses it) and stores
       { electionPortalActive, electionPortalAt } there. The most recently written of the two sources wins. */
    function portalOpen() {
        var a = REG.alt, c = REG.config || {};
        if (a && typeof a.active === 'boolean' && (typeof c.portalActive !== 'boolean' || String(a.at || '') >= String(c.updatedAt || ''))) return a.active;
        return c.portalActive !== false;
    }
    function openEvents() { return REG.events.filter(function (e) { return e.open !== false; }); }
    function _portalAllowed() { return (portalOpen() && openEvents().length > 0) || _isAdminUser(); }
    function activeEvent() {
        for (var i = 0; i < REG.events.length; i++) if (REG.events[i].id === REG.activeId) return REG.events[i];
        return REG.events[0] || BUILTIN_EVENT;
    }
    function _evIsNG() { return activeEvent().country === 'NG'; }
    function _evTitle(e) { return e.label || [e.countryName, e.region, e.officeLabel, 'Election', e.year || ''].filter(Boolean).join(' '); }
    function _isElectionText(t) { return /#Vote\d{4}/i.test(String(t == null ? '' : t)); }
    function _puDocId(ev, state, lga, ward, unit) { var k = _puKey(state, lga, ward, unit); return ev.legacy ? k : (ev.id + '__' + k); }
    function _shortName(c) { var w = String(c.name || '').trim().split(/\s+/); return w[w.length - 1] || c.name; }

    function _normEvent(d, id) {
        var yr = Number(d.year) || 0;
        return { id: id, legacy: id === LEGACY_EVENT_ID, country: d.country || 'NG', countryName: d.countryName || d.country || '',
            office: d.office || 'president', officeLabel: d.officeLabel || 'Presidential', year: yr, region: d.region || '',
            label: d.label || '', hashtag: d.hashtag || ('#Vote' + yr), open: d.open !== false, createdAt: d.createdAt || '' };
    }
    function _mergeCand(base, d) {
        var c = Object.assign({}, base);
        ['name', 'party', 'partyFull', 'color', 'accent', 'photoUrl', 'logoUrl', 'initials', 'manifesto'].forEach(function (k) { if (d[k]) c[k] = d[k]; });
        c.id = d.slot || d.id || base.id;   // admin-added candidates are tallied under a fixed slot key (s01..s16), see firebase-rules.js
        if (!c.color) c.color = '#1B2B8B';
        if (!c.accent) c.accent = '#D4AF37';
        if (!c.initials) c.initials = String(c.party || '').slice(0, 4).toUpperCase();
        if (!c.partyFull) c.partyFull = c.party || '';
        return c;
    }

    function rebuildCandidates() {
        var ev = activeEvent(), list = [], used = {};
        var docs = REG.candDocs.filter(function (d) { return d.electionId === ev.id; });
        var byId = {}; docs.forEach(function (d) { byId[d.slot || d.id] = d; });
        if (ev.legacy) {
            BUILTIN_CANDIDATES.forEach(function (b) {
                var o = byId[b.id]; used[b.id] = true;
                if (o && o.removed) return;
                list.push(o ? _mergeCand(b, o) : b);
            });
        }
        docs.slice().sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); }).forEach(function (d) {
            if (used[d.slot || d.id] || d.removed || !d.name) return;
            list.push(_mergeCand({}, d));
        });
        if (REG.cacheEv !== ev.id) {
            /* slot keys (s01..) repeat across elections: drop their cached portraits/logos; built-in ids are unique so keep them preloaded */
            REG.cacheEv = ev.id; REG.sigs = {};
            var _bi = {}; BUILTIN_CANDIDATES.forEach(function (b) { _bi[b.id] = true; });
            try {
                Object.keys(_portraitImgCache).forEach(function (k) { if (!_bi[k]) delete _portraitImgCache[k]; });
                Object.keys(_logoImgCache).forEach(function (k) { if (!_bi[k]) delete _logoImgCache[k]; });
            } catch (eC) {}
        }
        CANDIDATES.length = 0;
        list.forEach(function (c) { CANDIDATES.push(c); });

        list.forEach(function (c) {
            var sig = String(c.photoUrl || '').length + '|' + String(c.photoUrl || '').slice(-40) + '|' + String(c.logoUrl || '').slice(-40);
            if (REG.sigs[c.id] !== undefined && REG.sigs[c.id] !== sig) {
                try { delete _portraitImgCache[c.id]; delete _logoImgCache[c.id]; } catch (e) {}
            }
            REG.sigs[c.id] = sig;
        });
        if (_selectedCandidate) _selectedCandidate = candidateById(_selectedCandidate.id);

        /* NOTE: app-status.js's Election tab keeps reading its own window.EMP_ELECTION_CANDIDATES (built-in six); admin-managed candidates are not pushed there because slot ids repeat across elections. */
        try { list.forEach(function (c) { getPortraitImg(c); getLogoImg(c); }); } catch (e2) {}
    }

    function refreshEntryCards() {
        var ev = activeEvent();
        var gridHTML = CANDIDATES.map(function (c) {
            return '<button type="button" class="em-er-pick" data-cand="' + esc(c.id) + '" aria-label="Support ' + esc(c.name) + ' (' + esc(c.party) + ')" ' +
                'style="flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;cursor:pointer;font-family:inherit;">' +
                esc(_shortName(c)) + '<br><span style="font-weight:500;color:#0a1a4a;">' + esc(c.party) + '</span></button>';
        }).join('');
        document.querySelectorAll('.em-ch-grid').forEach(function (g) { g.innerHTML = gridHTML; });
        document.querySelectorAll('.em-ch-title').forEach(function (t) { t.textContent = 'Support Your ' + ev.officeLabel + ' Candidate'; });
        document.querySelectorAll('.em-ch-tag').forEach(function (t) { t.innerHTML = esc(ev.hashtag) + ' &middot; Challenge'; });
    }
    window._empRefreshElectionEntryCards = refreshEntryCards;
    window._empElectionActiveEvent = activeEvent;

    /* ---- Support-card TEMPLATE (admin-editable; election_template/active) -----------------------------------
       Every field is optional; an empty / missing field falls back to the original wording, so with no document
       the card is exactly what it always was. Placeholders: {name} {party} {hashtag} {office} {year} {country}. */
    var TPL_DEFAULTS = { ringText: 'I AM PROUD TO SUPPORT', bannerText: 'I\u2019M PROUD TO SUPPORT', brandText: 'EMPYREAN',
        tagline: '', captionTemplate: 'I\u2019m proud to support {name} {hashtag}', accentColor: '#d4af37' };
    function _tplRaw(k) { var v = REG.tpl && REG.tpl[k]; return (typeof v === 'string' && v.trim()) ? v.trim() : TPL_DEFAULTS[k]; }
    function _fillTpl(str, c) {
        var ev = activeEvent();
        return String(str).replace(/\{(name|party|hashtag|office|year|country)\}/gi, function (m, k) {
            k = k.toLowerCase();
            if (k === 'name') return (c && c.name) || '';
            if (k === 'party') return (c && c.party) || '';
            if (k === 'hashtag') return ELECTION_LABEL;
            if (k === 'office') return ev.officeLabel || '';
            if (k === 'year') return ev.year || '';
            return ev.countryName || '';
        });
    }
    function _tplText(k) { return _fillTpl(_tplRaw(k), _selectedCandidate || {}); }
    function _caption(c) {
        var out = _fillTpl(_tplRaw('captionTemplate'), c || {});
        if (!/#Vote\d{4}/i.test(out)) out += ' ' + ELECTION_LABEL;   /* the hashtag is what puts a post on the dashboard rail */
        return out;
    }
    function _hex(v) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : '#d4af37'; }
    function _rgba(hex, a) {
        var h = _hex(hex);
        return 'rgba(' + parseInt(h.substr(1, 2), 16) + ',' + parseInt(h.substr(3, 2), 16) + ',' + parseInt(h.substr(5, 2), 16) + ',' + a + ')';
    }

    function applyRegistry() {
        var legacyOv = null, others = [];
        REG.eventDocs.forEach(function (d) { if (d.id === LEGACY_EVENT_ID) legacyOv = d; else others.push(_normEvent(d, d.id)); });
        var leg = Object.assign({}, BUILTIN_EVENT);
        if (legacyOv) leg.open = legacyOv.open !== false;
        REG.events = [leg].concat(others).sort(function (a, b) { return (b.year - a.year) || String(a.createdAt).localeCompare(String(b.createdAt)); });

        var openList = openEvents();
        if (!openList.some(function (e) { return e.id === REG.activeId; })) {
            var pref = openList.filter(function (e) { return e.id === REG.config.defaultElectionId; })[0];
            REG.activeId = pref ? pref.id : (openList[0] ? openList[0].id : LEGACY_EVENT_ID);
        }
        rebuildCandidates();
        ELECTION_LABEL = activeEvent().hashtag;
        GOLD = _hex(_tplRaw('accentColor'));

        var allowedPublic = portalOpen() && openList.length > 0;
        if (document.body) document.body.classList.toggle('emp-election-off', !allowedPublic && !_isAdminUser());
        if (document.body) document.body.classList.toggle('emp-challenge-hidden', !allowedPublic); // home card + swipeable row hide for admins too (see style.css)
        refreshEntryCards();

        /* only re-render an open modal when what it shows actually changed (never wipes a half-filled uploader on an unrelated snapshot) */
        var sig = _viewSignature();
        if (sig !== REG.viewSig) { REG.viewSig = sig; _rerenderModal(true); }
    }
    function _viewSignature() {
        return JSON.stringify([_portalAllowed(), REG.activeId, REG.tpl, CANDIDATES.map(function (c) { return [c.id, c.name, c.party, c.color, c.manifesto || '', REG.sigs[c.id]]; })]);
    }

    function setActiveEvent(id) {
        if (!id || id === REG.activeId) return;
        REG.activeId = id;
        rebuildCandidates();
        ELECTION_LABEL = activeEvent().hashtag;
        _selectedCandidate = null;
        refreshEntryCards();
        REG.viewSig = _viewSignature();
        _rerenderModal(true);
    }

    function _rerenderModal(force) {
        var m = document.getElementById('election-modal');
        if (!m || !m.classList.contains('show') || !force) return;
        if (!_portalAllowed()) { renderClosedPanel(); return; }
        var rt = document.getElementById('em-tab-results');
        var onResults = !!rt && rt.style.display === 'block';
        renderSupportTab();
        if (onResults) {
            document.getElementById('em-tab-support').style.display = 'none';
            rt._pv50Built = false; _resultsLoaded = false;
            ensureResultsTabScaffold(); loadResults();
        }
    }

    function renderClosedPanel() {
        var s2 = document.getElementById('em-tab-support'), r2 = document.getElementById('em-tab-results');
        if (!s2) return;
        if (r2) r2.style.display = 'none';
        s2.style.display = 'block';
        s2.innerHTML = '<div style="text-align:center;padding:34px 8px;">' + _emIc('info', 40, 'color:var(--text-muted,#666);') +
            '<h4 style="margin:14px 0 8px;font-size:1.05rem;">The Challenge Portal Is Closed</h4>' +
            '<p style="font-size:0.84rem;line-height:1.5;color:var(--text-muted,#666);margin:0;">The \u201cI Support My Candidate\u201d challenge only runs during an election season. ' +
            'It will be switched on again when the next election approaches.</p></div>';
    }

    function _pickerHTML() {
        var list = openEvents(), ev = activeEvent();
        var title = '<div class="em-ev-title">' + esc(_evTitle(ev)) + '</div>';
        if (list.length < 2) return title;
        return title + '<div class="em-ev-row">' + list.map(function (e) {
            return '<div class="em-ev-chip' + (e.id === REG.activeId ? ' selected' : '') + '" data-em-ev="' + esc(e.id) + '">' + esc(_evTitle(e)) + '</div>';
        }).join('') + '</div>';
    }

    function startRegistry() {
        if (REG.started) return;
        var db = window.fbDb;
        if (!db || !window._firebaseLoaded) {
            REG._tries = (REG._tries || 0) + 1;
            if (REG._tries < 40) setTimeout(startRegistry, 1500);
            return;
        }
        REG.started = true;
        function snapToList(snap) { var out = []; snap.forEach(function (d) { var v = d.data() || {}; v.id = d.id; out.push(v); }); return out; }
        function quiet(err) { console.warn('[V50-Election] registry listener unavailable, staying on built-in defaults:', err && err.message); }
        db.collection('election_config').doc('active').onSnapshot(function (doc) { REG.config = doc.exists ? (doc.data() || {}) : {}; applyRegistry(); }, quiet);
        db.collection('election_events').onSnapshot(function (snap) { REG.eventDocs = snapToList(snap); applyRegistry(); }, quiet);
        db.collection('election_candidates').onSnapshot(function (snap) { REG.candDocs = snapToList(snap); applyRegistry(); }, quiet);
        db.collection('election_template').doc('active').onSnapshot(function (doc) { REG.tpl = doc.exists ? (doc.data() || {}) : {}; applyRegistry(); }, quiet);
        /* fallback copy of the portal switch (see portalOpen()) */
        db.collection('app_config').doc('branding').onSnapshot(function (doc) {
            var d = doc.exists ? (doc.data() || {}) : {};
            REG.alt = (typeof d.electionPortalActive === 'boolean') ? { active: d.electionPortalActive, at: d.electionPortalAt || '' } : null;
            applyRegistry();
        }, quiet);
    }

    /* =========================================================================
       §0 — styles
       ========================================================================= */
    function injectCSS() {
        if (document.getElementById('pv50-election-css')) return;
        var css = document.createElement('style');
        css.id = 'pv50-election-css';
        css.textContent =
            '#election-modal{position:fixed;inset:0;background:rgba(5,7,20,0.78);display:none;align-items:center;justify-content:center;z-index:1000010;backdrop-filter:blur(10px);padding:14px;}' +
            '#election-modal.show{display:flex;}' +
            '#election-modal .em-card{width:100%;max-width:460px;max-height:92vh;overflow-y:auto;background:var(--card-bg,#fff);border-radius:20px;padding:18px 18px 48px;position:relative;}' +
            '@keyframes em-spin{to{transform:rotate(360deg);}} .em-spin{animation:em-spin .9s linear infinite;}' +
            '#election-modal .em-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;border:none;background:rgba(10,14,39,0.06);cursor:pointer;font-size:0.95rem;}' +
            /* MOVED (2026-09-23): the Results/uploader tab now lives in the sidebar (app-nav.js -> window._empOpenElectionResults), so the in-modal tab bar is hidden rather than removed — the tab markup/handlers below stay intact. */
            '#election-modal .em-tabs{display:none !important;}' +
            '#election-modal .em-tabs{display:flex;gap:8px;margin:6px 0 16px;background:rgba(10,14,39,0.04);border-radius:12px;padding:4px;}' +
            '#election-modal .em-tab{flex:1;text-align:center;padding:9px 6px;border-radius:10px;font-size:0.82rem;font-weight:700;cursor:pointer;color:var(--text-muted,#666);}' +
            '#election-modal .em-tab.active{background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;}' +
            '#election-modal h4{margin:0 0 10px;font-size:0.92rem;}' +

            /* ADDED — election-results disclaimer pop-up (see showResultsDisclaimer) */
            '#em-results-disclaimer{position:fixed;inset:0;background:rgba(5,7,20,0.82);display:none;align-items:center;justify-content:center;z-index:1000020;padding:16px;}' +
            '#em-results-disclaimer.show{display:flex;}' +
            '#em-results-disclaimer .em-rd-card{width:100%;max-width:420px;max-height:90vh;overflow-y:auto;background:var(--card-bg,#fff);border-radius:18px;padding:22px 20px;text-align:center;}' +
            '#em-results-disclaimer .em-rd-icon{font-size:1.8rem;color:#D4AF37;margin-bottom:10px;}' +
            '#em-results-disclaimer h4{margin:0 0 12px;font-size:1.02rem;font-weight:800;}' +
            '#em-results-disclaimer p{margin:0 0 12px;font-size:0.85rem;line-height:1.45;color:var(--text-muted,#444);text-align:left;}' +
            '#em-results-disclaimer .em-rd-ack{margin-top:6px;width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;font-weight:800;font-size:0.88rem;cursor:pointer;}' +

            '.em-cand-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}' +
            '.em-cand-card{border:2px solid rgba(10,14,39,0.08);border-radius:14px;padding:12px 10px;text-align:center;cursor:pointer;position:relative;transition:border-color .15s;}' +
            '.em-cand-card.selected{border-color:var(--em-accent,#1B2B8B);background:rgba(27,43,139,0.05);}' +
            '.em-cand-badge{width:56px;height:56px;border-radius:50%;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:0.72rem;letter-spacing:0.02em;object-fit:cover;}' +
            '.em-cand-name{font-size:0.82rem;font-weight:700;}' +
            '.em-cand-party{font-size:0.72rem;color:var(--text-muted,#666);}' +
            '.em-cand-check{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:#22c55e;color:#fff;display:none;align-items:center;justify-content:center;font-size:0.65rem;}' +
            '.em-cand-card.selected .em-cand-check{display:flex;}' +

            '.em-photo-drop{border:2px dashed rgba(10,14,39,0.18);border-radius:14px;padding:26px 14px;text-align:center;cursor:pointer;margin-bottom:16px;}' +
            '.em-photo-drop i{font-size:1.6rem;color:var(--text-muted,#666);}' +

            '.em-preview-wrap{display:flex;justify-content:center;margin-bottom:16px;}' +
            '.em-preview-stage{position:relative;width:100%;max-width:300px;}' +
            '#em-card-canvas{display:block;width:100%;height:auto;border-radius:16px;box-shadow:0 8px 26px rgba(0,0,0,0.35);}' +
            /* ring geometry mirrors CARD_CY/ARC_R in drawCard(): centre 600/1350, ring box ~99.4% of card width */
            '.em-arc-preview{position:absolute;left:50%;top:44.44%;width:93%;aspect-ratio:1/1;transform:translate(-50%,-50%);pointer-events:none;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.55));}' +
            /* ring text slips behind the candidate portrait instead of running across it */
            '.em-arc-preview.has-portrait{-webkit-mask-image:radial-gradient(ellipse 16.1% 16.1% at 74.6% 74.6%,transparent 96%,#000 100%);mask-image:radial-gradient(ellipse 16.1% 16.1% at 74.6% 74.6%,transparent 96%,#000 100%);}' +
            '.em-arc-svg{width:100%;height:100%;animation:emArcSpin 24s linear infinite;}' +
            '@keyframes emArcSpin{to{transform:rotate(360deg);}}' +
            '@media (prefers-reduced-motion:reduce){.em-arc-svg{animation:none;}}' +
            '.em-arc-svg2{position:absolute;inset:0;width:100%;height:100%;animation:emArcSpinRev 44s linear infinite;}' +
            '@keyframes emArcSpinRev{to{transform:rotate(-360deg);}}' +
            '@media (prefers-reduced-motion:reduce){.em-arc-svg2{animation:none;}}' +

            /* background chooser (2026-09-24) */
            '.em-bg-row{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 10px;margin-bottom:12px;-webkit-overflow-scrolling:touch;}' +
            '.em-bg-sw{flex:0 0 auto;width:58px;text-align:center;cursor:pointer;font-size:0.62rem;font-weight:700;color:var(--text-muted,#666);}' +
            '.em-bg-dot{display:block;width:50px;height:50px;border-radius:50%;margin:0 auto 4px;border:2px solid rgba(10,14,39,0.12);box-shadow:inset 0 0 0 2px rgba(255,255,255,0.35);background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;transition:transform .15s,border-color .15s;}' +
            '.em-bg-sw.selected .em-bg-dot{border-color:#d4af37;box-shadow:0 0 0 3px rgba(212,175,55,0.45);transform:scale(1.06);}' +
            '.em-bg-sw.selected{color:var(--text,#111);}' +
            '.em-actions{display:flex;gap:10px;flex-wrap:wrap;}' +
            '.em-actions button{flex:1;min-width:120px;padding:11px 10px;border-radius:24px;border:none;font-weight:700;font-size:0.82rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;}' +
            '.em-btn-primary{background:linear-gradient(135deg,#00D4AA,#00b391);color:#fff;}' +
            '.em-btn-secondary{background:rgba(10,14,39,0.06);}' +
            '.em-btn-share{background:rgba(37,211,102,0.12);color:#128C43;}' +

            '.em-dash-row{display:flex;align-items:center;gap:10px;margin-bottom:12px;}' +
            '.em-dash-name{flex:0 0 108px;font-size:0.78rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.em-dash-bar-track{flex:1;height:16px;border-radius:8px;background:rgba(10,14,39,0.06);overflow:hidden;}' +
            '.em-dash-bar-fill{height:100%;border-radius:8px;transition:width .5s ease;}' +
            '.em-dash-pct{flex:0 0 46px;text-align:right;font-size:0.78rem;font-weight:800;}' +
            '.em-dash-note{font-size:0.72rem;color:var(--text-muted,#666);margin-top:10px;line-height:1.4;}' +
            '.em-dash-meta{font-size:0.7rem;color:var(--text-muted,#666);margin-bottom:14px;}' +
            '.em-ev-title{font-size:0.74rem;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:var(--text-muted,#666);margin:2px 34px 8px 0;}' +
            '.em-ev-row{display:flex;gap:8px;overflow-x:auto;padding:2px 0 12px;-webkit-overflow-scrolling:touch;}' +
            '.em-ev-chip{flex:0 0 auto;padding:7px 12px;border-radius:999px;font-size:0.74rem;font-weight:700;cursor:pointer;background:rgba(10,14,39,0.06);color:var(--text,#111);white-space:nowrap;}' +
            '.em-ev-chip.selected{background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;}';
        document.head.appendChild(css);
    }

    /* =========================================================================
       §1 — (status-bar entry tile removed per feedback — the ballot-box
       tile shouldn't sit in the status bar; the election modal is still
       reachable via Quick Post's composer icon through the
       window._empOpenElectionModal hook below.)
       ========================================================================= */

    /* =========================================================================
       §2 — modal shell + tabs
       ========================================================================= */
    var _selectedCandidate = null;
    var _photoImg = null; // loaded <img> of the user's chosen photo
    var _logoImgCache = {}; // candidate.id -> loaded <img> of c.logoUrl, filled lazily
    var _portraitImgCache = {}; // candidate.id -> loaded <img> of c.photoUrl (false = none found)
    var _portraitDrawn = false; // true when the last drawCard() actually painted a candidate portrait

    /* Sliding entrance animation for the candidate portrait (2026-09-23 —
       "give the picture a sliding or any suitable animation effect"). The
       portrait is baked straight into the <canvas> (see drawCard() below),
       so CSS transitions can't touch it — the animation is driven by
       re-running drawCard() every frame via requestAnimationFrame while
       interpolating the portrait's offset/scale/opacity toward its resting
       spot. _animatePortraitOnDraw is set true right before drawCard() at
       every point the portrait should visibly "arrive" (candidate picked,
       user photo picked, or the portrait image finishing its first load);
       drawCard() consumes it exactly once, the moment a portrait is
       actually available to draw. Static exports (Save/Share/Post, which
       set _bakeArc) and prefers-reduced-motion always skip straight to the
       resting frame. */
    var _animatePortraitOnDraw = true;
    var _portraitAnimRAF = null;
    var _portraitAnimStart = 0;
    var _portraitAnimDuration = 550; // ms
    var _portraitAnimCandidateId = null;
    var _portraitProgress = 1; // 0 = just starting to slide in, 1 = at rest
    var _prefersReducedMotion = false;
    try { _prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

    function runPortraitEntranceAnim() {
        if (_portraitAnimRAF) cancelAnimationFrame(_portraitAnimRAF);
        _portraitAnimStart = (window.performance && performance.now) ? performance.now() : Date.now();
        var step = function (now) {
            now = now || ((window.performance && performance.now) ? performance.now() : Date.now());
            var t = Math.min(1, (now - _portraitAnimStart) / _portraitAnimDuration);
            _portraitProgress = 1 - Math.pow(1 - t, 3); // ease-out cubic
            drawCard();
            if (t < 1) {
                _portraitAnimRAF = requestAnimationFrame(step);
            } else {
                _portraitAnimRAF = null;
                _portraitProgress = 1;
            }
        };
        _portraitAnimRAF = requestAnimationFrame(step);
    }

    /* Candidate portrait for the card (2026-09-23 — \"add the presidential
       candidate picture to overlap the bottom of the user's picture\").
       Loads /candidates/<id>.jpg (falls back to .png) from the app's own
       public/ folder; crossOrigin is set so a same-site/CORS-enabled image
       never taints the canvas (a tainted canvas can't be exported). If no image
       exists the card simply renders without a portrait — nothing breaks. */
    /* SUPERSEDED (2026-09-23 -- "add the presidential candidate's picture ... overlap the
       bottom of the user's picture", reported again with no portrait visible): the loader
       below only tried <photoUrl> and a .png twin, gave up silently, and never redrew --
       so a missing/differently-named file (e.g. obi.jpeg, OBI.JPG) meant NO portrait and no
       hint why. Also note the server's SPA catch-all answers a missing /candidates/x.jpg with
       index.html (not a 404), which the <img> rejects, so it falls through to onerror.
    function getPortraitImg(c) {
        if (!c.photoUrl) return null;
        var cached = _portraitImgCache[c.id];
        if (cached === undefined) {
            _portraitImgCache[c.id] = null; // loading
            var tryLoad = function (url, allowAlt) {
                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () { _portraitImgCache[c.id] = img; drawCard(); };
                img.onerror = function () {
                    if (allowAlt && /\.jpg$/i.test(url)) tryLoad(url.replace(/\.jpg$/i, '.png'), false);
                    else _portraitImgCache[c.id] = false;
                };
                img.src = url;
            };
            tryLoad(c.photoUrl, true);
            return null;
        }
        return cached || null;
    }

    */
    function getPortraitImg(c) {
        if (!c.photoUrl) return null;
        var cached = _portraitImgCache[c.id];
        if (cached === undefined) {
            _portraitImgCache[c.id] = null; // loading
            var base = c.photoUrl.replace(/\.(jpe?g|png|webp)$/i, '');
            var urls = /^(data:|blob:)/i.test(c.photoUrl) ? [c.photoUrl] :
                [c.photoUrl, base + '.jpg', base + '.jpeg', base + '.png', base + '.webp', base + '.JPG', base + '.JPEG', base + '.PNG']
                    .filter(function (u, i, arr) { return arr.indexOf(u) === i; });
            var idx = 0;
            var tryLoad = function () {
                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () { _portraitImgCache[c.id] = img; drawCard(); };
                img.onerror = function () {
                    idx++;
                    if (idx < urls.length) tryLoad();
                    else {
                        _portraitImgCache[c.id] = false; // nothing found -> drawCard() paints the initials medallion
                        console.warn('[V50-Election] No portrait file found for ' + c.id + ' (tried ' + urls.join(', ') + ') -- add public' + c.photoUrl);
                        drawCard();
                    }
                };
                img.src = urls[idx];
            };
            tryLoad();
            return null;
        }
        return cached || null;
    }

    /* Stand-in shown only when a candidate has no portrait file yet: a candidate-coloured
       medallion with a head-and-shoulders silhouette and the candidate's initials, so the
       overlapping-portrait layout (and its slide-in) is still visible/exportable. */
    function drawPortraitPlaceholder(ctx, c, px, py, pr) {
        ctx.fillStyle = shade(c.color, -0.25);
        ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.arc(px, py - pr * 0.22, pr * 0.34, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(px, py + pr * 0.78, pr * 0.72, pr * 0.62, 0, Math.PI, 0); ctx.fill();
        var ini = c.name.trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
        ctx.fillStyle = GOLD;
        ctx.font = '800 ' + Math.round(pr * 0.5) + 'px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ini, px, py + pr * 0.02);
    }

    /* Returns the cached <img> for this candidate's party logo, kicking off
       a load (and a redraw once it lands) the first time it's asked for.
       Callers should treat a null return as "not ready yet — fall back to
       the text badge for this frame". */
    function getLogoImg(c) {
        if (!c.logoUrl) return null;
        var cached = _logoImgCache[c.id];
        if (cached === undefined) {
            var img = new Image();
            _logoImgCache[c.id] = null; // mark as "loading" so we don't refetch
            img.onload = function () { _logoImgCache[c.id] = img; drawCard(); };
            img.onerror = function () { _logoImgCache[c.id] = false; }; // give up, keep text fallback
            img.src = c.logoUrl;
            return null;
        }
        return cached || null;
    }

    function ensureModal() {
        if (document.getElementById('election-modal')) return;
        var modal = document.createElement('div');
        modal.id = 'election-modal';
        modal.innerHTML =
            '<div class="em-card">' +
            '<button type="button" class="em-close" id="em-close-btn">' + _emIc('x', 18) + '</button>' +
            '<div class="em-tabs">' +
            '<div class="em-tab active" data-em-tab="support">I Support</div>' +
            '<div class="em-tab" data-em-tab="results">Results</div>' +
            '</div>' +
            '<div id="em-tab-support"></div>' +
            '<div id="em-tab-results" style="display:none;"></div>' +
            '</div>';
        document.body.appendChild(modal);

        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeModal();
        });
        document.getElementById('em-close-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', function (e) {
            var chip = e.target && e.target.closest ? e.target.closest('.em-ev-chip') : null;
            if (chip) setActiveEvent(chip.getAttribute('data-em-ev'));
        });
        modal.querySelectorAll('.em-tab').forEach(function (tab) {
            tab.addEventListener('click', function () { switchTab(tab.dataset.emTab); });
        });
    }

    function switchTab(name) {
        if (!_portalAllowed()) { renderClosedPanel(); return; }
        document.querySelectorAll('#election-modal .em-tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.emTab === name);
        });
        document.getElementById('em-tab-support').style.display = name === 'support' ? 'block' : 'none';
        document.getElementById('em-tab-results').style.display = name === 'results' ? 'block' : 'none';
        if (name === 'results') {
            showResultsDisclaimer(function () { ensureResultsTabScaffold(); loadResults(); });
        }
    }

    /* ADDED (request — "disclaimer that the election collation/collection in
       Empyrean is just for research purposes and studies and to boost
       transparency and strengthen election credibility in Nigeria, not the
       official election announcement channel, INEC is the only recognized
       electoral body eligible to officially announce results"): shown as a
       blocking pop-up the moment the Results tab is opened — from either
       entry point (the in-modal tab click, and the sidebar's
       window._empOpenElectionResults) since both funnel through switchTab()
       above. The underlying results scaffold/loader only runs once the user
       acknowledges. Shown every time the tab is opened (not just once per
       session), since this is a standing legal/credibility notice rather
       than a one-off tip. */
    function ensureResultsDisclaimerModal() {
        if (document.getElementById('em-results-disclaimer')) return;
        var d = document.createElement('div');
        d.id = 'em-results-disclaimer';
        d.innerHTML =
            '<div class="em-rd-card">' +
            '<div class="em-rd-icon">' + _emIc('info', 34) + '</div>' +
            '<h4>Before you continue</h4>' +
            '<p>The election data collated and shown in Empyrean is provided ' +
            'strictly for research, study, and civic-transparency purposes — ' +
            'to help boost public confidence and strengthen the credibility ' +
            'of elections in Nigeria.</p>' +
            '<p><strong>Empyrean is not an official election announcement ' +
            'channel.</strong> The Independent National Electoral Commission ' +
            '(INEC) is the only body recognized and eligible to officially ' +
            'announce election results.</p>' +
            '<button type="button" id="em-rd-ack-btn" class="em-rd-ack">I Understand, Continue</button>' +
            '</div>';
        document.body.appendChild(d);
    }
    function showResultsDisclaimer(onAck) {
        injectCSS();
        ensureResultsDisclaimerModal();
        var d = document.getElementById('em-results-disclaimer');
        var _ps = d.querySelectorAll('p');
        if (_ps.length > 1) {
            if (!d._ngHtml) d._ngHtml = [_ps[0].innerHTML, _ps[1].innerHTML];
            if (_evIsNG()) { _ps[0].innerHTML = d._ngHtml[0]; _ps[1].innerHTML = d._ngHtml[1]; }
            else {
                _ps[0].textContent = 'The election data collated and shown in Empyrean is provided strictly for research, study, and civic-transparency purposes \u2014 to help boost public confidence and strengthen the credibility of elections.';
                _ps[1].innerHTML = '<strong>Empyrean is not an official election announcement channel.</strong> Only the country\u2019s recognised electoral authority is eligible to officially announce election results.';
            }
        }
        d.classList.add('show');
        var btn = document.getElementById('em-rd-ack-btn');
        var handler = function () {
            d.classList.remove('show');
            btn.removeEventListener('click', handler);
            onAck();
        };
        btn.addEventListener('click', handler);
    }

    function openModal() {
        if (window._isGuest || (window.EmpState && window.EmpState.isGuest)) {
            if (typeof window.openAuthModal === 'function') { window.openAuthModal('login'); return; }
        }
        ensureModal();
        if (!_portalAllowed()) {
            renderClosedPanel();
            var _cm = document.getElementById('election-modal');
            _cm.style.display = 'flex'; _cm.classList.add('show');
            return;
        }
        renderSupportTab();
        var modal = document.getElementById('election-modal');
        modal.style.display = 'flex';
        modal.classList.add('show');
        switchTab('support');
    }
    function closeModal() {
        var modal = document.getElementById('election-modal');
        if (_resultsUnsub) { try { _resultsUnsub(); } catch (e) {} _resultsUnsub = null; }
        _resultsLoaded = false;
        if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; }
    }

    /* =========================================================================
       §3 — "I Support" tab: candidate grid + photo + canvas card
       ========================================================================= */
    /* FIX (2026-10-31 - "replace the emojis in the I support my presidential candidate challenge with premium icons"): the
       fa-camera / fa-download / fa-whatsapp / fa-bullhorn / fa-paper-plane glyphs on the "I Support" tab render as colour emoji
       (camera, arrow, chat bubble, megaphone, plane). Replaced here with thin-line inline SVGs in the button's own colour.
       Only the "I Support" tab's icons are swapped; every handler, id and label is unchanged. */
    function _emIc(name, size, extraStyle, cls) {
        /* function declaration (hoisted) so every caller in this IIFE can use it regardless of where it runs */
        var P = {
            camera:  '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
            download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
            share:   '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
            megaphone:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
            send:    '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
            x:       '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
            info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
            check:   '<path d="M20 6 9 17l-5-5"/>',
            image:   '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
            spinner: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
            alert:   '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
            okcircle:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
            refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
        };
        size = size || 18;
        return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + ' style="flex-shrink:0;vertical-align:-3px;' + (extraStyle || '') + '">' + P[name] + '</svg>';
    }

    function renderSupportTab() {
        var host = document.getElementById('em-tab-support');
        if (!CANDIDATES.length) {
            host.innerHTML = _pickerHTML() + '<div style="text-align:center;padding:30px 8px;font-size:0.84rem;color:var(--text-muted,#666);">No candidates have been added for this election yet. Please check back soon.</div>';
            return;
        }
        host.innerHTML =
            _pickerHTML() +
            '<h4>1. Choose who you support</h4>' +
            '<div class="em-cand-grid" id="em-cand-grid"></div>' +
            '<div id="em-manifesto" style="display:none;margin:-6px 0 16px;padding:10px 12px;border-radius:12px;background:rgba(10,14,39,0.04);font-size:0.78rem;line-height:1.45;white-space:pre-wrap;"></div>' +
            '<h4>2. Add your photo</h4>' +
            '<div class="em-photo-drop" id="em-photo-drop">' +
            _emIc('camera', 32, 'color:var(--text-muted,#666);') + '<div style="margin-top:8px;font-size:0.82rem;">Tap to add a photo</div>' +
            '<input type="file" accept="image/*" id="em-photo-input" style="display:none;">' +
            '</div>' +
            /* was: '<h4>3. Preview</h4>' + */
            '<h4>3. Choose a background</h4>' +
            '<div class="em-bg-row" id="em-bg-row"></div>' +
            '<input type="file" accept="image/*" id="em-bg-input" style="display:none;">' +
            '<h4>4. Preview</h4>' +
            '<div class="em-preview-wrap"><div class="em-preview-stage"><canvas id="em-card-canvas" width="1080" height="1350"></canvas><div class="em-arc-preview" id="em-arc-preview"></div></div></div>' +
            '<div class="em-actions">' +
            '<button type="button" class="em-btn-secondary" id="em-save-btn">' + _emIc('download') + ' Save</button>' +
            '<button type="button" class="em-btn-share" id="em-share-btn">' + _emIc('share') + ' Share</button>' +
            '<button type="button" class="em-btn-primary" id="em-dash-btn">' + _emIc('megaphone') + ' Post to Dashboard</button>' +
            '<button type="button" class="em-btn-primary" id="em-post-btn">' + _emIc('send') + ' Post to My Status</button>' +
            '</div>';

        var grid = document.getElementById('em-cand-grid');
        CANDIDATES.forEach(function (c) {
            var card = document.createElement('div');
            card.className = 'em-cand-card';
            card.dataset.emId = c.id;
            var badgeInner = c.logoUrl
                ? '<img src="' + esc(c.logoUrl) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">'
                : esc(c.initials);
            card.innerHTML =
                '<div class="em-cand-check">' + _emIc('check', 12, 'stroke-width:3;vertical-align:0;') + '</div>' +
                '<div class="em-cand-badge" style="background:' + c.color + ';">' + badgeInner + '</div>' +
                '<div class="em-cand-name">' + esc(c.name) + '</div>' +
                '<div class="em-cand-party">' + esc(c.party) + '</div>';
            card.addEventListener('click', function () { selectCandidate(c.id); });
            grid.appendChild(card);
        });
        if (_selectedCandidate) selectCandidate(_selectedCandidate.id); else selectCandidate(CANDIDATES[0].id);

        var drop = document.getElementById('em-photo-drop');
        var input = document.getElementById('em-photo-input');
        drop.addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
            var f = input.files && input.files[0];
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () {
                    _photoImg = img;
                    // New photo picked — replay the portrait's entrance so it
                    // visibly settles over the freshly-placed photo.
                    _animatePortraitOnDraw = true;
                    drawCard();
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(f);
        });

        buildBackgroundRow();

        document.getElementById('em-save-btn').addEventListener('click', saveCard);
        document.getElementById('em-share-btn').addEventListener('click', shareCard);
        document.getElementById('em-dash-btn').addEventListener('click', postCardToDashboard);
        document.getElementById('em-post-btn').addEventListener('click', postCardToStatus);

        drawCard();
    }

    function selectCandidate(id) {
        _selectedCandidate = candidateById(id);
        var _mf = document.getElementById('em-manifesto');
        if (_mf) { var _mt = _selectedCandidate && _selectedCandidate.manifesto; _mf.style.display = _mt ? 'block' : 'none'; _mf.textContent = _mt || ''; }
        document.querySelectorAll('.em-cand-card').forEach(function (el) {
            el.classList.toggle('selected', el.dataset.emId === id);
        });
        var host = document.getElementById('election-modal');
        if (host) host.style.setProperty('--em-accent', _selectedCandidate.color);
        var _pd = document.getElementById('em-bg-party-dot');
        if (_pd) _pd.style.background = 'linear-gradient(135deg,' + _selectedCandidate.color + ',#050510)';
        // New candidate picked — let the portrait slide back in over the photo.
        _animatePortraitOnDraw = true;
        drawCard();
    }

    var GOLD = '#d4af37';

    /* =========================================================================
       CARD BACKGROUNDS (2026-09-24 -- "a better, more polished / premium
       background, or let the user upload one of their choice").
       'party' = the original candidate-colour gradient (default). The presets
       are drawn procedurally (gradient + gold light rays + fine lattice +
       soft bokeh) so they cost no image bytes; 'custom' uses the user's own
       image, darkened so the gold ring text / banner stay readable. The choice
       is baked into the canvas, so Save / Share / Post all include it.
       ========================================================================= */
    /* SUPERSEDED (2026-09-24 -- "classic colours, picture backgrounds, remove the covering layer"): the earlier
       textured presets + lattice / gold rays / bokeh / vignette block, preserved below; the replacement follows.
    var BACKGROUNDS = [
        { id: 'party',    label: 'Party' },
        { id: 'royal',    label: 'Royal',    a: '#1b2f9a', b: '#3346c2', c: '#050a2b', dot: 'linear-gradient(135deg,#3346c2,#050a2b)' },
        { id: 'emerald',  label: 'Emerald',  a: '#0f7a47', b: '#1fa05f', c: '#03261a', dot: 'linear-gradient(135deg,#1fa05f,#03261a)' },
        { id: 'midnight', label: 'Midnight', a: '#2a2a33', b: '#454552', c: '#060608', dot: 'linear-gradient(135deg,#454552,#060608)' },
        { id: 'crimson',  label: 'Crimson',  a: '#8a1435', b: '#b32549', c: '#2a0511', dot: 'linear-gradient(135deg,#b32549,#2a0511)' },
        { id: 'naija',    label: 'Naija',    a: '#0a7a3d', b: '#22a85e', c: '#02220f', dot: 'linear-gradient(90deg,#0a7a3d 33%,#f2f6f2 33% 66%,#0a7a3d 66%)' },
        { id: 'custom',   label: 'Upload' }
    ];
    var _bgId = 'party';
    var _bgImg = null; // user's own background (a downscaled <canvas>)

    function _bgRand(seed) { // tiny seeded PRNG -> same decoration on every frame
        var x = seed >>> 0;
        return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
    }

    function drawBackground(ctx, W, H, c, cx, cy, radius) {
        var def = null, i;
        for (i = 0; i < BACKGROUNDS.length; i++) if (BACKGROUNDS[i].id === _bgId) def = BACKGROUNDS[i];

        if (_bgId === 'custom' && _bgImg) {
            drawImageCover(ctx, _bgImg, 0, 0, W, H);
            var dk = ctx.createLinearGradient(0, 0, 0, H);
            dk.addColorStop(0, 'rgba(0,0,0,0.30)');
            dk.addColorStop(0.5, 'rgba(0,0,0,0.38)');
            dk.addColorStop(1, 'rgba(0,0,0,0.70)');
            ctx.fillStyle = dk;
            ctx.fillRect(0, 0, W, H);
        } else if (def && def.a) {
            var g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, def.b);
            g.addColorStop(0.5, def.a);
            g.addColorStop(1, def.c);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);

            // fine diagonal lattice (classic engraved-note texture)
            ctx.save();
            ctx.strokeStyle = 'rgba(212,175,55,0.07)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (i = -H; i < W + H; i += 54) { ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.moveTo(i + H, 0); ctx.lineTo(i, H); }
            ctx.stroke();
            ctx.restore();

            // soft gold light rays fanning out from behind the avatar
            ctx.save();
            ctx.translate(cx, cy);
            for (i = 0; i < 18; i++) {
                var ang = (i / 18) * Math.PI * 2, wdt = 0.07;
                var ray = ctx.createRadialGradient(0, 0, radius * 0.9, 0, 0, W * 1.05);
                ray.addColorStop(0, 'rgba(255,220,120,0.13)');
                ray.addColorStop(1, 'rgba(255,220,120,0)');
                ctx.fillStyle = ray;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, W * 1.05, ang, ang + wdt);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();

            // bokeh sparkles
            var rnd = _bgRand(7);
            for (i = 0; i < 26; i++) {
                var bx = rnd() * W, by = rnd() * H * 0.85, br = 8 + rnd() * 26;
                ctx.beginPath();
                ctx.arc(bx, by, br, 0, Math.PI * 2);
                ctx.fillStyle = (i % 3 === 0) ? 'rgba(255,215,110,0.10)' : 'rgba(255,255,255,0.06)';
                ctx.fill();
            }
            if (def.id === 'naija') { // soft white centre band -- a nod to the flag
                var nb = ctx.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
                nb.addColorStop(0, 'rgba(255,255,255,0)');
                nb.addColorStop(0.5, 'rgba(255,255,255,0.10)');
                nb.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = nb;
                ctx.fillRect(0, 0, W, H);
            }
        } else {
            // 'party' (default): the original candidate-colour gradient
            var grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, shade(c.color, 0.14));
            grad.addColorStop(0.5, c.color);
            grad.addColorStop(1, shade(c.color, -0.55));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);
        }

        // soft vignette over every background
        var vig = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, H * 0.55, W * 0.95);
        vig.addColorStop(0, 'rgba(255,255,255,0.08)');
        vig.addColorStop(1, 'rgba(0,0,0,0.30)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);
    }

    function updateBgSelection() {
        document.querySelectorAll('#em-bg-row .em-bg-sw').forEach(function (el) {
            el.classList.toggle('selected', el.dataset.bg === _bgId);
        });
        var cd = document.getElementById('em-bg-custom-dot');
        if (cd && _bgImg) {
            try { cd.style.backgroundImage = 'url(' + _bgImg.toDataURL('image/jpeg', 0.5) + ')'; cd.textContent = ''; } catch (e) {}
        }
    }

    function buildBackgroundRow() {
        var row = document.getElementById('em-bg-row');
        var input = document.getElementById('em-bg-input');
        if (!row || !input) return;
        row.innerHTML = '';
        BACKGROUNDS.forEach(function (b) {
            var sw = document.createElement('div');
            sw.className = 'em-bg-sw';
            sw.dataset.bg = b.id;
            var dotStyle = b.id === 'party' ? '' : (b.id === 'custom' ? 'background:#e9ecf5;color:#1B2B8B;' : 'background:' + b.dot + ';');
            var inner = b.id === 'custom' ? _emIc('image', 16, 'vertical-align:0;') : '';
            sw.innerHTML = '<span class="em-bg-dot"' + (b.id === 'custom' ? ' id="em-bg-custom-dot"' : '') + ' style="' + dotStyle + '">' + inner + '</span>' + esc(b.label);
            if (b.id === 'party') {
                // swatch tracks the selected candidate's colour
                var d = sw.firstChild;
                d.style.background = 'linear-gradient(135deg,' + (_selectedCandidate ? _selectedCandidate.color : '#1B2B8B') + ',#050510)';
                d.id = 'em-bg-party-dot';
            }
            sw.addEventListener('click', function () {
                if (b.id === 'custom' && (!_bgImg || _bgId === 'custom')) { input.click(); return; }
                _bgId = b.id;
                updateBgSelection();
                drawCard();
            });
            row.appendChild(sw);
        });
        input.onchange = function () {
            var f = input.files && input.files[0];
            input.value = '';
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () {
                    // downscale (longest side 1600px) so a 12MP photo doesn't make every redraw heavy
                    var k = Math.min(1, 1600 / Math.max(img.width, img.height));
                    var cv = document.createElement('canvas');
                    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
                    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                    _bgImg = cv;
                    _bgId = 'custom';
                    updateBgSelection();
                    drawCard();
                };
                img.onerror = function () { notify('That image could not be used as a background.', 'error'); };
                img.src = reader.result;
            };
            reader.readAsDataURL(f);
        };
        updateBgSelection();
    }
    */
    var BACKGROUNDS = [
        { id: 'party',  label: 'Party' },
        /* classic primary colours (2026-09-24 -- "use just primary premium classic colors"): clean 3-stop
           gradients, no texture layers */
        { id: 'navy',   label: 'Navy',  a: '#0f3a94', b: '#1f56c4', c: '#040d2a', dot: 'linear-gradient(135deg,#1f56c4,#040d2a)' },
        { id: 'green',  label: 'Green', a: '#0a7a40', b: '#13a355', c: '#02220f', dot: 'linear-gradient(135deg,#13a355,#02220f)' },
        { id: 'red',    label: 'Red',   a: '#a4131f', b: '#cf2233', c: '#2c050a', dot: 'linear-gradient(135deg,#cf2233,#2c050a)' },
        { id: 'black',  label: 'Black', a: '#1e1e23', b: '#34343c', c: '#000000', dot: 'linear-gradient(135deg,#34343c,#000)' },
        /* picture backgrounds -- painted in code (no image files) and cached per size */
        { id: 'flag',   label: 'Flag',   pic: true },
        /* reference-image backgrounds (2026-09-24 -- "background like the above": 3D flag maps + coat of arms).
           The procedural { arms } and { map } drawings were superseded by these. */
        { id: 'flagmap',  label: 'Flag Map',  pic: true },
        { id: 'map3d',    label: '3D Map',    pic: true },
        { id: 'claymap',  label: 'Clay Map',  pic: true },
        { id: 'arms',     label: 'Arms',      pic: true },
        { id: 'flagarms', label: 'Flag+Arms', pic: true },
        { id: 'ribbon', label: 'Ribbon', pic: true },
        { id: 'custom', label: 'Upload' }
        /* SUPERSEDED presets (Royal / Emerald / Midnight / Crimson / Naija textured gradients) removed on request */
    ];
    var _bgId = 'party';
    var _bgImg = null; // user's own background (a downscaled <canvas>)

    /* ---- picture backgrounds: painted once per size into an offscreen canvas ---- */
    var _bgLayerCache = {};
    function _bgLayer(id, W, H) {
        var key = id + ':' + W + 'x' + H;
        if (_bgLayerCache[key]) return _bgLayerCache[key];
        var cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        var x = cv.getContext('2d');
        x.save();
        x.scale(W / 1080, H / 1350); // painters work in the 1080x1350 design space
        var ready = true;
        try { ready = BG_PAINTERS[id](x) !== false; } catch (e) { console.warn('[V50-Election] bg paint failed:', id, e && e.message); }
        x.restore();
        if (ready) _bgLayerCache[key] = cv; // an image still loading is repainted (and cached) once it lands
        return cv;
    }
    function _tmpCanvas() {
        var t = document.createElement('canvas');
        t.width = 1080; t.height = 1350;
        return t;
    }

    function _paintFlag(x) {
        x.fillStyle = '#f4f6f4';
        x.fillRect(0, 0, 1080, 1350);
        var edge = function (x0, ph) { return function (y) { return x0 + 24 * Math.sin(y / 1350 * Math.PI * 3 + ph) + 8 * Math.sin(y / 1350 * Math.PI * 7 + ph * 2); }; };
        var e1 = edge(360, 0), e2 = edge(720, 1.2), y;
        x.fillStyle = '#008751';
        x.beginPath(); x.moveTo(0, 0);
        for (y = 0; y <= 1350; y += 15) x.lineTo(e1(y), y);
        x.lineTo(0, 1350); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(1080, 0);
        for (y = 0; y <= 1350; y += 15) x.lineTo(e2(y), y);
        x.lineTo(1080, 1350); x.closePath(); x.fill();
        // cloth folds
        var g = x.createLinearGradient(0, 0, 1080, 760);
        var st = [0, .12, .25, .38, .5, .62, .75, .88, 1];
        st.forEach(function (p, i) { g.addColorStop(p, i % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.20)'); });
        x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
        // BRIGHTENED (request — "don't want it dark, make it brighter, remove
        // layers that make it dark"): the banner already carries its own
        // solid dark bar for text contrast, so this extra fade is kept only
        // as a very light touch rather than darkening most of the card.
        var d = x.createLinearGradient(0, 0, 0, 1350);
        d.addColorStop(0, 'rgba(0,18,8,0)'); d.addColorStop(0.7, 'rgba(0,18,8,0.05)'); d.addColorStop(1, 'rgba(0,18,8,0.16)');
        x.fillStyle = d; x.fillRect(0, 0, 1080, 1350);
    }

    // Nigeria's outline as [lon, lat] pairs (stylised, clockwise from the SW corner)
    var _NG = [[2.70,6.40],[2.72,7.10],[2.76,7.90],[2.78,8.45],[3.00,8.95],[3.35,9.55],[3.60,10.10],[3.72,10.90],[3.60,11.70],
        [3.90,11.95],[4.15,12.60],[4.20,13.45],[4.80,13.72],[5.60,13.86],[6.40,13.62],[7.20,13.55],[8.00,13.30],[8.80,13.30],[9.30,13.40],
        [10.20,13.28],[11.10,13.35],[12.10,13.40],[12.90,13.45],[13.50,13.70],[14.00,13.10],[14.35,13.05],[14.62,12.60],[14.58,12.10],
        [14.55,11.55],[14.10,11.20],[13.80,10.85],[13.70,10.20],[13.50,9.50],[13.10,9.15],[12.85,8.70],[12.50,8.10],[12.15,7.50],
        [11.70,7.05],[11.10,6.70],[10.60,6.95],[10.15,6.90],[9.80,6.75],[9.40,6.60],[9.05,6.20],[8.90,5.75],[8.70,5.15],[8.60,4.75],
        [8.45,4.50],[8.00,4.45],[7.55,4.42],[7.05,4.42],[6.55,4.35],[6.15,4.28],[5.80,4.50],[5.55,4.95],[5.30,5.30],[5.00,5.60],
        [4.60,5.95],[4.00,6.30],[3.40,6.40],[3.00,6.40]];
    var _NIGER = [[3.6,11.7],[4.5,10.8],[5.4,9.9],[6.0,9.0],[6.7,8.0],[6.75,7.8],[6.3,6.5],[6.1,5.2],[6.0,4.4]];
    var _BENUE = [[12.0,9.3],[11.0,9.5],[10.0,8.9],[9.0,8.3],[7.9,7.9],[6.75,7.8]];

    function _paintMap(x) {
        var g = x.createLinearGradient(0, 0, 0, 1350);
        g.addColorStop(0, '#06361f'); g.addColorStop(0.55, '#03150c'); g.addColorStop(1, '#010604');
        x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
        var glow = x.createRadialGradient(540, 620, 60, 540, 620, 720);
        glow.addColorStop(0, 'rgba(0,135,81,0.35)'); glow.addColorStop(1, 'rgba(0,135,81,0)');
        x.fillStyle = glow; x.fillRect(0, 0, 1080, 1350);
        // fine dot grid, like a map graticule
        x.fillStyle = 'rgba(255,255,255,0.10)';
        for (var gx = 27; gx < 1080; gx += 54) for (var gy = 27; gy < 1350; gy += 54) { x.beginPath(); x.arc(gx, gy, 1.6, 0, Math.PI * 2); x.fill(); }
        var P = function (p) { return [540 + (p[0] - 8.7) * 90, 640 - (p[1] - 9.1) * 90]; };
        var path = function (pts, close) {
            x.beginPath();
            pts.forEach(function (p, i) { var q = P(p); if (i) x.lineTo(q[0], q[1]); else x.moveTo(q[0], q[1]); });
            if (close) x.closePath();
        };
        x.lineJoin = 'round'; x.lineCap = 'round';
        path(_NG, true);
        var f = x.createLinearGradient(0, 240, 0, 1040);
        f.addColorStop(0, 'rgba(24,166,96,0.85)'); f.addColorStop(1, 'rgba(0,100,58,0.85)');
        x.fillStyle = f; x.fill();
        x.save(); x.shadowColor = 'rgba(212,175,55,0.8)'; x.shadowBlur = 22;
        x.lineWidth = 6; x.strokeStyle = '#d4af37'; x.stroke(); x.restore();
        // the Niger / Benue "Y"
        x.lineWidth = 7; x.strokeStyle = 'rgba(150,215,255,0.60)';
        path(_NIGER, false); x.stroke();
        path(_BENUE, false); x.stroke();
        // Abuja
        var a = P([7.49, 9.06]);
        var ag = x.createRadialGradient(a[0], a[1], 2, a[0], a[1], 46);
        ag.addColorStop(0, 'rgba(255,225,120,0.9)'); ag.addColorStop(1, 'rgba(255,225,120,0)');
        x.fillStyle = ag; x.beginPath(); x.arc(a[0], a[1], 46, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#ffe28a'; x.beginPath();
        for (var i = 0; i < 10; i++) { var r = i % 2 ? 9 : 22, an = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(a[0] + r * Math.cos(an), a[1] + r * Math.sin(an)); }
        x.closePath(); x.fill();
    }

    function _paintRibbon(x) {
        // BRIGHTENED (request — "don't want it dark, make it brighter"): was a
        // near-black green-to-black gradient; now a light, airy green-to-white
        // gradient so the ribbons read against a bright card instead of a dark one.
        var g = x.createLinearGradient(0, 0, 1080, 1350);
        g.addColorStop(0, '#eafaf0'); g.addColorStop(0.5, '#bdeed0'); g.addColorStop(1, '#8fd9ae');
        x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
        x.lineCap = 'round';
        [['#008751', 96, 0], ['#f4f6f4', 62, 118], ['#008751', 96, 236]].forEach(function (b) {
            x.save();
            x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 30; x.shadowOffsetY = 10;
            x.lineWidth = b[1]; x.strokeStyle = b[0];
            x.beginPath();
            x.moveTo(-160, 980 + b[2]);
            x.bezierCurveTo(260, 1300 + b[2], 700, 330 + b[2], 1240, 120 + b[2]);
            x.stroke();
            x.restore();
        });
        // thin gold accent riding above the ribbons
        x.lineWidth = 4; x.strokeStyle = 'rgba(212,175,55,0.85)';
        x.beginPath(); x.moveTo(-160, 930); x.bezierCurveTo(260, 1250, 700, 280, 1240, 70); x.stroke();
    }

    function _paintHorse(h) { // rampant horse facing right, ~200 x 560
        h.fillStyle = '#f3efe4'; h.strokeStyle = '#f3efe4'; h.lineCap = 'round'; h.lineJoin = 'round';
        var seg = function (x1, y1, x2, y2, w) { h.lineWidth = w; h.beginPath(); h.moveTo(x1, y1); h.lineTo(x2, y2); h.stroke(); };
        var ell = function (cx, cy, rx, ry, rot) { h.beginPath(); h.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); h.fill(); };
        ell(98, 300, 52, 118, -0.42);               // torso
        ell(72, 392, 50, 62, -0.2);                 // hindquarters
        h.beginPath(); h.moveTo(92, 215); h.quadraticCurveTo(120, 140, 150, 95); h.lineTo(186, 118);
        h.quadraticCurveTo(160, 190, 140, 262); h.closePath(); h.fill();   // neck
        ell(174, 92, 22, 44, 0.85);                 // head
        h.beginPath(); h.moveTo(150, 62); h.lineTo(146, 30); h.lineTo(166, 52); h.closePath(); h.fill(); // ear
        h.beginPath(); h.moveTo(146, 70); h.quadraticCurveTo(100, 110, 84, 205); h.quadraticCurveTo(122, 150, 150, 116); h.closePath(); h.fill(); // mane
        seg(70, 430, 58, 486, 38); seg(58, 486, 36, 552, 20);      // hind legs (standing)
        seg(104, 430, 118, 492, 34); seg(118, 492, 96, 552, 18);
        ell(30, 556, 16, 8, 0); ell(92, 556, 16, 8, 0);            // hooves
        seg(138, 262, 196, 312, 26); seg(196, 312, 184, 372, 17);  // front legs (raised)
        seg(120, 272, 172, 352, 24); seg(172, 352, 140, 392, 15);
        h.lineWidth = 20; h.beginPath(); h.moveTo(50, 340); h.bezierCurveTo(-10, 380, -14, 470, 22, 540); h.stroke(); // tail
    }
    function _paintEagle(e) { // spread eagle, ~340 wide, origin at its chest
        e.fillStyle = '#d02434';
        e.beginPath(); e.ellipse(0, 20, 26, 52, 0, 0, Math.PI * 2); e.fill();
        e.beginPath(); e.arc(0, -42, 17, 0, Math.PI * 2); e.fill();
        e.beginPath(); e.moveTo(10, -46); e.lineTo(34, -38); e.lineTo(10, -32); e.closePath(); e.fill();
        [1, -1].forEach(function (s) {
            e.save(); e.scale(s, 1);
            e.beginPath(); e.moveTo(14, -20);
            e.bezierCurveTo(70, -90, 130, -80, 170, -44);
            e.lineTo(160, -22); e.lineTo(172, -8); e.lineTo(150, 6); e.lineTo(160, 26); e.lineTo(132, 32);
            e.lineTo(136, 54); e.lineTo(104, 52); e.lineTo(100, 74); e.lineTo(70, 62);
            e.bezierCurveTo(50, 40, 30, 30, 14, 32);
            e.closePath(); e.fill(); e.restore();
        });
        e.beginPath(); e.moveTo(-24, 62); e.lineTo(-30, 112); e.lineTo(-10, 104); e.lineTo(0, 120); e.lineTo(10, 104); e.lineTo(30, 112); e.lineTo(24, 62); e.closePath(); e.fill();
    }
    function _paintArms(x) {
        var g = x.createLinearGradient(0, 0, 0, 1350);
        g.addColorStop(0, '#0b6a3b'); g.addColorStop(0.55, '#053a20'); g.addColorStop(1, '#010a05');
        x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
        var t = _tmpCanvas(), h = t.getContext('2d');
        h.save(); h.translate(4, 300); h.scale(1.18, 1.18); _paintHorse(h); h.restore();
        h.save(); h.translate(1076, 300); h.scale(-1.18, 1.18); _paintHorse(h); h.restore();
        x.globalAlpha = 0.36; x.drawImage(t, 0, 0); x.globalAlpha = 1;
        x.save(); x.globalAlpha = 0.6; x.translate(540, 104); x.scale(0.85, 0.85); _paintEagle(x); x.restore();
    }

    /* ---- reference-image backgrounds (cut-outs embedded as WebP data URIs in _BG_ASSETS, near the end of
       this file -- no separate image files, so nothing extra to host or wait for) ---- */
    var _bgAssetImgs = {};
    function _bgAsset(id) {
        var c = _bgAssetImgs[id];
        if (c === undefined) {
            _bgAssetImgs[id] = null; // loading
            var src = (typeof _BG_ASSETS !== 'undefined') && _BG_ASSETS[id];
            if (!src) { _bgAssetImgs[id] = false; return null; }
            var im = new Image();
            im.onload = function () {
                _bgAssetImgs[id] = im;
                _bgLayerCache = {};                                    // repaint layers that were waiting on it
                if (document.getElementById('em-bg-row')) buildBackgroundRow(); // refresh thumbnails
                try { drawCard(); } catch (e) {}
            };
            im.onerror = function () { _bgAssetImgs[id] = false; };
            im.src = src;
            return null;
        }
        return c || null;
    }
    // draws an asset centred at (cx,cy), `w` design-px wide, with a soft drop shadow
    function _placeAsset(x, im, cx, cy, w) {
        var h = w * im.height / im.width;
        x.save();
        x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 40; x.shadowOffsetY = 22;
        x.drawImage(im, cx - w / 2, cy - h / 2, w, h);
        x.restore();
    }
    function _baseGrad(x, a, b, c, glowRGB) {
        var g = x.createLinearGradient(0, 0, 0, 1350);
        g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, c);
        x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
        if (glowRGB) {
            var r = x.createRadialGradient(540, 620, 60, 540, 620, 760);
            r.addColorStop(0, 'rgba(' + glowRGB + ',0.32)'); r.addColorStop(1, 'rgba(' + glowRGB + ',0)');
            x.fillStyle = r; x.fillRect(0, 0, 1080, 1350);
        }
    }
    /* BRIGHTENED (request — "don't want it dark, make it brighter, remove
       layers that make it dark"): all four of these used to run a dark
       top-to-near-black gradient. Now a light top fading only to a mid-tone
       base color, no near-black stop, so the whole card reads bright. */
    function _paintFlagMap(x) {
        _baseGrad(x, '#eaf7ef', '#b3e6c4', '#7ccf9c', '80,200,140');
        var im = _bgAsset('map2'); if (!im) return false;
        _placeAsset(x, im, 540, 620, 1090);
    }
    function _paintMap3d(x) {
        _baseGrad(x, '#eaf1ff', '#b7cdf7', '#7fa3e8', '140,180,255');
        var im = _bgAsset('map1'); if (!im) return false;
        _placeAsset(x, im, 540, 640, 1100);
    }
    function _paintClayMap(x) {
        _baseGrad(x, '#ffffff', '#f5f5f2', '#e8e8e4', null); // gold wash + glow removed 2026-10-31 (was '#fbf4e2','#ecd9a2','#d9b65f','235,200,110')
        var im = _bgAsset('map3'); if (!im) return false;
        _placeAsset(x, im, 540, 640, 1100);
    }
    function _paintArmsImg(x) {
        _baseGrad(x, '#eafbf1', '#b9ecce', '#84d6a7', '80,200,140');
        var im = _bgAsset('arms'); if (!im) return false;
        // big enough that the horses and eagle read around the avatar; the ribbon peeks out beneath it
        _placeAsset(x, im, 540, 545, 1150);
    }
    function _paintFlagArms(x) {
        x.fillStyle = '#f4f6f4'; x.fillRect(0, 0, 1080, 1350);
        x.fillStyle = '#008751'; x.fillRect(0, 0, 360, 1350); x.fillRect(720, 0, 360, 1350);
        var im = _bgAsset('arms');
        // BRIGHTENED: was a strong fade toward near-black under the banner;
        // the banner already has its own solid dark bar, so this is now just
        // a faint touch to help the gold ring text, not a dark overlay.
        var d = x.createLinearGradient(0, 850, 0, 1350);
        d.addColorStop(0, 'rgba(0,14,6,0)'); d.addColorStop(0.5, 'rgba(0,14,6,0.10)'); d.addColorStop(1, 'rgba(0,14,6,0.22)');
        x.fillStyle = d; x.fillRect(0, 850, 1080, 500);
        if (!im) return false;
        _placeAsset(x, im, 540, 545, 1150);
    }
    /* SUPERSEDED (2026-09-24): the code-drawn _paintMap / _paintArms (crude horses, plain outline) are no longer
       used -- the reference images above replace them. Functions kept in place, just not registered. */
    var BG_PAINTERS = { flag: _paintFlag, ribbon: _paintRibbon, flagmap: _paintFlagMap, map3d: _paintMap3d, claymap: _paintClayMap, arms: _paintArmsImg, flagarms: _paintFlagArms };

    /* REMOVED (2026-09-24 -- "remove the first layer covering the background"): the old lattice, gold light
       rays, bokeh circles and the dark vignette that were painted OVER every background. Backgrounds are now
       drawn clean, with nothing on top of them but the card's own elements. */
    function drawBackground(ctx, W, H, c, cx, cy, radius) {
        var def = null, i;
        for (i = 0; i < BACKGROUNDS.length; i++) if (BACKGROUNDS[i].id === _bgId) def = BACKGROUNDS[i];

        if (_bgId === 'custom' && _bgImg) {
            drawImageCover(ctx, _bgImg, 0, 0, W, H);
            var dk = ctx.createLinearGradient(0, 0, 0, H); // light fade only, so the banner text stays legible
            dk.addColorStop(0, 'rgba(0,0,0,0.08)');
            dk.addColorStop(1, 'rgba(0,0,0,0.38)');
            ctx.fillStyle = dk;
            ctx.fillRect(0, 0, W, H);
        } else if (def && def.pic) {
            ctx.drawImage(_bgLayer(def.id, W, H), 0, 0);
        } else if (def && def.a) {
            var g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, def.b);
            g.addColorStop(0.5, def.a);
            g.addColorStop(1, def.c);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
        } else {
            // 'party' (default): the original candidate-colour gradient
            var grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, shade(c.color, 0.14));
            grad.addColorStop(0.5, c.color);
            grad.addColorStop(1, shade(c.color, -0.55));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);
        }
    }

    function updateBgSelection() {
        document.querySelectorAll('#em-bg-row .em-bg-sw').forEach(function (el) {
            el.classList.toggle('selected', el.dataset.bg === _bgId);
        });
        var cd = document.getElementById('em-bg-custom-dot');
        if (cd && _bgImg) {
            try { cd.style.backgroundImage = 'url(' + _bgImg.toDataURL('image/jpeg', 0.5) + ')'; cd.textContent = ''; } catch (e) {}
        }
    }

    function buildBackgroundRow() {
        var row = document.getElementById('em-bg-row');
        var input = document.getElementById('em-bg-input');
        if (!row || !input) return;
        row.innerHTML = '';
        BACKGROUNDS.forEach(function (b) {
            var sw = document.createElement('div');
            sw.className = 'em-bg-sw';
            sw.dataset.bg = b.id;
            var dotStyle = '', inner = '';
            if (b.id === 'custom') { dotStyle = 'background:#e9ecf5;color:#1B2B8B;'; inner = _emIc('image', 16, 'vertical-align:0;'); }
            else if (b.pic) {
                try { dotStyle = 'background-image:url(' + _bgLayer(b.id, 108, 135).toDataURL('image/jpeg', 0.7) + ');'; } catch (e) { dotStyle = 'background:#0a7a40;'; }
            }
            else if (b.dot) dotStyle = 'background:' + b.dot + ';';
            sw.innerHTML = '<span class="em-bg-dot"' + (b.id === 'custom' ? ' id="em-bg-custom-dot"' : '') + ' style="' + dotStyle + '">' + inner + '</span>' + esc(b.label);
            if (b.id === 'party') {
                var d = sw.firstChild; // swatch tracks the selected candidate's colour
                d.style.background = 'linear-gradient(135deg,' + (_selectedCandidate ? _selectedCandidate.color : '#1B2B8B') + ',#050510)';
                d.id = 'em-bg-party-dot';
            }
            sw.addEventListener('click', function () {
                if (b.id === 'custom' && (!_bgImg || _bgId === 'custom')) { input.click(); return; }
                _bgId = b.id;
                updateBgSelection();
                drawCard();
            });
            row.appendChild(sw);
        });
        input.onchange = function () {
            var f = input.files && input.files[0];
            input.value = '';
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () {
                    // downscale (longest side 1600px) so a 12MP photo doesn't make every redraw heavy
                    var k = Math.min(1, 1600 / Math.max(img.width, img.height));
                    var cv = document.createElement('canvas');
                    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
                    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                    _bgImg = cv;
                    _bgId = 'custom';
                    updateBgSelection();
                    drawCard();
                };
                img.onerror = function () { notify('That image could not be used as a background.', 'error'); };
                img.src = reader.result;
            };
            reader.readAsDataURL(f);
        };
        updateBgSelection();
    }

    /* Draws the current candidate + photo onto #em-card-canvas. Safe to
       call with no photo yet (shows a "TAP TO ADD" placeholder circle).

       UPGRADE (bug report — "make the rotating text actually curve around
       the avatar like the reference mock, size the avatar/ring the same
       way, and make the whole card look premium"): previously the rotating
       line was squeezed into a fixed angular span (drawArcText's old
       start/end-degree signature), which is why it either overlapped itself
       at this font size or read as missing entirely depending on the
       candidate name's length. drawArcText below now maps letters onto the
       circle the same way the reference mock's SVG <textPath> does — one
       radius-accurate radian per pixel of text — so the ring text always
       reads correctly and only wraps as far around the photo as its own
       length needs, exactly like the mock. The card itself is restyled to
       match that mock's premium look: a gold frame, a soft gold glow behind
       the avatar, a gold-ringed avatar (gold "TAP TO ADD" placeholder before
       a photo is picked), and a two-line gold/white bottom banner. This is
       the SAME canvas the "3. Preview" step already shows live, so the
       rotating text is visible in the preview before Save/Share/Post is
       ever tapped. */
    /* REDESIGN (2026-09-23 — \"give the I am proud to support text a rotating
       animation, reduce the height of the card, make it compact / premium /
       classic / elegant\"): 1080x1920 (9:16) -> 1080x1350 (4:5), a shorter card
       that fits the feed without being cropped by the 480px media cap, with a
       deeper vignette, a thin inner gold hairline frame, a smaller party
       badge, an EMPYREAN mark between gold rules and a compact two-line
       banner.
       ROTATING TEXT: a PNG can't animate, so the \"I AM PROUD TO SUPPORT\" ring
       is NOT drawn into the card for the live views — the preview below (see
       #em-arc-preview) and the dashboard feed card (app-feed.js's
       _enhanceCompositeElectionCard) lay a slowly spinning SVG ring over the
       photo instead. Save / Share / Post to My Status export a static image, so
       those bake the ring in (_bakeArc). The geometry constants below
       (CARD_CY / CARD_R / ARC_R) are mirrored as percentages in app-feed.js —
       change them together. */
    var CARD_CY = 600, CARD_R = 350, ARC_R = 370, ARC_FONT = 46;
    /* Candidate portrait: centred on the photo ring's lower-right edge (45 deg).
       PORT_DX/DY = offset from the photo centre; the live ring text is masked
       around this spot (73%/73% of the ring box, radius ~14.5%) — keep in sync
       with .em-arc-preview.has-portrait below and app-feed.js. */
    var PORT_R = 140, PORT_DX = 247, PORT_DY = 247;
    var _bakeArc = false;

    function drawCard() {
        var canvas = document.getElementById('em-card-canvas');
        if (!canvas || !_selectedCandidate) return;
        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;
        var c = _selectedCandidate;
        var cx = W / 2, cy = CARD_CY, radius = CARD_R;

        ctx.clearRect(0, 0, W, H);

        var r = 44;
        ctx.save();
        _roundedRectPath(ctx, 0, 0, W, H, r);
        ctx.clip();

        /* SUPERSEDED (2026-09-24 -- selectable premium / uploaded backgrounds): the fixed
           candidate-colour gradient + vignette that was here now lives in drawBackground()
           as the 'Party colours' option (unchanged look, still the default).
        // Deep candidate-colour gradient + a soft vignette
        var grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, shade(c.color, 0.14));
        grad.addColorStop(0.5, c.color);
        grad.addColorStop(1, shade(c.color, -0.55));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        var vig = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, H * 0.55, W * 0.95);
        vig.addColorStop(0, 'rgba(255,255,255,0.08)');
        vig.addColorStop(1, 'rgba(0,0,0,0.30)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);
        */
        drawBackground(ctx, W, H, c, cx, cy, radius);

        // Soft gold glow behind the avatar
        var glow = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 1.55);
        glow.addColorStop(0, 'rgba(212,175,55,0.30)');
        glow.addColorStop(1, 'rgba(212,175,55,0)');
        /* REMOVED (2026-10-31 - "remove the gold shadow from the uploaded images background"): the gold haze painted
           over every background behind the avatar. Backgrounds now show clean, exactly as chosen/uploaded.
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
        */

        // Inner gold hairline frame (classic double-border look)
        ctx.save();
        _roundedRectPath(ctx, 30, 30, W - 60, H - 60, r - 14);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(212,175,55,0.55)';
        ctx.stroke();
        ctx.restore();

        // Party badge, top-left — white plate, gold hairline, real logo
        var bx = 104, by = 104, br = 52;
        ctx.beginPath();
        ctx.arc(bx, by, br + 5, 0, Math.PI * 2);
        ctx.fillStyle = GOLD;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        var logoImg = getLogoImg(c);
        if (logoImg) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(bx, by, br - 5, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            drawImageCover(ctx, logoImg, bx - (br - 5), by - (br - 5), (br - 5) * 2, (br - 5) * 2);
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(bx, by, br - 5, 0, Math.PI * 2);
            ctx.fillStyle = c.color;
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 22px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(c.party, bx, by + 2);
        }

        // Photo circle — dark under-ring, gold ring, fine white keyline
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (_photoImg) {
            drawImageCover(ctx, _photoImg, cx - radius, cy - radius, radius * 2, radius * 2);
        } else {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = Math.round(radius * 0.55) + 'px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', cx, cy - radius * 0.14);
            ctx.fillStyle = GOLD;
            ctx.font = '800 ' + Math.round(radius * 0.13) + 'px Arial';
            ctx.fillText('TAP TO ADD', cx, cy + radius * 0.42);
        }
        ctx.restore();
        ctx.lineWidth = 10;
        ctx.strokeStyle = GOLD;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
        ctx.stroke();

        // Static ring text — ONLY when exporting a still image (Save / Share /
        // Status). Live views spin an SVG ring over the canvas instead.
        if (_bakeArc) {
            var shortName = c.name.trim().split(/\s+/).pop().toUpperCase();
            var phrase = '\u2605 ' + _tplText('ringText').toUpperCase() + ' ' + shortName + ' \u2605';
            ctx.save();
            ctx.font = '800 ' + ARC_FONT + 'px Arial';
            var totalPx = phrase.split('').reduce(function (a, ch) { return a + ctx.measureText(ch).width; }, 0);
            ctx.restore();
            var startDeg = -90 - (totalPx / ARC_R) * 90 / Math.PI; // centred on 12 o'clock
            /* Exclude the portrait's footprint from the text itself (rather than
               relying only on the portrait being painted on top afterwards) so no
               glyph edge can poke out past the portrait's ring -- feedback: "the
               text scroll should pass under the presidential candidate picture".
               The portrait sits at rest (cx+PORT_DX, cy+PORT_DY) whenever _bakeArc
               is true, so its position here is fixed, not animated. */
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, W, H);
            ctx.moveTo(cx + PORT_DX + (PORT_R + 22), cy + PORT_DY);
            ctx.arc(cx + PORT_DX, cy + PORT_DY, PORT_R + 22, 0, Math.PI * 2, true);
            ctx.clip('evenodd');
            drawArcText(ctx, phrase, cx, cy, ARC_R, '#ffffff', ARC_FONT, startDeg);
            ctx.restore();
        }

        // Candidate portrait — overlaps the lower-right edge of the user's photo
        _portraitDrawn = false;
        var pimg = getPortraitImg(c);
        /* was: if (pimg) { -- now also true once every portrait URL has failed, so the placeholder shows */
        if (pimg || _portraitImgCache[c.id] === false) {
            _portraitDrawn = true;

            // Decide this frame's animation progress (1 = fully at rest).
            // Exports (_bakeArc) and prefers-reduced-motion always render
            // the resting frame — only the live preview slides.
            var progress = 1;
            if (_bakeArc || _prefersReducedMotion) {
                _animatePortraitOnDraw = false;
                _portraitAnimCandidateId = c.id;
                _portraitProgress = 1;
            } else if (_animatePortraitOnDraw) {
                _animatePortraitOnDraw = false;
                _portraitAnimCandidateId = c.id;
                _portraitProgress = 0;
                progress = 0;
                runPortraitEntranceAnim();
            } else if (_portraitAnimCandidateId === c.id) {
                progress = _portraitProgress;
            }

            // Slide in from further along the same diagonal, growing and
            // fading up to its resting size/position/opacity.
            var slideDist = 90;
            var pdx = PORT_DX + (1 - progress) * slideDist;
            var pdy = PORT_DY + (1 - progress) * slideDist;
            var pscale = 0.55 + 0.45 * progress;
            var palpha = 0.15 + 0.85 * progress;
            var pr = PORT_R * pscale;

            var px = cx + pdx, py = cy + pdy;
            ctx.save();
            ctx.globalAlpha = palpha;
            ctx.shadowColor = 'rgba(0,0,0,0.55)';
            ctx.shadowBlur = 28;
            ctx.shadowOffsetY = 8;
            ctx.beginPath();
            ctx.arc(px, py, pr + 11, 0, Math.PI * 2);
            ctx.fillStyle = GOLD;
            ctx.fill();
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = palpha;
            ctx.beginPath();
            ctx.arc(px, py, pr + 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            if (pimg) {
                ctx.fillStyle = shade(c.color, -0.25);
                ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
                drawImageCoverFocus(ctx, pimg, px - pr, py - pr, pr * 2, pr * 2, 0.2);
            } else {
                drawPortraitPlaceholder(ctx, c, px, py, pr);
            }
            ctx.restore();
        }

        // Banner — compact, solid dark base, gold rule with a small diamond
        // FIX (report — "there is already a join your preferred presidential
        // candidate challenge banner on the home page general dashboard,
        // there is no need to add it to the avatar frame thumbnail card"):
        // reverted bannerH back to its original 200 (it was only grown to
        // 246 to fit the CTA text removed below) so the card doesn't end up
        // with empty dead space at the bottom now that the line is gone.
        var _tag = _tplText('tagline');
        var bannerH = _tag ? 244 : 200, bTop = H - bannerH;
        var bg = ctx.createLinearGradient(0, bTop, 0, H);
        bg.addColorStop(0, 'rgba(0,0,0,0.55)');
        bg.addColorStop(1, 'rgba(0,0,0,0.78)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, bTop, W, bannerH);
        ctx.fillStyle = GOLD;
        ctx.fillRect(0, bTop, W, 3);
        ctx.save();
        ctx.translate(cx, bTop + 1.5);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = GOLD;
        ctx.fillRect(-9, -9, 18, 18);
        ctx.restore();

        // EMPYREAN mark between two fine gold rules, just above the banner
        var my = bTop - 46;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 22px Arial';
        if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
        var _brand = _tplText('brandText').toUpperCase();
        var mw = ctx.measureText(_brand).width;
        ctx.fillStyle = _rgba(GOLD, 0.9);
        ctx.fillText(_brand, cx + 4, my);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.fillRect(cx - mw / 2 - 150, my - 1, 120, 2);
        ctx.fillRect(cx + mw / 2 + 30, my - 1, 120, 2);

        // Banner text
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = GOLD;
        ctx.font = '700 26px Arial';
        if ('letterSpacing' in ctx) ctx.letterSpacing = '7px';
        ctx.fillText(_tplText('bannerText').toUpperCase(), cx + 3, bTop + 52); // was "I SUPPORT" (dev task list — "it should be I'm proud to support that candidate")
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 54px Georgia, serif';
        ctx.fillText(c.name.toUpperCase(), cx, bTop + 114);
        ctx.font = '600 27px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillText(ELECTION_LABEL + ' \u00B7 ' + c.party, cx, bTop + 158);
        if (_tag) {
            /* optional admin tagline under the party line; shrinks to fit the card width */
            var _tg = _tag.toUpperCase(), _fs = 24;
            ctx.fillStyle = GOLD;
            do { ctx.font = '700 ' + _fs + 'px Arial'; _fs -= 1; } while (ctx.measureText(_tg).width > W - 120 && _fs > 12);
            ctx.fillText(_tg, cx, bTop + 208);
        }

        // FIX (report — "no need to add it to the avatar frame thumbnail
        // card"): the "JOIN THE SUPPORT YOUR PREFERRED PRESIDENTIAL
        // CANDIDATE CHALLENGE" CTA line and its gold hairline separator,
        // baked into this canvas right below the party line, are removed —
        // that message is already shown once, in app-feed.js's dashboard
        // banner CTA bar, so repeating it on every generated frame image
        // was redundant. Nothing else in this function reads past this
        // point, so no other positioning depends on the removed block.

        ctx.restore();

        // Outer gold frame — drawn last, over the clip
        ctx.save();
        _roundedRectPath(ctx, 5, 5, W - 10, H - 10, r);
        ctx.lineWidth = 8;
        ctx.strokeStyle = GOLD;
        ctx.stroke();
        ctx.restore();

        updateArcPreview();
    }

    /* Live, spinning ring over the preview canvas (see the REDESIGN note
       above). Rebuilt only when the candidate changes. */
    function arcRingSvg(shortName, pid) {
        var t = '\u2605 ' + esc(_tplText('ringText').toUpperCase()) + ' ' + esc(shortName) + ' \u2605';
        var txt = function (off) {
            return '<text font-size="4.5" font-weight="800" letter-spacing="0.12" fill="#ffffff" paint-order="stroke" stroke="#000" stroke-opacity="0.6" stroke-width="0.85" stroke-linejoin="round" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">' +
                '<textPath href="#' + pid + '" startOffset="' + off + '">' + t + '</textPath></text>';
        };
        return '<svg viewBox="0 0 100 100" class="em-arc-svg" xmlns="http://www.w3.org/2000/svg">' +
            '<defs><path id="' + pid + '" fill="none" d="M 13.2,50 a 36.8,36.8 0 1,1 73.6,0 a 36.8,36.8 0 1,1 -73.6,0"/></defs>' +
            txt('25%') + txt('75%') + '</svg>' +
            '<svg viewBox="0 0 100 100" class="em-arc-svg2" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="34.6" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="0.35" stroke-dasharray="0.4 1.9" stroke-linecap="round"/></svg>';
    }
    function updateArcPreview() {
        var host = document.getElementById('em-arc-preview');
        if (!host || !_selectedCandidate) return;
        var shortName = _selectedCandidate.name.trim().split(/\s+/).pop().toUpperCase();
        host.classList.toggle('has-portrait', !!_portraitDrawn);
        var _ak = shortName + '|' + _tplText('ringText');
        if (host.getAttribute('data-for') === _ak) return;
        host.setAttribute('data-for', _ak);
        host.innerHTML = arcRingSvg(shortName, 'emPrevCurve');
    }

    /* Draws `text` curving along a circle centered at (cx,cy), radius
       `radius`, starting at `startDeg` (canvas-angle degrees: 0=3 o'clock,
       -90=12 o'clock, increasing clockwise) and reading forward for exactly
       as much of the circle as the text's own rendered width needs — the
       same way an SVG <textPath> lays glyphs along a path, rather than
       stretching/compressing the text to fill a fixed span. Each character
       is individually rotated to stay tangent to the circle. */
    function drawArcText(ctx, text, cx, cy, radius, color, fontPx, startDeg) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = '800 ' + fontPx + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var anglePerPx = 1 / radius; // true radians-per-pixel at this radius
        var angle = startDeg * Math.PI / 180;
        var widths = text.split('').map(function (ch) { return ctx.measureText(ch).width; });
        for (var i = 0; i < text.length; i++) {
            var w = widths[i];
            var mid = angle + (w * anglePerPx) / 2;
            ctx.save();
            ctx.translate(cx + radius * Math.cos(mid), cy + radius * Math.sin(mid));
            ctx.rotate(mid + Math.PI / 2);
            ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; // dark edge keeps the white text readable on any background
            ctx.strokeText(text[i], 0, 0);
            ctx.fillText(text[i], 0, 0);
            ctx.restore();
            angle += w * anglePerPx;
        }
        ctx.restore();
    }

    function _roundedRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    function drawImageCover(ctx, img, x, y, w, h) {
        var ir = img.width / img.height, tr = w / h, sx, sy, sw, sh;
        if (ir > tr) { sh = img.height; sw = sh * tr; sx = (img.width - sw) / 2; sy = 0; }
        else { sw = img.width; sh = sw / tr; sx = 0; sy = (img.height - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }
    /* Like drawImageCover, but fy (0..1) picks which vertical slice survives the
       crop — 0.2 keeps the face of a portrait instead of centring on the chest. */
    function drawImageCoverFocus(ctx, img, x, y, w, h, fy) {
        var ir = img.width / img.height, tr = w / h, sx, sy, sw, sh;
        if (ir > tr) { sh = img.height; sw = sh * tr; sx = (img.width - sw) / 2; sy = 0; }
        else { sw = img.width; sh = sw / tr; sx = 0; sy = (img.height - sh) * fy; }
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }
    function shade(hex, pct) {
        var n = parseInt(hex.replace('#', ''), 16);
        var r = Math.max(0, Math.min(255, ((n >> 16) & 255) * (1 + pct)));
        var g = Math.max(0, Math.min(255, ((n >> 8) & 255) * (1 + pct)));
        var b = Math.max(0, Math.min(255, (n & 255) * (1 + pct)));
        return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
    }

    /* withArc: true for still exports (Save / Share / Status) — bakes the ring
       text in. false for the dashboard post, whose feed card spins its own SVG
       ring over the image. toBlob snapshots the bitmap synchronously, so
       redrawing the live preview right after is safe. */
    function canvasToBlob(withArc) {
        return new Promise(function (resolve) {
            _bakeArc = !!withArc;
            drawCard();
            document.getElementById('em-card-canvas').toBlob(function (blob) { resolve(blob); }, 'image/png', 0.95);
            _bakeArc = false;
            drawCard();
        });
    }

    function saveCard() {
        canvasToBlob(true).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'empyrean-' + (_selectedCandidate ? _selectedCandidate.id : 'support') + '-card.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        });
    }

    function shareCard() {
        canvasToBlob(true).then(function (blob) {
            var text = _caption(_selectedCandidate);
            var file = new File([blob], 'empyrean-support.png', { type: 'image/png' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], text: text }).catch(function () {});
            } else {
                // Fallback: download the image, open WhatsApp with the caption
                // pre-filled — the image itself has to be attached manually,
                // since a plain wa.me link can't carry binary media.
                saveCard();
                window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
                notify('Image downloaded — attach it in WhatsApp along with the caption.', 'info');
            }
        });
    }

    /* RESTORED (2026-09-23 — "the I Support card, once filled, should be wired
       to the general public dashboard homepage"): postCardToDashboard() had
       gone missing from this file (its rules comment on /election_support_posts
       and app-feed.js's _enhanceElectionSupportCard header both still refer to
       it), leaving only "Post to My Status" — which hands off to the status
       composer and never writes a /posts doc, so nothing could ever reach the
       dashboard's horizontal "Support your Presidential candidate" strip
       (app-feed.js's _placeInElectionSupportStrip, fed by /posts docs with
       isElectionSupportPost:true).
       Uploads the finished, composited card (same canvas Save/Share/Status
       use) and writes ONE /posts doc in the same shape Quick Post writes
       (id/userId/username/avatar/text/media/createdAt/likes) plus the election
       fields app-feed.js reads (candidateId/candidateName/candidateShortName/
       party/logoUrl). cardComposite:true tells app-feed.js the image already
       has the logo badge, rotating text and "I SUPPORT" banner baked in, so
       it must not overlay a second copy on top. Both the feed listener in
       app-feed.js and app-fixes.js's copy render it live via onSnapshot, so no
       manual DOM insert is needed here (that would double-render it). */
    var _dashPosting = false;
    function postCardToDashboard() {
        if (_dashPosting) return;
        if (window._isGuest || (window.EmpState && window.EmpState.isGuest)) {
            if (typeof window.openAuthModal === 'function') { window.openAuthModal('login'); return; }
            notify('Please sign in to post to the dashboard.', 'warning'); return;
        }
        if (!_selectedCandidate) { notify('Choose who you support first.', 'warning'); return; }
        if (!_photoImg) { notify('Add your photo first.', 'warning'); return; }
        if (!window.fbDb) { notify('Dashboard posting isn\u2019t available right now.', 'error'); return; }

        var c = _selectedCandidate;
        var us = (window.EmpState && window.EmpState.userState) || window.userState || {};
        if (!us.id) { notify('Please sign in to post to the dashboard.', 'warning'); return; }

        _dashPosting = true;
        var btn = document.getElementById('em-dash-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = _emIc('spinner', 16, '', 'em-spin') + ' Posting\u2026'; }

        canvasToBlob(false).then(function (blob) {
            if (!blob) throw new Error('Could not prepare your card.');
            if (typeof window.uploadToCloudinary !== 'function') throw new Error('Upload isn\u2019t available right now.');
            return window.uploadToCloudinary(blob);
        }).then(function (url) {
            if (!url || typeof url !== 'string') throw new Error('Card upload failed.');
            var postId = 'ep-' + us.id + '-' + Date.now();
            var doc = {
                id: postId,
                userId: us.id,
                username: us.fullName || us.username || 'User',
                avatar: us.avatar || '',
                text: _caption(c),
                media: [url],
                createdAt: new Date().toISOString(),
                likes: 0,
                isElectionSupportPost: true,
                cardComposite: true,
                cardArcOverlay: true,
                cardPortrait: !!_portraitDrawn,
                candidateId: c.id,
                candidateName: c.name,
                candidateShortName: c.name.trim().split(/\s+/).pop(),
                party: c.party
            };
            if (c.logoUrl && /^https?:/i.test(c.logoUrl)) doc.logoUrl = c.logoUrl;
            return window.fbDb.collection('posts').doc(postId).set(doc).then(function () { return doc; });
        }).then(function () {
            notify('Your support card is now on the public dashboard!', 'success');
            closeModal();
            if (typeof window.navigateTo === 'function') { try { window.navigateTo('dashboard', true); } catch (e) {} }
        }).catch(function (err) {
            console.error('[V50-Election] post to dashboard failed:', err && err.code, err && err.message);
            notify('Could not post to the dashboard: ' + (err && err.message ? err.message : 'try again.'), 'error');
        }).finally(function () {
            _dashPosting = false;
            var b = document.getElementById('em-dash-btn');
            if (b) { b.disabled = false; b.innerHTML = _emIc('megaphone') + ' Post to Dashboard'; }
        });
    }

    function postCardToStatus() {
        if (!_photoImg) { notify('Add your photo first.', 'warning'); return; }
        var btn = document.getElementById('em-post-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = _emIc('spinner', 16, '', 'em-spin') + ' Posting\u2026'; }

        canvasToBlob(true).then(function (blob) {
            if (typeof window.uploadToCloudinary !== 'function') throw new Error('Upload isn\u2019t available right now.');
            return window.uploadToCloudinary(blob);
        }).then(function (url) {
            var modal = document.getElementById('create-status-modal');
            if (!modal) throw new Error('Status composer isn\u2019t available right now.');
            modal.style.display = 'flex';
            modal.classList.add('show');
            document.body.classList.add('modal-open', 'status-composer-open');
            if (typeof window._empAttachRemoteStatusMedia === 'function') {
                window._empAttachRemoteStatusMedia(url, 'image');
            }
            var txt = document.getElementById('status-text-input');
            if (txt && !txt.value) txt.value = _caption(_selectedCandidate);
            closeModal();
        }).catch(function (err) {
            notify('Could not prepare the post: ' + (err && err.message ? err.message : 'try again.'), 'error');
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = _emIc('send') + ' Post to My Status'; }
        });
    }

    /* =========================================================================
       §3.5 — PUBLIC PER-POLLING-UNIT RESULTS UPLOADER (dev task list —
       "clicking Results should open an uploader, not redirect to admin;
       any user can upload a polling-unit result; one upload per polling
       unit; flag on image/text mismatch"). Lives on the same "Results"
       tab as the admin-published aggregate dashboard below it (§4) —
       tapping the Results tab now shows this uploader FIRST, with the
       official aggregate figures underneath, rather than replacing one
       with the other.

       DATA MODEL: one Firestore doc per polling unit, collection
       election_pu_results, DOC ID = a slug of state__lga__ward__unit
       (see _puKey below). Using the slug itself as the doc id is what
       makes "one result per polling unit" enforceable without a query —
       a second submission for the same polling unit is a create against
       an ALREADY-EXISTING doc id, which the transaction below rejects
       atomically (no race between two people uploading the same unit at
       once). Field names (uploaderName, state, lga, ward, pollingUnit,
       flagReason, images, createdAt) match what server.js's admin
       flagged-review routes and app-admin.js's initElectionFlagsPanel
       already expect (see those files) — this is the first and only
       writer of this collection, so it defines the shape those readers
       consume.

       Requires a Firestore rule allowing any authenticated, non-guest
       user to CREATE (not update/delete) a doc in election_pu_results —
       the admin-only mutations (dismiss-flag / delete) already go
       through server.js's Admin-SDK routes, which bypass rules
       entirely, so this only needs to open client-side CREATE.

       VERIFICATION: POST /api/election/verify-result (server.js) sends
       the uploaded photo(s) to Claude's vision API and diffs the result
       against the typed tally; this never blocks the submission itself
       (the brief asks for "flagged", not "rejected") — flagged/
       flagReason are simply stored alongside the result for admin
       review (app-admin.js's Flagged Polling Unit Results panel).
       ========================================================================= */
    var STATE_LGAS = window._NIGERIA_STATES_LGAS || {};
    var _puSubmitting = false;
    var _puDuplicateBlocked = false;
    var _dupCheckTimer = null;

    function ensureResultsTabScaffold() {
        var host = document.getElementById('em-tab-results');
        if (!host || host._pv50Built) return;
        host._pv50Built = true;
        host.innerHTML =
            _pickerHTML() +
            '<div id="em-pu-uploader"></div>' +
            '<div style="height:1px;background:rgba(10,14,39,0.08);margin:18px 0;"></div>' +
            '<div id="em-official-results"><div style="text-align:center;padding:20px 0;">' + _emIc('spinner', 18, '', 'em-spin') + ' Loading official results\u2026</div></div>';
        renderPuUploader();
    }

    function _puSlug(s) {
        return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
    }
    function _puKey(state, lga, ward, unit) {
        return [state, lga, ward, unit].map(_puSlug).join('__');
    }

    function renderPuUploader() {
        var host = document.getElementById('em-pu-uploader');
        if (!host) return;
        if (!CANDIDATES.length) { host.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted,#666);">No candidates have been added for this election yet, so results cannot be uploaded.</p>'; return; }

        var candVotesHTML = CANDIDATES.map(function (c) {
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
                '<div style="flex:1;font-size:0.8rem;font-weight:700;">' + esc(c.name) + ' <span style="color:var(--text-muted,#666);font-weight:500;">(' + esc(c.party) + ')</span></div>' +
                '<input type="number" min="0" step="1" id="em-pu-votes-' + c.id + '" placeholder="Votes" style="max-width:120px;padding:8px 10px;border-radius:8px;border:1px solid rgba(10,14,39,0.14);">' +
                '</div>';
        }).join('');

        var stateOptions = Object.keys(STATE_LGAS).sort().map(function (s) {
            return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
        }).join('');

        host.innerHTML =
            '<h4>Upload Polling Unit Result</h4>' +
            '<p style="font-size:0.76rem;color:var(--text-muted,#666);margin:0 0 14px;">' +
            'Any registered user can upload a result straight from a polling unit. Each polling unit can only be ' +
            'uploaded once \u2014 once a result exists for it, further uploads for that same polling unit are ' +
            'blocked automatically. The photo you attach is checked against the numbers you type; a mismatch is ' +
            'flagged for admin review, but your submission is still saved.</p>' +
            '<div class="form-group"><label style="font-size:0.75rem;font-weight:700;">Your Name</label>' +
            '<input type="text" id="em-pu-name" placeholder="Full name" style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(10,14,39,0.14);margin-top:4px;box-sizing:border-box;"></div>' +
            '<div class="form-group" style="margin-top:10px;"><label style="font-size:0.75rem;font-weight:700;">Political Party You Represent</label>' +
            '<input type="text" id="em-pu-party" placeholder="e.g. APC, ADC, NDC, AAC, agent, or observer" style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(10,14,39,0.14);margin-top:4px;box-sizing:border-box;"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">' +
            '<div class="form-group"><label style="font-size:0.75rem;font-weight:700;">State</label>' +
            '<select id="em-pu-state" style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(10,14,39,0.14);margin-top:4px;box-sizing:border-box;"><option value="">Select state\u2026</option>' +
            stateOptions + '</select></div>' +
            '<div class="form-group"><label style="font-size:0.75rem;font-weight:700;">Local Government</label>' +
            '<select id="em-pu-lga" disabled style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(10,14,39,0.14);margin-top:4px;box-sizing:border-box;"><option value="">Select state first\u2026</option></select></div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">' +
            '<div class="form-group"><label style="font-size:0.75rem;font-weight:700;">Ward</label>' +
            '<input type="text" id="em-pu-ward" placeholder="Ward name/number" style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(10,14,39,0.14);margin-top:4px;box-sizing:border-box;"></div>' +
            '<div class="form-group"><label style="font-size:0.75rem;font-weight:700;">Polling Unit</label>' +
            '<input type="text" id="em-pu-unit" placeholder="Polling unit name/number" style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(10,14,39,0.14);margin-top:4px;box-sizing:border-box;"></div>' +
            '</div>' +
            '<div id="em-pu-dup-warning" style="margin-top:8px;"></div>' +
            '<div style="margin-top:14px;">' + candVotesHTML + '</div>' +
            '<div class="em-photo-drop" id="em-pu-photo-drop">' +
            _emIc('camera', 28, 'color:var(--text-muted,#666);') + '<div style="font-size:0.78rem;margin-top:6px;">Tap to attach a photo of the result sheet</div></div>' +
            '<input type="file" id="em-pu-photo-input" accept="image/*" capture="environment" style="display:none;">' +
            '<div id="em-pu-photo-preview" style="margin-top:8px;"></div>' +
            '<div id="em-pu-feedback" style="margin-top:10px;font-size:0.8rem;"></div>' +
            '<div class="em-actions" style="margin-top:14px;">' +
            '<button type="button" class="em-btn-primary" id="em-pu-submit-btn">' + _emIc('send') + ' Submit Result</button>' +
            '</div>';

        var _isNG = _evIsNG();
        if (!_isNG) {
            /* Outside Nigeria there is no built-in state/LGA list: swap the two dropdowns for free-text inputs (same ids). */
            ['em-pu-state', 'em-pu-lga'].forEach(function (fid) {
                var sel = document.getElementById(fid);
                if (!sel) return;
                var inp = document.createElement('input');
                inp.type = 'text'; inp.id = fid;
                inp.placeholder = fid === 'em-pu-state' ? 'State / Province / Region' : 'District / County / Local area';
                inp.style.cssText = sel.style.cssText;
                sel.parentNode.replaceChild(inp, sel);
            });
        }
        var stateSel = document.getElementById('em-pu-state');
        var lgaSel = document.getElementById('em-pu-lga');
        if (_isNG) stateSel.addEventListener('change', function () {
            var list = STATE_LGAS[stateSel.value] || [];
            lgaSel.innerHTML = '<option value="">Select LGA\u2026</option>' +
                list.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('');
            lgaSel.disabled = !list.length;
            _scheduleDupCheck();
        });
        if (!_isNG) stateSel.addEventListener('input', _scheduleDupCheck);
        var _evR = activeEvent();
        if (_isNG && _evR.region && STATE_LGAS[_evR.region]) {
            /* state-level race (e.g. a governorship): lock the state to the race's own state */
            stateSel.value = _evR.region;
            stateSel.dispatchEvent(new Event('change'));
            stateSel.disabled = true;
        }
        ['em-pu-lga', 'em-pu-ward', 'em-pu-unit'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', _scheduleDupCheck);
        });

        var dropEl = document.getElementById('em-pu-photo-drop');
        var fileInput = document.getElementById('em-pu-photo-input');
        if (dropEl && fileInput) {
            dropEl.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () {
                var f = fileInput.files && fileInput.files[0];
                var preview = document.getElementById('em-pu-photo-preview');
                if (!preview) return;
                preview.innerHTML = f ? ('<img src="' + URL.createObjectURL(f) + '" style="max-width:100%;max-height:160px;border-radius:10px;">') : '';
            });
        }

        var submitBtn = document.getElementById('em-pu-submit-btn');
        if (submitBtn) submitBtn.addEventListener('click', submitPuResult);
    }

    function _scheduleDupCheck() {
        clearTimeout(_dupCheckTimer);
        _dupCheckTimer = setTimeout(_checkPuDuplicate, 500);
    }

    function _checkPuDuplicate() {
        var warnEl = document.getElementById('em-pu-dup-warning');
        if (!warnEl) return;
        var state = (document.getElementById('em-pu-state') || {}).value || '';
        var lga = (document.getElementById('em-pu-lga') || {}).value || '';
        var ward = (document.getElementById('em-pu-ward') || {}).value || '';
        var unit = (document.getElementById('em-pu-unit') || {}).value || '';
        if (!state || !lga || !ward || !unit || !window.fbDb) { warnEl.innerHTML = ''; _puDuplicateBlocked = false; return; }
        var key = _puDocId(activeEvent(), state, lga, ward, unit);
        window.fbDb.collection('election_pu_results').doc(key).get().then(function (doc) {
            if (doc.exists) {
                var d = doc.data() || {};
                _puDuplicateBlocked = true;
                warnEl.innerHTML = '<div style="padding:8px 10px;border-radius:8px;background:rgba(229,57,53,0.1);color:#e53935;font-size:0.76rem;">' +
                    _emIc('alert', 14) + ' A result for this polling unit was already uploaded' + (d.uploaderName ? (' by ' + esc(d.uploaderName)) : '') +
                    (d.createdAt ? (' on ' + new Date(d.createdAt).toLocaleDateString()) : '') + '. Duplicate uploads are blocked.</div>';
            } else {
                _puDuplicateBlocked = false;
                warnEl.innerHTML = '<div style="padding:8px 10px;border-radius:8px;background:rgba(34,197,94,0.1);color:#16a34a;font-size:0.76rem;">' + _emIc('okcircle', 14) + ' No result uploaded yet for this polling unit.</div>';
            }
        }).catch(function () { /* non-fatal — the submit transaction below still enforces uniqueness either way */ });
    }

    function submitPuResult() {
        if (_puSubmitting) return;
        if (window._isGuest || (window.EmpState && window.EmpState.isGuest)) {
            notify('Please sign in to upload a result.', 'warning');
            return;
        }
        if (!_portalAllowed() || (activeEvent().open === false && !_isAdminUser())) {
            notify('The challenge portal is closed.', 'warning');
            return;
        }
        var feedback = document.getElementById('em-pu-feedback');
        var name  = ((document.getElementById('em-pu-name')  || {}).value || '').trim();
        var party = ((document.getElementById('em-pu-party') || {}).value || '').trim();
        var state = (document.getElementById('em-pu-state') || {}).value || '';
        var lga   = (document.getElementById('em-pu-lga')   || {}).value || '';
        var ward  = ((document.getElementById('em-pu-ward') || {}).value || '').trim();
        var unit  = ((document.getElementById('em-pu-unit') || {}).value || '').trim();

        if (!name || !party || !state || !lga || !ward || !unit) {
            if (feedback) feedback.innerHTML = '<span style="color:#e53935;">Please fill in every field above before submitting.</span>';
            return;
        }
        if (_puDuplicateBlocked) {
            if (feedback) feedback.innerHTML = '<span style="color:#e53935;">This polling unit already has a result uploaded \u2014 duplicate submissions aren\u2019t allowed.</span>';
            return;
        }
        var fileInput = document.getElementById('em-pu-photo-input');
        var file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) {
            if (feedback) feedback.innerHTML = '<span style="color:#e53935;">Please attach a photo of the result sheet.</span>';
            return;
        }
        if (typeof window.uploadToCloudinary !== 'function' || !window.fbDb) {
            if (feedback) feedback.innerHTML = '<span style="color:#e53935;">Upload isn\u2019t available right now \u2014 please try again shortly.</span>';
            return;
        }

        var tally = {};
        CANDIDATES.forEach(function (c) {
            var v = parseInt((document.getElementById('em-pu-votes-' + c.id) || {}).value, 10);
            tally[c.id] = isNaN(v) ? 0 : v;
        });
        /* Sanity bounds — a single polling unit can't have negative votes or
           thousands per candidate; also mirrored in firebase-rules.js so the
           public totals can't be inflated from the console. */
        var _badTally = CANDIDATES.some(function (c) { return tally[c.id] < 0 || tally[c.id] > 3000; });
        if (_badTally) {
            if (feedback) feedback.innerHTML = '<span style="color:#e53935;">Vote counts must be between 0 and 3,000 per candidate \u2014 please check the numbers.</span>';
            return;
        }

        var key = _puDocId(activeEvent(), state, lga, ward, unit);
        var us = window.userState || {};
        var ev = activeEvent();
        var ref = window.fbDb.collection('election_pu_results').doc(key);
        var uploadedUrl = null;
        var verifyResult = { flagged: false, reason: null };

        _puSubmitting = true;
        var btn = document.getElementById('em-pu-submit-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = _emIc('spinner', 16, '', 'em-spin') + ' Submitting\u2026'; }
        if (feedback) feedback.innerHTML = '<span style="color:var(--text-muted,#666);">Checking polling unit\u2026</span>';

        ref.get().then(function (existing) {
            if (existing.exists) throw new Error('DUPLICATE_PU');
            if (feedback) feedback.innerHTML = '<span style="color:var(--text-muted,#666);">Uploading photo\u2026</span>';
            return window.uploadToCloudinary(file);
        }).then(function (url) {
            uploadedUrl = url;
            if (feedback) feedback.innerHTML = '<span style="color:var(--text-muted,#666);">Checking photo against your numbers\u2026</span>';
            var base = (typeof window._empApiBase === 'function') ? window._empApiBase() : '';
            return fetch(base + '/api/election/verify-result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrls: [uploadedUrl], tally: tally })
            }).then(function (r) { return r.json(); }).catch(function () { return { flagged: false, reason: null, skipped: true }; });
        }).then(function (verify) {
            verifyResult = verify || {};
            // Final, atomic guarantee against a race with another uploader
            // submitting the same polling unit at nearly the same moment —
            // the earlier .get() above is just a fast, non-atomic pre-check
            // for a responsive dup warning.
            return window.fbDb.runTransaction(function (tx) {
                return tx.get(ref).then(function (doc) {
                    if (doc.exists) throw new Error('DUPLICATE_PU');
                    var _puPayload = {
                        uploaderName: name,
                        uploaderUserId: us.id || null,
                        party: party,
                        state: state,
                        lga: lga,
                        ward: ward,
                        pollingUnit: unit,
                        tally: tally,
                        images: [uploadedUrl],
                        flagged: !!verifyResult.flagged,
                        flagReason: verifyResult.reason || null,
                        createdAt: new Date().toISOString()
                    };
                    /* legacy 2027 presidential keeps its original document shape; every other election is tagged with its own id */
                    if (!ev.legacy) _puPayload.electionId = ev.id;
                    tx.set(ref, _puPayload);
                    /* NEW (2026-09-24 — "as they upload it should reflect directly in
                       the general public dashboard"): bump the running totals in the
                       SAME transaction, so a result and its effect on the public
                       numbers land together or not at all. app-news.js's dashboard
                       and §4 below read this doc live; an admin's Decline (app-admin.js)
                       subtracts the same numbers back out. firebase-rules.js only lets
                       a non-admin change this doc by exactly the tally of the polling-
                       unit doc created in the same commit (lastKey points at it). */
                    var FV = firebase.firestore.FieldValue;
                    var candInc = {};
                    CANDIDATES.forEach(function (c) { candInc[c.id] = FV.increment(tally[c.id]); });
                    var stateInc = {}; stateInc[state] = FV.increment(1);
                    tx.set(window.fbDb.collection('election_results').doc(ev.legacy ? 'current' : ev.id), {
                        candidates: candInc,
                        unitsReported: FV.increment(1),
                        stateUnits: stateInc,
                        lastKey: key,
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                });
            });
        }).then(function () {
            if (verifyResult.flagged) {
                if (feedback) feedback.innerHTML = '<span style="color:#c98a00;">' + _emIc('alert', 14) + ' Submitted, but flagged for review: ' + esc(verifyResult.reason || 'the typed numbers didn\u2019t clearly match the photo') + '. An admin will double-check it.</span>';
                notify('Result submitted \u2014 flagged for admin review.', 'info');
            } else {
                if (feedback) feedback.innerHTML = '<span style="color:#22c55e;">' + _emIc('okcircle', 14) + ' Result submitted \u2014 thank you!</span>';
                notify('Polling unit result submitted. Thank you!', 'success');
            }
            ['em-pu-ward', 'em-pu-unit'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
            CANDIDATES.forEach(function (c) { var el = document.getElementById('em-pu-votes-' + c.id); if (el) el.value = ''; });
            if (fileInput) fileInput.value = '';
            var preview = document.getElementById('em-pu-photo-preview'); if (preview) preview.innerHTML = '';
            var warnEl = document.getElementById('em-pu-dup-warning'); if (warnEl) warnEl.innerHTML = '';
            _puDuplicateBlocked = false;
        }).catch(function (err) {
            if (err && err.message === 'DUPLICATE_PU') {
                if (feedback) feedback.innerHTML = '<span style="color:#e53935;">This polling unit already has a result uploaded \u2014 duplicate submissions aren\u2019t allowed.</span>';
                _puDuplicateBlocked = true;
            } else {
                if (feedback) feedback.innerHTML = '<span style="color:#e53935;">Could not submit: ' + esc(err && err.message ? err.message : 'try again.') + '</span>';
            }
        }).finally(function () {
            _puSubmitting = false;
            if (btn) { btn.disabled = false; btn.innerHTML = _emIc('send') + ' Submit Result'; }
        });
    }

    /* =========================================================================
       §4 — Live aggregate results: the running totals in election_results/
       current, i.e. the sum of every polling-unit result people have uploaded
       (§3.5 bumps it in the same transaction as each upload; an admin's
       Decline subtracts it back out). Same figures the public Dashboard shows
       (app-news.js's renderElectionDashboard()). Read-only here. Rendered
       into #em-official-results, underneath the uploader on the same tab.
       ========================================================================= */
    var _resultsLoaded = false;
    var _resultsUnsub = null;
    function _resultsError(host) {
        host.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--text-muted,#666);">' +
            'Couldn\u2019t load results right now. <br><button type="button" class="em-btn-secondary" ' +
            'style="margin-top:10px;padding:8px 16px;border-radius:20px;border:none;" id="em-results-retry">Retry</button></div>';
        var retry = document.getElementById('em-results-retry');
        if (retry) retry.addEventListener('click', function () { _resultsLoaded = false; loadResults(); });
    }
    /* LIVE: subscribes to the election's running-total document, so the figures move on screen the moment any
       polling-unit result lands (or an admin declines one) — no refresh needed. */
    function loadResults() {
        var host = document.getElementById('em-official-results');
        if (!host || _resultsLoaded) return;
        if (_resultsUnsub) { try { _resultsUnsub(); } catch (e) {} _resultsUnsub = null; }
        host.innerHTML = '<div style="text-align:center;padding:30px 0;">' + _emIc('spinner', 18, '', 'em-spin') + ' Loading results\u2026</div>';
        if (!window.fbDb) { _resultsError(host); return; }
        var ev = activeEvent();
        _resultsLoaded = true;
        _resultsUnsub = window.fbDb.collection('election_results').doc(ev.legacy ? 'current' : ev.id).onSnapshot(function (doc) {
            var d = doc.exists ? (doc.data() || {}) : {};
            var cv = d.candidates || {};
            renderResults({
                live: Number(d.unitsReported || 0) > 0,
                unitsReported: Number(d.unitsReported || 0),
                updatedAt: d.updatedAt || null,
                candidates: CANDIDATES.map(function (c) { return { id: c.id, name: c.name, votes: Number(cv[c.id] || 0) }; })
            });
        }, function () { _resultsLoaded = false; _resultsError(host); });
    }

    function renderResults(data) {
        var host = document.getElementById('em-official-results');
        var candidates = (data && data.candidates) || [];
        var total = candidates.reduce(function (s, c) { return s + (c.votes || 0); }, 0);

        var rows = candidates
            .slice()
            .sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); })
            .map(function (c) {
                var meta = candidateById(c.id) || {};
                var pct = total > 0 ? ((c.votes || 0) / total * 100) : 0;
                return '<div class="em-dash-row">' +
                    '<div class="em-dash-name">' + esc(c.name || meta.name || c.id) + '</div>' +
                    '<div class="em-dash-bar-track"><div class="em-dash-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + (meta.color || '#1B2B8B') + ';"></div></div>' +
                    '<div class="em-dash-pct">' + pct.toFixed(1) + '%</div>' +
                    '</div>';
            }).join('');

        host.innerHTML =
            '<h4>Election Results \u2014 Live Updates</h4>' +
            '<div class="em-dash-meta">' +
            (data && data.live ? 'Live from polling-unit uploads' : 'No polling unit has reported yet') +
            (data && data.unitsReported ? (' \u00B7 ' + data.unitsReported.toLocaleString() + ' unit' + (data.unitsReported === 1 ? '' : 's')) : '') +
            (data && data.updatedAt ? (' \u00B7 updated ' + new Date(data.updatedAt).toLocaleString()) : '') +
            ' \u00B7 ' + total.toLocaleString() + ' total votes' +
            '</div>' +
            rows +
            '<div class="em-dash-note">Results are provisional. Confirm with official ' + (_evIsNG() ? 'INEC' : 'electoral commission') + ' sources.' +
            (data && data.note ? ('<br>' + esc(data.note)) : '') + '</div>' +
            '<div class="em-actions" style="margin-top:14px;">' +
            '<button type="button" class="em-btn-secondary" id="em-results-refresh">' + _emIc('refresh', 16) + ' Refresh</button>' +
            '</div>';

        var refresh = document.getElementById('em-results-refresh');
        if (refresh) refresh.addEventListener('click', function () { _resultsLoaded = false; loadResults(); });
    }

    /* FIX (bug report: "candidate support card is only visible in the status
       bar, not as proposed" / "missing upload icon in the quick post update
       section"): §1 above only ever gave the election hub ONE entry point
       (the status-bar tile). Exposing openModal() here — rather than
       reimplementing the candidate grid/canvas a second time — lets
       app-fixes.js's Quick Post composer add its own icon that calls straight
       back into this same modal/flow, matching the exact convention this file
       already uses to reach OUT to app-status.js/app-dom.js's own public hooks
       instead of duplicating their logic. See app-fixes.js's new "Election
       Support Card button" block, injected next to Quick Post's existing
       Quote Card button. */
    window._empOpenElectionModal = openModal;

    /* RESTORED (2026-09-23): app-fixes.js's "Edit" on a support card deletes
       the old card, then calls this to reopen the builder pre-selected to the
       same candidate — the hook had gone missing along with
       postCardToDashboard(), so Edit removed the card and opened nothing. */
    window._empOpenElectionModalFor = function (candidateId) {
        if (candidateId && candidateById(candidateId)) _selectedCandidate = candidateById(candidateId);
        openModal();
    };

    /* MOVED (2026-09-23 — "move the election uploader tab to the navigation
       sidebar"): sidebar entry point (app-nav.js) that opens this same
       modal straight onto the Results tab — the per-polling-unit uploader
       with the official aggregate figures under it. Reuses openModal()'s
       guest gate and modal build, then flips to the results tab. */
    window._empOpenElectionResults = function () {
        openModal();
        if (document.getElementById('election-modal') &&
            document.getElementById('election-modal').classList.contains('show')) {
            switchTab('results');
        }
    };

    /* =========================================================================
       §5 — DASHBOARD SUPPORT-CARD RAIL (bug report — "card is not horizontally
       scrollable at top of feed"; explicitly NOT the old compact 130px strip
       that was removed on request — this renders the SAME full interactive
       post card the feed shows, one per #Vote2027 post, in a horizontal rail).

       A prior session's attempt at a horizontally-scrollable strip (dashboard
       Quote/Meme cards, 2026-09-19) tried to physically move/reposition the
       SAME live vertical feed cards into a scroller with a MutationObserver,
       and that repeatedly broke (late-appearing row, enlarging post/media,
       older cards excluded) — it was reverted. This takes a different,
       simpler approach on purpose: it never touches or reparents anything
       app-feed.js renders into #feed-container. It queries Firestore for
       #Vote2027 posts directly and builds its OWN fresh card elements (via
       the same window.createNewPostElement every other listener in this
       codebase already uses — see app-fixes.js's realtime posts listener for
       the exact field-mapping this mirrors: post.text/post.media/post.userId/
       post.username/post.avatar/post.createdAt) straight into a dedicated
       slider, so there is nothing to fight over with the main feed's own
       rendering/listeners. Support-card posts are identified by their
       caption containing ELECTION_LABEL (#Vote2027) rather than a Firestore
       field, since postCardToStatus() (above) hands off to the normal status
       composer for the user to finish/edit — this file has no hook into that
       submit pipeline (it lives in index.html's core script, not shipped to
       this patch) to stamp a dedicated field at write time. Cards without any
       real media are skipped (guards against a stray caption-only post with
       no image matching by hashtag alone). */
    function renderElectionSupportRail() {
        var host = document.getElementById('dashboard-election-support-container');
        var wrap = document.getElementById('dashboard-election-support-slider');
        if (!host || !wrap || !window.fbDb || typeof window.createNewPostElement !== 'function') return;

        window.fbDb.collection('posts').orderBy('createdAt', 'desc').limit(60).get().then(function (snap) {
            wrap.innerHTML = '';
            var count = 0;
            snap.forEach(function (doc) {
                if (count >= 15) return;
                var post = doc.data() || {};
                post.id = doc.id;
                if (post.isElectionSupportPost) return; // already shown in the feed's own support strip (app-feed.js) — don't double-render
                if (!post.text || !_isElectionText(post.text)) return;

                var media = (post.media || []).map(function (m) {
                    if (m && typeof m === 'object') return m._cloudUrl || m.url || '';
                    return m;
                }).filter(function (u) { return typeof u === 'string' && u && u.indexOf('blob:') !== 0; })
                  .map(function (u) { return { _cloudUrl: u, url: u, type: 'image/jpeg' }; });
                if (!media.length) return; // caption-only posts aren't support cards

                var av = post.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(post.username || 'U') + '&background=1B2B8B&color=fff&size=150');
                var authorForCard = { id: post.userId, fullName: post.username || 'User', avatar: av };

                var el = window.createNewPostElement(post.text || '', media, authorForCard, false);
                el.dataset.postId = post.id;
                el.dataset.userId = post.userId;
                wrap.appendChild(el);
                count++;
            });
            host.style.display = count > 0 ? '' : 'none';
        }).catch(function (err) {
            console.warn('[V50-Election] support-card rail load failed:', err && err.message);
        });
    }
    window._empRefreshElectionRail = renderElectionSupportRail;

    ready(function () {
        setTimeout(renderElectionSupportRail, 1500);
        /* Live refresh: watch for a new #Vote2027 post landing in the main
           feed (posted from elsewhere/another device too) and re-query the
           rail — this only ever triggers a fresh renderElectionSupportRail()
           call, never touches the node that triggered it. */
        var fc = document.getElementById('feed-container');
        if (fc) {
            new MutationObserver(function (muts) {
                for (var i = 0; i < muts.length; i++) {
                    var added = muts[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var n = added[j];
                        if (n.nodeType === 1 && n.classList && n.classList.contains('impact-story') &&
                            n.textContent && _isElectionText(n.textContent)) {
                            setTimeout(renderElectionSupportRail, 1200);
                            return;
                        }
                    }
                }
            }).observe(fc, { childList: true });
        }
    });
    document.addEventListener('empyrean-init-done', function () { setTimeout(renderElectionSupportRail, 900); });

    /* PRELOAD (2026-09-24 -- "the president avatar frame doesn't load on time"): the portraits and
       party logos used to start loading only when the modal first opened, so the frame popped in late.
       They now load as soon as this file runs, so they're decoded before the first tap. */
    /* Reference-image backgrounds (cut-outs of the supplied Nigeria 3D flag maps + coat of arms), embedded as
       WebP with transparency so no extra files are needed. Used by _bgAsset() above. */
    var _BG_ASSETS = {
        arms: 'data:image/webp;base64,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',
        map1: 'data:image/webp;base64,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',
        map2: 'data:image/webp;base64,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',
        map3: 'data:image/webp;base64,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'
    };
    try { CANDIDATES.forEach(function (c) { getPortraitImg(c); getLogoImg(c); }); } catch (e) {}
    try { ['arms', 'map1', 'map2', 'map3'].forEach(_bgAsset); } catch (e) {} // preload so the swatches/backgrounds are ready

    injectCSS();

    startRegistry();
    document.addEventListener('empyrean-init-done', startRegistry);
    window.addEventListener('empyrean:firebase-ready', startRegistry);

    console.log('[EmpyreanPatchV50] \u2705 Election hub added: candidate support-card generator (share/save/post-to-status) + a Results tab that now opens the public per-polling-unit results uploader first (any signed-in user, one submission per polling unit, image/tally mismatch auto-flagged via /api/election/verify-result), with the admin-published aggregate tally underneath it, reading /api/election/results (added directly in server.js). Party/candidate pairings corrected to INEC\u2019s actual final 2027 list (Atiku\u2192ADC, not PDP). Reachable via Quick Post\u2019s composer icon (app-fixes.js) through the window._empOpenElectionModal hook \u2014 the earlier status-bar ballot-box entry tile was removed per feedback. No existing frontend file\u2019s closure was edited \u2014 only the public hooks app-status.js/app-dom.js already expose for external callers.');

})();

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   FAST DASHBOARD PAINT (2026-09-29 — "pages and general card thumbnails on the dashboard home should
   load very fast, even on a poor network").

   Those strips (Business Pages, suggested people, news, market, reels, election, scholarships) used to
   stay blank until their Firestore reads came back, and every thumbnail then started downloading at the
   same moment. Two things here, both confined to this file and additive:

     1. LAST-VISIT SNAPSHOT. Each strip's rendered HTML is saved to localStorage (debounced, only once it
        holds real content) and put back the instant this file runs — so the cards and their thumbnails
        (already in the browser's image cache) appear immediately, on any connection. The restored cards
        are inert (pointer-events off) and are replaced the moment the app renders the live data, so
        nothing stale can be tapped and nothing is duplicated. Personal strips (Business Pages / suggested
        people) are wiped if the signed-in user differs from the one the snapshot was taken for.
     2. IMAGE PRIORITY. Every <img> written into these strips gets decoding="async"; the first two load
        with high priority and everything past the third is lazy, so a weak connection spends its
        bandwidth on what is on screen first instead of downloading all thumbnails at once.

   Kill switch: localStorage.setItem('empFastPaint','0') and reload. All of it is wrapped in try/catch —
   any failure just leaves the old (slower) behaviour.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    if (window._empFastPaintBound) return;
    window._empFastPaintBound = true;

    var LS = null;
    try { LS = window.localStorage; LS.getItem('empFastPaint'); } catch (e) { LS = null; }
    if (!LS || LS.getItem('empFastPaint') === '0') return;

    var PREFIX = 'empFP1:', TTL = 24 * 3600 * 1000, MAX_HTML = 90000;
    var IDS = [
        'vf-biz-suggest-slider',          // Business Pages
        'suggested-users-slider',         // suggested people
        'dashboard-news-slider',
        'dashboard-market-slider',
        'dashboard-reels-slider',
        'dashboard-election-support-slider',
        'dashboard-scholarship-track'
    ];
    var PERSONAL = { 'vf-biz-suggest-slider': 1, 'suggested-users-slider': 1 };
    var T0 = Date.now();

    var desc = null;
    try { desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML'); } catch (e) {}
    if (!desc || !desc.set || !desc.get) return;

    var stale = {};       // id -> { uid } while its restored (inert) snapshot is still on screen
    var saveTimers = {};

    // inert until replaced — children only, so the strip itself can still be swiped
    try {
        var st = document.createElement('style');
        st.textContent = '[data-emp-fp]{pointer-events:none !important;}';
        (document.head || document.documentElement).appendChild(st);
    } catch (e) {}

    function curUid() {
        try {
            if (window.fbAuth && window.fbAuth.currentUser) return window.fbAuth.currentUser.uid || '';
            if (window.userState && window.userState.id && !window.isGuest) return String(window.userState.id);
        } catch (e) {}
        return '';
    }

    // decoding=async on all, high priority for the first two, lazy after the third
    function tune(html) {
        var n = 0;
        return String(html).replace(/<img\b([^>]*?)(\/?)>/gi, function (m, attrs, slash) {
            if ((attrs.split('"').length - 1) % 2 || (attrs.split("'").length - 1) % 2) return m; // unbalanced quotes: leave alone
            n++;
            var add = '';
            if (!/\sdecoding\s*=/i.test(attrs)) add += ' decoding="async"';
            if (n > 3) { if (!/\sloading\s*=/i.test(attrs)) add += ' loading="lazy"'; }
            else if (n <= 2 && !/\sfetchpriority\s*=/i.test(attrs)) add += ' fetchpriority="high"';
            return add ? '<img' + attrs + add + slash + '>' : m;
        });
    }

    function looksLikeLoading(html) {
        return html.length < 900 && /fa-spin|skeleton|spinner|>\s*loading|loading\s*[.\u2026]/i.test(html);
    }

    function release(el) {
        if (!el || !stale[el.id]) return;
        delete stale[el.id];
        try { Array.prototype.forEach.call(el.querySelectorAll('[data-emp-fp]'), function (n) { n.removeAttribute('data-emp-fp'); }); } catch (e) {}
    }
    function wipeStale(el) {
        if (!el || !stale[el.id]) return;
        delete stale[el.id];
        try { Array.prototype.slice.call(el.children).forEach(function (c) { if (c.hasAttribute('data-emp-fp')) el.removeChild(c); }); } catch (e) {}
    }

    function hook(el) {
        if (el._empFP) return;
        el._empFP = 1;
        // Route every `.innerHTML =` on this strip through tune(), and keep the restored snapshot on
        // screen while the app only clears it / shows a loading placeholder (first ~12s).
        try {
            Object.defineProperty(el, 'innerHTML', {
                configurable: true,
                get: function () { return desc.get.call(this); },
                set: function (v) {
                    if (typeof v === 'string' && stale[this.id] && Date.now() - T0 < 12000 && (!v.trim() || looksLikeLoading(v))) return;
                    if (stale[this.id]) delete stale[this.id];
                    desc.set.call(this, typeof v === 'string' ? tune(v) : v);
                }
            });
        } catch (e) {}
        // appendChild-style renders: the first real node that isn't ours replaces the snapshot (no duplicates)
        try {
            new MutationObserver(function (muts) {
                var wasStale = !!stale[el.id];
                if (wasStale) {
                    var fresh = false;
                    muts.forEach(function (m) {
                        Array.prototype.forEach.call(m.addedNodes, function (n) {
                            if (n.nodeType === 1 && !n.hasAttribute('data-emp-fp')) fresh = true;
                        });
                    });
                    if (fresh) wipeStale(el);
                    else if (!el.querySelector('[data-emp-fp]')) delete stale[el.id];
                    if (fresh || !stale[el.id]) { /* fresh content is on screen now — fall through to save */ }
                }
                // new images added one by one: keep them off the critical path
                try {
                    var idx = 0;
                    Array.prototype.forEach.call(el.querySelectorAll('img'), function (img) {
                        idx++;
                        if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
                        if (idx > 3 && !img.hasAttribute('loading') && !img.complete) img.setAttribute('loading', 'lazy');
                    });
                } catch (e) {}
                scheduleSave(el);
            }).observe(el, { childList: true, subtree: false });
        } catch (e) {}
    }

    function scheduleSave(el) {
        clearTimeout(saveTimers[el.id]);
        saveTimers[el.id] = setTimeout(function () { save(el); }, 2000);
    }
    function save(el) {
        try {
            if (stale[el.id]) return;                                  // never re-save our own restored copy
            if (!el.children.length) return;                           // nothing rendered
            var html = desc.get.call(el);
            if (html.length > MAX_HTML || looksLikeLoading(html)) return;
            if (el.querySelector('[data-emp-fp]')) return;
            LS.setItem(PREFIX + el.id, JSON.stringify({ t: Date.now(), uid: curUid(), h: html }));
        } catch (e) { /* quota / private mode — just skip */ }
    }

    function restore(el) {
        try {
            if (el.children.length) return;                            // the app already rendered something
            var raw = LS.getItem(PREFIX + el.id); if (!raw) return;
            var snap = JSON.parse(raw);
            if (!snap || typeof snap.h !== 'string' || !snap.h || Date.now() - (snap.t || 0) > TTL) { LS.removeItem(PREFIX + el.id); return; }
            desc.set.call(el, snap.h);
            Array.prototype.forEach.call(el.children, function (c) { c.setAttribute('data-emp-fp', '1'); });
            if (!el.children.length) return;
            stale[el.id] = { uid: snap.uid || '' };
            // the strip's card may still be display:none until the app's own data arrives — show it now
            var box = el.closest ? el.closest('[id$="-container"]') : null;
            if (box && box.style && box.style.display === 'none') box.style.display = '';
        } catch (e) {}
    }

    function checkUser() {
        // personal strips must never show another account's suggestions
        var uid = curUid();
        IDS.forEach(function (id) {
            var s = stale[id]; if (!s || !PERSONAL[id]) return;
            if ((s.uid || '') !== uid) { var el = document.getElementById(id); if (el) wipeStale(el); try { LS.removeItem(PREFIX + id); } catch (e) {} }
        });
    }

    function init() {
        IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            hook(el);
            restore(el);
        });
        // once we know who is signed in, drop any restored personal snapshot that belongs to someone else
        var tries = 0, iv = setInterval(function () {
            tries++;
            if (window.fbAuth && (window.fbAuth.currentUser || tries > 20)) { checkUser(); }
            if (tries > 40) clearInterval(iv);
        }, 500);
        document.addEventListener('empyrean-init-done', function () { setTimeout(checkUser, 300); });
        try { window.addEventListener('pagehide', function () { IDS.forEach(function (id) { var el = document.getElementById(id); if (el) save(el); }); }); } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();


/* =============================================================================
   PATCH v51 (appended to this file — no new file, no index.html change)
   WhatsApp-style Messages list: typography, edge-to-edge layout, single
   filter row, and the missing group/broadcast pin / mute / typing / network
   status.

   WHAT ALREADY EXISTED (left untouched, only styled):
     - 1:1 rows: time-sorted order (CSS `order`, pinned first), pin, mute,
       "typing…", "Waiting for network" — all in app-chat.js / app-patch-v36.js.
   WHAT THIS ADDS:
     §1 CSS   — Roboto/WhatsApp text styles, edge-to-edge list + header, styled
                filter chips (they had no CSS at all and collapsed), the second
                tab row (#v20-chat-tabs) hidden. The tab row stays in the DOM
                on purpose: app-chat.js drives Groups/Broadcasts/Marketplace/
                Calls by .click()-ing those tab buttons from the chips.
     §2 JS    — pin + mute for GROUP and BROADCAST rows (long-press menu, same
                localStorage keys/3-pin cap as 1:1), pin/mute icons on rows.
     §3 JS    — "typing…" on group rows via groups/{id}/typing/{uid} docs.
     §4 JS    — "Waiting for network…" banner above the list while offline.
   ============================================================================= */
(function empyreanPatchV51() {
    'use strict';
    /* FIX (2026-10-21): this guard used window._empPatchV51Loaded, the SAME flag
       app-patch-v42.js's unrelated V51 module (live polls / combo burst) already
       sets earlier in the load order. This block therefore always returned here
       and never ran, so none of its chip-row CSS (flex-shrink:0, min-height, pill
       styling, hidden scrollbars) was ever injected — the filter chips collapsed
       to a ~14px strip and the chat list appeared to cover them. Unique name. */
    if (window._empPatchV51ChatListLoaded) return;
    window._empPatchV51ChatListLoaded = true;

    function log(m) { console.log('[V51] ' + m); }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _notify(m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info'); }
    function _us() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _mu() { return (window.EmpState && window.EmpState.mockUsers) || window.mockUsers || {}; }
    function _myId() { return _us().id || ''; }
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }

    var PIN_KEY = 'emp_chat_pins', MUTE_KEY = 'emp_chat_mutes';   // same keys app-chat.js uses for 1:1
    function _arr(k) { try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { return []; } }
    function _save(k, a) { try { localStorage.setItem(k, JSON.stringify(a)); } catch (e) {} }

    var ROW_SEL = '#contacts-inner .v14-group-item[data-group-id], #contacts-inner .v20-broadcast-item[data-broadcast-id]';
    function _rowId(r) { return r.dataset.groupId || r.dataset.broadcastId || ''; }

    /* ======================================================================
       §1  CSS
       ====================================================================== */
    (function injectCSS() {
        if (document.getElementById('pv51-wa-chatlist-css')) return;
        var s = document.createElement('style');
        s.id = 'pv51-wa-chatlist-css';
        s.textContent = [
            /* REVERTED (user request, 2026-10-21): the v51 flat header / edge-to-edge / row-metric overrides are removed so the list looks as it did before — curved header card, inset layout, app-chat.js row styling. Only the chip row styling, the single filter row and hidden scrollbars remain. */
            '#contact-list-container::-webkit-scrollbar,#chat-filter-chips::-webkit-scrollbar,#v8-quick-contacts::-webkit-scrollbar{width:0;height:0;display:none;}',
            '#v8-quick-contacts,#chat-filter-chips{scrollbar-width:none;}',

            /* ONE filter row: navy pill chips (active = filled navy) */
            '#chat-filter-chips{flex-shrink:0!important;display:flex!important;align-items:center;gap:8px!important;padding:6px 8px 10px!important;min-height:48px;box-sizing:border-box;overflow-x:auto;-webkit-overflow-scrolling:touch;background:#fff;}',
            '#chat-filter-chips .chat-chip{flex:0 0 auto;white-space:nowrap;-webkit-appearance:none;appearance:none;border:2px solid #D6E8F8;background:#fff;color:#1B2B8B;border-radius:999px;padding:7px 17px;font-size:0.98rem;font-weight:600;line-height:1.2;cursor:pointer;}',
            '#chat-filter-chips .chat-chip.active{background:#1B2B8B;border-color:#1B2B8B;color:#fff;}',
            '#chat-chip-unread-count{margin-left:4px;font-size:0.8rem;font-weight:700;}',
            /* the second row (Chats | Groups | Broadcasts | Marketplace | Calls): hidden, NOT removed — chips click it */
            '#v20-chat-tabs{display:none!important;}',

            /* typing label (1:1 + group) */
            '#contacts-inner .emp-status-typing,#contacts-inner .pv51-typing{color:#1FA855!important;font-weight:500!important;}',

            /* pin / mute flags on group + broadcast rows */
            '.pv51-flags{display:flex;align-items:center;gap:6px;min-height:14px;}',
            '#contacts-inner [data-muted="1"] .v14-group-badge-slot span{background:#9CA3AF!important;}',

            /* offline banner */
            '#pv51-net-banner{display:none;align-items:center;gap:8px;padding:7px 16px;background:#FFF4D6;color:#7A5B00;font-size:0.86rem;font-weight:500;flex-shrink:0;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();

    /* ======================================================================
       §2  Pin / mute for group + broadcast rows
       ====================================================================== */
    var _SVG_PIN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#8A92A8" aria-label="Pinned"><path d="M16 3l5 5-2 1-3.5 3.5.5 4-1.5 1.5-3.5-3.5L6 20l-1-1 4.5-5.5L6 10l1.5-1.5 4 .5L15 5z"/></svg>';
    var _SVG_MUTE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A92A8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Muted"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>';

    function _decorateOne(r) {
        var id = _rowId(r); if (!id) return;
        var pinned = _arr(PIN_KEY).indexOf(id) !== -1, muted = _arr(MUTE_KEY).indexOf(id) !== -1;
        var wantPin = pinned ? '1' : '';
        if ((r.dataset.pinned || '') !== wantPin) { if (pinned) r.dataset.pinned = '1'; else delete r.dataset.pinned; }
        if (typeof window._empApplyRowOrder === 'function') window._empApplyRowOrder(r);
        if (muted) r.dataset.muted = '1'; else delete r.dataset.muted;

        var col = r.lastElementChild; if (!col) return;
        var f = r.querySelector('.pv51-flags');
        if (!f) { f = document.createElement('div'); f.className = 'pv51-flags'; col.appendChild(f); }
        var html = (pinned ? _SVG_PIN : '') + (muted ? _SVG_MUTE : '');
        if (f.innerHTML !== html) f.innerHTML = html;
    }

    function _openMenu(row) {
        var id = _rowId(row); if (!id) return;
        var old = document.getElementById('pv51-row-menu'); if (old) old.remove();
        var nm = row.querySelector('strong'); nm = nm ? nm.textContent : 'Chat';
        var pinned = _arr(PIN_KEY).indexOf(id) !== -1, muted = _arr(MUTE_KEY).indexOf(id) !== -1;
        var btn = 'display:block;width:100%;text-align:left;padding:16px 22px;border:0;border-top:1px solid #F0F2F7;background:#fff;font-size:0.95rem;color:#0A0E27;cursor:pointer;font-family:inherit;';
        var ov = document.createElement('div');
        ov.id = 'pv51-row-menu';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,39,0.45);display:flex;align-items:flex-end;justify-content:center;';
        ov.innerHTML = '<div style="background:#fff;width:100%;max-width:520px;border-radius:22px 22px 0 0;overflow:hidden;">'
            + '<div style="padding:16px 22px 12px;font-weight:700;color:#0A0E27;">' + _esc(nm) + '</div>'
            + '<button type="button" data-act="pin" style="' + btn + '">' + (pinned ? 'Unpin chat' : 'Pin chat') + '</button>'
            + '<button type="button" data-act="mute" style="' + btn + '">' + (muted ? 'Unmute notifications' : 'Mute notifications') + '</button>'
            + '<button type="button" data-act="close" style="' + btn + 'color:#5B6270;">Cancel</button></div>';
        ov.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-act]');
            if (!b && e.target !== ov) return;
            ov.remove();
            if (!b) return;
            if (b.dataset.act === 'pin') {
                var pins = _arr(PIN_KEY), i = pins.indexOf(id);
                if (i === -1) {
                    if (pins.length >= 3) { _notify('You can pin up to 3 chats.', 'warning'); return; }
                    pins.push(id);
                } else pins.splice(i, 1);
                _save(PIN_KEY, pins);
            } else if (b.dataset.act === 'mute') {
                var ms = _arr(MUTE_KEY), j = ms.indexOf(id);
                if (j === -1) ms.push(id); else ms.splice(j, 1);
                _save(MUTE_KEY, ms);
                _notify(j === -1 ? 'Chat muted.' : 'Chat unmuted.', 'info');
            }
            _scheduleDecorate(0);
        });
        document.body.appendChild(ov);
    }

    /* long-press (600ms) on a group/broadcast row — own listeners + own click
       swallow flag; never touches app-chat.js's 1:1 long-press. */
    var _lpT = null, _lpFired = false;
    function _lpStart(e) {
        var row = e.target.closest && e.target.closest(ROW_SEL);
        if (!row) return;
        _lpFired = false; clearTimeout(_lpT);
        _lpT = setTimeout(function () { _lpFired = true; _openMenu(row); }, 600);
    }
    function _lpCancel() { clearTimeout(_lpT); }
    document.addEventListener('touchstart', _lpStart, { passive: true });
    document.addEventListener('mousedown', _lpStart);
    ['touchend', 'touchmove', 'touchcancel', 'mouseup', 'mouseleave'].forEach(function (ev) { document.addEventListener(ev, _lpCancel, { passive: true }); });
    document.addEventListener('click', function (e) {
        if (_lpFired) { _lpFired = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
    document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest(ROW_SEL)) e.preventDefault(); });

    /* ======================================================================
       §3  Group "typing…"
       Reads/writes groups/{gid}/typing/{uid} = { t: <ms> }. A subcollection
       (not a field on the group doc) so a typing ping can't re-fire every
       member's groups-list listener and rebuild the Messages list.
       ====================================================================== */
    var _openGid = null, _lastWrite = 0, _writeDisabled = false, _readDisabled = false;
    var _subs = {};    // gid -> unsubscribe
    var _typing = {};  // gid -> { ready, seen:{uid:val}, active:{uid:true}, timers:{uid:id} }

    function _wrapOpenGroup() {
        var o = window.openGroupChat;
        if (typeof o !== 'function' || o._pv51) return;
        var w = function (gid) { _openGid = gid; return o.apply(this, arguments); };
        w._pv51 = true;
        window.openGroupChat = w;
    }
    _wrapOpenGroup(); setTimeout(_wrapOpenGroup, 500); setTimeout(_wrapOpenGroup, 1500);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_wrapOpenGroup, 300); });
    /* belt-and-braces: remember the last group row tapped even if the wrapper above is replaced later */
    document.addEventListener('click', function (e) {
        var r = e.target.closest && e.target.closest('.v14-group-item[data-group-id]');
        if (r) _openGid = r.dataset.groupId;
    }, true);

    document.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || t.id !== 'v13-grp-input' || !_openGid || _writeDisabled || !_fbOk()) return;
        var me = _myId(); if (!me) return;
        var now = Date.now();
        if (now - _lastWrite < 2500) return;
        _lastWrite = now;
        try {
            window.fbDb.collection('groups').doc(_openGid).collection('typing').doc(me).set({ t: now }).catch(function (err) {
                if (err && err.code === 'permission-denied') { _writeDisabled = true; console.warn('[V51] group typing write blocked by Firestore rules (groups/{id}/typing/{uid}) — group "typing…" disabled.'); }
            });
        } catch (er) {}
    });

    function _watchGroup(gid) {
        if (_subs[gid] || _readDisabled || !_fbOk()) return;
        var st = _typing[gid] = { ready: false, seen: {}, active: {}, timers: {} };
        try {
            _subs[gid] = window.fbDb.collection('groups').doc(gid).collection('typing').onSnapshot(function (snap) {
                var me = _myId(), authUid = window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid;
                snap.forEach(function (d) {
                    var uid = d.id; if (uid === me || uid === authUid) return;
                    var v = Number((d.data() || {}).t) || 0, prev = st.seen[uid];
                    st.seen[uid] = v;
                    if (!st.ready || !v || v === prev) return;       // first snapshot = baseline only
                    st.active[uid] = true;
                    clearTimeout(st.timers[uid]);
                    st.timers[uid] = setTimeout(function () { delete st.active[uid]; _scheduleDecorate(0); }, 5000);
                });
                st.ready = true;
                _scheduleDecorate(0);
            }, function (err) {
                if (err && err.code === 'permission-denied') { _readDisabled = true; console.warn('[V51] group typing read blocked by Firestore rules — group "typing…" disabled.'); }
                delete _subs[gid];
            });
        } catch (e) { delete _subs[gid]; }
    }

    function _typingLabel(gid) {
        var st = _typing[gid]; if (!st) return '';
        var ids = Object.keys(st.active);
        if (!ids.length) return '';
        if (ids.length > 1) return ids.length + ' people are typing\u2026';
        var u = _mu()[ids[0]], nm = u && (u.fullName || u.username);
        return (nm ? String(nm).trim().split(/\s+/)[0] : 'Someone') + ' is typing\u2026';
    }

    function _applyGroupTyping(r) {
        var gid = r.dataset.groupId; if (!gid) return;
        var prev = r.querySelector('.v14-group-preview'); if (!prev) return;
        var label = _typingLabel(gid), showing = prev.classList.contains('pv51-typing');
        if (label) {
            if (showing && prev.textContent !== label && prev.textContent !== prev.dataset.pv51Cur) prev.dataset.pv51Orig = prev.textContent; // real preview arrived meanwhile
            else if (!showing) prev.dataset.pv51Orig = prev.textContent;
            prev.dataset.pv51Cur = label;
            if (prev.textContent !== label) prev.textContent = label;
            prev.classList.add('pv51-typing');
        } else if (showing) {
            prev.textContent = prev.dataset.pv51Orig || prev.textContent;
            prev.classList.remove('pv51-typing');
            delete prev.dataset.pv51Cur;
        }
    }

    /* ======================================================================
       decorate pass — idempotent, debounced, observer disconnected while writing
       ====================================================================== */
    var _mo = null, _decT = null, _inner = null;
    function _decorate() {
        var inner = document.getElementById('contacts-inner'); if (!inner) return;
        if (_mo) _mo.disconnect();
        try {
            var present = {};
            Array.prototype.forEach.call(document.querySelectorAll(ROW_SEL), function (r) {
                _decorateOne(r);
                if (r.dataset.groupId) {
                    present[r.dataset.groupId] = true;
                    if (Object.keys(_subs).length < 20) _watchGroup(r.dataset.groupId);
                    _applyGroupTyping(r);
                }
            });
            Object.keys(_subs).forEach(function (gid) {                // drop listeners for groups no longer listed
                if (!present[gid] && _subs[gid]) { try { _subs[gid](); } catch (e) {} delete _subs[gid]; delete _typing[gid]; }
            });
        } finally {
            if (_mo && _inner) _mo.observe(_inner, { childList: true, subtree: true, characterData: true });
        }
    }
    function _scheduleDecorate(ms) { clearTimeout(_decT); _decT = setTimeout(_decorate, ms == null ? 120 : ms); }

    function _attachObserver() {
        var inner = document.getElementById('contacts-inner');
        if (!inner || (_mo && _inner === inner)) return;
        if (_mo) _mo.disconnect();
        _inner = inner;
        _mo = new MutationObserver(function () { _scheduleDecorate(120); });
        _mo.observe(inner, { childList: true, subtree: true, characterData: true });
        _scheduleDecorate(0);
    }

    /* ======================================================================
       §4  Offline banner ("Waiting for network…")
       ====================================================================== */
    function _ensureBanner() {
        var b = document.getElementById('pv51-net-banner');
        if (b) return b;
        var inner = document.getElementById('contacts-inner'); if (!inner || !inner.parentNode) return null;
        b = document.createElement('div');
        b.id = 'pv51-net-banner';
        b.innerHTML = '<i class="fas fa-wifi" style="opacity:.7;"></i><span>Waiting for network\u2026</span>';
        inner.parentNode.insertBefore(b, inner);
        return b;
    }
    function _syncNet() {
        var b = _ensureBanner(); if (!b) return;
        b.style.display = (navigator.onLine === false) ? 'flex' : 'none';
    }
    window.addEventListener('offline', _syncNet);
    window.addEventListener('online', function () { setTimeout(_syncNet, 400); });

    /* ======================================================================
       boot
       ====================================================================== */
    function _boot() { _attachObserver(); _syncNet(); }
    ready(function () { setTimeout(_boot, 600); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_boot, 400); });
    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && ev.detail.section === 'messages') { setTimeout(_boot, 200); setTimeout(_boot, 1200); }
    });
    window.addEventListener('storage', function (e) { if (e.key === PIN_KEY || e.key === MUTE_KEY) _scheduleDecorate(0); });

    log('\u2705 WhatsApp-style Messages list: single filter row, edge-to-edge, group/broadcast pin+mute, group typing, offline banner.');
})();
