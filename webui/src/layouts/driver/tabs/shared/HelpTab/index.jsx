// Driver Help Tab
// Purpose: Owns the shared driver help panel placement.
import { TabPanel } from '../../../../../components/Tabs/index.jsx';
import HelpPanel from '../../../../../components/HelpPanel/index.jsx';
import { useOpenDriverHelp } from '../../../DriverLayoutContext.jsx';
import { useDriverLayout } from '../../../DriverLayoutContext.jsx';

export default function HelpTab() {
  const openHelp = useOpenDriverHelp();
  const layout = useDriverLayout();
  return (
    <TabPanel id="help">
      <HelpPanel layout={layout} onOpenOverlay={openHelp} />
    </TabPanel>
  );
}
