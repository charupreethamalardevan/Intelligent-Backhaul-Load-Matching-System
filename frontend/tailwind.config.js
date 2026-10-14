/** IBLMS premium design-system Tailwind config (UI/UX rebuild round 1).
 *
 * This does NOT replace the existing CSS-variable token system in
 * src/index.css -- it reads from it. Every color here resolves to a
 * `var(--token)` already defined in index.css, so Tailwind utilities
 * (bg-surface, text-ink-muted, border-line, etc.) and the pre-existing
 * hand-written classes (.btn, .card, .input, ...) stay perfectly in sync
 * with ONE source of truth and both light/dark mode automatically, rather
 * than forking into two parallel color systems that could drift apart.
 *
 * Kept deliberately small and semantic (not a generic "indigo-500" scale)
 * so every class name describes a ROLE (surface, ink, accent) per the
 * design brief's "define semantic tokens" instruction, not a raw hue.
 */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--base)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        'ink-muted': 'var(--ink-muted)',
        'ink-faint': 'var(--ink-faint)',
        primary: {
          DEFAULT: 'var(--primary)',
          soft: 'var(--primary-soft)',
          ink: 'var(--primary-ink)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          soft: 'var(--secondary-soft)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
        },
      },
      fontFamily: {
        display: ['"Big Shoulders Display"', 'Arial Narrow', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
      },
      transitionDuration: {
        150: '150ms',
        250: '250ms',
        400: '400ms',
      },
    },
  },
  plugins: [],
};
