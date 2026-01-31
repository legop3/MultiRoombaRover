import { useMemo, useState } from 'react';

export default function HornControl({
  disabled,
  onStart,
  onStop,
  keyLabel,
  className = '',
}) {
  const [pressed, setPressed] = useState(false);

  const buttonClasses = useMemo(() => {
    const base =
      'group flex w-full items-center justify-between rounded-xl border-2 px-1 py-0.75 text-xs font-semibold';
    const active = 'border-rose-300/70 bg-rose-800 text-rose-50 hover:bg-rose-700';
    const inactive = 'border-amber-300/70 bg-amber-900 text-amber-50 hover:bg-amber-800';
    return [base, pressed ? active : inactive, 'disabled:opacity-50', className]
      .filter(Boolean)
      .join(' ');
  }, [className, pressed]);

  const start = () => {
    if (disabled) return;
    if (!pressed) {
      setPressed(true);
      onStart?.();
    }
  };

  const stop = () => {
    if (pressed) {
      setPressed(false);
      onStop?.();
    }
  };

  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault();
        start();
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        stop();
      }}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onBlur={stop}
      disabled={disabled}
      aria-pressed={pressed}
      className={buttonClasses}
    >
      <span className="flex items-center gap-0.5">
        <span>Horn</span>
        {keyLabel ? (
          <span className="rounded bg-slate-800 px-1 py-0.5 text-[0.6rem] font-semibold text-slate-200">
            {keyLabel}
          </span>
        ) : null}
      </span>
      <span
        className={`rounded px-1 py-0.5 text-[0.65rem] font-semibold ${
          pressed ? 'bg-rose-400 text-rose-950' : 'bg-slate-700 text-slate-200'
        }`}
      >
        {pressed ? 'HONK' : 'Hold'}
      </span>
    </button>
  );
}
