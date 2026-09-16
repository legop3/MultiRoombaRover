
export default function ToggleControl({ entity, disabled, onChange }) {
  const on = entity.state === 'on';
  // The label reflects reported state, rather than claiming success before HA
  // publishes it. The entire compact button remains an accessible click target.
  return <>
    <button type="button" aria-label={`Toggle ${entity.name}`} aria-pressed={on}
      disabled={disabled} onClick={() => onChange(on ? 'off' : 'on')}
      className={`w-full rounded border px-1 py-0.5 text-xs font-semibold disabled:opacity-50 ${on ? 'border-emerald-700/70 bg-emerald-900 text-white' : 'border-neutral-700 bg-neutral-950 text-slate-300'}`}>
      {on ? 'On' : 'Off'}
    </button>
  </>;
}
