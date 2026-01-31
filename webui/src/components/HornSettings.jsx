import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsNamespace } from '../settings/index.js';
import { HORN_SETTINGS_DEFAULTS } from '../settings/namespaces.js';

function clampFreq(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  return Math.min(5000, Math.round(num));
}

export default function HornSettings() {
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

  const formattedWaveform = useMemo(
    () => (waveform === 'sine' ? 'sine' : 'saw'),
    [waveform],
  );

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

  return (
    <section className="panel-section space-y-0.5 text-sm">
      <p className="text-slate-400">Horn</p>
      <label className="flex items-center justify-between gap-0.5 text-slate-200">
        <span>Waveform</span>
        <select value={formattedWaveform} onChange={updateWaveform} className="field-input text-sm">
          <option value="saw">Saw</option>
          <option value="sine">Sine</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-0.5">
        {freqs.map((freq, idx) => (
          <label key={`horn-freq-${idx}`} className="surface-muted flex items-center justify-between gap-0.5">
            <span className="text-[0.7rem] text-slate-300">Freq {idx + 1}</span>
            <input
              type="number"
              min={0}
              max={5000}
              step={1}
              value={freq}
              onChange={(event) => updateFreq(idx, event.target.value)}
              className="w-20 rounded border border-slate-700 bg-slate-900 px-1 py-[2px] text-right text-[0.75rem] font-mono text-slate-100"
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-500">Set a frequency to 0 to disable that oscillator.</p>
    </section>
  );
}
