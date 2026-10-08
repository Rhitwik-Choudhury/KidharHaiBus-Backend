const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDriverPhone } = require('../utils/driverPhone');

test('driver phone normalization accepts dialable numbers and rejects invalid input', () => {
  assert.equal(normalizeDriverPhone('98765 43210'), '+919876543210');
  assert.equal(normalizeDriverPhone('+91 (98765) 43210'), '+919876543210');
  assert.equal(normalizeDriverPhone('919876543210'), '+919876543210');
  assert.equal(normalizeDriverPhone('+971 50 123 4567'), '+971501234567');
  for (const value of [null, 123, '', '12345', 'phone9876543210', '+0123456789', '98765#43210']) assert.equal(normalizeDriverPhone(value), null);
});

async function invoke(handler, req) {
  let body, error;
  await handler(req, { json: value => { body = value; } }, e => { error = e; });
  return { body, error };
}
test('driver self-contact and school contact edits remain scoped to ownership', async () => {
  const Driver = require('../models/Driver');
  const original = Driver.findOneAndUpdate;
  const { updateDriverContact } = require('../controllers/driverController');
  const driverId = '111111111111111111111111', schoolId = '222222222222222222222222';
  let captured;
  Driver.findOneAndUpdate = (query, update) => { captured = { query, update }; return { select: async () => ({ _id: driverId, phone: update.$set.phone }) }; };
  try {
    let result = await invoke(updateDriverContact, { user: { id: driverId, role: 'driver' }, params: { driverId: schoolId }, body: { phone: '9876543210' } });
    assert.ifError(result.error); assert.deepEqual(captured.query, { _id: driverId });
    assert.equal(result.body.driver.phone, '+919876543210');
    result = await invoke(updateDriverContact, { user: { id: schoolId, role: 'school' }, params: { driverId }, body: { phone: '+971501234567' } });
    assert.ifError(result.error); assert.deepEqual(captured.query, { _id: driverId, schoolId });
    Driver.findOneAndUpdate = () => ({ select: async () => null });
    result = await invoke(updateDriverContact, { user: { id: schoolId, role: 'school' }, params: { driverId }, body: { phone: '9876543210' } });
    assert.equal(result.error.status, 404);
    result = await invoke(updateDriverContact, { user: { id: driverId, role: 'driver' }, body: { phone: 'bad' } });
    assert.equal(result.error.status, 400);
  } finally { Driver.findOneAndUpdate = original; }
});

test('notification read updates cannot mark another parent’s notifications', async () => {
  const Notification = require('../models/ParentNotification');
  const { markRead } = require('../controllers/parentNotificationController');
  const original = Notification.updateMany;
  const parentId = '111111111111111111111111', alertId = '222222222222222222222222';
  let filter;
  Notification.updateMany = async query => { filter = query; };
  try {
    const result = await invoke(markRead, { user: { id: parentId }, body: { ids: [alertId] } });
    assert.ifError(result.error); assert.deepEqual(filter, { parentId, _id: { $in: [alertId] }, readAt: null });
    const invalid = await invoke(markRead, { user: { id: parentId }, body: { ids: ['not-an-id'] } });
    assert.equal(invalid.error.status, 400);
  } finally { Notification.updateMany = original; }
});

test('parent map payload contains route stops without other children’s details', () => {
  const { parentView } = require('../services/tripService');
  const childId = '111111111111111111111111';
  const otherId = '222222222222222222222222';
  const trip = { _id: 't1', busId: 'b1', status: 'active', direction: 'FROM_SCHOOL', mode: 'route', nextStopIndex: 0, stopSnapshots: [
    { routeStopId: 'rs1', name: 'Shared Stop', location: { lat: 26, lng: 91 }, status: 'pending', studentIds: [childId, otherId], students: [{ id: otherId, name: 'Private student' }], parentIds: ['Private parent'] },
  ] };
  const view = parentView(trip, childId);
  assert.equal(view.nextStop.name, 'Shared Stop');
  assert.equal(view.stops.length, 1);
  assert.equal(view.personal.approvedStop.name, 'Shared Stop');
  assert.equal(JSON.stringify(view).includes('Private'), false);
  assert.equal(JSON.stringify(view).includes(otherId), false);
});
