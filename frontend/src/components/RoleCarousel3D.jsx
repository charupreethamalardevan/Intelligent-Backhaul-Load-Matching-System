import { useCallback, useEffect, useRef, useState } from 'react';
import './RoleCarousel3D.css';

// Generic, reusable 3D role-picker carousel. Built for the user's pasted
// "Premium Interactive 3D Role Selection Page" spec (title said
// "IBLMS-v2," which -- consistent with every pasted spec this session --
// is applied to miniproject3's actual signup flow, since that's the
// project every screenshot/message in this session has been about; the
// unrelated, untouched IBLMS-v2 project was not touched).
//
// Design choice worth flagging explicitly: the spec describes a
// "continuous horizontal 3D cylinder carousel." Implemented here as a
// coverflow-style arrangement instead of a literal single-axis rotateY
// cylinder -- each card's position/rotation/depth/scale/opacity is driven
// by its signed, circularly-wrapped distance from the active index
// (`wrapOffset`), not by placing N cards evenly around a full 360deg
// circle. Reason: this flow only ever shows 2 or 3 items at a time
// (Level 1: Post/Move; Post's children: Business/Individual Poster;
// Move's children: the 3 roles the spec's own card copy describes). A
// true full-circle cylinder with only 2-3 cards would space them 120-180
// degrees apart, so most of the time you'd be looking at the backs of the
// other cards or empty space between them -- not the "neighboring cards
// partially visible" look the spec actually asks for. The coverflow
// arrangement gives that look at any item count while still supporting
// circular wrap-around navigation with no broken endpoint (see
// `setActiveIndex`'s shortest-path delta math).
//
// Performance: a single requestAnimationFrame loop (not one per card)
// drives a single eased "progress" value toward a target; each frame,
// every card's transform/opacity/z-index/pointer-events/aria-hidden are
// written directly via refs/DOM style, not React state, so navigating or
// tilting the carousel never triggers a React re-render. React state
// (`activeIndex`) only changes on an actual selection change, to drive
// aria-pressed/the dot indicators/the CTA's visibility.
//
// Accessibility: every card is a real <button> (not a styled <div>), so
// Tab naturally reaches all of them; Enter/Space works for free. A click
// or Enter on a non-active card re-centers it; on the already-active card
// it calls `onSelect` -- this two-step "bring into focus, then confirm"
// mirrors the spec's own "click a card to select it" + "click the active
// card's primary action to continue" split without needing a button
// nested inside a button. Left/Right arrow keys are an additional,
// non-exclusive way to move the active index. prefers-reduced-motion
// collapses the eased loop to an instant snap and disables mouse tilt
// entirely, rather than running a second, separate code path.

function getMetrics(width) {
  if (width < 640) {
    return { spacing: 116, depth: 80, rotate: 28, scaleStep: 0.15, cardW: 226, perspective: 1000 };
  }
  if (width < 1024) {
    return { spacing: 188, depth: 115, rotate: 31, scaleStep: 0.13, cardW: 268, perspective: 1200 };
  }
  return { spacing: 276, depth: 155, rotate: 33, scaleStep: 0.12, cardW: 318, perspective: 1350 };
}

function wrapOffset(raw, n) {
  const wrapped = ((raw % n) + n) % n;
  return wrapped > n / 2 ? wrapped - n : wrapped;
}

export default function RoleCarousel3D({ items, onSelect, ariaLabel }) {
  const n = items.length;
  const viewportRef = useRef(null);
  const cardRefs = useRef([]);
  const progressRef = useRef(0);
  const targetRef = useRef(0);
  const rafRef = useRef(null);
  const metricsRef = useRef(getMetrics(typeof window !== 'undefined' ? window.innerWidth : 1280));
  const tiltRef = useRef({ tx: 0, ty: 0 });
  const isTouchRef = useRef(false);
  const touchStartXRef = useRef(null);
  const reduceMotionRef = useRef(false);
  const activeIndexRef = useRef(0);

  const [activeIndex, setActiveIndexState] = useState(0);
  const [, forceTick] = useState(0);

  const applyTransforms = useCallback(() => {
    const m = metricsRef.current;
    for (let i = 0; i < n; i++) {
      const el = cardRefs.current[i];
      if (!el) continue;
      const offset = wrapOffset(i - progressRef.current, n);
      const abs = Math.abs(offset);
      const isActive = abs < 0.001;
      let rx = 0;
      let ry = 0;
      if (isActive && !reduceMotionRef.current) {
        rx = tiltRef.current.tx;
        ry = tiltRef.current.ty;
      }
      const x = offset * m.spacing;
      const z = -abs * m.depth;
      const rotY = Math.max(-70, Math.min(70, offset * -m.rotate)) + ry;
      const scale = Math.max(0.56, 1 - abs * (m.scaleStep + 0.015));
      const opacity = Math.max(0, 1 - abs * 0.58);
      el.style.transform = `translate(-50%, -50%) translate3d(${x}px, 0, ${z}px) rotateY(${rotY}deg) rotateX(${rx}deg) scale(${scale})`;
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = String(1000 - Math.round(abs * 10));
      const reachable = abs < 1.75;
      el.style.pointerEvents = reachable ? 'auto' : 'none';
      el.setAttribute('aria-hidden', reachable ? 'false' : 'true');
      el.tabIndex = reachable ? 0 : -1;
    }
  }, [n]);

  const ensureLoop = useCallback(() => {
    if (rafRef.current) return;
    function tick() {
      const liveEase = reduceMotionRef.current ? 1 : 0.15;
      const tiltSettled = Math.abs(tiltRef.current.tx) < 0.02 && Math.abs(tiltRef.current.ty) < 0.02;
      const diff = targetRef.current - progressRef.current;
      const progressSettled = Math.abs(diff) < 0.0015;
      if (progressSettled) {
        progressRef.current = targetRef.current;
      } else {
        progressRef.current += diff * liveEase;
      }
      applyTransforms();
      if (progressSettled && tiltSettled) {
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [applyTransforms]);

  const setActiveIndex = useCallback(
    (i) => {
      const clamped = ((i % n) + n) % n;
      const curWrapped = ((progressRef.current % n) + n) % n;
      let delta = clamped - curWrapped;
      if (delta > n / 2) delta -= n;
      if (delta < -n / 2) delta += n;
      targetRef.current = progressRef.current + delta;
      if (clamped !== activeIndexRef.current) {
        activeIndexRef.current = clamped;
        setActiveIndexState(clamped);
      }
      ensureLoop();
    },
    [n, ensureLoop]
  );

  useEffect(() => {
    reduceMotionRef.current =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    isTouchRef.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    applyTransforms();

    function handleResize() {
      metricsRef.current = getMetrics(window.innerWidth);
      applyTransforms();
      forceTick((t) => t + 1);
    }
    window.addEventListener('resize', handleResize);

    const node = viewportRef.current;

    function handleKeyDown(e) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIndex(activeIndexRef.current + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIndex(activeIndexRef.current - 1);
      }
    }
    node?.addEventListener('keydown', handleKeyDown);

    function handlePointerMove(e) {
      if (isTouchRef.current || reduceMotionRef.current || !node) return;
      const rect = node.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      tiltRef.current.tx = Math.max(-7, Math.min(7, -py * 14));
      tiltRef.current.ty = Math.max(-10, Math.min(10, px * 20));
      ensureLoop();
    }
    function handlePointerLeave() {
      tiltRef.current.tx = 0;
      tiltRef.current.ty = 0;
      ensureLoop();
    }
    node?.addEventListener('pointermove', handlePointerMove);
    node?.addEventListener('pointerleave', handlePointerLeave);

    function handleTouchStart(e) {
      touchStartXRef.current = e.touches[0].clientX;
    }
    function handleTouchEnd(e) {
      if (touchStartXRef.current == null) return;
      const dx = e.changedTouches[0].clientX - touchStartXRef.current;
      touchStartXRef.current = null;
      if (Math.abs(dx) < 40) return;
      setActiveIndex(activeIndexRef.current + (dx < 0 ? 1 : -1));
    }
    node?.addEventListener('touchstart', handleTouchStart, { passive: true });
    node?.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('resize', handleResize);
      node?.removeEventListener('keydown', handleKeyDown);
      node?.removeEventListener('pointermove', handlePointerMove);
      node?.removeEventListener('pointerleave', handlePointerLeave);
      node?.removeEventListener('touchstart', handleTouchStart);
      node?.removeEventListener('touchend', handleTouchEnd);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // `items` is expected to be a fresh array per drill-down level, and the
    // parent remounts this component with a `key` keyed on the item-set
    // when the level changes -- so this effect intentionally runs once per
    // mount, not on every items/onSelect identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="rs3d-viewport"
      ref={viewportRef}
      role="group"
      aria-label={ariaLabel}
      style={{ perspective: metricsRef.current.perspective }}
    >
      <div className="rs3d-scene">
        {items.map((item, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              type="button"
              key={item.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              className={`rs3d-card${isActive ? ' rs3d-card--active' : ''}`}
              style={{ width: metricsRef.current.cardW }}
              aria-pressed={isActive}
              aria-label={item.roleLabel || item.heading}
              onClick={() => (isActive ? onSelect(item) : setActiveIndex(i))}
            >
              <span className="rs3d-depth-layer rs3d-depth-layer--1" aria-hidden="true" />
              <span className="rs3d-depth-layer rs3d-depth-layer--2" aria-hidden="true" />
              <span className="rs3d-card-face">
                <span className="rs3d-card-visual" aria-hidden="true">
                  {item.visual}
                </span>
                <span className="rs3d-card-badge">{item.badge}</span>
                <span className="rs3d-card-role-label">{item.roleLabel}</span>
                <span className="rs3d-card-heading">{item.heading}</span>
                <span className="rs3d-card-desc">{item.description}</span>
                {isActive && (
                  <span className="rs3d-card-cta">
                    Continue <span aria-hidden="true">&rarr;</span>
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {n > 1 && (
        <div className="rs3d-dots" role="tablist" aria-label="Role options">
          {items.map((item, i) => (
            <button
              type="button"
              key={item.id}
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Show ${item.roleLabel || item.heading}`}
              className={`rs3d-dot${i === activeIndex ? ' rs3d-dot--active' : ''}`}
              onClick={() => setActiveIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
