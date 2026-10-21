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

    // ER-diagram field USERS.rating_avg -- a cached aggregate of every
    // Rating row where this user is the ratedUser (models/Rating.js),
    // recomputed by routes/ratings.js whenever a new rating comes in
    // (never aggregated on every read). Feeds services/matching.js's
    // scoreReliability() -- null until this user has received at least one
    // rating, same "no fabricated track record" default that function
    // already uses.
    ratingAvg: { type: Number, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
