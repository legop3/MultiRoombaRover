// Preserve raw sensor text and units; a sensor's non-on value is never "off".
export default function ReadOnlyControl({ entity }) {
  return <span className="break-words text-xs text-slate-200">
    {entity.available ? (entity.password ? '••••••' : `${entity.state}${entity.unit ? ` ${entity.unit}` : ''}`) : 'Unavailable'}
  </span>;
}
