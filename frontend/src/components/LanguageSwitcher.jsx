import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES } from '../i18n/index.js';

// A plain, native <select> rather than a custom dropdown -- works with
// screen readers and keyboard nav for free, and needs no outside-click
// handling. `variant="dark"` is for the Landing page's sealed dark hero
// header (lp-chrome), which doesn't use the app's light/dark CSS tokens at
// all; everywhere else (DashboardShell topbar, SiteNav) uses the default
// variant, styled from the normal Forest & Gray tokens so it matches
// whichever theme is active.
export default function LanguageSwitcher({ variant }) {
  const { t, i18n } = useTranslation();
  return (
    <select
      className={`lang-switch${variant === 'dark' ? ' lang-switch-dark' : ''}`}
      value={i18n.language}
      onChange={(e) => setLanguage(e.target.value)}
      aria-label={t('common.chooseLanguage')}
      title={t('common.chooseLanguage')}
    >
      {SUPPORTED_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
