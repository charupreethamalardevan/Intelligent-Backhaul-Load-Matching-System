import { apiFetch } from './api.js';

// ER-diagram entity: NOTIFICATION (routes/notifications.js). In-app only,
// no push/email delivery -- rows are created by matches.js (status
// changes), ratings.js, payments.js and admin.js (signup approve/reject).
export const listNotifications = () => apiFetch('/notifications');
export const markNotificationRead = (id) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }).then((d) => d.notification);
export const markAllNotificationsRead = () => apiFetch('/notifications/read-all', { method: 'POST' });
