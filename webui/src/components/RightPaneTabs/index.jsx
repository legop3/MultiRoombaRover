// Right Pane Tabs
// Purpose: Defines the Right Pane Tabs module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoomCameraPanel from '../RoomCameraPanel/index.jsx';
import KinectPanel from '../KinectPanel/index.jsx';
import BalanceBoardPanel from '../BalanceBoardPanel/index.jsx';
import HomeAssistantControls from '../HomeAssistantControls/index.jsx';
import SettingsPanel from '../SettingsPanel/index.jsx';
import HelpPanel from '../HelpPanel/index.jsx';
import ChatPanel from '../ChatPanel/index.jsx';
import { LinkButtonsPanel } from '../UserListPanel/index.jsx';
import ReplaySourcesPanel from '../ReplaySourcesPanel/index.jsx';
import PtzQueueCard from '../PtzCamera/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from '../Tabs/index.jsx';
import TopDownMap from '../TopDownMap/index.jsx';
import DriveDockAction from '../DriveDockAction/index.jsx';
import { useDriveDockState } from '../DriveDockAction/driveDockState.js';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import RoverQueuesPanel from '../RoverQueuesPanel/index.jsx';
import RawUserPilePanel from '../RawUserPilePanel/index.jsx';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import GPIOToggleControl from '../GPIOToggleControl/index.jsx';
import HornControl from '../HornControl/index.jsx';
import CameraTiltControl from '../CameraTiltControl/index.jsx';
import VipPanel from '../VipPanel/index.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import ButtonBoxPanel from '../ButtonBoxPanel/index.jsx';
import BarcodeGamesPanel from '../BarcodeGamesPanel/index.jsx';
import OdometerPanel from '../OdometerPanel/index.jsx';
import LiftCard from '../LiftCard/index.jsx';
import NeatoCard from '../NeatoCard/index.jsx';
import OverseerPreferencePanel from '../OverseerPreferencePanel/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
import { themeGapClass, themeStackClass } from '../../themes/index.js';
import { trackAnalyticsEvent } from '../../analytics/index.js';

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
  const trackedControls = useMemo(
    () => ({
      setHeadlight: (nextOn) => {
        trackAnalyticsEvent('headlight_toggle', { roverId, source: 'desktop_control', enabled: Boolean(nextOn) });
        setHeadlight(nextOn);
      },
      setLaser: (nextOn) => {
        trackAnalyticsEvent('laser_toggle', { roverId, source: 'desktop_control', enabled: Boolean(nextOn) });
        setLaser(nextOn);
      },
      startHorn: () => {
        trackAnalyticsEvent('horn_start', { roverId, source: 'desktop_control' });
        return startHorn();
      },
      stopHorn,
    }),
    [roverId, setHeadlight, setLaser, startHorn, stopHorn],
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
                  onToggle={trackedControls.setHeadlight}
                  keyLabel={headlightLabel}
                />
              )}
              {laserAvailable && (
                <GPIOToggleControl
                  label="Laser"
                  on={laserState?.laserOn}
                  disabled={!roverId || roomLightsLockedOn}
                  onToggle={trackedControls.setLaser}
                  keyLabel={laserLabel}
                />
              )}
            </div>
          )}
          {hornAvailable && (
            <HornControl
              disabled={!roverId || hornBlocked}
              onStart={trackedControls.startHorn}
              onStop={trackedControls.stopHorn}
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
    <div className={`flex ${themeGapClass}`}>
      <div className="min-w-0 basis-0 grow-[1]">
        {/*
          The queue card stretches to the desktop row height so its always-open
          external-instance region receives the same vertical budget as the
          neighboring replay card and can scroll within that space.
        */}
        <RoverQueuesPanel fillHeight />
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

export default function RightPaneTabs({ layout, onOpenHelpOverlay }) {
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
        Desktop users spend most of their time on this one route, so panel
        changes are the cleanest way to understand feature usage without adding
        analytics calls to every nested control in the rover dashboard.
      */
      setActiveTab(tab);
      trackAnalyticsEvent('tab_change', { tab, layout, surface: 'desktop_right_pane' });
    },
    [layout],
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

          {/* activities tab */}
          <TabPanel id="activities">
            <div className={`flex flex-col ${themeGapClass}`}>
              <NeatoCard />
              <LiftCard />
              <BalanceBoardPanel />
              <BarcodeGamesPanel />
              <OdometerPanel />
              <ButtonBoxPanel />
              <KinectPanel />
            </div>
          </TabPanel>

          {/* VIP tab */}
          <TabPanel id="vip" keepMounted>
            <VipPanel isActive={activeTab === 'vip'} layout={layout} />
          </TabPanel>

          {/* help tab */}
          <TabPanel id="help">
            <HelpPanel layout={layout} onOpenOverlay={onOpenHelpOverlay} />
          </TabPanel>

          {/* settings tab */}
          <TabPanel id="settings">
            <SettingsPanel />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}
