// Undocked Page Exit Guard
// Purpose: Asks the browser to confirm document-level navigation while the current driver's rover is undocked.
// Scope: Owns the native beforeunload lifecycle and queues the matching AlertFeed explanation when leaving is attempted.
import { useEffect } from 'react';
import { useControlSelector } from '../../controls/index.js';
import { useSessionActions } from '../../context/SessionContext.jsx';
import { useTelemetrySelector } from '../../context/TelemetryContext.jsx';

const UNDOCKED_EXIT_ALERT_LIFETIME_MS = 15 * 1000;

function selectHomeBaseState(frame) {
  const homeBase = frame?.sensors?.chargingSources?.homeBase;

  /*
    Missing telemetry must remain distinct from a real "not on the home base"
    reading. Treating the initial empty frame as undocked would enable the exit
    warning before the browser has received enough information to justify it.
  */
  return typeof homeBase === 'boolean' ? homeBase : null;
}

export default function UndockedPageExitGuard() {
  const roverId = useControlSelector((control) => control.state.roverId);
  const homeBaseState = useTelemetrySelector(roverId, selectHomeBaseState);
  const { pushAlert } = useSessionActions();
  const shouldConfirmExit = Boolean(roverId) && homeBaseState === false;

  useEffect(() => {
    if (!shouldConfirmExit) return undefined;

    function handleBeforeUnload(event) {
      /*
        Browsers intentionally own the wording and presentation of this dialog.
        preventDefault is the modern signal, while assigning returnValue keeps
        the confirmation working in browsers that still require the legacy part
        of the beforeunload contract.
      */
      event.preventDefault();
      event.returnValue = true;

      /*
        If the driver cancels the browser-owned confirmation, React remains
        mounted and AlertFeed presents the actionable reason for the warning.
        A stable id refreshes this one warning lane on another exit attempt
        instead of stacking duplicate cards over the driving interface.
      */
      pushAlert({
        id: 'undocked-page-exit-warning',
        kind: 'undocked-exit-warning',
        lifetimeMs: UNDOCKED_EXIT_ALERT_LIFETIME_MS,
      });
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      /*
        Removing the listener as soon as the rover docks or the assignment ends
        prevents ordinary spectators and completed drivers from seeing a stale
        leave-page confirmation.
      */
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [pushAlert, shouldConfirmExit]);

  return null;
}
