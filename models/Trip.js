const mongoose = require('mongoose');
const { ref, coordinate, schoolLocation, stopSnapshot } = require('./routeSchemas');
const schema = new mongoose.Schema({
  schoolId: ref('School', { required: true }), busId: ref('Bus', { required: true }), driverId: ref('Driver', { required: true }),
  routePlanId: ref('RoutePlan'), routePlanVersion: Number,
  direction: { type: String, enum: ['TO_SCHOOL', 'FROM_SCHOOL'], required: true },
  status: { type: String, enum: ['preparing', 'active', 'completed', 'cancelled'], default: 'preparing' },
  // A partial unique index on running prevents concurrent starts (including preparing).
  running: { type: Boolean, default: true },
  mode: { type: String, enum: ['route', 'emergency', 'legacy'], default: 'route' }, fallbackReason: String,
  schoolLocationSnapshot: schoolLocation,
  stopSnapshots: [stopSnapshot], nextStopIndex: { type: Number, default: 0 },
  routePolyline: String, plannedPolyline: String, completedPolyline: { type: String, default: '' },
  routeDistanceMeters: Number, routeDurationSeconds: Number,
  routeLegs: [{ _id: false, stopIndex: Number, distanceMeters: Number, durationSeconds: Number, encodedPolyline: String }],
  routeCalculatedAt: Date, lastRouteAttemptAt: Date, lastReroutedAt: Date,
  routeStartStopIndex: { type: Number, default: 0 },
  routeProgressMeters: { type: Number, default: 0 }, routePointIndex: { type: Number, default: 0 },
  routeState: { type: String, enum: ['ready', 'rerouting', 'unavailable', 'cached'], default: 'unavailable' },
  deviationCount: { type: Number, default: 0 }, offRoute: { type: Boolean, default: false },
  startedAt: Date, endedAt: Date, currentLocation: coordinate, displayLocation: coordinate,
  lastLocationUpdatedAt: Date, lastDeviceTimestamp: Date,
  accuracy: Number, speed: Number, heading: Number,
  terminalEta: Date, endReason: String,
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ busId: 1 }, { unique: true, partialFilterExpression: { running: true } });
schema.index({ driverId: 1 }, { unique: true, partialFilterExpression: { running: true } });
schema.index({ schoolId: 1, status: 1, startedAt: -1 });
module.exports = mongoose.model('Trip', schema);
