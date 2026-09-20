
export default function SelectControl({ entity, disabled, onChange }) {
  // Keep the actual reported value visible even if HA changes its option list;
  // only current options are selectable or accepted by the server.
  return <>
    <select aria-label={entity.name} value={entity.state} disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full min-w-0 rounded-sm border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs text-slate-200 disabled:opacity-50">
      {!entity.options.includes(entity.state) ? <option value={entity.state} disabled>{entity.state}</option> : null}
      {entity.options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </>;
}
