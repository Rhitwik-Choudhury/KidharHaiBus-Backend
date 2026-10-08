const Notification = require('../models/ParentNotification');
const { endpoint, assert, ids } = require('../services/routeValidation');
exports.list = endpoint(async (req, res) => {
  const query = { parentId: req.user.id };
  const [notifications, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(100).lean(),
    Notification.countDocuments({ ...query, readAt: null }),
  ]);
  res.json({ notifications, unreadCount });
});
exports.markRead = endpoint(async (req, res) => {
  assert(Array.isArray(req.body.ids), 'Select notifications to mark read');
  const selected = ids(req.body.ids, 'Notifications', 100);
  await Notification.updateMany({ parentId: req.user.id, _id: { $in: selected }, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ message: 'Notifications marked read' });
});
