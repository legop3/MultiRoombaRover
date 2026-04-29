// Rover Color Utility
// Purpose: Maps rover identity/state to deterministic UI color choices. Scope: Supplies shared color resolution helpers for lists, badges, and overlays.
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function normalizeRoverColor(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || !HEX_RE.test(raw)) return null;
  return raw.toUpperCase();
}

export function roverNameChromeStyle(color, alpha = 0.2) {
  const normalized = normalizeRoverColor(color);
  if (!normalized) return undefined;
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.2;
  const rgb = hexToRgb(normalized);
  if (!rgb) return undefined;
  return {
    borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.65)`,
    backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`,
  };
}

export function roverBadgeStyle(color, alpha = 0.2) {
  const normalized = normalizeRoverColor(color);
  if (!normalized) return undefined;
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.2;
  const rgb = hexToRgb(normalized);
  if (!rgb) return undefined;
  return {
    borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.55)`,
    backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`,
  };
}

export function roverSwatchStyle(color) {
  const normalized = normalizeRoverColor(color);
  if (!normalized) return undefined;
  return { backgroundColor: normalized };
}

function hexToRgb(hex) {
  const normalized = normalizeRoverColor(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}
