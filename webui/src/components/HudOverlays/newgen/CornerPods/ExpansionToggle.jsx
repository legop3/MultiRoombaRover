// Expansion Toggle
// Purpose: Provides a slim edge strip that remains part of an expansion in both visibility states.
import { FaChevronDown, FaChevronLeft, FaChevronRight, FaChevronUp } from 'react-icons/fa';

const ICONS = { down: FaChevronDown, left: FaChevronLeft, right: FaChevronRight, up: FaChevronUp };

export default function ExpansionToggle({ direction, label, onClick, className = '' }) {
  const Icon = ICONS[direction] || FaChevronLeft;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`z-10 flex h-3 w-8 shrink-0 items-center justify-center bg-black/60 text-[0.5rem] text-white/75 hover:bg-black hover:text-white ${className}`}
    >
      {/* ExpansionPanel owns all positioning so this button has exactly one visual
          form. Only the chevron direction changes between open and closed states. */}
      <Icon aria-hidden="true" />
    </button>
  );
}
