// Status Indicator
// Purpose: Defines the Status Indicator module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export default function StatusIndicator({ label, active, detail = '' }) {
  return (
    <div
      className={`rounded-md px-0.5 py-0.5 text-xs text-slate-100 ${
        active ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <div className="text-center font-medium">{label}</div>
      <div className="text-center text-[0.72rem] opacity-90">{detail || (active ? 'active' : 'idle')}</div>
    </div>
  );
}
