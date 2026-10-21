const express = require('express');

const Rating = require('../models/Rating');
const Match = require('../models/Match');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { scopeOwnerId } = require('./trucks');

// ER-diagram entity: RATING. NOTE (kept here deliberately, not hidden): the
// Project Overview lists a trust/rating system as OUT OF SCOPE / future
// work -- built anyway per the user's request for the full 22-table
// schema. Only reachable for a Match that has reached 'completed', and each
// side may rate the other at most once (enforced by Rating.js's compound
// unique index). Recomputes and caches the ratedUser's average onto
// users.ratingAvg so services/matching.js's scoreReliability() -- which
// already reads this value -- becomes a real signal instead of always
// defaulting to neutral.
const router = express.Router();
router.use(requireAuth);

async function sideOfMatch(req, match) {
  const ownerId = await scopeOwnerId(req);
  if (ownerId && String(ownerId) === String(match.truckOwnerId)) return 'vehicle';
  if (String(req.user.sub) === String(match.loadPosterId)) return 'poster';
  return null;
}

async function recomputeRatingAvg(userId) {
  const ratings = await Rating.find({ ratedUser: userId }).select('ratingValue');
  if (!ratings.length) return;
  const avg = ratings.reduce((sum, r) => sum + r.ratingValue, 0) / ratings.length;
  await User.findByIdAndUpdate(userId, { ratingAvg: Math.round(avg * 10) / 10 });
}

// POST /api/ratings -- rate the OTHER side of a completed match.
router.post('/', async (req, res) => {
  try {
    const { matchId, ratingValue, comment } = req.body;
    if (!matchId || !ratingValue) {
      return res.status(400).json({ error: 'matchId and ratingValue are required.' });
    }
    if (ratingValue < 1 || ratingValue > 5) {
      return res.status(400).json({ error: 'ratingValue must be between 1 and 5.' });
    }

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    const side = await sideOfMatch(req, match);
    if (!side) return res.status(403).json({ error: 'You do not have access to this match.' });
    if (match.status !== 'completed') {
      return res.status(400).json({ error: 'You can only rate a booking once it is completed.' });
    }

    // The other party: whichever side's user I am NOT.
    const ratedUser = side === 'vehicle' ? match.loadPosterId : match.requestedBy;

    const existing = await Rating.findOne({ matchId, ratedBy: req.user.sub });
    if (existing) {
      return res.status(409).json({ error: 'You have already rated this booking.' });
    }

    const rating = await Rating.create({
      matchId,
      ratedBy: req.user.sub,
      ratedUser,
      ratingValue,
      comment,
    });

    await recomputeRatingAvg(ratedUser);

    await Notification.create({
      userId: ratedUser,
      type: 'rating_received',
      title: 'New rating',
      message: `You received a ${ratingValue}-star rating for a completed booking.`,
      relatedMatchId: match._id,
    }).catch(() => {});

    res.status(201).json({ rating });
  } catch (err) {
    console.error('[ratings/create]', err);
    res.status(500).json({ error: 'Could not submit the rating.' });
  }
});

// GET /api/ratings/:matchId -- both ratings (if any) for one match.
router.get('/:matchId', async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    const side = await sideOfMatch(req, match);
    if (!side) return res.status(403).json({ error: 'You do not have access to this match.' });

    const ratings = await Rating.find({ matchId: req.params.matchId });
    res.json({ ratings });
  } catch (err) {
    console.error('[ratings/get]', err);
    res.status(500).json({ error: 'Could not load ratings for this match.' });
  }
});

module.exports = router;
