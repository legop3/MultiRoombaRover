import { InlineCameraTilt, RoverRosterPanel } from './ControlSummary.jsx';
import RoomCameraPanel from './RoomCameraPanel.jsx';
import HomeAssistantControls from './HomeAssistantControls.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import HelpPanel from './HelpPanel.jsx';
import ChatPanel from './ChatPanel.jsx';
import UserListPanel, { NicknameLinksPanel } from './UserListPanel.jsx';
import ReplaySourcesPanel from './ReplaySourcesPanel.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './Tabs.jsx';
import TopDownMap from './TopDownMap.jsx';
import DriveDockAction, { useDriveDockState } from './DriveDockAction.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useControlSystem } from '../controls/index.js';

function TopDownMapPanel() {
  const {
    state: { roverId },
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};

  return (
    <section className="panel-section">
      <div className="aspect-square w-full">
        <TopDownMap sensors={sensors} />
      </div>
    </section>
  );
}

function DriveDockPanel() {
  const {
    state: { roverId, keymap },
  } = useControlSystem();
  const driveDockState = useDriveDockState(roverId);
  const hideInlineControls = driveDockState.docked && !driveDockState.driving;

  return (
    <section className="panel-section flex h-full flex-col gap-0.5">
      <DriveDockAction layout="desktop" expand driveDockState={driveDockState} />
      {!hideInlineControls ? <InlineCameraTilt keymap={keymap} /> : null}
    </section>
  );
}

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
              <div className="grid items-stretch gap-0.5 grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
                <TopDownMapPanel />
                <DriveDockPanel />
              </div>
              <div className="grid gap-0.5 grid-cols-[minmax(0,0.6fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <NicknameLinksPanel compact />
                <RoverRosterPanel />
                <ReplaySourcesPanel panelId="replay-sources-desktop" fillHeight />
              </div>
              <div className="grid items-stretch gap-0.5 grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] h-[14rem]">
                <ChatPanel fillHeight />
                <UserListPanel compact hideNicknameForm fillHeight />
              </div>
              <HomeAssistantControls />
              <RoomCameraPanel defaultOrientation="horizontal" panelId="rightpane-telemetry" />
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
