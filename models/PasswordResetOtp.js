const mongoose = require("mongoose");

const passwordResetOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, required: true, enum: ["parent", "driver"] },
  otpHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

passwordResetOtpSchema.index({ email: 1, role: 1 }, { unique: true });

module.exports = mongoose.model("PasswordResetOtp", passwordResetOtpSchema);
