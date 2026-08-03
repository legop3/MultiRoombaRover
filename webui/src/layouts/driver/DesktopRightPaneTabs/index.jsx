// Right Pane Tabs
// Purpose: Defines the Right Pane Tabs module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoomCameraPanel from '../../../components/RoomCameraPanel/index.jsx';
import HomeAssistantControls from '../../../components/HomeAssistantControls/index.jsx';
import ChatPanel from '../../../components/ChatPanel/index.jsx';
import { LinkButtonsPanel } from '../../../components/UserListPanel/index.jsx';
import ReplaySourcesPanel from '../../../components/ReplaySourcesPanel/index.jsx';
import PtzQueueCard from '../../../components/PtzCamera/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from '../../../components/Tabs/index.jsx';
import TopDownMap from '../../../components/TopDownMap/index.jsx';
import DriveDockAction from '../../../components/DriveDockAction/index.jsx';
import { useDriveDockState } from '../../../components/DriveDockAction/driveDockState.js';
import { useControlActions, useControlSelector } from '../../../controls/index.js';
import RoverQueuesPanel from '../../../components/RoverQueuesPanel/index.jsx';
import RawUserPilePanel from '../../../components/RawUserPilePanel/index.jsx';
import { formatKeyLabel } from '../../../controls/keymapUtils.js';
import GPIOToggleControl from '../../../components/GPIOToggleControl/index.jsx';
import HornControl from '../../../components/HornControl/index.jsx';
import CameraTiltControl from '../../../components/CameraTiltControl/index.jsx';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../../settings/index.js';
import OverseerPreferencePanel from '../../../components/OverseerPreferencePanel/index.jsx';
import CardFrame from '../../../components/CardFrame/index.jsx';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useManualDockAssist } from '../../../features/manualDockAssist/useManualDockAssist.js';
import { themeGapClass, themeStackClass } from '../../../themes/index.js';
import ActivitiesTab from '../tabs/shared/ActivitiesTab/index.jsx';
import VipTab from '../tabs/shared/VipTab/index.jsx';
import HelpTab from '../tabs/shared/HelpTab/index.jsx';
import SettingsTab from '../tabs/shared/SettingsTab/index.jsx';

const CHAT_DOCK_INITIAL_HEIGHT = 224;
const CHAT_DOCK_MIN_HEIGHT = 144;
const CHAT_DOCK_MAX_HEIGHT = 300;
const CHAT_DOCK_BOTTOM_INSET = 8;
const CAMERA_TILT_STEP_DEGREES = 0.5;
const CAMERA_TILT_PRECISION_STEP_DEGREES = 0.1;

function TopDownMapPanel() {
  const roverId = useControlSelector((control) => control.state.roverId);

  return (
    <CardFrame
      title = "Roomba sensor view"
    >
      <div className="aspect-square w-full">
        <TopDownMap roverId={roverId} />
      </div>
    </CardFrame>
  );
}

function DriveDockPanel() {
  const roverId = useControlSelector((control) => control.state.roverId);
  const roomLightsLockedOn = useSessionSelector((state) => Boolean(state.session?.homeAssistant?.lightPolicy?.lockedOn));
  const keymap = useControlSelector((control) => control.state.keymap);
  const camera = useControlSelector((control) => control.state.camera);
  const horn = useControlSelector((control) => control.state.horn);
  const headlight = useControlSelector((control) => control.pipeline?.headlight);
  const headlightState = useControlSelector((control) => control.pipeline?.headlightState);
  const laser = useControlSelector((control) => control.pipeline?.laser);
  const laserState = useControlSelector((control) => control.pipeline?.laserState);
  const pipelineHorn = useControlSelector((control) => control.pipeline?.horn);
  const { setServoAngle, setHeadlight, setLaser, startHorn, stopHorn } = useControlActions();
  const dockAssist = useManualDockAssist();
  const driveDockState = useDriveDockState(roverId);
  const hideInlineControls = driveDockState.docked && !driveDockState.driving;

  const config = camera?.config;
  const cameraEnabled = Boolean(roverId && camera?.enabled && config);
  const headlightAvailable = Boolean(roverId && headlight);
  const laserAvailable = Boolean(roverId && laser);
  const hornAvailable = Boolean(roverId && pipelineHorn);
  const hornBlocked = horn?.overheated;
  const min = typeof config?.minAngle === 'number' ? config.minAngle : -30;
  const max = typeof config?.maxAngle === 'number' ? config.maxAngle : 30;
  const value =
    typeof camera?.angle === 'number'
      ? camera.angle
      : typeof config?.homeAngle === 'number'
        ? config.homeAngle
        : (min + max) / 2;
  const headlightLabel = formatKeyLabel(keymap?.headlightToggle?.[0]);
  const laserLabel = formatKeyLabel(keymap?.laserToggle?.[0]);
  const hornLabel = formatKeyLabel(keymap?.hornHonk?.[0]);
  const upLabel = formatKeyLabel(keymap?.cameraUp?.[0]);
  const downLabel = formatKeyLabel(keymap?.cameraDown?.[0]);
  const cameraDisabled = Boolean(!roverId || dockAssist.cameraLocked);
  /*
    Precision movement mode also tightens the servo slider step. The command
    path still sends ordinary angle targets; only the UI increment changes while
    precision mode is active.
  */
  const cameraTiltStep = camera?.precisionMode
    ? CAMERA_TILT_PRECISION_STEP_DEGREES
    : CAMERA_TILT_STEP_DEGREES;
  const auxControls = useMemo(
    () => ({
      setHeadlight: (nextOn) => {
        setHeadlight(nextOn);
      },
      setLaser: (nextOn) => {
        setLaser(nextOn);
      },
      startHorn: () => {
        return startHorn();
      },
      stopHorn,
    }),
    [setHeadlight, setLaser, startHorn, stopHorn],
  );

  return (
    <CardFrame
      hideHeader
      
      className="h-full"
      bodyClassName={`grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] ${themeGapClass}`}
    >
      <DriveDockAction layout="desktop" expand driveDockState={driveDockState} />
      {!hideInlineControls ? (
        <div className={`${themeStackClass} p-0 text-sm text-slate-200`}>
          {(headlightAvailable || laserAvailable) && (
            <div className="grid grid-cols-2 gap-1">
              {headlightAvailable && (
                <GPIOToggleControl
                  label="Headlight"
                  on={headlightState?.headlightOn}
                  disabled={!roverId}
                  onToggle={auxControls.setHeadlight}
                  keyLabel={headlightLabel}
                />
              )}
              {laserAvailable && (
                <GPIOToggleControl
                  label="Laser"
                  on={laserState?.laserOn}
                  disabled={!roverId || roomLightsLockedOn}
                  onToggle={auxControls.setLaser}
                  keyLabel={laserLabel}
                />
              )}
            </div>
          )}
          {hornAvailable && (
            <HornControl
              disabled={!roverId || hornBlocked}
              onStart={auxControls.startHorn}
              onStop={auxControls.stopHorn}
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
              step={cameraTiltStep}
              label="Camera tilt"
              disabled={cameraDisabled}
              onChange={setServoAngle}
              keyDownLabel={downLabel}
              keyUpLabel={upLabel}
              className={`${themeStackClass} rounded-xl border-2 border-emerald-300/70 bg-emerald-900 px-1 py-1 text-emerald-50`}
              labelRowClass="text-xs text-emerald-100"
              labelClass="text-sm font-semibold"
              valueClass="font-mono text-slate-100"
              sliderClass="w-full"
              accentClass="accent-emerald-400"
              endpointClass="text-[0.7rem] text-emerald-100/80"
            />
          )}
        </div>
      ) : null}
    </CardFrame>
  );
}

function QueueReplayLinksRow() {
  /*
    Flex ratios match the old grid proportions when the Links panel exists. If
    LinkButtonsPanel returns null because socials are disabled, flex naturally
    removes that item instead of preserving an empty grid column.
  */
  return (
    <div className={`flex items-stretch ${themeGapClass}`}>
      <div className="relative min-w-0 basis-0 grow-[1]">
        {/*
          The absolutely positioned queue card is removed from flex cross-size
          calculation. Replay and the links/PTZ stack therefore define the row
          height entirely through normal CSS layout; this relative column then
          stretches to that established height and gives the queue card an exact
          containing block to fill without any JavaScript measurement.
        */}
        <div className="absolute inset-0 min-h-0">
          <RoverQueuesPanel fillHeight />
        </div>
      </div>
      <div className="min-w-0 basis-0 grow-[0.9]">
        <ReplaySourcesPanel panelId="replay-sources-desktop" fillHeight />
      </div>
      <div className={`min-w-0 basis-0 grow-[0.75] ${themeStackClass}`}>
        <LinkButtonsPanel fillHeight={false} />
        <PtzQueueCard layout="desktop" />
      </div>
    </div>
  );
}

export default function RightPaneTabs() {
  const [activeTab, setActiveTab] = useState('telemetry');
  const chatDockRef = useRef(null);
  const [chatDockHeight, setChatDockHeight] = useState(CHAT_DOCK_INITIAL_HEIGHT);
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const ownRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const ownAudioForward = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    return roverId ? state.session?.audioForward?.[roverId] || null : null;
  });
  const pttActive = useControlSelector((control) => Boolean(control.state.mic?.pttActive));
  const { value: vipAudio } = useSettingsNamespace('vipAudio', { openMicEnabled: false, pttMode: 'live' });
  const vipDotClass = isVerified ? 'bg-emerald-400' : 'bg-red-600';
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
  const showOverseerPreferencePanel = useSessionSelector((state) => {
    const vote = state.session?.overseerVote;

    // Match the panel's server-owned voting gate so the measured desktop chat
    // dock can give the side-column height to the user pile when voting is
    // unavailable, including disabled service and direct-address mode.
    return Boolean(vote?.votingEnabled);
  });
  const handleTabChange = useCallback(
    (tab) => {
      /*
        Keep the selected desktop panel controlled here so the tab strip and
        panel content always move together.
      */
      setActiveTab(tab);
    },
    [],
  );

  useLayoutEffect(() => {
    const chatDock = chatDockRef.current;
    if (!chatDock) return undefined;
    let animationFrame = 0;
    let settledFirstFrame = 0;
    let settledSecondFrame = 0;

    const measureChatDock = () => {
      animationFrame = 0;
      const { top } = chatDock.getBoundingClientRect();

      /*
        Keep this as pixels because getBoundingClientRect() and innerHeight are
        pixel-based browser measurements. The row stays in normal document flow:
        when its top moves upward during right-column scrolling, the available
        viewport space grows and the chat panel expands until the max height.
      */
      const availableHeight = window.innerHeight - top - CHAT_DOCK_BOTTOM_INSET;
      const nextHeight = Math.round(
        Math.max(CHAT_DOCK_MIN_HEIGHT, Math.min(CHAT_DOCK_MAX_HEIGHT, availableHeight)),
      );
      setChatDockHeight((currentHeight) => (Math.abs(currentHeight - nextHeight) > 1 ? nextHeight : currentHeight));
    };

    const scheduleMeasure = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(measureChatDock);
    };

    const scheduleSettledMeasure = () => {
      settledFirstFrame = window.requestAnimationFrame(() => {
        settledFirstFrame = 0;
        settledSecondFrame = window.requestAnimationFrame(() => {
          settledSecondFrame = 0;
          measureChatDock();
        });
      });
    };

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            /*
              Some panels above chat settle after the first React commit as data,
              images, or intrinsic layout measurements arrive. Watching the
              parent group means those height changes recalculate the chat row
              immediately instead of requiring a user scroll to repair the
              initial bottom alignment.
            */
            scheduleMeasure();
          })
        : null;

    scheduleMeasure();
    scheduleSettledMeasure();
    if (resizeObserver && chatDock.parentElement) {
      resizeObserver.observe(chatDock.parentElement);
    }
    window.addEventListener('resize', scheduleMeasure);
    /*
      The desktop layout scrolls inside the right-column pane, not the window.
      Capturing scroll events at the document level keeps the effect small while
      still noticing that nested scroll movement without wiring a dedicated ref
      through App.jsx just for this row.
    */
    document.addEventListener('scroll', scheduleMeasure, { capture: true, passive: true });

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (settledFirstFrame) {
        window.cancelAnimationFrame(settledFirstFrame);
      }
      if (settledSecondFrame) {
        window.cancelAnimationFrame(settledSecondFrame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('scroll', scheduleMeasure, { capture: true });
    };
  }, [activeTab]);

  return (
    <section className="text-base">
      <Tabs defaultTab="telemetry" currentTab={activeTab} onTabChange={handleTabChange}>
        <TabList>
          <Tab id="telemetry">Controls</Tab>
          <Tab id="activities">Activities</Tab> 
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
            <div className={`flex flex-col ${themeGapClass}`}>
              {/*
                The first desktop telemetry group is intentionally a viewport
                filler instead of a sticky overlay. The rows above chat keep
                their natural height, and the chat row receives only the
                leftover room between those rows and the bottom of the visible
                right column. That keeps the chat composer at the bottom of the
                screen when space is available while still letting later panels
                sit below it in normal scroll flow instead of being covered.
              */}
              <div className={`flex flex-col ${themeGapClass}`}>
                <div className={`grid items-stretch ${themeGapClass} grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]`}>
                  <TopDownMapPanel />
                  <DriveDockPanel />
                </div>
                <QueueReplayLinksRow />
                {/*
                  This row gets an explicit measured height because the target
                  behavior depends on the row's live viewport position during
                  right-column scrolling. Pure CSS can size against the viewport
                  itself, but it cannot calculate the remaining visible distance
                  from this particular row's current top edge to the bottom of
                  the nested scroll viewport.
                */}
                <div
                  ref={chatDockRef}
                  className={`grid min-h-0 items-stretch ${themeGapClass} grid-cols-[minmax(0,1.3fr)_minmax(0,0.22fr)]`}
                  style={{ height: `${chatDockHeight}px` }}
                >
                  <ChatPanel fillHeight />
                  <div
                    className={`grid min-h-0 ${themeGapClass} ${
                      showOverseerPreferencePanel
                        ? 'grid-rows-[auto_minmax(0,1fr)]'
                        : 'grid-rows-[minmax(0,1fr)]'
                    }`}
                  >
                    {/*
                      This side column is height-constrained by the measured
                      chat dock row. When overseer voting is unavailable on the
                      server, the user pile becomes the only child and should
                      receive the whole side-column height.
                    */}
                    {showOverseerPreferencePanel ? <OverseerPreferencePanel /> : null}
                    <RawUserPilePanel compact hideNicknameForm fillHeight />
                  </div>
                </div>
              </div>
              <HomeAssistantControls />
              <RoomCameraPanel defaultOrientation="horizontal" panelId="rightpane-telemetry" />
            </div>
          </TabPanel>

          <ActivitiesTab />
          <VipTab />
          <HelpTab />
          <SettingsTab />
        </TabPanels>
      </Tabs>
    </section>
  );
}
