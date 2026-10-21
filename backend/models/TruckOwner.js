const mongoose = require('mongoose');

// ER-diagram subtype entity: TRUCK_OWNER. Per the original Table Reduction
// doc's rule #1 (subtype/ISA entities -> parent PK doubles as child
// PK+FK), this document's _id is always set to the SAME ObjectId as its
// parent `users` row (never a fresh auto-generated _id) -- see
// routes/auth.js, which creates this row right after creating the User.
// An "Independent Owner-Driver" (role 'owner_driver') has BOTH a
// TruckOwner row and a Driver row sharing that same _id -- the overlapping
// subtype pattern the SRS's user-characteristics section describes.
const truckOwnerSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true }, // == users._id
    companyName: String, // set for fleet_owner; left blank for owner_driver
    gstNumber: String,
    address: String,
    // Cached count of this owner's active trucks (Truck.truckOwnerId ==
    // this _id). Recomputed whenever a truck is added/removed -- see
    // routes/trucks.js -- rather than aggregated on every read.
    fleetSize: { type: Number, default: 0 },
  },
  { timestamps: true, _id: false },
);

module.exports = mongoose.models.TruckOwner || mongoose.model('TruckOwner', truckOwnerSchema);
