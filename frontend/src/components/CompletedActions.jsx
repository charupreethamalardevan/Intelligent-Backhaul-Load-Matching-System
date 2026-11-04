import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPayment, createPayment, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../lib/paymentApi.js';
import { getRatings, createRating } from '../lib/ratingApi.js';
import UpiPayModal from './UpiPayModal.jsx';
import { IconWallet, IconClock, IconCheckCircle } from './icons.jsx';
import { locationLabel } from '../lib/locationLabel.js';

// Shown inline on a RequestsPanel card once a booking reaches 'completed'
// -- the two ER-diagram features (PAYMENT, RATING) that only make sense
// once a booking is actually done.
//
// Payment direction: money flows load poster -> truck owner/driver for a
// completed booking, never the other way (the backend now enforces this
// too, see routes/payments.js) -- so only the poster side gets a "Pay"
// action here. The vehicle side only ever gets a read-only view: either
// "payment pending" before it happens, or the same receipt the poster
// sees once it has. `isPosterSide` mirrors the backend's own
// sideOfMatch() check (routes/payments.js), the same "frontend just
// decides what to show, the backend is the real authority" pattern
// RequestsPanel.jsx's isVehicleSide() already uses.
//
// The main "Pay" path opens UpiPayModal, a UPI/GPay-styled flow -- still
// not a real payment gateway (see that component's own header comment
// for why and what that would take). A plain fallback form underneath
// ("Pay by another method") covers bank transfer / cash / card, so a
// poster who doesn't want the UPI flow isn't stuck -- same createPayment
// call either way, just a different amount/method/ref going in.
//
// Each side may rate the OTHER side once (the backend enforces that
// limit via a compound unique index -- this just hides the form once
// it's already been done, same "backend is the real authority" pattern).
export default function CompletedActions({ request, user, onChange }) {
  const { t } = useTranslation();
  const [payment, setPayment] = useState(undefined); // undefined = still loading
  const [ratings, setRatings] = useState(undefined);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [upiOpen, setUpiOpen] = useState(false);
  const [showOtherMethod, setShowOtherMethod] = useState(false);

  const [payForm, setPayForm] = useState({ amount: '', method: 'bank_transfer', transactionRef: '' });
  const [rateForm, setRateForm] = useState({ ratingValue: '5', comment: '' });

  const isPosterSide = String(request.loadPosterId) === String(user?.id);
  const defaultAmount = request.loadId?.expectedPrice ?? '';
  const payeeLabel = request.vehicleId?.vehicleNumber ? `${t('upi.vehicle', 'Vehicle')} ${request.vehicleId.vehicleNumber}` : t('upi.theDriver', 'the driver');
  const routeLabel = request.loadId ? `${locationLabel(request.loadId.pickupLocation)} → ${locationLabel(request.loadId.deliveryLocation)}` : '';

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

  useEffect(() => {
    setPayForm({ amount: defaultAmount ? String(defaultAmount) : '', method: 'bank_transfer', transactionRef: '' });
    setShowOtherMethod(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request._id]);

  async function submitOtherMethodPayment(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createPayment(request._id, Number(payForm.amount), payForm.method, payForm.transactionRef || undefined);
      load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmUpiPayment({ amount, transactionRef, method }) {
    // method comes from whichever tab was selected inside the modal (UPI/
    // Card/Netbanking -- see UpiPayModal.jsx) -- falls back to 'upi' only
    // for safety, that tab is always the default and always available.
    await createPayment(request._id, amount, method || 'upi', transactionRef);
    load();
    // Lets a parent that keeps its own aggregate view of payments (e.g.
    // PaymentsPanel.jsx's stat strip) refresh right away instead of only
    // on next mount -- optional, every other caller just omits it.
    onChange?.();
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
          <div className="dv-pay-receipt">
            <div className="dv-pay-receipt-icon">
              <IconCheckCircle size={18} />
            </div>
            <div>
              <div className="dv-pay-receipt-amount">₹{payment.amount}</div>
              <div className="dv-pay-receipt-meta">
                {t('wrapup.paidVia', 'Paid via')} {PAYMENT_METHOD_LABELS[payment.method] || payment.method}
                {payment.transactionRef ? ` · ${payment.transactionRef}` : ''}
              </div>
            </div>
          </div>
        ) : isPosterSide ? (
          <div className="dv-pay-due">
            <div className="dv-pay-due-row">
              <span className="dv-pay-icon-accent">
                <IconWallet size={16} />
              </span>
              <span>
                {t('wrapup.amountDue', 'Amount due')}: <strong>₹{defaultAmount || '—'}</strong>
              </span>
            </div>
            <button type="button" className="btn btn-primary dv-pay-now-btn" style={{ fontSize: 13 }} onClick={() => setUpiOpen(true)}>
              {t('wrapup.payNow', 'Pay now')}
            </button>
            <button type="button" className="dv-pay-other-link" onClick={() => setShowOtherMethod((v) => !v)}>
              {showOtherMethod ? t('wrapup.hideOtherMethod', 'Hide other payment methods') : t('wrapup.otherMethod', 'Pay by another method')}
            </button>
            {showOtherMethod && (
              <form onSubmit={submitOtherMethodPayment} className="dv-req-wrapup-form">
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
                <button className="btn btn-outline" style={{ fontSize: 13 }} disabled={busy} type="submit">
                  {t('wrapup.recordPayment', 'Record payment')}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="dv-pay-pending">
            <IconClock size={16} />
            <span>{t('wrapup.awaitingPayment', 'Awaiting payment from the load poster')}</span>
          </div>
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

      <UpiPayModal
        open={upiOpen}
        payeeLabel={payeeLabel}
        routeLabel={routeLabel}
        defaultAmount={defaultAmount || ''}
        onClose={() => setUpiOpen(false)}
        onConfirm={confirmUpiPayment}
      />
    </div>
  );
}
