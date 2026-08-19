// Horn Settings Expansion
// Purpose: Keeps the persisted horn sound controls available independently of the peripheral pod.
import { useCallback } from 'react';
import { HORN_MAX_FREQUENCY } from '../../../../controls/constants.js';
import { useSettingsNamespace } from '../../../../settings/index.js';
import { HORN_SETTINGS_DEFAULTS } from '../../../../settings/namespaces.js';
import ExpansionToggle from './ExpansionToggle.jsx';

function clampFrequency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(HORN_MAX_FREQUENCY, Math.round(numeric));
}

export default function HornSettingsExpansion({ open, podOpen, onOpenChange }) {
  const { value, save } = useSettingsNamespace('horn', HORN_SETTINGS_DEFAULTS);
  const waveform = value?.waveform === 'sine' ? 'sine' : 'saw';
  const frequencies = [...(Array.isArray(value?.freqs) ? value.freqs : HORN_SETTINGS_DEFAULTS.freqs), 0, 0, 0, 0]
    .slice(0, 4)
    .map(clampFrequency);

  const updateFrequency = useCallback((index, nextValue) => {
    save((current) => {
      // Build from the persisted values on every edit so rapid changes cannot overwrite a
      // neighboring frequency input with a stale render-time copy.
      const next = [...(Array.isArray(current?.freqs) ? current.freqs : HORN_SETTINGS_DEFAULTS.freqs), 0, 0, 0, 0]
        .slice(0, 4)
        .map(clampFrequency);
      next[index] = clampFrequency(nextValue);
      return { ...(current || {}), freqs: next };
    });
  }, [save]);

  if (!open) {
    return (
      <div className={`pointer-events-auto absolute left-10 z-20 flex h-3 w-8 bg-black/60 ${podOpen ? 'bottom-40' : 'bottom-0'}`}>
        <ExpansionToggle direction="up" label="Show horn settings" onClick={() => onOpenChange(true)} />
      </div>
    );
  }

  return (
    <div className={`pointer-events-auto absolute left-0 z-20 w-52 rounded-tr-xl bg-black/60 p-2 text-xs text-white ${podOpen ? 'bottom-40' : 'bottom-0'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-cyan-100">Horn settings</span>
        {/* This arrow belongs to the expansion. Closing the peripheral pod never changes
            hornSettings visibility; it only moves this panel into the vacated corner. */}
        <ExpansionToggle direction="down" label="Hide horn settings" onClick={() => onOpenChange(false)} />
      </div>
      <label className="flex items-center justify-between gap-2 text-slate-300">
        <span>Wave</span>
        <select
          value={waveform}
          onChange={(event) => save((current) => ({ ...(current || {}), waveform: event.target.value === 'sine' ? 'sine' : 'saw' }))}
          className="rounded bg-slate-900 px-2 py-1 text-white ring-1 ring-slate-600"
        >
          <option value="saw">Saw</option>
          <option value="sine">Sine</option>
        </select>
      </label>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {frequencies.map((frequency, index) => (
          <label key={index} className="flex items-center gap-1 text-slate-400">
            <span>{index + 1}</span>
            <input
              type="number"
              min="0"
              max={HORN_MAX_FREQUENCY}
              value={frequency}
              onChange={(event) => updateFrequency(index, event.target.value)}
              className="min-w-0 flex-1 rounded bg-slate-900 px-1.5 py-1 text-right font-mono text-white ring-1 ring-slate-600"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
