const School = require('../models/School');
const Student = require('../models/Student');
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

// ==================== Add New Student ====================
exports.addStudent = async (req, res) => {
  try {
    const {
      name,
      roll,
      address,
      class: studentClass,
      busId,
      studentCode,
      schoolId,
    } = req.body;

    const normalizedStudentCode = studentCode
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!normalizedStudentCode) {
      return res.status(400).json({
        message: "Student code is required"
      });
    }

    const newStudent = await Student.create({
      name,
      roll,
      address,
      class: studentClass,
      busId,
      studentCode: normalizedStudentCode,
      schoolId,
    });

    if (busId) {
      await Bus.findByIdAndUpdate(busId, {
        $inc: { studentCount: 1 },
      });
    }

    res.status(201).json(newStudent);
  } catch (error) {
    console.error("Add Student Error:", error);

    if (error.code === 11000 && error.keyPattern?.studentCode) {
      return res.status(409).json({
        message: "This student code already exists"
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// ==================== Get All Students ====================
exports.getStudents = async (req, res) => {
  try {
    const { schoolId } = req.query;

    const students = await Student.find({ schoolId })
      .populate("busId"); // ✅ important for frontend

    console.log("Fetching students for schoolId:", schoolId);

    res.status(200).json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch students' });
  }
};

// ==================== Update Student ====================
exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await Student.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Student not found" });
    }

    const oldBusId = existing.busId?.toString();
    const newBusId = req.body.busId;

    // 🔥 handle bus change
    if (oldBusId !== newBusId) {

      if (oldBusId) {
        await Bus.findByIdAndUpdate(oldBusId, {
          $inc: { studentCount: -1 },
        });
      }

      if (newBusId) {
        await Bus.findByIdAndUpdate(newBusId, {
          $inc: { studentCount: 1 },
        });
      }
    }

    const updatedStudent = await Student.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    ).populate("busId");

    res.status(200).json(updatedStudent);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update student' });
  }
};

// ==================== Delete Student ====================
exports.deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // 🔥 Decrement bus count
    if (student.busId) {
      await Bus.findByIdAndUpdate(student.busId, {
        $inc: { studentCount: -1 },
      });
    }

    await Student.findByIdAndDelete(id);

    res.status(200).json({ message: 'Student deleted successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to delete student' });
  }
};

// ==================== Add New Bus ====================
exports.addBus = async (req, res) => {
  try {
    const { schoolId, busNumber, carNumber, route, capacity } = req.body;

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
    const { schoolId } = req.query;

    const buses = await Bus.find({ schoolId });

    res.status(200).json(buses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch buses' });
  }
};

// ==================== Assign Driver ====================
exports.assignDriver = async (req, res) => {
  try {
    const { busId, driverId } = req.body;

    const updatedBus = await Bus.findByIdAndUpdate(
      busId,
      { driver: driverId },
      { new: true }
    );

    res.status(200).json(updatedBus);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to assign driver' });
  }
};