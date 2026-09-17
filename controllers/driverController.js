const Driver = require("../models/Driver");
const Bus = require("../models/Bus");
const School = require("../models/School");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { sendOTP } = require("../utils/emailService");
const Otp = require("../models/Otp");

// ================= SEND OTP =================
exports.sendDriverOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const emailNormalized = email.trim().toLowerCase();

    const otp = Math.floor(100000 + Math.random() * 900000);

    await Otp.deleteMany({ email: emailNormalized });

    await Otp.create({
      email: emailNormalized,
      otp: otp.toString(),
      expiresAt: new Date(Date.now() + 1 * 60 * 1000),
    });

    const emailSent = await sendOTP(email, otp);

    if (!emailSent) {
      return res.status(500).json({ message: "Failed to send OTP" });
    }

    res.status(200).json({
      message: "OTP sent successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= REGISTER DRIVER =================
exports.registerDriver = async (req, res) => {
  const { fullName, email, password, driverCode, otp } = req.body;

  try {
    const emailNormalized = email.trim().toLowerCase();
    // ✅ VERIFY OTP
    const record = await Otp.findOne({ email: emailNormalized });

    if (!record) {
      return res.status(400).json({ message: "Please request OTP first" });
    }

    if (new Date() > record.expiresAt) {
      return res.status(400).json({ message: "OTP expired" });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    await Otp.deleteOne({ email: emailNormalized });

    // ✅ SCHOOL CODE CHECK
    const enteredSchoolCode = driverCode.trim().toUpperCase().replace(/-/g, "");

    const school = await School.findOne({ schoolCode: enteredSchoolCode });

    if (!school) {
      return res.status(403).json({
        message: "Invalid school code. Please contact your school admin.",
      });
    }

    const existingDriver = await Driver.findOne({ email: emailNormalized });
    if (existingDriver) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newDriver = new Driver({
      fullName,
      email: emailNormalized,
      password: hashedPassword,
      driverCode: enteredSchoolCode,
      schoolId: school._id,
      busId: null,
      isOnTrip: false,
    });

    await newDriver.save();

    res.status(201).json({
      message: "Driver registered successfully",
    });

  } catch (err) {
    console.error("Driver Register Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= LOGIN DRIVER =================
exports.loginDriver = async (req, res) => {
  const { email, password } = req.body;

  try {
    const driver = await Driver.findOne({ email }).populate("busId");
    if (!driver) {
      return res.status(400).json({ message: "Driver not found" });
    }

    const isMatch = await bcrypt.compare(password, driver.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: driver._id, role: "driver" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: driver._id,
        fullName: driver.fullName,
        email: driver.email,
        driverCode: driver.driverCode,
        schoolId: driver.schoolId,
        busId: driver.busId?._id || null,
        assignedBus: driver.busId
          ? {
              _id: driver.busId._id,
              busNumber: driver.busId.busNumber,
              carNumber: driver.busId.carNumber,
              route: driver.busId.route,
              capacity: driver.busId.capacity,
              studentCount: driver.busId.studentCount,
              tripStatus: driver.busId.tripStatus,
              currentLocation: driver.busId.currentLocation,
            }
          : null,
        isOnTrip: driver.isOnTrip,
      },
    });
  } catch (err) {
    console.error("Driver Login Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= GET DRIVER PROFILE (FINAL CLEAN VERSION) =================
exports.getDriverProfile = async (req, res) => {
  try {
    const driverId = req.user?.id;

    const driver = await Driver.findById(driverId)
      .select("-password")
      .populate({
        path: "busId",
        select:
          "busNumber carNumber route capacity studentCount tripStatus currentLocation lastLocationUpdatedAt",
      });

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.status(200).json({
      message: "Driver profile fetched successfully",
      driver: {
        _id: driver._id,
        fullName: driver.fullName,
        email: driver.email,
        schoolId: driver.schoolId,
        isOnTrip: driver.isOnTrip,
        lastLocation: driver.lastLocation,
        lastLocationUpdatedAt: driver.lastLocationUpdatedAt,

        // 🔥 IMPORTANT: structured bus object
        busId: driver.busId
          ? {
              _id: driver.busId._id,
              busNumber: driver.busId.busNumber,
              carNumber: driver.busId.carNumber,
              route: driver.busId.route,
              capacity: driver.busId.capacity,
              studentCount: driver.busId.studentCount,
              tripStatus: driver.busId.tripStatus,
              currentLocation: driver.busId.currentLocation,
              lastLocationUpdatedAt:
                driver.busId.lastLocationUpdatedAt,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Get Driver Profile Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// REST and Socket.IO share the same authoritative service.
const tripService = require('../services/tripService');
const { endpoint } = require('../services/routeValidation');
exports.startTrip = endpoint(async (req, res) => res.json(await tripService.start(req.user.id, req.body || {}, req.io)));
exports.endTrip = endpoint(async (req, res) => res.json(await tripService.end(req.user.id, req.body || {}, req.io)));
exports.updateDriverLocation = endpoint(async (req, res) => res.json(await tripService.location(req.user.id, req.body || {}, req.io)));

// ================= GET ASSIGNED BUS DETAILS =================
exports.getAssignedBus = async (req, res) => {
  try {
    const driverId = req.user?.id || req.params.driverId;

    const driver = await Driver.findById(driverId).populate("busId");
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (!driver.busId) {
      return res.status(200).json({
        message: "No bus assigned yet",
        bus: null,
      });
    }

    res.status(200).json({
      message: "Assigned bus fetched successfully",
      bus: driver.busId,
    });
  } catch (err) {
    console.error("Get Assigned Bus Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= GET ALL DRIVERS (FOR SCHOOL) =================
exports.getAllDrivers = async (req, res) => {
  try {
    const schoolId = req.user.id;

    if (!schoolId) {
      return res.status(400).json({ message: "schoolId is required" });
    }

    const drivers = await Driver.find({ schoolId })
      .select("-password")
      .populate("busId");

    res.status(200).json({
      message: "Drivers fetched successfully",
      drivers,
    });
  } catch (err) {
    console.error("Get All Drivers Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};