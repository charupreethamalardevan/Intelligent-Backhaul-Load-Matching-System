// Small shared relative-time formatter for activity feeds across the
// Admin/Fleet/Poster dashboards -- avoids each one hand-rolling its own.
export function timeAgo(dateLike) {
  if (!dateLike) return '';
  const d = new Date(dateLike);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Buckets a list of items with a date-ish field into the last `days` daily
// counts (oldest first), zero-filled for days with no activity -- used to
// drive the signups/requests-over-time mini line charts.
export function bucketByDay(items, getDate, days = 14) {
  const buckets = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    buckets.push({ key: day.toISOString().slice(0, 10), day, value: 0 });
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const item of items) {
    const d = getDate(item);
    if (!d) continue;
    const key = new Date(d).toISOString().slice(0, 10);
    if (byKey[key]) byKey[key].value += 1;
  }
  return buckets.map((b) => ({
    label: b.day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).replace(' ', ''),
    value: b.value,
  }));
}
