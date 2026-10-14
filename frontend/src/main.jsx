import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './i18n/index.js';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Offline backup map (Addendum 32): a tiny service worker that caches map
// tiles as they're actually viewed, so a route already seen once still
// renders with no network. Feature-detected and registered fire-and-forget
// -- nothing in the app depends on it succeeding, an unsupported or
// blocked browser just never gets the offline fallback.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
