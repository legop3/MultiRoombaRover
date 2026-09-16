// Native pickers keep date/time editing compact; the usual draft pause avoids
// sending partially edited values and HA remains responsible for validation.
import useDraftControl from '../useDraftControl';

export default function DateControl({ entity, disabled, onChange }) {
  const control = useDraftControl(onChange, disabled);
  return <input type="date" aria-label={entity.name} disabled={disabled}
    value={control.draft ?? entity.state ?? ''}
    onChange={(event) => control.edit(event.target.value)}
    onKeyDown={(event) => { if (event.key === 'Enter') control.commit(event.currentTarget.value); }}
    className="w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs text-slate-200 disabled:opacity-50" />;
}
