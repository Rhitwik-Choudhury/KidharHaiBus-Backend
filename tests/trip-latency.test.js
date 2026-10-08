const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const geometry = require('../services/routeGeometry');
function load(file, stubs) {
  const filename = path.join(__dirname, '../services', file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, Date, structuredClone, setInterval, clearInterval, require: name => stubs[name] || require(path.resolve(path.dirname(filename), name)) }, { filename });
  return module.exports;
}
const chain = value => ({ select() { return this; }, lean: async () => value });
function harness() {
  let trip = null, googleCalls = 0, notificationCalls = 0; const notices = [];
  const stop = { name: 'Oak Road', location: { lat: 26, lng: 91.001 }, studentIds: ['student'], students: [{ id: 'student', name: 'Child' }], status: 'pending' };
  const plan = { _id: 'plan', version: 1, morningSnapshots: [stop], returnSnapshots: [stop], schoolLocationSnapshot: { lat: 26, lng: 91.01 } };
  const stubs = {
    '../models/Driver': { findById: async () => ({ busId: 'bus', schoolId: 'school' }), updateOne: async () => {} },
    '../models/Bus': { findOne: async () => ({ _id: 'bus', schoolId: 'school' }), updateOne: async () => {} },
    '../models/Student': { find: () => chain([{ _id: 'student' }]) },
    '../models/Parent': { find: () => chain([{ _id: 'parent', children: ['student'] }]) },
    '../models/Trip': {
      findOne: async () => trip?.running ? trip : null,
      create: async input => trip = { ...input, _id: 'trip', running: true, __v: 0, nextStopIndex: 0, routeLegs: [], save: async () => { trip.__v++; } },
    },
    './routePlanning': { publishedPlan: async () => plan },
    './operationLock': { withLock: async (_, fn) => fn() },
    './googleRoutes': { computeRoute: async () => { googleCalls++; throw new Error('This must not run in start/end'); } },
    './routeNotifications': { notifyBus: async () => { notificationCalls++; }, notifyParent: async (...args) => { notificationCalls++; notices.push(args); }, busParents: async () => [] },
  };
  const service = load('tripService.js', stubs);
  return { service, notices, get trip() { return trip; }, get googleCalls() { return googleCalls; }, get notificationCalls() { return notificationCalls; } };
}
test('start confirms active state with persisted route/notification work without Google or push', async () => {
  const h = harness();
  const result = await h.service.start('driver', { direction: 'TO_SCHOOL', location: { lat: 26, lng: 91 } });
  assert.equal(result.trip.status, 'active'); assert.equal(result.driver.isOnTrip, true);
  assert.equal(h.trip.routeWorkPending, true); assert.equal(h.trip.startNoticePending, true);
  assert.equal(result.trip.nextStopEta, null); assert.equal(h.googleCalls, 0); assert.equal(h.notificationCalls, 0);
  const resumed = await h.service.start('driver', { direction: 'TO_SCHOOL', location: { lat: 26, lng: 91 } });
  assert.equal(resumed.trip.id, result.trip.id); assert.equal(resumed.resumed, true);
});
test('early end requires confirmation, persists skipped stops and notification work, and repeats safely', async () => {
  const h = harness();
  await h.service.start('driver', { direction: 'TO_SCHOOL', location: { lat: 26, lng: 91 } });
  await assert.rejects(h.service.end('driver', {}), e => e.status === 409);
  assert.equal(h.trip.status, 'active');
  const result = await h.service.end('driver', { confirmIncomplete: true });
  assert.equal(result.ended, true); assert.equal(h.trip.running, false); assert.equal(h.trip.routeWorkPending, false);
  assert.equal(h.trip.endNoticePending, true); assert.equal(h.trip.stopSnapshots[0].skipSource, 'trip_end');
  assert.equal(h.notificationCalls, 0); assert.equal((await h.service.end('driver', {})).ended, true);
});
test('all stops completed allows immediate end without early-end confirmation', async () => {
  const h = harness(); await h.service.start('driver', { direction: 'FROM_SCHOOL', location: { lat: 26, lng: 91 } });
  h.trip.stopSnapshots[0].status = 'completed'; h.trip.nextStopIndex = 1;
  assert.equal((await h.service.end('driver', {})).ended, true);
  assert.equal(h.trip.stopSnapshots[0].status, 'completed');
});
function workerHarness(change = () => {}, fail = false) {
  const source = { _id: 'trip', busId: 'bus', status: 'active', routeWorkPending: true, currentLocation: { lat: 26, lng: 91 }, stopSnapshots: [{ status: 'pending' }], nextStopIndex: 0, routeLegs: [] };
  const current = { ...source, stopSnapshots: [{ status: 'pending' }], save: async () => { saves++; } };
  let lock = false, saves = 0, emits = 0, pushCalls = 0, pushClears = 0;
  const service = load('tripWorkQueue.js', {
    '../models/Trip': { findById: async () => reads++ ? current : { ...source }, findOne: async () => current, updateOne: async () => {} },
    '../models/ParentNotification': { updateOne: async () => { pushClears++; } },
    '../models/Parent': { findById: () => chain({ fcmToken: 'token' }) },
    './operationLock': { withLock: async (_, fn) => { lock = true; try { return await fn(); } finally { lock = false; } } },
    './tripService': { calculate: async snapshot => { assert.equal(lock, false); change(current); if (fail) throw Error('Google unavailable'); snapshot.routePolyline = geometry.encode([{ lat: 26, lng: 91 }, { lat: 26, lng: 91.001 }]); snapshot.routeState = 'ready'; }, emitTrip: async () => { emits++; } },
    './tripProgress': { updateProgress: () => {}, locateOnRoute: candidate => ({ distance: geometry.distance(candidate.currentLocation, { lat: 26, lng: 91.001 }) }) },
    '../utils/sendNotification': async () => { pushCalls++; if (fail) throw Error('FCM unavailable'); },
  });
  let reads = 0;
  return { service, current, get saves() { return saves; }, get emits() { return emits; }, get pushClears() { return pushClears; }, get pushCalls() { return pushCalls; } };
}
test('queued route computes outside the lock and commits after restart', async () => {
  const h = workerHarness(); await h.service.prepareRoute('trip');
  assert.equal(h.current.routeWorkPending, false); assert.equal(h.current.routeState, 'ready'); assert.equal(h.saves, 1); assert.equal(h.emits, 1);
});
test('a slow Google response cannot overwrite an ended trip', async () => {
  const h = workerHarness(current => { current.status = 'completed'; current.routeWorkPending = false; });
  await h.service.prepareRoute('trip'); assert.equal(h.saves, 0); assert.equal(h.emits, 0);
});
test('changed stops or moved GPS discard old Google result and keep work queued', async () => {
  for (const change of [c => { c.stopSnapshots[0].status = 'skipped'; }, c => { c.currentLocation = { lat: 26, lng: 91.01 }; }, c => { c.routeWorkVersion = 2; }]) {
    const h = workerHarness(change); await h.service.prepareRoute('trip');
    assert.equal(h.saves, 0); assert.equal(h.current.routeWorkPending, true);
  }
});
test('Google failure leaves tracking active without fabricated route or ETA', async () => {
  const h = workerHarness(() => {}, true); await h.service.prepareRoute('trip');
  assert.equal(h.current.status, 'active'); assert.equal(h.current.routeState, 'unavailable'); assert.equal(h.current.routeWorkPending, false);
});
test('persisted push clears only after success and remains pending on FCM failure', async () => {
  const notification = { _id: 'n', parentId: 'parent', title: 'Trackefy', message: 'Trip ended', eventKey: 'trip:end', type: 'TRIP_ENDED', data: {} };
  const ok = workerHarness(); await ok.service.deliverPush(notification); assert.equal(ok.pushCalls, 1); assert.equal(ok.pushClears, 1);
  const failed = workerHarness(() => {}, true); await assert.rejects(failed.service.deliverPush(notification)); assert.equal(failed.pushClears, 0);
});

test('early-end worker sends the exact skipped-stop message after the request completes', async () => {
  const h = harness(); await h.service.start('driver', { direction: 'TO_SCHOOL', location: { lat: 26, lng: 91 } });
  await h.service.end('driver', { confirmIncomplete: true });
  assert.equal(h.notices.length, 0);
  await h.service.deliverEndNotices(h.trip);
  assert.equal(h.notices[0][2], 'STOP_SKIPPED');
  assert.equal(h.notices[0][3], 'The trip ended before the bus reached Oak Road. Your child’s stop was marked skipped. Please contact the driver if you need help.');
});
test('pending notices from an older ended trip cannot reset a newer active trip', async () => {
  let syncs = 0, emits = 0, notices = 0, clears = 0;
  const old = { _id: 'old', busId: 'bus', status: 'completed', endNoticePending: true };
  const worker = load('tripWorkQueue.js', {
    '../models/Trip': { findById: async () => old, findOne: async () => ({ _id: 'new', status: 'active' }), updateOne: async () => { clears++; } },
    './operationLock': { withLock: async (_, fn) => fn() },
    './tripService': { syncState: async () => { syncs++; }, emitTrip: async () => { emits++; }, deliverEndNotices: async () => { notices++; } },
  });
  await worker.deliverTripNotices('old');
  assert.equal(syncs, 0); assert.equal(emits, 0); assert.equal(notices, 1); assert.equal(clears, 1);
});

test('movement along the returned route does not endlessly postpone route readiness', async () => {
  const h = workerHarness(c => { c.currentLocation = { lat: 26, lng: 91.0015 }; });
  await h.service.prepareRoute('trip');
  assert.equal(h.current.routeState, 'ready'); assert.equal(h.current.routeWorkPending, false);
});
test('finish-reminder delivery runs outside the lock and is suppressed after end', async () => {
  let locked = false, deliveries = 0, clears = 0;
  const trip = { _id: 'trip', busId: 'bus', status: 'active', stopSnapshots: [], direction: 'FROM_SCHOOL', finishNoticePending: true, finishReminderAt: new Date(), finishCandidateAt: new Date() };
  const worker = load('tripWorkQueue.js', {
    '../models/Trip': { findById: async () => trip, updateOne: async () => { clears++; } },
    './operationLock': { withLock: async (_, fn) => { locked = true; try { return await fn(); } finally { locked = false; } } },
    './driverTripNotifications': { notifyDriver: async () => { assert.equal(locked, false); deliveries++; } },
  });
  await worker.deliverTripNotices('trip'); assert.equal(deliveries, 1); assert.equal(clears, 1);
  trip.status = 'completed'; await worker.deliverTripNotices('trip'); assert.equal(deliveries, 1);
});
