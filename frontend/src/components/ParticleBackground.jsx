import { useEffect, useRef } from 'react';
import './ParticleBackground.css';

// A soft field of slowly drifting, glowing dots used as an always-on
// ambient backdrop -- the user's own description: "atom particles like
// glitters, flow in circles like in the anti-gravity screen, that flows
// behind the screen always." Mounted once per page (Login, Signup, every
// dashboard via DashboardShell, and the landing page's own below-the-fold
// sections -- the cinematic hero above the fold already has its own
// node-graph ambient canvas from Addendum 26, so this isn't added there
// too). Pure <canvas>, no animation/particle library: each dot drifts
// upward with a gentle side-to-side sway (the "anti-gravity" look), wraps
// back in at the bottom when it drifts off the top, and is drawn in the
// app's own --primary token so it automatically matches Forest & Gray in
// both light and dark mode with no extra theming work.
//
// Deliberately inert: fixed position, full viewport, zero pointer-events,
// and always painted BEHIND real content -- every page that mounts this
// gives its own content wrapper `position: relative; z-index: 1` (or
// higher) so it stacks above this canvas's `z-index: 0` regardless of DOM
// order. See index.css's `.page`, DashboardShell.css's `.ds-main`,
// SignupRoleSelect.css's already-zIndex:2 content, and
// LandingSections.css's `.ls-page` for the four places that's done.
export default function ParticleBackground({ count = 46 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let cancelled = false;
    let rafId = null;
    let particles = [];
    const reduceMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function themeColor() {
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
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random() * 2.4,
        speed: 0.1 + Math.random() * 0.22,
        drift: Math.random() * Math.PI * 2,
        driftSpeed: 0.0015 + Math.random() * 0.0035,
        swing: 6 + Math.random() * 22,
        opacity: 0.12 + Math.random() * 0.3,
      }));
    }

    function drawFrame() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth || window.innerWidth;
      const h = canvas.offsetHeight || window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      const color = themeColor();
      for (const p of particles) {
        if (!reduceMotion) {
          p.drift += p.driftSpeed;
          p.y -= p.speed;
          if (p.y < -12) {
            p.y = h + 12;
            p.x = Math.random() * w;
          }
        }
        const x = p.x + Math.sin(p.drift) * p.swing;
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = p.opacity;
        ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        // soft glow halo around each dot -- the "glitter" look
        ctx.globalAlpha = p.opacity * 0.22;
        ctx.beginPath();
        ctx.arc(x, p.y, p.r * 3.2, 0, Math.PI * 2);
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
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
    };
  }, [count]);

  return <canvas ref={canvasRef} className="particle-bg" aria-hidden="true" />;
}
