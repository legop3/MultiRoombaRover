// Balance Board Panel
// Purpose: Presents the automatic rover weigh-station lifecycle and live four-corner load visualization.
// Scope: Owns feature gating, frame subscription, status copy, centering display, and admin-only maintenance actions.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import CardFrame from '../CardFrame/index.jsx';

const EMPTY_FRAME = {
  totalKg: 0,
  corners: {
    topLeft: 0,
    topRight: 0,
    bottomLeft: 0,
    bottomRight: 0,
  },
  center: { x: 0, y: 0 },
  batteryPercent: null,
  phase: 'waiting',
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function formatWeight(value) {
  const weight = Number(value);
  return Number.isFinite(weight) ? `${weight.toFixed(2)} kg` : '0.00 kg';
}

function describePhase(status, frame) {
  const phase = frame?.phase || status?.phase || 'waiting';
  if (phase === 'commissioning') {
    return {
      label: 'Pairing setup',
      instruction: 'Press the red Sync button underneath the board. The server will pair it automatically.',
      className: 'border-amber-500/60 bg-amber-950/60 text-amber-200',
    };
  }
  if (phase === 'pairing') {
    return {
      label: 'Pairing',
      instruction: 'Keep the red Sync button active while the server completes the Bluetooth bond.',
      className: 'border-sky-500/60 bg-sky-950/60 text-sky-200',
    };
  }
  if (phase === 'error' || status?.lastError) {
    return {
      label: 'Needs attention',
      instruction: status?.lastError || 'The Balance Board bridge reported an error.',
      className: 'border-red-500/60 bg-red-950/60 text-red-200',
    };
  }
  if (!status?.connected) {
    return {
      label: 'Sleeping',
      instruction: 'Press the board’s front power button, then drive onto the station.',
      className: 'border-slate-600 bg-slate-800 text-slate-200',
    };
  }
  if (phase === 'zeroing') {
    return {
      label: 'Zeroing',
      instruction: 'Keep the board empty while it establishes its resting baseline.',
      className: 'border-violet-500/60 bg-violet-950/60 text-violet-200',
    };
  }
  if (phase === 'entering') {
    return {
      label: 'Approaching',
      instruction: 'Continue onto the board until the rover’s full weight is supported.',
      className: 'border-sky-500/60 bg-sky-950/60 text-sky-200',
    };
  }
  if (phase === 'stabilizing') {
    return {
      label: 'Hold still',
      instruction: 'Center the marker and stop moving while the measurement stabilizes.',
      className: 'border-amber-500/60 bg-amber-950/60 text-amber-200',
    };
  }
  if (phase === 'captured') {
    return {
      label: 'Captured',
      instruction: 'Measurement saved. Drive completely off to reset the station.',
      className: 'border-emerald-500/60 bg-emerald-950/60 text-emerald-200',
    };
  }
  return {
    label: 'Ready',
    instruction: 'Drive onto the board. The station will capture a stable weight automatically.',
    className: 'border-emerald-500/60 bg-emerald-950/60 text-emerald-200',
  };
}

function CornerLoad({ label, value }) {
  return (
    <div className="rounded border border-slate-600 bg-slate-950/70 px-1 py-0.5 text-center">
      <div className="text-[0.62rem] text-slate-400">{label}</div>
      <div className="font-mono text-xs font-semibold text-slate-100">{formatWeight(value)}</div>
    </div>
  );
}

export default function BalanceBoardPanel() {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'balanceBoard'));

  /*
    Balance Board support is optional physical hardware. Keeping the gate inside
    this component lets every Activities layout include the panel without
    duplicating config checks or leaving an empty wrapper on disabled servers.
  */
  if (!enabled) return null;
  return <BalanceBoardPanelContent />;
}

function BalanceBoardPanelContent() {
  const socket = useSocket();
  const status = useSessionSelector((state) => state.session?.balanceBoard || null);
  const role = useSessionSelector((state) => state.session?.role || 'spectator');
  const [frame, setFrame] = useState(EMPTY_FRAME);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState('');
  const isAdmin = role === 'admin' || role === 'lockdown';

  useEffect(() => {
    if (!socket) return undefined;
    const handleFrame = (next = {}) => {
      setFrame({
        ...EMPTY_FRAME,
        ...next,
        corners: { ...EMPTY_FRAME.corners, ...(next.corners || {}) },
        center: { ...EMPTY_FRAME.center, ...(next.center || {}) },
      });
    };
    socket.on('balanceBoard:frame', handleFrame);
    socket.emit('balanceBoard:subscribe', {}, () => {});
    return () => {
      socket.off('balanceBoard:frame', handleFrame);
      socket.emit('balanceBoard:unsubscribe');
    };
  }, [socket]);

  useEffect(() => {
    if (!status?.connected) setFrame(EMPTY_FRAME);
  }, [status?.connected]);

  const runAction = useCallback(
    (action) => {
      if (!socket || actionPending) return;
      setActionPending(action);
      setActionError('');
      socket.emit(`balanceBoard:${action}`, {}, (response = {}) => {
        if (response.error) setActionError(response.error);
        setActionPending('');
      });
    },
    [actionPending, socket],
  );

  const presentation = useMemo(() => describePhase(status, frame), [frame, status]);
  const centerX = clamp(frame.center?.x, -1, 1);
  const centerY = clamp(frame.center?.y, -1, 1);
  const markerStyle = {
    left: `${50 + centerX * 42}%`,
    top: `${50 + centerY * 42}%`,
  };
  const battery = Number.isFinite(Number(frame.batteryPercent))
    ? Number(frame.batteryPercent)
    : Number.isFinite(Number(status?.batteryPercent))
      ? Number(status.batteryPercent)
      : null;
  const displayedWeight = status?.connected
    ? frame.totalKg
    : status?.lastMeasurement?.totalKg || 0;

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-0.5">
      {battery != null ? (
        <span className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-[0.65rem] text-slate-300">
          Battery {Math.round(battery)}%
        </span>
      ) : null}
      <span className={`rounded border px-1 py-0.5 text-[0.65rem] font-semibold ${presentation.className}`}>
        {presentation.label}
      </span>
    </div>
  );

  return (
    <CardFrame title="Rover Weigh Station" actions={actions} bodyClassName="space-y-1 p-1.5">
      <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_minmax(11rem,0.72fr)]">
        <div className="relative aspect-[1.55/1] min-h-[10rem] overflow-hidden rounded-lg border-2 border-slate-500 bg-slate-800 shadow-inner">
          {/*
            The crosshair and normalized marker make centering readable without
            pretending the board can locate a rover in physical centimeters.
            The kernel gives load distribution, so -1..1 is the honest unit.
          */}
          <div className="absolute inset-x-0 top-1/2 h-px bg-slate-600" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600" />
          <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-emerald-400/70" />
          <div
            className={`absolute z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg transition-[left,top] duration-100 ${
              frame.totalKg >= Number(status?.settings?.minimumWeightKg || 1)
                ? 'border-white bg-emerald-400 shadow-emerald-400/50'
                : 'border-slate-400 bg-slate-600'
            }`}
            style={markerStyle}
            aria-label="Center of pressure"
          />
          <div className="absolute inset-1 grid grid-cols-2 grid-rows-2 gap-1">
            <CornerLoad label="Top left" value={frame.corners.topLeft} />
            <CornerLoad label="Top right" value={frame.corners.topRight} />
            <CornerLoad label="Bottom left" value={frame.corners.bottomLeft} />
            <CornerLoad label="Bottom right" value={frame.corners.bottomRight} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-1 rounded border border-slate-700 bg-slate-950/50 p-1.5">
          <div>
            <div className="text-[0.65rem] tracking-wide text-slate-500">Current weight</div>
            <div className="font-mono text-3xl font-bold leading-tight text-white">{formatWeight(displayedWeight)}</div>
            <p className="mt-1 text-xs leading-snug text-slate-300">{presentation.instruction}</p>
          </div>

          {status?.lastMeasurement ? (
            <div className="rounded border border-emerald-700/60 bg-emerald-950/30 p-1 text-xs text-emerald-200">
              Last captured: <strong>{formatWeight(status.lastMeasurement.totalKg)}</strong>
            </div>
          ) : null}

          {isAdmin ? (
            <div className="border-t border-slate-700 pt-1">
              <div className="mb-0.5 text-[0.62rem] text-slate-500">Admin maintenance</div>
              <div className="flex flex-wrap gap-0.5">
                {!status?.paired ? (
                  <button type="button" className="button-dark px-1 py-0.5 text-xs" disabled={Boolean(actionPending)} onClick={() => runAction('pair')}>
                    Pair board
                  </button>
                ) : null}
                <button type="button" className="button-dark px-1 py-0.5 text-xs" disabled={Boolean(actionPending) || !status?.connected} onClick={() => runAction('tare')}>
                  Tare
                </button>
                <button type="button" className="button-dark px-1 py-0.5 text-xs" disabled={Boolean(actionPending)} onClick={() => runAction('restart')}>
                  Restart bridge
                </button>
                {status?.paired ? (
                  <button
                    type="button"
                    className="rounded border border-red-700 bg-red-950/60 px-1 py-0.5 text-xs text-red-200 hover:bg-red-900/70 disabled:opacity-50"
                    disabled={Boolean(actionPending)}
                    onClick={() => {
                      if (window.confirm('Forget the paired Balance Board and return to commissioning mode?')) runAction('forget');
                    }}
                  >
                    Forget board
                  </button>
                ) : null}
              </div>
              {actionError ? <p className="mt-0.5 text-[0.68rem] text-red-300">{actionError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </CardFrame>
  );
}
