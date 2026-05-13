import RoverMediaPlayer from '../RoverMediaPlayer/index.jsx';
import TurnsOverlay from '../HudOverlays/TurnsOverlay/index.jsx';
import HudOverlay from '../HudOverlays/HudOverlay/index.jsx';
import RoverDescriptionOverlay from '../HudOverlays/RoverDescriptionOverlay/index.jsx';
import OvercurrentOverlay from '../HudOverlays/OvercurrentOverlay/index.jsx';
import LowBatteryOverlay from '../HudOverlays/LowBatteryOverlay/index.jsx';
import DriverBottomStrip from '../HudOverlays/DriverBottomStrip/index.jsx';
import HudChatInput from '../HudOverlays/HudChatInput/index.jsx';

export default function DriverVideo({ layoutFormat = 'desktop' }) {
  const mobileHud = layoutFormat !== 'desktop';
  return (
    <section className="panel">
      <div className="flex flex-col gap-0.5">
        <div className="relative w-full overflow-hidden bg-black aspect-[4/3]">
          <RoverMediaPlayer />
          <TurnsOverlay mobileHud={mobileHud} />
          <RoverDescriptionOverlay
            variant="default"
            mobileHud={mobileHud}
          />
          <HudOverlay
            layoutFormat={layoutFormat}
            variant="default"
            mobileHud={mobileHud}
            labelScale={1}
          />
          <HudChatInput compact={mobileHud} />
          <OvercurrentOverlay compact={mobileHud} />
          <LowBatteryOverlay compact={mobileHud} />
        </div>
        <DriverBottomStrip mobileHud={mobileHud} />
      </div>
    </section>
  );
}
