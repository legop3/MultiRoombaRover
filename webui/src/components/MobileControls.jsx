import { useCallback, useRef } from 'react';
import { Joystick } from 'react-joystick-component';
import { useControlSystem } from '../controls/index.js';
import { clampUnit } from '../controls/controlMath.js';
import DriveModeToggle from './controls/DriveModeToggle.jsx';

const SOURCE = 'mobile-joystick';
const AUX_BUTTONS = [
  { id: 'main-forward', label: 'Main +', values: { main: 127 }, hold: true },
  { id: 'main-reverse', label: 'Main -', values: { main: -127 }, hold: true },
  { id: 'side-forward', label: 'Side +', values: { side: 127 }, hold: true },
  { id: 'side-reverse', label: 'Side -', values: { side: -70 }, hold: true },
  { id: 'vacuum-fast', label: 'Vacuum Max', values: { vacuum: 127 }, hold: true },
  { id: 'vacuum-slow', label: 'Vacuum Low', values: { vacuum: 50 }, hold: true },
  { id: 'all-forward', label: 'All +', values: { main: 127, side: 127, vacuum: 127 }, hold: true },
  { id: 'stop-all', label: 'Stop', values: { main: 0, side: 0, vacuum: 0 }, hold: false },
];

function MobileJoystickPanel({ layout }) {
  const {
    state: { roverId },
    actions: { setDriveVector, registerInputState, stopAllMotion },
  } = useControlSystem();
  const disabled = !roverId;

  const handleMove = useCallback(
    (event = {}) => {
      if (disabled) return;
      const vector = {
        x: clampUnit(event.x ?? 0),
        y: clampUnit(event.y ?? 0),
        boost: Boolean(event.shiftKey),
      };
      setDriveVector(vector, { source: SOURCE });
      registerInputState(SOURCE, { vector, lastEvent: 'move' });
    },
    [disabled, registerInputState, setDriveVector],
  );

  const handleStop = useCallback(() => {
    if (disabled) return;
    const zero = { x: 0, y: 0, boost: false };
    setDriveVector(zero, { source: SOURCE });
    registerInputState(SOURCE, { vector: zero, lastEvent: 'stop' });
  }, [disabled, registerInputState, setDriveVector]);

  return (
    <section className="rounded-sm bg-[#242a32] p-1 text-sm text-slate-100">
      <DriveModeToggle size="compact" />
      <div className="mt-1 flex flex-col gap-1">
        <div className="flex items-center justify-center">
          <Joystick
            size={layout === 'landscape' ? 140 : 120}
            baseColor="#0f172a"
            stickColor="#38bdf8"
            throttle={60}
            move={handleMove}
            stop={handleStop}
            disabled={disabled}
          />
        </div>
        <p className="text-[0.7rem] text-slate-400">Drag to steer · Release to stop sending drive commands.</p>
        <button
          type="button"
          onClick={stopAllMotion}
          disabled={disabled}
          className="rounded-sm bg-red-600 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-red-100 disabled:opacity-40"
        >
          Panic Stop
        </button>
      </div>
    </section>
  );
}

function AuxMotorPanel({ orientation }) {
  const {
    state: { roverId },
    actions: { setAuxMotors },
  } = useControlSystem();
  const activeRef = useRef(null);
  const disabled = !roverId;

  const handlePress = useCallback(
    (button) => {
      if (disabled) return;
      if (button.hold === false) {
        setAuxMotors(button.values);
        activeRef.current = null;
        return;
      }
      activeRef.current = button.id;
      setAuxMotors(button.values);
    },
    [disabled, setAuxMotors],
  );

  const handleRelease = useCallback(
    (button) => {
      if (disabled || button.hold === false) return;
      if (activeRef.current === button.id) {
        activeRef.current = null;
        setAuxMotors({ main: 0, side: 0, vacuum: 0 });
      }
    },
    [disabled, setAuxMotors],
  );

  const buttonClasses = orientation === 'landscape' ? 'text-xs' : 'text-[0.75rem]';

  return (
    <section className="rounded-sm bg-[#242a32] p-1 text-sm text-slate-100">
      <p className="text-xs text-slate-400">Aux motors · hold to run</p>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {AUX_BUTTONS.map((button) => (
          <button
            key={button.id}
            type="button"
            disabled={disabled}
            onPointerDown={(event) => {
              event.preventDefault();
              handlePress(button);
            }}
            onPointerUp={() => handleRelease(button)}
            onPointerLeave={() => handleRelease(button)}
            onPointerCancel={() => handleRelease(button)}
            className={`rounded-sm bg-black/40 px-1 py-1 text-left text-slate-100 disabled:opacity-30 ${buttonClasses}`}
          >
            {button.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function MobileLandscapeAuxColumn() {
  return (
    <div className="flex flex-col gap-1">
      <AuxMotorPanel orientation="landscape" />
    </div>
  );
}

export function MobileLandscapeControlColumn() {
  return (
    <div className="flex flex-col gap-1">
      <MobileJoystickPanel layout="landscape" />
    </div>
  );
}

export default function MobilePortraitControls() {
  return (
    <section className="rounded-sm bg-transparent">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <AuxMotorPanel orientation="portrait" />
        <MobileJoystickPanel layout="portrait" />
      </div>
    </section>
  );
}
