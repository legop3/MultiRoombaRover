// Balance Board Panel
// Purpose: Shows exactly what the Bluetooth board is doing and its current total weight.
// Scope: Owns optional feature gating and the live weight-frame subscription only.
import { useEffect, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import CardFrame from '../CardFrame/index.jsx';

const EMPTY_CORNERS = {
  topLeft: 0,
  topRight: 0,
  bottomLeft: 0,
  bottomRight: 0,
};
const EMPTY_FRAME = { totalKg: 0, batteryPercent: null, corners: EMPTY_CORNERS };

function formatWeight(value) {
  const weight = Number(value);
  return Number.isFinite(weight) ? `${weight.toFixed(2)} kg` : '0.00 kg';
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function centerOfPressure(corners) {
  const topLeft = Math.max(0, finiteNumber(corners.topLeft) || 0);
  const topRight = Math.max(0, finiteNumber(corners.topRight) || 0);
  const bottomLeft = Math.max(0, finiteNumber(corners.bottomLeft) || 0);
  const bottomRight = Math.max(0, finiteNumber(corners.bottomRight) || 0);
  const total = topLeft + topRight + bottomLeft + bottomRight;

  // An empty board naturally has tiny load-cell noise. Keep the marker centered
  // and subdued until there is enough weight for its position to mean anything;
  // once loaded, map the normalized left/right and top/bottom balance into the
  // safe interior of the illustrated board.
  if (total < 0.5) return { left: 50, top: 50, active: false };
  const horizontal = ((topRight + bottomRight) - (topLeft + bottomLeft)) / total;
  const vertical = ((bottomLeft + bottomRight) - (topLeft + topRight)) / total;
  return {
    left: 50 + Math.max(-1, Math.min(1, horizontal)) * 37,
    top: 50 + Math.max(-1, Math.min(1, vertical)) * 37,
    active: true,
  };
}

function CornerReading({ className, label, value }) {
  return (
    <div className={`absolute rounded bg-slate-950/80 px-1 py-0.5 text-center shadow ${className}`}>
      <div className="text-[0.62rem] text-slate-400">{label}</div>
      <div className="font-mono text-sm font-semibold text-slate-100">{formatWeight(value)}</div>
    </div>
  );
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
  const role = useSessionSelector((state) => state.session?.role || null);
  const [frame, setFrame] = useState(EMPTY_FRAME);
  const [unpairing, setUnpairing] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');

  useEffect(() => {
    if (!socket) return undefined;
    const handleFrame = (next = {}) => setFrame({ ...EMPTY_FRAME, ...next });

    // Socket.IO room membership belongs to one server-side connection, not to
    // the long-lived browser socket object. A brief network interruption gives
    // the browser a new server-side socket while React keeps this component and
    // this effect mounted, so subscribing only here would silently lose all
    // later weight frames. Rejoin after every connection as well as immediately
    // for the already-connected case.
    const subscribe = () => {
      socket.emit('balanceBoard:subscribe', {}, () => {});
    };

    socket.on('balanceBoard:frame', handleFrame);
    socket.on('connect', subscribe);
    subscribe();

    return () => {
      socket.off('balanceBoard:frame', handleFrame);
      socket.off('connect', subscribe);
      // The panel is the only consumer represented by this component. Leaving
      // the room on unmount prevents an inactive route or tab from continuing
      // to receive the board's continuous measurement stream.
      socket.emit('balanceBoard:unsubscribe');
    };
  }, [socket]);

  // Mask the previous reading immediately when disconnected. Keeping the last
  // socket frame in state avoids effect-driven state resets and stale flashes.
  const liveFrame = board?.connected ? frame : EMPTY_FRAME;
  const corners = { ...EMPTY_CORNERS, ...(liveFrame.corners || {}) };
  const center = centerOfPressure(corners);
  const liveBattery = finiteNumber(liveFrame.batteryPercent);
  const sessionBattery = finiteNumber(board?.batteryPercent);
  const battery = liveBattery ?? sessionBattery;
  const sleeping = board?.status === 'sleeping';
  const isAdmin = role === 'admin' || role === 'lockdown';

  const unpair = () => {
    if (unpairing || !board?.paired) return;
    if (!window.confirm('Unpair this Balance Board and require the red Sync button to pair it again?')) return;
    setUnpairing(true);
    setAdminMessage('');
    socket.emit('balanceBoard:unpair', {}, (response = {}) => {
      setUnpairing(false);
      if (response.error) {
        setAdminMessage(response.error);
      } else if (response.warning) {
        setAdminMessage('Board forgotten locally, but BlueZ reported a bond-removal warning.');
      } else {
        setAdminMessage('Board unpaired. Press the red Sync button to pair it again.');
      }
    });
  };

  return (
    <CardFrame
      title="Balance Board"
      className="relative w-full"
      bodyClassName="text-sm text-slate-200"
      actions={battery != null ? (
        <span className="font-mono text-xs text-slate-300">{Math.round(battery)}% battery</span>
      ) : null}
    >
      {sleeping ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-slate-950/85 px-2 text-center">
          <div className="space-y-0.5">
            <p className="text-lg font-semibold text-slate-100">Balance Board is asleep</p>
            <p className="text-sm text-slate-300">Press the front power button on the board to wake it.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-0.5 md:grid-cols-[minmax(0,1.25fr)_minmax(9rem,0.75fr)]">
        <section className="surface-muted p-1">
          <div className="relative mx-auto aspect-[1.35/1] w-full max-w-md overflow-hidden rounded-[1.5rem] border-2 border-slate-500 bg-gradient-to-b from-slate-700 to-slate-800 shadow-inner">
            <div className="absolute inset-[12%] rounded-[1rem] border border-slate-500/70 bg-slate-900/35" />
            <CornerReading className="left-1 top-1" label="Top left" value={corners.topLeft} />
            <CornerReading className="right-1 top-1" label="Top right" value={corners.topRight} />
            <CornerReading className="bottom-1 left-1" label="Bottom left" value={corners.bottomLeft} />
            <CornerReading className="bottom-1 right-1" label="Bottom right" value={corners.bottomRight} />
            <div
              aria-label="Center of pressure"
              className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg transition-all duration-100 ${
                center.active
                  ? 'border-cyan-100 bg-cyan-400 shadow-cyan-400/50'
                  : 'border-slate-400 bg-slate-600 opacity-50'
              }`}
              style={{ left: `${center.left}%`, top: `${center.top}%` }}
            />
            <div className="absolute bottom-0.5 left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-full bg-sky-400/70" />
          </div>
        </section>

        <div className="grid content-start gap-0.5">
          <section className="surface-muted px-1 py-1.5 text-center">
            <div className="text-xs text-slate-400">Total weight</div>
            <div className="mt-0.5 font-mono text-4xl font-bold leading-none text-white">
              {formatWeight(liveFrame.totalKg)}
            </div>
          </section>

          {isAdmin ? (
            <section className="surface-muted grid gap-0.5 p-0.5">
              {board?.address ? (
                <div className="truncate text-center font-mono text-[0.65rem] text-slate-500">{board.address}</div>
              ) : null}
              <button
                type="button"
                className="button-dark w-full text-xs disabled:opacity-50"
                disabled={!board?.paired || unpairing}
                onClick={unpair}
              >
                {unpairing ? 'Unpairing…' : 'Unpair board'}
              </button>
              {adminMessage ? <p className="text-center text-xs text-slate-400">{adminMessage}</p> : null}
            </section>
          ) : null}
        </div>
      </div>
    </CardFrame>
  );
}
