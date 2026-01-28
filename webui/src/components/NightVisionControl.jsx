import { useEffect, useMemo, useState } from 'react';

function isBoolean(value) {
  return typeof value === 'boolean';
}

export default function NightVisionControl({
  nightVisionOn,
  disabled,
  onToggle,
  keyLabel,
  className = '',
}) {
  const [optimistic, setOptimistic] = useState(
    isBoolean(nightVisionOn) ? nightVisionOn : null,
  );

  useEffect(() => {
    if (isBoolean(nightVisionOn)) {
      setOptimistic(nightVisionOn);
    }
  }, [nightVisionOn]);

  const hasState = isBoolean(optimistic);
  const displayOn = hasState ? optimistic : false;
  const statusLabel = hasState ? (displayOn ? 'On' : 'Off') : '—';
  const statusClasses = displayOn
    ? 'bg-emerald-600 text-emerald-50'
    : 'bg-slate-700 text-slate-200';

  const handleToggle = () => {
    if (disabled) return;
    const next = hasState ? !displayOn : true;
    setOptimistic(next);
    onToggle?.(next);
  };

  const buttonClasses = useMemo(
    () =>
      [
        'flex w-full items-center justify-between rounded bg-zinc-950 px-1 py-0.5 text-xs text-slate-300',
        'transition hover:bg-zinc-900 disabled:opacity-50',
        className,
      ]
        .filter(Boolean)
        .join(' '),
    [className],
  );

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      aria-pressed={displayOn}
      className={buttonClasses}
    >
      <span className="text-slate-400">Night Vision</span>
      <span className="flex items-center gap-1">
        <span className={`rounded px-1 py-0.5 text-[0.65rem] font-semibold ${statusClasses}`}>
          {statusLabel}
        </span>
        {keyLabel ? (
          <span className="rounded bg-slate-800 px-1 py-0.5 text-[0.6rem] font-semibold text-slate-200">
            {keyLabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}
