import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useControlSystem } from '../controls/index.js';
import { formatKeyLabel } from '../controls/keymapUtils.js';
import TopDownMap from './TopDownMap.jsx';
import RoverRoster from './RoverRoster.jsx';

export default function ControlSummary() {
  const { session, requestControl } = useSession();
  const {
    state: { roverId, keymap },
    actions,
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const roster = session?.roster ?? [];
  const [pending, setPending] = useState({});

  const canRequest = useMemo(() => session?.role && session.role !== 'spectator', [session?.role]);

  const driving = useMemo(
    () => (sensors.oiMode?.label || '').toLowerCase() === 'full',
    [sensors.oiMode?.label],
  );
  const docked = Boolean(sensors.chargingSources?.homeBase);
  const charging = Boolean(
    sensors.chargingState?.label && sensors.chargingState.label.toLowerCase() !== 'not charging',
  );

  const handleStartDrive = () => {
    if (!roverId) return;
    actions.setMode('drive');
    actions.runMacro('drive-sequence');
  };

  const handleDock = () => {
    if (!roverId) return;
    actions.setMode('dock');
    actions.runMacro('seek-dock');
  };

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
          <ActionButton
            title="Start Driving"
            description="Enable driving mode, then begin driving."
            statuses={[{ label: driving ? 'Ready' : 'Press to enter driving mode', active: driving }]}
            tone="emerald"
            onClick={handleStartDrive}
            disabled={!roverId}
            keyAction="driveMacro"
            keymap={keymap}
          />
          <ActionButton
            title="Dock and Charge"
            description="Line up about a foot from the dock, then press to attempt auto-dock."
            statuses={[
              { label: docked ? 'Docked' : 'Not docked', active: docked },
              { label: charging ? 'Charging' : 'Not charging', active: charging },
            ]}
            tone="indigo"
            onClick={handleDock}
            disabled={!roverId}
            keyAction="dockMacro"
            keymap={keymap}
          />
          <InlineCameraTilt keymap={keymap} />
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

function ActionButton({ title, description, statuses, onClick, disabled, tone, keyAction, keymap }) {
  const colors =
    tone === 'indigo'
      ? 'bg-indigo-700 hover:bg-indigo-600 focus-visible:ring-indigo-400'
      : 'bg-emerald-700 hover:bg-emerald-600 focus-visible:ring-emerald-400';
  const keyLabel = keyAction ? formatKeyLabel(keymap?.[keyAction]?.[0]) : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-full w-full flex-col items-center justify-center gap-0.5 border border-slate-700 px-1 py-1 text-center text-white transition focus-visible:outline-none focus-visible:ring-1 ${colors} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <div className="flex items-center justify-center gap-1">
        <span className="text-base font-semibold text-slate-100">{title}</span>
        {keyLabel ? <KeyPill label={keyLabel} /> : null}
      </div>
      <p className="text-sm text-slate-300 text-center">{description}</p>
      <div className="flex flex-wrap items-center justify-center gap-0.5">
        {statuses.map((status) => (
          <StatusPill key={status.label} active={status.active} label={status.label} />
        ))}
      </div>
    </button>
  );
}

function KeyPill({ label }) {
  return <span className="rounded border border-white/40 px-1 text-[0.7rem] text-white">{label}</span>;
}

function StatusPill({ label, active }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[0.7rem] font-semibold ${
        active ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
      }`}
    >
      {label}
    </span>
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
  const throttleRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) {
      setPendingAngle(value);
    }
  }, [value]);

  useEffect(
    () => () => {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
      }
    },
    [],
  );

  const scheduleSend = (next) => {
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
    }
    throttleRef.current = setTimeout(() => {
      setServoAngle(next);
    }, 150);
  };

  const handleSlider = (event) => {
    const next = Number.parseFloat(event.target.value);
    if (Number.isNaN(next)) return;
    draggingRef.current = true;
    setPendingAngle(next);
    scheduleSend(next);
  };

  const commitSlider = () => {
    draggingRef.current = false;
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
    }
    setServoAngle(pendingAngle);
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

function formatDegrees(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`;
}
