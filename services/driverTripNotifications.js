const Driver = require('../models/Driver');
const admin = require('../config/firebase');
async function notifyDriver(trip, message, io, options = {}) {
  const tripId = String(trip._id);
  io?.to(`driver_${trip.driverId}`).emit('trip-end-reminder', { tripId, message });
  const driver = await Driver.findById(trip.driverId).select('fcmToken').lean();
  if (!driver?.fcmToken) return;
  if (!admin) { if (options.throwOnError) throw new Error('Firebase is not initialized'); return; }
  try {
    // Data-only delivery lets the existing app handler check that this trip is
    // still active before displaying a delayed notification after reconnection.
    await admin.messaging().send({ token: driver.fcmToken, data: { type: 'TRIP_END_REMINDER', tripId, eventId: `${tripId}:${+trip.finishReminderAt}`, title: 'Trackefy trip is still active', body: message }, android: { priority: 'high', ttl: 120000 } });
  } catch (error) {
    if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) await Driver.updateOne({ _id: trip.driverId, fcmToken: driver.fcmToken }, { $unset: { fcmToken: 1 } });
    console.error('Driver reminder delivery failed', { code: error.code });
    if (options.throwOnError && !['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) throw error;
  }
}
module.exports = { notifyDriver };

