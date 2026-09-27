import CornerPodToggle from './CornerPodToggle.jsx';

export default function PeripheralPod({ open, onOpenChange, label, children, className = 'h-40 w-40' }) {
  return open ? (
    <div className={`pointer-events-auto absolute bottom-0 left-0 z-20 rounded-tr-[4.25rem] bg-black/60 ${className}`}>
      {children}
      <CornerPodToggle corner="bottom-left" expanded label={`Hide ${label}`} onClick={() => onOpenChange(false)} />
    </div>
  ) : (
    <CornerPodToggle corner="bottom-left" expanded={false} label={`Show ${label}`} onClick={() => onOpenChange(true)} />
  );
}
