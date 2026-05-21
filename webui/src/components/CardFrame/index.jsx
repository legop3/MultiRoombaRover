function cx(...values) {
  return values.filter(Boolean).join(' ');
}

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

export default function CardFrame({
  title = '',
  meta = null,
  actions = null,
  accent = null,
  hideHeader = false,
  className = '',
  headerClassName = '',
  bodyClassName = '',
  fillHeight = false,
  children,
}) {
  const showHeader = !hideHeader && (title || meta != null || actions);
  const accentRgb = hexToRgb(accent);
  const cardStyle = accentRgb ? { borderColor: rgba(accentRgb, 0.65) } : undefined;
  const headerStyle = accentRgb
    ? {
        backgroundImage: `linear-gradient(90deg, rgba(23,23,23,0.96) 0%, rgba(38,38,38,0.94) 58%, ${rgba(accentRgb, 0.18)} 100%)`,
      }
    : undefined;

  return (
    <section
      className={cx(
        'panel-section overflow-hidden border border-neutral-600/55 bg-neutral-900/95 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_24px_rgba(0,0,0,0.3)]',
        fillHeight && 'flex h-full min-h-0 flex-col',
        className,
      )}
      style={cardStyle}
    >
      {showHeader ? (
        <header
          className={cx(
            'flex items-center justify-between gap-0.5 border-b border-neutral-600/45 bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-700 px-0.5 py-0.5',
            headerClassName,
          )}
          style={headerStyle}
        >
          <div className="flex min-w-0 items-center gap-0.5">
            {title ? <p className="m-0 text-[0.78rem] font-semibold leading-none text-neutral-100">{title}</p> : null}
            {meta != null ? <span className="text-[0.68rem] font-medium leading-none text-neutral-300">{meta}</span> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center justify-end gap-0.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx('', fillHeight && 'flex flex-1 min-h-0 flex-col', bodyClassName)}>{children}</div>
    </section>
  );
}
