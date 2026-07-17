// Balance Board Panel
// Purpose: Shows exactly what the Bluetooth board is doing and its current total weight.
// Scope: Owns optional feature gating and the live weight-frame subscription only.
import { useEffect, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import CardFrame from '../CardFrame/index.jsx';

const EMPTY_FRAME = { totalKg: 0, batteryPercent: null };

function formatWeight(value) {
  const weight = Number(value);
  return Number.isFinite(weight) ? `${weight.toFixed(2)} kg` : '0.00 kg';
}

function statusPresentation(value) {
  const status = String(value || 'starting');
  if (status === 'connected') return { label: 'Connected', tone: 'border-emerald-600 bg-emerald-950 text-emerald-200' };
  if (status === 'zeroing') return { label: 'Zeroing', tone: 'border-violet-600 bg-violet-950 text-violet-200' };
  if (status === 'pairing') return { label: 'Pairing', tone: 'border-sky-600 bg-sky-950 text-sky-200' };
  if (status === 'waiting-for-sync') return { label: 'Waiting for red Sync', tone: 'border-amber-600 bg-amber-950 text-amber-200' };
  if (status === 'waiting') return { label: 'Waiting for front button', tone: 'border-amber-600 bg-amber-950 text-amber-200' };
  if (status === 'connecting') return { label: 'Connecting', tone: 'border-sky-600 bg-sky-950 text-sky-200' };
  if (status === 'error') return { label: 'Error', tone: 'border-red-600 bg-red-950 text-red-200' };
  return { label: 'Starting', tone: 'border-slate-600 bg-slate-900 text-slate-200' };
}

export default function BalanceBoardPanel() {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'balanceBoard'));
  // Keep feature ownership inside the component so layouts do not need special
  // cases or empty wrappers when the optional hardware is disabled.
  if (!enabled) return null;
  return <BalanceBoardPanelContent />;
}

function BalanceBoardPanelContent() {
  const socket = useSocket();
  const board = useSessionSelector((state) => state.session?.balanceBoard || null);
  const [frame, setFrame] = useState(EMPTY_FRAME);

  useEffect(() => {
    if (!socket) return undefined;
    const handleFrame = (next = {}) => setFrame({ ...EMPTY_FRAME, ...next });
    socket.on('balanceBoard:frame', handleFrame);
    socket.emit('balanceBoard:subscribe', {}, () => {});
    return () => {
      socket.off('balanceBoard:frame', handleFrame);
      socket.emit('balanceBoard:unsubscribe');
    };
  }, [socket]);

  // Mask the previous reading immediately when disconnected. Keeping the last
  // socket frame in state avoids effect-driven state resets and stale flashes.
  const liveFrame = board?.connected ? frame : EMPTY_FRAME;
  const battery = Number.isFinite(Number(liveFrame.batteryPercent))
    ? Number(liveFrame.batteryPercent)
    : Number.isFinite(Number(board?.batteryPercent))
      ? Number(board.batteryPercent)
      : null;
  const presentation = statusPresentation(board?.status);
  const actions = (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${presentation.tone}`}>
      {presentation.label}
    </span>
  );

  return (
    <CardFrame title="Balance Board" actions={actions} bodyClassName="p-2">
      <div className="flex min-w-0 items-center justify-between gap-4 rounded border border-slate-700 bg-slate-950/50 p-2">
        <div className="min-w-0">
          <div className="font-mono text-4xl font-bold leading-none text-white">
            {formatWeight(liveFrame.totalKg)}
          </div>
          <p className="mt-2 break-words text-sm text-slate-300">{board?.detail || 'Starting Balance Board support.'}</p>
          {board?.address ? <p className="mt-1 font-mono text-[0.65rem] text-slate-600">{board.address}</p> : null}
        </div>
        {battery != null ? (
          <div className="shrink-0 text-right text-xs text-slate-400">
            Battery<br /><span className="font-mono text-base text-slate-200">{Math.round(battery)}%</span>
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}
