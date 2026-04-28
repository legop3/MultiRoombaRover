// Geometry and color helpers for top-down rover sensor map.
export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function toRad(angleDeg) {
  return ((angleDeg - 90) * Math.PI) / 180;
}

export function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = toRad(angleDeg);
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

export function describeArc(cx, cy, r, startDeg, endDeg) {
  let start = startDeg;
  let end = endDeg;
  if (end <= start) end += 360;
  const startPt = polarToCartesian(cx, cy, r, start);
  const endPt = polarToCartesian(cx, cy, r, end);
  return ['M', startPt.x, startPt.y, 'A', r, r, 0, 0, 1, endPt.x, endPt.y].join(' ');
}

export function currentColor(value, overcurrent) {
  if (overcurrent) return '#ef4444';
  const mag = Math.abs(value);
  if (mag > 900) return '#f59e0b';
  if (mag > 300) return '#22c55e';
  return '#64748b';
}

export function lightBumpColor(value, max) {
  if (value == null || value <= 0) return 'hsl(200 60% 18%)';
  const maxVal = max || 1;
  const norm = clamp01(value / maxVal);
  const eased = Math.pow(norm, 0.45);
  const startHue = 200;
  const hue = (startHue + eased * 360) % 360;
  return `hsl(${hue} 100% 60%)`;
}

export function cliffColor(value, active) {
  if (active) return '#ef4444';
  const t = clamp01(value == null ? 0 : value / 4095);
  const start = [47, 55, 69];
  const end = [245, 158, 11];
  const [r, g, b] = start.map((s, i) => Math.round(s + (end[i] - s) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

export function buildSegments({ count, totalSpan, gap, startAngle }) {
  const usable = totalSpan - gap * (count - 1);
  const width = usable / count;
  const segments = [];
  let cursor = startAngle;
  for (let i = 0; i < count; i += 1) {
    const end = cursor + width;
    segments.push({ start: cursor, end });
    cursor = end + gap;
  }
  return segments;
}
