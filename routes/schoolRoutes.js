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
  deleteStudent
} = require('../controllers/schoolController');

const auth = require('../middleware/authMiddleware'); // Middleware to protect routes

const { addBus, getBuses } = require('../controllers/schoolController');

router.post('/buses', authMiddleware, addBus);
router.get('/buses', authMiddleware, getBuses);

// ====== School Auth Routes ======
router.post('/signup', registerSchool);
router.post('/login', loginSchool);

// ====== Student Management Routes (Protected) ======
router.post('/students', auth, addStudent);           // Add student
router.get('/students', auth, getStudents);           // Get all students of the school
router.put('/students/:id', auth, updateStudent);     // Edit student
router.delete('/students/:id', auth, deleteStudent);  // Delete student

module.exports = router;
