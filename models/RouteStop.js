const mongoose = require('mongoose');
const { ref, coordinate } = require('./routeSchemas');
const schema = new mongoose.Schema({
  schoolId: ref('School', { required: true }), busId: ref('Bus', { required: true }),
  name: { type: String, required: true, trim: true, maxlength: 100 },
  formattedAddress: { type: String, maxlength: 500, default: '' }, placeId: { type: String, maxlength: 300, default: '' },
  location: { type: coordinate, required: true },
  studentIds: [ref('Student')], parentIds: [ref('Parent')],
  geofenceRadiusMeters: { type: Number, default: 65, min: 30, max: 150 },
  active: { type: Boolean, default: true }, expiresAt: Date,
  createdFromPickupRequestIds: [ref('PickupRequest')],
}, { timestamps: true });
schema.index({ schoolId: 1, busId: 1, active: 1 });
module.exports = mongoose.model('RouteStop', schema);
