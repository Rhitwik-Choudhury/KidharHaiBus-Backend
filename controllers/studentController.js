const Student = require("../models/Student");
const Bus = require("../models/Bus");
const mongoose = require("mongoose");

// ================= CREATE STUDENT =================
exports.createStudent = async (req, res) => {
  try {
    const student = new Student(req.body);
    const savedStudent = await student.save();

    // 🔥 Increment student count
    if (savedStudent.busId) {
      await Bus.findByIdAndUpdate(savedStudent.busId, {
        $inc: { studentCount: 1 },
      });
    }

    res.status(201).json(savedStudent);
  } catch (err) {
    console.error("Create Student Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ================= GET STUDENTS =================
exports.getStudents = async (req, res) => {
  try {
    const { schoolId } = req.query;

    if (!schoolId) {
      return res.status(400).json({ error: "schoolId is required" });
    }

    // 🔥 FIX: convert to ObjectId
    const students = await Student.find({
      schoolId: new mongoose.Types.ObjectId(schoolId),
    }).populate("busId");

    res.json(students);
  } catch (err) {
    console.error("Fetch Students Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ================= UPDATE STUDENT =================
exports.updateStudent = async (req, res) => {
  try {
    const existing = await Student.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: "Student not found" });
    }

    const oldBusId = existing.busId?.toString();
    const newBusId = req.body.busId;

    // 🔥 Handle bus change
    if (oldBusId !== newBusId) {

      // Decrease old bus count
      if (oldBusId) {
        await Bus.findByIdAndUpdate(oldBusId, {
          $inc: { studentCount: -1 },
        });
      }

      // Increase new bus count
      if (newBusId) {
        await Bus.findByIdAndUpdate(newBusId, {
          $inc: { studentCount: 1 },
        });
      }
    }

    const updated = await Student.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).populate("busId"); // 🔥 ensures frontend gets bus info

    res.json(updated);
  } catch (err) {
    console.error("Update Student Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ================= DELETE STUDENT =================
exports.deleteStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // 🔥 Decrement bus count
    if (student.busId) {
      await Bus.findByIdAndUpdate(student.busId, {
        $inc: { studentCount: -1 },
      });
    }

    await Student.findByIdAndDelete(req.params.id);

    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete Student Error:", err);
    res.status(500).json({ error: err.message });
  }
};