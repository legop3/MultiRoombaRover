
export default function SelectControl({ entity, disabled, onChange }) {
  // Keep the actual reported value visible even if HA changes its option list;
  // only current options are selectable or accepted by the server.
  return <>
    <select aria-label={entity.name} value={entity.options.findIndex((option) => option.value === entity.state)} disabled={disabled}
      onChange={(event) => onChange(entity.options[Number(event.target.value)].value)}
      className="w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs text-slate-200 disabled:opacity-50">
      {!entity.options.includes(entity.state) ? <option value={entity.options.findIndex((option) => option.value === entity.state)} disabled>{entity.state}</option> : null}
      {entity.options.map((option, index) => <option key={index} value={index}>{option.label}</option>)}
    </select>
  </>;
}
