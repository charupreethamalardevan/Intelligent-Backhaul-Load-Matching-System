import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RoleSignupForm from '../components/RoleSignupForm.jsx';
import SiteNav from '../components/SiteNav.jsx';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBox,
  IconRoute,
  IconBuilding,
  IconUser,
  IconUsers,
  IconTruck,
  IconKey,
} from '../components/icons.jsx';
import ParticleBackground, { PARTICLE_COLORS_RESTRAINED } from '../components/ParticleBackground.jsx';
import './SignupRoleSelect.css';
import './AuthShared.css';

// Premium redesign (per the pasted "PIKA-INSPIRED AUTHENTICATION REDESIGN"
// brief, calibrated against pika.art): icons are now real lucide
// components instead of 2-letter monogram strings, and the plain grid
// below is replaced by AuthShared.css's `.ac-path-*` pathway-card system.
// The page canvas uses `.auth-canvas` (AuthShared.css), which follows the
// site's real light/dark theme toggle -- see that file's header comment
// for why (this replaced an earlier always-dark version per user feedback).
// Role ids, labels, and hints are character-for-character the same as
// before -- ROLE_FORMS in lib/roleForms.js still keys off these exact
// ids, so signup semantics and click behavior are unchanged.
const LEVEL1 = [
  { id: 'post', icon: IconBox, label: 'Post a Load', hint: 'Business or individual load posting' },
  { id: 'move', icon: IconRoute, label: 'Move a Load', hint: 'Fleet owner, individual owner, or driver' },
];

const CHILDREN = {
  post: [
    { id: 'business', icon: IconBuilding, label: 'Business Poster', hint: 'Company posting loads regularly' },
    { id: 'individual', icon: IconUser, label: 'Individual Poster', hint: 'One-off / personal load posting' },
  ],
  move: [
    { id: 'fleetOwner', icon: IconUsers, label: 'Fleet Owner', hint: 'Owns multiple vehicles & drivers' },
    { id: 'individualOwner', icon: IconTruck, label: 'Individual Owner', hint: 'Owns & drives one vehicle' },
    { id: 'fleetDriver', icon: IconKey, label: 'Fleet Driver', hint: 'Drives for a Fleet Owner, via invite code' },
  ],
};

const STEP_LABELS = ['Category', 'Type', 'Details'];

// Compact 3-stage indicator -- derived from the real navigation state
// already in this component (historyStack / selectedRoleId) below, not a
// fabricated multi-page wizard. Every signup path in this app is exactly
// Category -> Type -> Details, so three stages always covers it.
function StepIndicator({ step }) {
  return (
    <div className="ac-steps">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const cls = n < step ? 'is-done' : n === step ? 'is-active' : '';
        return (
          <Fragment key={label}>
            <span className={`ac-step ${cls}`}>
              <span className="ac-step-dot" />
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && <span className="ac-step-sep" />}
          </Fragment>
        );
      })}
    </div>
  );
}

export default function SignupRoleSelect() {
  const { t } = useTranslation();

  const [items, setItems] = useState(LEVEL1);
  const [title, setTitle] = useState("Choose how you'll use IBLMS");
  const [sub, setSub] = useState('Pick the option that matches what you need.');
  const [historyStack, setHistoryStack] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);

  function choose(it) {
    if (CHILDREN[it.id]) {
      setHistoryStack((h) => [...h, { items, title, sub }]);
      setItems(CHILDREN[it.id]);
      setTitle(`${it.label} — choose your role`);
      setSub('Pick the option that matches what you need.');
    } else {
      setSelectedRoleId(it.id);
      setTitle(it.label);
      setSub('Fill in your details to create your account.');
    }
  }

  function goBack() {
    if (selectedRoleId) {
      setSelectedRoleId(null);
      setSub('Pick the option that matches what you need.');
      return;
    }
    if (historyStack.length === 0) return;
    const prev = historyStack[historyStack.length - 1];
    setItems(prev.items);
    setTitle(prev.title);
    setSub(prev.sub);
    setHistoryStack(historyStack.slice(0, -1));
  }

  const showBack = selectedRoleId || historyStack.length > 0;
  // Step 1 = category (post vs move), step 2 = subtype list, step 3 =
  // the leaf registration form. Derived purely from existing state above.
  const step = selectedRoleId ? 3 : historyStack.length === 0 ? 1 : 2;

  return (
    <div className="role-select-page auth-canvas">
      <ParticleBackground confined count={52} colors={PARTICLE_COLORS_RESTRAINED} />
      <SiteNav activePage="signup" />

      {selectedRoleId ? (
        <div className="rs-split">
          <div className="rs-stage">
            <ParticleBackground confined count={34} colors={PARTICLE_COLORS_RESTRAINED} />
            <StepIndicator step={step} />
            <div className="ac-eyebrow">{t('nav.signup')}</div>
            <h1 className="rs-stage-headline ac-enter">{title}</h1>
            <p className="rs-stage-copy ac-enter ac-enter-d1">{sub}</p>
          </div>
          <div className="rs-form-col">
            <button type="button" className="rs-back-btn" onClick={goBack}>
              <IconArrowLeft size={14} /> Back
            </button>
            <div className="rs-panel ac-enter">
              <div className="rs-panel-kicker">Create your account</div>
              <RoleSignupForm roleId={selectedRoleId} />
            </div>
          </div>
        </div>
      ) : (
        <div className="rs-body">
          {showBack && (
            <button type="button" className="ac-back-btn" onClick={goBack}>
              <IconArrowLeft size={14} /> Back
            </button>
          )}

          <div className="rs-heading ac-enter">
            <StepIndicator step={step} />
            <div className="ac-eyebrow">{t('nav.signup')}</div>
            <h1 className="ac-h1">{title}</h1>
            <p className="ac-sub">{sub}</p>
          </div>

          <div className="ac-path-grid" data-count={items.length}>
            {items.map((it, i) => {
              const Icon = it.icon;
              return (
                <button
                  type="button"
                  key={it.id}
                  className={`ac-path-card ac-enter ac-enter-d${Math.min(i + 1, 3)}`}
                  onClick={() => choose(it)}
                >
                  <span className="ac-path-icon">
                    <Icon size={24} />
                  </span>
                  <span className="ac-path-body">
                    <span className="ac-path-label">{it.label}</span>
                    <span className="ac-path-hint">{it.hint}</span>
                  </span>
                  <span className="ac-path-arrow">
                    Continue <IconArrowRight size={14} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
