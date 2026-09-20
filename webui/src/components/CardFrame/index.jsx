import { useSessionSelector } from '../../context/SessionContext.jsx';

// Utilities
function cx(...values) {
  return values.filter(Boolean).join(' ');
}

// Color helpers
function hexToRgb(hex) {
  const raw = String(hex || '').trim();
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// Component
export default function CardFrame({
  title = '',
  meta = null,
  actions = null,
  color = null,
  hideHeader = false,
  stickyHeader = false,
  className = '',
  headerClassName = '',
  bodyClassName = '',
  fillHeight = false,
  clipOverflow = true,
  children,
}) {
  const showHeader = !hideHeader && (title || meta != null || actions);
  const greenMode = useSessionSelector((state) => Boolean(state.session?.greenMode));
  const ownRoverColor = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    if (!roverId) return null;
    const roster = Array.isArray(state.session?.roster) ? state.session.roster : [];
    const rover = roster.find((entry) => String(entry?.id) === roverId);
    return rover?.color || null;
  });

  // Callers can supply a structural accent, while ordinary cards continue to
  // inherit the assigned rover's color without needing to know session state.
  const accentRgb = hexToRgb(color || ownRoverColor);

  const cardStyle = greenMode
    ? { borderColor: '#008a35' }
    : accentRgb
      ? { borderColor: rgba(accentRgb, 0.3) }
      : undefined;

  const headerStyle = greenMode
    ? { borderColor: '#008a35' }
    : accentRgb
    ? {
        // The header divider uses the same accent as the outside border. This
        // makes the color describe the complete CardFrame rather than looking
        // like an unrelated tint applied only behind its title.
        borderColor: rgba(accentRgb, 0.3),
        backgroundImage: `linear-gradient(90deg, ${rgba(accentRgb, 0.2)} 100%)`,
      }
    : undefined;

  return (
    <section
      className={cx(
        // Cards are reused in full-width pages, mobile stacks, and narrow desktop
        // sidebars. Making the card itself a query container lets its contents
        // respond to the space they actually receive instead of the viewport,
        // which may be wide while a sidebar card is only a few hundred pixels.
        'panel-section @container border border-neutral-500/60 bg-neutral-900',
        clipOverflow ? 'overflow-hidden' : 'overflow-visible',
        fillHeight && 'flex h-full min-h-0 flex-col',
        className,
      )}
      style={cardStyle}
    >
      {showHeader ? (
        // Header row
        <header
          className={cx(
            'flex items-center justify-between gap-0.5 border-b border-neutral-500/50 bg-slate-800 px-0.5 py-0.5',
            // Sticky headings are opt-in because many CardFrames are short or
            // live inside independently scrolling panes. Keeping the behavior
            // on the shared component gives long cards a consistent title bar
            // without changing the layout of existing callers.
            stickyHeader && 'sticky top-0 z-10',
            // 'flex items-center justify-between gap-0.5 border-b border-neutral-500/50 bg-linear-to-r from-neutral-800 via-neutral-700 to-neutral-600 px-0.5 py-0.5',
            headerClassName,
          )}
          style={headerStyle}
        >
          <div className="flex min-w-0 items-center gap-0.5">
            {title ? (
              <p className={cx('m-0  font-semibold leading-none', greenMode ? 'text-lime-400' : 'text-neutral-50')}>
                {title}
              </p>
            ) : null}
            {meta != null ? <span className="text-[0.68rem] font-medium leading-none text-neutral-200">{meta}</span> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center justify-end gap-0.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx(fillHeight && 'flex flex-1 min-h-0 flex-col', bodyClassName)}>{children}</div>
    </section>
  );
}
