const express = require('express');
const crypto = require('crypto');

const InviteCode = require('../models/InviteCode');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

function requireFleetOwner(req, res, next) {
  if (req.user.role !== 'fleet_owner') {
    return res.status(403).json({ error: 'Only Fleet Owners can do this.' });
  }
  next();
}

// POST /api/invites -- multipart/form-data: driver_name (optional) +
// license_doc (required). The Fleet Owner uploads the driver's license
// RIGHT HERE, at creation time -- the driver never uploads a document when
// they sign up with this code (see routes/auth.js SUBTYPES.driver).
router.post('/', requireFleetOwner, upload.single('license_doc'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload the driver's license document." });
    }

    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const invite = await InviteCode.create({
      code,
      fleetOwnerId: req.user.sub,
      driverName: req.body.driver_name || '',
      licenseDoc: { filename: req.file.originalname, path: req.file.path, mimeType: req.file.mimetype },
    });

    res.status(201).json({ code: invite.code, driverName: invite.driverName, createdAt: invite.createdAt });
  } catch (err) {
    console.error('[invites/create]', err);
    res.status(500).json({ error: 'Could not create invite code. Please try again.' });
  }
});

// GET /api/invites -- this Fleet Owner's invite codes, used + unused.
router.get('/', requireFleetOwner, async (req, res) => {
  const invites = await InviteCode.find({ fleetOwnerId: req.user.sub }).sort({ createdAt: -1 });
  res.json({
    invites: invites.map((i) => ({
      code: i.code,
      driverName: i.driverName,
      used: i.used,
      createdAt: i.createdAt,
      usedAt: i.usedAt,
    })),
  });
});

module.exports = router;
