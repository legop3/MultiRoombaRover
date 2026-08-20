// Bottom-left Corner Pod
// Purpose: Presents only the assigned rover's available physical light, laser, and horn controls.
import { useRef } from 'react';
import { FaBullhorn, FaCrosshairs, FaLightbulb } from 'react-icons/fa';
import { useControlActions, useControlSelector } from '../../../../controls/index.js';
import { formatKeyLabel } from '../../../../controls/keymapUtils.js';
import { useSessionSelector } from '../../../../context/SessionContext.jsx';
import useCanControlRover from '../../../../hooks/useCanControlRover.js';
import KeyPill from '../../../vip/VipAudioUploadCard/KeyPill.jsx';
import HornSettingsExpansion from './HornSettingsExpansion.jsx';
import CornerPodToggle from './CornerPodToggle.jsx';
import usePodVisibility from './usePodVisibility.js';

function RoundControl({ label, icon, keyLabel, active, tone, disabled = false, onClick, onPointerDown, onPointerUp, large = false, className = '' }) {
  const ControlIcon = icon;
  const toneClass = tone === 'horn'
    ? active ? 'border-fuchsia-300/70 bg-fuchsia-700 text-fuchsia-50' : 'border-cyan-300/70 bg-cyan-900 text-cyan-50'
    : active ? 'border-emerald-300/70 bg-emerald-800 text-emerald-50' : 'border-amber-300/70 bg-amber-900 text-amber-50';
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`flex shrink-0 select-none flex-col items-center justify-center gap-1 rounded-full border-2 ${toneClass} ${large ? 'h-20 w-20' : 'h-16 w-16'} disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <ControlIcon className={large ? 'text-xl' : 'text-base'} aria-hidden="true" />
      <KeyPill label={keyLabel} />
    </button>
  );
}

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
  const keymap = useControlSelector((control) => control.state.keymap);
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
      {open ? (
        <div className="pointer-events-auto absolute bottom-0 left-0 z-20 h-40 w-40 rounded-tr-[4.25rem] bg-black/60">
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
          {hornDevice ? <RoundControl label="Horn" icon={FaBullhorn} keyLabel={formatKeyLabel(keymap?.hornHonk?.[0])} active={hornActive} tone="horn" disabled={!canControl} large onPointerDown={startHornPointer} onPointerUp={stopHornPointer} className="absolute bottom-1 left-1" /> : null}
          {headlight ? <RoundControl label="Headlight" icon={FaLightbulb} keyLabel={formatKeyLabel(keymap?.headlightToggle?.[0])} active={headlightOn} disabled={!canControl} onClick={() => setHeadlight(!headlightOn)} className="absolute left-[1.979rem] top-[0.662rem]" /> : null}
          {/* The room-light lock deliberately blocks laser activation because
              the laser is only intended for use while the room is dark. This
              mirrors the old desktop control's visible disabled state; turn
              ownership remains the other independent control restriction. */}
          {laser ? <RoundControl label="Laser" icon={FaCrosshairs} keyLabel={formatKeyLabel(keymap?.laserToggle?.[0])} active={laserOn} disabled={!canControl || roomLightsLockedOn} onClick={() => setLaser(!laserOn)} className="absolute left-[5.338rem] top-[4.021rem]" /> : null}
          <CornerPodToggle corner="bottom-left" expanded label="Hide rover controls" onClick={() => setOpen(false)} />
        </div>
      ) : (
        <CornerPodToggle corner="bottom-left" expanded={false} label="Show rover controls" onClick={() => setOpen(true)} />
      )}
      {hornDevice ? <HornSettingsExpansion open={hornSettingsOpen} onOpenChange={setHornSettingsOpen} /> : null}
    </>
  );
}
