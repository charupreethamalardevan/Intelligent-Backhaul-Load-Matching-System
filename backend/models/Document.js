const mongoose = require('mongoose');

// ER-diagram entity: DOCUMENT -- per-user verification documents (license,
// RC book, permit, GST, Aadhaar/KYC). NOTE (kept here deliberately, not
// hidden): the Project Overview lists document/KYC verification as OUT OF
// SCOPE / future work; this table is built anyway per the user's request,
// but is wired to real existing upload data: routes/auth.js already
// stores uploaded registration documents on users.documents[] (ownership/
// license docs for fleet_owner/owner_driver) and routes/invites.js stores
// a driver's license doc on the InviteCode when a Fleet Owner generates
// it. The migration script (scripts/migrateTo22Tables.js) copies both of
// those into real Document rows here so this table starts populated with
// real data instead of empty.
const documentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    documentType: { type: String, enum: ['ownership_doc', 'license_doc', 'rc_book', 'permit', 'gst', 'aadhaar'], required: true },
    filename: String,
    path: String,
    mimeType: String,
    verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Document || mongoose.model('Document', documentSchema);
