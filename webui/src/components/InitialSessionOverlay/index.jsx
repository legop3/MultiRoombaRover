// Initial Session Overlay
// Purpose: Hides incomplete driver-page placeholders until the first authoritative session snapshot arrives.
// Scope: Provides startup presentation only; it deliberately does not delay or alter page initialization underneath.
import { useSessionSelector } from '../../context/SessionContext.jsx';
import spinnerImage from '../../assets/spinner.png';
import './styles.css';

export default function InitialSessionOverlay() {
  const connected = useSessionSelector((state) => Boolean(state.connected));
  const sessionReady = useSessionSelector((state) => state.session !== null);

  if (sessionReady) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black text-slate-200"
      role="status"
      aria-live="polite"
      aria-label={connected ? 'Loading session' : 'Connecting'}
    >
      <div className="flex flex-col items-center gap-3">
        {/* The source image is intentionally constrained to a small fixed box;
            its intrinsic pixel dimensions must never determine overlay layout.
            Reduced-motion users still see the identifying image without either
            the rotation or continuously changing color. */}
        <div className="initial-session-spinner-rotation h-20 w-20" aria-hidden="true">
          <img
            src={spinnerImage}
            alt=""
            draggable="false"
            className="initial-session-spinner-image h-full w-full select-none object-contain"
          />
        </div>
        <div className="text-sm font-medium text-slate-300">
          {connected ? 'Loading session…' : 'Connecting…'}
        </div>
      </div>
    </div>
  );
}
