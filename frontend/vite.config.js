import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standard Vite + React setup. The dev server runs on 5173 by default,
// which is exactly what backend/server.js already expects as
// FRONTEND_ORIGIN for CORS -- no extra config needed to connect the two.
export default defineConfig({
  plugins: [react()],
});
