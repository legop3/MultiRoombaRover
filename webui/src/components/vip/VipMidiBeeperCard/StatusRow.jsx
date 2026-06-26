// Midi Beeper status row
// Purpose: Provides compact status readouts that match the existing VIP card visual language.
// Scope: Presentational only; the parent owns all state and wording.
export default function StatusRow({ label, value, active = false }) {
  return (
    <div className="surface-muted flex items-center justify-between gap-0.5 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={active ? 'font-semibold text-emerald-200' : 'font-semibold text-slate-200'}>
        {value}
      </span>
    </div>
  );
}
