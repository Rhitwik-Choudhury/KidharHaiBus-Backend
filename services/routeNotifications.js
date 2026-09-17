const Parent = require('../models/Parent');
const Student = require('../models/Student');
const Receipt = require('../models/NotificationReceipt');
const sendNotification = require('../utils/sendNotification');
async function notifyParent(parentId, key, type, message, io, data = {}) {
  try { await Receipt.create({ key: `${key}:${parentId}`, parentId }); }
  catch (error) { if (error.code === 11000) return false; throw error; }
  io?.to(`parent_${parentId}`).emit('alert', { type, message, ...data });
  const parent = await Parent.findById(parentId).select('fcmToken').lean();
  if (parent?.fcmToken) await sendNotification(parent.fcmToken, 'Trackefy', message, { ...data, type, eventId: key });
  return true;
}
async function busParents(busId) {
  const students = await Student.find({ busId }).select('_id').lean();
  return Parent.find({ children: { $in: students.map(s => s._id) } }).select('_id children').lean();
}
async function notifyBus(busId, key, type, message, io, data = {}) {
  for (const p of await busParents(busId)) await notifyParent(p._id, key, type, message, io, { busId: String(busId), ...data });
}
module.exports = { notifyParent, notifyBus, busParents };
