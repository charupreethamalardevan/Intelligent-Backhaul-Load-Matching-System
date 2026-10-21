const mongoose = require('mongoose');

// ER-diagram subtype entity: LOAD_POSTER. Same PK-sharing rule as
// TruckOwner.js/Driver.js -- _id == the parent users._id.
const loadPosterSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true }, // == users._id
    businessName: String, // set for business_poster; blank for individual_poster
    businessType: String,
    purpose: String, // set for individual_poster (SRS: why they're posting)
    gstNumber: String,
  },
  { timestamps: true, _id: false },
);

module.exports = mongoose.models.LoadPoster || mongoose.model('LoadPoster', loadPosterSchema);
