import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconMoon, IconSun } from './icons.jsx';
import { useTheme } from '../lib/theme.js';
import LanguageSwitcher from './LanguageSwitcher.jsx';

// A small, consistent top bar for the public pages that don't already
// have one of their own (Login, Signup) -- Landing keeps its own bespoke
// `lp-header` inside the cinematic hero and isn't touched here. Reuses
// the existing .navbar/.brand/.mark classes from index.css (previously
// only used by App.jsx's dev-only StatusCheck page) rather than
// introducing a second set of "top bar" styles, and gives these two
// pages the theme toggle + language switcher they previously had no way
// to reach at all (only a dashboard visit ever set those, see lib/theme.js
// and i18n/index.js).
//
// `activePage` hides the link back to the page you're already on, so
// Login doesn't show a "Log in" link to itself.
export default function SiteNav({ activePage }) {
  const { t } = useTranslation();
  const [dark, setDark] = useTheme();

  return (
    <div className="navbar">
      <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'var(--text)' }}>
        <span className="mark">IB</span> IBLMS
      </Link>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Link to="/" className="btn btn-outline" style={{ fontSize: 12.5 }}>
          {t('nav.home')}
        </Link>
        {activePage !== 'login' && (
          <Link to="/login" className="btn btn-outline" style={{ fontSize: 12.5 }}>
            {t('nav.login')}
          </Link>
        )}
        {activePage !== 'signup' && (
          <Link to="/signup" className="btn btn-primary" style={{ fontSize: 12.5 }}>
            {t('nav.signup')}
          </Link>
        )}
        <LanguageSwitcher />
        <button className="ds-icon-btn" onClick={() => setDark((d) => !d)} title={t('common.toggleTheme')} aria-label={t('common.toggleTheme')}>
          {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
      </div>
    </div>
  );
}
