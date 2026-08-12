// Undocked Page Exit Guard
// Purpose: Asks the browser to confirm document-level navigation while the current driver's rover is undocked.
// Scope: Owns only the native beforeunload lifecycle; it does not render UI or attempt to replace browser safety dialogs.
import { useEffect } from 'react';
import { useControlSelector } from '../../controls/index.js';
import { useTelemetrySelector } from '../../context/TelemetryContext.jsx';

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
  }, [shouldConfirmExit]);

  return null;
}
