// Corner Pod Toggle
// Purpose: Reserves each exact video corner for a pod's always-reachable collapse control.
import { FaArrowUp } from 'react-icons/fa';

const CORNERS = {
  'top-left': {
    button: 'left-0 top-0 [clip-path:polygon(0_0,100%_0,0_100%)]',
    icon: 'left-1 top-1',
    collapseRotation: '-rotate-45',
    expandRotation: 'rotate-[135deg]',
  },
  'top-right': {
    button: 'right-0 top-0 [clip-path:polygon(0_0,100%_0,100%_100%)]',
    icon: 'right-1 top-1',
    collapseRotation: 'rotate-45',
    expandRotation: '-rotate-[135deg]',
  },
  'bottom-left': {
    button: 'bottom-0 left-0 [clip-path:polygon(0_0,0_100%,100%_100%)]',
    icon: 'bottom-1 left-1',
    collapseRotation: '-rotate-[135deg]',
    expandRotation: 'rotate-45',
  },
  'bottom-right': {
    button: 'bottom-0 right-0 [clip-path:polygon(100%_0,0_100%,100%_100%)]',
    icon: 'bottom-1 right-1',
    collapseRotation: 'rotate-[135deg]',
    expandRotation: '-rotate-45',
  },
};

export default function CornerPodToggle({ corner, expanded, label, onClick }) {
  const placement = CORNERS[corner] || CORNERS['top-left'];
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`pointer-events-auto absolute z-40 h-10 w-10 bg-black/90 text-white/90 hover:bg-black hover:text-white ${placement.button}`}
    >
      {/* One arrow icon is rotated toward the physical corner for collapse and directly away
          from it for expansion. The triangular hit target itself never moves or disappears. */}
      <FaArrowUp
        className={`absolute text-[0.65rem] ${placement.icon} ${expanded ? placement.collapseRotation : placement.expandRotation}`}
        aria-hidden="true"
      />
    </button>
  );
}
