const Driver = require("../models/Driver");
const Bus = require("../models/Bus");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const FIXED_DRIVER_CODE = "DRIVER2025";
const { sendOTP } = require("../utils/emailService");
const Otp = require("../models/Otp");

// ================= SEND OTP =================
exports.sendDriverOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const emailNormalized = email.trim().toLowerCase();

    const otp = Math.floor(100000 + Math.random() * 900000);

    await Otp.deleteMany({ email });

    await Otp.create({
      email: emailNormalized,
      otp: otp.toString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const emailSent = await sendOTP(email, otp);

    if (!emailSent) {
      return res.status(500).json({ message: "Failed to send OTP" });
    }

    res.status(200).json({
      message: "OTP sent successfully",
      otp, // ⚠️ remove later
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= REGISTER DRIVER =================
exports.registerDriver = async (req, res) => {
  const { fullName, email, password, driverCode, otp, schoolId } = req.body;

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

    await Otp.deleteOne({ email });

    // ✅ DRIVER CODE CHECK
    if (driverCode !== FIXED_DRIVER_CODE) {
      return res.status(403).json({ message: "Invalid driver code" });
    }

    const existingDriver = await Driver.findOne({ email });
    if (existingDriver) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newDriver = new Driver({
      fullName,
      email,
      password: hashedPassword,
      driverCode,
      schoolId, // ✅ PASS FROM FRONTEND
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
      { expiresIn: "1d" }
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

// ================= START TRIP =================
exports.startTrip = async (req, res) => {
  try {
    const driverId = req.user?.id || req.body.driverId;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (!driver.busId) {
      return res.status(400).json({
        message: "No bus assigned to this driver. Please contact school admin.",
      });
    }

    const bus = await Bus.findById(driver.busId);
    if (!bus) {
      return res.status(404).json({ message: "Assigned bus not found" });
    }

    driver.isOnTrip = true;
    await driver.save();

    bus.tripStatus = "started";
    bus.tripStartedAt = new Date();
    bus.tripEndedAt = null;
    await bus.save();

    res.status(200).json({
      message: "Trip started successfully",
      driver: {
        id: driver._id,
        isOnTrip: driver.isOnTrip,
        busId: driver.busId,
      },
      bus: {
        id: bus._id,
        busNumber: bus.busNumber,
        tripStatus: bus.tripStatus,
        tripStartedAt: bus.tripStartedAt,
      },
    });
  } catch (err) {
    console.error("Start Trip Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= END TRIP =================
exports.endTrip = async (req, res) => {
  try {
    const driverId = req.user?.id || req.body.driverId;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (!driver.busId) {
      return res.status(400).json({
        message: "No bus assigned to this driver.",
      });
    }

    const bus = await Bus.findById(driver.busId);
    if (!bus) {
      return res.status(404).json({ message: "Assigned bus not found" });
    }

    driver.isOnTrip = false;
    await driver.save();

    bus.tripStatus = "ended";
    bus.tripEndedAt = new Date();
    await bus.save();

    res.status(200).json({
      message: "Trip ended successfully",
      driver: {
        id: driver._id,
        isOnTrip: driver.isOnTrip,
        busId: driver.busId,
      },
      bus: {
        id: bus._id,
        busNumber: bus.busNumber,
        tripStatus: bus.tripStatus,
        tripEndedAt: bus.tripEndedAt,
      },
    });
  } catch (err) {
    console.error("End Trip Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= UPDATE DRIVER LOCATION =================
// This can be called from normal REST API if needed.
// For real-time Socket.IO, use the same logic there too.
exports.updateDriverLocation = async (req, res) => {
  try {
    const driverId = req.user?.id || req.body.driverId;
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ message: "lat and lng are required" });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (!driver.busId) {
      return res.status(400).json({
        message: "No bus assigned to this driver.",
      });
    }

    if (!driver.isOnTrip) {
      return res.status(400).json({
        message: "Trip is not active. Start trip before sending location.",
      });
    }

    const bus = await Bus.findById(driver.busId);
    if (!bus) {
      return res.status(404).json({ message: "Assigned bus not found" });
    }

    const now = new Date();

    driver.lastLocation = { lat, lng };
    driver.lastLocationUpdatedAt = now;
    await driver.save();

    bus.currentLocation = { lat, lng };
    bus.lastLocationUpdatedAt = now;
    await bus.save();

    // Optional Socket.IO emit if io is attached to req
    if (req.io) {
      req.io.to(`bus_${bus._id}`).emit("busLocationUpdated", {
        busId: bus._id,
        lat,
        lng,
        lastLocationUpdatedAt: now,
      });
    }

    res.status(200).json({
      message: "Location updated successfully",
      busId: bus._id,
      currentLocation: bus.currentLocation,
      lastLocationUpdatedAt: now,
    });
  } catch (err) {
    console.error("Update Driver Location Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

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
    const { schoolId } = req.query;

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