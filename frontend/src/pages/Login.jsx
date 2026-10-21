import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import SiteNav from '../components/SiteNav.jsx';
import { IconEye, IconEyeOff, IconSpinner } from '../components/icons.jsx';
import ParticleBackground, { PARTICLE_COLORS_RESTRAINED } from '../components/ParticleBackground.jsx';
import './Login.css';
import './AuthShared.css';

// Premium redesign: the stage half uses the shared `.auth-canvas` design
// system (AuthShared.css) instead of the round-3 white dot-grid stage.
// `.auth-canvas` follows the site's real light/dark theme toggle (see
// AuthShared.css's header comment -- an earlier version made this canvas
// permanently dark like the Landing hero, reverted per direct user
// feedback). The password visibility toggle below is a pure UI addition
// -- it only flips a local `type` state, never touching the controlled
// `value`/`onChange` wiring or the handleSubmit/apiFetch/login/navigate
// logic, all unchanged.
export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="auth-shell auth-canvas">
      <SiteNav activePage="login" />
      <div className="auth-page">
        <div className="auth-stage">
          <ParticleBackground confined count={34} colors={PARTICLE_COLORS_RESTRAINED} />
          <div className="ac-eyebrow">{t('nav.login')}</div>
          <h1 className="auth-headline ac-enter">Operational control, one login away.</h1>
          <p className="auth-copy ac-enter ac-enter-d1">
            Fleet health, trip status, and booking requests in one calm view -- built for people who manage vehicles and loads
            for a living.
          </p>
          <div className="auth-stat-row ac-enter ac-enter-d2">
            <div>
              <div className="auth-stat-value">5</div>
              <div className="auth-stat-label">Roles supported</div>
            </div>
            <div>
              <div className="auth-stat-value">Live</div>
              <div className="auth-stat-label">Backend data</div>
            </div>
          </div>
        </div>

        <div className="auth-panel-col">
          <div className="auth-form-card ac-enter">
          <h2>{t('auth.loginTitle')}</h2>
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="ac-field">
              <label className="ac-field-label" htmlFor="login-email">{t('auth.email')}</label>
              <div className="ac-input-wrap">
                <input
                  id="login-email"
                  className="ac-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="ac-field">
              <label className="ac-field-label" htmlFor="login-password">{t('auth.password')}</label>
              <div className="ac-input-wrap">
                <input
                  id="login-password"
                  className="ac-input has-toggle"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="ac-input-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={0}
                >
                  {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>
            {error && <p className="ac-error">{error}</p>}
            <button className="ac-btn-primary" type="submit" disabled={loading}>
              {loading && <IconSpinner size={15} className="ac-spin" />}
              {loading ? t('auth.loggingIn') : t('nav.login')}
            </button>
          </form>
          <p className="auth-foot">
            {t('auth.noAccount')}{' '}
            <Link to="/signup" style={{ color: 'var(--primary)', fontWeight: 700 }}>
              {t('nav.signup')}
            </Link>
          </p>
          </div>
        </div>
      </div>
    </div>
  );
}
