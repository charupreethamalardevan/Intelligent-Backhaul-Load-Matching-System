import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hi from './locales/hi.json';
import ta from './locales/ta.json';
import te from './locales/te.json';

// Multilingual support: English + Hindi + Tamil + Telugu, picked by the
// user (AskUserQuestion round, Addendum 32). Translations are bundled as
// plain JSON (no translation-hosting service, no API key) and only cover
// the app's global chrome and navigation -- sidebar/topbar labels, section
// titles, auth screens, booking statuses, and the map's own labels -- not
// yet every field label inside every form (see Addendum 32's "Next steps"
// for the follow-up list). Picking a language changes that chrome
// everywhere at once, immediately, with no page reload.
const STORAGE_KEY = 'iblms_lang';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
];
const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

function getSavedLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_CODES.includes(saved) ? saved : 'en';
  } catch {
    // private-window/blocked storage -- just default to English
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    ta: { translation: ta },
    te: { translation: te },
  },
  lng: getSavedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false,
});

export function setLanguage(code) {
  if (!SUPPORTED_CODES.includes(code)) return;
  i18n.changeLanguage(code);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // private-window/blocked storage -- the choice just won't persist
  }
}

export default i18n;
