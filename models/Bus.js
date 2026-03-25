const mongoose = require("mongoose");

const busSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },

    busNumber: {
      type: String,
      required: true,
      trim: true,
    },

    carNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    // Driver assigned to this bus
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true,
    },

    route: {
      type: String,
      required: true,
      trim: true,
    },

    capacity: {
      type: Number,
      required: true,
      min: 1,
    },

    studentCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Live tracking state
    currentLocation: {
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
    },

    tripStatus: {
      type: String,
      enum: ["idle", "started", "ended"],
      default: "idle",
    },

    lastLocationUpdatedAt: {
      type: Date,
      default: null,
    },

    tripStartedAt: {
      type: Date,
      default: null,
    },

    tripEndedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bus", busSchema);