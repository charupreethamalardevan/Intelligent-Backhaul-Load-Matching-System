const mongoose = require('mongoose');

// ER-diagram subtype entity: DRIVER. Same PK-sharing rule as TruckOwner.js:
// _id == the parent users._id, set explicitly at creation (routes/auth.js
// for a self-service 'driver' signup; routes/invites.js when a Fleet
// Driver redeems an invite code). truckOwnerId links a Fleet Driver to the
// Fleet Owner's TruckOwner row they drive for; for an Independent
// Owner-Driver this equals their OWN TruckOwner._id (same person, both
// subtype rows), matching the SRS's "Independent Owner-Driver" user type.
const driverSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true }, // == users._id
    truckOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'TruckOwner', required: true },
    licenseNumber: String,
    licenseExpiry: Date,
    yearsOfExperience: Number,
  },
  { timestamps: true, _id: false },
);

module.exports = mongoose.models.Driver || mongoose.model('Driver', driverSchema);
