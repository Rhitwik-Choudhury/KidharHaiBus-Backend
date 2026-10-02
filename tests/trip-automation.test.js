const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const automation = require('../services/tripAutomation');
const progress = require('../services/tripProgress');
const geometry = require('../services/routeGeometry');
const point = lng => ({ lat: 26, lng });
const now = 1800000000000;
function fixture() {
  const stops = [91.001, 91.004].map((lng, index) => ({ name: 'Stop ' + index, location: point(lng), geofenceRadiusMeters: 65, status: 'pending', insideCount: 0, studentIds: [], students: [] }));
  const legs = [[91, 91.001], [91.001, 91.004]].map((p, i) => ({ stopIndex: i, encodedPolyline: geometry.encode(p.map(point)), distanceMeters: geometry.distance(point(p[0]), point(p[1])), durationSeconds: 60 }));
  return { _id: 'trip', busId: 'bus', driverId: 'driver', schoolId: 'school', mode: 'route', direction: 'FROM_SCHOOL', status: 'active', running: true, stopSnapshots: stops, nextStopIndex: 0, routeStartStopIndex: 0, routeProgressMeters: 0, routeLegs: legs, routePolyline: geometry.encode([91, 91.001, 91.004].map(point)), completedPolyline: '', currentLocation: point(91.0003), lastDeviceTimestamp: new Date(now), lastLocationUpdatedAt: new Date(now), routeCalculatedAt: new Date(now), accuracy: 5, speed: 12, save: async function () { this.saves = (this.saves || 0) + 1; } };
}
function sample(trip, lng, at, accuracy = 5) {
  const previous = { location: trip.currentLocation, time: trip.lastDeviceTimestamp };
  trip.currentLocation = point(lng); trip.lastDeviceTimestamp = new Date(at); trip.lastLocationUpdatedAt = new Date(at); trip.accuracy = accuracy;
  automation.observePassage(trip, previous, at); return previous;
}
function passed() {
  const trip = fixture();
  sample(trip, 91.0008, now + 3000); sample(trip, 91.0012, now + 6000);
  sample(trip, 91.0021, now + 9000); sample(trip, 91.0024, now + 12000);
  return trip;
}
test('passage starts a ten-second deadline and then advances the route', () => {
  const trip = passed(), stop = trip.stopSnapshots[0];
  assert.equal(+stop.autoSkipAt, now + 22000);
  assert.equal(automation.finalizeSkips(trip, now + 21000).length, 0);
  sample(trip, 91.0028, now + 23000);
  assert.equal(automation.finalizeSkips(trip, now + 23000).length, 1);
  assert.equal(stop.status, 'skipped'); assert.equal(stop.skipSource, 'automatic'); assert.equal(trip.nextStopIndex, 1);
});
test('weak or stale GPS cannot cause an automatic skip', () => {
  const trip = passed();
  assert.equal(automation.finalizeSkips(trip, now + 60000).length, 0);
  trip.lastDeviceTimestamp = new Date(now + 23000); trip.accuracy = 70;
  assert.equal(automation.finalizeSkips(trip, now + 23000).length, 0);
  const weak = fixture(); sample(weak, 91.0008, now + 3000, 70); sample(weak, 91.0024, now + 6000, 70);
  assert.ok(!weak.stopSnapshots[0].autoSkipAt);
});
test('returning to the stop cancels its deadline', () => {
  const trip = passed(); sample(trip, 91.0012, now + 15000);
  assert.equal(trip.stopSnapshots[0].autoSkipAt, null);
  assert.equal(automation.finalizeSkips(trip, now + 23000).length, 0);
});
test('reconnection beyond a stop does not invent passage evidence', () => {
  const trip = fixture(); sample(trip, 91.0024, now + 60000); sample(trip, 91.0028, now + 63000);
  assert.ok(!trip.stopSnapshots[0].autoSkipAt);
});
test('a parallel road cannot arm passage', () => {
  const trip = fixture(); trip.currentLocation = { lat: 26.0005, lng: 91.0003 };
  const previous = { location: trip.currentLocation, time: trip.lastDeviceTimestamp };
  trip.currentLocation = { lat: 26.0005, lng: 91.001 }; trip.lastDeviceTimestamp = new Date(now + 3000);
  automation.observePassage(trip, previous, now + 3000);
  assert.ok(!trip.stopSnapshots[0].nearSeenAt);
});
test('a stop crossed between samples can arm passage', () => {
  const trip = fixture();
  sample(trip, 91.002, now + 3000); sample(trip, 91.0024, now + 6000);
  assert.ok(trip.stopSnapshots[0].autoSkipAt);
});
test('arrived stops are completed and never auto-skipped', () => {
  const trip = passed(), stop = trip.stopSnapshots[0];
  stop.status = 'arrived'; stop.actualArrival = new Date(now + 12000);
  trip.lastDeviceTimestamp = new Date(now + 23000);
  assert.equal(automation.finalizeSkips(trip, now + 23000).length, 0);
  progress.advanceStop(trip, now + 23000);
  assert.equal(stop.status, 'completed'); assert.equal(trip.nextStopIndex, 1);
});
test('a later stop can register service while an earlier stop is unresolved', () => {
  const trip = fixture(); trip.currentLocation = trip.stopSnapshots[1].location; trip.speed = 0;
  for (const delta of [0, 3000, 6000, 26000]) { trip.lastDeviceTimestamp = new Date(now + delta); progress.advanceStop(trip, now + delta); }
  assert.equal(trip.stopSnapshots[1].status, 'completed'); assert.equal(trip.stopSnapshots[0].status, 'pending'); assert.equal(trip.nextStopIndex, 0);
});
test('morning reminders require school arrival and thirty seconds stationary', () => {
  const trip = fixture(); trip.direction = 'TO_SCHOOL'; trip.schoolLocationSnapshot = point(91.01); trip.stopSnapshots.forEach(s => s.status = 'completed'); trip.speed = 0;
  for (const delta of [0, 10000, 20000, 30000]) {
    trip.lastDeviceTimestamp = new Date(now + delta);
    automation.observeFinish(trip, { time: new Date(now + delta - 3000) }, now + delta);
  }
  assert.ok(!trip.finishCandidateAt);
  trip.currentLocation = point(91.01);
  for (const delta of [33000, 43000, 53000, 63000]) {
    trip.lastDeviceTimestamp = new Date(now + delta);
    automation.observeFinish(trip, { time: new Date(now + delta - 3000) }, now + delta);
  }
  assert.equal(+trip.finishCandidateAt, now + 63000); assert.ok(automation.reminderDue(trip, now + 63000));
  trip.finishSnoozedUntil = new Date(now + 363000); assert.equal(automation.reminderDue(trip, now + 64000), false);
  trip.finishSnoozedUntil = null; trip.finishReminderAt = new Date(now + 63000); assert.equal(automation.reminderDue(trip, now + 64000), false);
});
test('moving away clears a finish candidate; completion and stale GPS suppress reminders', () => {
  const trip = fixture(); trip.finishCandidateAt = new Date(now); trip.speed = 10;
  automation.observeFinish(trip, { time: new Date(now - 3000) }, now);
  assert.equal(trip.finishCandidateAt, null);
  trip.finishCandidateAt = new Date(now); trip.speed = 0; trip.status = 'completed';
  assert.equal(automation.reminderDue(trip, now), false);
  trip.status = 'active'; assert.equal(automation.reminderDue(trip, now + 60000), false);
});
function serviceHarness(trip, fail = false) {
  const calls = [];
  const chain = value => ({ select() { return this; }, lean: async () => value });
  const stubs = {
    '../models/Driver': { findById: async () => ({ _id: 'driver', busId: 'bus', schoolId: 'school' }), updateOne: async () => {} },
    '../models/Bus': { findOne: async () => ({ _id: 'bus', schoolId: 'school' }), updateOne: async () => {} },
    '../models/Student': { find: () => chain([]) }, '../models/Parent': { find: () => chain([]) },
    '../models/Trip': { findOne: async () => trip, findById: () => chain({ busId: 'bus' }) },
    './routePlanning': {}, './operationLock': { withLock: async (_, fn) => fn() },
    './googleRoutes': { computeRoute: async points => { calls.push(points); if (fail) throw new Error('Google unavailable'); return { routePolyline: geometry.encode(points), legs: points.slice(1).map((p, i) => ({ encodedPolyline: geometry.encode([points[i], p]), distanceMeters: geometry.distance(points[i], p), durationSeconds: 60 })), routeDistanceMeters: 300, routeDurationSeconds: 60 }; } },
    './routeNotifications': { notifyBus: async () => {}, notifyParent: async () => {}, busParents: async () => [] },
    './driverTripNotifications': { notifyDriver: async () => {} },
  };
  const module = { exports: {} }, filename = path.join(__dirname, '../services/tripService.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, Date, structuredClone, require: name => stubs[name] || require(path.join(__dirname, '../services', name)) }, { filename });
  return { service: module.exports, calls };
}
test('manual skip immediately removes the old waypoint and its ETA', async () => {
  const trip = fixture(); trip.lastLocationUpdatedAt = new Date(); trip.routeCalculatedAt = new Date();
  const { service, calls } = serviceHarness(trip);
  const view = await service.skip('driver', 'trip', { stopIndex: 0, reason: 'No passenger' });
  assert.equal(view.nextStopIndex, 1); assert.equal(view.nextStop.name, 'Stop 1');
  assert.equal(calls.length, 1); assert.equal(calls[0].length, 2); assert.equal(calls[0][1].lng, 91.004);
  assert.equal(trip.routeLegs[0].stopIndex, 1); assert.ok(view.nextStopEta.seconds > 59 && view.nextStopEta.seconds <= 60);
});
test('a failed skip reroute clears misleading old routes and ETAs', async () => {
  const trip = fixture(); trip.lastLocationUpdatedAt = new Date();
  const { service } = serviceHarness(trip, true);
  const view = await service.skip('driver', 'trip', { stopIndex: 0, reason: 'No passenger' });
  assert.equal(view.routeState, 'unavailable'); assert.equal(view.remainingPolyline, ''); assert.equal(view.nextStopEta, null); assert.equal(view.terminalEta, null);
});
test('persisted overdue auto-skip runs after worker restart and rebuilds the route', async () => {
  const trip = passed(); trip.stopSnapshots[0].autoSkipAt = new Date(Date.now() - 1000); trip.lastDeviceTimestamp = new Date(); trip.lastLocationUpdatedAt = new Date();
  const { service, calls } = serviceHarness(trip);
  await service.tickTrip('trip');
  assert.equal(trip.stopSnapshots[0].status, 'skipped'); assert.equal(trip.nextStopIndex, 1); assert.equal(calls[0][1].lng, 91.004);
});
test('completed future stops are excluded and leg indices retain snapshot identity', async () => {
  const trip = fixture(); trip.stopSnapshots[1].status = 'completed'; trip.direction = 'TO_SCHOOL'; trip.schoolLocationSnapshot = point(91.01);
  const { service, calls } = serviceHarness(trip); await service.calculate(trip);
  assert.equal(calls[0].length, 3); assert.deepEqual(Array.from(trip.routeLegs, l => l.stopIndex), [0, 2]);
});
test('ending clears auto-skip deadlines and reminder state', async () => {
  const trip = passed(); trip.finishCandidateAt = new Date();
  const { service } = serviceHarness(trip);
  await service.end('driver', { confirmIncomplete: true, reason: 'Ending early' });
  assert.equal(trip.status, 'completed'); assert.equal(trip.running, false); assert.equal(trip.finishCandidateAt, null);
  assert.ok(trip.stopSnapshots.every(s => !s.autoSkipAt));
});
test('closely spaced consecutive missed stops each resolve from their own evidence', () => {
  const trip = fixture(); trip.stopSnapshots[1].location = point(91.002);
  trip.routeLegs[1].encodedPolyline = geometry.encode([91.001, 91.002].map(point));
  for (const [lng, delta] of [[91.0008, 3000], [91.0012, 6000], [91.0017, 9000], [91.0021, 12000], [91.0024, 15000], [91.0031, 18000], [91.0034, 21000], [91.0038, 32000]]) sample(trip, lng, now + delta);
  assert.ok(trip.stopSnapshots.every(s => s.autoSkipAt));
  assert.equal(automation.finalizeSkips(trip, now + 32000).length, 2);
  assert.equal(trip.nextStopIndex, 2);
});
test('return reminders require final-stop resolution and stationary evidence', () => {
  const trip = fixture(); trip.speed = 0; trip.currentLocation = trip.stopSnapshots[1].location;
  for (const delta of [0, 10000, 20000, 30000]) { trip.lastDeviceTimestamp = new Date(now + delta); automation.observeFinish(trip, { time: new Date(now + delta - 3000) }, now + delta); }
  assert.equal(trip.finishCandidateAt, null);
  trip.stopSnapshots.forEach(s => s.status = 'completed');
  for (const delta of [33000, 43000, 53000, 63000]) { trip.lastDeviceTimestamp = new Date(now + delta); automation.observeFinish(trip, { time: new Date(now + delta - 3000) }, now + delta); }
  assert.equal(+trip.finishCandidateAt, now + 63000);
  assert.ok(automation.reminderDue(trip, now + 63000));
});
