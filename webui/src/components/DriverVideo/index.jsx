import { useSessionSelector } from '../../context/SessionContext.jsx';
import RoverMediaPlayer from '../RoverMediaPlayer/index.jsx';
import { useControlSelector } from '../../controls/index.js';
import { useDriverVideoModePolicy } from '../../hooks/useDriverVideoModePolicy.js';
import TurnsOverlay from '../HudOverlays/TurnsOverlay/index.jsx';
import HudOverlay from '../HudOverlays/HudOverlay/index.jsx';
import ManualDockAssistOverlay from '../HudOverlays/ManualDockAssistOverlay/index.jsx';
import RoverDescriptionOverlay from '../HudOverlays/RoverDescriptionOverlay/index.jsx';
import OvercurrentOverlay from '../HudOverlays/OvercurrentOverlay/index.jsx';
import LowBatteryOverlay from '../HudOverlays/LowBatteryOverlay/index.jsx';
import DriverBottomStrip from '../HudOverlays/DriverBottomStrip/index.jsx';
import HudChatInput from '../HudOverlays/HudChatInput/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import EmptyDriverVideoNotice from './EmptyDriverVideoNotice.jsx';

export default function DriverVideo({ layoutFormat = 'desktop' }) {
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const videoMode = useDriverVideoModePolicy(roverId);
  const lastControlIntentAt = useControlSelector((control) => control.state.lastControlIntentAt);

  if (!roverId) {
    return (
      <CardFrame hideHeader className="shrink-0">
        {/* The legacy page keeps its existing muted 4:3 frame while sharing
            the removal-message behavior with the current video surface. */}
        <div className="panel-muted aspect-[4/3]">
          <EmptyDriverVideoNotice />
        </div>
      </CardFrame>
    );
  }

  const mobileHud = layoutFormat !== 'desktop';
  return (
    <CardFrame hideHeader className="shrink-0">
      <div className="flex flex-col gap-0.5">
        <div className="relative w-full overflow-hidden bg-black aspect-[4/3]">
          <RoverMediaPlayer roverId={roverId} videoMode={videoMode} />
          <TurnsOverlay mobileHud={mobileHud} />
          <RoverDescriptionOverlay
            variant="default"
            mobileHud={mobileHud}
            controlIntentAt={lastControlIntentAt}
          />
          <HudOverlay
            layoutFormat={layoutFormat}
            variant="default"
            mobileHud={mobileHud}
            labelScale={1}
          />
          <ManualDockAssistOverlay mobileHud={mobileHud} />
          <HudChatInput compact={mobileHud} />
          <OvercurrentOverlay compact={mobileHud} />
          <LowBatteryOverlay compact={mobileHud} />
        </div>
        <DriverBottomStrip mobileHud={mobileHud} />
      </div>
    </CardFrame>
  );
}
