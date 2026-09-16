
export default function ButtonControl({ entity, disabled, onChange }) {
  // HA button states are timestamps. A press is an action, never a toggle.
  return <>
    <button type="button" aria-label={`Press ${entity.name}`} disabled={disabled}
      onClick={() => onChange('press')} className="button-dark w-full px-1 py-0.5 text-xs disabled:opacity-50">Press</button>
  </>;
}
