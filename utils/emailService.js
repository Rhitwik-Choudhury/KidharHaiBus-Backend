const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendOTP(email, otp) {
  const mailOptions = {
    from: `"KidharHaiBus" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your OTP for KidharHaiBus Signup',
    html: `<p>Your OTP is <strong>${otp}</strong>. It is valid for 5 minutes.</p>`
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendOTP };
