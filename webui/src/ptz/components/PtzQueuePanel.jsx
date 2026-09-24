import { useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import CardFrame from '../../components/CardFrame/index.jsx';
import { QueueUserChips } from '../../components/QueueTargetRow/index.jsx';
import { PTZ_CAMERA_ID } from '../../components/PtzLiveVideo/index.jsx';
import useQueueUserLookup from '../../hooks/useQueueUserLookup.js';
function PtzQueueSummary({ ptz, title = 'PTZ queue' }) {
  const { ptzRequestTurn, ptzRelease, pushAlert } = useSessionActions();
  const [pending, setPending] = useState(false);
  const participating = Boolean(ptz?.turn?.isActive || ptz?.turn?.turnsAhead);
  const changeTurn = async () => {
    if (pending) return;
    setPending(true);
    try {
      if (participating) await ptzRelease();
      else await ptzRequestTurn();
    } catch (err) {
      pushAlert({ title: 'PTZ camera', message: err.message, color: '#f59e0b' });
    } finally {
      setPending(false);
    }
  };
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const lookupUser = useQueueUserLookup(ptz?.turn);
  const { queue, currentId, nextId } = ptz?.turn || {};

  return (
    <CardFrame title={title} bodyClassName="space-y-0.5 p-1 text-sm">
      <QueueUserChips
        targetId={ptz?.id || PTZ_CAMERA_ID}
        queue={queue}
        currentId={currentId}
        nextId={nextId}
        selfId={selfId}
        lookupUser={lookupUser}
      />
      <button type="button" className="button-dark w-full text-xs" disabled={pending || !(participating ? ptz?.permissions?.canReleaseTurn : ptz?.permissions?.canRequestTurn)} onClick={changeTurn}>
        {pending ? 'Please wait…' : ptz?.turn?.isActive ? 'Release turn' : ptz?.turn?.turnsAhead ? 'Leave queue' : 'Request turn'}
      </button>
    </CardFrame>
  );
}

export { PtzQueueSummary };
