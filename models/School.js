const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  schoolName: { type: String, required: true },
  adminName: { type: String, required: true },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },

  password: {
    type: String,
    required: true,
  },

  // Unique code shared with drivers so they can join this school
  schoolCode: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    trim: true,
    index: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('School', schoolSchema);