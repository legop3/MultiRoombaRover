// Driver Activities Tab
// Purpose: Owns the shared desktop/mobile ordering of activity cards.
import { TabPanel } from '../../../../../components/Tabs/index.jsx';
import NeatoCard from '../../../../../components/NeatoCard/index.jsx';
import LiftCard from '../../../../../components/LiftCard/index.jsx';
import BalanceBoardPanel from '../../../../../components/BalanceBoardPanel/index.jsx';
import BarcodeGamesPanel from '../../../../../components/BarcodeGamesPanel/index.jsx';
import OdometerPanel from '../../../../../components/OdometerPanel/index.jsx';
import ButtonBoxPanel from '../../../../../components/ButtonBoxPanel/index.jsx';
import KinectPanel from '../../../../../components/KinectPanel/index.jsx';
import FleetReportsCard from '../../../../../components/FleetReportsCard/index.jsx';
import { themeGapClass } from '../../../../../themes/index.js';

export default function ActivitiesTab() {
  return (
    <TabPanel id="activities">
      <div className={`flex flex-col ${themeGapClass}`}>
        <NeatoCard />
        <LiftCard />
        <BalanceBoardPanel />
        <BarcodeGamesPanel />
        <OdometerPanel />
        <ButtonBoxPanel />
        <KinectPanel />
        {/* Fleet reports retains its existing terminal position and self-gate. */}
        <FleetReportsCard />
      </div>
    </TabPanel>
  );
}
