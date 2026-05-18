import React, { useEffect, useRef, useState } from 'react';
import { useManualDockAssist } from '../../../features/manualDockAssist/useManualDockAssist.js';

function ManualDockAssistOverlay({ mobileHud = false }) {
  const { visible, statusLabel, statusTone, active, charging } = useManualDockAssist({ manageLifecycle: true });
  const [popupMessage, setPopupMessage] = useState('');
  const timerRef = useRef(null);
  const prevActiveRef = useRef(active);

  useEffect(() => {
    const prevActive = prevActiveRef.current;
    const enabledNow = active && !prevActive;
    const autoDisabledOnCharge = !active && prevActive && charging;
    if (enabledNow) {
      setPopupMessage('Dock assist mode enabled');
    } else if (autoDisabledOnCharge) {
      setPopupMessage('Docking successful! Thank you!');
    }
    prevActiveRef.current = active;
  }, [active, charging]);

  useEffect(() => {
    if (!popupMessage) return undefined;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setPopupMessage('');
      timerRef.current = null;
    }, 2500);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [popupMessage]);

  if (!visible) return null;
  const toneClass =
    statusTone === 'good'
      ? 'border-emerald-200/90 bg-emerald-900/90 text-emerald-50'
      : statusTone === 'warn'
      ? 'border-amber-200/90 bg-amber-900/90 text-amber-50'
      : 'border-cyan-200/90 bg-cyan-900/90 text-cyan-50';

  return (
    <div className="pointer-events-none absolute inset-0">
      {popupMessage ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`rounded-xl border border-indigo-200/95 bg-black/95 px-4 py-2 text-center font-semibold text-indigo-50 shadow-2xl ${
              mobileHud ? 'text-lg' : 'text-2xl'
            }`}
          >
            {popupMessage}
          </div>
        </div>
      ) : (
        <div
          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 font-semibold shadow-lg ${toneClass} ${
            mobileHud ? 'text-[0.65rem]' : 'text-xs'
          }`}
        >
          {statusLabel}
        </div>
      )}
    </div>
  );
}

export default React.memo(ManualDockAssistOverlay);
