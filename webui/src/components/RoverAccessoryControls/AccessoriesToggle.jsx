// Accessories Vertical Toggle
// Purpose: Gives mobile and desktop the same edge-mounted control for changing accessory visibility.
// Scope: Owns only visual treatment and activation; each parent decides its position and destination.
import { FaPuzzlePiece } from 'react-icons/fa';
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';

export default function AccessoriesToggle({
  label,
  ariaLabel,
  onClick,
  compact = false,
  hud = false,
  className = '',
}) {
  // The Back action is still shorter than the vertical launcher, but it needs
  // a normal touch target and a readable word instead of the previous tiny
  // abbreviated control. The full launcher continues to fill the height its
  // desktop or mobile parent assigns to it.
  const sizeClass = compact ? 'h-8 w-14' : 'h-full w-8';
  const toneClass = hud
    // On desktop the tab sits inside the shared popout shell. Rounding only
    // its exposed right edge preserves its left-wall attachment without
    // introducing a separate accessory-specific panel treatment.
    ? 'rounded-r-xl border-0 bg-black/60 text-white shadow-none'
    : 'rounded-xl border-2 border-cyan-300/70 bg-cyan-900 text-cyan-50 shadow-md';

  return (
    <button
      type="button"
      aria-label={ariaLabel || label}
      onClick={() => {
        triggerTouchHaptic('button');
        onClick();
      }}
      className={`mobile-touch-control flex shrink-0 items-center justify-center text-sm font-semibold ${sizeClass} ${toneClass} ${className}`.trim()}
    >
      {/* Full launchers use vertical writing in the narrow wall space. The
          compact Back action stays horizontal so it fits in the heading. */}
      <span className={compact ? 'flex items-center' : 'flex items-center gap-1 [writing-mode:vertical-rl] rotate-180'}>
        {!compact ? <FaPuzzlePiece className="shrink-0 text-sm" aria-hidden="true" /> : null}
        <span>{label}</span>
      </span>
    </button>
  );
}
