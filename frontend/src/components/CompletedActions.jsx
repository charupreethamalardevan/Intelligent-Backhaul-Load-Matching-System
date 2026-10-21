import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPayment, createPayment, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../lib/paymentApi.js';
import { getRatings, createRating } from '../lib/ratingApi.js';

// Shown inline on a RequestsPanel card once a booking reaches 'completed'
// -- the two ER-diagram features (PAYMENT, RATING) that only make sense
// once a booking is actually done. Both sides may record the payment (the
// backend allows either); each side may rate the OTHER side once (the
// backend enforces that limit via a compound unique index -- this just
// hides the form once it's already been done, same "backend is the real
// authority" pattern as the rest of this panel).
export default function CompletedActions({ request, user }) {
  const { t } = useTranslation();
  const [payment, setPayment] = useState(undefined); // undefined = still loading
  const [ratings, setRatings] = useState(undefined);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [payForm, setPayForm] = useState({ amount: '', method: 'upi', transactionRef: '' });
  const [rateForm, setRateForm] = useState({ ratingValue: '5', comment: '' });

  function load() {
    getPayment(request._id)
      .then(setPayment)
      .catch(() => setPayment(null));
    getRatings(request._id)
      .then(setRatings)
      .catch(() => setRatings([]));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only
  // when the row this card belongs to changes, not on every re-render.
  useEffect(load, [request._id]);

  async function submitPayment(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createPayment(request._id, Number(payForm.amount), payForm.method, payForm.transactionRef || undefined);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRating(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createRating(request._id, Number(rateForm.ratingValue), rateForm.comment || undefined);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (payment === undefined || ratings === undefined) return null;

  const myRating = ratings.find((r) => String(r.ratedBy) === String(user?.id));
  const receivedRating = ratings.find((r) => String(r.ratedUser) === String(user?.id));

  return (
    <div className="dv-req-wrapup">
      {error && <p className="dv-req-wrapup-error">{error}</p>}

      <div className="dv-req-wrapup-col">
        <div className="dv-req-wrapup-label">{t('wrapup.payment', 'Payment')}</div>
        {payment ? (
          <div className="dv-req-wrapup-done">
            ₹{payment.amount} · {PAYMENT_METHOD_LABELS[payment.method] || payment.method}
            {payment.transactionRef ? ` · Ref ${payment.transactionRef}` : ''}
          </div>
        ) : (
          <form onSubmit={submitPayment} className="dv-req-wrapup-form">
            <input
              className="input"
              style={{ fontSize: 13 }}
              type="number"
              min="0"
              step="0.01"
              placeholder={t('wrapup.amount', 'Amount (₹)')}
              required
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
            />
            <select
              className="input"
              style={{ fontSize: 13 }}
              value={payForm.method}
              onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ fontSize: 13 }}
              placeholder={t('wrapup.ref', 'Reference (optional)')}
              value={payForm.transactionRef}
              onChange={(e) => setPayForm({ ...payForm, transactionRef: e.target.value })}
            />
            <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy} type="submit">
              {t('wrapup.recordPayment', 'Record payment')}
            </button>
          </form>
        )}
      </div>

      <div className="dv-req-wrapup-col">
        <div className="dv-req-wrapup-label">{t('wrapup.rating', 'Rating')}</div>
        {myRating ? (
          <div className="dv-req-wrapup-done">
            {t('wrapup.youRated', 'You rated')} {'★'.repeat(myRating.ratingValue)}
            {'☆'.repeat(5 - myRating.ratingValue)}
            {myRating.comment ? ` -- "${myRating.comment}"` : ''}
          </div>
        ) : (
          <form onSubmit={submitRating} className="dv-req-wrapup-form">
            <select
              className="input"
              style={{ fontSize: 13 }}
              value={rateForm.ratingValue}
              onChange={(e) => setRateForm({ ...rateForm, ratingValue: e.target.value })}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {'★'.repeat(n)}
                  {'☆'.repeat(5 - n)}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ fontSize: 13 }}
              placeholder={t('wrapup.commentPlaceholder', 'Comment (optional)')}
              value={rateForm.comment}
              onChange={(e) => setRateForm({ ...rateForm, comment: e.target.value })}
            />
            <button className="btn btn-outline" style={{ fontSize: 13 }} disabled={busy} type="submit">
              {t('wrapup.submitRating', 'Submit rating')}
            </button>
          </form>
        )}
        {receivedRating && (
          <div className="dv-req-wrapup-received">
            {t('wrapup.theyRatedYou', 'They rated you')} {'★'.repeat(receivedRating.ratingValue)}
            {'☆'.repeat(5 - receivedRating.ratingValue)}
          </div>
        )}
      </div>
    </div>
  );
}
