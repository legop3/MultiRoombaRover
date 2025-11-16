import { useCallback } from 'react';
import { Joystick } from 'react-joystick-component';
import { useDriveControl } from '../context/DriveControlContext.jsx';

function clampUnit(value = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function MobileJoystick() {
  const { roverId, driveWithVector, stopMotors } = useDriveControl();
  const disabled = !roverId;

  const handleMove = useCallback(
    (event = {}) => {
      if (disabled) return;
      const x = clampUnit(event.x ?? 0);
      const y = clampUnit(event.y ?? 0);
      driveWithVector({ x, y });
    },
    [disabled, driveWithVector],
  );

  const handleStop = useCallback(() => {
    if (disabled) return;
    driveWithVector({ x: 0, y: 0 });
  }, [disabled, driveWithVector]);

  return (
    <section className="rounded-lg border border-slate-900 bg-slate-950/70 p-2 text-[0.8rem] text-slate-100">
      <div className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-500">Joystick</div>
      <div className="mt-2 flex items-center justify-center">
        <Joystick
          size={120}
          baseColor="#0f172a"
          stickColor="#38bdf8"
          throttle={75}
          move={handleMove}
          stop={handleStop}
          disabled={disabled}
        />
      </div>
      <p className="mt-2 text-[0.65rem] text-slate-400">
        Drag to drive. Release to stop sending drive commands.
      </p>
      <button
        type="button"
        onClick={stopMotors}
        disabled={disabled}
        className="mt-2 w-full rounded border border-slate-800 bg-black/40 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-200 disabled:opacity-40"
      >
        Panic Stop
      </button>
    </section>
  );
}

function AuxMotorControls() {
  const { roverId, setAuxMotors } = useDriveControl();
  const disabled = !roverId;

  const runAllForward = () => {
    if (disabled) return;
    setAuxMotors({ main: 127, side: 127, vacuum: 127 });
  };

  const stopAll = () => {
    if (disabled) return;
    setAuxMotors({ main: 0, side: 0, vacuum: 0 });
  };

  const auxButtons = [
    { label: 'Main +', values: { main: 127 } },
    { label: 'Main -', values: { main: -127 } },
    { label: 'Side +', values: { side: 127 } },
    { label: 'Side -', values: { side: -127 } },
    { label: 'Vacuum Max', values: { vacuum: 127 } },
    { label: 'Vacuum Off', values: { vacuum: 0 } },
  ];

  return (
    <section className="rounded-lg border border-slate-900 bg-slate-950/70 p-2 text-[0.8rem] text-slate-100">
      <div className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-500">Aux Motors</div>
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={runAllForward}
          disabled={disabled}
          className="flex-1 rounded border border-emerald-500/40 bg-emerald-500/10 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-200 disabled:opacity-40"
        >
          All forward
        </button>
        <button
          type="button"
          onClick={stopAll}
          disabled={disabled}
          className="flex-1 rounded border border-slate-800 bg-black/40 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-200 disabled:opacity-40"
        >
          Stop all
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[0.7rem]">
        {auxButtons.map((btn) => (
          <button
            key={btn.label}
            type="button"
            onClick={() => !disabled && setAuxMotors(btn.values)}
            disabled={disabled}
            className="rounded border border-slate-800 bg-black/30 py-1 uppercase tracking-[0.2em] text-slate-200 disabled:opacity-30"
          >
            {btn.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function MobileControlsStack() {
  return (
    <div className="flex flex-col gap-2">
      <MobileJoystick />
      <AuxMotorControls />
    </div>
  );
}

export { MobileJoystick, AuxMotorControls };
