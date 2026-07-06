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
import { useSharedClock } from '../../hooks/useSharedClock.js';

const REMOVAL_NOTICE_VISIBLE_MS = 2 * 60 * 1000;

function EmptyDriverVideoNotice() {
  const removalNotice = useSessionSelector((state) => state.roverRemovalNotice || null);
  const now = useSharedClock(1000, Boolean(removalNotice?.receivedAt));
  const noticeAgeMs = removalNotice?.receivedAt ? now - removalNotice.receivedAt : Infinity;
  /*
    Removal explanations should feel immediate and contextual. After a short
    window, falling back to the neutral no-rover state avoids showing an old
    moderation/safety message during unrelated later waiting periods.
  */
  const showRemovalNotice = Boolean(removalNotice?.message && noticeAgeMs <= REMOVAL_NOTICE_VISIBLE_MS);
  const title = showRemovalNotice ? removalNotice.title || 'Removed from rover' : 'No rover assigned';
  const message = showRemovalNotice
    ? removalNotice.message
    : 'You are not currently assigned to a rover.';

  return (
    <CardFrame hideHeader className="shrink-0">
      <div className="panel-muted flex aspect-[4/3] items-center justify-center p-4 text-center">
        <div
          className={`mx-auto flex max-w-md flex-col gap-1 rounded border px-4 py-3 ${
            showRemovalNotice
              ? 'border-amber-300/60 bg-amber-950/35 text-amber-50'
              : 'border-slate-700/70 bg-slate-950/35 text-slate-300'
          }`}
        >
          <div className={showRemovalNotice ? 'text-sm font-semibold text-amber-100' : 'text-sm font-semibold text-slate-200'}>
            {title}
          </div>
          <div className={showRemovalNotice ? 'text-sm text-amber-50/90' : 'text-sm text-slate-400'}>
            {message}
          </div>
        </div>
      </div>
    </CardFrame>
  );
}

export default function DriverVideo({ layoutFormat = 'desktop' }) {
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const videoMode = useDriverVideoModePolicy(roverId);
  const lastControlIntentAt = useControlSelector((control) => control.state.lastControlIntentAt);

  if (!roverId) {
    return <EmptyDriverVideoNotice />;
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
