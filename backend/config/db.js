const mongoose = require('mongoose');

// Connects to MongoDB using MONGO_URI from the environment. Called once
// from server.js at startup. Deliberately does NOT crash the process on
// failure -- the API can still boot and serve /api/health (reporting the
// DB as unreachable) rather than the whole service going down just because
// MongoDB isn't running yet during setup.
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn('[db] MONGO_URI is not set -- skipping database connection.');
    return false;
  }

  // Without this, any query made while disconnected sits queued for
  // Mongoose's default 10s bufferTimeoutMS before failing, instead of
  // erroring immediately. Fail fast instead.
  mongoose.set('bufferCommands', false);

  try {
    // Fail fast (3s) instead of Mongoose's 30s default when nothing is
    // listening, so the API still boots quickly during local setup even
    // before MongoDB is running.
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    console.log('[db] Connected to MongoDB.');
    return true;
  } catch (err) {
    console.error('[db] Failed to connect to MongoDB:', err.message);
    return false;
  }
}

module.exports = { connectDB };