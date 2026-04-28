// Reusable slider field for gamepad calibration controls.
import { NUMBER_FORMAT } from './constants.js';

export default function SliderField({ label, description, min, max, step, value, onChange }) {
  return (
    <label className="surface-muted block p-0.5">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span className="font-semibold text-slate-100">{label}</span>
        <span className="font-mono text-slate-400">{NUMBER_FORMAT.format(value)}</span>
      </div>
      {description && <p className="text-[0.65rem] text-slate-500">{description}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-0 w-full accent-emerald-400"
      />
    </label>
  );
}
