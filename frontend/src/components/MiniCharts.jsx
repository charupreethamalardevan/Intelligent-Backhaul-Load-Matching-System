import './widgets.css';

// Two small, dependency-free SVG charts -- no charting library is in this
// project (plain CSS, minimal deps is the established pattern here), and
// these datasets are small enough that hand-drawn SVG is simpler than
// pulling one in. Both are theme-aware via CSS custom properties resolved
// directly in SVG presentation attributes (supported in all modern
// browsers), so they follow the Forest & Gray light/dark tokens for free.
//
// Round 3: colour pass (per direct user feedback -- "use colours... make
// the graph look good"). Both charts now default to the app's new --info
// (blue) token instead of the monochrome --primary, take an explicit
// `color` prop for callers that want a specific hue, draw three faint
// reference gridlines so the eye has something to measure against, and
// put a native <title> on every point/bar so hovering shows its exact
// value -- the cheapest possible tooltip, no extra JS state needed. A bar
// chart whose data carries more than one colour also prints a small
// legend underneath (colour is never the only cue to what a bar means).

const W = 520;
const H = 180;
const PAD = 28;

function Gridlines() {
  const rows = [0.25, 0.5, 0.75];
  return (
    <g>
      {rows.map((f) => {
        const y = PAD + f * (H - PAD * 2 - 10);
        return <line key={f} className="wg-chart-gridline" x1={PAD} y1={y} x2={W - PAD} y2={y} />;
      })}
    </g>
  );
}

// Monotone cubic (Fritsch-Carlson) interpolation through evenly-spaced
// points -- turns the straight-segment polyline into a smooth curve
// *without* ever overshooting a point's own value. That guard matters
// here specifically: these are sparse daily series (mostly zero days
// with one or two single-day spikes), and a naive Catmull-Rom smoothing
// pass would overshoot on exactly that shape, bowing the curve below the
// zero baseline right next to a spike -- a worse visual bug than the
// straight-line version it was meant to improve on. Monotone interpolation
// is the standard fix (same technique as D3's curveMonotoneX): it fits a
// smooth curve that never introduces a dip or peak the data itself
// doesn't have.
function monotonePath(points) {
  const n = points.length;
  if (n < 2) return '';
  if (n === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;

  const dx = points[1].x - points[0].x; // evenly spaced, so one delta works for all segments
  const d = points.slice(0, -1).map((p, i) => (points[i + 1].y - p.y) / dx);
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    m[i] = d[i - 1] === 0 || d[i] === 0 || (d[i - 1] < 0) !== (d[i] < 0) ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const tau = 3 / h;
        m[i] = tau * a * d[i];
        m[i + 1] = tau * b * d[i];
      }
    }
  }

  let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const c1x = p0.x + dx / 3;
    const c1y = p0.y + (m[i] * dx) / 3;
    const c2x = p1.x - dx / 3;
    const c2y = p1.y - (m[i + 1] * dx) / 3;
    path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return path;
}

// data: [{ label, value }], oldest-first.
export function MiniLineChart({ data, emptyText = 'Not enough data yet.', color = 'var(--info)' }) {
  if (!data || data.length < 2) {
    return <div className="wg-chart-empty">{emptyText}</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = (W - PAD * 2) / (data.length - 1);
  const points = data.map((d, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - d.value / max) * (H - PAD * 2 - 10);
    return { x, y, ...d };
  });
  const linePath = monotonePath(points);
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - PAD} L${points[0].x.toFixed(1)},${H - PAD} Z`;
  const gradientId = `wgLineFill-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  const last = points[points.length - 1];
  // The one direct label this chart gets (per "label selectively, never a
  // number on every point"): the endpoint value, which is also the most
  // recent day -- the number a reader actually wants without hovering.
  const lastLabelAbove = last.y > PAD + 16;

  return (
    <svg className="wg-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <Gridlines />
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === points.length - 1 ? 5 : 3.5}
          fill="var(--card)"
          stroke={color}
          strokeWidth={i === points.length - 1 ? 2.5 : 2.25}
        >
          <title>
            {p.label}: {p.value}
          </title>
        </circle>
      ))}
      <text
        x={last.x}
        y={lastLabelAbove ? last.y - 10 : last.y + 18}
        textAnchor="end"
        className="wg-chart-bar-value"
      >
        {last.value}
      </text>
      {points.map(
        (p, i) =>
          (i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
            <text key={`l${i}`} x={p.x} y={H - 6} textAnchor="middle" className="wg-chart-axis-label">
              {p.label}
            </text>
          ),
      )}
    </svg>
  );
}

// data: [{ label, value, color? }]. color defaults to the theme info blue;
// pass distinct colors per bucket (e.g. status breakdowns) for a legend.
//
// `dense` is for a many-bucket series (e.g. a 14-day daily count) rather
// than a handful of named categories (cargo types, statuses). With 10+
// skinny bars, a label under every single one and a value number over
// every single one -- mostly "0" on a day with no activity -- just
// overlaps into noise. Dense mode borrows MiniLineChart's own solution to
// the identical problem: only label the first/middle/last bar, and drop
// the per-bar value number entirely (still available on hover via the
// existing <title>, same as every other mark in these charts).
export function MiniBarChart({ data, emptyText = 'No data yet.', showLegend = true, dense = false, color = 'var(--info)' }) {
  if (!data || data.every((d) => d.value === 0)) {
    return <div className="wg-chart-empty">{emptyText}</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = Math.min(52, (W - PAD * 2) / data.length - 16);
  const gap = (W - PAD * 2 - barW * data.length) / Math.max(1, data.length - 1);
  const distinctColors = new Set(data.map((d) => d.color || color));
  const legend = showLegend && distinctColors.size > 1;
  // Thin dense bars read as pills, not bars, at the same 7px corner radius
  // a wide category bar uses -- cap it to a fraction of the bar's own width.
  const rx = Math.min(7, barW / 2.5);

  return (
    <>
      <svg className="wg-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Gridlines />
        {data.map((d, i) => {
          const x = PAD + i * (barW + gap);
          const barH = Math.max(3, (d.value / max) * (H - PAD * 2 - 14));
          const y = H - PAD - barH;
          const barColor = d.color || color;
          const showLabel = !dense || i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2);
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={barH} rx={rx} fill={barColor} opacity={d.value === 0 ? 0.25 : 1}>
                <title>
                  {d.label}: {d.value}
                </title>
              </rect>
              {showLabel && (
                <text x={x + barW / 2} y={H - PAD + 16} textAnchor="middle" className="wg-chart-axis-label">
                  {d.label}
                </text>
              )}
              {!dense && (
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="wg-chart-bar-value">
                  {d.value}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {legend && (
        <div className="wg-chart-legend">
          {data.map((d) => (
            <div className="wg-chart-legend-item" key={d.label}>
              <span className="wg-chart-legend-sw" style={{ background: d.color || color }} />
              {d.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
