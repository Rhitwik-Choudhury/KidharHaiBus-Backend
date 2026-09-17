const mongoose = require('mongoose');
const { Schema } = mongoose;
const ref = (model, extra = {}) => ({ type: Schema.Types.ObjectId, ref: model, ...extra });
const coordinate = new Schema({
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
}, { _id: false });
const schoolLocation = new Schema({
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  formattedAddress: { type: String, maxlength: 500, default: '' },
  placeId: { type: String, maxlength: 300, default: '' },
  verifiedAt: Date,
}, { _id: false });
const stopSnapshot = new Schema({
  routeStopId: ref('RouteStop'), sequence: Number, name: String,
  location: coordinate, formattedAddress: String, placeId: String,
  studentIds: [ref('Student')], parentIds: [ref('Parent')],
  students: [{ _id: false, id: ref('Student'), name: String }],
  geofenceRadiusMeters: { type: Number, default: 65 }, expiresAt: Date,
  status: { type: String, enum: ['pending', 'approaching', 'arrived', 'completed', 'skipped'], default: 'pending' },
  estimatedArrival: Date, actualArrival: Date, completedAt: Date, skipReason: String,
  insideCount: { type: Number, default: 0 }, insideSince: Date,
}, { _id: false });
module.exports = { ref, coordinate, schoolLocation, stopSnapshot };
