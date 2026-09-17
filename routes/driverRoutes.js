const express = require("express");
const router = express.Router();

// ✅ IMPORT CONTROLLERS FIRST
const {
  registerDriver,
  loginDriver,
  getDriverProfile,
  getAssignedBus,
  startTrip,
  endTrip,
  updateDriverLocation,
  getAllDrivers,
  sendDriverOTP, 
} = require("../controllers/driverController");

// ✅ IMPORT AUTH BEFORE USING
const auth = require("../middleware/authMiddleware");
const { role } = require('../services/routeValidation');
const driverOnly = role('driver');

router.post("/send-otp", sendDriverOTP);
// ================= PUBLIC ROUTES =================
router.post("/signup", registerDriver);
router.post("/login", loginDriver);

// ================= DRIVER LIST (IMPORTANT) =================
router.get("/all", auth, require("../services/routeValidation").role("school"), getAllDrivers); // ✅ FIXED POSITION

// ================= PROTECTED ROUTES =================
router.get("/me", auth, driverOnly, getDriverProfile);
router.get("/assigned-bus", auth, driverOnly, getAssignedBus);

router.post("/start-trip", auth, driverOnly, startTrip);
router.post("/end-trip", auth, driverOnly, endTrip);
router.post("/location", auth, driverOnly, updateDriverLocation);

module.exports = router;
