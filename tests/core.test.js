const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { encode, decode, stitch, distance } = require('../services/routeGeometry');
const { computeRoute, sections, FIELD_MASK } = require('../services/googleRoutes');
const progress = require('../services/tripProgress');
const auth = require('../middleware/authMiddleware');

test('polyline round-trip and deterministic stitching', () => {
  const points = [{ lat: 26.1, lng: 91.7 }, { lat: 26.1005, lng: 91.7004 }, { lat: 26.101, lng: 91.701 }];
  const result = decode(encode(points));
  assert.equal(result.length, 3);
  assert.ok(distance(result[2], points[2]) < 1);
  assert.equal(stitch([points.slice(0, 2), points.slice(1)]).length, 3);
});

test('more than 25 intermediate stops are split without losing order or legs', async () => {
  const points = Array.from({ length: 58 }, (_, i) => ({ lat: 26 + i / 10000, lng: 91 + i / 10000 }));
  const calls = [];
  const fakeFetch = async (_url, options) => {
    assert.equal(options.headers['X-Goog-FieldMask'], FIELD_MASK);
    const body = JSON.parse(options.body);
    const locations = [body.origin, ...body.intermediates, body.destination].map(w => ({ lat: w.location.latLng.latitude, lng: w.location.latLng.longitude }));
    calls.push(locations);
    return { ok: true, json: async () => ({ routes: [{
      polyline: { encodedPolyline: encode(locations) },
      distanceMeters: (locations.length - 1) * 100,
      duration: `${(locations.length - 1) * 10}s`,
      legs: locations.slice(1).map((p, i) => ({ distanceMeters: 100, duration: '10s', polyline: { encodedPolyline: encode([locations[i], p]) } })),
    }] }) };
  };
  const route = await computeRoute(points, { fetchImpl: fakeFetch, key: 'placeholder' });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].at(-1), calls[1][0]);
  assert.deepEqual(calls[1].at(-1), calls[2][0]);
  assert.equal(route.legs.length, points.length - 1);
  assert.equal(route.routeDistanceMeters, 5700);
  assert.equal(decode(route.routePolyline).length, points.length);
  assert.deepEqual(sections(points).map(s => s.start), [0, 26, 52]);
});

test('GPS validation rejects weak, old and out-of-order fixes', () => {
  const now = Date.now();
  const trip = { lastDeviceTimestamp: new Date(now - 5000), currentLocation: { lat: 26, lng: 91 } };
  assert.equal(progress.validateLocation({ lat: 26, lng: 91, accuracy: 100, deviceTimestamp: now }, trip, now).ignored, 'weak_accuracy');
  assert.equal(progress.validateLocation({ lat: 26, lng: 91, accuracy: 10, deviceTimestamp: now - 130000 }, trip, now).ignored, 'stale_timestamp');
  assert.equal(progress.validateLocation({ lat: 26, lng: 91, accuracy: 10, deviceTimestamp: now - 6000 }, trip, now).ignored, 'out_of_order');
});

test('arrival requires consecutive low-speed points and dwell before completion', () => {
  const start = Date.now();
  const trip = { currentLocation: { lat: 26, lng: 91 }, speed: 1, nextStopIndex: 0, stopSnapshots: [{ location: { lat: 26, lng: 91 }, geofenceRadiusMeters: 65, status: 'pending', insideCount: 0 }] };
  assert.equal(progress.advanceStop(trip, start), null);
  assert.equal(trip.stopSnapshots[0].status, 'approaching');
  assert.equal(progress.advanceStop(trip, start + 7000), null);
  assert.equal(progress.advanceStop(trip, start + 14000).type, 'arrived');
  assert.equal(progress.advanceStop(trip, start + 35000).type, 'completed');
  assert.equal(trip.nextStopIndex, 1);
});

test('sustained deviation is required and route refresh is throttled', () => {
  const polyline = encode([{ lat: 26, lng: 91 }, { lat: 26, lng: 91.01 }]);
  const trip = { mode: 'route', direction: 'TO_SCHOOL', currentLocation: { lat: 26.001, lng: 91.005 }, accuracy: 10, nextStopIndex: 0, routeStartStopIndex: 0, routeProgressMeters: 0, routeLegs: [{ distanceMeters: 1000, durationSeconds: 100, encodedPolyline: polyline, stopIndex: 0 }], stopSnapshots: [{ location: { lat: 26, lng: 91.01 }, geofenceRadiusMeters: 65, status: 'pending' }], routeCalculatedAt: new Date(), lastRouteAttemptAt: new Date() };
  progress.updateProgress(trip);
  progress.updateProgress(trip);
  assert.equal(trip.offRoute, false);
  progress.updateProgress(trip);
  assert.equal(trip.offRoute, true);
  assert.equal(progress.shouldRefresh(trip, Date.now()), false);
  trip.lastRouteAttemptAt = new Date(Date.now() - 46000);
  assert.equal(progress.shouldRefresh(trip, Date.now()), true);
});

test('ETA includes preceding legs and stop dwell', () => {
  const now = Date.now();
  const trip = { mode: 'route', offRoute: false, lastLocationUpdatedAt: new Date(now), routeCalculatedAt: new Date(now), nextStopIndex: 0, routeStartStopIndex: 0, routeProgressMeters: 0, routeLegs: [{ distanceMeters: 1000, durationSeconds: 600, stopIndex: 0 }, { distanceMeters: 2000, durationSeconds: 900, stopIndex: 1 }], stopSnapshots: [{ status: 'pending' }, { status: 'pending' }] };
  const eta = progress.estimates(trip, now);
  assert.equal(eta.stops[0].seconds, 600);
  assert.equal(eta.stops[1].seconds, 1520);
});

test('auth middleware derives identity from a valid JWT', () => {
  process.env.JWT_SECRET = 'unit-test-secret';
  const token = jwt.sign({ id: 'abc', role: 'school' }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = { status() { return this; }, json() { throw new Error('unexpected rejection'); } };
  let next = false;
  auth(req, res, () => { next = true; });
  assert.equal(next, true);
  assert.deepEqual(req.user, { id: 'abc', role: 'school' });
});

test('role middleware rejects a valid token with the wrong role', () => {
  const { role } = require('../services/routeValidation');
  let next = false, status, body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  role('school')({ user: { id: 'parent-1', role: 'parent' } }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(status, 403);
  assert.equal(body.message, 'school access required');
});

test('socket ownership rejects malformed IDs before database lookup', async () => {
  const { allowedBus } = require('../services/socketService');
  assert.equal(await allowedBus({ id: 'school-1', role: 'school' }, 'invalid'), false);
  assert.equal(await allowedBus({ id: 'driver-1', role: 'driver' }, 'invalid'), false);
  assert.equal(await allowedBus({ id: 'parent-1', role: 'parent' }, 'invalid'), false);
});

test('socket ownership uses school, driver and parent relationships', async () => {
  const Bus = require('../models/Bus'), Parent = require('../models/Parent'), Student = require('../models/Student');
  const original = { busExists: Bus.exists, parentFind: Parent.findById, studentExists: Student.exists };
  const validBus = '507f1f77bcf86cd799439011';
  Bus.exists = async query => query.schoolId === 'school-1' || query.driverId === 'driver-1';
  Parent.findById = () => ({ select: () => ({ lean: async () => ({ children: ['507f1f77bcf86cd799439012'] }) }) });
  Student.exists = async query => query.busId === validBus && query._id.$in.length === 1;
  try {
    delete require.cache[require.resolve('../services/socketService')];
    const { allowedBus } = require('../services/socketService');
    assert.equal(await allowedBus({ id: 'school-1', role: 'school' }, validBus), true);
    assert.equal(await allowedBus({ id: 'driver-1', role: 'driver' }, validBus), true);
    assert.equal(await allowedBus({ id: 'parent-1', role: 'parent' }, validBus), true);
    assert.equal(await allowedBus({ id: 'other-school', role: 'school' }, validBus), false);
  } finally {
    Bus.exists = original.busExists;
    Parent.findById = original.parentFind;
    Student.exists = original.studentExists;
    delete require.cache[require.resolve('../services/socketService')];
  }
});

test('notification receipt suppresses duplicate parent alerts', async () => {
  const Receipt = require('../models/NotificationReceipt');
  const Parent = require('../models/Parent');
  const sendPath = require.resolve('../utils/sendNotification');
  const oldSend = require.cache[sendPath]?.exports;
  let pushes = 0, emits = 0, seen = false;
  require.cache[sendPath] = { id: sendPath, filename: sendPath, loaded: true, exports: async () => { pushes++; } };
  const oldCreate = Receipt.create, oldFind = Parent.findById;
  Receipt.create = async () => { if (seen) { const error = new Error(); error.code = 11000; throw error; } seen = true; };
  Parent.findById = () => ({ select: () => ({ lean: async () => ({ fcmToken: 'test-token' }) }) });
  delete require.cache[require.resolve('../services/routeNotifications')];
  const { notifyParent } = require('../services/routeNotifications');
  const io = { to: () => ({ emit: () => { emits++; } }) };
  assert.equal(await notifyParent('p1', 'trip:t1:eta', 'ETA', 'Soon', io), true);
  assert.equal(await notifyParent('p1', 'trip:t1:eta', 'ETA', 'Soon', io), false);
  assert.equal(pushes, 1);
  assert.equal(emits, 1);
  Receipt.create = oldCreate;
  Parent.findById = oldFind;
  if (oldSend) require.cache[sendPath].exports = oldSend;
});
