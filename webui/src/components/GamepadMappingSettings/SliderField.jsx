// Slider Field
// Purpose: Defines the Slider Field module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { NUMBER_FORMAT } from './constants.js';

export default function SliderField({ label, description, min, max, step, value, onChange }) {
  return (
    <label className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1">
      {/* The formatted value is kept close to the setting name because calibration usually
          happens by nudging a slider and watching the number, not by reading the full panel row. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5 text-sm text-white">
        <span className="min-w-0 font-semibold text-white">{label}</span>
        <span className="rounded bg-neutral-900 px-1 py-0.5 font-mono text-xs text-white">
          {NUMBER_FORMAT.format(value)}
        </span>
      </div>
      {description && <p className="mt-0.5 text-xs leading-snug text-white">{description}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-emerald-400"
      />
    </label>
  );
}
