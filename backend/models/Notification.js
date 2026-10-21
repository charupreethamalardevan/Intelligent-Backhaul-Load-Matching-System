const mongoose = require('mongoose');

// ER-diagram entity: NOTIFICATION. Wired to real lifecycle events once
// routes/matches.js (the Match-based successor to routes/requests.js) is
// in place: a new row is created whenever a Match changes status (e.g. a
// Fleet Owner approves a driver's request, a load poster accepts a
// request, a booking reaches 'delivered'), and whenever an admin
// approves/rejects a pending signup. There is deliberately no push/email
// delivery -- this is an in-app notification record only, read via
// routes/notifications.js's GET /api/notifications (unread-first).
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['match_status_change', 'admin_approval', 'admin_rejection', 'invite_used', 'rating_received'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    relatedMatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
