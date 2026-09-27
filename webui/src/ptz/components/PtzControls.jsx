import { useCallback, useEffect } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';
import CardFrame from '../../components/CardFrame/index.jsx';
import ControlPadPanel from '../../components/MobileControls/ControlPadPanel.jsx';
import GPIOToggleControl from '../../components/GPIOToggleControl/index.jsx';
import KeyPill from '../../components/vip/VipAudioUploadCard/KeyPill.jsx';
import ControlHint from '../../components/ControlHint/index.jsx';
function PtzLightingControls({ disabled = false }) {
  const { setHeadlight, setLaser } = useControlActions();
  const { spotlightOn, irMode, pending } = useControlSelector((control) => control.ptzControls.lighting);
  const canControl = useControlSelector((control) => control.ptzControls.isActive);
  const blocked = disabled || !canControl;
  const cycleIr = () => {
    triggerTouchHaptic('button');
    setLaser();
  };

  return (
    <div className="mobile-touch-control grid grid-cols-2 gap-0.5 text-sm">
      <GPIOToggleControl
        label="Spotlight"
        on={spotlightOn}
        disabled={blocked || pending.spotlight}
        onToggle={setHeadlight}
        heightClass="min-h-14"
      />
      <button
        type="button"
        className="mobile-touch-control flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-cyan-300/70 bg-cyan-900 px-1 py-0.75 text-center text-cyan-50 disabled:opacity-50"
        disabled={blocked || pending.ir}
        onClick={cycleIr}
      >
        <span className="text-sm font-semibold">Infrared</span>
        <span className="rounded-sm bg-cyan-300 px-1 py-0.5 text-[0.7rem] font-semibold text-cyan-950">{irMode}</span>
      </button>
    </div>
  );
}

function PtzMobileZoomButtons({ disabled = false }) {
  const { setCameraAxisIntent } = useControlActions();

  const stopZoom = useCallback(() => {
    /*
      Zero only releases the zoom axis. The PTZ adapter combines it with any
      pan/tilt direction still held on the movement pad, so lifting one finger
      cannot erase the other finger's intent.
    */
    setCameraAxisIntent(0);
  }, [setCameraAxisIntent]);

  const startZoom = useCallback(
    (direction) => (event) => {
      /*
        Publish held state once. The adapter owns the single motion heartbeat,
        so this button no longer creates a second interval whose queued callback
        could run after pointerup and restart zoom.
      */
      event.preventDefault();
      if (disabled) return;
      triggerTouchHaptic('button');
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setCameraAxisIntent(direction);
    },
    [disabled, setCameraAxisIntent],
  );
  const stopFromPointer = useCallback(
    (event) => {
      event?.preventDefault?.();
      if (disabled) return;
      stopZoom();
    },
    [disabled, stopZoom],
  );

  useEffect(
    () => () => {
      /*
        A touch surface can unmount during orientation changes or fullscreen
        close while a pointer is still down. Explicitly clear zoom here because
        an unmounted DOM node cannot deliver its pointerup/pointercancel event.
      */
      setCameraAxisIntent(0);
    },
    [setCameraAxisIntent],
  );

  return (
    <div className="mobile-touch-control grid grid-cols-2 gap-0.5 text-sm">
      <button
        type="button"
        className="mobile-touch-control button-dark min-h-10 text-xs disabled:opacity-50"
        disabled={disabled}
        onPointerDown={startZoom(-1)}
        onPointerUp={stopFromPointer}
        onPointerCancel={stopFromPointer}
        onLostPointerCapture={stopFromPointer}
        onContextMenu={(event) => event.preventDefault()}
      >
        Zoom out
      </button>
      <button
        type="button"
        className="mobile-touch-control button-dark min-h-10 text-xs disabled:opacity-50"
        disabled={disabled}
        onPointerDown={startZoom(1)}
        onPointerUp={stopFromPointer}
        onPointerCancel={stopFromPointer}
        onLostPointerCapture={stopFromPointer}
        onContextMenu={(event) => event.preventDefault()}
      >
        Zoom in
      </button>
    </div>
  );
}

function PtzMobileControlsPanel({ disabled = false }) {
  return (
    <div className="mobile-touch-control space-y-0.5">
      <PtzMobileZoomButtons disabled={disabled} />
      <div className="mobile-touch-control h-44 min-h-0">
        {/*
          Reuse the rover control pad so touch intent still enters the normal
          control system. The PTZ adapter translates that same drive vector into
          pan/tilt commands only while this user is the PTZ operator.
        */}
        <ControlPadPanel compact disabled={disabled} />
      </div>
      <PtzLightingControls disabled={disabled} />
    </div>
  );
}

function PtzControlReference() {
  const rows = [
    ['Tilt up', 'driveForward'],
    ['Tilt down', 'driveBackward'],
    ['Pan left', 'driveLeft'],
    ['Pan right', 'driveRight'],
    ['Zoom in', 'cameraUp'],
    ['Zoom out', 'cameraDown'],
    ['Spotlight', 'headlightToggle'],
    ['Infrared mode', 'laserToggle'],
  ];

  return (
    <CardFrame title="Controls" bodyClassName="space-y-0.5 p-1 text-xs">
      {rows.map(([label, actionId]) => (
        <div key={label} className="surface flex items-center justify-between gap-1">
          <span className="text-slate-400">{label}</span>
          <KeyPill label={<ControlHint actionId={actionId} />} />
        </div>
      ))}
    </CardFrame>
  );
}

export { PtzLightingControls, PtzMobileZoomButtons, PtzMobileControlsPanel, PtzControlReference };
