const express = require('express');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Document = require('../models/Document');
const AdminActivityLog = require('../models/AdminActivityLog');
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

// ER-diagram weak entity: ADMIN_ACTIVITY_LOG. This app's admin login is a
// single shared env-var credential, not a real User/Admin row (see
// models/Admin.js's own note), so every row logged here carries
// adminId: null and actorLabel: 'env-admin' until that migrates.
function logAdminAction(action, targetType, targetId, details) {
  AdminActivityLog.create({ adminId: null, actorLabel: 'env-admin', action, targetType, targetId, details }).catch((err) =>
    console.error('[admin] could not write AdminActivityLog row:', err.message),
  );
}

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
  logAdminAction('approve_signup', 'User', user._id, { role: user.role, email: user.email });
  res.json({ status: user.status });
});

// POST /api/admin/users/:id/reject
router.post('/users/:id/reject', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  logAdminAction('reject_signup', 'User', user._id, { role: user.role, email: user.email });
  res.json({ status: user.status });
});

// GET /api/admin/documents?status=pending -- ER-diagram DOCUMENT review
// queue. NOTE (kept here deliberately, not hidden): the Project Overview
// lists document/KYC verification as OUT OF SCOPE / future work -- built
// anyway per the user's request for the full 22-table schema, alongside
// (not instead of) the existing pending/approved/rejected gate on the User
// row itself, which still controls login.
router.get('/documents', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.verificationStatus = req.query.status;
  const documents = await Document.find(filter).populate('userId', 'name email role').sort({ uploadedAt: -1 });
  res.json({ documents });
});

router.post('/documents/:id/verify', async (req, res) => {
  const doc = await Document.findByIdAndUpdate(req.params.id, { verificationStatus: 'verified' }, { new: true });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  logAdminAction('verify_document', 'Document', doc._id, { documentType: doc.documentType, userId: doc.userId });
  res.json({ document: doc });
});

router.post('/documents/:id/reject', async (req, res) => {
  const doc = await Document.findByIdAndUpdate(req.params.id, { verificationStatus: 'rejected' }, { new: true });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  logAdminAction('reject_document', 'Document', doc._id, { documentType: doc.documentType, userId: doc.userId });
  res.json({ document: doc });
});

module.exports = router;
