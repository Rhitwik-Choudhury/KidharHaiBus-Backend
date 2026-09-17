const mongoose = require('mongoose');
class RouteError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const assert = (condition, message, status = 400, details) => { if (!condition) throw new RouteError(status, message, details); };
const id = value => String(value?._id || value || '');
const validId = value => mongoose.isObjectIdOrHexString(id(value));
function coordinates(value) {
  assert(value && typeof value.lat === 'number' && typeof value.lng === 'number' && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180, 'Choose a valid map location');
  return { lat: value.lat, lng: value.lng };
}
function ids(values, name = 'Stops', max = 100) {
  assert(Array.isArray(values) && values.length <= max && values.every(validId), `${name} must contain valid IDs (maximum ${max})`);
  assert(new Set(values.map(id)).size === values.length, `${name} contain duplicates`);
  return values.map(id);
}
function date(value, name = 'Date') {
  const result = new Date(value);
  assert(value && Number.isFinite(result.getTime()), `${name} is invalid`);
  return result;
}
const text = (value, max = 500) => String(value || '').trim().slice(0, max);
const isRiding = (student, at = new Date()) => !['not_riding', 'parent_transport'].includes(student.transportStatus) && (student.transportStatus !== 'starts_later' || (student.transportStartsAt && new Date(student.transportStartsAt) <= at));
const activeStop = (stop, at = new Date()) => stop.active !== false && (!stop.expiresAt || new Date(stop.expiresAt) > at);
const role = required => (req, res, next) => req.user?.role === required ? next() : res.status(403).json({ message: `${required} access required` });
const endpoint = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : error.code === 11000 || error.name === 'VersionError' ? 409 : 500);
  if (status === 500) console.error('Route operation failed', { name: error.name, code: error.code });
  res.status(status).json({ message: status === 500 ? 'Unable to complete this operation. Please retry.' : status === 409 && !error.status ? 'This record changed. Refresh and try again.' : error.message, ...(error.details ? { details: error.details } : {}) });
}
module.exports = { RouteError, assert, id, validId, coordinates, ids, date, text, isRiding, activeStop, role, endpoint, errorHandler };
