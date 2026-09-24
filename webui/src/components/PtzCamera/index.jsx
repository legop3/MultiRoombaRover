// Driver-page entry card; PTZ route lifecycle belongs to the PTZ page.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CardFrame from '../CardFrame/index.jsx';
import QueueTargetRow from '../QueueTargetRow/index.jsx';
import { PTZ_CAMERA_ID } from '../PtzLiveVideo/index.jsx';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSharedClock } from '../../hooks/useSharedClock.js';
import { isFeatureEnabled } from '../../lib/features.js';
import useQueueUserLookup from '../../hooks/useQueueUserLookup.js';
const PTZ_DEFAULT_COLOR = '#387bf8';

function formatRemaining(deadline, now) {
  const remaining = Math.max(0, Math.ceil((Number(deadline || 0) - now) / 1000));
  if (!remaining) return '--';
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function PtzQueueCard() {
  const featureEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'ptzCamera'));
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const { setOperatingMode } = useSessionActions();
  const navigate = useNavigate();
  const lookupUser = useQueueUserLookup(ptz?.turn);
  const { queue, currentId, nextId } = ptz?.turn || {};
  const now = useSharedClock(1000, Boolean(ptz?.turn?.deadline));
  const [pending, setPending] = useState(false);
  const canUse = Boolean(ptz?.permissions?.canEnter);
  const isParticipant = Boolean(ptz?.turn?.isActive || ptz?.turn?.turnsAhead);
  const timerLabel = ptz?.turn?.isActive && ptz?.turn?.deadline ? `${formatRemaining(ptz.turn.deadline, now)} left` : '';

  if (!featureEnabled) return null;

  const handleRequest = async () => {
    if (!canUse || pending) return;
    if (isParticipant) {
      navigate('/ptz');
      return;
    }
    setPending(true);
    try {
      const response = await setOperatingMode('ptz');
      // Enter first; the page requests its initial turn after navigation.
      if (response?.operatingMode === 'ptz') {
        navigate('/ptz');
      }
    } catch (err) {
      alert(err.message || 'PTZ request failed.');
    } finally {
      setPending(false);
    }
  };

  const handleLeave = async () => {
    if (pending) return;
    setPending(true);
    try {
      await setOperatingMode('rover');
    } catch (err) {
      alert(err.message || 'Failed to leave PTZ camera.');
    } finally {
      setPending(false);
    }
  };

  const actionLabel = pending ? '...' : isParticipant ? 'Open' : 'request';

  return (
    <CardFrame title={ptz?.name || 'PTZ camera'} bodyClassName="relative space-y-0.5 text-sm">
        <ul className="space-y-0.5 text-sm">
          <QueueTargetRow
            target={{
              id: ptz?.id || PTZ_CAMERA_ID,
              name: ptz?.name || 'PTZ Camera',
              color: ptz?.color || PTZ_DEFAULT_COLOR,
            }}
            queue={queue}
            currentId={currentId}
            nextId={nextId}
            selfId={selfId}
            lookupUser={lookupUser}
            canClick={canUse && !pending}
            pending={pending}
            buttonLabel={actionLabel}
            batteryLabel={ptz?.turn?.isActive ? 'LIVE' : ptz?.turn?.turnsAhead ? `#${ptz.turn.turnsAhead}` : '--'}
            batteryClassName={ptz?.turn?.isActive ? 'text-emerald-300' : ptz?.turn?.turnsAhead ? 'text-sky-300' : 'text-slate-400'}
            timerLabel={timerLabel}
            onRequest={handleRequest}
            showAction={canUse}
          />
        </ul>
        {isParticipant ? (
          <button type="button" className="button-dark w-full text-xs" disabled={pending} onClick={handleLeave}>
            Leave PTZ queue
          </button>
        ) : null}
        {!canUse ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-black/75 px-2 text-center text-sm font-semibold text-slate-100">
            Verify your account to use the PTZ camera.
          </div>
        ) : null}
    </CardFrame>
  );
}
