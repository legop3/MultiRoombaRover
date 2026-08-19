// Horn Settings Expansion
// Purpose: Keeps the persisted horn sound controls available independently of the peripheral pod.
import { useCallback } from 'react';
import { HORN_MAX_FREQUENCY } from '../../../../controls/constants.js';
import { useSettingsNamespace } from '../../../../settings/index.js';
import { HORN_SETTINGS_DEFAULTS } from '../../../../settings/namespaces.js';
import ExpansionPanel from './ExpansionPanel.jsx';

function clampFrequency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(HORN_MAX_FREQUENCY, Math.round(numeric));
}

export default function HornSettingsExpansion({ open, onOpenChange }) {
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

  return (
    /* Horn settings belongs to the left video wall, not to the peripheral pod.
       Keeping this anchor fixed above the pod's maximum footprint means the
       expansion never follows or overlaps the pod as that separate UI closes.
       Its arrows mirror advanced info on the opposite wall: open points into
       the screen and close points back toward the wall. */
    <ExpansionPanel
      open={open}
      onOpenChange={onOpenChange}
      anchorClassName="absolute bottom-40 left-0"
      panelVerticalAlign="bottom"
      panelClassName="w-52 rounded-tr-xl bg-black/60 p-2 pb-4 text-xs text-white"
      openDirection="right"
      closeDirection="left"
      openLabel="Show horn settings"
      closeLabel="Hide horn settings"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-cyan-100">Horn settings</span>
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
    </ExpansionPanel>
  );
}
