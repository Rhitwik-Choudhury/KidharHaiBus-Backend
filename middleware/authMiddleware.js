// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Check for Bearer token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token missing or invalid' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // store decoded info (like id, role) in request object
    next(); // proceed to next middleware or route
  } catch (err) {
    console.error(err);
    return res.status(403).json({ message: 'Invalid token' });
  }
};

module.exports = auth;
