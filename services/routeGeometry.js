const radians = value => value * Math.PI / 180;
function distance(a, b) {
  const dlat = radians(b.lat - a.lat), dlng = radians(b.lng - a.lng);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function decode(encoded = '') {
  const points = []; let index = 0, lat = 0, lng = 0;
  function read() {
    let value = 0, shift = 0, byte;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid route polyline');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid route polyline');
      value |= (byte & 31) << shift; shift += 5;
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  }
  while (index < encoded.length) { lat += read(); lng += read(); points.push({ lat: lat / 1e5, lng: lng / 1e5 }); }
  return points;
}
function encode(points = []) {
  let lat = 0, lng = 0, result = '';
  const write = delta => {
    let n = delta < 0 ? ~(delta << 1) : delta << 1;
    while (n >= 32) { result += String.fromCharCode((32 | (n & 31)) + 63); n >>= 5; }
    result += String.fromCharCode(n + 63);
  };
  for (const p of points) { const a = Math.round(p.lat * 1e5), b = Math.round(p.lng * 1e5); write(a - lat); write(b - lng); lat = a; lng = b; }
  return result;
}
function stitch(parts) {
  const output = [];
  for (const points of parts) for (const p of points) if (!output.length || distance(output[output.length - 1], p) > 0.5) output.push(p);
  return output;
}
function project(point, points, minAlong = 0, maxAlong = Infinity) {
  let best = null, traversed = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], length = distance(a, b);
    const scale = Math.cos(radians(point.lat));
    const x = (b.lng - a.lng) * scale, y = b.lat - a.lat;
    const px = (point.lng - a.lng) * scale, py = point.lat - a.lat;
    const t = Math.max(0, Math.min(1, (px * x + py * y) / (x * x + y * y || 1)));
    const position = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
    const along = traversed + t * length, off = distance(point, position);
    if (along >= minAlong && along <= maxAlong && (!best || off < best.distance - 0.5)) best = { position, along, distance: off, index: i };
    traversed += length;
  }
  return best ? { ...best, total: traversed } : null;
}
module.exports = { distance, decode, encode, stitch, project };
