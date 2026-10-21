import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../lib/notificationApi.js';
import { timeAgo } from '../lib/time.js';
import { IconBell } from './icons.jsx';
import './NotificationBell.css';

const POLL_MS = 20000;

// Wires up the bell icon that's sat in DashboardShell's topbar, unwired,
// since the premium UI/UX rebuild -- the backend (routes/notifications.js)
// has existed since the 22-table migration (ER-diagram NOTIFICATION,
// created from matches.js's status changes, ratings.js, payments.js and
// admin.js) but had no reader. Polls lightly rather than opening a socket,
// consistent with this app's other "live-ish" features (TripMap's GPS
// poll, Route Insights). Only mounted for Fleet/Poster dashboards --
// Admin's single shared login has no User row to own notifications, see
// AdminPage.jsx.
export default function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const wrapRef = useRef(null);

  function load() {
    listNotifications()
      .then((d) => {
        setItems(d.notifications || []);
        setUnreadCount(d.unreadCount || 0);
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [open]);

  function onItemClick(n) {
    if (!n.isRead) {
      markNotificationRead(n._id).catch(() => {});
      setItems((prev) => prev.map((x) => (x._id === n._id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  }

  function onMarkAllRead() {
    markAllNotificationsRead().catch(() => {});
    setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setUnreadCount(0);
  }

  return (
    <div className="nb-wrap" ref={wrapRef}>
      <button
        className="ds-icon-btn"
        onClick={() => setOpen((o) => !o)}
        title={t('common.notifications')}
        aria-label={t('common.notifications')}
      >
        <IconBell size={17} />
        {unreadCount > 0 && <span className="nb-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="nb-panel">
          <div className="nb-panel-head">
            <span>{t('notifications.title', 'Notifications')}</span>
            {unreadCount > 0 && (
              <button type="button" className="nb-markall" onClick={onMarkAllRead}>
                {t('notifications.markAllRead', 'Mark all read')}
              </button>
            )}
          </div>
          <div className="nb-list">
            {items.length === 0 && <div className="nb-empty">{t('notifications.none', 'No notifications yet.')}</div>}
            {items.map((n) => (
              <button key={n._id} type="button" className={`nb-item${n.isRead ? '' : ' nb-item-unread'}`} onClick={() => onItemClick(n)}>
                <div className="nb-item-title">{n.title}</div>
                <div className="nb-item-message">{n.message}</div>
                <div className="nb-item-time">{timeAgo(n.createdAt)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
