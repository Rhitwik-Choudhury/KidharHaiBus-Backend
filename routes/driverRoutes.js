const express = require('express');
const router = express.Router();
const {
  registerDriver,
  loginDriver
} = require('../controllers/driverController');

// Routes
router.post('/signup', registerDriver);
router.post('/login', loginDriver);

module.exports = router;
