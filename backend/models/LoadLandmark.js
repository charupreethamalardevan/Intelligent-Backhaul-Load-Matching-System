const mongoose = require('mongoose');

// ER-diagram weak entity: LOAD_LANDMARK (multivalued map landmarks tied to
// a Load -- pickup point, delivery point, and any checkpoints in between,
// per the Map and Route Module's "pickup/destination/detour" display
// requirements). Composite PK (loadId, landmarkNumber), same reduction
// rule as LoadItem.js.
const loadLandmarkSchema = new mongoose.Schema(
  {
    loadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
    landmarkNumber: { type: Number, required: true }, // the weak entity's partial key
    label: { type: String, required: true },
    lat: Number,
    lng: Number,
    kind: { type: String, enum: ['pickup_point', 'delivery_point', 'checkpoint'], required: true },
  },
  { timestamps: true },
);

loadLandmarkSchema.index({ loadId: 1, landmarkNumber: 1 }, { unique: true });

module.exports = mongoose.models.LoadLandmark || mongoose.model('LoadLandmark', loadLandmarkSchema);
