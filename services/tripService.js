const Driver = require('../models/Driver');
const Bus = require('../models/Bus');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Trip = require('../models/Trip');
const { assert, id, coordinates, text, isRiding } = require('./routeValidation');
const planning = require('./routePlanning');
const { withLock } = require('./operationLock');
const { computeRoute } = require('./googleRoutes');
const { encode, decode, stitch } = require('./routeGeometry');
const progress = require('./tripProgress');
const { notifyParent, notifyBus, busParents } = require('./routeNotifications');
async function assigned(driverId) {
  const driver = await Driver.findById(driverId);
  assert(driver, 'Driver not found', 404);
  const bus = await Bus.findOne({ _id: driver.busId, driverId, schoolId: driver.schoolId });
  assert(bus, 'No bus is assigned to you. Contact the school.', 409); return { driver, bus };
}
async function currentSnapshot(plan, direction, bus) {
  const ordered = direction === 'FROM_SCHOOL' ? plan.returnSnapshots : plan.morningSnapshots;
  const students = await Student.find({ schoolId: bus.schoolId, busId: bus._id }).lean();
  const now = new Date();
  const snapshots = [];
  for (const original of ordered) {
    const stop = original.toObject ? original.toObject() : structuredClone(original);
    if (stop.expiresAt && new Date(stop.expiresAt) <= now) continue;
    const members = stop.studentIds.filter(sid => students.some(s => id(s._id) === id(sid) && isRiding(s, now)));
    if (!members.length) continue;
    snapshots.push({ ...stop, sequence: snapshots.length, status: 'pending', studentIds: members, students: stop.students.filter(s => members.some(sid => id(sid) === id(s.id))), parentIds: await planning.parentIdsFor(members) });
  }
  return snapshots;
}
async function readiness(driverId) {
  const { bus } = await assigned(driverId);
  const plan = await planning.publishedPlan(bus._id);
  const active = await Trip.findOne({ driverId, running: true });
  if (!plan) return { ready: false, warning: 'The school has not published an effective route.', bus: { id: bus._id, busNumber: bus.busNumber }, activeTripId: active?._id, directions: {} };
  const directions = {};
  for (const direction of ['TO_SCHOOL', 'FROM_SCHOOL']) {
    const stops = await currentSnapshot(plan, direction, bus);
    const preview = direction === 'TO_SCHOOL' ? plan.morningPreview : plan.returnPreview;
    directions[direction] = { stopCount: stops.length, routePolyline: preview?.routePolyline, distanceMeters: preview?.routeDistanceMeters, durationSeconds: preview?.routeDurationSeconds, stops: stops.map(s => ({ name: s.name, location: s.location })), ready: stops.length > 0 };
  }
  return { ready: Object.values(directions).every(d => d.ready), bus: { id: bus._id, busNumber: bus.busNumber }, version: plan.version, effectiveFrom: plan.effectiveFrom, schoolLocation: plan.schoolLocationSnapshot, directions, activeTripId: active?._id, warning: plan.unresolvedStudents.length ? `${plan.unresolvedStudents.length} students have arrangements outside this route. Preview estimates use the school as the starting point.` : 'Preview estimates use the school as the starting point. The trip route uses your current position.' };
}
async function calculate(trip, now = new Date()) {
  trip.lastRouteAttemptAt = now;
  const remaining = trip.stopSnapshots.slice(trip.nextStopIndex);
  const points = [trip.currentLocation, ...remaining.map(s => s.location)];
  if (trip.direction === 'TO_SCHOOL') points.push(trip.schoolLocationSnapshot);
  if (points.length < 2) return;
  const previous = trip.routePolyline ? progress.displayedRoad(trip).completedPolyline : '';
  const result = await computeRoute(points);
  trip.completedPolyline = previous.length < 500000 ? previous : encode(decode(previous).slice(-20000));
  trip.routePolyline = result.routePolyline;
  if (!trip.plannedPolyline) trip.plannedPolyline = result.routePolyline;
  trip.routeDistanceMeters = result.routeDistanceMeters; trip.routeDurationSeconds = result.routeDurationSeconds;
  trip.routeLegs = result.legs.map((l, i) => ({ ...l, stopIndex: trip.nextStopIndex + i }));
  trip.routeStartStopIndex = trip.nextStopIndex; trip.routeProgressMeters = 0; trip.routePointIndex = 0;
  trip.routeCalculatedAt = now; trip.routeState = 'ready';
  if (trip.offRoute) trip.lastReroutedAt = now;
  trip.offRoute = false; trip.deviationCount = 0;
}
async function start(driverId, input = {}, io) {
  const { bus } = await assigned(driverId);
  return withLock(`trip:${bus._id}`, async () => {
    const existing = await Trip.findOne({ busId: bus._id, running: true });
    if (existing?.status === 'active') { assert(id(existing.driverId) === id(driverId), 'Another driver has an active trip for this bus.', 409); await syncState(existing); return { trip: driverView(existing), resumed: true }; }
    await assigned(driverId);
    if (existing) { existing.status = 'cancelled'; existing.running = false; existing.endedAt = new Date(); existing.endReason = 'Interrupted preparation recovered'; await existing.save(); }
    const legacy = !input.direction && process.env.ALLOW_LEGACY_TRIPS !== 'false';
    const direction = input.direction || (legacy ? 'TO_SCHOOL' : null);
    assert(['TO_SCHOOL', 'FROM_SCHOOL'].includes(direction), 'Choose morning pickup or return drop-off');
    const mode = input.emergency === true ? 'emergency' : legacy ? 'legacy' : 'route';
    if (mode === 'emergency') assert(text(input.fallbackReason).length >= 5, 'Give a reason for starting without a route');
    const plan = await planning.publishedPlan(bus._id);
    if (mode === 'route') assert(plan, 'The school must publish a valid route before this trip can start.', 409);
    const stops = mode === 'route' ? await currentSnapshot(plan, direction, bus) : [];
    if (mode === 'route') assert(stops.length, 'No active stops are available for this route.', 409);
    const location = input.location ? coordinates(input.location) : null;
    if (mode === 'route') assert(location, 'Wait for your current GPS location before starting');
    const trip = await Trip.create({ schoolId: bus.schoolId, busId: bus._id, driverId, routePlanId: mode === 'route' ? plan._id : null, routePlanVersion: mode === 'route' ? plan.version : null, direction, mode, fallbackReason: mode === 'legacy' ? 'Compatibility with an earlier app version' : text(input.fallbackReason), stopSnapshots: stops, schoolLocationSnapshot: plan?.schoolLocationSnapshot, currentLocation: location || undefined });
    try { if (mode === 'route') await calculate(trip); }
    catch (error) { trip.status = 'cancelled'; trip.running = false; trip.endedAt = new Date(); await trip.save(); throw error; }
    trip.status = 'active'; trip.startedAt = new Date();
    if (location) { trip.lastLocationUpdatedAt = new Date(); trip.displayLocation = location; }
    await trip.save();
    await syncState(trip);
    await emitTrip(trip, io);
    await notifyBus(bus._id, `trip:${trip._id}:start`, 'TRIP_STARTED', mode === 'route' ? `Bus has started ${direction === 'TO_SCHOOL' ? 'morning pickup' : 'return drop-off'}.` : 'Bus has started live tracking. Pickup ETAs are unavailable for this trip.', io, { tripId: id(trip._id) });
    return { trip: driverView(trip), driver: { isOnTrip: true }, bus: { tripStatus: 'started' } };
  });
}
async function syncState(trip) {
  const active = trip.status === 'active';
  await Driver.updateOne({ _id: trip.driverId }, { $set: { isOnTrip: active, ...(trip.currentLocation ? { lastLocation: trip.currentLocation, lastLocationUpdatedAt: trip.lastLocationUpdatedAt } : {}) } });
  await Bus.updateOne({ _id: trip.busId }, { $set: { tripStatus: active ? 'started' : 'ended', tripStartedAt: trip.startedAt, tripEndedAt: trip.endedAt || null, ...(trip.currentLocation ? { currentLocation: trip.currentLocation, lastLocationUpdatedAt: trip.lastLocationUpdatedAt } : {}) } });
}
function commonView(trip) {
  const eta = progress.estimates(trip);
  return { id: id(trip._id), busId: id(trip.busId), direction: trip.direction, status: trip.status, mode: trip.mode, routePlanVersion: trip.routePlanVersion, currentLocation: trip.displayLocation || trip.currentLocation || null, lastLocationUpdatedAt: trip.lastLocationUpdatedAt, routeState: trip.routeState, offRoute: trip.offRoute, startedAt: trip.startedAt, endedAt: trip.endedAt, schoolLocation: trip.schoolLocationSnapshot, ...progress.displayedRoad(trip), remainingStopCount: Math.max(0, trip.stopSnapshots.length - trip.nextStopIndex), totalStopCount: trip.stopSnapshots.length, terminalEta: eta.terminal, stale: eta.stale };
}
function driverView(trip) {
  const eta = progress.estimates(trip);
  return { ...commonView(trip), plannedPolyline: trip.plannedPolyline, nextStopIndex: trip.nextStopIndex, nextStop: trip.stopSnapshots[trip.nextStopIndex] || null, nextStopEta: eta.stops[0] || null, stops: trip.stopSnapshots, driverId: id(trip.driverId) };
}
function parentView(trip, studentId, now = Date.now()) {
  const view = commonView(trip);
  const index = trip.stopSnapshots.findIndex(s => s.studentIds.some(v => id(v) === id(studentId)));
  const stop = trip.stopSnapshots[index];
  const eta = progress.estimates(trip, now);
  const estimate = eta.stops.find(e => e.stopIndex === index);
  return { ...view, studentId: id(studentId), personal: stop ? { approvedStop: { name: stop.name, location: stop.location }, status: stop.status, estimatedArrival: estimate ? new Date(now + estimate.seconds * 1000) : null, distanceMeters: estimate?.distanceMeters ?? null, stopsBeforeYours: index >= trip.nextStopIndex && estimate ? Math.max(0, index - trip.nextStopIndex) : null, skipReason: stop.status === 'skipped' ? stop.skipReason : null } : null };
}
async function emitTrip(trip, io) {
  if (!io) return;
  const view = commonView(trip);
  // Parents get common events through their authenticated individual room. This
  // re-evaluates Student.busId on every update and revokes old-bus data immediately.
  const parents = await busParents(trip.busId);
  const rooms = [`school_${trip.schoolId}`, `driver_${trip.driverId}`, ...parents.map(p => `parent_${p._id}`)];
  const common = io.to(rooms);
  common.emit('trip-update', view);
  common.emit('tripStatus', { busId: id(trip.busId), tripId: id(trip._id), status: trip.status === 'active' ? 'started' : 'ended', at: Date.now() });
  if (trip.currentLocation && trip.status === 'active') common.emit('location-update', { busId: id(trip.busId), tripId: id(trip._id), lat: view.currentLocation.lat, lng: view.currentLocation.lng, lastLocationUpdatedAt: trip.lastLocationUpdatedAt });
  const students = await Student.find({ busId: trip.busId }).select('_id').lean();
  for (const p of parents) for (const sid of p.children) if (students.some(s => id(s._id) === id(sid))) io.to(`parent_${p._id}`).emit('parent-trip', parentView(trip, sid));
  io.to(`school_${trip.schoolId}`).to(`driver_${trip.driverId}`).emit('trip-detail', driverView(trip));
}
async function personalAlerts(trip, io) {
  const eta = progress.estimates(trip);
  for (let index = 0; index < trip.stopSnapshots.length; index++) {
    const stop = trip.stopSnapshots[index];
    const estimate = eta.stops.find(e => e.stopIndex === index);
    const arrived = ['arrived', 'completed'].includes(stop.status) && stop.actualArrival;
    const soon = !arrived && estimate && estimate.seconds > 0 && estimate.seconds <= 300 && stop.status !== 'skipped';
    if (!arrived && !soon) continue;
    const eligible = await Student.find({ _id: { $in: stop.studentIds }, busId: trip.busId, schoolId: trip.schoolId }).select('_id').lean();
    const parents = await Parent.find({ children: { $in: eligible.map(s => s._id) } }).select('_id').lean();
    for (const p of parents) await notifyParent(p._id, `trip:${trip._id}:stop:${index}:${arrived ? 'arrived' : 'eta'}`, arrived ? 'ARRIVED' : 'ETA_5_MIN', arrived ? 'Bus has arrived at your approved stop.' : 'Bus is expected at your approved stop in about 5 minutes.', io, { busId: id(trip.busId), tripId: id(trip._id) });
  }
}
async function location(driverId, input, io) {
  const { bus } = await assigned(driverId);
  return withLock(`trip:${bus._id}`, async () => {
    let trip = await Trip.findOne({ busId: bus._id, driverId, status: 'active' });
    // Preserve a trip already running when the compatible backend is deployed.
    if (!trip && bus.tripStatus === 'started' && process.env.ALLOW_LEGACY_TRIPS !== 'false') trip = await Trip.create({ schoolId: bus.schoolId, busId: bus._id, driverId, direction: 'TO_SCHOOL', mode: 'legacy', fallbackReason: 'Recovered pre-upgrade trip', status: 'active', startedAt: bus.tripStartedAt || new Date() });
    assert(trip, 'Start a trip before sending location.', 409);
    const gps = progress.validateLocation(input, trip);
    if (gps.ignored) return { accepted: false, reason: gps.ignored };
    trip.currentLocation = { lat: gps.lat, lng: gps.lng }; trip.lastDeviceTimestamp = gps.deviceTimestamp;
    trip.lastLocationUpdatedAt = new Date(); trip.accuracy = gps.accuracy; trip.speed = gps.speed; trip.heading = gps.heading;
    const { event } = progress.updateProgress(trip);
    if (progress.shouldRefresh(trip, Date.now(), event?.type === 'completed')) {
      trip.routeState = 'rerouting'; await trip.save(); await emitTrip(trip, io);
      try { await calculate(trip); }
      catch { trip.routeState = trip.routePolyline ? 'cached' : 'unavailable'; }
    }
    const eta = progress.estimates(trip);
    for (const stop of trip.stopSnapshots) stop.estimatedArrival = null;
    for (const e of eta.stops) trip.stopSnapshots[e.stopIndex].estimatedArrival = new Date(Date.now() + e.seconds * 1000);
    trip.terminalEta = eta.terminal;
    await trip.save(); await syncState(trip); await emitTrip(trip, io); await personalAlerts(trip, io);
    if (trip.offRoute || eta.routeOld) await notifyBus(bus._id, `trip:${trip._id}:delay`, 'ROUTE_DELAY', 'The bus route is being updated. Arrival estimates may be delayed.', io, { tripId: id(trip._id) });
    return { accepted: true, busId: id(bus._id), currentLocation: trip.currentLocation, lastLocationUpdatedAt: trip.lastLocationUpdatedAt };
  });
}
async function end(driverId, body, io) {
  const { bus } = await assigned(driverId);
  return withLock(`trip:${bus._id}`, async () => {
    const trip = await Trip.findOne({ driverId, busId: bus._id, status: 'active' });
    if (!trip) { await Driver.updateOne({ _id: driverId }, { isOnTrip: false }); await Bus.updateOne({ _id: bus._id }, { tripStatus: 'ended' }); return { ended: true }; }
    const remaining = trip.stopSnapshots.slice(trip.nextStopIndex);
    if (trip.mode === 'route' && remaining.length) assert(body.confirmIncomplete === true && text(body.reason).length >= 5, 'Stops remain. Confirm ending early and provide a reason.', 409);
    for (const stop of remaining) { stop.status = 'skipped'; stop.skipReason = text(body.reason) || 'Trip ended'; stop.completedAt = new Date(); }
    trip.status = 'completed'; trip.running = false; trip.endedAt = new Date(); trip.endReason = text(body.reason); trip.nextStopIndex = trip.stopSnapshots.length;
    await trip.save(); await syncState(trip); await emitTrip(trip, io);
    await notifyBus(bus._id, `trip:${trip._id}:end`, 'TRIP_ENDED', 'Bus trip has ended.', io, { tripId: id(trip._id) }); return { ended: true, trip: driverView(trip) };
  });
}
async function skip(driverId, tripId, body, io) {
  const { bus } = await assigned(driverId);
  return withLock(`trip:${bus._id}`, async () => {
    const trip = await Trip.findOne({ _id: tripId, busId: bus._id, driverId, status: 'active' });
    assert(trip, 'Active trip not found', 404); assert(text(body.reason).length >= 3, 'Enter a reason for skipping this stop');
    const stop = trip.stopSnapshots[trip.nextStopIndex]; assert(stop, 'No remaining stop');
    assert(body.stopIndex === trip.nextStopIndex, 'The next stop changed. Refresh before skipping.', 409);
    stop.status = 'skipped'; stop.skipReason = text(body.reason); stop.completedAt = new Date(); trip.nextStopIndex += 1;
    // Progress and ETA must exclude a skipped waypoint immediately, even during cooldown.
    trip.completedPolyline = progress.displayedRoad(trip).completedPolyline;
    trip.routeLegs = []; trip.routePolyline = ''; trip.routeState = 'unavailable';
    try { await calculate(trip); } catch { trip.routeState = 'unavailable'; }
    await trip.save(); await emitTrip(trip, io); return driverView(trip);
  });
}
module.exports = { assigned, readiness, start, end, skip, location, commonView, driverView, parentView, emitTrip, currentSnapshot, calculate };
