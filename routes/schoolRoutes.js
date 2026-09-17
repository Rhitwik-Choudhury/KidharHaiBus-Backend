// backend/routes/schoolRoutes.js
const authMiddleware = require('../middleware/authMiddleware');
const express = require('express');
const router = express.Router();
const {
  registerSchool,
  loginSchool,
  addStudent,
  getStudents,
  updateStudent,
  deleteStudent,
  sendSchoolOTP,
  getDashboardStats,
} = require('../controllers/schoolController');

const auth = require('../middleware/authMiddleware'); // Middleware to protect routes
const schoolOnly = require('../services/routeValidation').role('school');

const { addBus, getBuses } = require('../controllers/schoolController');

router.post("/send-otp", sendSchoolOTP);
router.post('/buses', authMiddleware, schoolOnly, addBus);
router.get('/buses', authMiddleware, schoolOnly, getBuses);

// ====== School Auth Routes ======
router.post('/signup', registerSchool);
router.post('/login', loginSchool);

// ====== Dashboard ======
router.get('/dashboard-stats', auth, schoolOnly, getDashboardStats);

// ====== Student Management Routes (Protected) ======
router.post('/students', auth, schoolOnly, addStudent);           // Add student
router.get('/students', auth, schoolOnly, getStudents);           // Get all students of the school
router.put('/students/:id', auth, schoolOnly, updateStudent);     // Edit student
router.delete('/students/:id', auth, schoolOnly, deleteStudent);  // Delete student

module.exports = router;
