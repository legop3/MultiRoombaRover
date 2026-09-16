
export default function ButtonControl({ entity, disabled, onChange }) {
  // Discovered actions and constant-valued inputs execute immediately; their
  // result is reflected only by subsequent HA state updates.
  return <>
    <button type="button" aria-label={entity.name} disabled={disabled}
      onClick={() => onChange(entity.constant ?? true)} className="button-dark w-full px-1 py-0.5 text-xs disabled:opacity-50">{entity.label || entity.name || 'Press'}</button>
  </>;
}
