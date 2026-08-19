// Old Desktop Driver Layout
// Purpose: Preserves the retired two-pane desktop composition for the explicit /old route.
// Scope: This is a layout archive only; shared controls, telemetry, and route-level providers stay current.
import DriverVideo from '../../../components/DriverVideo/index.jsx';
import PiHostStatsCard from '../../../components/PiHostStatsCard/index.jsx';
import DriverAdCard from '../../../components/DriverAdCard/index.jsx';
import GlobalObjectiveBanner from '../../../components/GlobalObjectiveBanner/index.jsx';
import { themeGapClass } from '../../../themes/index.js';
import DesktopRightPaneTabs from '../DesktopRightPaneTabs/index.jsx';
import { useTelemetryVisualPolicy } from '../../../context/TelemetryContext.jsx';

export default function OldDesktopLayout() {
  // The archived layout keeps the same desktop telemetry cadence it used before
  // replacement, while mobile policy remains owned by the mobile layout frame.
  useTelemetryVisualPolicy({ mobile: false });

  return (
    <div className={`flex h-screen ${themeGapClass} overflow-hidden`}>
      <div className={`flex min-w-0 flex-[1.22] flex-col ${themeGapClass} overflow-y-auto pr-0`}>
        <DriverVideo />
        <PiHostStatsCard />
        {/* The self-gating ad remains pinned to the bottom of the left pane. */}
        <DriverAdCard className="mt-auto" />
      </div>
      <div className={`flex min-w-0 flex-1 flex-col ${themeGapClass} overflow-y-auto`}>
        <GlobalObjectiveBanner layout="desktop" />
        <DesktopRightPaneTabs />
      </div>
    </div>
  );
}
