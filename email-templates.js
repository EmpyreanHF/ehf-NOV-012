/* =============================================================================
   EMPYREAN — email-templates.js
   Pure functions that build { subject, html } for each transactional email.
   No Firestore/SendGrid calls in here on purpose — server.js resolves the
   data (user record, SOS doc, withdrawal doc) and hands plain values in, so
   these templates stay easy to preview/test in isolation and match the
   Emerald / Champagne-Gold theme already used elsewhere in the app (see the
   SOS donate button + "Amount Needed" badge redesign).
   ============================================================================= */

'use strict';

const EMERALD = '#046A38';
const EMERALD_DARK = '#03502A';
const GOLD = '#D4AF37';
const INK = '#1a2b85'; // matches the app's brand-navy used on the OGP fallback card

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Shared outer shell — a single centered 600px table, inline styles only
// (many mail clients strip <style> blocks entirely), navy/emerald header
// band with the app logo, gold accent rule, plain-text-friendly footer.
function _baseLayout({ appName, logoUrl, preheader, bodyHtml, footerNote }) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${_esc(appName)}</title></head>
<body style="margin:0;padding:0;background:#f2f4f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <!-- preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${_esc(preheader || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(10,14,39,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg, ${INK} 0%, ${EMERALD_DARK} 100%);padding:28px 32px;text-align:center;">
            ${logoUrl ? `<img src="${_esc(logoUrl)}" alt="${_esc(appName)}" height="40" style="height:40px;margin-bottom:10px;">` : ''}
            <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">${_esc(appName)}</div>
          </td>
        </tr>
        <tr><td style="height:4px;background:${GOLD};"></td></tr>
        <tr>
          <td style="padding:32px;color:#25293d;font-size:15px;line-height:1.6;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#f7f8fa;border-top:1px solid #eceef1;color:#8a90a3;font-size:12px;text-align:center;">
            ${footerNote ? `<div style="margin-bottom:6px;">${_esc(footerNote)}</div>` : ''}
            &copy; ${new Date().getFullYear()} ${_esc(appName)}. All rights reserved.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function _statusBadge(label, color) {
    return `<span style="display:inline-block;padding:4px 14px;border-radius:50px;font-size:12px;font-weight:700;letter-spacing:0.3px;color:#ffffff;background:${color};">${_esc(label)}</span>`;
}

function _detailRow(label, value) {
    return `<tr>
      <td style="padding:6px 0;color:#8a90a3;font-size:13px;width:180px;vertical-align:top;">${_esc(label)}</td>
      <td style="padding:6px 0;color:#25293d;font-size:13px;font-weight:600;">${_esc(value)}</td>
    </tr>`;
}

function _detailTable(rows) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border-radius:8px;padding:14px 18px;margin:16px 0;border:1px solid #eceef1;">
      ${rows.map(r => _detailRow(r[0], r[1])).join('')}
    </table>`;
}

/* ---------------------------------------------------------------------------
   1) WELCOME EMAIL
   ------------------------------------------------------------------------- */
function welcomeEmailTemplate({ appName, logoUrl, fullName, uniqueId, email, bio, qrCid }) {
    const subject = `Welcome to the ${appName} Ecosystem – Your Journey Begins!`;
    const bodyHtml = `
      <h2 style="margin:0 0 6px;color:${INK};">🌟 Welcome to the ${_esc(appName)} Ecosystem! 🌟</h2>
      <p>Dear ${_esc(fullName)},</p>
      <p>We are delighted to have you join our community. Your registration has been successfully completed, and we are excited to walk with you on this transformative journey.</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🔹 Your Registration Details</h3>
      ${_detailTable([
          ['Unique ID Number', uniqueId],
          ['Full Name', fullName],
          ['Email', email],
          ['Bio', bio && bio.trim() ? bio : 'Not yet added — you can update this anytime from your profile.']
      ])}

      ${qrCid ? `<div style="text-align:center;margin:20px 0;">
        <img src="cid:${_esc(qrCid)}" alt="Your Empyrean QR Code" width="160" height="160" style="border:6px solid #f7f8fa;border-radius:12px;">
        <p style="color:#8a90a3;font-size:12px;margin:8px 0 0;">Your personal Empyrean QR Code — scan to save your contact details.</p>
      </div>` : ''}

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🎉 Congratulations!</h3>
      <p>You are now officially part of the ${_esc(appName)} ecosystem — a dynamic platform designed to empower, connect, and support individuals across diverse fields. We celebrate your decision to join us and look forward to the value you will bring to our community.</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">📖 About the ${_esc(appName)} Ecosystem</h3>
      <p>The ${_esc(appName)} ecosystem is a holistic environment built to:</p>
      <ul style="margin:8px 0;padding-left:20px;">
        <li>Foster collaboration and innovation.</li>
        <li>Provide seamless support through our SOS request ticketing system.</li>
        <li>Enable secure transactions, including withdrawals and confirmations.</li>
        <li>Deliver timely notifications to keep you informed and empowered.</li>
      </ul>
      <p>In short, ${_esc(appName)} is more than a platform — it is a thriving community where your growth and safety are our priority.</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">📩 Notifications You Will Receive</h3>
      <p>You will be notified via email whenever:</p>
      <ul style="margin:8px 0;padding-left:20px;">
        <li><strong>SOS Request Raised</strong> — confirmation of your emergency support request.</li>
        <li><strong>SOS Request Confirmed</strong> — updates when your request is validated.</li>
        <li><strong>Withdrawal Request</strong> — notifications when you initiate and confirm withdrawals.</li>
      </ul>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🌐 Closing Note</h3>
      <p>We are thrilled to have you onboard. Together, we will build a future of innovation, trust, and empowerment.</p>
      <p style="margin-top:24px;">Warm regards,<br><strong>The ${_esc(appName)} Team</strong></p>
    `;
    return { subject, html: _baseLayout({ appName, logoUrl, preheader: 'Your Empyrean registration is complete.', bodyHtml, footerNote: 'You are receiving this because you created an account on ' + appName + '.' }) };
}

/* ---------------------------------------------------------------------------
   2) SOS REQUEST RECEIVED
   ------------------------------------------------------------------------- */
function sosReceivedEmailTemplate({ appName, logoUrl, fullName, requestId, timestamp }) {
    const subject = `${appName} SOS Request – Confirmation, Review & Due Diligence Update`;
    const bodyHtml = `
      <h2 style="margin:0 0 6px;color:${INK};">🚨 Your SOS Request Has Been Received!</h2>
      <p>Dear ${_esc(fullName)},</p>
      <p>We've successfully registered your emergency support request within the ${_esc(appName)} ecosystem. Our team is currently reviewing your submission to ensure swift and effective assistance.</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🔹 Request Details</h3>
      ${_detailTable([
          ['Request ID', requestId],
          ['User Name', fullName],
          ['Date &amp; Time', timestamp],
          ['Status', 'Pending Review & Verification']
      ])}

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🛡️ Next Steps</h3>
      <p>After our team completes the initial review, we will call you to conduct comprehensive findings and due diligence before approval. Please be expecting our call soon.</p>
      <p>Following the call and our investigation:</p>
      <ul style="margin:8px 0;padding-left:20px;">
        <li>If our findings are satisfactory, your SOS ticket will be published for support within the ${_esc(appName)} ecosystem.</li>
        <li>However, please note that receiving a call does not guarantee publication of your case.</li>
        <li>In some instances, requests may be declined, as we may not have the capacity to assist everyone at once.</li>
      </ul>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">💡 ${_esc(appName)} Support Promise</h3>
      <p>At ${_esc(appName)}, we prioritize your safety and well-being. Our SOS system ensures that every request is handled with urgency, transparency, and care, while maintaining fairness and integrity throughout the process.</p>

      <p style="margin-top:24px;">Warm regards,<br><strong>The ${_esc(appName)} Support Team</strong></p>
    `;
    return { subject, html: _baseLayout({ appName, logoUrl, preheader: 'Your SOS request is under review.', bodyHtml, footerNote: 'This is an automated confirmation for an SOS request submitted on ' + appName + '.' }) };
}

/* ---------------------------------------------------------------------------
   3) WITHDRAWAL — unified dynamic-status template (pending / processed / declined)
   ------------------------------------------------------------------------- */
const WITHDRAWAL_STATUS_META = {
    pending: {
        subjectSuffix: 'Request Under Review',
        badge: ['PENDING REVIEW', GOLD],
        heading: '⏳ Your withdrawal request has been received and is pending review.',
        message: 'Our finance team is conducting due diligence to verify details. You will be notified once the review is complete. The outcome may be approved and processed into your account or wallet, or declined if we are unable to fulfill the request.',
        statusLabel: 'Pending Review'
    },
    processed: {
        subjectSuffix: 'Funds Successfully Processed',
        badge: ['PROCESSED', EMERALD],
        heading: '✅ Your withdrawal has been successfully processed!',
        message: 'The approved funds will drop into your designated account or wallet any moment from now. ' +
            '__APP__ ensures every transaction is secure, transparent, and efficient.',
        statusLabel: 'Completed – Awaiting Deposit'
    },
    declined: {
        subjectSuffix: 'Request Declined',
        badge: ['DECLINED', '#B3261E'],
        heading: '⚠️ Your withdrawal request could not be approved.',
        message: 'After careful review, we regret to inform you that your request has been declined. This may occur when we do not have the capacity to process every request. You may submit another withdrawal request at a later time.',
        statusLabel: 'Declined'
    }
};

function withdrawalEmailTemplate({ appName, logoUrl, status, fullName, transactionId, amount, currency, timestamp }) {
    const meta = WITHDRAWAL_STATUS_META[status] || WITHDRAWAL_STATUS_META.pending;
    const subject = `${appName} Withdrawal – ${meta.subjectSuffix}`;
    const amountDisplay = `${amount} ${currency || 'EMPY'}`;
    const message = meta.message.replace('__APP__', appName);

    const bodyHtml = `
      <div style="margin-bottom:10px;">${_statusBadge(meta.badge[0], meta.badge[1])}</div>
      <h2 style="margin:0 0 6px;color:${INK};">${meta.heading}</h2>
      <p>Dear ${_esc(fullName)},</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🔹 Transaction Details</h3>
      ${_detailTable([
          ['Transaction ID', transactionId],
          ['User Name', fullName],
          ['Amount', amountDisplay],
          ['Date &amp; Time', timestamp],
          ['Status', meta.statusLabel]
      ])}

      <p>${_esc(message)}</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🌐 ${_esc(appName)} Financial Integrity</h3>
      <p>${_esc(appName)} remains committed to transparency, fairness, and efficiency. Every withdrawal request is carefully reviewed to protect your assets and maintain trust across the ecosystem.</p>

      <p style="margin-top:24px;">Best regards,<br><strong>The ${_esc(appName)} Finance Team</strong></p>
    `;
    return { subject, html: _baseLayout({ appName, logoUrl, preheader: subject, bodyHtml, footerNote: 'This is an automated update for a withdrawal request submitted on ' + appName + '.' }) };
}

/* ---------------------------------------------------------------------------
   4) MARKETPLACE ESCROW — seller notified of a paid order to dispatch
   ------------------------------------------------------------------------- */
function escrowSellerNotifiedEmailTemplate({ appName, logoUrl, sellerName, productTitle, productId, buyerName, buyerPhone, timestamp }) {
    const subject = `${appName} Escrow – Product Purchased & Dispatch Required`;
    const bodyHtml = `
      <div style="margin-bottom:10px;">${_statusBadge('PAID – FUNDS IN ESCROW', GOLD)}</div>
      <h2 style="margin:0 0 6px;color:${INK};">🎉 Good news! A buyer has completed payment.</h2>
      <p>Dear ${_esc(sellerName)},</p>
      <p>A buyer has added your product to their cart and successfully completed payment. The funds are now securely held in the ${_esc(appName)} escrow system until the transaction is finalized.</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🔹 Transaction Details</h3>
      ${_detailTable([
          ['Product Name', productTitle],
          ['Product ID', productId],
          ['Buyer Name', buyerName],
          ['Buyer Phone', buyerPhone],
          ['Date &amp; Time', timestamp],
          ['Status', 'Paid – Funds in Escrow']
      ])}

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">📦 Dispatch Instructions</h3>
      <ul style="margin:8px 0;padding-left:20px;">
        <li>You are required to dispatch or ship the paid item(s) to the buyer within 48 hours of this notification.</li>
        <li>For a smooth, hitch-free experience, you may also call the buyer directly using the phone number above to coordinate delivery.</li>
        <li>Funds will only be released to your account or wallet once the buyer confirms receipt of the product.</li>
        <li>Failure to dispatch within the required timeframe may result in delays or cancellation of the transaction.</li>
      </ul>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🌐 ${_esc(appName)} Escrow Integrity</h3>
      <p>Our escrow system ensures fairness and transparency for both buyers and sellers. Payments are protected until delivery is confirmed, safeguarding trust across the ${_esc(appName)} ecosystem.</p>

      <p style="margin-top:24px;">Best regards,<br><strong>The ${_esc(appName)} Escrow Team</strong></p>
    `;
    return { subject, html: _baseLayout({ appName, logoUrl, preheader: 'A buyer has paid — dispatch required within 48 hours.', bodyHtml, footerNote: 'This is an automated escrow notification for a sale on ' + appName + '.' }) };
}

/* ---------------------------------------------------------------------------
   5) MARKETPLACE ESCROW — seller funds released after buyer confirms receipt
   ------------------------------------------------------------------------- */
function escrowSellerReleasedEmailTemplate({ appName, logoUrl, sellerName, productTitle, productId, buyerName, buyerPhone, timestamp, creditedAmount, creditedCurrency, creditFailed }) {
    const subject = `${appName} Escrow – Funds Released to Your Account/Wallet`;
    const CURRENCY_SYMS = { NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', USDT: 'USDT ' };
    const hasCredit = typeof creditedAmount === 'number' && creditedCurrency && !creditFailed;
    const isEmpy = creditedCurrency === 'EMPY';
    const amountStr = hasCredit
        ? (isEmpy
            ? creditedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EMPY'
            : (CURRENCY_SYMS[creditedCurrency] || (creditedCurrency + ' ')) + creditedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }))
        : '';
    const creditedRow = hasCredit ? [['Amount Credited', amountStr]] : [];
    const creditMessage = creditFailed
        ? `The funds could not be automatically credited to your ${_esc(appName)} wallet/balance for this order — our team has been notified and will resolve this manually. You do not need to do anything further.`
        : (hasCredit
            ? (isEmpy
                ? `${amountStr} has been credited directly to your ${_esc(appName)} EMPY wallet balance and is available now.`
                : `${amountStr} has been credited to your ${_esc(appName)} balance in the same currency the buyer paid in, and is available for withdrawal.`)
            : 'The approved funds will drop into your designated account or wallet any moment from now.');
    const bodyHtml = `
      <div style="margin-bottom:10px;">${_statusBadge('FUNDS RELEASED', EMERALD)}</div>
      <h2 style="margin:0 0 6px;color:${INK};">✅ Your Funds Have Been Released!</h2>
      <p>Dear ${_esc(sellerName)},</p>
      <p>We are pleased to inform you that the buyer has confirmed receipt of the product, and the escrow process is now complete.</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🔹 Transaction Details</h3>
      ${_detailTable([
          ['Product Name', productTitle],
          ['Product ID', productId],
          ['Buyer Name', buyerName],
          ['Buyer Phone', buyerPhone],
          ['Date &amp; Time', timestamp],
          ...creditedRow,
          ['Status', 'Funds Released – Transaction Complete']
      ])}

      <p>${creditMessage}</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🌐 ${_esc(appName)} Escrow Integrity</h3>
      <p>Our escrow system ensures fairness and transparency for both buyers and sellers. Payments are only released once delivery is confirmed, safeguarding trust across the ${_esc(appName)} ecosystem.</p>

      <p>🙏 We sincerely appreciate your confidence in our platform. By choosing ${_esc(appName)}, you help us build a secure, transparent, and reliable marketplace for all.</p>

      <p style="margin-top:24px;">Best regards,<br><strong>The ${_esc(appName)} Escrow Team</strong></p>
    `;
    return { subject, html: _baseLayout({ appName, logoUrl, preheader: 'Your escrow funds have been released.', bodyHtml, footerNote: 'This is an automated escrow notification for a sale on ' + appName + '.' }) };
}

/* ---------------------------------------------------------------------------
   6) MARKETPLACE ESCROW — buyer payment confirmation
   ------------------------------------------------------------------------- */
function escrowBuyerPaymentEmailTemplate({ appName, logoUrl, buyerName, productTitle, productId, sellerName, timestamp }) {
    const subject = `${appName} Escrow – Payment Received & Secured in Trust`;
    const bodyHtml = `
      <div style="margin-bottom:10px;">${_statusBadge('PAYMENT RECEIVED', EMERALD)}</div>
      <h2 style="margin:0 0 6px;color:${INK};">✅ Your Payment Has Been Successfully Received!</h2>
      <p>Dear ${_esc(buyerName)},</p>
      <p>We are pleased to inform you that your payment for the product has been confirmed. The funds are now securely held in the ${_esc(appName)} escrow system, in trust for you, until the transaction is finalized.</p>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🔹 Transaction Details</h3>
      ${_detailTable([
          ['Product Name', productTitle],
          ['Product ID', productId],
          ['Seller Name', sellerName],
          ['Date &amp; Time', timestamp],
          ['Status', 'Payment Received – Funds Held in Trust']
      ])}

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🔄 Next Steps</h3>
      <ul style="margin:8px 0;padding-left:20px;">
        <li>The seller is required to dispatch or ship your product within 48 hours of this notification.</li>
        <li>Once you confirm receipt of the product, the funds will be released to the seller.</li>
        <li>If there are any issues, ${_esc(appName)} support is available to assist you.</li>
      </ul>

      <h3 style="color:${EMERALD};margin:24px 0 8px;font-size:15px;">🌐 ${_esc(appName)} Escrow Integrity</h3>
      <p>Our escrow system ensures fairness and transparency for both buyers and sellers. Your funds remain protected until you confirm successful delivery, guaranteeing a hitch-free experience.</p>

      <p>🙏 We sincerely appreciate your confidence in our platform. By choosing ${_esc(appName)}, you help us build a secure, transparent, and reliable marketplace for all.</p>

      <p style="margin-top:24px;">Best regards,<br><strong>The ${_esc(appName)} Escrow Team</strong></p>
    `;
    return { subject, html: _baseLayout({ appName, logoUrl, preheader: 'Your payment is confirmed and secured in escrow.', bodyHtml, footerNote: 'This is an automated escrow notification for a purchase on ' + appName + '.' }) };
}

module.exports = {
    welcomeEmailTemplate,
    sosReceivedEmailTemplate,
    withdrawalEmailTemplate,
    escrowSellerNotifiedEmailTemplate,
    escrowSellerReleasedEmailTemplate,
    escrowBuyerPaymentEmailTemplate
};