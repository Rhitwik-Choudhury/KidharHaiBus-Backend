const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Parent = require('../models/Parent');

/**
 * POST /api/parent/signup
 * Accepts: { name?, fullName?, email, password, studentCode? }
 * Notes:
 * - Frontend sends `name` (your form) – we store as `fullName`.
 * - Returns { user: { id, fullName, email, studentCode }, token }
 */
exports.registerParent = async (req, res) => {
  try {
    const { name, fullName, email, password, studentCode } = req.body;

    // Accept "name" from the form or "fullName"; require something non-empty
    const displayName = (fullName || name || '').trim();
    if (!displayName || !email || !password) {
      return res
        .status(400)
        .json({ message: 'Full name, email and password are required' });
    }

    // Ensure email is unique
    const exists = await Parent.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const hash = await bcrypt.hash(password, 10);

    // Create the parent
    const parent = await Parent.create({
      fullName: displayName,
      email,
      password: hash,
      studentCode: studentCode || null,
      children: [],
    });

    // Create a JWT (optional but useful if you want to auto-login after signup)
    const token = jwt.sign(
      { id: parent._id.toString(), role: 'parent' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.status(201).json({
      message: 'Parent registered successfully',
      token,
      user: {
        id: parent._id.toString(),
        fullName: parent.fullName,
        email: parent.email,
        studentCode: parent.studentCode || null,
      },
    });
  } catch (err) {
    console.warn('Parent Register Error:', err);

    // Helpful duplicate-key response (e.g., email)
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res
        .status(400)
        .json({ message: `Duplicate ${field}. Please use another.` });
    }

    return res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * POST /api/parent/login
 * Accepts: { email, password }
 * Returns: { user, token }
 */
exports.loginParent = async (req, res) => {
  try {
    const { email, password } = req.body;

    const parent = await Parent.findOne({ email });
    if (!parent) {
      return res.status(400).json({ message: 'Parent not found' });
    }

    const ok = await bcrypt.compare(password, parent.password);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: parent._id.toString(), role: 'parent' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: parent._id.toString(),
        fullName: parent.fullName,
        email: parent.email,
        studentCode: parent.studentCode || null,
      },
    });
  } catch (err) {
    console.warn('Parent Login Error:', err);
    return res.status(500).json({ message: 'Server Error' });
  }
};
