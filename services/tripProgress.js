const { assert, coordinates } = require('./routeValidation');
const { distance, decode, encode, stitch, project } = require('./routeGeometry');
const refreshSeconds = () => Math.max(120, Number(process.env.ROUTE_REFRESH_SECONDS) || 150);
const dwellSeconds = () => Math.max(12, Number(process.env.STOP_DWELL_SECONDS) || 20);
function validateLocation(input, trip, now = Date.now()) {
  const location = coordinates(input);
  const number = (value, min, max, name) => {
    if (value == null) return null;
    assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `Invalid GPS ${name}`); return value;
  };
  const accuracy = number(input.accuracy, 0, 10000, 'accuracy');
  const speed = number(input.speed === -1 ? null : input.speed, 0, 80, 'speed');
  const heading = number(input.heading === -1 ? null : input.heading, 0, 360, 'heading');
  const deviceTimestamp = input.deviceTimestamp == null ? now : typeof input.deviceTimestamp === 'number' ? input.deviceTimestamp : Date.parse(input.deviceTimestamp);
  assert(Number.isFinite(deviceTimestamp), 'Invalid GPS timestamp');
  if (accuracy > 80) return { ignored: 'weak_accuracy' };
  if (deviceTimestamp > now + 30000 || deviceTimestamp < now - 120000) return { ignored: 'stale_timestamp' };
  const previousTime = trip.lastDeviceTimestamp ? +new Date(trip.lastDeviceTimestamp) : 0;
  if (previousTime && deviceTimestamp <= previousTime) return { ignored: 'out_of_order' };
  if (previousTime && deviceTimestamp - previousTime < 1500) return { ignored: 'duplicate_update' };
  if (trip.currentLocation && previousTime) {
    const elapsed = (deviceTimestamp - previousTime) / 1000;
    const moved = distance(trip.currentLocation, location);
    if (elapsed < 30 && moved > 100 && moved / elapsed > 45) return { ignored: 'impossible_jump' };
  }
  return { ...location, accuracy, speed, heading, deviceTimestamp: new Date(deviceTimestamp) };
}
function locateOnRoute(trip) {
  const offset = trip.nextStopIndex - trip.routeStartStopIndex;
  const leg = trip.routeLegs?.[offset];
  if (!leg) return null;
  const preceding = trip.routeLegs.slice(0, offset).reduce((n, l) => n + l.distanceMeters, 0);
  const line = decode(leg.encodedPolyline);
  const lastAlong = Math.max(0, trip.routeProgressMeters - preceding);
  const total = line.slice(1).reduce((n, p, i) => n + distance(line[i], p), 0);
  const lowerBound = Math.max(0, lastAlong * (total / (leg.distanceMeters || 1)) - 50);
  const projection = project(trip.currentLocation, line, lowerBound);
  if (!projection) return null;
  const completedBefore = stitch(trip.routeLegs.slice(0, offset).map(l => decode(l.encodedPolyline)));
  return { ...projection, routeMeters: preceding + projection.along / (projection.total || 1) * leg.distanceMeters, legFraction: Math.min(1, projection.along / (projection.total || 1)), completedPoints: stitch([completedBefore, line.slice(0, projection.index + 1), [projection.position]]) };
}
function advanceStop(trip, now = Date.now()) {
  const stop = trip.stopSnapshots[trip.nextStopIndex];
  if (!stop) return null;
  const close = distance(trip.currentLocation, stop.location) <= stop.geofenceRadiusMeters;
  const slow = trip.speed == null || trip.speed <= 3;
  if (stop.status === 'arrived') {
    if (!close || now - +new Date(stop.actualArrival) >= dwellSeconds() * 1000) {
      stop.status = 'completed'; stop.completedAt = new Date(now); trip.nextStopIndex += 1;
      return { type: 'completed', stop };
    }
    return null;
  }
  if (close && slow) {
    stop.insideCount = (stop.insideCount || 0) + 1;
    if (!stop.insideSince) stop.insideSince = new Date(now);
    const dwell = now - +new Date(stop.insideSince);
    if (stop.insideCount >= 3 && dwell >= (trip.speed == null ? 12000 : 6000)) {
      stop.status = 'arrived'; stop.actualArrival = new Date(now);
      return { type: 'arrived', stop };
    }
    stop.status = 'approaching';
  } else { stop.insideCount = 0; stop.insideSince = null; if (stop.status === 'approaching') stop.status = 'pending'; }
  return null;
}
function updateProgress(trip, now = Date.now()) {
  const projection = trip.mode === 'route' ? locateOnRoute(trip) : null;
  if (projection) {
    const off = projection.distance > Math.max(80, (trip.accuracy || 0) * 1.5);
    trip.deviationCount = off ? (trip.deviationCount || 0) + 1 : 0;
    trip.offRoute = trip.deviationCount >= 3;
    trip.displayLocation = projection.distance <= 40 ? projection.position : trip.currentLocation;
    if (!off) trip.routeProgressMeters = Math.max(trip.routeProgressMeters || 0, projection.routeMeters);
    trip.routePointIndex = projection.index;
  } else trip.displayLocation = trip.currentLocation;
  const event = advanceStop(trip, now);
  return { projection, event };
}
function shouldRefresh(trip, now = Date.now(), stopChanged = false) {
  if (trip.mode !== 'route' || (trip.direction === 'FROM_SCHOOL' && trip.nextStopIndex >= trip.stopSnapshots.length)) return false;
  const lastAttempt = trip.lastRouteAttemptAt ? +new Date(trip.lastRouteAttemptAt) : 0;
  if (now - lastAttempt < 45000) return false;
  return !trip.routeLegs?.length || !trip.routeCalculatedAt || now - +new Date(trip.routeCalculatedAt) >= refreshSeconds() * 1000 || trip.offRoute || stopChanged;
}
function estimates(trip, now = Date.now()) {
  const stale = !trip.lastLocationUpdatedAt || now - +new Date(trip.lastLocationUpdatedAt) > 30000;
  const routeOld = !trip.routeCalculatedAt || now - +new Date(trip.routeCalculatedAt) > 600000;
  const estimates = [];
  if (trip.mode !== 'route' || !trip.routeLegs?.length || stale || routeOld || trip.offRoute) return { stops: estimates, terminal: null, stale, routeOld };
  const offset = trip.nextStopIndex - trip.routeStartStopIndex;
  const coveredBefore = trip.routeLegs.slice(0, offset).reduce((n, l) => n + l.distanceMeters, 0);
  const leg = trip.routeLegs[offset];
  const fraction = leg ? Math.max(0, Math.min(1, (trip.routeProgressMeters - coveredBefore) / (leg.distanceMeters || 1))) : 1;
  let seconds = 0, metres = 0;
  const sinceGps = trip.speed > 1 ? Math.min(15, Math.max(0, (now - +new Date(trip.lastLocationUpdatedAt)) / 1000)) : 0;
  for (let i = offset; i < trip.routeLegs.length; i++) {
    const l = trip.routeLegs[i];
    const factor = i === offset ? 1 - fraction : 1;
    seconds += l.durationSeconds * factor; metres += l.distanceMeters * factor;
    const stop = trip.stopSnapshots[l.stopIndex];
    if (stop && l.stopIndex >= trip.nextStopIndex) {
      estimates.push({ stopIndex: l.stopIndex, seconds: stop.status === 'arrived' ? 0 : Math.max(0, seconds - sinceGps), distanceMeters: Math.round(metres) });
      seconds += dwellSeconds();
    }
  }
  return { stops: estimates, terminal: new Date(now + Math.max(0, seconds - sinceGps) * 1000), stale, routeOld };
}
function displayedRoad(trip) {
  if (trip.direction === 'FROM_SCHOOL' && trip.nextStopIndex >= trip.stopSnapshots.length) return { remainingPolyline: '', completedPolyline: encode(stitch([decode(trip.completedPolyline || ''), decode(trip.routePolyline || '')])) };
  const projection = trip.currentLocation ? locateOnRoute(trip) : null;
  const offset = trip.nextStopIndex - trip.routeStartStopIndex;
  const leg = trip.routeLegs?.[offset];
  const remaining = projection && leg ? stitch([[projection.position], decode(leg.encodedPolyline).slice(projection.index + 1), ...trip.routeLegs.slice(offset + 1).map(l => decode(l.encodedPolyline))]) : decode(trip.routePolyline || '');
  const completed = stitch([decode(trip.completedPolyline || ''), projection?.completedPoints || []]);
  return { remainingPolyline: encode(remaining), completedPolyline: encode(completed) };
}
module.exports = { validateLocation, locateOnRoute, advanceStop, updateProgress, shouldRefresh, estimates, displayedRoad, dwellSeconds };
