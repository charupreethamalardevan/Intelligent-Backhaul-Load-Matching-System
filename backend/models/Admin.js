const mongoose = require('mongoose');

// ER-diagram subtype entity: ADMIN. Same PK-sharing rule as the other
// subtype tables -- _id == the parent users._id. This project's current
// admin login (backend/.env ADMIN_USERNAME/ADMIN_PASSWORD) is a separate,
// simpler mechanism and does NOT go through the users/admin tables; this
// collection exists so the ER-diagram entity is real and so
// AdminActivityLog has a proper adminId to reference once/if admin
// accounts are migrated onto the normal user table. accessLevel lets a
// future multi-admin setup distinguish a full super_admin from a
// moderator who can only approve/reject signups.
const adminSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true }, // == users._id
    accessLevel: { type: String, enum: ['super_admin', 'moderator'], default: 'moderator' },
    lastLoginAt: Date,
  },
  { timestamps: true, _id: false },
);

module.exports = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
