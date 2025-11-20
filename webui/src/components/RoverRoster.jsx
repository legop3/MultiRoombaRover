function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function formatBattery(rover) {
  const percent = rover?.batteryState?.percentDisplay;
  if (percent == null) return '--';
  return `${percent}%`;
}

function batteryClass(rover) {
  if (!rover?.batteryState) return 'text-slate-400';
  if (rover.batteryState.urgentActive) return 'text-red-400';
  if (rover.batteryState.warnActive) return 'text-amber-300';
  return 'text-emerald-300';
}

export default function RoverRoster({
  title,
  roster = [],
  emptyText = 'No roster data.',
  renderActions = null,
}) {
  return (
    <div className="space-y-0.5 text-sm">
      {title && <p className="text-sm text-slate-400">{title}</p>}
      {roster.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {roster.map((rover) => (
            <li
              key={rover.id}
              className={classNames(
                'surface flex flex-wrap items-center justify-between gap-0.5',
                rover.locked && 'bg-red-900/40',
              )}
            >
              <div>
                <p className="text-slate-200">{rover.name}</p>
                <p className="text-xs text-slate-500 flex flex-wrap items-center gap-1">
                  <span>{rover.locked ? 'locked' : 'free'}</span>
                  {rover.lockReason && <span className="rounded bg-black/30 px-1">{rover.lockReason}</span>}
                  <span className={classNames('font-semibold', batteryClass(rover))}>
                    Battery {formatBattery(rover)}
                  </span>
                </p>
              </div>
              {renderActions ? renderActions(rover) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
