// backend/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const {
  EMAIL_USER,
  EMAIL_PASS,
  MAIL_FROM_NAME = 'Trackify',
  CONTACT_TO,               // where contact messages should arrive
  NODE_ENV
} = process.env;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn('⚠️ EMAIL_USER or EMAIL_PASS is missing. Emails will fail until these are set.');
}

// Gmail SMTP with App Password
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// Verify on startup (skip in tests)
if (NODE_ENV !== 'test') {
  transporter
    .verify()
    .then(() => console.log('✅ Mail transporter ready'))
    .catch((err) => console.error('❌ Mail transporter error:', err));
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send signup OTP email
 * @param {string} to - recipient email
 * @param {string|number} otp - 6-digit OTP
 */
async function sendOTP(to, otp) {
  const subject = `Your OTP for ${MAIL_FROM_NAME} Signup`;
  const text = `Your OTP is ${otp}. It is valid for 5 minutes.`;
  const html = `<p>Your OTP is <strong>${escapeHtml(String(otp))}</strong>. It is valid for 5 minutes.</p>`;

  const mailOptions = {
    from: `"${MAIL_FROM_NAME}" <${EMAIL_USER}>`,  // authenticated sender
    to,
    subject,
    text,
    html
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Send Contact form email (DMARC-safe: from app, reply-to user)
 * @param {Object} params
 * @param {string} params.name - sender name (user)
 * @param {string} params.email - sender email (user)
 * @param {string} params.message - message body
 * @param {string} [params.subject='Query from user'] - email subject
 */
async function sendContactEmail({ name, email, message, subject = 'Query from user' }) {
  const to = CONTACT_TO || EMAIL_USER; // default to your app inbox

  const safeName = escapeHtml(name || '');
  const safeEmail = escapeHtml(email || '');
  const safeMsg = escapeHtml(message || '');

  const text =
`New contact message from ${name} <${email}>

Message:
${message}
`;

  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
  <h3 style="margin:0 0 10px">New contact message</h3>
  <p><b>From:</b> ${safeName} &lt;${safeEmail}&gt;</p>
  <p><b>Message:</b></p>
  <div style="white-space:pre-wrap;border:1px solid #eee;padding:12px;border-radius:8px;background:#fafafa">
    ${safeMsg}
  </div>
</div>`;

  const mailOptions = {
    from: `"${MAIL_FROM_NAME} Contact" <${EMAIL_USER}>`, // authenticated sender (DMARC-safe)
    to,
    replyTo: `${name} <${email}>`, // so Reply goes to the user
    subject,
    text,
    html
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  sendOTP,
  sendContactEmail
};
