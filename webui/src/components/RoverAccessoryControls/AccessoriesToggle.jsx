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
  const sizeClass = compact ? 'h-6 w-10' : 'h-full w-8';
  const toneClass = hud
    ? 'rounded-none border-0 bg-black/60 text-white/75 shadow-none hover:bg-black hover:text-white'
    : 'rounded-xl border-2 border-cyan-300/70 bg-cyan-900 text-cyan-50 shadow-md hover:brightness-110 active:brightness-125';

  return (
    <button
      type="button"
      aria-label={ariaLabel || label}
      onClick={() => {
        triggerTouchHaptic('button');
        onClick();
      }}
      className={`mobile-touch-control flex shrink-0 items-center justify-center text-sm font-semibold transition active:scale-[0.98] ${sizeClass} ${toneClass} ${className}`.trim()}
    >
      {/* Full launchers use vertical writing in the narrow wall space. The
          compact Aux return stays horizontal so it consumes only one heading. */}
      <span className={compact ? 'flex items-center' : 'flex items-center gap-1 [writing-mode:vertical-rl] rotate-180'}>
        {!compact ? <FaPuzzlePiece className="shrink-0 text-sm" aria-hidden="true" /> : null}
        <span>{label}</span>
      </span>
    </button>
  );
}
