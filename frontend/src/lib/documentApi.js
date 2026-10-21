import { adminFetch } from './adminApi.js';

// ER-diagram entity: DOCUMENT, admin-side review queue (routes/admin.js's
// /documents endpoints). Deliberately goes through adminFetch/the admin
// token, not the regular user apiFetch -- this is an admin-only review
// queue, same auth boundary as the rest of AdminPage.
export const listDocuments = (status) => adminFetch(`/admin/documents${status ? `?status=${status}` : ''}`).then((d) => d.documents);
export const verifyDocument = (id) => adminFetch(`/admin/documents/${id}/verify`, { method: 'POST' }).then((d) => d.document);
export const rejectDocument = (id) => adminFetch(`/admin/documents/${id}/reject`, { method: 'POST' }).then((d) => d.document);

export const DOCUMENT_TYPE_LABELS = {
  ownership_doc: 'Ownership document',
  license_doc: 'License',
  rc_book: 'RC book',
  permit: 'Permit',
  gst: 'GST certificate',
  aadhaar: 'Aadhaar / KYC',
};
