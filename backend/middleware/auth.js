const jwt = require('jsonwebtoken');

// Reads "Authorization: Bearer <token>", verifies it, and attaches the
// decoded payload ({ sub: userId, role }) to req.user. Any route that
// needs a logged-in user puts this in front of itself as middleware.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No token provided.' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { requireAuth };