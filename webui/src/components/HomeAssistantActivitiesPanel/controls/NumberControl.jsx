import useDraftControl from '../useDraftControl';

export default function NumberControl({ entity, disabled, onChange }) {
  const limitsKnown = entity.min !== null && entity.max !== null;
  const control = useDraftControl(onChange, disabled || !limitsKnown);
  const value = control.draft ?? (entity.available ? entity.state : '');
  const blocked = disabled || !limitsKnown;
  // Sliders commit on release (including keyboard adjustment), not for every
  // intermediate position. Number typing uses the same local draft and debounce.
  return <>
    <div className="flex min-w-0 items-center gap-0.5">
      {limitsKnown ? <input type="range" aria-label={`${entity.name} slider`} min={entity.min} max={entity.max} step={entity.step || 'any'}
        value={value || entity.min} disabled={blocked} className="min-w-0 flex-1 accent-emerald-500 disabled:opacity-50"
        onChange={(event) => control.edit(event.target.value, false)}
        onPointerUp={(event) => control.commit(event.currentTarget.value)}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) control.commit(event.currentTarget.value);
        }} /> : null}
      <input type="number" aria-label={entity.name} min={entity.min ?? undefined} max={entity.max ?? undefined} step={entity.step || 'any'}
        value={value} disabled={blocked} onChange={(event) => control.edit(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') control.commit(event.currentTarget.value); }}
        className="w-16 min-w-0 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs text-slate-200 disabled:opacity-50" />
      {entity.unit ? <span className="text-[0.65rem] text-slate-400">{entity.unit}</span> : null}
    </div>
    {!limitsKnown ? <span className="text-xs text-amber-200">Waiting for number limits</span> : null}
  </>;
}
