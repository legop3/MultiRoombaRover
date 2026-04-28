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
  heightClass = '',
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
      'group flex w-full flex-col items-center justify-center gap-0.35 rounded-xl border-2 px-1 py-0.75 text-center select-none no-touch-select';
    const active = 'border-emerald-300/70 bg-emerald-800 text-emerald-50 hover:bg-emerald-700';
    const inactive = 'border-amber-300/70 bg-amber-900 text-amber-50 hover:bg-amber-800';
    return [base, displayOn ? active : inactive, 'disabled:opacity-50', heightClass, className]
      .filter(Boolean)
      .join(' ');
  }, [className, displayOn, heightClass]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      onContextMenu={(event) => event.preventDefault()}
      disabled={disabled}
      aria-pressed={displayOn}
      className={buttonClasses}
    >
      <span className="flex items-center gap-0.5">
        <span className="text-sm font-semibold">Night Vision</span>
        {keyLabel ? (
          <span className="rounded bg-slate-800 px-1 py-0.5 text-[0.6rem] font-semibold text-slate-200">
            {keyLabel}
          </span>
        ) : null}
      </span>
      <span className={`rounded px-1 py-0.5 text-[0.7rem] font-semibold ${statusClasses}`}>
        {statusLabel}
      </span>
    </button>
  );
}
