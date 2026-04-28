// Vip Private Rover Access Card
// Purpose: Defines the Vip Private Rover Access Card module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo, useState } from 'react';
import { flowWrapClass, innerFlowClass } from './constants.js';

export default function VipPrivateRoverAccessCard({
  requestableRovers = [],
  pendingRequests = [],
  requestPrivateRoverAccess,
  onMessage,
  fullWidth = false,
}) {
  const [pendingByRover, setPendingByRover] = useState({});
  const pendingMap = useMemo(() => {
    const next = new Map();
    (pendingRequests || []).forEach((entry) => {
      if (!entry?.roverId) return;
      next.set(String(entry.roverId), entry);
    });
    return next;
  }, [pendingRequests]);

  const wrapClass = fullWidth ? 'w-full' : flowWrapClass;

  const handleRequest = async (roverId) => {
    if (!roverId) return;
    setPendingByRover((prev) => ({ ...prev, [roverId]: true }));
    onMessage?.('');
    try {
      const response = await requestPrivateRoverAccess?.(roverId);
      if (response?.existing) {
        onMessage?.('You already have a pending request for that rover.');
      } else {
        onMessage?.('Private rover access request sent to lockdown admins.');
      }
    } catch (err) {
      onMessage?.(err.message || 'Failed to send request.');
    } finally {
      setPendingByRover((prev) => ({ ...prev, [roverId]: false }));
    }
  };

  return (
    <section className={`surface text-sm text-slate-300 ${wrapClass}`}>
      <div className={innerFlowClass}>
        <p className="text-sm text-slate-300">Private rover access requests</p>
        {requestableRovers.length === 0 ? (
          <p className="text-xs text-slate-500">No closed private rovers are available to request right now.</p>
        ) : (
          <div className="w-full space-y-0.5">
            {requestableRovers.map((rover) => {
              const roverId = String(rover.id);
              const inFlight = Boolean(pendingByRover[roverId]);
              const pending = pendingMap.get(roverId);
              return (
                <div key={roverId} className="surface-muted flex items-center justify-between gap-0.5 px-1 py-0.5">
                  <div className="min-w-0 text-left">
                    <p className="truncate text-xs font-semibold text-slate-100">{rover.name || roverId}</p>
                    <p className="truncate text-[0.7rem] text-slate-500">{roverId}</p>
                  </div>
                  {pending ? (
                    <span className="rounded bg-amber-700/30 px-1 py-0.5 text-[0.7rem] text-amber-200">
                      Pending
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRequest(roverId)}
                      disabled={inFlight}
                      className="button-dark text-xs disabled:opacity-50"
                    >
                      {inFlight ? 'Sending...' : 'Request'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

