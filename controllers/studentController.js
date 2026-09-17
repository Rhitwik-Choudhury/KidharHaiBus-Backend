const mongoose = require('mongoose');
const Student = require('../models/Student');
const Bus = require('../models/Bus');
const Parent = require('../models/Parent');
const planning = require('../services/routePlanning');
const { endpoint, assert, id, text } = require('../services/routeValidation');
const fields = body => Object.fromEntries(['name', 'roll', 'address', 'class'].filter(k => body[k] !== undefined).map(k => [k, text(body[k])]));
async function recount(busId, session) {
  const count = await Student.countDocuments({ busId }).session(session);
  await Bus.updateOne({ _id: busId }, { $set: { studentCount: count }, $inc: { routeRevision: 1 } }, { session });
}
exports.createStudent = endpoint(async (req, res) => {
  const student = await planning.mutate(req.user.id, id(req.body.busId), undefined, async (bus, session) => {
    const studentCode = text(req.body.studentCode, 100).toUpperCase().replace(/[^A-Z0-9]/g, '');
    assert(studentCode, 'Student code is required');
    const [created] = await Student.create([{ ...fields(req.body), studentCode, schoolId: req.user.id, busId: bus._id }], { session });
    await recount(bus._id, session); return created;
  });
  res.status(201).json(student);
});
exports.getStudents = endpoint(async (req, res) => res.json(await Student.find({ schoolId: req.user.id }).populate('busId')));
exports.updateStudent = endpoint(async (req, res) => {
  const updated = await mongoose.connection.transaction(async session => {
    const student = await Student.findOne({ _id: req.params.id, schoolId: req.user.id }).session(session);
    assert(student, 'Student not found', 404);
    const bus = await planning.schoolBus(req.user.id, req.body.busId ? id(req.body.busId) : student.busId, session);
    if (id(student.busId) !== id(bus._id)) {
      const oldBus = student.busId;
      await planning.removeStudentFromDraft(student, session);
      student.busId = bus._id;
      Object.assign(student, fields(req.body)); await student.save({ session });
      await recount(oldBus, session); await recount(bus._id, session);
      // Legacy single-child clients can still read this hint; new code never uses it.
      await Parent.updateMany({ children: student._id, 'children.1': { $exists: false } }, { $set: { busId: bus._id, schoolId: req.user.id } }, { session });
    } else { Object.assign(student, fields(req.body)); await student.save({ session }); }
    return student;
  });
  res.json(await updated.populate('busId'));
});
exports.deleteStudent = endpoint(async (req, res) => {
  await mongoose.connection.transaction(async session => {
    const student = await Student.findOne({ _id: req.params.id, schoolId: req.user.id }).session(session); assert(student, 'Student not found', 404);
    await planning.removeStudentFromDraft(student, session);
    await Parent.updateMany({ children: student._id }, { $pull: { children: student._id } }, { session });
    await student.deleteOne({ session }); await recount(student.busId, session);
  }); res.json({ message: 'Student deleted successfully' });
});
