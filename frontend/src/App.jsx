import { useEffect, useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import SignupRoleSelect from './pages/SignupRoleSelect.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { API_BASE } from './lib/api.js';

// Talks to the backend's health check (server.js -> routes/index.js) so we
// can prove frontend + backend + DB are all actually connected. Also wires
// up the dark/light toggle using the Forest & Gray theme tokens from
// index.css, and links into the real signup/login flow.
//
// Kept reachable at /status for dev debugging, but no longer the "/" route
// -- the cinematic Landing page owns that now. Same "unlinked unless you
// type the URL" convention as /admin below.
//
// Note: /admin is deliberately not linked from anywhere in this page --
// reaching it means typing the URL directly, same as the original IBLMS
// project's "don't let anyone see it" admin design.
function StatusCheck() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <div className="navbar">
        <div className="brand">
          <span className="mark">IB</span> IBLMS
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link to="/login" className="btn btn-outline">Log in</Link>
          <Link to="/signup" className="btn btn-primary">Sign up</Link>
          <ThemeToggle />
        </div>
      </div>

      <div className="hero">
        <div className="kicker">Setup check</div>
        <h1>Frontend is running.</h1>
        <p>This page just confirms the frontend can reach the backend -- real pages come next.</p>
      </div>

      <div className="card">
        <h3>Backend health</h3>
        {error && <p style={{ color: '#DC2626' }}>Could not reach backend: {error}</p>}
        {!error && !health && <p>Checking...</p>}
        {health && (
          <pre style={{ fontSize: 13, background: 'var(--accent-soft)', padding: 12, borderRadius: 8 }}>
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <button className="btn btn-outline" onClick={() => setDark((d) => !d)}>
      {dark ? '☀ Light mode' : '🌙 Dark mode'}
    </button>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/status" element={<StatusCheck />} />
      <Route path="/signup" element={<SignupRoleSelect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}
