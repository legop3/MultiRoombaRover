import { useEffect, useRef, useState } from 'react';
import { useDriveControl } from '../context/DriveControlContext.jsx';

const SLIDER_THROTTLE_MS = 150;

function formatDegrees(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`;
}

export default function CameraServoPanel() {
  const { roverId, servo } = useDriveControl();
  const config = servo?.config;
  const enabled = Boolean(roverId && servo?.enabled && config);
  const min = typeof config?.minAngle === 'number' ? config.minAngle : -30;
  const max = typeof config?.maxAngle === 'number' ? config.maxAngle : 30;
  const value =
    typeof servo?.angle === 'number'
      ? servo.angle
      : typeof config?.homeAngle === 'number'
        ? config.homeAngle
        : (min + max) / 2;

  if (!enabled) return null;

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

  const step =
    typeof config?.nudgeDegrees === 'number' && config.nudgeDegrees > 0
      ? config.nudgeDegrees
      : 1;

  const scheduleSend = (next) => {
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
    }
    throttleRef.current = setTimeout(() => {
      servo.setAngle(next);
    }, SLIDER_THROTTLE_MS);
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
    servo.setAngle(pendingAngle);
  };

  const handleNudge = (direction) => {
    const delta = step * direction;
    servo.nudge(delta);
  };

  return (
    <section className="rounded-sm bg-[#242a32] p-1 text-base text-slate-100">
      <div className="flex items-center justify-between text-sm text-slate-300">
        <span>Camera Tilt</span>
        <span className="font-mono text-sm text-slate-100">{formatDegrees(value)}</span>
      </div>
      <div className="mt-2">
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
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>{formatDegrees(min)}</span>
          <span>{formatDegrees(max)}</span>
        </div>
      </div>
      <div className="mt-2 flex gap-1 text-sm">
        <button
          type="button"
          className="flex-1 rounded bg-slate-800 px-1 py-0.5 text-slate-100 hover:bg-slate-700"
          onClick={() => handleNudge(-1)}
        >
          Tilt Down
        </button>
        <button
          type="button"
          className="flex-1 rounded bg-slate-700 px-1 py-0.5 text-slate-100 hover:bg-slate-600"
          onClick={() => servo.goHome()}
        >
          Center
        </button>
        <button
          type="button"
          className="flex-1 rounded bg-slate-800 px-1 py-0.5 text-slate-100 hover:bg-slate-700"
          onClick={() => handleNudge(1)}
        >
          Tilt Up
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Step: {formatDegrees(step)} · Pin GPIO {config?.pin}
      </p>
    </section>
  );
}
