// Desktop Driver Layout
// Purpose: Places existing site columns around the full-height rover video and integrated HUD.
// Scope: Owns the default desktop composition only; video and HUD behavior remain component concerns.
import NewDriveVideo from '../../../components/NewDriveVideo/index.jsx';
import ChatPanel from '../../../components/ChatPanel/index.jsx';
import RawUserPilePanel from '../../../components/RawUserPilePanel/index.jsx';
import RoverQueuesPanel from '../../../components/RoverQueuesPanel/index.jsx';
import ReplaySourcesPanel from '../../../components/ReplaySourcesPanel/index.jsx';
import HomeAssistantControls from '../../../components/HomeAssistantControls/index.jsx';
import RoomCameraPanel from '../../../components/RoomCameraPanel/index.jsx';
import GlobalObjectiveBanner from '../../../components/GlobalObjectiveBanner/index.jsx';
import DriverAdCard from '../../../components/DriverAdCard/index.jsx';
import OverseerPreferencePanel from '../../../components/OverseerPreferencePanel/index.jsx';
import PtzQueueCard from '../../../components/PtzCamera/index.jsx';
import { LinkButtonsPanel } from '../../../components/UserListPanel/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from '../../../components/Tabs/index.jsx';
import ActivitiesTab from '../tabs/shared/ActivitiesTab/index.jsx';
import VipTab from '../tabs/shared/VipTab/index.jsx';
import VipTabButton from '../tabs/shared/VipTabButton/index.jsx';
import HelpTab from '../tabs/shared/HelpTab/index.jsx';
import SettingsTab from '../tabs/shared/SettingsTab/index.jsx';
import { themeGapClass } from '../../../themes/index.js';

function LeftColumnTabs() {
  return (
    <Tabs defaultTab="room">
      <TabList className="sticky top-0 z-30 shrink-0 bg-neutral-950">
        <Tab id="room">Room</Tab>
        <Tab id="activities">Activities</Tab>
        <VipTabButton />
      </TabList>
      <TabPanels>
        <TabPanel id="room">
          <div className={`flex flex-col ${themeGapClass}`}>
            {/* The objective belongs below the selector so the tab bar remains the first visible,
                sticky control at the top of the independently scrolling left column. */}
            <GlobalObjectiveBanner layout="desktop" />
            <HomeAssistantControls />
            <RoomCameraPanel defaultOrientation="vertical" panelId="newdrive-left-sidebar" />
          </div>
        </TabPanel>
        {/* These shared tabs retain their existing feature gates and mounted-media behavior. */}
        <ActivitiesTab />
        <VipTab />
      </TabPanels>
    </Tabs>
  );
}

function CommunityColumn() {
  return (
    <div className={`flex flex-col ${themeGapClass}`}>
      {/* A fixed initial chat height keeps the composer usable in a narrow column. The sidebar
          itself scrolls, so every rover/site panel below remains reachable on a 720p display. */}
      <div className="h-80 min-h-56">
        <ChatPanel fillHeight />
      </div>
      <OverseerPreferencePanel />
      <ReplaySourcesPanel panelId="newdrive-replay-sources" />
      <RoverQueuesPanel title="Rovers" />
      <RawUserPilePanel compact hideNicknameForm />
      <LinkButtonsPanel fillHeight={false} />
      <PtzQueueCard layout="desktop" />
    </div>
  );
}

function RightColumnTabs() {
  return (
    <Tabs defaultTab="community">
      <TabList className="sticky top-0 z-30 shrink-0 bg-neutral-950">
        <Tab id="community">Chat/Rovers</Tab>
        <Tab id="help">Help</Tab>
        <Tab id="settings">Settings</Tab>
      </TabList>
      <TabPanels>
        <TabPanel id="community">
          <CommunityColumn />
        </TabPanel>
        <HelpTab />
        <SettingsTab />
      </TabPanels>
    </Tabs>
  );
}

export default function DesktopLayout() {
  return (
    /* Equal 17rem minimums keep reused site cards usable on a 1280px desktop.
       The center track deliberately retains a zero minimum so the 4:3 video,
       rather than either sidebar, gives up width when the viewport is tight. */
    <div
      className={`grid h-screen min-w-0 w-full grid-cols-[minmax(17rem,1fr)_minmax(0,133.333vh)_minmax(17rem,1fr)] overflow-hidden ${themeGapClass}`}
    >
      <aside
        className={`flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto ${themeGapClass}`}
        aria-label="Room, activities, and site information"
      >
        <LeftColumnTabs />
        <DriverAdCard className="mt-auto" />
      </aside>

      <NewDriveVideo />

      <aside
        className={`flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto ${themeGapClass}`}
        aria-label="Chat, rovers, help, and settings"
      >
        <RightColumnTabs />
      </aside>
    </div>
  );
}
