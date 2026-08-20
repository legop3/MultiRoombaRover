// New Drive Video
// Purpose: Mirrors DriverVideo's ownership by composing media and rover HUD overlays in one stage.
// Scope: Owns the current driver video surface; page columns remain layout concerns.
import RoverMediaPlayer from '../RoverMediaPlayer/index.jsx';
import OvercurrentOverlay from '../HudOverlays/OvercurrentOverlay/index.jsx';
import RoverDescriptionOverlay from '../HudOverlays/RoverDescriptionOverlay/index.jsx';
import CornerPods from '../HudOverlays/newgen/CornerPods/index.jsx';
import DockingHud from '../HudOverlays/newgen/DockingHud/index.jsx';
import WheelDropIndicators from '../HudOverlays/newgen/WheelDropIndicators/index.jsx';
import BottomSensorHud from '../HudOverlays/newgen/BottomSensorHud/index.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useControlSelector } from '../../controls/index.js';
import { useDriverVideoModePolicy } from '../../hooks/useDriverVideoModePolicy.js';
import { useDriverLayout } from '../../layouts/driver/DriverLayoutContext.jsx';
import EmptyDriverVideoNotice from '../DriverVideo/EmptyDriverVideoNotice.jsx';

// Mobile keeps the same HUD composition and coordinate system as desktop, but its
// physically smaller video stage needs the complete interface reduced as one unit.
// Keeping this as one scale value prevents individual pods and sensor layers from
// drifting apart as their responsive behavior evolves.
const MOBILE_HUD_SCALE = 0.68;

export default function NewDriveVideo() {
  const layout = useDriverLayout();
  const mobileHud = layout !== 'desktop';
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const videoMode = useDriverVideoModePolicy(roverId);
  const lastControlIntentAt = useControlSelector((control) => control.state.lastControlIntentAt);

  if (!roverId) {
    return (
      <div
        className={`min-h-0 w-full overflow-hidden bg-black ${mobileHud ? 'aspect-[4/3] shrink-0' : 'h-screen'}`}
        aria-label="No rover assigned"
      >
        {/* Keep the unassigned state inside the same solid video-shaped stage
            so removing a rover does not expose the page background or leave a
            visually empty hole where the live picture had been. */}
        <EmptyDriverVideoNotice />
      </div>
    );
  }

  return (
    <section
      className={`flex min-h-0 w-full items-center overflow-hidden ${mobileHud ? 'shrink-0' : 'h-screen'}`}
      aria-label="Rover video and HUD"
    >
      {/* Media and overlays must share this exact 4:3 containing block. When narrow columns
          reduce the video width, the stage height shrinks with it and no HUD element can remain
          positioned in the letterboxed space above or below the actual picture. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black [&_img]:object-contain [&_video]:object-contain">
        <RoverMediaPlayer roverId={roverId} videoMode={videoMode} />

        <div
          className="pointer-events-none absolute left-0 top-0 z-30 h-full w-full origin-top-left"
          style={mobileHud ? {
            /* The inverse logical dimensions exactly cancel the visual scale. An item
               anchored at right: 0 or bottom: 0 therefore still lands on the real video
               edge instead of floating inward after the layer is reduced. */
            width: `${100 / MOBILE_HUD_SCALE}%`,
            height: `${100 / MOBILE_HUD_SCALE}%`,
            transform: `scale(${MOBILE_HUD_SCALE})`,
          } : undefined}
        >
          {/* Mobile already owns its physical rover controls outside the video. Keep the
              informational HUD and chat, but do not duplicate those controls in corner pods. */}
          <CornerPods roverId={roverId} />
          <DockingHud roverId={roverId} />
          <WheelDropIndicators roverId={roverId} />
          <BottomSensorHud roverId={roverId} />

          {/* Overcurrent remains a stage-wide safety condition. Battery warnings are intentionally
              owned by the top-right battery pod so they stay connected to their source and can
              account for whether the rover is driving, docking, or already charging. */}
          <OvercurrentOverlay roverId={roverId} compact={mobileHud} />
          <RoverDescriptionOverlay roverId={roverId} mobileHud={mobileHud} controlIntentAt={lastControlIntentAt} />
        </div>
      </div>
    </section>
  );
}
