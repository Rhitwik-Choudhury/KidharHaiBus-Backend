const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true },
  eventKey: { type: String, required: true },
  type: { type: String, required: true },
  title: { type: String, default: 'Trackefy' },
  message: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  readAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ parentId: 1, eventKey: 1 }, { unique: true });
schema.index({ parentId: 1, createdAt: -1 });
schema.index({ parentId: 1, readAt: 1 });
module.exports = mongoose.model('ParentNotification', schema);
