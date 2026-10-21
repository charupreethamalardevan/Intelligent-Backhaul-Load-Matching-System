import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBell, IconLogout, IconMenu, IconMoon, IconSearch, IconSun, IconX } from './icons.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import NotificationBell from './NotificationBell.jsx';
import { useTheme } from '../lib/theme.js';
import ParticleBackground, { PARTICLE_COLORS } from './ParticleBackground.jsx';
import './DashboardShell.css';

// Round-1 UI/UX rebuild REMOVED the always-on drifting ParticleBackground
// canvas from this operational app shell -- the design brief at the time
// was explicit that cinematic effects belonged on the marketing/landing
// page only, not a screen people scan data on all day. Round 5: the user
// explicitly overrode that, twice, asking for the moving particle
// background "in all screen" -- so it's back here, confined to `.ds-main`
// (mounted as its first child, before the topbar, sized to the content
// area to the right of the sidebar -- never the sidebar itself, which
// stays the quiet near-black chrome it's always been) and multi-colored
// via `PARTICLE_COLORS` to match the Antigravity reference. It sits at
// `z-index: -1` (`ParticleBackground.css`'s `--confined` variant) behind
// `.ds-topbar`'s translucent bar and every data card/table's own opaque
// background, so it only actually shows in the margins around them --
// deliberately kept that subtle rather than density-matched to the
// marketing pages, since real data still needs to stay the most legible
// thing on these screens.

// Shared sidebar + topbar shell for the Admin / Fleet / Poster dashboards.
// `navSections` is [{ title?, items: [{ key, label, icon, badge? }] }].
// The caller owns what "active" means and what renders in `children` --
// this component only draws the chrome around it.
export default function DashboardShell({
  brandMark = 'IB',
  brandName = 'IBLMS',
  navSections,
  activeKey,
  onNavigate,
  pageTitle,
  pageSubtitle,
  userLabel,
  userSub,
  onLogout,
  // Admin has no User row (a single shared env-var login, see
  // AdminPage.jsx) so it has nothing for routes/notifications.js to key
  // on -- AdminPage passes false here and keeps the old static bell;
  // Fleet/Poster dashboards (real users) get the real, wired-up one.
  notificationsEnabled = true,
  children,
}) {
  const { t } = useTranslation();
  const [dark, setDark] = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile sidebar automatically after a nav click so the user
  // isn't left staring at an overlay on a small screen.
  function handleNavigate(key) {
    onNavigate(key);
    setMobileOpen(false);
  }

  return (
    <div className="ds-shell">
      {mobileOpen && <div className="ds-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`ds-sidebar${mobileOpen ? ' ds-sidebar-open' : ''}`}>
        <div className="ds-sidebar-top">
          <div className="ds-brand">
            <span className="ds-brand-mark">{brandMark}</span>
            <span className="ds-brand-name">{brandName}</span>
          </div>
          <button className="ds-icon-btn ds-mobile-only" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <IconX size={18} />
          </button>
        </div>

        <nav className="ds-nav">
          {navSections.map((section, i) => (
            <div className="ds-nav-section" key={section.title || i}>
              {section.title && <div className="ds-nav-title">{section.title}</div>}
              {section.items.map((item) => {
                const ItemIcon = item.icon;
                const active = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    className={`ds-nav-item${active ? ' ds-nav-item-active' : ''}`}
                    onClick={() => handleNavigate(item.key)}
                  >
                    {ItemIcon && <ItemIcon size={17} />}
                    <span>{item.label}</span>
                    {item.badge != null && item.badge !== 0 && <span className="ds-nav-badge">{item.badge}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="ds-sidebar-footer">
          <div className="ds-sidebar-user">
            <div className="ds-avatar">{(userLabel || '?').slice(0, 1).toUpperCase()}</div>
            <div className="ds-sidebar-user-text">
              <div className="ds-sidebar-user-name">{userLabel}</div>
              {userSub && <div className="ds-sidebar-user-sub">{userSub}</div>}
            </div>
          </div>
          <button className="ds-icon-btn" onClick={onLogout} aria-label={t('nav.logout')} title={t('nav.logout')}>
            <IconLogout size={17} />
          </button>
        </div>
      </aside>

      <div className="ds-main">
        <ParticleBackground confined count={34} colors={PARTICLE_COLORS} />
        <header className="ds-topbar">
          <div className="ds-topbar-left">
            <button className="ds-icon-btn ds-mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <IconMenu size={19} />
            </button>
            <div>
              {pageTitle && <div className="ds-page-title">{pageTitle}</div>}
              {pageSubtitle && <div className="ds-page-subtitle">{pageSubtitle}</div>}
            </div>
          </div>
          <div className="ds-topbar-right">
            <div className="ds-search ds-desktop-only">
              <IconSearch size={15} />
              <input className="ds-search-input" placeholder={t('common.search')} disabled title="Search coming soon" />
            </div>
            <LanguageSwitcher />
            {notificationsEnabled ? (
              <NotificationBell />
            ) : (
              <button className="ds-icon-btn" title={t('common.notifications')} aria-label={t('common.notifications')}>
                <IconBell size={17} />
              </button>
            )}
            <button className="ds-icon-btn" onClick={() => setDark((d) => !d)} title={t('common.toggleTheme')} aria-label={t('common.toggleTheme')}>
              {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
            </button>
          </div>
        </header>

        <main className="ds-content">{children}</main>
      </div>
    </div>
  );
}
