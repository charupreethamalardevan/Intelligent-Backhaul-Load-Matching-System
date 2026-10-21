const mongoose = require('mongoose');

// ER-diagram entity: PAYMENT, modeled 1:1 with MATCH via a unique FK, per
// the original Table Reduction doc. NOTE (kept here deliberately, not
// hidden): the Project Overview explicitly lists payment processing as
// OUT OF SCOPE / future work for IBLMS as a product. This table is built
// anyway because the user asked for the full 22-table ER diagram to be
// realized as real collections. routes/payments.js exposes only a minimal
// "mark this completed match as paid" action -- there is no real payment
// gateway integration, and transactionRef is a user-entered reference
// string, not a verified transaction id.
const paymentSchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['upi', 'bank_transfer', 'cash', 'card'], required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' },
    transactionRef: String,
    paymentTime: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
