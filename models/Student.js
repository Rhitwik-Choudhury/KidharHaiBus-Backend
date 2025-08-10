// backend/models/Student.js
const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
  },
  name: { type: String, required: true },
  class: { type: String, required: true },
  roll: { type: String, required: true },
  address: { type: String, required: true },
  bus: { type: String, required: true },
  studentCode: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Student', studentSchema);
