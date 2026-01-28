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
    ? 'bg-emerald-500 text-emerald-950'
    : 'bg-slate-700 text-slate-200';

  const handleToggle = () => {
    if (disabled) return;
    const next = hasState ? !displayOn : true;
    setOptimistic(next);
    onToggle?.(next);
  };

  const buttonClasses = useMemo(() => {
    const base =
      'group flex w-full items-center justify-between rounded-md border px-1 py-0.75 text-xs font-semibold uppercase tracking-wide';
    const active =
      'border-emerald-400/80 bg-emerald-600/30 text-emerald-50 shadow-[0_0_12px_rgba(16,185,129,0.45)]';
    const inactive =
      'border-amber-300/80 bg-amber-500/30 text-amber-50 shadow-[0_0_10px_rgba(251,191,36,0.35)]';
    return [base, displayOn ? active : inactive, 'transition hover:brightness-110 disabled:opacity-50', className]
      .filter(Boolean)
      .join(' ');
  }, [className, displayOn]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      aria-pressed={displayOn}
      className={buttonClasses}
    >
      <span className="flex items-center gap-1">
        <span className="inline-flex h-2 w-2 rounded-full bg-current opacity-90" />
        <span>Night Vision</span>
      </span>
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
