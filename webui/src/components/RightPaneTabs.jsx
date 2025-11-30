import TelemetryPanel from './TelemetryPanel.jsx';
import DrivePanel from './DrivePanel.jsx';
import CameraServoPanel from './CameraServoPanel.jsx';
import RoomCameraPanel from './RoomCameraPanel.jsx';
import HomeAssistantControls from './HomeAssistantControls.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import HelpPanel from './HelpPanel.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './Tabs.jsx';

export default function RightPaneTabs({ layout }) {
  return (
    <section className="panel text-base">
      <Tabs defaultTab="telemetry">
        <TabList>
          <Tab id="telemetry">Rover Controls</Tab>
          <Tab id="room">Room Controls</Tab>
          <Tab id="settings">Settings</Tab>
          <Tab id="help">Help</Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="telemetry">
            <div className="space-y-0.5">
              <DrivePanel />
              <RoomCameraPanel defaultOrientation="horizontal" panelId="rightpane-telemetry" />
              <TelemetryPanel />
              <CameraServoPanel />
            </div>
          </TabPanel>
          <TabPanel id="room">
            <div className="space-y-0.5">
              <RoomCameraPanel defaultOrientation="vertical" panelId="rightpane-room" />
              <HomeAssistantControls />
            </div>
          </TabPanel>
          <TabPanel id="settings">
            <SettingsPanel />
          </TabPanel>
          <TabPanel id="help">
            <HelpPanel layout={layout} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}
