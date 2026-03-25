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
  getAllDrivers, // ✅ added
} = require("../controllers/driverController");

// ✅ IMPORT AUTH BEFORE USING
const auth = require("../middleware/authMiddleware");

// ================= PUBLIC ROUTES =================
router.post("/signup", auth, registerDriver);
router.post("/login", loginDriver);

// ================= DRIVER LIST (IMPORTANT) =================
router.get("/all", auth, getAllDrivers); // ✅ FIXED POSITION

// ================= PROTECTED ROUTES =================
router.get("/me", auth, getDriverProfile);
router.get("/assigned-bus", auth, getAssignedBus);

router.post("/start-trip", auth, startTrip);
router.post("/end-trip", auth, endTrip);
router.post("/location", auth, updateDriverLocation);

module.exports = router;