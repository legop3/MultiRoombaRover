import TelemetryPanel from './TelemetryPanel.jsx';
import DrivePanel from './DrivePanel.jsx';
import CameraServoPanel from './CameraServoPanel.jsx';
import RoomCameraPanel from './RoomCameraPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import HelpPanel from './HelpPanel.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './Tabs.jsx';

function RoomControlsPlaceholder() {
  return (
    <div className="rounded-sm bg-[#242a32] p-1 text-sm text-slate-100">
      <p className="text-xs text-slate-400">Room controls</p>
      <p className="text-sm text-slate-200">Coming soon: lighting, docks, and environmental toggles.</p>
    </div>
  );
}

export default function RightPaneTabs({ layout }) {
  return (
    <section className="rounded-sm bg-[#1a1d23] p-1 text-base text-slate-100">
      <Tabs defaultTab="telemetry">
        <TabList>
          <Tab id="telemetry">Rover Controls</Tab>
          <Tab id="room">Room Controls</Tab>
          <Tab id="settings">Settings</Tab>
          <Tab id="help">Help</Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="telemetry">
            <div className="space-y-1">
              <DrivePanel />
              <CameraServoPanel />
              <TelemetryPanel />
            </div>
          </TabPanel>
          <TabPanel id="room">
            <div className="space-y-1">
              <RoomCameraPanel />
              <RoomControlsPlaceholder />
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
