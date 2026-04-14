const express = require("express");
const router = express.Router();

const {
  registerParent,
  loginParent,
  getMyProfile,
  getMyBus,
  sendParentOTP,
  setParentLocation, // ✅ ADD HERE
} = require("../controllers/parentController");

const auth = require("../middleware/authMiddleware");

router.post('/set-pickup-location', auth, setParentLocation);
router.post("/send-otp", sendParentOTP);
// Public routes
router.post("/signup", registerParent);
router.post("/login", loginParent);

// Protected routes
router.get("/me", auth, getMyProfile);
router.get("/my-bus", auth, getMyBus);

module.exports = router;