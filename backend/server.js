require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { connectDB } = require('./config/db');
const apiRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const inviteRoutes = require('./routes/invites');
const adminRoutes = require('./routes/admin');
const truckRoutes = require('./routes/trucks'); // mounted at /api/vehicles -- see routes/trucks.js header comment
const routeRoutes = require('./routes/truckRoutes'); // mounted at /api/trips -- see routes/truckRoutes.js header comment
const loadRoutes = require('./routes/loads');
const matchingRoutes = require('./routes/matching');
const matchRoutes = require('./routes/matches'); // mounted at /api/requests -- see routes/matches.js header comment
const insightsRoutes = require('./routes/insights');
const paymentRoutes = require('./routes/payments');
const ratingRoutes = require('./routes/ratings');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());

app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/admin', adminRoutes);
// ER-diagram migration: these 3 mount points keep their ORIGINAL paths
// (/api/vehicles, /api/trips, /api/requests) for full frontend backward
// compatibility, but are now served by trucks.js/truckRoutes.js/matches.js,
// which read and write the real `trucks`/`routes`/`matches` collections
// (ER diagram's TRUCK/ROUTE/MATCH entities) instead of the old
// `vehicles`/`trips`/`loadrequests` ones. See each file's header comment.
app.use('/api/vehicles', truckRoutes);
app.use('/api/trips', routeRoutes);
app.use('/api/requests', matchRoutes);
app.use('/api/loads', loadRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/insights', insightsRoutes);
// New ER-diagram-only routes -- Payment/Rating/Document(admin-side) are
// features the Project Overview lists as out of scope, built anyway per
// the user's explicit request for the full 22-table schema to be real and
// used. Document verification itself is under /api/admin/documents (see
// routes/admin.js) since it's an admin-only review queue, not a user-
// facing CRUD resource.
app.use('/api/payments', paymentRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/', (req, res) => {
  res.send('IBLMS learn backend is running. Try /api/health.');
});

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[server] IBLMS learn backend listening on port ${PORT}`);
  });
}

start();
