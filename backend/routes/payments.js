const express = require('express');

const Payment = require('../models/Payment');
const Match = require('../models/Match');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { scopeOwnerId } = require('./trucks');

// ER-diagram entity: PAYMENT. NOTE (kept here deliberately, not hidden):
// IBLMS's own Project Overview lists payment processing as OUT OF SCOPE /
// future work -- this route is built anyway per the user's explicit
// request to realize the full 22-table ER diagram as real, used
// collections. There is no payment gateway here: this is a "both sides
// agree the booking was paid, record it" action, with transactionRef as a
// free-text reference the payer types in, never a verified transaction id.
// Only reachable for a Match that has already reached 'completed'.
const router = express.Router();
router.use(requireAuth);

async function sideOfMatch(req, match) {
  const ownerId = await scopeOwnerId(req);
  if (ownerId && String(ownerId) === String(match.truckOwnerId)) return 'vehicle';
  if (String(req.user.sub) === String(match.loadPosterId)) return 'poster';
  return null;
}

// POST /api/payments -- record a payment for a completed match.
router.post('/', async (req, res) => {
  try {
    const { matchId, amount, method, transactionRef } = req.body;
    if (!matchId || !amount || !method) {
      return res.status(400).json({ error: 'matchId, amount and method are required.' });
    }

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    const side = await sideOfMatch(req, match);
    if (!side) return res.status(403).json({ error: 'You do not have access to this match.' });
    if (match.status !== 'completed') {
      return res.status(400).json({ error: 'A payment can only be recorded once the booking is completed.' });
    }

    const existing = await Payment.findOne({ matchId });
    if (existing) {
      return res.status(409).json({ error: 'A payment has already been recorded for this match.' });
    }

    const payment = await Payment.create({
      matchId,
      amount,
      method,
      transactionRef,
      status: 'completed',
      paymentTime: new Date(),
    });

    const otherPartyUserId = side === 'vehicle' ? match.loadPosterId : match.requestedBy;
    await Notification.create({
      userId: otherPartyUserId,
      type: 'match_status_change',
      title: 'Payment recorded',
      message: `A payment of ${amount} was recorded for your completed booking.`,
      relatedMatchId: match._id,
    }).catch(() => {});

    res.status(201).json({ payment });
  } catch (err) {
    console.error('[payments/create]', err);
    res.status(500).json({ error: 'Could not record the payment.' });
  }
});

// GET /api/payments/:matchId -- the payment recorded for one match, if any.
router.get('/:matchId', async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    const side = await sideOfMatch(req, match);
    if (!side) return res.status(403).json({ error: 'You do not have access to this match.' });

    const payment = await Payment.findOne({ matchId: req.params.matchId });
    res.json({ payment: payment || null });
  } catch (err) {
    console.error('[payments/get]', err);
    res.status(500).json({ error: 'Could not load the payment.' });
  }
});

module.exports = router;
