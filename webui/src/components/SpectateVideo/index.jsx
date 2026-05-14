import RoverMediaPlayer from '../RoverMediaPlayer/index.jsx';
import HudOverlay from '../HudOverlays/HudOverlay/index.jsx';
import RoverDescriptionOverlay from '../HudOverlays/RoverDescriptionOverlay/index.jsx';
import OvercurrentOverlay from '../HudOverlays/OvercurrentOverlay/index.jsx';
import LowBatteryOverlay from '../HudOverlays/LowBatteryOverlay/index.jsx';
import VerticalBatteryOverlay from '../HudOverlays/VerticalBatteryOverlay/index.jsx';

export default function SpectateVideo({
  roverId = null,
  label,
  fitParent = false,
  layoutFormat = 'desktop',
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${fitParent ? 'h-full' : ''}`}>
      <div className={`relative w-full overflow-hidden bg-black ${fitParent ? 'h-full flex-1' : 'aspect-[4/3]'}`}>
        <RoverMediaPlayer
          roverId={roverId}
          label={label}
        />
        <RoverDescriptionOverlay
          roverId={roverId}
          variant="spectator"
          mobileHud={false}
        />
        <HudOverlay
          roverId={roverId}
          layoutFormat={layoutFormat}
          variant="spectator"
          mobileHud={false}
          labelScale={1}
        />
        <OvercurrentOverlay roverId={roverId} compact={false} />
        <LowBatteryOverlay roverId={roverId} compact={false} />
        <VerticalBatteryOverlay show roverId={roverId} mobileHud={false} />
      </div>
    </div>
  );
}
