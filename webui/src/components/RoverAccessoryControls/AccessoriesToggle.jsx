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
  className = '',
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel || label}
      onClick={() => {
        triggerTouchHaptic('button');
        onClick();
      }}
      className={`mobile-touch-control flex shrink-0 items-center justify-center rounded-xl border-2 border-cyan-300/70 bg-cyan-900 text-sm font-semibold text-cyan-50 shadow-md transition hover:brightness-110 active:scale-[0.98] active:brightness-125 ${compact ? 'h-14 w-7' : 'h-full w-8'} ${className}`.trim()}
    >
      {/* Vertical writing keeps the launcher readable in the narrow wall space
          without rotating the glyph itself away from its natural orientation. */}
      <span className="flex items-center gap-1 [writing-mode:vertical-rl] rotate-180">
        {!compact ? <FaPuzzlePiece className="shrink-0 text-sm" aria-hidden="true" /> : null}
        <span>{label}</span>
      </span>
    </button>
  );
}
