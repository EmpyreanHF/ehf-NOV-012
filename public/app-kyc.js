// ============================================================
// app-kyc.js  —  Empyrean KYC (Know Your Customer) Module
// Step 0.12c
//
// Responsibilities:
//   1. kycFormHTML()           — generates the full KYC form markup
//                                (6 entity types: Individual, Company, NGO,
//                                Cooperative, Government Agency, International
//                                Organization/Institution)
//   2. populateDobSelectors()  — fills Day / Month / Year dropdowns
//   3. initKycUploads()        — binds custom upload areas + live selfie buttons
//   4. simulateSelfie()        — fallback when camera is unavailable
//   5. KYC camera snap         — capture-to-canvas → Cloudinary upload
//   6. Entity selector handler — show/hide entity sub-forms, auto-fill fields
//   7. KYC form submission     — validation, Cloudinary docs, Firestore persist
//   8. renderAdminKycDocs()    — admin panel KYC queue renderer
//   9. approveKyc() / rejectKyc() — admin status actions
//  10. KYC tab re-init         — reinitialises bindings when profile KYC tab opens
//
// Dependencies (must be loaded before this file):
//   firebase-init.js, app-state.js, app-helpers.js, app-notifications.js
//
// Exposes on window:
//   window.initKycUploads, window.populateDobSelectors,
//   window.renderAdminKycDocs, window.approveKyc, window.rejectKyc,
//   window.kycFormHTML (string), window._kycSubmissions, window._kycQueue
// ============================================================

(function empyreanKycModule() {
    'use strict';

    // ── Internal camera state ────────────────────────────────────────────────
    var _kycCameraBtn    = null; // active .live-capture-btn element
    var _kycCameraStream = null; // MediaStream from getUserMedia

    // ── Init guard: run after DOM is ready ───────────────────────────────────
    function _ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    // ── Helper shortcuts ─────────────────────────────────────────────────────
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _state() {
        return window.userState || {};
    }

    // ============================================================
    // 1. KYC Form HTML  (injected inside profile-kyc-tab)
    // ============================================================
    var kycFormHTML = [
        '<div class="card"><div class="card-content">',
        '  <h3><i class="fas fa-shield-alt"></i> Account Verification (KYC)</h3>',
        '  <p>Complete verification to access all platform features, including withdrawals.</p>',
        '  <hr style="border:1px solid #eee;margin:20px 0;">',

        '  <div id="kyc-entity-selector-container">',
        '    <h4>Step 1: Select Entity Type</h4>',
        '    <div id="kyc-entity-selector" style="margin-top:20px;">',
        '      <div class="kyc-entity-btn" data-form="individual-kyc-form"><i class="fas fa-user"></i><span>Individual</span></div>',
        '      <div class="kyc-entity-btn" data-form="ngo-kyc-form"><i class="fas fa-sitemap"></i><span>NGO</span></div>',
        '      <div class="kyc-entity-btn" data-form="company-kyc-form"><i class="fas fa-building"></i><span>Company</span></div>',
        '      <div class="kyc-entity-btn" data-form="cooperative-kyc-form"><i class="fas fa-users"></i><span>Cooperative</span></div>',
        '      <div class="kyc-entity-btn" data-form="government-kyc-form"><i class="fas fa-landmark"></i><span>Government Agency</span></div>',
        '      <div class="kyc-entity-btn" data-form="international-kyc-form"><i class="fas fa-globe"></i><span>International Organization</span></div>',
        '    </div>',
        '  </div>',

        '  <div id="kyc-forms-container" style="margin-top:30px;">',

        // ── Individual ──────────────────────────────────────────────────────
        '    <form id="individual-kyc-form" class="kyc-form" novalidate>',
        '      <h4>Step 2: Individual Verification</h4>',
        '      <div class="grid-2">',
        '        <div class="form-group"><label for="kyc-ind-fname">First Name</label><input type="text" id="kyc-ind-fname" required></div>',
        '        <div class="form-group"><label for="kyc-ind-lname">Last Name</label><input type="text" id="kyc-ind-lname" required></div>',
        '      </div>',
        '      <div class="form-group"><label>Date of Birth</label>',
        '        <div class="date-select-group">',
        '          <select required><option value="">Day</option></select>',
        '          <select required><option value="">Month</option></select>',
        '          <select required><option value="">Year</option></select>',
        '        </div>',
        '      </div>',
        '      <div class="form-group"><label for="kyc-ind-gender">Gender</label>',
        '        <select id="kyc-ind-gender" required><option value="">--Select--</option><option>Male</option><option>Female</option></select>',
        '      </div>',
        '      <div class="form-group"><label for="kyc-ind-phone">Phone</label><input type="tel" id="kyc-ind-phone" required></div>',
        '      <div class="form-group"><label for="kyc-ind-email">Email</label><input type="email" id="kyc-ind-email" required></div>',
        '      <div class="form-group"><label for="kyc-ind-address">Residential Address</label><input type="text" id="kyc-ind-address" required></div>',
        '      <div class="form-group"><label for="kyc-ind-id-type">ID Type</label>',
        '        <select id="kyc-ind-id-type" required><option value="">--Select--</option><option>Passport</option><option>National ID</option><option>Driver\'s License</option><option>Voter\'s Card</option></select>',
        '      </div>',
        '      <div class="form-group"><label for="kyc-ind-id-number">ID Number</label><input type="text" id="kyc-ind-id-number" required></div>',
        '      <div class="form-group"><label>Upload ID (Front &amp; Back)</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-ind-id-upload"><i class="fas fa-id-card"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-ind-id-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-ind-id-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Selfie Verification</label>',
        '        <button type="button" class="btn btn-small live-capture-btn" id="kyc-ind-selfie-btn" data-captured="false" data-original-required="true"><i class="fas fa-camera"></i> Capture Live Selfie</button>',
        '        <span class="file-upload-preview" id="kyc-ind-selfie-preview"></span>',
        '      </div>',
        '      <button type="submit" class="btn btn-accent">Submit Verification</button>',
        '    </form>',

        // ── Company ─────────────────────────────────────────────────────────
        '    <form id="company-kyc-form" class="kyc-form" novalidate>',
        '      <h4>Step 2: Company Verification</h4>',
        '      <div class="form-group"><label for="kyc-com-name">Organisation Name</label><input type="text" id="kyc-com-name" required></div>',
        '      <div class="form-group"><label for="kyc-com-cac">CAC Registration Number</label><input type="text" id="kyc-com-cac" required></div>',
        '      <div class="form-group"><label for="kyc-com-scuml">SCUML Certificate Number</label><input type="text" id="kyc-com-scuml" required></div>',
        '      <div class="form-group"><label for="kyc-com-rep-name">CEO/Representative Name</label><input type="text" id="kyc-com-rep-name" required></div>',
        '      <div class="form-group"><label for="kyc-com-phone">Official Phone</label><input type="tel" id="kyc-com-phone" required></div>',
        '      <div class="form-group"><label for="kyc-com-email">Official Email</label><input type="email" id="kyc-com-email" required></div>',
        '      <div class="form-group"><label for="kyc-com-address">Office Address</label><input type="text" id="kyc-com-address" required></div>',
        '      <div class="form-group"><label>Upload CAC Certificate</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-com-cac-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-com-cac-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-com-cac-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Upload SCUML Certificate</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-com-scuml-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-com-scuml-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-com-scuml-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s ID</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-com-rep-id-upload"><i class="fas fa-id-card"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-com-rep-id-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-com-rep-id-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s Selfie</label>',
        '        <button type="button" class="btn btn-small live-capture-btn" id="kyc-com-selfie-btn" data-captured="false" data-original-required="true"><i class="fas fa-camera"></i> Capture Live Selfie</button>',
        '        <span class="file-upload-preview" id="kyc-com-selfie-preview"></span>',
        '      </div>',
        '      <button type="submit" class="btn btn-accent">Submit Verification</button>',
        '    </form>',

        // ── NGO ─────────────────────────────────────────────────────────────
        '    <form id="ngo-kyc-form" class="kyc-form" novalidate>',
        '      <h4>Step 2: NGO Verification</h4>',
        '      <div class="form-group"><label for="kyc-ngo-name">Organisation Name</label><input type="text" id="kyc-ngo-name" required></div>',
        '      <div class="form-group"><label for="kyc-ngo-cac">CAC Registration Number</label><input type="text" id="kyc-ngo-cac" required></div>',
        '      <div class="form-group"><label for="kyc-ngo-scuml">SCUML Certificate Number</label><input type="text" id="kyc-ngo-scuml" required></div>',
        '      <div class="form-group"><label for="kyc-ngo-rep-name">President/Representative Name</label><input type="text" id="kyc-ngo-rep-name" required></div>',
        '      <div class="form-group"><label for="kyc-ngo-phone">Official Phone</label><input type="tel" id="kyc-ngo-phone" required></div>',
        '      <div class="form-group"><label for="kyc-ngo-email">Official Email</label><input type="email" id="kyc-ngo-email" required></div>',
        '      <div class="form-group"><label for="kyc-ngo-address">Office Address</label><input type="text" id="kyc-ngo-address" required></div>',
        '      <div class="form-group"><label>Upload CAC Certificate</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-ngo-cac-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-ngo-cac-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-ngo-cac-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Upload SCUML Certificate</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-ngo-scuml-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-ngo-scuml-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-ngo-scuml-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s ID</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-ngo-rep-id-upload"><i class="fas fa-id-card"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-ngo-rep-id-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-ngo-rep-id-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s Selfie</label>',
        '        <button type="button" class="btn btn-small live-capture-btn" id="kyc-ngo-selfie-btn" data-captured="false" data-original-required="true"><i class="fas fa-camera"></i> Capture Live Selfie</button>',
        '        <span class="file-upload-preview" id="kyc-ngo-selfie-preview"></span>',
        '      </div>',
        '      <button type="submit" class="btn btn-accent">Submit Verification</button>',
        '    </form>',

        // ── Cooperative ─────────────────────────────────────────────────────
        '    <form id="cooperative-kyc-form" class="kyc-form" novalidate>',
        '      <h4>Step 2: Cooperative Society Verification</h4>',
        '      <div class="form-group"><label for="kyc-coop-name">Organisation Name</label><input type="text" id="kyc-coop-name" required></div>',
        '      <div class="form-group"><label for="kyc-coop-cert">Certificate Number</label><input type="text" id="kyc-coop-cert" required></div>',
        '      <div class="form-group"><label for="kyc-coop-tin">TIN Number</label><input type="text" id="kyc-coop-tin" required></div>',
        '      <div class="form-group"><label for="kyc-coop-rep-name">President/Representative Name</label><input type="text" id="kyc-coop-rep-name" required></div>',
        '      <div class="form-group"><label for="kyc-coop-phone">Official Phone</label><input type="tel" id="kyc-coop-phone" required></div>',
        '      <div class="form-group"><label for="kyc-coop-email">Official Email</label><input type="email" id="kyc-coop-email" required></div>',
        '      <div class="form-group"><label for="kyc-coop-address">Office Address</label><input type="text" id="kyc-coop-address" required></div>',
        '      <div class="form-group"><label>Upload Registration Certificate</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-coop-cert-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-coop-cert-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-coop-cert-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Upload TIN Document</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-coop-tin-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-coop-tin-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-coop-tin-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s ID</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-coop-rep-id-upload"><i class="fas fa-id-card"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-coop-rep-id-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-coop-rep-id-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s Selfie</label>',
        '        <button type="button" class="btn btn-small live-capture-btn" id="kyc-coop-selfie-btn" data-captured="false" data-original-required="true"><i class="fas fa-camera"></i> Capture Live Selfie</button>',
        '        <span class="file-upload-preview" id="kyc-coop-selfie-preview"></span>',
        '      </div>',
        '      <button type="submit" class="btn btn-accent">Submit Verification</button>',
        '    </form>',

        // ── Government Agency ──────────────────────────────────────────────
        '    <form id="government-kyc-form" class="kyc-form" novalidate>',
        '      <h4>Step 2: Government Agency Verification</h4>',
        '      <div class="form-group"><label for="kyc-gov-name">Agency/Ministry Name</label><input type="text" id="kyc-gov-name" required></div>',
        '      <div class="form-group"><label for="kyc-gov-parent">Supervising Ministry / Parent Body</label><input type="text" id="kyc-gov-parent" required></div>',
        '      <div class="form-group"><label for="kyc-gov-gazette">Gazette / Establishment Number</label><input type="text" id="kyc-gov-gazette" required></div>',
        '      <div class="form-group"><label for="kyc-gov-rep-name">Authorised Officer Name</label><input type="text" id="kyc-gov-rep-name" required></div>',
        '      <div class="form-group"><label for="kyc-gov-rep-title">Authorised Officer Designation/Title</label><input type="text" id="kyc-gov-rep-title" required></div>',
        '      <div class="form-group"><label for="kyc-gov-phone">Official Phone</label><input type="tel" id="kyc-gov-phone" required></div>',
        '      <div class="form-group"><label for="kyc-gov-email">Official Email</label><input type="email" id="kyc-gov-email" required></div>',
        '      <div class="form-group"><label for="kyc-gov-address">Office Address</label><input type="text" id="kyc-gov-address" required></div>',
        '      <div class="form-group"><label>Upload Certificate of Establishment / Gazette Notice</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-gov-gazette-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-gov-gazette-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-gov-gazette-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Upload Letter of Authorisation (on official letterhead)</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-gov-auth-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-gov-auth-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-gov-auth-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s ID</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-gov-rep-id-upload"><i class="fas fa-id-card"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-gov-rep-id-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-gov-rep-id-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s Selfie</label>',
        '        <button type="button" class="btn btn-small live-capture-btn" id="kyc-gov-selfie-btn" data-captured="false" data-original-required="true"><i class="fas fa-camera"></i> Capture Live Selfie</button>',
        '        <span class="file-upload-preview" id="kyc-gov-selfie-preview"></span>',
        '      </div>',
        '      <button type="submit" class="btn btn-accent">Submit Verification</button>',
        '    </form>',

        // ── International Organization / Institution ────────────────────────
        '    <form id="international-kyc-form" class="kyc-form" novalidate>',
        '      <h4>Step 2: International Organization / Institution Verification</h4>',
        '      <div class="form-group"><label for="kyc-intl-name">Organisation Name</label><input type="text" id="kyc-intl-name" required></div>',
        '      <div class="form-group"><label for="kyc-intl-hq-country">Country of Headquarters/Origin</label><input type="text" id="kyc-intl-hq-country" required></div>',
        '      <div class="form-group"><label for="kyc-intl-reg-number">International Registration/Charter Number</label><input type="text" id="kyc-intl-reg-number" required></div>',
        '      <div class="form-group"><label for="kyc-intl-permit">Local Operating Permit Number</label><input type="text" id="kyc-intl-permit" required></div>',
        '      <div class="form-group"><label for="kyc-intl-rep-name">Country Representative/Director Name</label><input type="text" id="kyc-intl-rep-name" required></div>',
        '      <div class="form-group"><label for="kyc-intl-phone">Official Phone</label><input type="tel" id="kyc-intl-phone" required></div>',
        '      <div class="form-group"><label for="kyc-intl-email">Official Email</label><input type="email" id="kyc-intl-email" required></div>',
        '      <div class="form-group"><label for="kyc-intl-address">Local Office Address</label><input type="text" id="kyc-intl-address" required></div>',
        '      <div class="form-group"><label>Upload International Registration/Charter Certificate</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-intl-reg-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-intl-reg-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-intl-reg-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Upload Local Operating Permit</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-intl-permit-upload"><i class="fas fa-file-alt"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-intl-permit-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-intl-permit-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s ID</label>',
        '        <div class="upload-area kyc-file-upload" data-input-id="kyc-intl-rep-id-upload"><i class="fas fa-id-card"></i><span>Click to upload</span></div>',
        '        <input type="file" id="kyc-intl-rep-id-upload" accept="image/*,.pdf" style="display:none;" required data-original-required="true">',
        '        <span class="file-upload-preview" id="kyc-intl-rep-id-upload-preview"></span>',
        '      </div>',
        '      <div class="form-group"><label>Representative\'s Selfie</label>',
        '        <button type="button" class="btn btn-small live-capture-btn" id="kyc-intl-selfie-btn" data-captured="false" data-original-required="true"><i class="fas fa-camera"></i> Capture Live Selfie</button>',
        '        <span class="file-upload-preview" id="kyc-intl-selfie-preview"></span>',
        '      </div>',
        '      <button type="submit" class="btn btn-accent">Submit Verification</button>',
        '    </form>',

        '  </div>', // #kyc-forms-container
        '</div></div>'
    ].join('\n');

    // Expose so renderUserProfile() can embed it
    window.kycFormHTML = kycFormHTML;

    // ============================================================
    // 2. populateDobSelectors  — fill Day / Month / Year <select>s
    // ============================================================
    function populateDobSelectors() {
        var dayEl   = document.querySelector('#individual-kyc-form .date-select-group select:nth-child(1)');
        var monthEl = document.querySelector('#individual-kyc-form .date-select-group select:nth-child(2)');
        var yearEl  = document.querySelector('#individual-kyc-form .date-select-group select:nth-child(3)');
        if (!dayEl || !monthEl || !yearEl) return;

        // Days
        dayEl.innerHTML = '<option value="">Day</option>';
        for (var d = 1; d <= 31; d++) {
            dayEl.innerHTML += '<option value="' + d + '">' + d + '</option>';
        }
        // Months
        var months = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
        monthEl.innerHTML = '<option value="">Month</option>';
        months.forEach(function(m, i) {
            monthEl.innerHTML += '<option value="' + (i + 1) + '">' + m + '</option>';
        });
        // Years (18 – 100 years ago)
        var currentYear = new Date().getFullYear();
        yearEl.innerHTML = '<option value="">Year</option>';
        for (var y = currentYear - 18; y >= currentYear - 100; y--) {
            yearEl.innerHTML += '<option value="' + y + '">' + y + '</option>';
        }
    }
    window.populateDobSelectors = populateDobSelectors;

    // ============================================================
    // 3. initKycUploads — bind custom upload areas + selfie buttons
    // ============================================================
    function initKycUploads() {
        // ── Custom file-upload areas (not native <input>) ──────────────────
        document.querySelectorAll('.upload-area.kyc-file-upload:not([data-kyc-bound])').forEach(function(area) {
            area.dataset.kycBound = '1';
            area.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                var inputId = this.dataset.inputId;
                var fi = document.getElementById(inputId);
                if (!fi) {
                    fi = document.createElement('input');
                    fi.type = 'file';
                    fi.id   = inputId;
                    fi.accept = 'image/*,.pdf';
                    fi.style.display = 'none';
                    document.body.appendChild(fi);
                }

                var self = this;
                fi.onchange = async function() {
                    if (!this.files || !this.files[0]) return;
                    var file      = this.files[0];
                    var shortName = file.name.length > 28 ? file.name.substring(0, 25) + '…' : file.name;

                    // Visual: uploading state
                    self.classList.add('has-file');
                    var existing = self.querySelector('.file-name-display');
                    if (existing) existing.remove();
                    var nm = document.createElement('span');
                    nm.className = 'file-name-display';
                    nm.innerHTML = '<i class="fas fa-sync-alt fa-spin" style="color:var(--primary-color);"></i> Uploading…';
                    self.appendChild(nm);

                    // Local preview
                    var previewEl = document.getElementById(inputId + '-preview');
                    if (previewEl) {
                        if (file.type.startsWith('image/')) {
                            var reader = new FileReader();
                            reader.onload = function(ev) {
                                previewEl.innerHTML = '<img src="' + ev.target.result + '" style="width:70px;height:55px;object-fit:cover;border-radius:5px;margin-top:6px;border:1px solid #ddd;">';
                            };
                            reader.readAsDataURL(file);
                        } else {
                            previewEl.innerHTML = '<span style="font-size:0.8rem;color:var(--primary-color);margin-top:6px;display:block;"><i class="fas fa-file-alt"></i> ' + shortName + '</span>';
                        }
                    }

                    // Upload to Cloudinary
                    if (!window._kycSubmissions) window._kycSubmissions = {};
                    try {
                        var cloudUrl = await window.uploadToCloudinary(file, null);
                        nm.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success-color);"></i> ' + shortName;
                        if (previewEl && file.type.startsWith('image/')) {
                            previewEl.innerHTML = '<img src="' + cloudUrl + '" style="width:70px;height:55px;object-fit:cover;border-radius:5px;margin-top:6px;border:2px solid var(--success-color);">';
                        }
                        window._kycSubmissions[inputId] = {
                            fileName: file.name, fileSize: file.size, type: file.type, cloudUrl: cloudUrl
                        };
                        // Persist document reference to Firestore
                        var us = _state();
                        try {
                            if (window.fbDb) {
                                await window.fbDb.collection('kyc_documents').add({
                                    userId: us.id, username: us.username,
                                    docType: inputId, fileName: file.name,
                                    cloudUrl: cloudUrl, uploadedAt: new Date().toISOString(), status: 'pending'
                                });
                            }
                        } catch (fsErr) { /* non-blocking */ }
                        if (typeof window.renderAdminKycDocs === 'function') window.renderAdminKycDocs();
                        _notify('✅ Document uploaded to cloud: ' + shortName, 'success');
                    } catch (uploadErr) {
                        console.warn('[KYC] Document upload failed:', uploadErr);
                        nm.innerHTML = '<i class="fas fa-exclamation-circle" style="color:var(--danger-color);"></i> Upload failed — saved locally';
                        window._kycSubmissions[inputId] = {
                            fileName: file.name, fileSize: file.size, type: file.type, cloudUrl: null
                        };
                        if (typeof window.renderAdminKycDocs === 'function') window.renderAdminKycDocs();
                        _notify('Document saved locally (cloud upload failed).', 'warning');
                    }
                };
                fi.click();
            });
        });

        // ── Live selfie / camera capture buttons ───────────────────────────
        document.querySelectorAll('.live-capture-btn:not([data-cam-bound])').forEach(function(btn) {
            btn.dataset.camBound = '1';
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                _kycCameraBtn = this;

                var modal  = document.getElementById('kyc-camera-modal');
                var video  = document.getElementById('kyc-camera-video');
                var status = document.getElementById('kyc-camera-status');

                // No modal in DOM — fall back to avatar placeholder
                if (!modal) { simulateSelfie(this); return; }

                if (status) status.textContent = 'Requesting camera access…';
                navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
                    .then(function(stream) {
                        _kycCameraStream = stream;
                        video.srcObject = stream;
                        video.play();
                        modal.classList.add('show');
                        if (status) status.textContent = 'Position your face and click Capture.';
                    })
                    .catch(function() {
                        simulateSelfie(_kycCameraBtn);
                    });
            });
        });
    }
    window.initKycUploads = initKycUploads;

    // ============================================================
    // 4. simulateSelfie — fallback when camera is unavailable
    // ============================================================
    function simulateSelfie(btn) {
        if (!btn) return;
        var previewId = btn.id.replace('-btn', '-preview');
        var previewEl = document.getElementById(previewId);
        var name      = (_state().fullName) || 'User';
        var avatarUrl = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=4A148C&color=fff&size=100';

        if (previewEl) {
            previewEl.innerHTML = '<img src="' + avatarUrl + '" style="width:70px;height:70px;border-radius:50%;object-fit:cover;border:2px solid var(--success-color);margin-top:6px;">';
        }
        btn.dataset.captured = 'true';
        btn.style.background = 'var(--success-color)';
        btn.innerHTML = '<i class="fas fa-check"></i> Selfie Captured';

        if (!window._kycSubmissions) window._kycSubmissions = {};
        window._kycSubmissions[btn.id] = { selfie: avatarUrl };

        if (typeof window.renderAdminKycDocs === 'function') window.renderAdminKycDocs();
        _notify('Camera unavailable — placeholder selfie used.', 'warning');
    }
    window.simulateSelfie = simulateSelfie;

    // ============================================================
    // 5. Camera snap  (Capture button inside kyc-camera-modal)
    // ============================================================
    function _bindCameraSnap() {
        var snapBtn = document.getElementById('kyc-capture-snap-btn');
        if (!snapBtn || snapBtn._kycSnapBound) return;
        snapBtn._kycSnapBound = true;

        snapBtn.addEventListener('click', async function() {
            var video  = document.getElementById('kyc-camera-video');
            var canvas = document.getElementById('kyc-camera-canvas');
            if (!video || !canvas) return;

            canvas.width  = video.videoWidth  || 480;
            canvas.height = video.videoHeight || 360;
            canvas.getContext('2d').drawImage(video, 0, 0);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.9);

            // Stop camera stream
            if (_kycCameraStream) {
                _kycCameraStream.getTracks().forEach(function(t) { t.stop(); });
                _kycCameraStream = null;
            }
            var modal = document.getElementById('kyc-camera-modal');
            if (modal) modal.classList.remove('show');

            if (!_kycCameraBtn) return;

            var previewId = _kycCameraBtn.id.replace('-btn', '-preview');
            var previewEl = document.getElementById(previewId);

            // Show immediately from canvas data
            if (previewEl) {
                previewEl.innerHTML = '<img src="' + dataUrl + '" style="width:70px;height:70px;border-radius:50%;object-fit:cover;border:2px solid var(--success-color);margin-top:6px;">';
            }
            _kycCameraBtn.dataset.captured = 'true';
            _kycCameraBtn.style.background = 'var(--success-color)';
            _kycCameraBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Uploading…';

            if (!window._kycSubmissions) window._kycSubmissions = {};
            window._kycSubmissions[_kycCameraBtn.id] = { selfie: dataUrl, cloudUrl: null };
            if (typeof window.renderAdminKycDocs === 'function') window.renderAdminKycDocs();

            // Upload selfie to Cloudinary
            try {
                var res        = await fetch(dataUrl);
                var blob       = await res.blob();
                var selfieFile = new File([blob], 'selfie-' + Date.now() + '.jpg', { type: 'image/jpeg' });
                var cloudUrl   = await window.uploadToCloudinary(selfieFile, null);

                if (previewEl) {
                    previewEl.innerHTML = '<img src="' + cloudUrl + '" style="width:70px;height:70px;border-radius:50%;object-fit:cover;border:2px solid var(--success-color);margin-top:6px;">';
                }
                _kycCameraBtn.innerHTML = '<i class="fas fa-check-circle"></i> Selfie Captured';
                window._kycSubmissions[_kycCameraBtn.id] = { selfie: cloudUrl, cloudUrl: cloudUrl };

                // Persist to Firestore
                var us = _state();
                try {
                    if (window.fbDb) {
                        await window.fbDb.collection('kyc_selfies').add({
                            userId: us.id, username: us.username,
                            selfieUrl: cloudUrl, capturedAt: new Date().toISOString(), status: 'pending'
                        });
                    }
                } catch (e) { /* non-blocking */ }

                if (typeof window.renderAdminKycDocs === 'function') window.renderAdminKycDocs();
                _notify('✅ Selfie captured and saved to cloud!', 'success');
            } catch (uploadErr) {
                console.warn('[KYC] Selfie upload failed:', uploadErr);
                _kycCameraBtn.innerHTML = '<i class="fas fa-check"></i> Selfie Captured';
                _notify('Selfie captured (cloud upload failed).', 'warning');
            }
        });
    }

    function _bindCameraClose() {
        var closeBtn = document.getElementById('kyc-camera-close-btn');
        if (!closeBtn || closeBtn._kycCloseBound) return;
        closeBtn._kycCloseBound = true;

        closeBtn.addEventListener('click', function() {
            if (_kycCameraStream) {
                _kycCameraStream.getTracks().forEach(function(t) { t.stop(); });
                _kycCameraStream = null;
            }
            var modal = document.getElementById('kyc-camera-modal');
            if (modal) modal.classList.remove('show');
        });
    }

    // ============================================================
    // 6. Entity selector handler
    //    Shows the chosen sub-form, resets others, auto-fills Individual
    // ============================================================
    function _handleEntitySelect(btn) {
        var formId = btn.dataset.form;
        if (!formId) return;

        // Activate button
        document.querySelectorAll('.kyc-entity-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');

        // Reset & hide all forms
        document.querySelectorAll('.kyc-form').forEach(function(f) {
            f.classList.remove('active');
            f.style.cssText = 'display:none !important;';
            f.querySelectorAll('.file-upload-preview').forEach(function(s) { s.innerHTML = ''; });
            f.querySelectorAll('input[type="file"]').forEach(function(i) { i.value = ''; });
            f.querySelectorAll('input, select, textarea, .upload-area, .live-capture-btn').forEach(function(el) {
                el.style.borderColor = '';
            });
            var selfieBtn = f.querySelector('.live-capture-btn');
            if (selfieBtn) selfieBtn.dataset.captured = 'false';
        });

        // Show selected form — search inside profile-kyc-tab to handle duplicate IDs safely
        var target = document.getElementById(formId);
        if (!target) {
            var kycTab = document.getElementById('profile-kyc-tab');
            if (kycTab) target = kycTab.querySelector('#' + formId);
        }
        if (!target) return;

        target.classList.add('active');
        target.style.cssText = 'display:block !important;';

        // Restore required attributes from data-original-required
        target.querySelectorAll('[data-original-required="true"]').forEach(function(el) {
            el.required = true;
        });
        target.querySelectorAll('.kyc-file-upload + input[type="file"]').forEach(function(fi) {
            fi.required = fi.hasAttribute('data-original-required') && fi.dataset.originalRequired === 'true';
        });
        var liveBtn = target.querySelector('.live-capture-btn');
        if (liveBtn) {
            liveBtn.required = liveBtn.hasAttribute('data-original-required') && liveBtn.dataset.originalRequired === 'true';
            liveBtn.dataset.captured = 'false';
        }

        // Auto-fill Individual form with user data
        if (formId === 'individual-kyc-form') {
            _autofillIndividualForm(target);
        }

        // Reinitialise upload areas + DOB selectors for the newly shown form
        setTimeout(function() {
            initKycUploads();
            populateDobSelectors();
        }, 50);

        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function _autofillIndividualForm(formEl) {
        var us = _state();
        if (!us || !us.fullName) return;
        var parts = (us.fullName || '').trim().split(' ');
        var fn = formEl.querySelector('#kyc-ind-fname, [id^="kyc-ind-fname"]');
        var ln = formEl.querySelector('#kyc-ind-lname, [id^="kyc-ind-lname"]');
        var em = formEl.querySelector('#kyc-ind-email, [id^="kyc-ind-email"]');
        var ph = formEl.querySelector('#kyc-ind-phone, [id^="kyc-ind-phone"]');
        if (fn && !fn.value) fn.value = parts[0] || '';
        if (ln && !ln.value) ln.value = parts.slice(1).join(' ') || '';
        if (em && !em.value) em.value = us.email || '';
        if (ph && !ph.value) ph.value = us.phone || '';
    }

    // ============================================================
    // 7. KYC form submission — validate, collect docs, save to Firestore
    // ============================================================
    async function _submitKycForm(form) {
        var isValid = true;

        // Validate visible required text/select inputs
        Array.from(form.querySelectorAll('input:not([type="file"]):not([type="hidden"]), select, textarea'))
            .forEach(function(input) {
                if (input.required && input.offsetParent !== null && input.value.trim() === '') {
                    input.style.borderColor = 'var(--danger-color)';
                    isValid = false;
                } else {
                    input.style.borderColor = '';
                }
            });

        // Validate custom upload areas: must have a file-name-display child
        Array.from(form.querySelectorAll('.kyc-file-upload.upload-area')).forEach(function(area) {
            var hasFile    = area.classList.contains('has-file') || !!area.querySelector('.file-name-display');
            var inputId    = area.dataset.inputId;
            var origInput  = inputId ? document.getElementById(inputId) : null;
            var isRequired = area.dataset.required === 'true' || (origInput && origInput.required);
            if (isRequired && !hasFile) {
                area.style.borderColor = 'var(--danger-color)';
                isValid = false;
            } else {
                area.style.borderColor = '';
            }
        });

        if (!isValid) {
            _notify('Please fill all required fields and upload all required documents.', 'error');
            return;
        }

        var kycType    = form.id.replace('-kyc-form', '');
        var submitBtn  = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            var us = _state();
            var kycData = {
                id:          'kyc-' + Date.now(),
                userId:      us.id,
                username:    us.username,
                type:        kycType,
                documents:   window._kycSubmissions || {},
                submittedAt: new Date().toISOString(),
                status:      'pending'
            };

            // Persist to Firestore
            try {
                if (window.fbDb) await window.fbDb.collection('kyc_submissions').add(kycData);
            } catch (e) { /* non-blocking */ }

            // Add to in-memory admin queue
            if (!window._kycQueue) window._kycQueue = [];
            var entityTypeMap = {
                'individual-kyc-form':    'Individual',
                'company-kyc-form':       'Company',
                'ngo-kyc-form':           'NGO',
                'cooperative-kyc-form':   'Cooperative',
                'government-kyc-form':    'Government Agency',
                'international-kyc-form': 'International Organization'
            };
            var selfieKeys = Object.keys(window._kycSubmissions || {}).filter(function(k) { return k.includes('selfie'); });
            var selfieUrl  = selfieKeys.length ? (window._kycSubmissions[selfieKeys[0]].selfie || '') : '';
            window._kycQueue.push({
                id:          kycData.id,
                fullName:    us.fullName  || 'Unknown User',
                username:    us.username  || 'unknown',
                entityType:  entityTypeMap[form.id] || form.id,
                status:      'pending',
                submittedAt: new Date().toLocaleDateString(),
                selfie:      selfieUrl
            });
            if (typeof window.renderAdminKycDocs === 'function') window.renderAdminKycDocs();

            _notify('✅ KYC (' + kycType + ') submitted successfully! Under review.', 'success');

            // Reset form UI
            Array.from(form.querySelectorAll('input, select, textarea')).forEach(function(el) { el.style.borderColor = ''; });
            form.querySelectorAll('.file-upload-preview').forEach(function(s) { s.innerHTML = ''; });
            form.querySelectorAll('.kyc-file-upload.upload-area').forEach(function(a) {
                a.classList.remove('has-file');
                var nm = a.querySelector('.file-name-display');
                if (nm) nm.remove();
                a.style.borderColor = '';
            });
            var selfieBtn = form.querySelector('.live-capture-btn');
            if (selfieBtn) {
                selfieBtn.dataset.captured = 'false';
                selfieBtn.style.background = '';
                selfieBtn.innerHTML = '<i class="fas fa-camera"></i> Capture Live Selfie';
            }
            window._kycSubmissions = {};
            form.reset();

        } catch (err) {
            console.error('[KYC] Submission error:', err);
            _notify('KYC submission failed. Please try again.', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    // ============================================================
    // 8. renderAdminKycDocs — admin panel KYC queue renderer
    // ============================================================
    function renderAdminKycDocs() {
        var container = document.getElementById('admin-kyc-docs-container');
        if (!container) return;

        var queue   = window._kycQueue || [];
        var badge   = document.getElementById('kyc-pending-badge');
        var pending = queue.filter(function(k) { return k.status === 'pending'; }).length;
        if (badge) badge.textContent = pending + ' Pending';

        if (!queue.length) {
            container.innerHTML = '<p style="text-align:center;padding:24px;color:#888;">No KYC submissions yet.</p>';
            return;
        }

        container.innerHTML = queue.map(function(entry) {
            var avatarHTML = entry.selfie
                ? '<img src="' + entry.selfie + '" style="width:50px;height:50px;border-radius:50%;object-fit:cover;border:2px solid var(--light-gray);">'
                : '<div style="width:50px;height:50px;border-radius:50%;background:#eee;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user" style="color:#bbb;"></i></div>';

            var actionsHTML = entry.status === 'pending'
                ? '<div style="display:flex;gap:6px;">'
                    + '<button class="btn btn-success btn-small" onclick="window.approveKyc(\'' + entry.id + '\')"><i class="fas fa-check"></i> Approve</button>'
                    + '<button class="btn btn-danger btn-small"  onclick="window.rejectKyc(\'' + entry.id + '\')"><i class="fas fa-times"></i> Reject</button>'
                    + '</div>'
                : '<span style="font-size:0.8rem;color:#888;">' + (entry.status === 'approved'
                    ? '<i class="fas fa-check-circle" style="color:#10B981;"></i> Verified'
                    : '❌ Rejected')
                + '</span>';

            return '<div class="kyc-doc-card">'
                + '  <div style="display:flex;align-items:center;gap:12px;flex-grow:1;">'
                + '    ' + avatarHTML
                + '    <div>'
                + '      <strong>' + (entry.fullName || '—') + '</strong>'
                + '      <p style="color:#666;font-size:0.83rem;margin:2px 0;">@' + (entry.username || '—') + ' &bull; <em>' + (entry.entityType || '—') + '</em> &bull; ' + (entry.submittedAt || '') + '</p>'
                + '    </div>'
                + '  </div>'
                + '  <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">'
                + '    <span class="kyc-status-badge ' + entry.status + '">' + entry.status.toUpperCase() + '</span>'
                + '    ' + actionsHTML
                + '  </div>'
                + '</div>';
        }).join('');
    }
    window.renderAdminKycDocs = renderAdminKycDocs;

    // ============================================================
    // 9. approveKyc / rejectKyc — admin status actions
    // ============================================================
    window.approveKyc = function(id) {
        var entry = (window._kycQueue || []).find(function(k) { return k.id === id; });
        if (!entry) return;
        entry.status = 'approved';
        renderAdminKycDocs();
        _notify('KYC approved for ' + entry.fullName, 'success');
        // Optional: persist to Firestore (best-effort)
        try {
            if (window.fbDb) {
                window.fbDb.collection('kyc_submissions')
                    .where('id', '==', id).get()
                    .then(function(snap) {
                        snap.forEach(function(doc) { doc.ref.update({ status: 'approved', approvedAt: new Date().toISOString() }); });
                    }).catch(function() {});
            }
        } catch (e) {}
    };

    window.rejectKyc = function(id) {
        var entry = (window._kycQueue || []).find(function(k) { return k.id === id; });
        if (!entry) return;
        entry.status = 'rejected';
        renderAdminKycDocs();
        _notify('KYC rejected for ' + entry.fullName, 'error');
        try {
            if (window.fbDb) {
                window.fbDb.collection('kyc_submissions')
                    .where('id', '==', id).get()
                    .then(function(snap) {
                        snap.forEach(function(doc) { doc.ref.update({ status: 'rejected', rejectedAt: new Date().toISOString() }); });
                    }).catch(function() {});
            }
        } catch (e) {}
    };

    // ============================================================
    // 10. Click delegation — entity buttons, form submit, tab open
    // ============================================================
    function _bindClickDelegation() {
        // Entity selector buttons — capture phase so it wins over legacy handler
        document.addEventListener('click', function(e) {
            var btn = e.target.closest && e.target.closest('.kyc-entity-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            _handleEntitySelect(btn);
        }, true);

        // Nav-link clicks — re-init uploads after a small delay
        document.addEventListener('click', function(e) {
            if (e.target.closest && e.target.closest('.nav-link')) {
                setTimeout(initKycUploads, 350);
            }
        });
    }

    function _bindFormSubmit() {
        // Use submit delegation on document; intercept only .kyc-form submissions
        document.addEventListener('submit', function(e) {
            var form = e.target;
            if (!form || !form.classList.contains('kyc-form')) return;
            e.preventDefault();
            e.stopPropagation();
            _submitKycForm(form);
        });
    }

    // ============================================================
    // 11. Profile KYC tab open — reinitialise bindings + auto-fill
    // ============================================================
    function _bindKycTabObserver() {
        // Watch for profile-kyc-tab becoming visible (profile re-renders wipe DOM)
        var obs = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                    if (!node || node.nodeType !== 1) return;
                    // If the profile-kyc-tab itself was added, or something inside it
                    var kycTab = node.id === 'profile-kyc-tab' ? node
                               : (node.querySelector ? node.querySelector('#profile-kyc-tab') : null);
                    if (kycTab) {
                        setTimeout(function() {
                            initKycUploads();
                            populateDobSelectors();
                            // Also wire up camera snap/close (they may have been re-rendered)
                            _bindCameraSnap();
                            _bindCameraClose();
                        }, 300);
                    }
                });
            });
        });
        obs.observe(document.body, { childList: true, subtree: true });

        // Also reinit when the KYC profile tab is explicitly clicked
        document.addEventListener('click', function(e) {
            var tab = e.target.closest && e.target.closest('[data-target="profile-kyc-tab"]');
            if (!tab) return;
            setTimeout(function() {
                initKycUploads();
                populateDobSelectors();
                _bindCameraSnap();
                _bindCameraClose();
                // Auto-fill individual fields for convenience
                var fnEl = document.getElementById('kyc-ind-fname');
                var lnEl = document.getElementById('kyc-ind-lname');
                var emEl = document.getElementById('kyc-ind-email');
                var phEl = document.getElementById('kyc-ind-phone');
                var us   = _state();
                if (us && us.fullName) {
                    var parts = (us.fullName || '').split(' ');
                    if (fnEl && !fnEl.value) fnEl.value = parts[0]            || '';
                    if (lnEl && !lnEl.value) lnEl.value = parts.slice(1).join(' ') || '';
                    if (emEl && !emEl.value) emEl.value = us.email            || '';
                    if (phEl && !phEl.value) phEl.value = us.phone            || '';
                }
            }, 100);
        });
    }

    // ============================================================
    // 12. Initialise
    // ============================================================
    _ready(function() {
        // Shared state init
        if (!window._kycSubmissions) window._kycSubmissions = {};
        if (!window._kycQueue)       window._kycQueue       = [];

        _bindClickDelegation();
        _bindFormSubmit();
        _bindKycTabObserver();

        // Initial binding pass (for any KYC forms already in the DOM)
        setTimeout(function() {
            initKycUploads();
            populateDobSelectors();
            _bindCameraSnap();
            _bindCameraClose();
            renderAdminKycDocs();
        }, 700);

        console.log('[Empyrean] ✅ app-kyc.js loaded — KYC module active');
    });

})();