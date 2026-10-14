const express = require('express');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// POST /api/admin/login -- JSON: { username, password }, checked against
// .env (ADMIN_USERNAME/ADMIN_PASSWORD), NOT the User collection. Admin has
// no signup, no document, no role -- it's a single shared credential, same
// pattern the original IBLMS project used.
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }
  const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

router.use(requireAdmin);

// GET /api/admin/stats -- quick counts for the dashboard header.
router.get('/stats', async (req, res) => {
  const [total, pending, approved, rejected] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ status: 'pending' }),
    User.countDocuments({ status: 'approved' }),
    User.countDocuments({ status: 'rejected' }),
  ]);
  res.json({ total, pending, approved, rejected });
});

// GET /api/admin/users?status=pending -- status filter optional.
router.get('/users', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const users = await User.find(filter).sort({ createdAt: -1 });
  res.json({
    users: users.map((u) => ({
      id: u._id,
      role: u.role,
      status: u.status,
      name: u.name,
      companyName: u.companyName,
      email: u.email,
      documents: u.documents,
      createdAt: u.createdAt,
    })),
  });
});

// POST /api/admin/users/:id/approve
router.post('/users/:id/approve', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ status: user.status });
});

// POST /api/admin/users/:id/reject
router.post('/users/:id/reject', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ status: user.status });
});

module.exports = router;
