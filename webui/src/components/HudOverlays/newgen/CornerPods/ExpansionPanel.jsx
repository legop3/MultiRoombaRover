// HUD Expansion Panel
// Purpose: Gives every independent HUD expansion one fixed toggle anchor and identical open/closed behavior.
import ExpansionToggle from './ExpansionToggle.jsx';

export default function ExpansionPanel({
  open,
  onOpenChange,
  anchorClassName = '',
  panelClassName = '',
  panelAlign = 'left',
  panelVerticalAlign = 'top',
  openDirection,
  closeDirection,
  openLabel,
  closeLabel,
  children,
}) {
  const panelAlignmentClass = panelAlign === 'right' ? 'right-0' : 'left-0';
  const panelVerticalAlignmentClass = panelVerticalAlign === 'bottom' ? 'bottom-0' : 'top-0';

  return (
    <div className={`pointer-events-auto z-20 h-3 w-8 ${anchorClassName}`}>
      {/* The content is positioned behind the fixed 32-by-12 anchor. Opening or
          closing changes only whether this panel exists; it never relocates or
          restyles the toggle that the user just clicked. */}
      {open ? (
        <div className={`absolute z-0 ${panelAlignmentClass} ${panelVerticalAlignmentClass} ${panelClassName}`}>
          {children}
        </div>
      ) : null}
      <ExpansionToggle
        direction={open ? closeDirection : openDirection}
        label={open ? closeLabel : openLabel}
        onClick={() => onOpenChange(!open)}
        className="absolute left-0 top-0"
      />
    </div>
  );
}
