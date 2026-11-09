/* =============================================================================
   EMPYREAN — email-service.js
   Thin SendGrid wrapper for all transactional emails (welcome, SOS
   confirmation, withdrawal status). Mirrors the lazy-init pattern server.js
   already uses for Firebase Admin (_getAdmin) — the SendGrid client is only
   configured once, and every call site can safely call sendEmail() without
   worrying about init order or missing credentials: it just logs a warning
   and no-ops if SENDGRID_API_KEY isn't set, rather than throwing and taking
   down whatever Firestore listener triggered it.

   Required Render env vars (see render.yaml):
     SENDGRID_API_KEY    - starts with "SG."
     SENDGRID_FROM_EMAIL - a verified single-sender or domain in SendGrid
     SENDGRID_FROM_NAME  - optional display name, defaults to APP_NAME
   ============================================================================= */

'use strict';

let _sgMail = null;
let _initFailed = false;

function _getClient() {
    if (_initFailed) return null; // already failed once this run — don't retry every send
    if (_sgMail) return _sgMail;
    if (!process.env.SENDGRID_API_KEY) {
        console.warn('[Email] SENDGRID_API_KEY not set — outgoing emails will be skipped.');
        _initFailed = true;
        return null;
    }
    try {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        _sgMail = sgMail;
        return _sgMail;
    } catch (err) {
        console.error('[Email] "@sendgrid/mail" package not installed. Run: npm install @sendgrid/mail');
        _initFailed = true;
        return null;
    }
}

/**
 * @param {Object} opts
 * @param {string} opts.to        - recipient email
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {Array}  [opts.attachments] - SendGrid-shaped attachments:
 *        [{ content: base64String, filename, type, disposition, content_id }]
 *        Use disposition: 'inline' + a content_id to reference an attachment
 *        inline in the HTML via <img src="cid:THAT_ID">.
 * @returns {Promise<{sent: boolean, reason?: string, error?: string}>}
 */
async function sendEmail({ to, subject, html, attachments }) {
    if (!to) {
        console.warn('[Email] sendEmail called with no recipient — skipped:', subject);
        return { sent: false, reason: 'no recipient' };
    }

    const client = _getClient();
    if (!client) return { sent: false, reason: 'SendGrid not configured' };

    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (!fromEmail) {
        console.warn('[Email] SENDGRID_FROM_EMAIL not set — email to', to, 'skipped.');
        return { sent: false, reason: 'no from address configured' };
    }
    const fromName = process.env.SENDGRID_FROM_NAME || process.env.APP_NAME || 'Empyrean';

    const msg = {
        to,
        from: { email: fromEmail, name: fromName },
        subject,
        html,
        ...(attachments && attachments.length ? { attachments } : {})
    };

    try {
        await client.send(msg);
        console.log('[Email] Sent "' + subject + '" to', to);
        return { sent: true };
    } catch (err) {
        const detail = (err && err.response && err.response.body)
            ? JSON.stringify(err.response.body)
            : err.message;
        console.error('[Email] Send failed to', to, '-', detail);
        return { sent: false, error: detail };
    }
}

module.exports = { sendEmail };