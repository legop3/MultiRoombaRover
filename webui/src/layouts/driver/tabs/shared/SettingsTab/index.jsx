// Driver Settings Tab
// Purpose: Owns the shared driver settings panel placement.
import { TabPanel } from '../../../../../components/Tabs/index.jsx';
import SettingsPanel from '../../../../../components/SettingsPanel/index.jsx';
import { themeStackClass } from '../../../../../themes/index.js';
import { useDriverLayout } from '../../../DriverLayoutContext.jsx';

export default function SettingsTab() {
  const layout = useDriverLayout();
  const wrapped = layout !== 'desktop';
  return (
    <TabPanel id="settings">
      {wrapped ? <div className={themeStackClass}><SettingsPanel /></div> : <SettingsPanel />}
    </TabPanel>
  );
}
