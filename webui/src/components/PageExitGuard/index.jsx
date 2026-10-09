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
    function blockNavigation(event) {
      event.preventDefault();
      event.stopPropagation();
      setWarning({ blocked: true, visible: true });
    }
    function handleLinkClick(event) {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || link.hasAttribute('download')) return;
      const target = (link.getAttribute('target') || document.querySelector('base[target]')?.getAttribute('target') || '_self').toLowerCase();
      if (target !== '_self') return;
      const destination = new URL(link.href, window.location.href);
      if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return;
      // Hash links stay in this document and do not abandon the rover.
      if (destination.origin === window.location.origin
        && destination.pathname === window.location.pathname
        && destination.search === window.location.search
        && link.getAttribute('href').includes('#')) return;
      blockNavigation(event);
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleLinkClick, true);
    window.addEventListener('page:navigate', blockNavigation);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleLinkClick, true);
      window.removeEventListener('page:navigate', blockNavigation);
    };
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
      className="fixed inset-0 z-[2147483647] flex flex-col items-center justify-between gap-4 bg-black p-6 text-center text-white"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') dismiss();
      }}
    >
      <p id="page-exit-warning" className="text-[clamp(3rem,10vw,10rem)] font-bold leading-tight">
        Please dock your rover!
      </p>
      <button type="button" autoFocus className="button-dark px-8 py-4 text-3xl" onClick={dismiss}>
        Okay
      </button>
      <p aria-hidden="true" className="text-[clamp(3rem,10vw,10rem)] font-bold leading-tight">
        Please dock your rover!
      </p>
    </div>,
    document.body,
  );
}
