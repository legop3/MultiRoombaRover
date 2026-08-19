// Expansion Toggle
// Purpose: Provides a slim edge strip that remains part of an expansion in both visibility states.
import { FaChevronDown, FaChevronLeft, FaChevronRight, FaChevronUp } from 'react-icons/fa';

const ICONS = { down: FaChevronDown, left: FaChevronLeft, right: FaChevronRight, up: FaChevronUp };

export default function ExpansionToggle({ direction, label, onClick, className = '' }) {
  const Icon = ICONS[direction] || FaChevronLeft;
  const horizontalEdge = direction === 'up' || direction === 'down';
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center bg-black/60 text-[0.5rem] text-white/75 hover:bg-black hover:text-white ${horizontalEdge ? 'h-3 w-8' : 'h-8 w-3'} ${className}`}
    >
      {/* The black strip is intentionally retained around the chevron. A collapsed expansion is
          therefore still a thin piece of that expansion, never a loose button over a pod. */}
      <Icon aria-hidden="true" />
    </button>
  );
}
