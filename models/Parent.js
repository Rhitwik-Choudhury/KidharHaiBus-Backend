const mongoose = require("mongoose");

const parentSchema = new mongoose.Schema(
  {
    fcmToken: {
      type: String,
      default: null
    },

    phone: {
      type: String,
      required: true
    },

    stopLocation: {
      lat: Number,
      lng: Number
    },

    whatsappOptIn: {
      type: Boolean,
      default: false
    },
    
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

    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      default: null,
      index: true,
    },

    studentCode: {
      type: String,
      default: null,
      trim: true,
    },

    children: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Parent", parentSchema);