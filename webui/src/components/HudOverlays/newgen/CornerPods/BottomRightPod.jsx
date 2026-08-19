// Bottom-right Corner Pod
// Purpose: Provides a compact circular camera-tilt control using the existing servo command path.
import { useCallback } from 'react';
import { FaVideo } from 'react-icons/fa';
import { useControlActions, useControlSelector } from '../../../../controls/index.js';
import { formatKeyLabel } from '../../../../controls/keymapUtils.js';
import useCanControlRover from '../../../../hooks/useCanControlRover.js';
import { useDriverLayout } from '../../../../layouts/driver/DriverLayoutContext.jsx';
import KeyPill from '../../../vip/VipAudioUploadCard/KeyPill.jsx';
import ChatExpansion from './ChatExpansion.jsx';
import CornerPodToggle from './CornerPodToggle.jsx';
import usePodVisibility from './usePodVisibility.js';

const ARC_CENTER = 72;
const ARC_RADIUS = 60;
const ARC_START_DEGREES = 105;
const ARC_SWEEP_DEGREES = 240;

function pointOnArc(fraction) {
  // The unused third is centered on the physical bottom-right screen corner. Starting at
  // 105 degrees and sweeping clockwise to 345 degrees leaves that exact corner-facing gap.
  const degrees = ARC_START_DEGREES + fraction * ARC_SWEEP_DEGREES;
  const radians = (degrees * Math.PI) / 180;
  return {
    x: ARC_CENTER + Math.cos(radians) * ARC_RADIUS,
    y: ARC_CENTER + Math.sin(radians) * ARC_RADIUS,
  };
}

export default function BottomRightPod({ roverId }) {
  const layout = useDriverLayout();
  const [open, setOpen] = usePodVisibility('camera', true);
  const camera = useControlSelector((control) => control.state.camera);
  const dockAssistActive = useControlSelector((control) => Boolean(control.state.manualDockAssist?.active));
  const keymap = useControlSelector((control) => control.state.keymap);
  const { setServoAngle } = useControlActions();
  const canControl = useCanControlRover(roverId);
  const config = camera?.config;
  const enabled = Boolean(roverId && camera?.enabled && config);
  const min = Number(config?.minAngle);
  const max = Number(config?.maxAngle);
  const value = Number.isFinite(camera?.angle) ? camera.angle : Number(config?.homeAngle) || 0;
  const fraction = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  const knob = pointOnArc(fraction);
  // Keep this derived state in one place because it also tells the independent chat
  // expansion whether it must offset itself above a visible camera-control pod.
  const showCameraControls = layout === 'desktop';
  const cameraPodOpen = showCameraControls && enabled && open;

  const updateFromPointer = useCallback((event) => {
    if (!canControl || !enabled || dockAssistActive || !(max > min)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 144;
    const y = ((event.clientY - bounds.top) / bounds.height) * 144;
    const pointerDegrees = ((Math.atan2(y - ARC_CENTER, x - ARC_CENTER) * 180) / Math.PI + 360) % 360;
    let arcDegrees = (pointerDegrees - ARC_START_DEGREES + 360) % 360;
    if (arcDegrees > ARC_SWEEP_DEGREES) {
      /*
        Pointer input inside the open corner-facing third is outside the slider. Snap it to
        whichever visible endpoint is closer so the gap remains visually and behaviorally open.
      */
      const distanceFromEnd = arcDegrees - ARC_SWEEP_DEGREES;
      const distanceFromStart = 360 - arcDegrees;
      arcDegrees = distanceFromStart < distanceFromEnd ? 0 : ARC_SWEEP_DEGREES;
    }
    const nextFraction = arcDegrees / ARC_SWEEP_DEGREES;
    setServoAngle(min + nextFraction * (max - min));
  }, [canControl, dockAssistActive, enabled, max, min, setServoAngle]);

  return (
    <>
    {cameraPodOpen ? (
    <div className="pointer-events-auto absolute bottom-0 right-0 z-20 flex h-[8.5rem] w-[8.5rem] items-center justify-center rounded-tl-[4.25rem] bg-black/60">
      {/* The pod shell and its visibility toggle stay usable while waiting, but
          every camera mutation is blocked and visibly muted until control returns. */}
      <svg viewBox="0 0 144 144" aria-disabled={!canControl} className={`h-[8.5rem] w-[8.5rem] touch-none ${canControl ? '' : 'pointer-events-none opacity-40'}`} onPointerDown={updateFromPointer} onPointerMove={(event) => { if (event.buttons) updateFromPointer(event); }}>
        <path d="M 56.47 129.96 A 60 60 0 1 1 129.96 56.47" pathLength="1" fill="none" stroke="#064e3b" strokeWidth="12" strokeLinecap="round" />
        <path d="M 56.47 129.96 A 60 60 0 1 1 129.96 56.47" pathLength="1" fill="none" stroke="#34d399" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${fraction} 1`} />
        <circle cx={knob.x} cy={knob.y} r="7" fill="#ecfdf5" stroke="#059669" strokeWidth="3" />
      </svg>
      <button type="button" aria-label="Reset camera tilt" disabled={!canControl} onClick={() => setServoAngle(0)} className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded bg-black/55 px-1.5 py-1 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
        {/* The icon/value stack mirrors the battery pod and clarifies that this
            circular gauge changes the live rover camera's tilt angle. */}
        <FaVideo className="text-base" aria-hidden="true" />
        <span className="text-sm leading-none">{value.toFixed(1)}°</span>
      </button>
      {/* These positions continue around the same circle just beyond the two slider endpoints.
          Together they occupy the open third facing the corner without enlarging the pod. */}
      <div className="absolute left-[61%] top-[90%] -translate-x-1/2 -translate-y-1/2"><KeyPill label={formatKeyLabel(keymap?.cameraDown?.[0])} /></div>
      <div className="absolute left-[90%] top-[61%] -translate-x-1/2 -translate-y-1/2"><KeyPill label={formatKeyLabel(keymap?.cameraUp?.[0])} /></div>
      <CornerPodToggle corner="bottom-right" expanded label="Hide camera tilt" onClick={() => setOpen(false)} />
    </div>
    ) : showCameraControls && enabled ? (
      <CornerPodToggle corner="bottom-right" expanded={false} label="Show camera tilt" onClick={() => setOpen(true)} />
    ) : null}
    {/* Chat is an independent expansion. It remains usable even when this rover
        has no camera-servo configuration or the camera pod is collapsed. */}
    <ChatExpansion podOpen={cameraPodOpen} />
    </>
  );
}
