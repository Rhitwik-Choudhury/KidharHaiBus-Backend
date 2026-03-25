const mongoose = require("mongoose");

const driverSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

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

    // Issued by school
    driverCode: {
      type: String,
      trim: true,
      default: null,
    },

    // IMPORTANT: driver belongs to a school
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      default: null,
      index: true,
    },

    // IMPORTANT: driver is assigned to one bus
    busId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bus",
      default: null,
      index: true,
    },

    isOnTrip: {
      type: Boolean,
      default: false,
    },

    lastLocation: {
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
    },

    lastLocationUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Driver", driverSchema);