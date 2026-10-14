const mongoose = require('mongoose');

const inviteCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    fleetOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // The Fleet Owner uploads the driver's license right here, when they
    // generate the code -- the driver themself never uploads a document
    // at their own signup (see routes/auth.js SUBTYPES.driver).
    licenseDoc: {
      filename: String,
      path: String,
      mimeType: String,
    },

    driverName: String, // optional label, e.g. "for Suresh"
    used: { type: Boolean, default: false },
    usedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    usedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model('InviteCode', inviteCodeSchema);
