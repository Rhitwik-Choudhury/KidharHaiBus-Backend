const mongoose = require('mongoose');
const Bus = require('../models/Bus');
const School = require('../models/School');
const Driver = require('../models/Driver');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const PickupRequest = require('../models/PickupRequest');
const RouteStop = require('../models/RouteStop');
const RoutePlan = require('../models/RoutePlan');
const { assert, id, validId, coordinates, ids, date, text, isRiding, activeStop } = require('./routeValidation');
const { computeRoute } = require('./googleRoutes');
const { distance } = require('./routeGeometry');
const { notifyParent, notifyBus } = require('./routeNotifications');
const CLASSIFICATIONS = ['waiting_for_parent_location', 'not_riding', 'temporary_arrangement', 'parent_transport', 'starts_later'];
async function schoolBus(schoolId, busId, session = null) {
  assert(validId(busId), 'Bus not found', 404);
  const bus = await Bus.findOne({ _id: busId, schoolId }).session(session);
  assert(bus, 'Bus not found', 404); return bus;
}
async function childForParent(parentId, studentId, session = null) {
  assert(validId(studentId), 'Child not found', 404);
  const parent = await Parent.findOne({ _id: parentId, children: studentId }).session(session);
  assert(parent, 'Child not found', 404);
  const student = await Student.findById(studentId).session(session);
  assert(student, 'Child not found', 404); return { parent, student };
}
async function mutate(schoolId, busId, expectedRevision, operation) {
  return mongoose.connection.transaction(async session => {
    const bus = await schoolBus(schoolId, busId, session);
    if (expectedRevision !== undefined) assert(bus.routeRevision === expectedRevision, 'The route changed. Refresh before saving.', 409);
    bus.routeRevision += 1; await bus.save({ session });
    return operation(bus, session);
  });
}
async function getDraft(bus, session = null) {
  let draft = await RoutePlan.findOne({ busId: bus._id, status: 'draft' }).session(session);
  if (!draft) {
    draft = new RoutePlan({ schoolId: bus.schoolId, busId: bus._id, version: 0 });
    await draft.save({ session });
  }
  return draft;
}
const publishedPlan = (busId, at = new Date()) => RoutePlan.findOne({ busId, status: 'published', effectiveFrom: { $lte: at } }).sort({ effectiveFrom: -1, version: -1 });
async function parentIdsFor(studentIds, session = null) {
  return (await Parent.find({ children: { $in: studentIds } }).select('_id').session(session).lean()).map(p => p._id);
}
async function verifyMembers(bus, studentIds, session) {
  ids(studentIds, 'Students', 500);
  const students = await Student.find({ _id: { $in: studentIds }, schoolId: bus.schoolId, busId: bus._id }).session(session).lean();
  assert(students.length === studentIds.length, 'Every student must belong to this school and bus'); return students;
}
async function detachMembers(busId, studentIds, exceptId, session) {
  const others = await RouteStop.find({ busId, _id: { $ne: exceptId }, studentIds: { $in: studentIds } }).session(session);
  for (const other of others) {
    other.studentIds = other.studentIds.filter(value => !studentIds.map(id).includes(id(value)));
    other.parentIds = await parentIdsFor(other.studentIds, session);
    if (!other.studentIds.length) other.active = false;
    await other.save({ session });
  }
}
function stopFields(body) {
  const result = {};
  if ('name' in body) { result.name = text(body.name, 100); assert(result.name, 'Stop name is required'); }
  if ('location' in body) result.location = coordinates(body.location);
  for (const key of ['formattedAddress', 'placeId']) if (key in body) result[key] = text(body[key], key === 'placeId' ? 300 : 500);
  if ('active' in body) { assert(typeof body.active === 'boolean', 'Invalid stop status'); result.active = body.active; }
  if ('expiresAt' in body) { result.expiresAt = body.expiresAt ? date(body.expiresAt, 'Expiry date') : null; if (result.expiresAt) assert(result.expiresAt > new Date(), 'Expiry must be in the future'); }
  if ('geofenceRadiusMeters' in body) { assert(Number.isFinite(body.geofenceRadiusMeters) && body.geofenceRadiusMeters >= 30 && body.geofenceRadiusMeters <= 150, 'Arrival radius must be 30–150 metres'); result.geofenceRadiusMeters = body.geofenceRadiusMeters; }
  return result;
}
async function putStop(bus, body, session, stopId) {
  const fields = stopFields(body);
  let stop = stopId ? await RouteStop.findOne({ _id: stopId, busId: bus._id, schoolId: bus.schoolId }).session(session) : new RouteStop({ schoolId: bus.schoolId, busId: bus._id });
  assert(stop, 'Stop not found', 404);
  if (body.studentIds !== undefined) {
    await verifyMembers(bus, body.studentIds, session);
    stop.studentIds = body.studentIds;
    stop.parentIds = await parentIdsFor(body.studentIds, session);
    await detachMembers(bus._id, body.studentIds, stop._id, session);
  }
  Object.assign(stop, fields);
  assert(stop.name && stop.location, 'Stop name and map location are required');
  assert(!stop.active || stop.studentIds.length > 0, 'Assign at least one student to an active stop');
  await stop.save({ session });
  const draft = await getDraft(bus, session);
  if (!draft.morningStopIds.some(value => id(value) === id(stop._id))) {
    draft.morningStopIds.push(stop._id);
    // Reverse only for the initial placement. Later orders are independent.
    draft.returnStopIds.unshift(stop._id);
    await draft.save({ session });
  }
  return stop;
}
async function submitRequest(parentId, studentId, body) {
  const { student } = await childForParent(parentId, studentId);
  const location = coordinates(body.requestedLocation || body);
  return mutate(student.schoolId, student.busId, undefined, async (bus, session) => {
    await childForParent(parentId, studentId, session);
    const current = await PickupRequest.findOne({ studentId, isCurrent: true }).session(session);
    if (current?.status === 'pending' && id(current.parentId) === id(parentId) && id(current.busId) === id(bus._id) && distance(current.requestedLocation, location) < 0.5 && current.formattedAddress === text(body.formattedAddress)) return current;
    await PickupRequest.updateMany({ studentId, isCurrent: true }, { $set: { isCurrent: false, status: 'superseded' } }, { session });
    const [request] = await PickupRequest.create([{ parentId, studentId, schoolId: bus.schoolId, busId: bus._id, requestedLocation: location, formattedAddress: text(body.formattedAddress), placeId: text(body.placeId, 300), submittedBy: 'parent' }], { session });
    return request;
  });
}
async function createStop(schoolId, busId, body) {
  assert(body.confirmedWithParent === true || body.existingStopAssignment === true, 'Confirm this location with the parent before assigning it');
  return mutate(schoolId, busId, body.expectedRevision, async (bus, session) => {
    const stop = await putStop(bus, body, session);
    await schoolRequests(bus, stop, stop.studentIds, body.reviewNote, session);
    return stop;
  });
}
async function schoolRequests(bus, stop, studentIds, note, session) {
  for (const studentId of studentIds) {
    await PickupRequest.updateMany({ studentId, isCurrent: true }, { $set: { isCurrent: false, status: 'superseded' } }, { session });
    const parents = await parentIdsFor([studentId], session);
    const [request] = await PickupRequest.create([{ parentId: parents[0] || null, studentId, schoolId: bus.schoolId, busId: bus._id, requestedLocation: stop.location, formattedAddress: stop.formattedAddress, placeId: stop.placeId, submittedBy: 'school', status: 'approved', reviewedBy: bus.schoolId, reviewedAt: new Date(), reviewNote: text(note, 1000), routeStopId: stop._id }], { session });
    stop.createdFromPickupRequestIds = [...stop.createdFromPickupRequestIds.slice(-99), request._id];
  }
  await stop.save({ session });
}
async function updateStop(schoolId, busId, stopId, body) {
  return mutate(schoolId, busId, body.expectedRevision, async (bus, session) => {
    const previous = await RouteStop.findOne({ _id: stopId, busId, schoolId }).session(session);
    assert(previous, 'Stop not found', 404);
    const oldMembers = previous.studentIds.map(id);
    const stop = await putStop(bus, body, session, stopId);
    const changedLocation = body.location && distance(previous.location, stop.location) > 1;
    const newMembers = stop.studentIds.filter(s => !oldMembers.includes(id(s)));
    if (changedLocation || newMembers.length) {
      assert(body.confirmedWithParent === true, 'Confirm this stop change with the parent');
      await schoolRequests(bus, stop, changedLocation ? stop.studentIds : newMembers, body.reviewNote, session);
    }
    return stop;
  });
}
async function reviewRequest(schoolId, requestId, body, io) {
  assert(validId(requestId), 'Request not found', 404);
  const before = await PickupRequest.findOne({ _id: requestId, schoolId, isCurrent: true });
  assert(before, 'Request not found', 404);
  const result = await mutate(schoolId, before.busId, body.expectedRevision, async (bus, session) => {
    const request = await PickupRequest.findOne({ _id: requestId, schoolId, isCurrent: true }).session(session);
    assert(request && ['pending', 'clarification_required'].includes(request.status), 'This request has already been reviewed', 409);
    const student = await Student.findOne({ _id: request.studentId, schoolId, busId: bus._id }).session(session);
    assert(student, 'The student changed buses. Ask for a new pickup request.', 409);
    assert(['approved', 'adjusted', 'clarification_required', 'rejected'].includes(body.status), 'Choose a valid review outcome');
    const note = text(body.reviewNote, 1000);
    if (body.status !== 'approved') assert(note, 'A school note is required');
    if (['approved', 'adjusted'].includes(body.status)) {
      let stop;
      if (body.routeStopId) {
        stop = await RouteStop.findOne({ _id: body.routeStopId, busId: bus._id, schoolId, active: true }).session(session);
        assert(stop && activeStop(stop), 'Choose an active stop from this bus');
        if (distance(stop.location, request.requestedLocation) > 80) assert(note, 'Explain why the approved point differs from the request');
        stop = await putStop(bus, { studentIds: [...new Set([...stop.studentIds.map(id), id(student._id)])] }, session, stop._id);
      } else {
        const location = body.location ? coordinates(body.location) : request.requestedLocation;
        if (distance(location, request.requestedLocation) > 80) assert(note, 'Explain why the approved point differs from the request');
        stop = await putStop(bus, { name: text(body.name, 100) || `${student.name}'s stop`, location, formattedAddress: body.formattedAddress ?? request.formattedAddress, placeId: body.placeId ?? request.placeId, studentIds: [id(student._id)], expiresAt: body.expiresAt }, session);
      }
      stop.createdFromPickupRequestIds = [...stop.createdFromPickupRequestIds.slice(-99), request._id];
      await stop.save({ session }); request.routeStopId = stop._id;
      request.status = distance(stop.location, request.requestedLocation) > 10 || body.status === 'adjusted' ? 'adjusted' : 'approved';
    } else request.status = body.status;
    request.reviewedBy = schoolId; request.reviewedAt = new Date(); request.reviewNote = note;
    await request.save({ session }); return request;
  });
  for (const parentId of await parentIdsFor([result.studentId])) await notifyParent(parentId, `pickup:${result._id}:${result.reviewedAt.toISOString()}`, `PICKUP_${result.status.toUpperCase()}`, `Pickup location: ${result.status.replaceAll('_', ' ')}. ${result.reviewNote}`, io, { studentId: id(result.studentId), busId: id(result.busId) });
  return result;
}
async function pickupState(parentId, studentId) {
  const { student } = await childForParent(parentId, studentId);
  const request = await PickupRequest.findOne({ studentId, busId: student.busId, isCurrent: true }).lean();
  const stop = await RouteStop.findOne({ studentIds: studentId, busId: student.busId, schoolId: student.schoolId, active: true }).lean();
  const approved = stop && activeStop(stop) ? { id: stop._id, name: stop.name, location: stop.location, formattedAddress: stop.formattedAddress, expiresAt: stop.expiresAt } : null;
  const plan = await publishedPlan(student.busId).lean();
  const included = plan && [...plan.morningSnapshots, ...plan.returnSnapshots].some(s => s.studentIds.some(value => id(value) === id(studentId)));
  const inactive = !isRiding(student) || (stop?.expiresAt && !activeStop(stop));
  const status = inactive ? 'Temporarily inactive' : request?.status === 'pending' ? approved ? 'Update pending' : 'Pending school review' : request?.status === 'clarification_required' ? 'Clarification required' : approved ? request?.status === 'adjusted' ? 'School adjusted location' : 'Approved' : 'Pickup location not set';
  return { studentId: id(studentId), status, approved, published: !!included, request: request ? { id: request._id, status: request.status, requestedLocation: request.requestedLocation, formattedAddress: request.formattedAddress, reviewNote: request.reviewNote, submittedBy: request.submittedBy, acknowledgedAt: request.acknowledgedAt, updatedAt: request.updatedAt } : null };
}
function buildSnapshots(order, stops, students, parents, at) {
  ids(order); const seen = new Set();
  return order.map((stopId, sequence) => {
    const stop = stops.find(s => id(s._id) === id(stopId));
    assert(stop, 'A stop is not assigned to this bus');
    assert(activeStop(stop, at), `Stop ${stop.name} is inactive or expires before this route takes effect`);
    coordinates(stop.location);
    const members = stop.studentIds.map(sid => {
      const student = students.find(s => id(s._id) === id(sid));
      assert(student, `Stop ${stop.name} has a student assigned to another bus`);
      assert(!seen.has(id(sid)), 'A student cannot appear at two stops in one direction');
      seen.add(id(sid)); return student;
    }).filter(s => isRiding(s, at));
    assert(members.length, `Stop ${stop.name} has no students using transport on the effective date`);
    return { routeStopId: stop._id, sequence, name: stop.name, location: { lat: stop.location.lat, lng: stop.location.lng }, formattedAddress: stop.formattedAddress, placeId: stop.placeId, studentIds: members.map(s => s._id), students: members.map(s => ({ id: s._id, name: s.name })), parentIds: parents.filter(p => p.children.some(s => members.some(m => id(m._id) === id(s)))).map(p => p._id), geofenceRadiusMeters: stop.geofenceRadiusMeters, expiresAt: stop.expiresAt, status: 'pending' };
  });
}
async function routeData(schoolId, busId) {
  const bus = await schoolBus(schoolId, busId);
  const school = await School.findById(schoolId).select('schoolLocation').lean();
  const students = await Student.find({ schoolId, busId }).lean();
  const parents = await Parent.find({ children: { $in: students.map(s => s._id) } }).select('_id children').lean();
  const stops = await RouteStop.find({ schoolId, busId }).lean();
  const draft = await RoutePlan.findOne({ busId, status: 'draft' }).lean();
  const requests = await PickupRequest.find({ schoolId, busId, isCurrent: true }).lean();
  const published = await RoutePlan.findOne({ busId, status: 'published' }).sort({ version: -1 }).lean();
  const driver = bus.driverId ? await Driver.findOne({ _id: bus.driverId, schoolId, busId }).select('fullName').lean() : null;
  return { bus, school, students, parents, stops, draft, requests, published, driver };
}
async function summary(schoolId, busId) {
  const data = await routeData(schoolId, busId);
  const { students, stops, parents, requests, draft } = data;
  const lifecycle = students.map(student => {
    const stop = stops.find(s => activeStop(s) && s.studentIds.some(v => id(v) === id(student._id)));
    const request = requests.find(r => id(r.studentId) === id(student._id));
    const registered = parents.some(p => p.children.some(c => id(c) === id(student._id)));
    const stage = !isRiding(student) ? 'Temporarily inactive' : stop ? 'Approved stop assigned' : request?.status === 'pending' ? 'Pending school review' : registered ? 'Pickup location required' : 'Awaiting parent registration';
    return { ...student, registered, stage, routeStopId: stop?._id, requestStatus: request?.status, classification: draft?.unresolvedStudents?.find(u => id(u.studentId) === id(student._id))?.classification || '' };
  });
  const pending = requests.filter(r => ['pending', 'clarification_required'].includes(r.status));
  const suggestions = pending.map(r => ({ requestId: r._id, stops: stops.filter(s => activeStop(s) && distance(s.location, r.requestedLocation) <= 150).map(s => ({ id: s._id, name: s.name, distanceMeters: Math.round(distance(s.location, r.requestedLocation)) })) }));
  return { bus: { id: data.bus._id, busNumber: data.bus.busNumber, routeRevision: data.bus.routeRevision }, driver: data.driver, schoolLocation: data.school?.schoolLocation || null, students: lifecycle, stops, requests: pending, suggestions, draft, published: data.published ? { id: data.published._id, version: data.published.version, effectiveFrom: data.published.effectiveFrom } : null, counts: { students: students.length, approvedStops: stops.filter(s => activeStop(s)).length, pending: pending.length, missingLocations: lifecycle.filter(s => !s.routeStopId).length, sharedStops: stops.filter(s => activeStop(s) && s.studentIds.length > 1).length }, ready: !!data.school?.schoolLocation && !!data.driver && !!draft?.morningStopIds.length && !!draft?.returnStopIds.length && lifecycle.every(s => s.routeStopId || s.classification) };
}
async function saveDraft(schoolId, busId, body) {
  ids(body.morningStopIds); ids(body.returnStopIds);
  return mutate(schoolId, busId, body.expectedRevision, async (bus, session) => {
    const selected = [...new Set([...body.morningStopIds, ...body.returnStopIds])];
    assert(await RouteStop.countDocuments({ _id: { $in: selected }, schoolId, busId }).session(session) === selected.length, 'Choose stops assigned to this bus');
    const unresolved = body.unresolvedStudents || [];
    ids(unresolved.map(u => u.studentId), 'Unresolved students', 500);
    await verifyMembers(bus, unresolved.map(u => u.studentId), session);
    assert(unresolved.every(u => CLASSIFICATIONS.includes(u.classification)), 'Classify every unresolved student');
    const draft = await getDraft(bus, session);
    draft.morningStopIds = body.morningStopIds; draft.returnStopIds = body.returnStopIds;
    draft.unresolvedStudents = unresolved.map(u => ({ studentId: u.studentId, classification: u.classification, note: text(u.note) }));
    await draft.save({ session }); return draft;
  });
}
async function preparePublish(schoolId, busId, body) {
  const data = await routeData(schoolId, busId);
  assert(data.school?.schoolLocation?.verifiedAt, 'Set and verify the school map location');
  assert(data.driver, 'Assign a driver to this bus');
  assert(data.draft, 'Save a draft route first');
  const at = body.effectiveFrom ? date(body.effectiveFrom, 'Effective date') : new Date();
  assert(at >= new Date(Date.now() - 60000), 'The effective date cannot be in the past');
  const morning = buildSnapshots(data.draft.morningStopIds, data.stops, data.students, data.parents, at);
  const returning = buildSnapshots(data.draft.returnStopIds, data.stops, data.students, data.parents, at);
  assert(morning.length && returning.length, 'Add stops to both directions');
  const unresolved = data.students.filter(student => !morning.some(s => s.studentIds.some(v => id(v) === id(student._id))) || !returning.some(s => s.studentIds.some(v => id(v) === id(student._id))));
  const classified = unresolved.map(student => ({ studentId: student._id, name: student.name, ...data.draft.unresolvedStudents.find(u => id(u.studentId) === id(student._id)) }));
  return { data, at, morning, returning, unresolved: classified };
}
async function preview(schoolId, busId, body) {
  const result = await preparePublish(schoolId, busId, body);
  const order = body.direction === 'FROM_SCHOOL' ? result.returning : result.morning;
  const origin = body.origin ? coordinates(body.origin) : result.data.school.schoolLocation;
  const points = [origin, ...order.map(s => s.location)];
  if (body.direction !== 'FROM_SCHOOL') points.push(result.data.school.schoolLocation);
  return { ...(await computeRoute(points)), unresolvedStudents: result.unresolved, approximateOrigin: !body.origin };
}
async function publish(schoolId, busId, body, io) {
  const p = await preparePublish(schoolId, busId, body);
  if (p.unresolved.length) {
    assert(p.unresolved.every(s => CLASSIFICATIONS.includes(s.classification)), 'Classify every unresolved student before publishing', 422, p.unresolved);
    assert(body.confirmUnresolved === true, 'Confirm publication with the listed unresolved students', 422, p.unresolved);
  }
  const school = p.data.school.schoolLocation;
  // Calculate both directions independently before taking the database transaction.
  const morningPreview = await computeRoute([school, ...p.morning.map(s => s.location), school]);
  const returnPreview = await computeRoute([school, ...p.returning.map(s => s.location)]);
  const plan = await mutate(schoolId, busId, p.data.bus.routeRevision, async (bus, session) => {
    bus.routeVersionCounter += 1; await bus.save({ session });
    const [version] = await RoutePlan.create([{ schoolId, busId, version: bus.routeVersionCounter, status: 'published', schoolLocationSnapshot: school, morningStopIds: p.data.draft.morningStopIds, returnStopIds: p.data.draft.returnStopIds, morningSnapshots: p.morning, returnSnapshots: p.returning, effectiveFrom: p.at, publishedAt: new Date(), publishedBy: schoolId, unresolvedStudents: p.unresolved.map(s => ({ studentId: s.studentId, classification: s.classification, note: s.note })), morningPreview, returnPreview }], { session });
    return version;
  });
  await notifyBus(busId, `route:${plan._id}`, 'ROUTE_UPDATED', `The school published route version ${plan.version}. It applies to future trips from ${plan.effectiveFrom.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.`, io);
  return plan;
}
// Call in the same transaction as a student's reassignment. Published documents and Trips stay intact.
async function removeStudentFromDraft(student, session) {
  await detachMembers(student.busId, [id(student._id)], null, session);
  await PickupRequest.updateMany({ studentId: student._id, isCurrent: true }, { $set: { isCurrent: false, status: 'superseded' } }, { session });
  const stops = await RouteStop.find({ busId: student.busId, active: true }).select('_id').session(session);
  const valid = stops.map(s => s._id);
  await RoutePlan.updateOne({ busId: student.busId, status: 'draft' }, { $pull: { morningStopIds: { $nin: valid }, returnStopIds: { $nin: valid }, unresolvedStudents: { studentId: student._id } } }, { session });
}
module.exports = { schoolBus, childForParent, mutate, getDraft, publishedPlan, parentIdsFor, verifyMembers, submitRequest, createStop, updateStop, reviewRequest, pickupState, summary, saveDraft, preview, publish, removeStudentFromDraft, buildSnapshots, CLASSIFICATIONS };
