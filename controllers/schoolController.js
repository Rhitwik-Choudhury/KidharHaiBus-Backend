const School = require('../models/School');
const Student = require('../models/Student');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Bus = require('../models/Bus');

// ==================== Register School ====================
exports.registerSchool = async (req, res) => {
  const { schoolName, adminName, email, password } = req.body;

  try {
    const existingSchool = await School.findOne({ email });
    if (existingSchool) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newSchool = new School({
      schoolName,
      adminName,
      email,
      password: hashedPassword,
    });

    await newSchool.save();

    res.status(201).json({ message: 'School registered successfully' });
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
      roll,             // ✅ matches schema
      address,
      class: studentClass, // ✅ renamed from 'class' to avoid JS keyword
      bus,
      studentCode,
      schoolId,
    } = req.body;

    const newStudent = await Student.create({
      name,
      roll,
      address,
      class: studentClass,
      bus,
      studentCode,
      schoolId,
    });

    await exports.updateStudentCount(bus, +1); // bus is busNumber

    res.status(201).json(newStudent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to add student' });
  }
};

// ==================== Get All Students (for school) ====================
exports.getStudents = async (req, res) => {
  try {
    const { schoolId } = req.query;
    const students = await Student.find({ schoolId }); // ✅ field name matches schema
    res.status(200).json(students);
    console.log("Fetching students for schoolId:", req.query.schoolId);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch students' });
  }
};

// ==================== Update Student ====================
exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    const updatedStudent = await Student.findByIdAndUpdate(id, updatedData, {
      new: true,
    });

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

    await exports.updateStudentCount(student.bus, -1); // ✅ Correct bus number
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

// ==================== Get All Buses for a School ====================
exports.getBuses = async (req, res) => {
  try {
    const { schoolId } = req.query;

    const buses = await Bus.find({ schoolId }).populate('driver', 'name');
    res.status(200).json(buses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch buses' });
  }
};

// ==================== Update Student Count for a Bus ====================
exports.updateStudentCount = async (busNumber, change) => {
  try {
    const bus = await Bus.findOne({ busNumber });
    if (!bus) return;

    bus.studentCount += change;
    if (bus.studentCount < 0) bus.studentCount = 0;

    await bus.save();
  } catch (error) {
    console.error('Error updating student count:', error.message);
  }
};

// ==================== Assign Driver to Bus ====================
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