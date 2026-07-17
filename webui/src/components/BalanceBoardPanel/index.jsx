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
const EMPTY_FRAME = {
  totalKg: 0,
  batteryPercent: null,
  // Null distinguishes "no live frame received yet" from a legitimate record
  // of zero, allowing the persisted session value to remain visible while the
  // socket room subscription is being established.
  recordKg: null,
  recordedAt: null,
  corners: EMPTY_CORNERS,
};

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
  // safe interior of the load map.
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
    <div className={`surface absolute min-w-[5.5rem] text-center ${className}`}>
      <div className="text-[0.62rem] text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-100">{formatWeight(value)}</div>
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
  const [zeroRequesting, setZeroRequesting] = useState(false);
  const [resettingRecord, setResettingRecord] = useState(false);

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
  // Live frames make a newly reached record move immediately. The session copy
  // remains available while the board sleeps or before this panel subscribes,
  // which is important because the record belongs to the installation rather
  // than to one Bluetooth connection.
  const liveRecord = board?.connected ? finiteNumber(frame.recordKg) : null;
  const sessionRecord = finiteNumber(board?.recordKg);
  const record = liveRecord ?? sessionRecord ?? 0;
  const sleeping = board?.status === 'sleeping';
  const isAdmin = role === 'admin' || role === 'lockdown';
  const calibration = board?.calibration || null;
  const zeroing = Boolean(calibration?.active);

  const zero = () => {
    if (zeroRequesting || zeroing || !board?.connected) return;
    if (!window.confirm('Use the board’s current load as zero? Keep everything still for ten seconds.')) return;
    setZeroRequesting(true);
    socket.emit('balanceBoard:zero', {}, (response = {}) => {
      setZeroRequesting(false);
      if (response.error) window.alert(response.error);
    });
  };

  const unpair = () => {
    if (unpairing || !board?.paired) return;
    if (!window.confirm('Unpair this Balance Board and require the red Sync button to pair it again?')) return;
    setUnpairing(true);
    socket.emit('balanceBoard:unpair', {}, (response = {}) => {
      setUnpairing(false);
      if (response.error) {
        window.alert(response.error);
      } else if (response.warning) {
        window.alert('Board forgotten locally, but BlueZ reported a bond-removal warning.');
      }
    });
  };

  const resetRecord = () => {
    if (resettingRecord) return;
    if (!window.confirm('Reset the highest weight record?')) return;
    setResettingRecord(true);
    socket.emit('balanceBoard:resetRecord', {}, (response = {}) => {
      setResettingRecord(false);
      if (response.error) window.alert(response.error);
    });
  };

  const actions = isAdmin ? (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className="button-dark text-xs disabled:opacity-50"
        disabled={!board?.connected || zeroRequesting || zeroing || unpairing}
        onClick={zero}
      >
        {zeroing
          ? `Zeroing ${calibration.samplesCollected}/${calibration.totalSamples}`
          : zeroRequesting ? 'Starting…' : 'Zero'}
      </button>
      <button
        type="button"
        className="button-dark text-xs disabled:opacity-50"
        disabled={!board?.paired || unpairing || zeroing}
        onClick={unpair}
      >
        {unpairing ? 'Unpairing…' : 'Unpair'}
      </button>
    </div>
  ) : null;

  return (
    <CardFrame
      title="Balance Board"
      className="relative w-full"
      bodyClassName="text-sm text-slate-200"
      actions={actions}
    >
      {sleeping ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-slate-950/85 px-2 text-center">
          <div className="space-y-0.5">
            <p className="text-lg font-semibold text-slate-100">The Balance Board is asleep</p>
            <p className="text-sm text-slate-300">Press the front power button on the board to wake it.</p>
          </div>
        </div>
      ) : null}

      {/* Keep the measurement column narrow and fixed so the board remains the
          dominant visual while record and battery stay in one predictable
          place. Both pieces use the shared dark panel treatment instead of
          introducing a Balance Board-specific background style. */}
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-0.5">
        <div className="panel-section relative h-52 overflow-hidden">
          {zeroing ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/90 px-2 text-center">
              <div className="space-y-0.5">
                <p className="text-lg font-semibold text-slate-100">
                  Zeroing {calibration.samplesCollected}/{calibration.totalSamples}
                </p>
                <p className="text-sm text-slate-300">Keep the board and everything on it still.</p>
              </div>
            </div>
          ) : null}
          <CornerReading className="left-0.5 top-0.5" label="Top left" value={corners.topLeft} />
          <CornerReading className="right-0.5 top-0.5" label="Top right" value={corners.topRight} />
          <CornerReading className="bottom-0.5 left-0.5" label="Bottom left" value={corners.bottomLeft} />
          <CornerReading className="bottom-0.5 right-0.5" label="Bottom right" value={corners.bottomRight} />
          <div
            aria-label="Center of pressure"
            className={`absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-100 ${
              center.active
                ? 'border-sky-200 bg-sky-500'
                : 'border-neutral-500 bg-neutral-600 opacity-50'
            }`}
            style={{ left: `${center.left}%`, top: `${center.top}%` }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="surface px-1 py-0.5 text-center">
              <div className="text-[0.65rem] text-slate-400">Total weight</div>
              <div className="text-3xl font-bold leading-none text-white">
                {formatWeight(liveFrame.totalKg)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid h-52 grid-rows-[minmax(0,1fr)_auto] gap-0.5">
          <div className="panel-section flex min-h-0 flex-col items-center justify-center gap-1 text-center">
            <div className="text-xs text-slate-400">Weight record</div>
            <div className="text-xl font-bold text-white">{formatWeight(record)}</div>
            {isAdmin ? (
              <button
                type="button"
                className="button-dark text-xs disabled:opacity-50"
                disabled={resettingRecord}
                onClick={resetRecord}
              >
                {resettingRecord ? 'Resetting…' : 'Reset'}
              </button>
            ) : null}
          </div>
          <div className="panel-section px-1 py-1 text-center">
            <div className="text-xs text-slate-400">Battery</div>
            <div className="text-xl font-semibold text-slate-100">
              {battery == null ? '—' : `${Math.round(battery)}%`}
            </div>
          </div>
        </div>
      </div>
    </CardFrame>
  );
}
