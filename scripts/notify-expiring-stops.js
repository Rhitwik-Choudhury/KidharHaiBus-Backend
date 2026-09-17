#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Stop = require('../models/RouteStop');
const { parentIdsFor } = require('../services/routePlanning');
const { notifyParent } = require('../services/routeNotifications');
async function run() {
  const now = new Date(), until = new Date(+now + 86400000);
  for await (const stop of Stop.find({ active: true, expiresAt: { $gte: now, $lte: until } }).cursor()) {
    for (const parentId of await parentIdsFor(stop.studentIds)) await notifyParent(parentId, `expiry:${stop._id}:${stop.expiresAt.toISOString()}`, 'TEMPORARY_STOP_EXPIRING', 'Your temporary transport stop expires within 24 hours. Please contact the school.', null, { busId: String(stop.busId) });
  }
}
if (require.main === module) mongoose.connect(process.env.MONGO_URI).then(run).catch(() => { console.error('Expiry notification job failed'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = { run };
