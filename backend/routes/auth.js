const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const InviteCode = require('../models/InviteCode');
const { upload } = require('../middleware/upload');
const { SUBTYPES } = require('../utils/roles');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function publicUser(user) {
  return { id: user._id, role: user.role, name: user.name, email: user.email, status: user.status };
}

// POST /api/auth/register -- multipart/form-data: role + that role's
// required text fields + that role's required document(s) (SUBTYPES in
// utils/roles.js). Validated against SUBTYPES server-side, never trusting
// whatever the client happened to send.
router.post('/register', upload.any(), async (req, res) => {
  try {
    const role = req.body.role;
    const config = SUBTYPES[role];
    if (!config) {
      return res.status(400).json({ error: `Unknown role "${role}".` });
    }

    if (!req.body.email || !req.body.password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const missingFields = config.fields.filter((f) => !String(req.body[f] || '').trim());
    if (missingFields.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missingFields.join(', ')}` });
    }

    const filesByField = Object.fromEntries((req.files || []).map((f) => [f.fieldname, f]));
    const missingDocs = config.docs.filter((d) => !filesByField[d]);
    if (missingDocs.length) {
      return res.status(400).json({ error: `Missing required document(s): ${missingDocs.join(', ')}` });
    }

    const email = String(req.body.email).toLowerCase().trim();
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    let fleetOwnerId;
    let inviteDoc;
    if (role === 'driver') {
      const code = String(req.body.invite_code || '').toUpperCase().trim();
      inviteDoc = await InviteCode.findOne({ code });
      if (!inviteDoc) {
        return res.status(400).json({ error: 'That invite code was not found.' });
      }
      if (inviteDoc.used) {
        return res.status(400).json({ error: 'That invite code has already been used.' });
      }
      fleetOwnerId = inviteDoc.fleetOwnerId;
    }

    const passwordHash = await bcrypt.hash(req.body.password, 10);

    const documents = config.docs.map((key) => {
      const file = filesByField[key];
      return { key, filename: file.originalname, path: file.path, mimeType: file.mimetype };
    });

    const user = await User.create({
      role,
      status: config.requiresApproval ? 'pending' : 'approved',
      name: req.body.name,
      companyName: req.body.company_name,
      businessType: req.body.business_type,
      purpose: req.body.purpose,
      email,
      phone: req.body.phone,
      passwordHash,
      documents,
      fleetOwnerId,
      inviteCodeId: inviteDoc ? inviteDoc._id : undefined,
    });

    if (inviteDoc) {
      inviteDoc.used = true;
      inviteDoc.usedByUserId = user._id;
      inviteDoc.usedAt = new Date();
      await inviteDoc.save();
    }

    res.status(201).json({
      status: user.status,
      message:
        user.status === 'approved'
          ? 'Account created. You can log in now.'
          : 'Account created. It will stay pending until an admin approves your document.',
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login -- JSON: { email, password }
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordOk = await bcrypt.compare(String(req.body.password || ''), user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({
        error:
          user.status === 'pending'
            ? 'Your account is still pending admin approval.'
            : 'Your account was not approved. Contact support.',
      });
    }

    const token = jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me -- requires a valid token; returns who you're logged in as.
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
