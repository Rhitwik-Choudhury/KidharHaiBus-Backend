const mongoose = require('mongoose');
const { ref, coordinate } = require('./routeSchemas');
const schema = new mongoose.Schema({
  parentId: ref('Parent', { default: null }), studentId: ref('Student', { required: true }),
  schoolId: ref('School', { required: true }), busId: ref('Bus', { required: true }),
  requestedLocation: { type: coordinate, required: true },
  formattedAddress: { type: String, maxlength: 500, default: '' }, placeId: { type: String, maxlength: 300, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'adjusted', 'clarification_required', 'rejected', 'superseded'], default: 'pending' },
  isCurrent: { type: Boolean, default: true },
  submittedBy: { type: String, enum: ['parent', 'school'], required: true },
  reviewedBy: ref('School'), reviewedAt: Date, reviewNote: { type: String, maxlength: 1000, default: '' },
  routeStopId: ref('RouteStop'), acknowledgedAt: Date, acknowledgedBy: ref('Parent'),
  migrationKey: { type: String },
}, { timestamps: true });
schema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
schema.index({ migrationKey: 1 }, { unique: true, sparse: true });
schema.index({ schoolId: 1, busId: 1, isCurrent: 1, status: 1 });
module.exports = mongoose.model('PickupRequest', schema);
