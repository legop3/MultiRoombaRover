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
import { formatKeyLabel } from '../controls/keymapUtils.js';
import NightVisionControl from './NightVisionControl.jsx';
import HornControl from './HornControl.jsx';
import CameraTiltControl from './CameraTiltControl.jsx';
import VipPanel from './VipPanel.jsx';
import { useSession } from '../context/SessionContext.jsx';

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
    state: { roverId, keymap, camera, horn },
    pipeline,
    actions: { setServoAngle, setNightVision, startHorn, stopHorn },
  } = useControlSystem();
  const driveDockState = useDriveDockState(roverId);
  const hideInlineControls = driveDockState.docked && !driveDockState.driving;

  const config = camera?.config;
  const cameraEnabled = Boolean(roverId && camera?.enabled && config);
  const nightVisionAvailable = Boolean(roverId && pipeline?.nightVision);
  const nightVisionState = pipeline?.nightVisionState;
  const hornAvailable = Boolean(roverId && pipeline?.horn);
  const hornBlocked = horn?.overheated;
  const min = typeof config?.minAngle === 'number' ? config.minAngle : -30;
  const max = typeof config?.maxAngle === 'number' ? config.maxAngle : 30;
  const value =
    typeof camera?.angle === 'number'
      ? camera.angle
      : typeof config?.homeAngle === 'number'
        ? config.homeAngle
        : (min + max) / 2;
  const nightVisionLabel = formatKeyLabel(keymap?.nightVisionToggle?.[0]);
  const hornLabel = formatKeyLabel(keymap?.hornHonk?.[0]);
  const upLabel = formatKeyLabel(keymap?.cameraUp?.[0]);
  const downLabel = formatKeyLabel(keymap?.cameraDown?.[0]);

  return (
    <section className="panel-section grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-0.5">
      <DriveDockAction layout="desktop" expand driveDockState={driveDockState} />
      {!hideInlineControls ? (
        <div className="surface space-y-0.5 p-0 text-sm text-slate-200">
          {nightVisionAvailable && (
            <NightVisionControl
              nightVisionOn={nightVisionState?.nightVisionOn}
              disabled={!roverId}
              onToggle={setNightVision}
              keyLabel={nightVisionLabel}
            />
          )}
          {hornAvailable && (
            <HornControl
              disabled={!roverId || hornBlocked}
              onStart={startHorn}
              onStop={stopHorn}
              keyLabel={hornLabel}
              active={horn?.active}
              heat={horn?.heat}
            />
          )}
          {cameraEnabled && (
            <CameraTiltControl
              value={value}
              min={min}
              max={max}
              onChange={setServoAngle}
              keyDownLabel={downLabel}
              keyUpLabel={upLabel}
              className="space-y-0.5 px-1 py-1"
              labelRowClass="text-xs text-slate-300"
              labelClass=""
              valueClass="font-mono text-slate-100"
              sliderClass="w-full"
              accentClass="accent-emerald-400"
              endpointClass="text-[0.7rem] text-slate-400"
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function RightPaneTabs({ layout, onOpenHelpOverlay }) {
  const { session } = useSession();
  const vipDotClass = session?.isVerified ? 'bg-emerald-400' : 'bg-red-600';
  const ownRoverId = String(session?.assignment?.roverId || '').trim();
  const ownAudioForward = ownRoverId ? session?.audioForward?.[ownRoverId] : null;
  const vipMicActive = Boolean(
    ownAudioForward?.source === 'mic-whip' &&
      (ownAudioForward?.state === 'starting' || ownAudioForward?.state === 'playing'),
  );
  return (
    <section className="panel text-base">
      <Tabs defaultTab="telemetry">
        <TabList>
          <Tab id="telemetry">Controls</Tab>
          <Tab id="vip" highlight={vipMicActive ? 'pink' : 'none'}>
            <span className="inline-flex items-center gap-2">
              <span>VIP</span>
              <span
                className={`inline-block h-3 w-3 rounded-full ${vipDotClass}`}
                aria-hidden="true"
                title={session?.isVerified ? 'Verified' : 'Not verified'}
              />
            </span>
          </Tab>
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
          <TabPanel id="vip" keepMounted>
            <VipPanel />
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
