const mongoose = require('mongoose');
const { ROLE_IDS } = require('../utils/roles');

const documentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    filename: String,
    path: String,
    mimeType: String,
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, enum: ROLE_IDS },
    // business_poster/individual_poster/driver need no document, so they
    // start approved. fleet_owner/owner_driver upload a document and start
    // pending until an admin reviews it (admin review isn't built yet --
    // for now these two just won't be able to log in until manually
    // flipped to 'approved' in the database).
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },

    name: String,
    companyName: String,
    businessType: String,
    purpose: String,
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: String,
    passwordHash: { type: String, required: true },

    documents: [documentSchema],

    // Only set for role === 'driver' (Fleet Driver), via the invite code.
    fleetOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    inviteCodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'InviteCode' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
