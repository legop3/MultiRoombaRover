// Bottom-left Corner Pod
// Purpose: Presents only the assigned rover's available physical light, laser, and horn controls.
import { useRef } from 'react';
import { FaBullhorn, FaCrosshairs, FaLightbulb } from 'react-icons/fa';
import { useControlActions, useControlSelector } from '../../../../controls/index.js';
import ControlHint from '../../../ControlHint/index.jsx';
import { useSessionSelector } from '../../../../context/SessionContext.jsx';
import useCanControlRover from '../../../../hooks/useCanControlRover.js';
import RoundControl from './RoundControl.jsx';
import PeripheralPod from './PeripheralPod.jsx';
import HornSettingsExpansion from './HornSettingsExpansion.jsx';
import usePodVisibility from './usePodVisibility.js';

export default function BottomLeftPod({ roverId }) {
  const [open, setOpen] = usePodVisibility('peripherals', true);
  const [hornSettingsOpen, setHornSettingsOpen] = usePodVisibility('hornSettings', false);
  const roomLightsLockedOn = useSessionSelector(
    (state) => Boolean(state.session?.homeAssistant?.lightPolicy?.lockedOn),
  );
  const headlight = useControlSelector((control) => control.pipeline?.headlight);
  const laser = useControlSelector((control) => control.pipeline?.laser);
  const hornDevice = useControlSelector((control) => control.pipeline?.horn);
  const headlightOn = useControlSelector((control) => Boolean(control.pipeline?.headlightState?.headlightOn));
  const laserOn = useControlSelector((control) => Boolean(control.pipeline?.laserState?.laserOn));
  const hornActive = useControlSelector((control) => Boolean(control.state.horn?.active));
  const { setHeadlight, setLaser, startHorn, stopHorn } = useControlActions();
  const canControl = useCanControlRover(roverId);
  const hornPointerRef = useRef(null);
  const available = Boolean(headlight || laser || hornDevice);

  if (!available) return null;
  const startHornPointer = (event) => {
    if (!canControl) return;
    if (hornPointerRef.current != null) return;
    event.preventDefault();
    hornPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    startHorn();
  };
  const stopHornPointer = (event) => {
    if (hornPointerRef.current !== event.pointerId) return;
    hornPointerRef.current = null;
    stopHorn();
  };

  return (
    <>
      <PeripheralPod open={open} onOpenChange={setOpen} label="rover controls">
        {/*
          The horn's center is the origin of an invisible 76px-radius arc. Headlight and laser
          sit at -75 and -15 degrees on either side of that arc's diagonal midpoint. Their
          sixty-degree separation leaves a visible gap between the small circles while keeping
          both controls equally distant from the horn. These explicit positions are the
          rendered result of that geometry, not unrelated visual nudges.
        */}
        {/* Physical rover actions become visibly and behaviorally unavailable
            while another queued driver owns the turn. Pod/settings controls
            remain interactive because they do not mutate rover hardware. */}
        {hornDevice ? <RoundControl label="Horn" icon={FaBullhorn} keyLabel={<ControlHint actionId="hornHonk" />} active={hornActive} tone="horn" disabled={!canControl} large onPointerDown={startHornPointer} onPointerUp={stopHornPointer} className="absolute bottom-1 left-1" /> : null}
        {headlight ? <RoundControl label="Headlight" icon={FaLightbulb} keyLabel={<ControlHint actionId="headlightToggle" />} active={headlightOn} disabled={!canControl} onClick={() => setHeadlight(!headlightOn)} className="absolute left-[1.979rem] top-[0.662rem]" /> : null}
        {/* The room-light lock deliberately blocks laser activation because
            the laser is only intended for use while the room is dark. This
            mirrors the old desktop control's visible disabled state; turn
            ownership remains the other independent control restriction. */}
        {laser ? <RoundControl label="Laser" icon={FaCrosshairs} keyLabel={<ControlHint actionId="laserToggle" />} active={laserOn} disabled={!canControl || roomLightsLockedOn} onClick={() => setLaser(!laserOn)} className="absolute left-[5.338rem] top-[4.021rem]" /> : null}
      </PeripheralPod>
      {hornDevice ? <HornSettingsExpansion open={hornSettingsOpen} onOpenChange={setHornSettingsOpen} /> : null}
    </>
  );
}
