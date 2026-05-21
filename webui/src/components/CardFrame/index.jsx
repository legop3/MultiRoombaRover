function cx(...values) {
  return values.filter(Boolean).join(' ');
}

export default function CardFrame({
  title = '',
  meta = null,
  actions = null,
  hideHeader = false,
  className = '',
  headerClassName = '',
  bodyClassName = '',
  fillHeight = false,
  children,
}) {
  const showHeader = !hideHeader && (title || meta != null || actions);

  return (
    <section
      className={cx(
        'panel-section overflow-hidden border border-neutral-600/55 bg-neutral-900/95 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_24px_rgba(0,0,0,0.3)]',
        fillHeight && 'flex h-full min-h-0 flex-col',
        className,
      )}
    >
      {showHeader ? (
        <header
          className={cx(
            'flex items-center justify-between gap-0.5 border-b border-neutral-600/45 bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-700 px-0.5 py-0.5',
            headerClassName,
          )}
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
