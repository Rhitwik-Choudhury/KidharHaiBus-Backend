const School = require('../models/School');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Driver = require('../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Bus = require('../models/Bus');
const { sendOTP } = require("../utils/emailService");
const Otp = require("../models/Otp");

const generateSchoolCode = async (schoolName) => {
  const prefix = schoolName
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 3)
    .toUpperCase() || "SCH";

  let code;
  let exists = true;

  while (exists) {
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    code = `SCH${prefix}${randomPart}`;
    exists = await School.findOne({ schoolCode: code });
  }

  return code;
};

// ================= SEND OTP =================
exports.sendSchoolOTP = async (req, res) => {
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

// ==================== Register School ====================
exports.registerSchool = async (req, res) => {
  const { schoolName, adminName, email, password, otp } = req.body;
  const emailNormalized = email.trim().toLowerCase();
  const record = await Otp.findOne({ email: emailNormalized });

  if (!record) return res.status(400).json({ message: "OTP not found" });

  if (new Date() > record.expiresAt)
    return res.status(400).json({ message: "OTP expired" });

  if (record.otp !== otp)
    return res.status(400).json({ message: "Invalid OTP" });

  await Otp.deleteOne({ email: emailNormalized });

  try {
    const existingSchool = await School.findOne({ email: emailNormalized });
    if (existingSchool) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const schoolCode = await generateSchoolCode(schoolName);

    const newSchool = new School({
      schoolName,
      adminName,
      email: emailNormalized,
      password: hashedPassword,
      schoolCode,
    });

    await newSchool.save();

    res.status(201).json({
      message: 'School registered successfully',
      schoolCode,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
};

// ==================== Login School ====================
exports.loginSchool = async (req, res) => {
  const { email, password } = req.body;

  try {
    const school = await School.findOne({ email });
    if (!school) {
      return res.status(400).json({ message: 'School not found' });
    }

    const isMatch = await bcrypt.compare(password, school.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: school._id, role: 'school' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: school._id,
        schoolName: school.schoolName,
        adminName: school.adminName,
        email: school.email,
        schoolCode: school.schoolCode,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Both legacy student URL families use the same scoped controller.
const studentController = require('./studentController');
exports.addStudent = studentController.createStudent;
exports.getStudents = studentController.getStudents;
exports.updateStudent = studentController.updateStudent;
exports.deleteStudent = studentController.deleteStudent;

// ==================== Add New Bus ====================
exports.addBus = async (req, res) => {
  try {
    const { busNumber, carNumber, route, capacity } = req.body;
    const schoolId = req.user.id;

    const newBus = await Bus.create({
      schoolId,
      busNumber,
      carNumber,
      route,
      capacity,
      studentCount: 0,
    });

    res.status(201).json(newBus);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to add bus' });
  }
};

// ==================== Get All Buses ====================
exports.getBuses = async (req, res) => {
  try {
    const schoolId = req.user.id;

    const buses = await Bus.find({ schoolId });

    res.status(200).json(buses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch buses' });
  }
};

// ==================== Dashboard Statistics ====================
exports.getDashboardStats = async (req, res) => {
  try {
    const schoolId = req.user?.id;

    if (!schoolId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user?.role && req.user.role !== "school") {
      return res.status(403).json({
        message: "School access required",
      });
    }

    const [
      totalStudents,
      totalDrivers,
      totalBuses,
      activeTrips,
    ] = await Promise.all([
      Student.countDocuments({ schoolId }),
      Driver.countDocuments({ schoolId }),
      Bus.countDocuments({ schoolId }),
      Bus.countDocuments({
        schoolId,
        tripStatus: "started",
      }),
    ]);

    return res.status(200).json({
      totalStudents,
      totalDrivers,
      totalBuses,
      activeTrips,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);

    return res.status(500).json({
      message: "Failed to fetch dashboard statistics",
    });
  }
};