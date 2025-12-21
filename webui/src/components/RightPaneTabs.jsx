import TelemetryPanel from './TelemetryPanel.jsx';
import ControlSummary from './ControlSummary.jsx';
import RoomCameraPanel from './RoomCameraPanel.jsx';
import HomeAssistantControls from './HomeAssistantControls.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import HelpPanel from './HelpPanel.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './Tabs.jsx';

export default function RightPaneTabs({ layout, onOpenHelpOverlay }) {
  return (
    <section className="panel text-base">
      <Tabs defaultTab="telemetry">
        <TabList>
          <Tab id="telemetry">Controls</Tab>
          <Tab id="help">Help</Tab>
          <Tab id="settings">Settings</Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="telemetry">
            <div className="space-y-0.5">
              <ControlSummary />
              <RoomCameraPanel defaultOrientation="horizontal" panelId="rightpane-telemetry" />
              <HomeAssistantControls />
              <TelemetryPanel />
            </div>
          </TabPanel>
          <TabPanel id="help">
            <HelpPanel layout={layout} onOpenOverlay={onOpenHelpOverlay} />
          </TabPanel>
          <TabPanel id="settings">
            <SettingsPanel />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}
