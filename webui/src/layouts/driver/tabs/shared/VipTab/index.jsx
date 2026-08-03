// Driver VIP Tab
// Purpose: Owns the shared keep-mounted VIP panel lifecycle.
import { TabPanel, useTabIsActive } from '../../../../../components/Tabs/index.jsx';
import VipPanel from '../../../../../components/VipPanel/index.jsx';
import { useDriverLayout } from '../../../DriverLayoutContext.jsx';

export default function VipTab() {
  const layout = useDriverLayout();
  const isActive = useTabIsActive('vip');
  return (
    <TabPanel id="vip" keepMounted>
      <VipPanel isActive={isActive} layout={layout} />
    </TabPanel>
  );
}
