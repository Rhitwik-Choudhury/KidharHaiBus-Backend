const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    transportStatus: { type: String, enum: ["active", "not_riding", "parent_transport", "starts_later", "temporary_arrangement"], default: "active" },
    transportStartsAt: Date,
    transportNote: { type: String, maxlength: 500, default: "" },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    class: {
      type: String,
      required: true,
      trim: true,
    },

    roll: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    busId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bus",
      required: true,
      index: true,
    },

    studentCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Student", studentSchema);