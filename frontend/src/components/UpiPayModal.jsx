import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheckCircle, IconX, IconLock, IconShieldCheck, IconSmartphone, IconCreditCard, IconLandmark, IconCopy } from './icons.jsx';
import './UpiPayModal.css';

// A self-contained, checkout-style "Pay" sheet -- visually inspired by the
// generic look of real-world payment gateway checkouts (a secure-payment
// strip, a method-selector row, a payee card, a method-specific art panel,
// a staged "verifying -> contacting bank -> confirming" processing
// sequence, and a ticket-style receipt), NOT a copy of any specific
// gateway's or app's logo, wordmark or brand colors. The user asked for
// this to look like "a real world gate[way]" -- this gets the FEEL
// (secure, multi-step, confident, the chrome a checkout page has) without
// actually naming or branding itself as any real provider, since this app
// has no connection to one and shouldn't imply one.
//
// There is still no real payment gateway behind this (wiring one in needs
// the user's own merchant account and test API keys, which this session
// can't create on their behalf) -- all three methods (UPI, Card,
// Netbanking) run the same demo flow: a staged "processing" sequence that
// always succeeds, same spirit as TripMap.jsx's simulated-GPS preview,
// which is why the success screen is captioned "Demo payment -- simulated,
// not a real transaction" rather than hiding that fact. No card number or
// bank login is ever sent anywhere -- amount/method/transactionRef
// produced here are handed to the parent via onConfirm, which is what
// actually calls POST /api/payments (the real, single source of truth for
// whether a payment "happened").
const PROCESSING_STEP_MS = 620;

const PROCESSING_STEPS_BY_METHOD = {
  upi: [
    { key: 'verify', label: 'upi.stepVerify', fallback: 'Verifying UPI ID' },
    { key: 'bank', label: 'upi.stepBank', fallback: 'Contacting your bank' },
    { key: 'confirm', label: 'upi.stepConfirm', fallback: 'Confirming payment' },
  ],
  card: [
    { key: 'verify', label: 'upi.stepVerifyCard', fallback: 'Verifying card details' },
    { key: 'auth', label: 'upi.stepAuth', fallback: 'Authorizing with your bank' },
    { key: 'confirm', label: 'upi.stepConfirm', fallback: 'Confirming payment' },
  ],
  netbanking: [
    { key: 'redirect', label: 'upi.stepRedirect', fallback: 'Redirecting to your bank' },
    { key: 'login', label: 'upi.stepLogin', fallback: 'Confirming login' },
    { key: 'confirm', label: 'upi.stepConfirm', fallback: 'Confirming payment' },
  ],
};

const REF_PREFIX = { upi: 'UPI', card: 'CARD', netbanking: 'NB' };

// A short, non-exhaustive list of well-known Indian banks for the
// Netbanking tab's "select your bank" dropdown -- plain factual names in
// an ordinary bank picker, the same way any real checkout's netbanking
// step lists banks; not an endorsement by or connection to any of them.
const BANKS = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Punjab National Bank', 'Bank of Baroda', 'Canara Bank'];

function randomRef(prefix) {
  let digits = '';
  for (let i = 0; i < 12; i += 1) digits += Math.floor(Math.random() * 10);
  return `${prefix}${digits}`;
}

function randomOrderId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 7; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return `ORD-${s}`;
}

// Deterministic pseudo-random bit grid seeded from a string (the order id
// + amount), so the QR-like pattern looks different per payment but stays
// stable across re-renders of the same open modal instead of flickering.
// This is explicitly decorative -- never meant to be a real, scannable
// QR code (see the caption under it) -- just the visual grammar a UPI
// checkout page has.
function seededBits(seed, count) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bits = [];
  for (let i = 0; i < count; i += 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    bits.push((h >>> 16) % 100 < 46);
  }
  return bits;
}

function QrPreview({ seed }) {
  const size = 9;
  const bits = useMemo(() => seededBits(seed || 'iblms', size * size), [seed]);
  const isFinder = (r, c) => (r < 3 && c < 3) || (r < 3 && c >= size - 3) || (r >= size - 3 && c < 3);
  return (
    <div className="upi-qr-grid" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
      {Array.from({ length: size * size }).map((_, i) => {
        const r = Math.floor(i / size);
        const c = i % size;
        const on = isFinder(r, c) ? true : bits[i];
        return <span key={i} className={on ? 'on' : ''} />;
      })}
    </div>
  );
}

// Groups typed card digits into "1234 5678 9012 3456", padding the rest
// with a dot placeholder so the art panel always reads as a full card.
function formatCardPreview(raw) {
  const digits = (raw || '').replace(/\D/g, '').padEnd(16, '•').slice(0, 16);
  return digits.match(/.{1,4}/g).join(' ');
}

export default function UpiPayModal({ open, payeeLabel, routeLabel, defaultAmount, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('review'); // review -> processing -> success
  const [method, setMethod] = useState('upi');
  const [amount, setAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [bank, setBank] = useState('');
  const [error, setError] = useState(null);
  const [ref, setRef] = useState('');
  const [orderId, setOrderId] = useState('');
  const [processingStep, setProcessingStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('review');
      setMethod('upi');
      setAmount(defaultAmount != null ? String(defaultAmount) : '');
      setUpiId('');
      setCardNumber('');
      setCardExpiry('');
      setCardCvv('');
      setBank('');
      setError(null);
      setRef('');
      setOrderId(randomOrderId());
      setProcessingStep(0);
      setFinishing(false);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when it (re)opens
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && step !== 'processing') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, step, onClose]);

  if (!open) return null;

  // Switching tabs mid-review just clears the error from whichever method
  // was previously selected -- the amount (shared across all three) stays.
  function switchMethod(next) {
    if (step !== 'review') return;
    setMethod(next);
    setError(null);
  }

  function submitReview(e) {
    e.preventDefault();
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError(t('upi.badAmount', 'Enter a valid amount.'));
      return;
    }
    if (method === 'upi') {
      if (!/^[\w.+-]{2,}@[\w.-]{2,}$/.test(upiId.trim())) {
        setError(t('upi.badUpiId', 'Enter a UPI ID like name@bank.'));
        return;
      }
    } else if (method === 'card') {
      if (!/^\d{16}$/.test(cardNumber.replace(/\s+/g, ''))) {
        setError(t('upi.badCardNumber', 'Enter a valid 16-digit card number.'));
        return;
      }
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(cardExpiry.trim())) {
        setError(t('upi.badExpiry', 'Enter the expiry as MM/YY.'));
        return;
      }
      if (!/^\d{3,4}$/.test(cardCvv.trim())) {
        setError(t('upi.badCvv', 'Enter a valid CVV.'));
        return;
      }
    } else if (method === 'netbanking') {
      if (!bank) {
        setError(t('upi.badBank', 'Select your bank.'));
        return;
      }
    }

    const steps = PROCESSING_STEPS_BY_METHOD[method] || PROCESSING_STEPS_BY_METHOD.upi;
    setStep('processing');
    setProcessingStep(0);
    steps.forEach((_, i) => {
      setTimeout(() => setProcessingStep(i + 1), PROCESSING_STEP_MS * (i + 1));
    });
    setTimeout(() => {
      setRef(randomRef(REF_PREFIX[method] || 'PAY'));
      setStep('success');
    }, PROCESSING_STEP_MS * steps.length + 250);
  }

  async function finish() {
    setFinishing(true);
    try {
      await onConfirm({ amount: Number(amount), transactionRef: ref, method });
      onClose();
    } catch (err) {
      setStep('review');
      setError(err.message);
    } finally {
      setFinishing(false);
    }
  }

  function copyRef() {
    try {
      navigator.clipboard.writeText(ref).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => {},
      );
    } catch {
      // clipboard API unavailable -- silently skip, the ref is already visible to copy by hand
    }
  }

  const processingSteps = PROCESSING_STEPS_BY_METHOD[method] || PROCESSING_STEPS_BY_METHOD.upi;

  return (
    <>
      <div className="upi-backdrop" onClick={step === 'review' ? onClose : undefined} />
      <div className="upi-sheet" role="dialog" aria-modal="true" aria-label={t('upi.title', 'Pay')}>
        <div className="upi-topbar" />
        <div className="upi-head">
          <div className="upi-head-title">{t('upi.title', 'Pay')}</div>
          {step === 'review' && (
            <button type="button" className="upi-close" onClick={onClose} aria-label="Close">
              <IconX size={16} />
            </button>
          )}
        </div>

        {step === 'review' && (
          <form onSubmit={submitReview} className="upi-body">
            <div className="upi-secure-row">
              <span className="upi-secure-badge">
                <IconLock size={11} /> {t('upi.securePayment', 'Secure payment')}
              </span>
              <span className="upi-order-id">{orderId}</span>
            </div>

            <div className="upi-method-tabs">
              <button type="button" className={`upi-method-tab${method === 'upi' ? ' active' : ''}`} onClick={() => switchMethod('upi')}>
                <IconSmartphone size={15} /> {t('upi.methodUpi', 'UPI')}
              </button>
              <button type="button" className={`upi-method-tab${method === 'card' ? ' active' : ''}`} onClick={() => switchMethod('card')}>
                <IconCreditCard size={15} /> {t('upi.methodCard', 'Card')}
              </button>
              <button type="button" className={`upi-method-tab${method === 'netbanking' ? ' active' : ''}`} onClick={() => switchMethod('netbanking')}>
                <IconLandmark size={15} /> {t('upi.methodNetbanking', 'Netbanking')}
              </button>
            </div>

            <div className="upi-payee">
              <div className="upi-payee-avatar">{(payeeLabel || '?').slice(0, 1).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="upi-payee-name">{payeeLabel || t('upi.theDriver', 'the driver')}</div>
                {routeLabel && <div className="upi-payee-route">{routeLabel}</div>}
              </div>
              <span className="upi-payee-verified">
                <IconShieldCheck size={12} /> {t('upi.verifiedPayee', 'Verified')}
              </span>
            </div>

            {method === 'upi' && (
              <div className="upi-qr-wrap">
                <QrPreview seed={`${orderId}:${amount}`} />
                <div className="upi-qr-caption">
                  {t('upi.scanToPay', 'Scan with any UPI app')}
                  <span className="upi-qr-note">{t('upi.qrDemoNote', 'Demo preview -- not scannable')}</span>
                </div>
              </div>
            )}

            {method === 'card' && (
              <div className="upi-qr-wrap">
                <div className="upi-card-art">
                  <div className="upi-card-art-top">
                    <div className="upi-card-art-chip" />
                    <IconCreditCard size={18} />
                  </div>
                  <div className="upi-card-art-number">{formatCardPreview(cardNumber)}</div>
                  <div className="upi-card-art-exp">{cardExpiry || 'MM/YY'}</div>
                </div>
                <div className="upi-qr-caption">
                  {t('upi.cardSecure', 'Your card details are never stored')}
                  <span className="upi-qr-note">{t('upi.demoCardNote', 'Demo preview -- no real card is charged')}</span>
                </div>
              </div>
            )}

            {method === 'netbanking' && (
              <div className="upi-qr-wrap">
                <div className="upi-bank-art">
                  <IconLandmark size={30} />
                </div>
                <div className="upi-qr-caption">
                  {t('upi.bankRedirect', "You'll be redirected to your bank's login")}
                  <span className="upi-qr-note">{t('upi.demoBankNote', 'Demo preview -- no real bank is contacted')}</span>
                </div>
              </div>
            )}

            <div className="upi-divider">
              <span>{t('upi.orPayManually', 'or pay manually')}</span>
            </div>

            <label className="upi-field-label" htmlFor="upi-amount">
              {t('upi.amount', 'Amount')}
            </label>
            <div className="upi-amount-row">
              <span className="upi-amount-currency">₹</span>
              <input
                id="upi-amount"
                className="upi-amount-input"
                type="number"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {method === 'upi' && (
              <>
                <label className="upi-field-label" htmlFor="upi-id">
                  {t('upi.yourUpiId', 'Your UPI ID')}
                </label>
                <input
                  id="upi-id"
                  className="upi-input"
                  type="text"
                  placeholder="name@bank"
                  required
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                />
              </>
            )}

            {method === 'card' && (
              <>
                <label className="upi-field-label" htmlFor="upi-card-number">
                  {t('upi.cardNumber', 'Card number')}
                </label>
                <input
                  id="upi-card-number"
                  className="upi-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={19}
                  placeholder="1234 5678 9012 3456"
                  required
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                />
                <div className="upi-field-row">
                  <div style={{ flex: 1 }}>
                    <label className="upi-field-label" htmlFor="upi-card-expiry">
                      {t('upi.expiry', 'Expiry (MM/YY)')}
                    </label>
                    <input
                      id="upi-card-expiry"
                      className="upi-input"
                      type="text"
                      placeholder="MM/YY"
                      maxLength={5}
                      required
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="upi-field-label" htmlFor="upi-card-cvv">
                      {t('upi.cvv', 'CVV')}
                    </label>
                    <input
                      id="upi-card-cvv"
                      className="upi-input"
                      type="password"
                      inputMode="numeric"
                      placeholder="•••"
                      maxLength={4}
                      required
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {method === 'netbanking' && (
              <>
                <label className="upi-field-label" htmlFor="upi-bank">
                  {t('upi.selectBank', 'Select your bank')}
                </label>
                <select id="upi-bank" className="upi-input" required value={bank} onChange={(e) => setBank(e.target.value)}>
                  <option value="">{t('upi.chooseBank', 'Choose a bank')}</option>
                  {BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </>
            )}

            {error && <p className="upi-error">{error}</p>}

            <button type="submit" className="upi-pay-btn">
              <IconLock size={14} /> {t('upi.payAmount', 'Pay ₹{{amount}}', { amount: amount || '0' })}
            </button>
            <p className="upi-trust-footer">
              <IconLock size={11} /> {t('upi.trustFooter', '256-bit encrypted · demo payment gateway')}
            </p>
          </form>
        )}

        {step === 'processing' && (
          <div className="upi-body upi-processing">
            <div className="upi-spinner" />
            <div className="upi-processing-steps">
              {processingSteps.map((s, i) => {
                const state = i < processingStep ? 'done' : i === processingStep ? 'active' : 'upcoming';
                return (
                  <div key={s.key} className={`upi-processing-step ${state}`}>
                    <span className="upi-processing-dot">{state === 'done' ? <IconCheckCircle size={13} /> : null}</span>
                    <span>{t(s.label, s.fallback)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="upi-body upi-success">
            <div className="upi-success-check">
              <IconCheckCircle size={40} />
            </div>
            <div className="upi-success-title">{t('upi.success', 'Payment successful')}</div>
            <div className="upi-success-amount">₹{Number(amount).toLocaleString('en-IN')}</div>
            <div className="upi-success-to">{t('upi.paidTo', 'Paid to {{name}}', { name: payeeLabel || t('upi.theDriver', 'the driver') })}</div>
            <div className="upi-receipt">
              <div className="upi-receipt-row">
                <span>{t('upi.method', 'Method')}</span>
                <span>{{ upi: t('upi.methodUpi', 'UPI'), card: t('upi.methodCard', 'Card'), netbanking: t('upi.methodNetbanking', 'Netbanking') }[method]}</span>
              </div>
              <div className="upi-receipt-row">
                <span>{t('upi.orderId', 'Order ID')}</span>
                <span>{orderId}</span>
              </div>
              <div className="upi-receipt-row">
                <span>{t('upi.refNo', 'Reference no.')}</span>
                <span className="upi-receipt-ref">
                  {ref}
                  <button type="button" className="upi-copy-btn" onClick={copyRef} aria-label={t('upi.copyRef', 'Copy reference')}>
                    <IconCopy size={12} />
                  </button>
                </span>
              </div>
              <div className="upi-receipt-row">
                <span>{t('upi.time', 'Time')}</span>
                <span>{new Date().toLocaleString()}</span>
              </div>
              {copied && <div className="upi-receipt-copied">{t('upi.copied', 'Copied to clipboard')}</div>}
            </div>
            <button type="button" className="upi-pay-btn" disabled={finishing} onClick={finish}>
              {finishing ? t('upi.saving', 'Saving...') : t('upi.done', 'Done')}
            </button>
            <p className="upi-trust-footer">
              <IconLock size={11} /> {t('upi.disclaimer', 'Demo payment -- simulated, not a real transaction.')}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
