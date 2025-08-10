const mongoose = require('mongoose');

const busSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
  },
  busNumber: { type: String, required: true },
  carNumber: { type: String, required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
  route: { type: String, required: true },
  capacity: { type: Number, required: true },
  studentCount: { type: Number, default: 0 }, // Will auto-update
}, { timestamps: true });

module.exports = mongoose.model('Bus', busSchema);
