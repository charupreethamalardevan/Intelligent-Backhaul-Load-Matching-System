import { useEffect, useRef } from 'react';
import './ParticleBackground.css';

// A soft, premium ambient backdrop of slowly orbiting, glowing dots with
// faint constellation-style connecting lines, used as an always-on
// background layer. History: started as a simple upward-drifting canvas
// (Addendum 31), given multi-color support (Addendum 42), and rebuilt this
// round into something closer to the actual Google Antigravity reference
// the user kept pointing at -- "flow in circles... if i move the cursor it
// should move along it" plus a detailed spec asking for canvas-rendered
// particles with subtle connecting lines and mouse response, modeled after
// that site's own hero effect.
//
// Motion model (replaces the old "rise + side-sway" drift): each dot
// orbits a slowly wandering center point -- `angle`/`angularSpeed` trace
// the small circle, `wanderAngle`/`wanderRadius` make that circle's own
// center drift in a lazy loop, and `rise` keeps a gentle "anti-gravity"
// upward migration (wrapping back in at the bottom) so the field still
// reads as flowing rather than static. `depth` (0-1, picked once per dot)
// scales size/opacity/orbit-radius/mouse-response together, so "closer"
// dots are bigger, brighter, orbit wider, and react more to the cursor --
// a cheap but effective sense of parallax with no actual z-axis.
//
// Mouse interaction: a single `pointermove` listener on `window` (the
// canvas itself is `pointer-events: none`, so it can never intercept
// clicks) tracks the live cursor position; each frame, any dot within
// `MOUSE_RADIUS` of the cursor (converted to this canvas's own local
// coordinates via `getBoundingClientRect()`, so it works correctly for
// both the `confined` and full-viewport variants) gets nudged toward it,
// proportional to proximity and the dot's own depth -- "move along it"
// without the dots ever snapping onto the cursor or losing their orbit.
//
// Connecting lines: every frame, after positions are updated, every pair
// of dots closer than `LINE_DISTANCE` gets a single faint stroke between
// them, opacity falling off with distance and scaled down further by the
// dimmer of the two dots' own depth -- this is what turns a plain dot
// field into the "network/constellation" look the reference has, kept
// deliberately subtle (`LINE_MAX_OPACITY`) so it never competes with real
// page content, even on a dashboard full of data.
//
// `prefers-reduced-motion`: checked once at mount. When it's set, the
// orbit/wander/rise motion never advances and the mouse listener is never
// even registered -- dots and their connecting lines still render once, in
// whatever position their initial random values produced, as a genuine
// static fallback rather than a frozen mid-animation frame.
//
// Round 7 visibility fix: the dots were confirmed (via pixel inspection,
// not guesswork) to actually be drawing correctly on every page, but at a
// size/opacity so subtle (r 1-3.2px, opacity up to ~0.42 with most of the
// visible area being an even fainter ~0.09 glow halo) that against a light
// page background they read as effectively invisible -- the user's own
// screenshot of a live page showed nothing moving. Bumped `r`, `opacity`,
// the halo's opacity multiplier, and `LINE_MAX_OPACITY` so the effect is
// unmistakably present at a glance, not just technically rendering.
//
// Mobile density: `makeParticles()` scales the requested `count` down on
// narrow canvases (45% under 480px, 70% under 720px) so a confined panel
// on a phone doesn't end up with the same dot density as the same panel on
// a desktop monitor.
//
// Color: by default each dot is drawn in the app's own --primary token, so
// it automatically matches the current light/dark palette with no extra
// theming work. Pass `color` for a single explicit override, or `colors`
// (an array) to assign each dot a random, FIXED-at-creation color from that
// list instead (never re-picked per frame, so a dot doesn't flicker as it
// moves). Two palettes are exported: `PARTICLE_COLORS`, the original
// 5-color set (blue/pink/violet/amber/teal, matching `ConfettiBurst.jsx`'s
// own palette) used everywhere particles already appear, and the new
// `PARTICLE_COLORS_RESTRAINED` (indigo/violet/teal only) -- used just on
// the Landing hero, per this round's explicit "restrained indigo, violet,
// teal" direction for that specific sealed dark stage; every other mount
// point keeps the existing 5-color set rather than being recolored.
//
// Two render modes, unchanged from before:
// - default (`confined` unset): `position: fixed`, full viewport.
// - `confined`: `position: absolute`, sized to the nearest positioned
//   ancestor, at `z-index: -1` so it reliably paints behind its siblings
//   (see ParticleBackground.css) regardless of whether they're explicitly
//   positioned or ordinary static-flow elements.
export const PARTICLE_COLORS = ['#3B82F6', '#EC4899', '#8B5CF6', '#F59E0B', '#14B8A6'];
export const PARTICLE_COLORS_RESTRAINED = ['#6366F1', '#8B5CF6', '#14B8A6'];

const LINE_DISTANCE = 110; // CSS px -- how close two dots must be to draw a connecting line
const LINE_MAX_OPACITY = 0.22; // visible but still a hint of a network, not a web
const MOUSE_RADIUS = 150; // CSS px -- how close the cursor must be to influence a dot
const MOUSE_PULL = 22; // CSS px -- max positional nudge toward the cursor at zero distance

export default function ParticleBackground({ count = 46, confined = false, color, colors }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let cancelled = false;
    let rafId = null;
    let particles = [];
    let mouseX = null;
    let mouseY = null;
    let mouseActive = false;
    const reduceMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function themeColor() {
      if (color) return color;
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--primary');
        return v && v.trim() ? v.trim() : '#16A34A';
      } catch {
        return '#16A34A';
      }
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, canvas.offsetWidth * dpr);
      canvas.height = Math.max(1, canvas.offsetHeight * dpr);
    }

    function makeParticles() {
      const w = canvas.offsetWidth || window.innerWidth;
      const h = canvas.offsetHeight || window.innerHeight;
      const hasPalette = Array.isArray(colors) && colors.length > 0;
      const effectiveCount = w < 480 ? Math.round(count * 0.45) : w < 720 ? Math.round(count * 0.7) : count;
      particles = Array.from({ length: effectiveCount }, () => {
        const depth = Math.random(); // 0 = distant (small/faint/tight orbit), 1 = close (bold/wide orbit)
        return {
          ox: Math.random() * w,
          oy: Math.random() * h,
          angle: Math.random() * Math.PI * 2,
          angularSpeed: (0.004 + Math.random() * 0.008) * (Math.random() < 0.5 ? 1 : -1),
          orbitRadius: 8 + depth * 34,
          wanderAngle: Math.random() * Math.PI * 2,
          wanderSpeed: 0.0003 + Math.random() * 0.0007,
          wanderRadius: 10 + Math.random() * 16,
          rise: 0.05 + depth * 0.16,
          r: 1.8 + depth * 3.4,
          depth,
          opacity: 0.26 + depth * 0.56,
          x: 0,
          y: 0,
          // fixed once at creation, not re-picked every frame, so a given
          // dot doesn't flicker between colors as it moves
          color: hasPalette ? colors[Math.floor(Math.random() * colors.length)] : null,
        };
      });
    }

    function drawFrame() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth || window.innerWidth;
      const h = canvas.offsetHeight || window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      const fallbackColor = themeColor();

      let localMouseX = null;
      let localMouseY = null;
      if (mouseActive) {
        const rect = canvas.getBoundingClientRect();
        localMouseX = mouseX - rect.left;
        localMouseY = mouseY - rect.top;
      }

      // Advance motion and resolve each dot's on-screen position first, so
      // both the connecting lines and the dots themselves draw from the
      // same settled frame.
      for (const p of particles) {
        if (!reduceMotion) {
          p.angle += p.angularSpeed;
          p.wanderAngle += p.wanderSpeed;
          p.oy -= p.rise;
          if (p.oy < -60) {
            p.oy = h + 60;
            p.ox = Math.random() * w;
          }
        }
        const centerX = p.ox + Math.cos(p.wanderAngle) * p.wanderRadius;
        const centerY = p.oy + Math.sin(p.wanderAngle) * p.wanderRadius;
        let x = centerX + Math.cos(p.angle) * p.orbitRadius;
        let y = centerY + Math.sin(p.angle) * p.orbitRadius;

        if (localMouseX != null) {
          const dx = localMouseX - x;
          const dy = localMouseY - y;
          const dist = Math.hypot(dx, dy);
          if (dist < MOUSE_RADIUS && dist > 0.001) {
            const pull = (1 - dist / MOUSE_RADIUS) * MOUSE_PULL * (0.4 + p.depth * 0.6);
            x += (dx / dist) * pull;
            y += (dy / dist) * pull;
          }
        }

        p.x = x;
        p.y = y;
      }

      // Faint connecting lines between nearby dots, drawn before the dots
      // themselves so the dots sit visually on top of their own lines.
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= LINE_DISTANCE) continue;
          const proximity = 1 - dist / LINE_DISTANCE;
          const alpha = proximity * LINE_MAX_OPACITY * (0.4 + Math.min(a.depth, b.depth) * 0.6);
          if (alpha <= 0.004) continue;
          ctx.beginPath();
          ctx.strokeStyle = a.color || b.color || fallbackColor;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 1;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const p of particles) {
        const dotColor = p.color || fallbackColor;
        ctx.beginPath();
        ctx.fillStyle = dotColor;
        ctx.globalAlpha = p.opacity;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        // soft glow halo around each dot -- the "glitter" look
        ctx.globalAlpha = p.opacity * 0.32;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function loop() {
      if (cancelled) return;
      drawFrame();
      rafId = requestAnimationFrame(loop);
    }

    resize();
    makeParticles();
    if (reduceMotion) {
      drawFrame();
    } else {
      rafId = requestAnimationFrame(loop);
    }

    function handleResize() {
      resize();
    }
    function handlePointerMove(e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      mouseActive = true;
    }

    window.addEventListener('resize', handleResize);
    // No mouse listener at all under reduced motion -- there is nothing
    // for it to drive, and it costs nothing to simply not register it.
    if (!reduceMotion) {
      window.addEventListener('pointermove', handlePointerMove, { passive: true });
    }

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
    };
    // `colors` is expected to be a stable reference (the exported
    // `PARTICLE_COLORS`/`PARTICLE_COLORS_RESTRAINED` constants, or similar
    // module-level array) -- every call site passes it that way
    // specifically so this effect doesn't re-run (and reshuffle every
    // dot's position) on every parent render.
  }, [count, color, colors]);

  return (
    <canvas
      ref={canvasRef}
      className={confined ? 'particle-bg particle-bg--confined' : 'particle-bg'}
      aria-hidden="true"
    />
  );
}
