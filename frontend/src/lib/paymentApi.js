import { apiFetch } from './api.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ER-diagram entity: PAYMENT (routes/payments.js). A completed booking can
// have at most one payment row -- either side may record it ("we settled
// up, here's how"), there's no real payment gateway behind this.
export const getPayment = (matchId) => apiFetch(`/payments/${matchId}`).then((d) => d.payment);
export const createPayment = (matchId, amount, method, transactionRef) =>
  apiFetch('/payments', json('POST', { matchId, amount, method, transactionRef })).then((d) => d.payment);

export const PAYMENT_METHODS = [
  { id: 'upi', label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
];

export const PAYMENT_METHOD_LABELS = PAYMENT_METHODS.reduce((acc, m) => ({ ...acc, [m.id]: m.label }), {});
