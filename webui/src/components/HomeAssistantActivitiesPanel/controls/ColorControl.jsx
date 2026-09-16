// HA supplies an RGB triple while the native browser color picker uses hex.
// Convert only at this UI boundary; no optimistic entity state is stored here.
export default function ColorControl({ entity, disabled, onChange }) {
  const rgb = Array.isArray(entity.state) ? entity.state : [255, 255, 255];
  const hex = `#${rgb.slice(0, 3).map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
  return <input type="color" aria-label={entity.name} value={hex} disabled={disabled}
    onChange={(event) => onChange([1, 3, 5].map((offset) => Number.parseInt(event.target.value.slice(offset, offset + 2), 16)))}
    className="h-6 w-full cursor-pointer rounded border border-neutral-700 bg-transparent disabled:opacity-50" />;
}
