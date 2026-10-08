const Trip = require('../models/Trip');
const Notification = require('../models/ParentNotification');
const Parent = require('../models/Parent');
const { withLock } = require('./operationLock');
const { distance } = require('./routeGeometry');
const service = require('./tripService');
const progress = require('./tripProgress');
const automation = require('./tripAutomation');
const { notifyDriver } = require('./driverTripNotifications');
const { notifyBus } = require('./routeNotifications');
const sendNotification = require('../utils/sendNotification');

// Persisted on the trip/inbox: no process-local task is the only copy of work.
// Google runs outside the bus lock; commit rechecks the trip and stop sequence.
const routeFields = ['completedPolyline', 'routePolyline', 'plannedPolyline', 'routeDistanceMeters', 'routeDurationSeconds', 'routeLegs', 'routeStartStopIndex', 'routeProgressMeters', 'routePointIndex', 'routeCalculatedAt', 'lastRouteAttemptAt', 'lastReroutedAt', 'routeState', 'offRoute', 'deviationCount'];
const stopKey = trip => JSON.stringify([trip.nextStopIndex, trip.stopSnapshots.map(stop => stop.status)]);
async function prepareRoute(tripId, io) {
  const snapshot = await Trip.findById(tripId);
  if (!snapshot || snapshot.status !== 'active' || !snapshot.routeWorkPending) return;
  const key = stopKey(snapshot);
  const origin = { lat: snapshot.currentLocation.lat, lng: snapshot.currentLocation.lng };
  let failed = false;
  try { await service.calculate(snapshot); } catch { failed = true; }
  return withLock(`trip:${snapshot.busId}`, async () => {
    const current = await Trip.findById(tripId);
    if (!current || current.status !== 'active' || !current.routeWorkPending) return;
    if (snapshot.routeWorkVersion !== current.routeWorkVersion || key !== stopKey(current)) return;
    // Movement along the returned road is safe: reproject using current GPS.
    // A bus that has moved away from that road needs a new calculation.
    if (!failed && distance(origin, current.currentLocation) > 100) {
      const candidate = { ...(snapshot.toObject ? snapshot.toObject() : snapshot), currentLocation: current.currentLocation };
      const projection = progress.locateOnRoute(candidate);
      if (!projection || projection.distance > 80) return;
    }
    if (failed) {
      current.routeState = current.routePolyline ? 'cached' : 'unavailable';
      current.lastRouteAttemptAt = new Date();
    } else {
      for (const field of routeFields) current[field] = snapshot[field];
      progress.updateProgress(current, Date.now(), false);
    }
    current.routeWorkPending = false;
    await current.save();
    await service.emitTrip(current, io);
    return current;
  });
}
async function publishCurrentTrip(trip, io, reconcile = false) {
  await withLock(`trip:${trip.busId}`, async () => {
    const active = await Trip.findOne({ busId: trip.busId, running: true });
    if (active && String(active._id) !== String(trip._id)) return;
    const current = await Trip.findById(trip._id);
    if (!current) return;
    if (reconcile) await service.syncState(current);
    await service.emitTrip(current, io);
  });
}
async function deliverTripNotices(tripId, io) {
  const trip = await Trip.findById(tripId);
  if (!trip) return;
  if (trip.startNoticePending) {
    await publishCurrentTrip(trip, io);
    await notifyBus(trip.busId, `trip:${trip._id}:start`, 'TRIP_STARTED', trip.mode === 'route' ? `Bus has started ${trip.direction === 'TO_SCHOOL' ? 'morning pickup' : 'return drop-off'}.` : 'Bus has started live tracking. Pickup ETAs are unavailable for this trip.', io, { tripId: String(trip._id) });
    await withLock(`trip:${trip.busId}`, () => Trip.updateOne({ _id: tripId }, { $set: { startNoticePending: false } }));
  }
  if (trip.endNoticePending) {
    await publishCurrentTrip(trip, io, true);
    await service.deliverEndNotices(trip, io);
    await withLock(`trip:${trip.busId}`, () => Trip.updateOne({ _id: tripId }, { $set: { endNoticePending: false } }));
  }
  if (trip.finishNoticePending) {
    const current = await Trip.findById(tripId);
    const reminder = current?.status === 'active' ? automation.reminderView(current) : null;
    const snoozed = current?.finishSnoozedUntil && +new Date(current.finishSnoozedUntil) > Date.now();
    if (current?.finishNoticePending && reminder && !snoozed) await notifyDriver(current, reminder.message, io, { throwOnError: true });
    await withLock(`trip:${trip.busId}`, () => Trip.updateOne({ _id: tripId, finishReminderAt: current?.finishReminderAt }, { $set: { finishNoticePending: false } }));
  }

}
async function deliverPush(notification) {
  const parent = await Parent.findById(notification.parentId).select('fcmToken').lean();
  if (parent?.fcmToken) await sendNotification(parent.fcmToken, notification.title, notification.message, { ...notification.data, type: notification.type, eventId: notification.eventKey }, { throwOnError: true });
  await Notification.updateOne({ _id: notification._id }, { $set: { pushPending: false }, $unset: { pushRetryAt: 1 } });
}
function startTripWorkQueue(io) {
  let stopped = false, noticesRunning = false, routesRunning = false, pushesRunning = false;
  const report = error => { if (error.status !== 423) console.error('Trip background work failed', { name: error.name, code: error.code }); };
  const notices = async () => {
    if (stopped || noticesRunning) return;
    noticesRunning = true;
    try {
      const trips = await Trip.find({ $or: [{ startNoticePending: true }, { endNoticePending: true }, { finishNoticePending: true }] }).select('_id').limit(100).lean();
      for (const trip of trips) { if (stopped) break; try { await deliverTripNotices(trip._id, io); } catch (error) { report(error); } }
    } catch (error) { report(error); } finally { noticesRunning = false; }
  };
  const routes = async () => {
    if (stopped || routesRunning) return;
    routesRunning = true;
    try {
      const trips = await Trip.find({ status: 'active', routeWorkPending: true }).select('_id').limit(100).lean();
      // Small concurrency cap prevents one slow Google request blocking every bus.
      for (let i = 0; i < trips.length && !stopped; i += 4) await Promise.all(trips.slice(i, i + 4).map(trip => prepareRoute(trip._id, io).catch(report)));
    } catch (error) { report(error); } finally { routesRunning = false; }
  };
  const pushes = async () => {
    if (stopped || pushesRunning) return;
    pushesRunning = true;
    try {
      // Atomic lease supports multiple backend instances and restart recovery.
      for (let i = 0; i < 50 && !stopped; i++) {
        const now = new Date();
        const notification = await Notification.findOneAndUpdate({ pushPending: true, $or: [{ pushRetryAt: null }, { pushRetryAt: { $lte: now } }] }, { $set: { pushRetryAt: new Date(+now + 60000) } }, { new: true });
        if (!notification) break;
        try { await deliverPush(notification); } catch (error) { report(error); }
      }
    } catch (error) { report(error); } finally { pushesRunning = false; }
  };
  const run = () => { notices(); routes(); pushes(); };
  const timer = setInterval(run, 500); timer.unref(); run();
  return () => { stopped = true; clearInterval(timer); };
}
module.exports = { startTripWorkQueue, prepareRoute, deliverTripNotices, deliverPush };
