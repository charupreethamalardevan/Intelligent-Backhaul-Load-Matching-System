import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { IconMoon, IconSun } from '../components/icons.jsx';
import { useTheme } from '../lib/theme.js';
import ParticleBackground, { PARTICLE_COLORS } from '../components/ParticleBackground.jsx';
import './Landing.css';
import './LandingSections.css';

// IBLMS cinematic landing hero. Built across many rounds -- full history in
// this project's own Progress Log (Addenda 25-47). Round 7 recreated a
// pasted freight-train reference as a pixel-exact, fixed 1280x800 canvas
// scaled with a transform to fit any viewport; round 8 swapped in the
// user's own truck video and patched a clipping bug in that scale math.
//
// Round 9 (this round): the user pasted a long, detailed "Pika-inspired
// cinematic hero" rebuild spec and explicitly invited questions ("if u have
// doubt just ask me"). Used that opening for three real, consequential
// decisions rather than guessing:
//
// 1. The spec asks for fluid clamp()-based typography and min-height:100svh,
//    which is architecturally a different approach from the existing fixed-
//    canvas-scaled-by-a-transform system (just stabilized in round 8).
//    Asked the user directly whether to rebuild or to layer the new
//    requirements onto the existing system -- they chose to rebuild. This
//    file and Landing.css are the result: no more absolute positioning, no
//    more JS-measured scale transform, just normal fluid flow. This also
//    permanently retires the round-8 clipping-bug class rather than
//    patching it again -- there's no fixed box left to clip against.
//
// 2. The spec also asks for "editorial typography and asymmetric layouts"
//    below the fold while simultaneously saying "preserve existing
//    sections, don't delete blindly" -- a genuine tension. Asked the user
//    how far to go; they chose a deeper redesign (asymmetric grids, bigger
//    editorial type) while keeping the same real content. See
//    LandingSections.css's own header comment for what that became.
//
// 3. The hero nav ("Network"/"How matching works") was previously inert
//    decorative text, not real links. The spec wants real links using
//    actual routes, but neither topic has its own page yet. Asked the user;
//    they chose on-page anchor links over removing the items -- "Network"
//    now points at #audiences, "How matching works" at #how-it-works (both
//    below). A working mobile hamburger menu surfaces these two links at
//    the <760px breakpoint where `.hero-nav` itself hides.
//
// A fourth thing came up mid-build, not from the spec but from actually
// inspecting the asset the spec assumed was ready: pulling frames from the
// user's own truck-hero.mp4 with ffmpeg (device_bash) showed it's a 14.4s
// snowy-road dashcam clip where the truck is only on screen for about 3.6s
// of every loop -- not the "truck remains visible / truck as visual focus"
// footage the spec describes. (This also explained a real discrepancy this
// session: earlier verification screenshots showed a totally different
// green farmland video, which turned out to be stale browser video cache
// from an older, unrelated file at this same URL -- not this video's actual
// content.) Flagged this to the user with the actual extracted frame rather
// than silently building around it; they chose to trim the clip down to
// just the truck-visible ~3.6s window. That trim (+ a re-encode to cut the
// file from 49MB to ~5MB, since a background hero loop doesn't need the
// original's very high bitrate) was done with ffmpeg directly on the user's
// machine via device_bash -- the original full clip was kept alongside as
// `truck-hero-original-full.mp4.bak`, not deleted, and a poster frame
// (`truck-hero-poster.jpg`) was extracted from the trimmed clip for the
// video's own `poster` attribute, per the spec's "graceful fallback if the
// video can't play" requirement.
//
// Typography: uses this project's own already-loaded Google Fonts (Plus
// Jakarta Sans for UI/body, Big Shoulders Display for the oversized
// headline) instead of the old local()-only Oswald/Bebas Neue font stack --
// the spec explicitly says to use Plus Jakarta Sans/Manrope "if already
// available" rather than add fonts, and both are already loaded site-wide
// (see index.html), so no new font dependency was introduced.
//
// Strict preservation (per the spec's own section 10): only this page's own
// files (Landing.jsx/.css, LandingSections.css) and the video asset were
// touched. No route, backend endpoint, auth flow, or dashboard was changed;
// the kept header's Login/Signup buttons and the hero's own CTA row still
// call the same real `/login`/`/signup` routes as before.

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Create your account',
    body: 'Sign up as a Load Poster (business or individual) or on the transport side as a Fleet Owner, Individual Owner, or invited Fleet Driver.',
  },
  {
    step: '02',
    title: 'Get matched, with the reasons shown',
    body: 'Every compatible vehicle/load pair is scored across 7 weighted factors -- route fit, capacity, timing, cargo fit, detour, profitability and reliability -- so you see why a match ranks where it does.',
  },
  {
    step: '03',
    title: 'Book it, and track it to delivery',
    body: 'Send a request and walk it through the real booking lifecycle: accepted, confirmed, pickup, in transit, delivered, completed.',
  },
];

const AUDIENCES = [
  {
    eyebrow: 'Post a Load',
    title: 'Shipping something?',
    body: 'Business Posters and Individual Posters can post a load with pickup/delivery cities, cargo details and a deadline, then review ranked, explainable matches from available vehicles.',
    roles: ['Business Poster', 'Individual Poster'],
  },
  {
    eyebrow: 'Move a Load',
    title: 'Running a truck?',
    body: 'Fleet Owners and Individual Owners register vehicles and plan trips; Fleet Drivers join via an invite code from their Fleet Owner and get the same ranked backhaul recommendations.',
    roles: ['Fleet Owner', 'Individual Owner', 'Fleet Driver'],
  },
];

const FEATURES = [
  {
    title: 'Explainable matching',
    body: 'Every recommendation shows its real 7-factor weighted score -- route, capacity, timing, cargo fit, detour, profitability, reliability -- never a bare, unexplained number.',
  },
  {
    title: 'Profitability estimates',
    body: 'Revenue, fuel, toll and other costs are estimated per route, including a documented empty-return-vs-backhaul comparison -- every figure is labeled as an estimate, never claimed as exact.',
  },
  {
    title: 'Role-based accounts',
    body: 'Business/Individual Posters, Fleet Owners, Individual Owners and invite-only Fleet Drivers each get exactly the permissions their role needs -- nothing more.',
  },
  {
    title: 'No typing coordinates',
    body: 'Pickup and delivery locations are chosen from a known list of cities -- the app handles distance estimation itself, never a free-text lat/lng field.',
  },
];

// One staggered-reveal timeline for the hero's own elements. Each child
// fades up a few pixels with a slight blur-out -- "arrival," not a bounce
// or a slide-in-from-offscreen effect. Durations sit inside the 150-700ms
// guidance (header items land a touch slower, in the 550-650ms band, since
// they're larger compositional blocks, not micro-interactions).
const EASE = [0.22, 1, 0.36, 1];
const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: 'blur(6px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
};

export default function Landing() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [dark, setDark] = useTheme();
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);

  const transition = (delay) => ({ duration: reduceMotion ? 0.01 : 0.6, delay: reduceMotion ? 0 : delay, ease: EASE });

  // Mobile menu: close on Escape, and close automatically if the viewport
  // grows past the breakpoint where the hamburger itself is hidden (so a
  // phone-opened menu can't get stuck "open" in state after a resize/
  // orientation change even though CSS has already hidden it).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onResize = () => { if (window.innerWidth >= 760) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen]);

  return (
    <>
      <section className="hero-stage" aria-label="IBLMS">
        {/* Full-bleed looping background video + layered gradient/vignette.
            Unanimated by CSS -- only the video itself loops; no parallax/
            zoom/camera-move transform is applied to it anywhere in this
            stylesheet, per the spec's own "keep the footage uninterrupted"
            direction. `poster` is the graceful fallback if the video can't
            play, per the spec's section 3. */}
        <div className="fh-frame" aria-hidden="true">
          <video
            className="fh-bg"
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            poster="/videos/truck-hero-poster.jpg"
            aria-label="Truck hauling freight on a snowy highway"
            src="/videos/truck-hero.mp4"
          />
          <div className="fh-vignette" />
          <div className="fh-tint" />
        </div>

        <motion.header
          className="hero-header"
          initial={reduceMotion ? 'visible' : 'hidden'}
          animate="visible"
          variants={fadeUp}
          transition={transition(0)}
        >
          <div className="hero-brand">
            <span className="hero-mark">IB</span>IBLMS
          </div>
          <div className="hero-header-right">
            <nav className="hero-nav" aria-label="Primary">
              <a href="#audiences">{t('nav.network')}</a>
              <a href="#how-it-works">{t('nav.howMatchingWorks')}</a>
            </nav>
            <LanguageSwitcher variant="dark" />
            <button
              type="button"
              className="hero-btn"
              style={{ width: 38, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setDark((d) => !d)}
              title={t('common.toggleTheme')}
              aria-label={t('common.toggleTheme')}
            >
              {dark ? <IconSun size={16} /> : <IconMoon size={16} />}
            </button>
            <div className="hero-header-actions">
              <button type="button" className="hero-btn" onClick={() => navigate('/login')}>
                {t('nav.login')}
              </button>
              <button type="button" className="hero-btn hero-btn-primary" onClick={() => navigate('/signup')}>
                {t('nav.signup')}
              </button>
            </div>
            <button
              type="button"
              className="hero-menu-btn"
              aria-expanded={menuOpen}
              aria-controls="hero-mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </motion.header>

        <div
          id="hero-mobile-menu"
          className={`hero-mobile-menu${menuOpen ? ' is-open' : ''}`}
          aria-hidden={!menuOpen}
        >
          <a href="#audiences" onClick={() => setMenuOpen(false)}>{t('nav.network')}</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>{t('nav.howMatchingWorks')}</a>
          <div className="hero-mobile-menu-divider" aria-hidden="true" />
          <a href="/login" onClick={(e) => { e.preventDefault(); setMenuOpen(false); navigate('/login'); }}>{t('nav.login')}</a>
          <a
            href="/signup"
            className="hero-mobile-menu-primary"
            onClick={(e) => { e.preventDefault(); setMenuOpen(false); navigate('/signup'); }}
          >
            {t('nav.signup')}
          </a>
        </div>

        <div className="fh-stagewrap">
          <div className="fh-stage">
            <motion.p
              className="fh-eyebrow"
              initial={reduceMotion ? 'visible' : 'hidden'}
              animate="visible"
              variants={fadeUp}
              transition={transition(0.1)}
            >
              <span>WHY US</span>
            </motion.p>

            <h1 className="fh-headline" aria-label="Logistics that works as hard as you do.">
              <span className="fh-hl fh-hl1" aria-hidden="true">LOGISTICS</span>
              <span className="fh-hl fh-hl2" aria-hidden="true">THAT WORKS</span>
              <span className="fh-hl fh-hl3" aria-hidden="true">AS HARD AS</span>
              <span className="fh-hl fh-hl4" aria-hidden="true">YOU DO.</span>
            </h1>

            <svg className="fh-mark" viewBox="0 0 52 52" fill="none" aria-hidden="true">
              <circle cx="26" cy="26" r="23" stroke="#46D6C6" strokeWidth="1.6" strokeDasharray="98.3 46.3" transform="rotate(2.5 26 26)" />
              <g stroke="#46D6C6" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="26.5" cy="26.1" r="2.3" />
                <path d="M28.9 27.6C31.6 29 32.9 31.2 31.8 33.3 30.7 35.4 27.2 36.1 24.2 35.1" />
              </g>
            </svg>

            <div className="fh-features">
              <section className="fh-feature fh-feature-left" aria-label="One point of contact">
                <svg className="fh-icon" width="35" height="34" viewBox="0 0 35 34" fill="none" aria-hidden="true">
                  <defs><clipPath id="fh-globe-clip"><circle cx="17.5" cy="17" r="9.80" /></clipPath></defs>
                  <circle cx="17.5" cy="17" r="16.5" stroke="#F9F9F9" strokeWidth="1.9" strokeDasharray="3.6 3" />
                  <circle cx="17.5" cy="17" r="9.80" fill="#F9F9F9" />
                  <g stroke="#101215" strokeWidth=".90" clipPath="url(#fh-globe-clip)">
                    <path d="M11.90 7.20V26.80 M17.5 7.20V26.80 M23.10 7.20V26.80 M7.70 11.40H27.30 M7.70 17H27.30 M7.70 22.60H27.30" />
                  </g>
                </svg>
                <h2>One point of<br />contact</h2>
                <p>Fleet owners, drivers and shippers coordinate directly on IBLMS -- no brokers, no middlemen.</p>
              </section>

              <section className="fh-feature fh-feature-right" aria-label="Full supply chain visibility">
                <svg className="fh-icon" width="35" height="38" viewBox="0 0 35 38" fill="none" aria-hidden="true">
                  <g fill="#F9F9F9">
                    <rect x=".5" y=".5" width="17" height="9.6" rx=".5" />
                    <rect x="10.5" y="13.5" width="13.5" height="10.9" rx=".5" />
                    <rect x="17.5" y="28.3" width="17" height="9.7" rx=".5" />
                  </g>
                  <g fill="#101215">
                    <path d="M2.5 2.5h1.1v1.9H2.5z M5.6 2.5h1.1v1.9H5.6z M8.7 2.5h1.1v1.9H8.7z M11.8 2.5h1.1v1.9h-1.1z M14.9 2.5H16v1.9h-1.1z M2.5 6.5h1.1v1.9H2.5z M5.6 6.5h1.1v1.9H5.6z M8.7 6.5h1.1v1.9H8.7z M11.8 6.5h1.1v1.9h-1.1z M14.9 6.5H16v1.9h-1.1z" />
                    <path d="M12.5 15.2h1.1v1.9h-1.1z M15.6 15.2h1.1v1.9h-1.1z M18.7 15.2h1.1v1.9h-1.1z M21.8 15.2h1.1v1.9h-1.1z M12.5 20.4h1.1v1.9h-1.1z M15.6 20.4h1.1v1.9h-1.1z M18.7 20.4h1.1v1.9h-1.1z M21.8 20.4h1.1v1.9h-1.1z" />
                    <path d="M19.5 30.3h1.1v1.9h-1.1z M22.6 30.3h1.1v1.9h-1.1z M25.7 30.3h1.1v1.9h-1.1z M28.8 30.3h1.1v1.9h-1.1z M31.9 30.3H33v1.9h-1.1z M19.5 34.4h1.1v1.9h-1.1z M22.6 34.4h1.1v1.9h-1.1z M25.7 34.4h1.1v1.9h-1.1z M28.8 34.4h1.1v1.9h-1.1z M31.9 34.4H33v1.9h-1.1z" />
                  </g>
                </svg>
                <h2>Full supply chain<br />visibility</h2>
                <p>Our matching engine ranks every available truck against every open load, so you see the best fit first.</p>
              </section>
            </div>

            {/* Kept per the user's explicit choice in an earlier round -- not
                part of the reference this hero was originally built from,
                added here in its own small bottom margin so Login/Signup
                stay reachable without scrolling. */}
            <motion.div
              className="hero-actions fh-actions"
              initial={reduceMotion ? 'visible' : 'hidden'}
              animate="visible"
              variants={fadeUp}
              transition={transition(0.95)}
            >
              <button type="button" className="hero-btn hero-btn-primary" onClick={() => navigate('/signup')}>
                Get started
              </button>
              <a href="#how-it-works" className="hero-btn">
                Explore platform
              </a>
            </motion.div>
          </div>
        </div>

        <motion.div
          className="hero-scroll-cue"
          aria-hidden="true"
          initial={reduceMotion ? 'visible' : 'hidden'}
          animate="visible"
          variants={fadeUp}
          transition={transition(1.1)}
        >
          <span>Scroll to explore</span>
          <span className="hero-scroll-arrow">&#8595;</span>
        </motion.div>
      </section>

      <main className="ls-page">
        <div className="ls-transition" aria-hidden="true" />
        <ParticleBackground confined count={48} colors={PARTICLE_COLORS} />

        <section className="ls-section ls-how" id="how-it-works">
          <div className="ls-how-head">
            <div className="ls-kicker">How it works</div>
            <h2 className="ls-h2">From posting to delivery, in three real steps</h2>
          </div>
          <div className="ls-steps">
            {HOW_IT_WORKS.map((s) => (
              <div className="ls-step" key={s.step}>
                <div className="ls-step-num">{s.step}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ls-section ls-section-muted" id="audiences">
          <div className="ls-audiences-head">
            <div>
              <div className="ls-kicker">Choose your side</div>
              <h2 className="ls-h2">Built for both ends of the load</h2>
            </div>
            <p className="ls-audiences-sub">
              Two sides, one system -- whichever one you're on, IBLMS gives you
              the same ranked, explainable matches and the same real booking
              lifecycle.
            </p>
          </div>
          <div className="ls-audiences">
            {AUDIENCES.map((a, i) => (
              <div
                className={`ls-audience-card${i === 1 ? ' ls-audience-card-offset' : ''}`}
                key={a.eyebrow}
              >
                <div className="ls-audience-eyebrow">{a.eyebrow}</div>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
                <div className="ls-role-pills">
                  {a.roles.map((r) => (
                    <span className="ls-role-pill" key={r}>{r}</span>
                  ))}
                </div>
                <button type="button" className="btn btn-primary" onClick={() => navigate('/signup')}>
                  {t('nav.signup')}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="ls-section">
          <div className="ls-kicker">What's actually built</div>
          <h2 className="ls-h2">Not a mockup -- a real matching and booking engine</h2>
          <div className="ls-feature-grid">
            {FEATURES.map((f, i) => (
              <div
                className={`card ls-feature-card${i === 0 ? ' ls-feature-card-lead' : ''}`}
                key={f.title}
              >
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="ls-cta">
          <div className="ls-cta-inner">
            <div className="ls-cta-mark" aria-hidden="true">IB</div>
            <div className="ls-cta-text">
              <h2>Ready to get started?</h2>
              <p>Create an account and see your first ranked, explainable match.</p>
              <div className="ls-cta-actions">
                <button type="button" className="btn btn-primary" onClick={() => navigate('/signup')}>
                  {t('nav.signup')}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => navigate('/login')}>
                  {t('nav.login')}
                </button>
              </div>
            </div>
          </div>
        </section>

        <footer className="ls-footer">
          <div className="brand">
            <span className="mark">IB</span> IBLMS
          </div>
          <span className="ls-footer-note">Intelligent Backhaul Logistics Matching System</span>
        </footer>
      </main>
    </>
  );
}
