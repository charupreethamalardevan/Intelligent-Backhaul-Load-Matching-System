import { useEffect } from 'react';
import { IconX } from './icons.jsx';
import './dataViews.css';

// Generic slide-over panel -- this round, it hosts the vehicle
// registration form so adding a vehicle no longer means an always-open
// 3-column form sitting above the table. Closes on Escape or a backdrop
// click. Owns no form state or validation itself; whatever is passed as
// `children` keeps its existing behavior completely unchanged.
export default function SidePanel({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="dv-side-backdrop" onClick={onClose} />
      <div className="dv-side-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dv-side-head">
          <h2>{title}</h2>
          <button type="button" className="ds-icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="dv-side-body">{children}</div>
      </div>
    </>
  );
}
