const mongoose = require('mongoose');

// ER-diagram entity: RATING. NOTE (kept here deliberately, not hidden):
// the Project Overview lists a trust/rating system as OUT OF SCOPE /
// future work. Built anyway per the user's request for the full 22-table
// schema. One match can produce up to 2 Rating rows (each side rates the
// other) -- enforced by the compound unique index below, not a 1:1 FK,
// since a match legitimately has 0, 1, or 2 ratings.
// services/matching.js's scoreReliability() already reads an
// `ownerRatingAvg` input -- routes/ratings.js recomputes and caches that
// average onto users.ratingAvg (see User.js) whenever a new Rating is
// created, so the existing reliability factor becomes real instead of
// always defaulting to neutral (70).
const ratingSchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
    ratedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ratedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ratingValue: { type: Number, required: true, min: 1, max: 5 },
    comment: String,
  },
  { timestamps: true },
);

ratingSchema.index({ matchId: 1, ratedBy: 1 }, { unique: true });

module.exports = mongoose.models.Rating || mongoose.model('Rating', ratingSchema);
