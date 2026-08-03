// Mobile Room Controls Tab
// Purpose: Owns the concrete mobile room-controls card order.
import { TabPanel } from '../../../../../components/Tabs/index.jsx';
import HomeAssistantControls from '../../../../../components/HomeAssistantControls/index.jsx';
import RoomCameraPanel from '../../../../../components/RoomCameraPanel/index.jsx';
import { themeStackClass } from '../../../../../themes/index.js';
import { useDriverLayout } from '../../../DriverLayoutContext.jsx';

export default function RoomControlsTab() {
  const layout = useDriverLayout();
  const panelId = layout === 'mobile-landscape' ? 'mobile-landscape-room' : 'mobile-portrait-room';
  return (
    <TabPanel id="roomcontrols">
      <div className={themeStackClass}>
        <HomeAssistantControls />
        <RoomCameraPanel panelId={panelId} />
      </div>
    </TabPanel>
  );
}
