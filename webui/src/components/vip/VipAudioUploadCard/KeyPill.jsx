// Keybinding label pill for PTT hints.
export default function KeyPill({ label }) {
  if (!label) return null;
  return <span className="rounded border border-white/40 px-1 text-[0.7rem] text-white">{label}</span>;
}
