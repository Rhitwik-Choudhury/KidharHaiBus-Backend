const express = require('express');
const router = express.Router();
const { registerParent, loginParent } = require('../controllers/parentController');

// POST /api/parent/signup
router.post('/signup', registerParent);

// POST /api/parent/login
router.post('/login', loginParent);

module.exports = router;
