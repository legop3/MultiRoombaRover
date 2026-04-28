import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useControlSystem } from '../controls/index.js';
import { formatKeyLabel } from '../controls/keymapUtils.js';
import TopDownMap from './TopDownMap.jsx';
import RoverRoster from './RoverRoster.jsx';
import DriveDockAction, { useDriveDockState } from './DriveDockAction/index.jsx';
import NightVisionControl from './NightVisionControl.jsx';
import HornControl from './HornControl.jsx';
import CameraTiltControl from './CameraTiltControl.jsx';

export function RoverRosterPanel({ title = 'Rovers' }) {
  const { session, requestControl } = useSession();
  const [pending, setPending] = useState({});

  const canRequest = useMemo(() => session?.role && session.role !== 'spectator', [session?.role]);

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
    <RoverRoster
      title={title}
      roster={session?.roster ?? []}
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
  );
}

export default function ControlSummary() {
  const {
    state: { roverId, keymap, camera, horn },
    pipeline,
    actions: { setServoAngle, setNightVision, startHorn, stopHorn },
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const driveDockState = useDriveDockState(roverId);
  const hideInlineControls = driveDockState.docked && !driveDockState.driving;

  const config = camera?.config;
  const cameraEnabled = Boolean(roverId && camera?.enabled && config);
  const nightVisionAvailable = Boolean(roverId && pipeline?.nightVision);
  const nightVisionState = pipeline?.nightVisionState;
  const hornAvailable = Boolean(roverId && pipeline?.horn);
  const hornBlocked = horn?.overheated;
  const min = typeof config?.minAngle === 'number' ? config.minAngle : -30;
  const max = typeof config?.maxAngle === 'number' ? config.maxAngle : 30;
  const value =
    typeof camera?.angle === 'number'
      ? camera.angle
      : typeof config?.homeAngle === 'number'
        ? config.homeAngle
        : (min + max) / 2;
  const nightVisionLabel = formatKeyLabel(keymap?.nightVisionToggle?.[0]);
  const hornLabel = formatKeyLabel(keymap?.hornHonk?.[0]);
  const upLabel = formatKeyLabel(keymap?.cameraUp?.[0]);
  const downLabel = formatKeyLabel(keymap?.cameraDown?.[0]);

  return (
    <section className="panel-section">
      <div className="grid items-stretch gap-0.5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:min-h-[18rem]">
        <div className="flex h-full w-full items-stretch justify-center">
          <div className="aspect-square h-full w-full">
            <TopDownMap sensors={sensors} />
          </div>
        </div>
        <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-0.5">
          <DriveDockAction layout="desktop" expand driveDockState={driveDockState} />
          {!hideInlineControls ? (
            <div className="surface space-y-0.5 p-0 text-sm text-slate-200">
              {nightVisionAvailable && (
                <NightVisionControl
                  nightVisionOn={nightVisionState?.nightVisionOn}
                  disabled={!roverId}
                  onToggle={setNightVision}
                  keyLabel={nightVisionLabel}
                />
              )}
              {hornAvailable && (
                <HornControl
                  disabled={!roverId || hornBlocked}
                  onStart={startHorn}
                  onStop={stopHorn}
                  keyLabel={hornLabel}
                  active={horn?.active}
                  heat={horn?.heat}
                />
              )}
              {cameraEnabled && (
                <CameraTiltControl
                  value={value}
                  min={min}
                  max={max}
                  onChange={setServoAngle}
                  keyDownLabel={downLabel}
                  keyUpLabel={upLabel}
                  className="space-y-0.5 px-1 py-1"
                  labelRowClass="text-xs text-slate-300"
                  labelClass=""
                  valueClass="font-mono text-slate-100"
                  sliderClass="w-full"
                  accentClass="accent-emerald-400"
                  endpointClass="text-[0.7rem] text-slate-400"
                />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
