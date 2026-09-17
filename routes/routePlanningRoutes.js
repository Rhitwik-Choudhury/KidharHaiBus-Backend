const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/authMiddleware');
const { role, endpoint, assert, coordinates, id, date, text } = require('../services/routeValidation');
const plan = require('../services/routePlanning');
const tripService = require('../services/tripService');
const School = require('../models/School');
const Student = require('../models/Student');
const Bus = require('../models/Bus');
const Parent = require('../models/Parent');
const Trip = require('../models/Trip');
const PickupRequest = require('../models/PickupRequest');
const RouteStop = require('../models/RouteStop');
const RoutePlan = require('../models/RoutePlan');
const school = express.Router(), parent = express.Router(), driver = express.Router();
school.use(auth, role('school'));
parent.use(auth, role('parent'));
driver.use(auth, role('driver'));
const routingLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: true, legacyHeaders: false });
school.get('/location', endpoint(async (req, res) => { const s = await School.findById(req.user.id).select('schoolLocation'); res.json({ schoolLocation: s?.schoolLocation || null }); }));
school.put('/location', endpoint(async (req, res) => {
  assert(req.body.confirmed === true, 'Confirm the school location on the map');
  const schoolLocation = { ...coordinates(req.body), formattedAddress: text(req.body.formattedAddress), placeId: text(req.body.placeId, 300), verifiedAt: new Date() };
  await School.updateOne({ _id: req.user.id }, { $set: { schoolLocation } });
  // Invalidates previews being published concurrently; published snapshots remain unchanged.
  await Bus.updateMany({ schoolId: req.user.id }, { $inc: { routeRevision: 1 } });
  res.json({ schoolLocation });
}));
school.get('/pickup-requests', endpoint(async (req, res) => {
  const filter = { schoolId: req.user.id, isCurrent: true };
  if (req.query.busId) { await plan.schoolBus(req.user.id, req.query.busId); filter.busId = req.query.busId; }
  res.json({ requests: await PickupRequest.find(filter).sort({ createdAt: -1 }).limit(500).lean() });
}));
school.patch('/pickup-requests/:id/review', endpoint(async (req, res) => res.json({ request: await plan.reviewRequest(req.user.id, req.params.id, req.body, req.io) })));
school.get('/buses/:busId/route-summary', endpoint(async (req, res) => res.json(await plan.summary(req.user.id, req.params.busId))));
school.get('/buses/:busId/stops', endpoint(async (req, res) => { await plan.schoolBus(req.user.id, req.params.busId); res.json({ stops: await RouteStop.find({ schoolId: req.user.id, busId: req.params.busId }).lean() }); }));
school.post('/buses/:busId/stops', endpoint(async (req, res) => res.status(201).json({ stop: await plan.createStop(req.user.id, req.params.busId, req.body) })));
school.patch('/buses/:busId/stops/:stopId', endpoint(async (req, res) => res.json({ stop: await plan.updateStop(req.user.id, req.params.busId, req.params.stopId, req.body) })));
school.delete('/buses/:busId/stops/:stopId', endpoint(async (req, res) => { assert(req.body.confirmed === true, 'Confirm deactivating this stop'); res.json({ stop: await plan.updateStop(req.user.id, req.params.busId, req.params.stopId, { active: false, expectedRevision: req.body.expectedRevision }) }); }));
school.put('/buses/:busId/route-plan', endpoint(async (req, res) => res.json({ draft: await plan.saveDraft(req.user.id, req.params.busId, req.body) })));
school.post('/buses/:busId/route-preview', routingLimit, endpoint(async (req, res) => res.json(await plan.preview(req.user.id, req.params.busId, req.body))));
school.post('/buses/:busId/route-publish', routingLimit, endpoint(async (req, res) => res.status(201).json({ route: await plan.publish(req.user.id, req.params.busId, req.body, req.io) })));
school.get('/buses/:busId/route-versions', endpoint(async (req, res) => { await plan.schoolBus(req.user.id, req.params.busId); res.json({ versions: await RoutePlan.find({ schoolId: req.user.id, busId: req.params.busId, status: 'published' }).select('version effectiveFrom publishedAt morningStopIds returnStopIds').sort({ version: -1 }).limit(100).lean() }); }));
school.patch('/students/:studentId/transport', endpoint(async (req, res) => {
  const student = await Student.findOne({ _id: req.params.studentId, schoolId: req.user.id }); assert(student, 'Student not found', 404);
  assert(['active', 'not_riding', 'parent_transport', 'starts_later', 'temporary_arrangement'].includes(req.body.transportStatus), 'Invalid transport status');
  if (req.body.transportStatus === 'starts_later') assert(date(req.body.transportStartsAt) > new Date(), 'Choose a future transport start date');
  await plan.mutate(req.user.id, student.busId, undefined, async (bus, session) => {
    await Student.updateOne({ _id: student._id }, { $set: { transportStatus: req.body.transportStatus, transportStartsAt: req.body.transportStartsAt || null, transportNote: text(req.body.transportNote) } }, { session, runValidators: true });
  });
  res.json({ updated: true });
}));
school.get('/trips', endpoint(async (req, res) => {
  const buses = await Bus.find({ schoolId: req.user.id }).populate('driverId', 'fullName').lean();
  const trips = await Trip.find({ schoolId: req.user.id, status: 'active' });
  res.json({ buses: buses.map(b => ({ id: b._id, busNumber: b.busNumber, driver: b.driverId, trip: trips.find(t => id(t.busId) === id(b._id)) ? tripService.driverView(trips.find(t => id(t.busId) === id(b._id))) : null })) });
}));
school.get('/trips/:tripId', endpoint(async (req, res) => { const trip = await Trip.findOne({ _id: req.params.tripId, schoolId: req.user.id }); assert(trip, 'Trip not found', 404); res.json({ trip: tripService.driverView(trip) }); }));
parent.get('/children', endpoint(async (req, res) => { const p = await Parent.findById(req.user.id).populate({ path: 'children', populate: { path: 'busId', select: 'busNumber route tripStatus' } }); assert(p, 'Parent not found', 404); res.json({ children: p.children }); }));
parent.post('/children', endpoint(async (req, res) => {
  const code = text(req.body.studentCode, 100).toUpperCase(); assert(code, 'Enter the student code supplied by the school');
  const child = await Student.findOne({ studentCode: code }); assert(child, 'Student code not found', 404);
  await Parent.updateOne({ _id: req.user.id }, { $addToSet: { children: child._id } }); res.json({ studentId: child._id });
}));
parent.get('/pickup-request/:studentId', endpoint(async (req, res) => res.json(await plan.pickupState(req.user.id, req.params.studentId))));
parent.post('/pickup-request/:studentId', endpoint(async (req, res) => { await plan.submitRequest(req.user.id, req.params.studentId, req.body); res.status(201).json(await plan.pickupState(req.user.id, req.params.studentId)); }));
parent.post('/pickup-request/:studentId/acknowledge', endpoint(async (req, res) => { await plan.childForParent(req.user.id, req.params.studentId); await PickupRequest.updateOne({ studentId: req.params.studentId, _id: req.body.requestId, isCurrent: true }, { $set: { acknowledgedAt: new Date(), acknowledgedBy: req.user.id } }); res.json({ acknowledged: true }); }));
parent.get('/live-trip/:studentId', endpoint(async (req, res) => {
  const { student } = await plan.childForParent(req.user.id, req.params.studentId);
  const trip = await Trip.findOne({ busId: student.busId, schoolId: student.schoolId, status: 'active' });
  res.json({ trip: trip ? tripService.parentView(trip, student._id) : null, pickup: await plan.pickupState(req.user.id, student._id) });
}));
driver.get('/route-readiness', endpoint(async (req, res) => res.json(await tripService.readiness(req.user.id))));
driver.get('/active-trip', endpoint(async (req, res) => { const trip = await Trip.findOne({ driverId: req.user.id, status: 'active' }); res.json({ trip: trip ? tripService.driverView(trip) : null }); }));
driver.post('/trip/:tripId/skip-stop', endpoint(async (req, res) => res.json({ trip: await tripService.skip(req.user.id, req.params.tripId, req.body, req.io) })));
module.exports = { school, parent, driver };
