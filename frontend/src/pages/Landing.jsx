import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { IconMoon, IconSun } from '../components/icons.jsx';
import { useTheme } from '../lib/theme.js';
import './Landing.css';
import './LandingSections.css';

// IBLMS cinematic landing hero -- round 1 of the premium UI/UX rebuild.
//
// This REPLACES the earlier "Route Jump" interactive portal module (a
// canvas-masked fake-3D card you clicked through three cities). That
// mechanic was fun, but it directly conflicts with this round's design
// brief: a cinematic hero should communicate ARRIVAL, not distraction --
// "a single entrance sequence, then remains still," minimal decoration,
// strong centered typography, restrained color. A click-to-travel canvas
// toy with a custom cursor is the opposite of that. So the whole
// interactive mechanic, its raf loops, and its custom cursor are gone;
// what replaces it is a sealed dark stage with one staggered entrance
// animation (Framer Motion) and then nothing moves except a near-static
// ambient glow. Simpler, calmer, and much less code to maintain.
//
// Below the fold, the existing "How it works / Choose your side / What's
// actually built / CTA" content is kept verbatim (it's accurate, grounded
// copy describing what this app's backend really does) and only
// restyled to the new design system in LandingSections.css.

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

  const transition = (delay) => ({ duration: reduceMotion ? 0.01 : 0.6, delay: reduceMotion ? 0 : delay, ease: EASE });

  return (
    <>
      <section className="hero-stage" aria-label="IBLMS">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-bg-glow" />
          <svg className="hero-bg-route" viewBox="0 0 1200 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <path d="M -40 360 C 220 250, 420 430, 620 300 S 1040 160, 1260 220" />
            <circle cx="90" cy="338" r="4" />
            <circle cx="620" cy="300" r="4" />
            <circle cx="1150" cy="205" r="4" />
          </svg>
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
            <nav className="hero-nav" aria-hidden="true">
              <span>{t('nav.network')}</span>
              <span>{t('nav.howMatchingWorks')}</span>
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
            <button type="button" className="hero-btn" onClick={() => navigate('/login')}>
              {t('nav.login')}
            </button>
            <button type="button" className="hero-btn hero-btn-primary" onClick={() => navigate('/signup')}>
              {t('nav.signup')}
            </button>
          </div>
        </motion.header>

        <div className="hero-center">
          <motion.div
            className="hero-kicker"
            initial={reduceMotion ? 'visible' : 'hidden'}
            animate="visible"
            variants={fadeUp}
            transition={transition(0.1)}
          >
            <span className="hero-kicker-dot" />
            Intelligent Backhaul Load Matching
          </motion.div>

          <motion.h1
            className="hero-title"
            initial={reduceMotion ? 'visible' : 'hidden'}
            animate="visible"
            variants={fadeUp}
            transition={transition(0.2)}
          >
            Reduce empty miles.
            <br />
            Move more profitably.
          </motion.h1>

          <motion.p
            className="hero-subtitle"
            initial={reduceMotion ? 'visible' : 'hidden'}
            animate="visible"
            variants={fadeUp}
            transition={transition(0.34)}
          >
            IBLMS finds the backhaul load already heading your truck's way, scores it on seven
            explainable factors, and books it through a real delivery lifecycle.
          </motion.p>

          <motion.div
            className="hero-actions"
            initial={reduceMotion ? 'visible' : 'hidden'}
            animate="visible"
            variants={fadeUp}
            transition={transition(0.46)}
          >
            <button type="button" className="hero-btn hero-btn-primary hero-btn-lg" onClick={() => navigate('/signup')}>
              Get started
            </button>
            <a href="#how-it-works" className="hero-btn hero-btn-lg">
              Explore platform
            </a>
          </motion.div>
        </div>

        <motion.div
          className="hero-scroll-cue"
          aria-hidden="true"
          initial={reduceMotion ? 'visible' : 'hidden'}
          animate="visible"
          variants={fadeUp}
          transition={transition(0.6)}
        >
          <span>Scroll to explore</span>
          <span className="hero-scroll-arrow">&#8595;</span>
        </motion.div>
      </section>

      <main className="ls-page">
        <section className="ls-section" id="how-it-works">
          <div className="ls-kicker">How it works</div>
          <h2 className="ls-h2">From posting to delivery, in three real steps</h2>
          <div className="ls-steps">
            {HOW_IT_WORKS.map((s) => (
              <div className="ls-step" key={s.step}>
                <div className="ls-step-num">{s.step}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="ls-section ls-section-muted">
          <div className="ls-kicker">Choose your side</div>
          <h2 className="ls-h2">Built for both ends of the load</h2>
          <div className="ls-audiences">
            {AUDIENCES.map((a) => (
              <div className="ls-audience-card" key={a.eyebrow}>
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
            {FEATURES.map((f) => (
              <div className="card ls-feature-card" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="ls-cta">
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
