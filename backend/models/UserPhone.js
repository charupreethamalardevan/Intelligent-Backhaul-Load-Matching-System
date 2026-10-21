const mongoose = require('mongoose');

// ER-diagram weak entity: USER_PHONE (multivalued attribute -- a user may
// list more than one contact number: primary, alternate, WhatsApp).
// Composite PK (userId, phoneNumber), same reduction rule as LoadItem.js/
// LoadLandmark.js. The existing single `users.phone` field (User.js) is
// left as-is and still drives login/display everywhere; this table is the
// real multivalued extension, seeded from that single field by the
// migration script (scripts/migrateTo22Tables.js) as each user's first
// 'primary' row.
const userPhoneSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    phoneNumber: { type: String, required: true }, // the weak entity's partial key
    phoneType: { type: String, enum: ['primary', 'alternate', 'whatsapp'], default: 'primary' },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

userPhoneSchema.index({ userId: 1, phoneNumber: 1 }, { unique: true });

module.exports = mongoose.models.UserPhone || mongoose.model('UserPhone', userPhoneSchema);
