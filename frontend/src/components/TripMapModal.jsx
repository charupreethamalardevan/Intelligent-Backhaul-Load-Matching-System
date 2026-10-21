import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import TripMap from './TripMap.jsx';
import { IconX } from './icons.jsx';
import './TripMap.css';

// The "Start Navigation" popup -- a large, centered, fully zoomable/
// pannable map (real scroll-wheel zoom, not just the +/- buttons the
// compact row embed gets), opened from RequestsPanel's "Start Navigation"
// button instead of a map sitting inline on every row. Mirrors
// SidePanel.jsx's own backdrop/Escape/click-outside pattern elsewhere in
// this app, just as a centered dialog instead of a right-edge slide-over
// (a map needs real width and height to be worth zooming into, which a
// 420px side panel doesn't give it).
export default function TripMapModal({ request, canShareLocation, onClose }) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!request) return null;
  const trip = request.tripId;

  return (
    <>
      <div className="trip-nav-backdrop" onClick={onClose} />
      <div className="trip-nav-modal" role="dialog" aria-modal="true" aria-label={t('map.startNavigation', 'Start Navigation')}>
        <div className="trip-nav-head">
          <div>
            <h2>{t('map.startNavigation', 'Start Navigation')}</h2>
            {trip && (
              <p className="trip-nav-sub">
                {trip.source} → {trip.destination}
              </p>
            )}
          </div>
          <button type="button" className="ds-icon-btn" onClick={onClose} aria-label={t('common.close', 'Close')}>
            <IconX size={18} />
          </button>
        </div>
        <div className="trip-nav-body">
          <TripMap request={request} canShareLocation={canShareLocation} height="100%" scrollWheelZoom />
        </div>
      </div>
    </>
  );
}
