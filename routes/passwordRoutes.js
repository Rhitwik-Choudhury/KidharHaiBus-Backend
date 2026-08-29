const express = require("express");
const rateLimit = require("express-rate-limit");
const auth = require("../middleware/authMiddleware");
const { requestPasswordReset, resetPassword, changePassword } = require("../controllers/passwordController");

const router = express.Router();
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

router.post("/forgot-password", resetLimiter, requestPasswordReset);
router.post("/reset-password", resetLimiter, resetPassword);
router.post("/change-password", auth, changePassword);

module.exports = router;
