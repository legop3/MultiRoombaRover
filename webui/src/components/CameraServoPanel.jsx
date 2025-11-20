import { useEffect, useRef, useState } from 'react';
import { useControlSystem } from '../controls/index.js';

const SLIDER_THROTTLE_MS = 150;

function formatDegrees(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`;
}

export default function CameraServoPanel() {
  const {
    state: { roverId, camera },
    actions: { setServoAngle, nudgeServo, goServoHome },
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
      setServoAngle(next);
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
    setServoAngle(pendingAngle);
  };

  const handleNudge = (direction) => {
    const delta = step * direction;
    nudgeServo(delta);
  };

  return (
    <section className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between text-sm text-slate-300">
        <span>Camera Tilt</span>
        <span className="font-mono text-sm text-slate-100">{formatDegrees(value)}</span>
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
        <div className="mt-0.5 flex justify-between text-xs text-slate-400">
          <span>{formatDegrees(min)}</span>
          <span>{formatDegrees(max)}</span>
        </div>
      </div>
      {/* <div className="flex gap-0.5 text-sm">
        <button type="button" className="flex-1 button-dark" onClick={() => handleNudge(-1)}>
          Tilt Down
        </button>
        <button type="button" className="flex-1 button-dark" onClick={() => goServoHome()}>
          Center
        </button>
        <button type="button" className="flex-1 button-dark" onClick={() => handleNudge(1)}>
          Tilt Up
        </button>
      </div> */}
      {/* <p className="text-xs text-slate-400">
        Step: {formatDegrees(step)} · Pin GPIO {config?.pin}
      </p> */}
    </section>
  );
}
