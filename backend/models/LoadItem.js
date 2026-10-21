const mongoose = require('mongoose');

// ER-diagram weak entity: LOAD_ITEM (multivalued cargo line items on a
// Load). Table Reduction rule #3 (multivalued attribute -> junction table
// with composite PK): the real primary key here is (loadId, itemNumber),
// enforced with a compound unique index below -- not a bare auto _id.
// Most loads in this app are still posted as a single cargo line (see
// routes/loads.js, which creates exactly one LoadItem per Load at
// itemNumber 1 to stay compatible with the existing single-cargoType/
// cargoWeightTonnes fields on Load.js), but the schema supports more.
const loadItemSchema = new mongoose.Schema(
  {
    loadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
    itemNumber: { type: Number, required: true }, // the weak entity's partial key
    cargoType: { type: String, required: true, trim: true },
    weightTonnes: { type: Number, required: true, min: 0.1 },
    description: String,
  },
  { timestamps: true },
);

loadItemSchema.index({ loadId: 1, itemNumber: 1 }, { unique: true });

module.exports = mongoose.models.LoadItem || mongoose.model('LoadItem', loadItemSchema);
