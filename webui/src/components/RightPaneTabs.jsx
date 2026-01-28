import { InlineCameraTilt } from './ControlSummary.jsx';
import RoomCameraPanel from './RoomCameraPanel.jsx';
import HomeAssistantControls from './HomeAssistantControls.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import HelpPanel from './HelpPanel.jsx';
import ChatPanel from './ChatPanel.jsx';
import { LinkButtonsPanel, NicknameEntryPanel } from './UserListPanel.jsx';
import ReplaySourcesPanel from './ReplaySourcesPanel.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './Tabs.jsx';
import TopDownMap from './TopDownMap.jsx';
import DriveDockAction, { useDriveDockState } from './DriveDockAction.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useControlSystem } from '../controls/index.js';
import RoverQueuesPanel from './RoverQueuesPanel.jsx';
import RawUserPilePanel from './RawUserPilePanel.jsx';

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
      <DriveDockAction layout="desktop" expand={hideInlineControls} driveDockState={driveDockState} />
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
              <div className="grid gap-0.5 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.75fr)]">
                <RoverQueuesPanel />
                <ReplaySourcesPanel panelId="replay-sources-desktop" fillHeight />
                <LinkButtonsPanel />
              </div>
              <div className="grid items-stretch gap-0.5 grid-cols-[minmax(0,1.3fr)_minmax(0,0.22fr)] h-[14rem]">
                <ChatPanel fillHeight />
                <div className="grid min-h-0 gap-0.5 grid-rows-[minmax(0,1fr)_auto]">
                  <RawUserPilePanel compact hideNicknameForm fillHeight />
                  <NicknameEntryPanel compact />
                </div>
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
