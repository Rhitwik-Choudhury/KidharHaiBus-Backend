const express = require('express');
const router = express.Router();

const { sendOTP } = require('../utils/emailService');
const Otp = require('../models/Otp');
const { registerSchool, loginSchool } = require('../controllers/schoolController');
const { registerDriver, loginDriver } = require('../controllers/driverController'); // ✅ Added

// OTP routes
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  try {
    await sendOTP(email, otp);
    await Otp.findOneAndUpdate(
      { email },
      { otp, expiresAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

  try {
    const record = await Otp.findOne({ email });
    if (!record) return res.status(400).json({ message: 'No OTP found for this email' });
    if (new Date() > record.expiresAt) return res.status(400).json({ message: 'OTP expired' });
    if (record.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });

    await Otp.deleteOne({ email });
    res.json({ message: 'OTP verified' });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ message: 'OTP verification failed' });
  }
});

// ✅ School auth routes
router.post('/signup/school', registerSchool);
router.post('/signin/school', loginSchool);

// ✅ Driver auth routes
router.post('/signup/driver', registerDriver);
router.post('/signin/driver', loginDriver);

module.exports = router;
