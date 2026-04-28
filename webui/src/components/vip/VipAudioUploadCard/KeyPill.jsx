// Key Pill
// Purpose: Defines the Key Pill module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export default function KeyPill({ label }) {
  if (!label) return null;
  return <span className="rounded border border-white/40 px-1 text-[0.7rem] text-white">{label}</span>;
}
