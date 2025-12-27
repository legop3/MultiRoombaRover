import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useControlSystem } from '../controls/index.js';
import { formatKeyLabel } from '../controls/keymapUtils.js';
import TopDownMap from './TopDownMap.jsx';
import RoverRoster from './RoverRoster.jsx';
import DriveDockAction, { useDriveDockState } from './DriveDockAction.jsx';

export default function ControlSummary() {
  const { session, requestControl } = useSession();
  const {
    state: { roverId, keymap },
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const driveDockState = useDriveDockState(roverId);
  const roster = session?.roster ?? [];
  const [pending, setPending] = useState({});

  const canRequest = useMemo(() => session?.role && session.role !== 'spectator', [session?.role]);

  const hideInlineControls = driveDockState.docked && !driveDockState.driving;

  async function handleRequest(targetRoverId) {
    if (!targetRoverId) return;
    setPending((prev) => ({ ...prev, [targetRoverId]: true }));
    try {
      await requestControl(targetRoverId);
    } catch (err) {
      alert(err.message);
    } finally {
      setPending((prev) => ({ ...prev, [targetRoverId]: false }));
    }
  }

  return (
    <section className="panel-section">
      <div className="grid items-stretch gap-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:min-h-[22rem]">
        <div className="flex h-full w-full items-stretch justify-center">
          <div className="aspect-square h-full w-full">
            <TopDownMap sensors={sensors} />
          </div>
        </div>
        <div className="grid h-full grid-rows-[1fr_1fr_auto] gap-0.75">
          <div className="row-span-2">
            <DriveDockAction layout="desktop" expand driveDockState={driveDockState} />
          </div>
          {!hideInlineControls ? <InlineCameraTilt keymap={keymap} /> : null}
        </div>
      </div>
      <RoverRoster
        title="Rovers"
        roster={roster}
        renderActions={(rover) =>
          canRequest ? (
            <button
              type="button"
              onClick={() => handleRequest(rover.id)}
              disabled={pending[rover.id]}
              className="button-dark disabled:opacity-40"
            >
              {pending[rover.id] ? '...' : 'request'}
            </button>
          ) : null
        }
      />
    </section>
  );
}

function InlineCameraTilt({ keymap }) {
  const {
    state: { roverId, camera },
    actions: { setServoAngle },
  } = useControlSystem();

  const config = camera?.config;
  const enabled = Boolean(roverId && camera?.enabled && config);
  const min = typeof config?.minAngle === 'number' ? config.minAngle : -30;
  const max = typeof config?.maxAngle === 'number' ? config.maxAngle : 30;
  const value =
    typeof camera?.angle === 'number'
      ? camera.angle
      : typeof config?.homeAngle === 'number'
        ? config.homeAngle
        : (min + max) / 2;

  const [pendingAngle, setPendingAngle] = useState(value);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) {
      setPendingAngle(value);
    }
  }, [value]);

  const handleSlider = (event) => {
    const next = Number.parseFloat(event.target.value);
    if (Number.isNaN(next)) return;
    draggingRef.current = true;
    setPendingAngle(next);
    setServoAngle(next);
  };

  const commitSlider = () => {
    draggingRef.current = false;
  };

  if (!enabled) return null;
  const upLabel = formatKeyLabel(keymap?.cameraUp?.[0]);
  const downLabel = formatKeyLabel(keymap?.cameraDown?.[0]);

  return (
    <div className="surface space-y-0.5 px-1 py-1 text-sm text-slate-200">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>Camera tilt</span>
        <span className="font-mono text-slate-100">{formatDegrees(value)}</span>
      </div>
      <div>
        <input
          type="range"
          className="w-full accent-emerald-400"
          min={min}
          max={max}
          step={0.5}
          value={pendingAngle}
          onChange={handleSlider}
          onMouseUp={commitSlider}
          onTouchEnd={commitSlider}
          onPointerUp={commitSlider}
        />
        <div className="mt-0.25 flex items-center justify-between text-[0.7rem] text-slate-400">
          <span className="flex items-center gap-0.25">
            {downLabel ? <KeyPill label={downLabel} /> : null}
            {formatDegrees(min)}
          </span>
          <span className="flex items-center gap-0.25">
            {formatDegrees(max)}
            {upLabel ? <KeyPill label={upLabel} /> : null}
          </span>
        </div>
      </div>
    </div>
  );
}

function KeyPill({ label }) {
  return <span className="rounded border border-white/40 px-1 text-[0.7rem] text-white">{label}</span>;
}

function formatDegrees(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`;
}
