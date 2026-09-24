import { FaLightbulb, FaEye } from 'react-icons/fa';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import ControlHint from '../../components/ControlHint/index.jsx';
import PeripheralPod from '../../components/HudOverlays/newgen/CornerPods/PeripheralPod.jsx';
import RoundControl from '../../components/HudOverlays/newgen/CornerPods/RoundControl.jsx';
import usePodVisibility from '../../components/HudOverlays/newgen/CornerPods/usePodVisibility.js';

export default function PtzLightingPod() {
  const [open, setOpen] = usePodVisibility('ptzLighting', true);
  const { setHeadlight, setLaser } = useControlActions();
  const canControl = useControlSelector((control) => control.ptzControls.isActive);
  const { spotlightOn, irMode, pending } = useControlSelector((control) => control.ptzControls.lighting);
  return (
    <PeripheralPod open={open} onOpenChange={setOpen} label="camera lights" className="h-24 w-44">
      <RoundControl label="Spotlight" icon={FaLightbulb} keyLabel={<ControlHint actionId="headlightToggle" />} active={spotlightOn} disabled={!canControl || pending.spotlight} onClick={() => setHeadlight(!spotlightOn)} className="absolute left-5 top-1" />
      <RoundControl label={`Infrared: ${irMode}`} icon={FaEye} value={irMode} keyLabel={<ControlHint actionId="laserToggle" />} active={irMode === 'On'} disabled={!canControl || pending.ir} onClick={() => setLaser()} className="absolute right-1 bottom-1" />
    </PeripheralPod>
  );
}
