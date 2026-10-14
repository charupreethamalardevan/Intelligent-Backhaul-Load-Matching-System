require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { connectDB } = require('./config/db');
const apiRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const inviteRoutes = require('./routes/invites');
const adminRoutes = require('./routes/admin');
const vehicleRoutes = require('./routes/vehicles');
const tripRoutes = require('./routes/trips');
const loadRoutes = require('./routes/loads');
const matchingRoutes = require('./routes/matching');
const requestRoutes = require('./routes/requests');

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
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/loads', loadRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/requests', requestRoutes);

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
