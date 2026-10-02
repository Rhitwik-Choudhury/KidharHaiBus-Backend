const { distance, decode, encode, project, stitch } = require('./routeGeometry');
const resolved = stop => ['completed', 'skipped'].includes(stop.status);
const fresh = (trip, now) => trip.lastDeviceTimestamp && now - +new Date(trip.lastDeviceTimestamp) <= 15000 && now >= +new Date(trip.lastDeviceTimestamp) - 1000 && trip.accuracy != null && trip.accuracy <= 35;
function advanceCursor(trip) {
  while (trip.stopSnapshots[trip.nextStopIndex] && resolved(trip.stopSnapshots[trip.nextStopIndex])) trip.nextStopIndex++;
}
function clearPassage(stop) {
  stop.autoSkipAt = null; stop.awayCount = 0; stop.lastPassageDistance = null;
}
function pastStop(trip, stop) {
  const radius = stop.geofenceRadiusMeters || 65;
  if (distance(trip.currentLocation, stop.location) <= radius + Math.max(20, trip.accuracy || 0)) return false;
  if (stop.autoSkipAt && distance(trip.currentLocation, stop.location) >= (stop.lastPassageDistance || 0) - 5) return true;
  const line = decode(stop.passageLine || '');
  if (line.length > 1) {
    const projection = project(trip.currentLocation, line);
    if (projection && projection.distance <= Math.max(15, trip.accuracy || 0) && projection.along > radius + 20) return true;
    // Short outgoing legs may end before two outside samples arrive. Permit a
    // short, straight continuation beyond that endpoint only, not a turn.
    const end = line.at(-1), before = line.at(-2), scale = Math.cos(end.lat * Math.PI / 180);
    const ax = (end.lng - before.lng) * scale, ay = end.lat - before.lat;
    const bx = (trip.currentLocation.lng - end.lng) * scale, by = trip.currentLocation.lat - end.lat;
    const dot = ax * bx + ay * by, norm = Math.hypot(ax, ay) * Math.hypot(bx, by);
    const cosine = dot / (norm || 1), extended = distance(end, trip.currentLocation);
    return projection?.along > radius + 20 && dot > 0 && cosine > 0.9 && extended < 200 && extended * Math.sqrt(Math.max(0, 1 - cosine * cosine)) <= Math.max(15, trip.accuracy || 0);
  }
  // The final return stop has no outgoing leg. Require continued travel
  // through the stop in the observed approach direction, rather than a U-turn.
  const entry = stop.passageEntry;
  if (!entry || distance(entry, stop.location) < 15) return false;
  const scale = Math.cos(stop.location.lat * Math.PI / 180);
  const ax = (stop.location.lng - entry.lng) * scale, ay = stop.location.lat - entry.lat;
  const bx = (trip.currentLocation.lng - stop.location.lng) * scale, by = trip.currentLocation.lat - stop.location.lat;
  const cosine = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  return cosine > 0.6;
}
function observePassage(trip, previous, now = Date.now()) {
  if (trip.mode !== 'route' || !fresh(trip, now)) return;
  const previousTime = previous?.time ? +new Date(previous.time) : 0;
  const continuous = previous?.location && previousTime && +new Date(trip.lastDeviceTimestamp) - previousTime <= 15000;
  if (!continuous) {
    for (const stop of trip.stopSnapshots) if (!resolved(stop)) { clearPassage(stop); stop.nearSeenAt = null; }
    return;
  }
  for (let index = trip.nextStopIndex; index < trip.stopSnapshots.length; index++) {
    const stop = trip.stopSnapshots[index];
    if (resolved(stop) || stop.status === 'arrived') { clearPassage(stop); continue; }
    const d = distance(trip.currentLocation, stop.location), radius = stop.geofenceRadiusMeters || 65;
    const incoming = trip.routeLegs?.find(leg => leg.stopIndex === index);
    const incomingProjection = incoming ? project(trip.currentLocation, decode(incoming.encodedPolyline)) : null;
    const previousDistance = distance(previous.location, stop.location);
    const segment = project(stop.location, [previous.location, trip.currentLocation]);
    const crossed = segment && segment.distance <= Math.max(15, radius - trip.accuracy) && segment.along > 0 && segment.along < segment.total;
    const previousProjection = incoming ? project(previous.location, decode(incoming.encodedPolyline)) : null;
    // Arm only after observing a visit on the expected road. A new trip that
    // starts beyond a stop, weak GPS, or a nearby parallel road cannot arm it.
    const onRoad = incomingProjection && incomingProjection.distance <= Math.max(15, trip.accuracy);
    const crossedFromRoad = crossed && previousProjection && previousProjection.distance <= Math.max(15, trip.accuracy);
    if (!stop.nearSeenAt && ((onRoad && d <= radius - trip.accuracy) || crossedFromRoad)) {
      stop.nearSeenAt = new Date(now);
      stop.passageEntry = previousDistance >= 15 ? previous.location : decode(incoming.encodedPolyline).slice(-2)[0];
      const points = stitch((trip.routeLegs || []).filter(leg => leg.stopIndex > index).map(leg => decode(leg.encodedPolyline)));
      let covered = 0, end = 1;
      while (end < points.length && covered < 1500) { covered += distance(points[end - 1], points[end]); end++; }
      stop.passageLine = encode(points.slice(0, end));
    }
    if (!stop.nearSeenAt) continue;
    if (d <= radius) { clearPassage(stop); continue; }
    if (now - +new Date(stop.nearSeenAt) > 120000 && !stop.autoSkipAt) { stop.nearSeenAt = null; clearPassage(stop); continue; }
    if (!pastStop(trip, stop)) { clearPassage(stop); continue; }
    if (d > (stop.lastPassageDistance ?? previousDistance) + 2) stop.awayCount = (stop.awayCount || 0) + 1;
    else if (d < (stop.lastPassageDistance ?? previousDistance) - 5) clearPassage(stop);
    stop.lastPassageDistance = d;
    if (stop.awayCount >= 2 && !stop.autoSkipAt) stop.autoSkipAt = new Date(now + 10000);
  }
}
function finalizeSkips(trip, now = Date.now()) {
  if (!fresh(trip, now)) return [];
  const skipped = [];
  for (let index = trip.nextStopIndex; index < trip.stopSnapshots.length; index++) {
    const stop = trip.stopSnapshots[index];
    if (resolved(stop) || stop.status === 'arrived' || !stop.autoSkipAt || +new Date(stop.autoSkipAt) > now) continue;
    if (!pastStop(trip, stop)) { clearPassage(stop); continue; }
    stop.status = 'skipped'; stop.skippedAt = new Date(now); stop.completedAt = new Date(now);
    stop.skipSource = 'automatic'; stop.skipReason = 'Automatically skipped — bus passed; stop service not confirmed';
    clearPassage(stop); skipped.push({ index, stop });
  }
  advanceCursor(trip); return skipped;
}
function observeFinish(trip, previous, now = Date.now()) {
  const allResolved = trip.stopSnapshots.length > 0 && trip.stopSnapshots.every(resolved);
  const last = trip.stopSnapshots[trip.stopSnapshots.length - 1];
  const target = trip.direction === 'TO_SCHOOL' ? trip.schoolLocationSnapshot : last?.location;
  const finalSkipped = trip.direction === 'FROM_SCHOOL' && last?.status === 'skipped';
  const nearTarget = target && distance(trip.currentLocation, target) <= (trip.direction === 'TO_SCHOOL' ? 80 : Math.max(80, last.geofenceRadiusMeters || 65));
  const continuous = previous?.time && +new Date(trip.lastDeviceTimestamp) - +new Date(previous.time) <= 15000;
  const stopped = trip.speed != null && trip.speed <= 1;
  if (trip.mode !== 'route' || !allResolved || !fresh(trip, now) || !stopped || (!nearTarget && !finalSkipped) || !continuous) {
    trip.finishSince = null; trip.finishAnchor = null; trip.finishCandidateAt = null; return;
  }
  if (!trip.finishAnchor || distance(trip.currentLocation, trip.finishAnchor) > 25) {
    trip.finishAnchor = trip.currentLocation; trip.finishSince = new Date(now); trip.finishCandidateAt = null;
  }
  if (!trip.finishSince) trip.finishSince = new Date(now);
  if (now - +new Date(trip.finishSince) >= 30000 && !trip.finishCandidateAt) trip.finishCandidateAt = new Date(now);
}
function reminderDue(trip, now = Date.now()) {
  return trip.status === 'active' && !!trip.finishCandidateAt && fresh(trip, now) && trip.speed != null && trip.speed <= 1 && (!trip.finishSnoozedUntil || +new Date(trip.finishSnoozedUntil) <= now) && (!trip.finishReminderAt || now - +new Date(trip.finishReminderAt) >= 120000);
}
function reminderView(trip, now = Date.now()) {
  if (!trip.finishCandidateAt) return null;
  const skipped = trip.stopSnapshots.some(s => s.status === 'skipped');
  return { candidateAt: trip.finishCandidateAt, snoozedUntil: trip.finishSnoozedUntil || null, overdue: now - +new Date(trip.finishCandidateAt) >= 300000, message: skipped ? 'All route stops are resolved, including skipped stops. Check the journey and end the trip when safely parked.' : 'Journey appears finished. End the trip when safely parked.' };
}
module.exports = { fresh, resolved, advanceCursor, clearPassage, pastStop, observePassage, finalizeSkips, observeFinish, reminderDue, reminderView };
