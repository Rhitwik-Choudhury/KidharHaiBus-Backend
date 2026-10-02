const Trip = require('../models/Trip');
const { tickTrip } = require('./tripService');
function startTripWatchdog(io) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const trips = await Trip.find({ status: 'active', $or: [{ 'stopSnapshots.autoSkipAt': { $lte: now } }, { finishCandidateAt: { $ne: null } }] }).select('_id').sort({ updatedAt: 1 }).limit(100).lean();
      for (const trip of trips) {
        try { await tickTrip(trip._id, io); }
        catch (error) { if (error.status !== 423) console.error('Trip watchdog failed', { name: error.name, code: error.code }); }
      }
    } catch (error) { console.error('Trip watchdog unavailable', { name: error.name }); }
    finally { running = false; }
  };
  const timer = setInterval(run, 2000); timer.unref(); run();
  return () => clearInterval(timer);
}
module.exports = { startTripWatchdog };
