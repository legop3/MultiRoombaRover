// Driver Help Tab
// Purpose: Owns the shared driver help panel placement.
import { TabPanel } from '../../../../../components/Tabs/index.jsx';
import HelpPanel from '../../../../../components/HelpPanel/index.jsx';
import { useOpenDriverHelp } from '../../../DriverHelpContext.jsx';
import { useLayout } from '../../../../LayoutContext.jsx';

export default function HelpTab() {
  const openHelp = useOpenDriverHelp();
  const layout = useLayout();
  return (
    <TabPanel id="help">
      <HelpPanel layout={layout} onOpenOverlay={openHelp} />
    </TabPanel>
  );
}
