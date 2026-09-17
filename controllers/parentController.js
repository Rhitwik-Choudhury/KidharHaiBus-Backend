const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Parent = require("../models/Parent");
const Student = require("../models/Student");

const { sendOTP } = require("../utils/emailService");
const Otp = require("../models/Otp");

// ================= SEND OTP =================
exports.sendParentOTP = async (req, res) => {
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

/**
 * POST /api/parent/signup
 * Accepts: { name?, fullName?, email, password, studentCode? }
 */
/*Register Parent*/


exports.registerParent = async (req, res) => {
  try {
    const { name, fullName, email, password, studentCode, otp, phone } = req.body;
    const emailNormalized = email.trim().toLowerCase();
    // ✅ OTP VERIFY (FIXED)
    const record = await Otp.findOne({ email: emailNormalized });

    if (!record) return res.status(400).json({ message: "OTP not found" });

    if (new Date() > record.expiresAt)
      return res.status(400).json({ message: "OTP expired" });

    if (record.otp !== otp)
      return res.status(400).json({ message: "Invalid OTP" });

    await Otp.deleteOne({ email: emailNormalized });

    const displayName = (fullName || name || "").trim();
    if (!displayName || !email || !password) {
      return res.status(400).json({
        message: "Full name, email and password are required",
      });
    }

    const exists = await Parent.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hash = await bcrypt.hash(password, 10);

    let linkedStudent = null;
    let schoolId = null;

    if (studentCode) {
      linkedStudent = await Student.findOne({
        studentCode: studentCode.trim().toUpperCase(),
      });

      if (!linkedStudent) {
        return res.status(400).json({
          message: "Invalid student code",
        });
      }

      schoolId = linkedStudent.schoolId || null;
    }

    const parentData = {
      fullName: displayName,
      email,
      password: hash,
      phone, // ✅ ADD THIS
      studentCode: studentCode ? studentCode.trim().toUpperCase() : null,
      schoolId,
      children: linkedStudent ? [linkedStudent._id] : [],
      busId: linkedStudent ? linkedStudent.busId : null,
    };

    const parent = await Parent.create(parentData);

    const token = jwt.sign(
      { id: parent._id.toString(), role: "parent" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(201).json({
      message: "Parent registered successfully",
      token,
      user: {
        id: parent._id.toString(),
        fullName: parent.fullName,
        email: parent.email,
      },
    });
  } catch (err) {
    console.warn("Parent Register Error:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

/**
 * POST /api/parent/login
 * Accepts: { email, password }
 */
exports.loginParent = async (req, res) => {
  try {
    const { email, password } = req.body;

    const parent = await Parent.findOne({ email });
    if (!parent) {
      return res.status(400).json({ message: "Parent not found" });
    }

    const ok = await bcrypt.compare(password, parent.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: parent._id.toString(), role: "parent" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      message: "Login successful",
      token,
      parent: {
        _id: parent._id,
        fullName: parent.fullName,
        email: parent.email,
        studentCode: parent.studentCode || null,
        schoolId: parent.schoolId || null,
        children: parent.children || [],
      },
    });
  } catch (err) {
    console.warn("Parent Login Error:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

/**
 * GET /api/parent/me
 * Returns logged-in parent with populated children and each child's bus
 */
exports.getMyProfile = async (req, res) => {
  try {
    const parentId = req.user?.id;

    const parent = await Parent.findById(parentId)
      .select("-password")
      .populate({
        path: "children",
        populate: {
          path: "busId",
          populate: {
            path: "driverId",   // 👈 THIS IS CRITICAL
            select: "fullName email",
          },
        },
      });

    if (!parent) {
      return res.status(404).json({ message: "Parent not found" });
    }

    return res.status(200).json({
      message: "Parent profile fetched successfully",
      parent,
    });
  } catch (err) {
    console.warn("Get Parent Profile Error:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

/**
 * GET /api/parent/my-bus
 * Returns the first linked child's bus details
 */
exports.getMyBus = async (req, res) => {
  try {
    const parentId = req.user?.id;

    const parent = await Parent.findById(parentId).populate({
      path: "children",
      populate: {
        path: "busId",
        select:
          "busNumber carNumber route capacity studentCount currentLocation tripStatus lastLocationUpdatedAt driverId",
      },
    });

    if (!parent) {
      return res.status(404).json({ message: "Parent not found" });
    }

    if (!parent.children || parent.children.length === 0) {
      return res.status(200).json({
        message: "No child linked to this parent yet",
        student: null,
        bus: null,
      });
    }

    const student = req.query.studentId ? parent.children.find(c => String(c._id) === req.query.studentId) : parent.children[0];
    if (!student) return res.status(404).json({ message: 'Child not found' });
    const bus = student?.busId || null;

    return res.status(200).json({
      message: "Parent bus fetched successfully",
      student,
      bus,
    });
  } catch (err) {
    console.warn("Get Parent Bus Error:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// Older clients may submit a point, but it is now a review request, never an operational stop.
exports.setParentLocation = require('../services/routeValidation').endpoint(async (req, res) => {
  const p = await Parent.findById(req.user.id).select('children');
  const { assert } = require('../services/routeValidation');
  assert(p, 'Parent not found', 404);
  const studentId = req.body.studentId || (p.children.length === 1 ? p.children[0] : null);
  assert(studentId, 'Select the child whose pickup point you want to change');
  const request = await require('../services/routePlanning').submitRequest(req.user.id, studentId, req.body);
  res.json({ message: 'Pending school review. Your approved stop has not changed.', requestId: request._id, status: 'pending' });
});

exports.saveFcmToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (
      !token ||
      typeof token !== "string" ||
      token.trim().length === 0
    ) {
      return res.status(400).json({
        message: "Valid FCM token is required",
      });
    }

    const cleanToken = token.trim();

    const parent = await Parent.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          fcmToken: cleanToken,
        },
      },
      {
        new: true,
      }
    );

    if (!parent) {
      return res.status(404).json({
        message: "Parent not found",
      });
    }

    return res.status(200).json({
      message: "Token saved successfully",
    });
  } catch (err) {
    console.error("Save FCM Token Error:", err);

    return res.status(500).json({
      message: "Server error",
    });
  }
};