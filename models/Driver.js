const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: {type: String, required: true, unique: true},
  password: { type: String, required: true },
  driverCode: { type: String } // issued by school
}, { timestamps: true });

module.exports = mongoose.model('Driver', driverSchema);
