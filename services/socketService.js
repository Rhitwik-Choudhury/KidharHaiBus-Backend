const jwt = require('jsonwebtoken');
const Bus = require('../models/Bus');
const School = require('../models/School');
const Driver = require('../models/Driver');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const trip = require('./tripService');
const { assert, validId } = require('./routeValidation');
async function allowedBus(user, busId) {
  if (!validId(busId)) return false;
  if (user.role === 'school') return !!await Bus.exists({ _id: busId, schoolId: user.id });
  if (user.role === 'driver') return !!await Bus.exists({ _id: busId, driverId: user.id });
  const parent = await Parent.findById(user.id).select('children').lean();
  return !!parent && !!await Student.exists({ _id: { $in: parent.children }, busId });
}
function install(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || String(socket.handshake.headers.authorization || '').replace(/^Bearer /, '');
      const user = jwt.verify(token, process.env.JWT_SECRET);
      assert(validId(user.id) && ['school', 'driver', 'parent'].includes(user.role), 'Invalid session', 401);
      const Model = { school: School, driver: Driver, parent: Parent }[user.role];
      assert(await Model.exists({ _id: user.id }), 'Invalid session', 401);
      socket.data.user = { id: String(user.id), role: user.role, expiresAt: user.exp * 1000 }; next();
    } catch { next(new Error('Authentication required')); }
  });
  io.on('connection', socket => {
    const user = socket.data.user;
    socket.join(`${user.role}_${user.id}`);
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(1, Math.min(2147483647, user.expiresAt - Date.now())));
    socket.on("disconnect", () => clearTimeout(expiryTimer));
    const safe = fn => async (data = {}, ack) => {
      try { assert(Date.now() < user.expiresAt, 'Session expired', 401); const result = await fn(data); if (typeof ack === 'function') ack({ ok: true, ...result }); }
      catch (e) { if (typeof ack === 'function') ack({ ok: false, message: e.status ? e.message : 'Unable to complete request' }); }
    };
    socket.on('joinBusRoom', safe(async ({ busId }) => { assert(await allowedBus(user, busId), 'Bus access denied', 403); if (user.role !== 'parent') socket.join(`bus_${busId}`); return {}; }));
    socket.on('leaveBusRoom', ({ busId } = {}) => { if (validId(busId)) socket.leave(`bus_${busId}`); });
    socket.on('joinSchoolRoom', safe(async () => { assert(user.role === 'school', 'School access required', 403); socket.join(`school_${user.id}`); return {}; }));
    socket.on('driverLocation', safe(async data => { assert(user.role === 'driver', 'Driver access required', 403); return trip.location(user.id, data, io); }));
    socket.on('trip:start', safe(async data => { assert(user.role === 'driver', 'Driver access required', 403); return trip.start(user.id, data, io); }));
    socket.on('trip:end', safe(async data => { assert(user.role === 'driver', 'Driver access required', 403); return trip.end(user.id, data, io); }));
  });
}
module.exports = { install, allowedBus };
