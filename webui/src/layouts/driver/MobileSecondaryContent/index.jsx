// Mobile Driver Secondary Content
// Purpose: Owns the identical replay, queue, tabs, and terminal-ad composition used by both mobile layouts.
import DriverAdCard from '../../../components/DriverAdCard/index.jsx';
import PtzQueueCard from '../../../components/PtzCamera/index.jsx';
import ReplaySourcesPanel from '../../../components/ReplaySourcesPanel/index.jsx';
import RoverQueuesPanel from '../../../components/RoverQueuesPanel/index.jsx';
import { themeGapClass } from '../../../themes/index.js';
import { useDriverLayout } from '../DriverLayoutContext.jsx';
import MobileTabs from '../MobileTabs/index.jsx';

export default function MobileSecondaryContent() {
  const layout = useDriverLayout();
  const portrait = layout === 'mobile-portrait';
  const replayPanelId = portrait
    ? 'replay-sources-mobile-portrait'
    : 'replay-sources-mobile-landscape';

  return (
    <div className={`mobile-content-snap flex flex-col ${themeGapClass} ${portrait ? '' : 'pb-0'}`}>
      <div className={`grid ${themeGapClass} grid-cols-2`}>
        <div className="space-y-0.5">
          <ReplaySourcesPanel panelId={replayPanelId} />
          <PtzQueueCard layout={layout} />
        </div>
        <RoverQueuesPanel />
      </div>
      <MobileTabs />
      <DriverAdCard />
    </div>
  );
}
