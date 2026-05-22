// Right Pane Tabs
// Purpose: Defines the Right Pane Tabs module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoomCameraPanel from '../RoomCameraPanel/index.jsx';
import HomeAssistantControls from '../HomeAssistantControls/index.jsx';
import SettingsPanel from '../SettingsPanel/index.jsx';
import HelpPanel from '../HelpPanel/index.jsx';
import ChatPanel from '../ChatPanel/index.jsx';
import { LinkButtonsPanel } from '../UserListPanel/index.jsx';
import ReplaySourcesPanel from '../ReplaySourcesPanel/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from '../Tabs/index.jsx';
import TopDownMap from '../TopDownMap/index.jsx';
import DriveDockAction, { useDriveDockState } from '../DriveDockAction/index.jsx';
import { useTelemetryFrame } from '../../context/TelemetryContext.jsx';
import { useControlSystem } from '../../controls/index.js';
import RoverQueuesPanel from '../RoverQueuesPanel/index.jsx';
import RawUserPilePanel from '../RawUserPilePanel/index.jsx';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import NightVisionControl from '../NightVisionControl/index.jsx';
import HornControl from '../HornControl/index.jsx';
import CameraTiltControl from '../CameraTiltControl/index.jsx';
import VipPanel from '../VipPanel/index.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import ButtonBoxPanel from '../ButtonBoxPanel/index.jsx';
import OverseerPreferencePanel from '../OverseerPreferencePanel/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import { useState } from 'react';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';

function TopDownMapPanel() {
  const {
    state: { roverId },
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};

  return (
    <CardFrame hideHeader>
      <div className="aspect-square w-full">
        <TopDownMap sensors={sensors} />
      </div>
    </CardFrame>
  );
}

function DriveDockPanel() {
  const {
    state: { roverId, keymap, camera, horn },
    pipeline,
    actions: { setServoAngle, setNightVision, startHorn, stopHorn },
  } = useControlSystem();
  const dockAssist = useManualDockAssist();
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
  const cameraDisabled = Boolean(!roverId || dockAssist.cameraLocked);

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
              label="Camera tilt"
              disabled={cameraDisabled}
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
  const [activeTab, setActiveTab] = useState('telemetry');
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const ownRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const ownAudioForward = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    return roverId ? state.session?.audioForward?.[roverId] || null : null;
  });
  const { state: controlState } = useControlSystem();
  const { value: vipAudio } = useSettingsNamespace('vipAudio', { openMicEnabled: false, pttMode: 'live' });
  const vipDotClass = isVerified ? 'bg-emerald-400' : 'bg-red-600';
  const pttActive = Boolean(controlState?.mic?.pttActive);
  const openMicEnabled = Boolean(vipAudio?.openMicEnabled);
  const pttMode = vipAudio?.pttMode === 'clip' ? 'clip' : 'live';
  const vipMicActive = Boolean(
    ownRoverId &&
      isVerified &&
      (pttMode === 'clip' ? pttActive : (openMicEnabled || pttActive)),
  );
  const vipClipPlaying = Boolean(
    ownRoverId &&
      isVerified &&
      pttMode === 'clip' &&
      ownAudioForward?.source === 'upload' &&
      ownAudioForward?.state === 'playing',
  );
  return (
    <section className="panel text-base">
      <Tabs defaultTab="telemetry" currentTab={activeTab} onTabChange={setActiveTab}>
        <TabList>
          <Tab id="telemetry">Controls</Tab>
          <Tab id="vip" highlight={vipClipPlaying ? 'green' : vipMicActive ? 'pink' : 'none'}>
            <span className="inline-flex items-center gap-2">
              <span>VIP</span>
              <span
                className={`inline-block h-3 w-3 rounded-full ${vipDotClass}`}
                aria-hidden="true"
                title={isVerified ? 'Verified' : 'Not verified'}
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
                <div className="grid min-h-0 gap-0.5 grid-rows-[auto_minmax(0,1fr)]">
                  <OverseerPreferencePanel />
                  <RawUserPilePanel compact hideNicknameForm fillHeight />
                </div>
              </div>
              <HomeAssistantControls />
              <ButtonBoxPanel />
              <RoomCameraPanel defaultOrientation="horizontal" panelId="rightpane-telemetry" />
            </div>
          </TabPanel>
          <TabPanel id="vip" keepMounted>
            <VipPanel isActive={activeTab === 'vip'} />
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
