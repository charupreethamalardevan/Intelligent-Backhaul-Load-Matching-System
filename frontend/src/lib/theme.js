import { useEffect, useState } from 'react';

const THEME_KEY = 'iblms_theme';

// Shared by every page that offers a theme toggle (previously only
// DashboardShell had this logic, so Landing/Login/Signup had no toggle at
// all and silently inherited whatever `data-theme` a dashboard visit had
// last set). Pulled out so SiteNav (Addendum 32) and DashboardShell use
// the exact same persisted choice instead of two toggles that could drift
// out of sync with each other.
export function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // private-window/blocked storage -- theme just won't persist, UI still works
    }
  }, [dark]);

  return [dark, setDark];
}
