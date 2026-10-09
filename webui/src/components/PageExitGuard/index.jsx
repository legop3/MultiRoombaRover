import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useBlocker } from 'react-router-dom';
import { useSessionSelector } from '../../context/SessionContext.jsx';

export default function PageExitGuard() {
  const shouldBlock = useSessionSelector((state) => state.session?.canLeaveRover === false);
  const [warning, setWarning] = useState({ blocked: shouldBlock, visible: false });
  // Clear an old exit attempt when server permission changes, so undocking
  // again does not resurrect a warning from the previous trip.
  if (warning.blocked !== shouldBlock) {
    setWarning({ blocked: shouldBlock, visible: false });
  }
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldBlock && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  ));

  useEffect(() => {
    if (!shouldBlock) return undefined;
    function handleBeforeUnload(event) {
      // Commit before the native dialog pauses JavaScript. The browser still
      // decides whether it repaints the document before displaying its dialog.
      flushSync(() => setWarning({ blocked: true, visible: true }));
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldBlock]);

  useEffect(() => {
    // Docking cancels the attempted navigation; the next attempt can proceed.
    if (!shouldBlock && blocker.state === 'blocked') blocker.reset();
  }, [shouldBlock, blocker]);

  const visible = shouldBlock && (warning.visible || blocker.state === 'blocked');
  if (!visible) return null;

  function dismiss() {
    setWarning({ blocked: shouldBlock, visible: false });
    if (blocker.state === 'blocked') blocker.reset();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-exit-warning"
      className="fixed inset-0 z-[2147483647] flex flex-col items-center justify-center gap-10 bg-neutral-950 p-6 text-center text-white"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') dismiss();
      }}
    >
      <p id="page-exit-warning" className="text-[clamp(3rem,10vw,10rem)] font-bold leading-tight">
        Please dock your rover
      </p>
      <button type="button" autoFocus className="button-dark px-8 py-4 text-3xl" onClick={dismiss}>
        Okay
      </button>
    </div>,
    document.body,
  );
}
