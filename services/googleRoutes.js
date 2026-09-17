const { assert, coordinates, RouteError } = require('./routeValidation');
const { decode, encode, stitch } = require('./routeGeometry');
const FIELD_MASK = 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline';
const duration = value => Number(String(value || '').replace(/s$/, ''));
function sections(points) {
  assert(points.length >= 2 && points.length <= 102, 'A route must contain 2 to 102 locations');
  const chunks = [];
  for (let start = 0; start < points.length - 1; start += 26) chunks.push({ start, points: points.slice(start, start + 27) });
  return chunks;
}
async function computeRoute(points, { fetchImpl = global.fetch, key = process.env.GOOGLE_ROUTES_API_KEY, departureTime = new Date() } = {}) {
  assert(key, 'Road routing is unavailable. Please contact the school.', 503);
  points.forEach(coordinates);
  const legs = [], polylines = [];
  let distanceMeters = 0, durationSeconds = 0;
  for (const chunk of sections(points)) {
    const waypoint = point => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } });
    let response;
    try {
      response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({ origin: waypoint(chunk.points[0]), destination: waypoint(chunk.points.at(-1)), intermediates: chunk.points.slice(1, -1).map(waypoint), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', computeAlternativeRoutes: false, optimizeWaypointOrder: false, polylineQuality: 'HIGH_QUALITY', departureTime: new Date(Math.max(Date.now(), +new Date(departureTime)) + durationSeconds * 1000).toISOString() }),
      });
    } catch { throw new RouteError(503, 'Road routing timed out. Please retry.'); }
    if (!response.ok) throw new RouteError(503, 'Road routing is temporarily unavailable. Please retry.');
    const route = (await response.json()).routes?.[0];
    assert(route?.polyline?.encodedPolyline && route.legs?.length === chunk.points.length - 1, 'The route could not be calculated safely', 502);
    assert(Number.isFinite(route.distanceMeters) && Number.isFinite(duration(route.duration)), 'Invalid road route response', 502);
    polylines.push(decode(route.polyline.encodedPolyline));
    for (const leg of route.legs) {
      assert(Number.isFinite(leg.distanceMeters) && Number.isFinite(duration(leg.duration)) && leg.polyline?.encodedPolyline, 'Route legs are incomplete', 502);
      legs.push({ distanceMeters: leg.distanceMeters, durationSeconds: duration(leg.duration), encodedPolyline: leg.polyline.encodedPolyline });
    }
    distanceMeters += route.distanceMeters; durationSeconds += duration(route.duration);
  }
  const polyline = encode(stitch(polylines));
  assert(polyline.length <= 500000, 'This route is too complex. Split it into shorter bus routes.', 422);
  return { routePolyline: polyline, routeDistanceMeters: distanceMeters, routeDurationSeconds: durationSeconds, legs };
}
module.exports = { computeRoute, sections, FIELD_MASK };
