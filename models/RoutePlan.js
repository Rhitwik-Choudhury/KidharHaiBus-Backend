const mongoose = require('mongoose');
const { ref, schoolLocation, stopSnapshot } = require('./routeSchemas');
const schema = new mongoose.Schema({
  schoolId: ref('School', { required: true }), busId: ref('Bus', { required: true }),
  schoolLocationSnapshot: schoolLocation,
  morningStopIds: [ref('RouteStop')], returnStopIds: [ref('RouteStop')],
  morningSnapshots: [stopSnapshot], returnSnapshots: [stopSnapshot],
  morningPreview: mongoose.Schema.Types.Mixed, returnPreview: mongoose.Schema.Types.Mixed,
  version: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  effectiveFrom: Date, publishedAt: Date, publishedBy: ref('School'),
  unresolvedStudents: [{ _id: false, studentId: ref('Student'), classification: String, note: String }],
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ busId: 1, version: 1 }, { unique: true });
schema.index({ busId: 1, status: 1, effectiveFrom: -1 });
// Published documents are append-only in the route service. Draft is always version 0.
schema.pre('save', function () {
  if (!this.isNew && this.status !== 'draft' && this.isModified()) {
    throw new Error('Published route versions are immutable');
  }
});
module.exports = mongoose.model('RoutePlan', schema);
