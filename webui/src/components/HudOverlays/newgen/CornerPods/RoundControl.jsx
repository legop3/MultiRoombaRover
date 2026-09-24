import KeyPill from '../../../vip/VipAudioUploadCard/KeyPill.jsx';

export default function RoundControl({ label, icon, keyLabel, active, tone, disabled = false, onClick, onPointerDown, onPointerUp, large = false, className = '', value = null }) {
  const ControlIcon = icon;
  const toneClass = tone === 'horn'
    ? active ? 'border-fuchsia-300/70 bg-fuchsia-700 text-fuchsia-50' : 'border-cyan-300/70 bg-cyan-900 text-cyan-50'
    : active ? 'border-emerald-300/70 bg-emerald-800 text-emerald-50' : 'border-amber-300/70 bg-amber-900 text-amber-50';
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`flex shrink-0 select-none flex-col items-center justify-center gap-1 rounded-full border-2 ${toneClass} ${large ? 'h-20 w-20' : 'h-16 w-16'} disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <ControlIcon className={large ? 'text-xl' : 'text-base'} aria-hidden="true" />
      {value != null ? <span className="text-xs font-semibold leading-none">{value}</span> : null}
      <KeyPill label={keyLabel} />
    </button>
  );
}

