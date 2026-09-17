#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const Bus = require('../models/Bus');
const School = require('../models/School');
const PickupRequest = require('../models/PickupRequest');
const { coordinates, id } = require('../services/routeValidation');
async function migrate({ apply = false, log = console.log } = {}) {
  const counts = { parents: 0, candidates: 0, created: 0, existing: 0, invalid: 0, orphaned: 0, conflicts: 0 };
  if (apply) await PickupRequest.init();
  for await (const parent of Parent.find().select('_id children studentCode stopLocation').lean().cursor()) {
    counts.parents++;
    let location;
    try { location = coordinates(parent.stopLocation); }
    catch { counts.invalid++; log({ parentId: id(parent._id), issue: 'missing_or_invalid_stopLocation' }); continue; }
    let children = parent.children || [];
    if (!children.length && parent.studentCode) {
      const student = await Student.findOne({ studentCode: parent.studentCode }).select('_id').lean();
      if (student) children = [student._id];
    }
    if (!children.length) { counts.orphaned++; log({ parentId: id(parent._id), issue: 'no_linked_student' }); continue; }
    for (const sid of children) {
      const student = await Student.findById(sid).lean();
      const valid = student && await Bus.exists({ _id: student.busId, schoolId: student.schoolId }) && await School.exists({ _id: student.schoolId });
      if (!valid) { counts.orphaned++; log({ parentId: id(parent._id), studentId: id(sid), issue: 'missing_student_school_or_bus' }); continue; }
      const migrationKey = `legacy-stop-v1:${parent._id}:${sid}`;
      const previous = await PickupRequest.findOne({ $or: [{ migrationKey }, { studentId: sid, isCurrent: true }] }).lean();
      if (previous) {
        counts.existing++;
        if (previous.migrationKey !== migrationKey) { counts.conflicts++; log({ parentId: id(parent._id), studentId: id(sid), issue: 'existing_request_retained_for_review' }); }
        continue;
      }
      counts.candidates++;
      if (!apply) { log({ parentId: id(parent._id), studentId: id(sid), action: 'would_create_pending_request' }); continue; }
      try {
        await mongoose.connection.transaction(async session => {
          // Updating the same bus revision serializes against live route edits.
          await Bus.updateOne({ _id: student.busId }, { $inc: { routeRevision: 1 } }, { session });
          await PickupRequest.create([{ parentId: parent._id, studentId: sid, schoolId: student.schoolId, busId: student.busId, requestedLocation: location, submittedBy: 'parent', status: 'pending', migrationKey, reviewNote: 'Imported legacy location; school review required.' }], { session });
          await Parent.updateOne({ _id: parent._id }, { $addToSet: { children: sid } }, { session });
        });
        counts.created++;
      } catch (error) { if (error.code === 11000) counts.existing++; else throw error; }
    }
  }
  log({ mode: apply ? 'apply' : 'dry-run', counts }); return counts;
}
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--confirm-backup')) { console.error('Use --apply --confirm-backup after reviewing dry-run output and taking a backup.'); process.exitCode = 1; }
  else mongoose.connect(process.env.MONGO_URI).then(() => migrate({ apply })).catch(error => { console.error('Migration failed', { name: error.name, code: error.code }); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { migrate };
