const express = require("express");
const router = express.Router();
const { saveFcmToken } = require("../controllers/parentController");

const {
  registerParent,
  loginParent,
  getMyProfile,
  getMyBus,
  sendParentOTP,
  setParentLocation, // ✅ ADD HERE
} = require("../controllers/parentController");

const auth = require("../middleware/authMiddleware");
const parentOnly = require('../services/routeValidation').role('parent');

router.post("/send-otp", sendParentOTP);
// Public routes
router.post("/signup", registerParent);
router.post("/login", loginParent);

// Protected routes
router.post('/set-pickup-location', auth, parentOnly, setParentLocation);
router.get("/me", auth, parentOnly, getMyProfile);
router.get("/my-bus", auth, parentOnly, getMyBus);

router.post("/save-fcm-token", auth, parentOnly, saveFcmToken);

module.exports = router;
