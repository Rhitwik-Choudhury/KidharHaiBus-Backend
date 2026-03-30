const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTP = async (to, otp) => {
  try {
    await resend.emails.send({
      from: "Trackefy <noreply@trackefy.in>", // ✅ IMPORTANT FIX
      to: to,
      subject: "Your OTP Code",
      html: `
        <div style="font-family: Arial;">
          <h2>Trackefy Verification</h2>
          <p>Your OTP is:</p>
          <h1 style="color: #2563eb;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
        </div>
      `,
    });

    return true;
  } catch (err) {
    console.error("Resend Error:", err);
    return false;
  }
};

const sendContactEmail = async ({ name, email, message, subject }) => {
  try {
    await resend.emails.send({
      from: "Trackefy <noreply@trackefy.in>",
      to: "trackefy@gmail.com", // 🔥 YOUR RECEIVING EMAIL
      subject: subject || "New Contact Message",
      reply_to: email, // so you can reply directly to user
      html: `
        <div style="font-family: Arial;">
          <h2>New Contact Message</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p>${message}</p>
        </div>
      `,
    });

    return true;
  } catch (err) {
    console.error("Contact Email Error:", err);
    return false;
  }
};

module.exports = { sendOTP, sendContactEmail };