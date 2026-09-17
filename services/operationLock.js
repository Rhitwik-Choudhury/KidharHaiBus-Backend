const { randomUUID } = require('crypto');
const OperationLock = require('../models/OperationLock');
const { RouteError } = require('./routeValidation');
async function withLock(key, operation) {
  const owner = randomUUID(), now = new Date();
  try {
    const lock = await OperationLock.findOneAndUpdate({ _id: key, expiresAt: { $lte: now } }, { $set: { owner, expiresAt: new Date(+now + 120000) } }, { upsert: true, new: true });
    if (!lock || lock.owner !== owner) throw new RouteError(423, 'A trip update is in progress. Please retry shortly.');
  } catch (error) {
    if (error.code === 11000) throw new RouteError(423, 'A trip update is in progress. Please retry shortly.');
    throw error;
  }
  try { return await operation(); } finally { await OperationLock.deleteOne({ _id: key, owner }); }
}
module.exports = { withLock };
