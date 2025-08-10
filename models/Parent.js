const mongoose = require('mongoose');

const parentSchema = new mongoose.Schema(
  {
    // We accept "name" from the client, but we store it here as fullName
    fullName: { type: String, required: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: { type: String, required: true },

    // ⚠️ Make optional AND sparse so multiple nulls won't violate a unique index
    // Or just drop "unique" entirely if you don’t need it now.
    mobileNumber: { type: String, unique: true, sparse: true, default: null },

    // MVP helpers
    studentCode: { type: String, default: null },
    children: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Parent', parentSchema);
