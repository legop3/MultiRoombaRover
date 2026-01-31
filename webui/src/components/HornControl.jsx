import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsNamespace } from '../settings/index.js';
import { HORN_SETTINGS_DEFAULTS } from '../settings/namespaces.js';

function clampFreq(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  return Math.min(5000, Math.round(num));
}

export default function HornControl({
  disabled,
  onStart,
  onStop,
  keyLabel,
  active,
  className = '',
}) {
  const [pressed, setPressed] = useState(false);
  const { value: hornSettings, save: saveHornSettings } = useSettingsNamespace(
    'horn',
    HORN_SETTINGS_DEFAULTS,
  );
  const [waveform, setWaveform] = useState(hornSettings?.waveform || HORN_SETTINGS_DEFAULTS.waveform);
  const [freqs, setFreqs] = useState(() => {
    const base = Array.isArray(hornSettings?.freqs) ? hornSettings.freqs : HORN_SETTINGS_DEFAULTS.freqs;
    return [...base, 0, 0, 0, 0].slice(0, 4).map((f) => clampFreq(f));
  });

  useEffect(() => {
    setWaveform(hornSettings?.waveform || HORN_SETTINGS_DEFAULTS.waveform);
    if (Array.isArray(hornSettings?.freqs)) {
      setFreqs([...hornSettings.freqs, 0, 0, 0, 0].slice(0, 4).map((f) => clampFreq(f)));
    }
  }, [hornSettings?.freqs, hornSettings?.waveform]);

  const isActive = Boolean(active);
  const buttonClasses = useMemo(() => {
    const base =
      'group flex w-full flex-col gap-0.5 rounded-xl border-2 px-1 py-1.5 text-xs font-semibold';
    const active = 'border-fuchsia-300/70 bg-fuchsia-700 text-fuchsia-50';
    const inactive = 'border-cyan-300/70 bg-cyan-900 text-cyan-50 hover:bg-cyan-800';
    return [base, isActive ? active : inactive, 'disabled:opacity-50', className]
      .filter(Boolean)
      .join(' ');
  }, [className, isActive]);

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

  const formattedWaveform = waveform === 'sine' ? 'sine' : 'saw';

  const updateWaveform = useCallback(
    (event) => {
      const next = event.target.value === 'sine' ? 'sine' : 'saw';
      setWaveform(next);
      saveHornSettings((current) => ({ ...(current ?? {}), waveform: next }));
    },
    [saveHornSettings],
  );

  const updateFreq = useCallback(
    (index, value) => {
      setFreqs((prev) => {
        const next = [...prev];
        next[index] = clampFreq(value);
        saveHornSettings((current) => ({ ...(current ?? {}), freqs: next }));
        return next;
      });
    },
    [saveHornSettings],
  );

  const handlePointerDown = (event) => {
    if (disabled) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'option' || tag === 'label') return;
    event.preventDefault();
    start();
  };

  const handlePointerUp = (event) => {
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'option' || tag === 'label') return;
    event.preventDefault();
    stop();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={pressed}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onBlur={stop}
      className={buttonClasses}
    >
      <div className="flex items-center justify-between gap-0.5">
        <span className="flex items-center gap-0.5 text-sm font-semibold">
          <span>Horn</span>
          {keyLabel ? (
            <span className="rounded bg-black/40 px-1 py-0.5 text-[0.6rem] font-semibold text-white">
              {keyLabel}
            </span>
          ) : null}
        </span>
        <span
          className={`rounded px-1 py-0.5 text-[0.65rem] font-semibold ${
            isActive ? 'bg-fuchsia-200 text-fuchsia-900' : 'bg-slate-800 text-slate-200'
          }`}
        >
          {isActive ? 'Honk' : 'Hold'}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))] items-center gap-0.5 text-[0.65rem]">
        <label className="flex items-center gap-0.5 text-slate-200">
          <span className="text-slate-300">Wave</span>
          <select
            value={formattedWaveform}
            onChange={updateWaveform}
            className="rounded border border-slate-700 bg-slate-900 px-1 py-[2px] text-[0.65rem] text-slate-100"
          >
            <option value="saw">Saw</option>
            <option value="sine">Sine</option>
          </select>
        </label>
        {freqs.map((freq, idx) => (
          <label key={`horn-freq-${idx}`} className="flex items-center gap-0.5 text-slate-200">
            <span className="text-[0.6rem] text-slate-400">{idx + 1}</span>
            <input
              type="number"
              min={0}
              max={5000}
              step={1}
              value={freq}
              onChange={(event) => updateFreq(idx, event.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-[2px] text-right text-[0.65rem] font-mono text-slate-100"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
