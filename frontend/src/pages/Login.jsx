import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import SiteNav from '../components/SiteNav.jsx';

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page" style={{ maxWidth: 420, paddingTop: 24 }}>
        <SiteNav activePage="login" />
        <div className="card" style={{ marginTop: 40 }}>
        <h3>{t('auth.loginTitle')}</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="login-email">{t('auth.email')}</label>
            <input
              id="login-email"
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="login-password">{t('auth.password')}</label>
            <input
              id="login-password"
              className="input"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? t('auth.loggingIn') : t('nav.login')}
          </button>
        </form>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 14 }}>
          {t('auth.noAccount')}{' '}
          <Link to="/signup" style={{ color: 'var(--primary)', fontWeight: 700 }}>
            {t('nav.signup')}
          </Link>
        </p>
      </div>
      </div>
    </>
  );
}
