const jwt = require('jsonwebtoken');

// Admin sessions are deliberately separate from the regular User/JWT
// system -- the token carries { admin: true } instead of a user id, and is
// checked against that flag, not against any User document.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No admin token provided.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.admin) return res.status(403).json({ error: 'Not an admin token.' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired admin session.' });
  }
}

module.exports = { requireAdmin };
