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
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - PAD} L${points[0].x.toFixed(1)},${H - PAD} Z`;
  const gradientId = `wgLineFill-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg className="wg-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <Gridlines />
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="var(--card)" stroke={color} strokeWidth="2.25">
          <title>
            {p.label}: {p.value}
          </title>
        </circle>
      ))}
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
export function MiniBarChart({ data, emptyText = 'No data yet.', showLegend = true }) {
  if (!data || data.every((d) => d.value === 0)) {
    return <div className="wg-chart-empty">{emptyText}</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = Math.min(52, (W - PAD * 2) / data.length - 16);
  const gap = (W - PAD * 2 - barW * data.length) / Math.max(1, data.length - 1);
  const distinctColors = new Set(data.map((d) => d.color || 'var(--info)'));
  const legend = showLegend && distinctColors.size > 1;

  return (
    <>
      <svg className="wg-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Gridlines />
        {data.map((d, i) => {
          const x = PAD + i * (barW + gap);
          const barH = Math.max(3, (d.value / max) * (H - PAD * 2 - 14));
          const y = H - PAD - barH;
          const barColor = d.color || 'var(--info)';
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={barH} rx="7" fill={barColor} opacity={d.value === 0 ? 0.25 : 1}>
                <title>
                  {d.label}: {d.value}
                </title>
              </rect>
              <text x={x + barW / 2} y={H - PAD + 16} textAnchor="middle" className="wg-chart-axis-label">
                {d.label}
              </text>
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="wg-chart-bar-value">
                {d.value}
              </text>
            </g>
          );
        })}
      </svg>
      {legend && (
        <div className="wg-chart-legend">
          {data.map((d) => (
            <div className="wg-chart-legend-item" key={d.label}>
              <span className="wg-chart-legend-sw" style={{ background: d.color || 'var(--info)' }} />
              {d.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
