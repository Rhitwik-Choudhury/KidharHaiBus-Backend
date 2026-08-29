const bcrypt = require("bcryptjs");
const Parent = require("../models/Parent");
const Driver = require("../models/Driver");
const PasswordResetOtp = require("../models/PasswordResetOtp");
const { sendPasswordResetOTP } = require("../utils/emailService");

const models = { parent: Parent, driver: Driver };
const normalizeRole = (role) => String(role || "").trim().toLowerCase();
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const validPassword = (password) => typeof password === "string" && password.length >= 8;

exports.requestPasswordReset = async (req, res) => {
  try {
    const role = normalizeRole(req.body.role);
    const email = normalizeEmail(req.body.email);
    const Model = models[role];
    if (!Model || !email) return res.status(400).json({ message: "Valid email and role are required" });

    const generic = { message: "If an account exists, a reset code has been sent." };
    const user = await Model.findOne({ email }).select("_id");
    if (!user) return res.json(generic);

    const existing = await PasswordResetOtp.findOne({ email, role });
    if (existing && existing.createdAt > new Date(Date.now() - 60 * 1000)) {
      return res.status(429).json({ message: "Please wait before requesting another code." });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await bcrypt.hash(otp, 10);
    await PasswordResetOtp.findOneAndUpdate(
      { email, role },
      { otpHash, attempts: 0, expiresAt: new Date(Date.now() + 10 * 60 * 1000), createdAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const sent = await sendPasswordResetOTP(email, otp);
    if (!sent) {
      await PasswordResetOtp.deleteOne({ email, role });
      return res.status(500).json({ message: "Unable to send reset code. Please try again." });
    }
    return res.json(generic);
  } catch (error) {
    console.error("Password reset request error:", error);
    return res.status(500).json({ message: "Unable to process password reset." });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const role = normalizeRole(req.body.role);
    const email = normalizeEmail(req.body.email);
    const { otp, newPassword } = req.body;
    const Model = models[role];
    if (!Model || !email || !/^\d{6}$/.test(String(otp || ""))) return res.status(400).json({ message: "Invalid reset details" });
    if (!validPassword(newPassword)) return res.status(400).json({ message: "Password must be at least 8 characters" });

    const record = await PasswordResetOtp.findOne({ email, role });
    if (!record || record.expiresAt <= new Date()) return res.status(400).json({ message: "Reset code is invalid or expired" });
    if (record.attempts >= 5) {
      await PasswordResetOtp.deleteOne({ _id: record._id });
      return res.status(429).json({ message: "Too many incorrect attempts. Request a new code." });
    }
    const matches = await bcrypt.compare(String(otp), record.otpHash);
    if (!matches) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ message: "Reset code is invalid or expired" });
    }

    const user = await Model.findOne({ email });
    if (!user) return res.status(400).json({ message: "Reset code is invalid or expired" });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await PasswordResetOtp.deleteOne({ _id: record._id });
    return res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Password reset error:", error);
    return res.status(500).json({ message: "Unable to reset password." });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const Model = models[req.user?.role];
    const { currentPassword, newPassword } = req.body;
    if (!Model) return res.status(403).json({ message: "This account cannot use this endpoint" });
    if (!currentPassword || !validPassword(newPassword)) return res.status(400).json({ message: "New password must be at least 8 characters" });
    if (currentPassword === newPassword) return res.status(400).json({ message: "New password must be different" });

    const user = await Model.findById(req.user.id);
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ message: "Current password is incorrect" });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    return res.status(500).json({ message: "Unable to change password." });
  }
};
