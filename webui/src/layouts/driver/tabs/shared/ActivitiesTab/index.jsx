// Driver Activities Tab
// Purpose: Owns the shared desktop/mobile ordering of activity cards.
import { TabPanel } from '../../../../../components/Tabs/index.jsx';
import HomeAssistantActivitiesPanel from '../../../../../components/HomeAssistantActivitiesPanel/index.jsx';
import NeatoCard from '../../../../../components/NeatoCard/index.jsx';
import LiftCard from '../../../../../components/LiftCard/index.jsx';
import BalanceBoardPanel from '../../../../../components/BalanceBoardPanel/index.jsx';
import BarcodeGamesPanel from '../../../../../components/BarcodeGamesPanel/index.jsx';
import OdometerPanel from '../../../../../components/OdometerPanel/index.jsx';
import ButtonBoxPanel from '../../../../../components/ButtonBoxPanel/index.jsx';
import KinectPanel from '../../../../../components/KinectPanel/index.jsx';
import FleetReportsCard from '../../../../../components/FleetReportsCard/index.jsx';
import { themeGapClass } from '../../../../../themes/index.js';
import { useDriverLayout } from '../../../DriverLayoutContext.jsx';

export default function ActivitiesTab() {
  const layout = useDriverLayout();
  return (
    <TabPanel id="activities">
      <div className={`flex flex-col ${layout === 'desktop' ? 'gap-y-2' : themeGapClass}`}>
        <NeatoCard />
        <LiftCard />
        <HomeAssistantActivitiesPanel />
        <BalanceBoardPanel />
        <BarcodeGamesPanel />
        <OdometerPanel />
        <ButtonBoxPanel />
        <KinectPanel />
        <FleetReportsCard />
      </div>
    </TabPanel>
  );
}
