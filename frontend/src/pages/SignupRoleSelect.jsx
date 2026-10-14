import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RoleSignupForm from '../components/RoleSignupForm.jsx';
import ParticleBackground from '../components/ParticleBackground.jsx';
import SiteNav from '../components/SiteNav.jsx';
import './SignupRoleSelect.css';

// Two parent categories, each drilling into its own sub-roles. A coverflow-
// style carousel: every card is always rendered and visible at once, fanned
// out in a shallow arc around the active one, auto-advancing through them
// on a timer. Click any card (not just the front one) to choose it straight
// away; use the arrows/dots to browse without choosing. The final role
// cards show a REAL signup form (RoleSignupForm.jsx), not a preview.
//
// Earlier version: a true 360deg 3D ring with `backface-visibility: hidden`
// on each card. That meant only the single card currently facing the camera
// was ever visible -- every other card sat invisibly behind it -- and the
// slow auto-spin took ~12s to swing the next one into view with zero hint
// it existed. Replaced entirely with the coverflow layout below, where
// nothing is ever hidden: every card in the set has a position on screen
// at all times, just pushed back/scaled down the further it is from front.
const LEVEL1 = [
  { id: 'post', icon: 'PL', label: 'Post a Load', hint: 'Business or individual load posting' },
  { id: 'move', icon: 'ML', label: 'Move a Load', hint: 'Fleet owner, individual owner, or driver' },
];

const CHILDREN = {
  post: [
    { id: 'business', icon: 'BP', label: 'Business Poster', hint: 'Company posting loads regularly' },
    { id: 'individual', icon: 'IP', label: 'Individual Poster', hint: 'One-off / personal load posting' },
  ],
  move: [
    { id: 'fleetOwner', icon: 'FO', label: 'Fleet Owner', hint: 'Owns multiple vehicles & drivers' },
    { id: 'individualOwner', icon: 'IO', label: 'Individual Owner', hint: 'Owns & drives one vehicle' },
    { id: 'fleetDriver', icon: 'FD', label: 'Fleet Driver', hint: 'Drives for a Fleet Owner, via invite code' },
  ],
};

const SPACING = 210; // px, horizontal distance between neighboring cards
const DEPTH_STEP = 130; // px, how far back each step away from front sits
const MAX_TRACK_TILT = 9; // deg, subtle cursor-follow tilt on the whole fan
const SNAP_MS = 480; // matches the CSS transition duration below
const AUTOPLAY_MS = 3200;

// Shortest signed distance from `active` to `index` around a circle of
// `total` positions -- e.g. with 3 items, index 2 sits at offset -1 from
// active index 0 (wraps the "short way"), not +2.
function circularOffset(index, active, total) {
  let diff = index - active;
  if (diff > total / 2) diff -= total;
  if (diff < -total / 2) diff += total;
  return diff;
}

export default function SignupRoleSelect() {
  const { t } = useTranslation();
  const stageRef = useRef(null);
  const trackRef = useRef(null);

  const [items, setItems] = useState(LEVEL1);
  const [title, setTitle] = useState('Choose how you’ll use IBLMS');
  const [sub, setSub] = useState('Cards rotate on their own -- use the arrows or dots, or click any card to choose it.');
  const [historyStack, setHistoryStack] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [showBack, setShowBack] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeIndexRef = useRef(0);
  const lastInteractionRef = useRef(0);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Subtle cursor-follow tilt on the whole fan (not per-card), purely
  // cosmetic, capped small enough it can never approach a 90deg flip.
  useEffect(() => {
    const tilt = { tx: 0, ty: 0, x: 0, y: 0 };
    function onMove(e) {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      tilt.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      tilt.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    }
    window.addEventListener('pointermove', onMove);

    let rafId;
    function frame() {
      tilt.x += (tilt.tx - tilt.x) * 0.06;
      tilt.y += (tilt.ty - tilt.y) * 0.06;
      if (trackRef.current) {
        trackRef.current.style.transform =
          `rotateX(${(-tilt.y * MAX_TRACK_TILT * 0.6).toFixed(2)}deg) rotateY(${(tilt.x * MAX_TRACK_TILT).toFixed(2)}deg)`;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // Auto-advance one card at a time, circularly. Pauses for a bit after any
  // manual interaction (arrow/dot/card click) so it doesn't fight the user.
  useEffect(() => {
    if (items.length <= 1 || selectedRoleId) return undefined;
    const id = setInterval(() => {
      if (Date.now() - lastInteractionRef.current < AUTOPLAY_MS) return;
      const next = (activeIndexRef.current + 1) % items.length;
      activeIndexRef.current = next;
      setActiveIndex(next);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [items, selectedRoleId]);

  function goToIndex(index) {
    lastInteractionRef.current = Date.now();
    activeIndexRef.current = index;
    setActiveIndex(index);
  }

  function navigate(direction) {
    goToIndex((activeIndex + direction + items.length) % items.length);
  }

  function chooseIndex(index) {
    lastInteractionRef.current = Date.now();
    activeIndexRef.current = index;
    setActiveIndex(index);
    window.setTimeout(() => handleChoice(items[index]), SNAP_MS);
  }

  function handleChoice(it) {
    if (CHILDREN[it.id]) {
      setHistoryStack((h) => [...h, { items, title, sub }]);
      setItems(CHILDREN[it.id]);
      setTitle(`${it.label} — choose your role`);
      setSub('Cards rotate on their own -- use the arrows or dots, or click any card to choose it.');
      setSelectedRoleId(null);
      activeIndexRef.current = 0;
      setActiveIndex(0);
      setShowBack(true);
    } else {
      setSelectedRoleId(it.id);
      setTitle(it.label);
      setSub('Fill in your details to create your account.');
      setShowBack(true);
    }
  }

  function goBack() {
    if (selectedRoleId) {
      setSelectedRoleId(null);
      setSub('Cards rotate on their own -- use the arrows or dots, or click any card to choose it.');
      return;
    }
    if (historyStack.length === 0) return;
    const prev = historyStack[historyStack.length - 1];
    setItems(prev.items);
    setTitle(prev.title);
    setSub(prev.sub);
    activeIndexRef.current = 0;
    setActiveIndex(0);
    const next = historyStack.slice(0, -1);
    setHistoryStack(next);
    if (next.length === 0) setShowBack(false);
  }

  return (
    <div className="role-select-page">
      <ParticleBackground />
      <div style={{ width: '100%', maxWidth: 1140, margin: '0 auto', padding: '20px 20px 0', position: 'relative', zIndex: 2, alignSelf: 'stretch' }}>
        <SiteNav activePage="signup" />
      </div>
      <div className="heading">
        <div className="kicker">{t('nav.signup')}</div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>

      {showBack && (
        <button className="back-btn" onClick={goBack}>
          &larr; Back
        </button>
      )}

      {!selectedRoleId && (
        <div className="stage" ref={stageRef}>
          {items.length > 1 && (
            <button
              type="button"
              className="nav-arrow nav-arrow-left"
              onClick={() => navigate(-1)}
              aria-label="Show previous option"
            >
              &#8249;
            </button>
          )}
          <div className="track" ref={trackRef}>
            {items.map((it, i) => {
              const offset = circularOffset(i, activeIndex, items.length);
              const abs = Math.abs(offset);
              const isFront = offset === 0;
              const style = {
                transform: `translate(-50%, -50%) translateX(${offset * SPACING}px) translateZ(${-abs * DEPTH_STEP}px) rotateY(${offset * -22}deg) scale(${Math.max(0.72, 1 - abs * 0.14)})`,
                opacity: abs > 2 ? 0 : Math.max(0.4, 1 - abs * 0.28),
                zIndex: 100 - abs,
                pointerEvents: abs > 2 ? 'none' : 'auto',
              };
              return (
                <div
                  key={it.id}
                  className={`card${isFront ? ' front' : ''}`}
                  style={style}
                  onClick={() => chooseIndex(i)}
                >
                  <div className="ic">{it.icon}</div>
                  <div className="lbl">{it.label}</div>
                  <div className="hint">{it.hint}</div>
                </div>
              );
            })}
          </div>
          {items.length > 1 && (
            <button
              type="button"
              className="nav-arrow nav-arrow-right"
              onClick={() => navigate(1)}
              aria-label="Show next option"
            >
              &#8250;
            </button>
          )}
        </div>
      )}

      {!selectedRoleId && items.length > 1 && (
        <div className="dots" role="tablist" aria-label="Role options">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={it.label}
              className={`dot${i === activeIndex ? ' active' : ''}`}
              onClick={() => goToIndex(i)}
            />
          ))}
        </div>
      )}

      {selectedRoleId && (
        <div className="panel">
          <div className="role-kicker">Create your account</div>
          <RoleSignupForm roleId={selectedRoleId} />
        </div>
      )}
    </div>
  );
}
