const express = require('express');

const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

// ER-diagram entity: NOTIFICATION -- in-app only, no push/email delivery.
// Rows are created from routes/matches.js (status changes), routes/
// ratings.js (rating received), routes/payments.js (payment recorded), and
// routes/admin.js (signup approved/rejected). This file just reads them
// back, unread-first.
const router = express.Router();
router.use(requireAuth);

// GET /api/notifications -- mine, unread-first.
router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.sub }).sort({ isRead: 1, createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ userId: req.user.sub, isRead: false });
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[notifications/list]', err);
    res.status(500).json({ error: 'Could not load notifications.' });
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found.' });
    if (String(notification.userId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You do not have access to this notification.' });
    }
    notification.isRead = true;
    await notification.save();
    res.json({ notification });
  } catch (err) {
    console.error('[notifications/mark-read]', err);
    res.status(500).json({ error: 'Could not mark the notification as read.' });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.sub, isRead: false }, { $set: { isRead: true } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications/mark-all-read]', err);
    res.status(500).json({ error: 'Could not mark notifications as read.' });
  }
});

module.exports = router;
