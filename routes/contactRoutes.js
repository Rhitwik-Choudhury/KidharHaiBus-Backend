// backend/routes/contactRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { sendContactEmail } = require('../utils/emailService');

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,                  // prevent spam
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', limiter, async (req, res) => {
  try {
    let { name = '', email = '', message = '' } = req.body || {};
    name = String(name).trim();
    email = String(email).trim();
    message = String(message).trim();

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, message: 'Name, email and message are required.' });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return res.status(400).json({ ok: false, message: 'Invalid email address.' });
    }

    await sendContactEmail({
      name,
      email,   // user’s email (will be used as Reply-To)
      message, // text the user typed
      subject: 'Query from user',
    });

    return res.json({ ok: true, message: 'Message sent successfully.' });
  } catch (err) {
    console.error('Contact email error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to send message.' });
  }
});

module.exports = router;
