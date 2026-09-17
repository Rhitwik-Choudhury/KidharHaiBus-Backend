const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, unique: true, required: true }, parentId: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now },
});
// Keep deduplication through the useful notification lifetime without an ever-growing trip array.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
module.exports = mongoose.model('NotificationReceipt', schema);
