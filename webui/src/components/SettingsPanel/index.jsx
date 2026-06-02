// Settings Panel
// Purpose: Defines the Settings Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo } from 'react';
import { useControlSystem } from '../../controls/index.js';
import AuthPanel from '../AuthPanel/index.jsx';
import AdminPanel from '../AdminPanel/index.jsx';
import KeymapSettings from '../KeymapSettings/index.jsx';
import GamepadMappingSettings from '../GamepadMappingSettings/index.jsx';
import OvercurrentLimiterPanel from '../OvercurrentLimiterPanel/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from '../Tabs/index.jsx';
import SessionSnapshot from '../SessionSnapshot/index.jsx';
import SocketLogPanel from '../SocketLogPanel/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import KeyPill from '../vip/VipAudioUploadCard/KeyPill.jsx';
import { useHudMapSetting } from '../../hooks/useHudMapSetting.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { useSocket } from '../../context/SocketContext.jsx';
import { AUDIO_SETTINGS_DEFAULTS, VIDEO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';

const manualTabs = [
  { key: 'start', label: 'Start OI' },
  { key: 'safe', label: 'Safe' },
  { key: 'full', label: 'Full' },
  { key: 'passive', label: 'Passive' },
  { key: 'dock', label: 'Dock' },
];

const VIDEO_FILTER_OPTIONS = [
  // "Color" is the pass-through mode users can return to when the scene has usable color.
  { key: 'none', label: 'Color' },
  // Grayscale removes the pink IR-contaminated cast while preserving luminance detail.
  { key: 'grayscale', label: 'Gray' },
  // Greenscale keeps the same luminance-first idea as grayscale, then tints it green for
  // users who find green-on-black easier to visually parse in bright outdoor scenes.
  { key: 'greenscale', label: 'Green' },
];

function normalizeVideoFilter(value) {
  // Settings are stored in a browser cookie and can contain stale or hand-edited values.
  // Falling back here keeps the dropdown and media player predictable instead of rendering
  // with an unknown mode.
  return VIDEO_FILTER_OPTIONS.some((option) => option.key === value)
    ? value
    : VIDEO_SETTINGS_DEFAULTS.colorFilter;
}

export default function SettingsPanel() {
  const {
    state: { keymap, roverId },
    actions: { sendOiCommand, setSensorStream },
  } = useControlSystem();
  const canControl = Boolean(roverId);
  const [hudMapDesktop, setHudMapDesktop] = useHudMapSetting();
  const socket = useSocket();
  const { value: pageSettings, save: savePageSettings } = useSettingsNamespace('page', {
    hudMapDesktop: false,
    connectionTransport: 'websocket',
    swapMobileControlColumns: false,
    driveMacroBackoffEnabled: true,
  });
  const { value: audioSettings, save: saveAudioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const { value: videoSettings, save: saveVideoSettings } = useSettingsNamespace('video', VIDEO_SETTINGS_DEFAULTS);
  const connectionTransport = pageSettings?.connectionTransport || 'websocket';
  const swapMobileControlColumns = Boolean(pageSettings?.swapMobileControlColumns);
  const driveMacroBackoffEnabled =
    typeof pageSettings?.driveMacroBackoffEnabled === 'boolean'
      ? pageSettings.driveMacroBackoffEnabled
      : true;
  const masterVolume = Number.isFinite(audioSettings?.masterVolume) ? audioSettings.masterVolume : AUDIO_SETTINGS_DEFAULTS.masterVolume;
  const alertVolume = Number.isFinite(audioSettings?.alertVolume) ? audioSettings.alertVolume : AUDIO_SETTINGS_DEFAULTS.alertVolume;
  const roverVolume = Number.isFinite(audioSettings?.roverVolume) ? audioSettings.roverVolume : AUDIO_SETTINGS_DEFAULTS.roverVolume;
  const mainBrushDuckEnabled =
    typeof audioSettings?.mainBrushDuckEnabled === 'boolean'
      ? audioSettings.mainBrushDuckEnabled
      : typeof audioSettings?.autoLevelEnabled === 'boolean'
      ? audioSettings.autoLevelEnabled
      : AUDIO_SETTINGS_DEFAULTS.mainBrushDuckEnabled;
  const mainBrushDuckAmount = Number.isFinite(audioSettings?.mainBrushDuckAmount)
    ? Math.max(0, Math.min(1, audioSettings.mainBrushDuckAmount))
    : AUDIO_SETTINGS_DEFAULTS.mainBrushDuckAmount;
  const videoColorFilter = normalizeVideoFilter(videoSettings?.colorFilter);
  const videoFilterCycleKeyLabel = formatKeyLabel(keymap?.videoFilterCycle?.[0]);

  const sensorButtons = useMemo(
    () => [
      { key: 'start', label: 'Enable stream', enable: true },
      { key: 'stop', label: 'Disable stream', enable: false },
    ],
    [],
  );

  const handleSensorToggle = (enable) => {
    if (!roverId) return;
    setSensorStream(enable);
  };

  const handleTransportChange = (event) => {
    const next = event.target.value;
    savePageSettings((current) => ({ ...(current ?? {}), connectionTransport: next }));
    if (!socket?.io?.opts) return;
    socket.io.opts.transports = next === 'polling' ? ['polling'] : ['websocket', 'polling'];
    socket.disconnect();
    socket.connect();
  };

  const handleAudioRange = (key) => (event) => {
    const raw = Number(event.target.value);
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    saveAudioSettings((current) => ({ ...(current ?? {}), [key]: next }));
  };

  const handleMainBrushDuckEnabled = (event) => {
    const checked = Boolean(event.target.checked);
    saveAudioSettings((current) => ({ ...(current ?? {}), mainBrushDuckEnabled: checked }));
  };

  const handleSwapMobileControlColumns = (event) => {
    const checked = Boolean(event.target.checked);
    savePageSettings((current) => ({ ...(current ?? {}), swapMobileControlColumns: checked }));
  };

  const handleDriveMacroBackoffEnabled = (event) => {
    const checked = Boolean(event.target.checked);
    savePageSettings((current) => ({ ...(current ?? {}), driveMacroBackoffEnabled: checked }));
  };

  const handleVideoFilterChange = (event) => {
    const nextFilter = normalizeVideoFilter(event.target.value);

    // Merge into the current video namespace so future video preferences can coexist with this
    // filter choice. This follows the same persisted-settings shape used by page/audio options.
    saveVideoSettings((current) => ({
      ...(current ?? {}),
      colorFilter: nextFilter,
    }));
  };

  return (
    <Tabs defaultTab="keybindings">
      <TabList>
        <Tab id="keybindings">Keybindings</Tab>
        <Tab id="controller">Controller</Tab>
        <Tab id="page">Page settings</Tab>
        <Tab id="admin">Admin</Tab>
      </TabList>
      <TabPanels>
        <TabPanel id="keybindings">
          <div className="space-y-0.5">
            <KeymapSettings />
          </div>
        </TabPanel>
        <TabPanel id="controller">
          <div className="space-y-0.5">
            <GamepadMappingSettings />
          </div>
        </TabPanel>
        <TabPanel id="page">
          <div className="space-y-0.5">
            <CardFrame title="HUD" bodyClassName="space-y-0.5 text-sm">
              <label className="flex items-center gap-0.5 text-slate-200">
                <input
                  type="checkbox"
                  className="accent-emerald-500"
                  checked={hudMapDesktop}
                  onChange={(e) => setHudMapDesktop(e.target.checked)}
                />
                <span>Show top-down map in HUD (desktop)</span>
              </label>
              <p className="text-xs text-slate-500">Mobile HUD keeps the map on by default.</p>
            </CardFrame>
            <CardFrame title="Video" bodyClassName="space-y-0.5 text-sm">
              {/* The dropdown mirrors the other Page settings controls and writes through the
                  existing cookie-backed settings provider, so the choice survives reloads without
                  adding rover-side state. */}
              <label className="flex items-center justify-between gap-0.5 text-slate-200">
                <span>Rover video filter</span>
                <select
                  value={videoColorFilter}
                  onChange={handleVideoFilterChange}
                  className="field-input text-sm"
                >
                  {VIDEO_FILTER_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500">
                {/* Use the live keymap value here instead of hardcoding the default key because
                    this shortcut is user-configurable in the Keybindings tab. */}
                <span className="inline-flex flex-wrap items-center gap-0.5">
                  <span>Use</span>
                  {videoFilterCycleKeyLabel ? <KeyPill label={videoFilterCycleKeyLabel} /> : null}
                  <span>to cycle filters. Applies only to rover camera pixels; HUD overlays stay full color.</span>
                </span>
              </p>
            </CardFrame>
            <CardFrame title="Mobile controls" bodyClassName="space-y-0.5 text-sm">
              <label className="flex items-center gap-0.5 text-slate-200">
                <input
                  type="checkbox"
                  className="accent-emerald-500"
                  checked={swapMobileControlColumns}
                  onChange={handleSwapMobileControlColumns}
                />
                <span>Swap control columns (put joystick on the left)</span>
              </label>
            </CardFrame>
            <CardFrame title="Macros" bodyClassName="space-y-0.5 text-sm">
              <label className="flex items-center gap-0.5 text-slate-200">
                <input
                  type="checkbox"
                  className="accent-emerald-500"
                  checked={driveMacroBackoffEnabled}
                  onChange={handleDriveMacroBackoffEnabled}
                />
                <span>Enable backward bump in drive macro</span>
              </label>
            </CardFrame>
            <CardFrame title="Audio" bodyClassName="space-y-0.5 text-sm">
              <label className="grid gap-0.5 text-slate-200">
                <div className="flex items-center justify-between gap-0.5">
                  <span>Master volume</span>
                  <span className="text-xs text-slate-400">{Math.round(masterVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={masterVolume}
                  onChange={handleAudioRange('masterVolume')}
                  className="w-full accent-emerald-500"
                />
              </label>
              <label className="grid gap-0.5 text-slate-200">
                <div className="flex items-center justify-between gap-0.5">
                  <span>Alert/page sounds</span>
                  <span className="text-xs text-slate-400">{Math.round(alertVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={alertVolume}
                  onChange={handleAudioRange('alertVolume')}
                  className="w-full accent-emerald-500"
                />
              </label>
              <label className="grid gap-0.5 text-slate-200">
                <div className="flex items-center justify-between gap-0.5">
                  <span>Rover audio</span>
                  <span className="text-xs text-slate-400">{Math.round(roverVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={roverVolume}
                  onChange={handleAudioRange('roverVolume')}
                  className="w-full accent-emerald-500"
                />
              </label>
              <label className="flex items-center justify-between gap-0.5 text-slate-200">
                <span>Main brush ducking</span>
                <input
                  type="checkbox"
                  className="accent-emerald-500"
                  checked={mainBrushDuckEnabled}
                  onChange={handleMainBrushDuckEnabled}
                />
              </label>
              <label className="grid gap-0.5 text-slate-200">
                <div className="flex items-center justify-between gap-0.5">
                  <span>Main brush duck amount</span>
                  <span className="text-xs text-slate-400">{Math.round(mainBrushDuckAmount * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={mainBrushDuckAmount}
                  onChange={handleAudioRange('mainBrushDuckAmount')}
                  className="w-full accent-emerald-500"
                  disabled={!mainBrushDuckEnabled}
                />
              </label>
              <p className="text-xs text-slate-500">
                Lowers rover audio only while the main brush is running.
              </p>
            </CardFrame>
            <CardFrame title="Connection" bodyClassName="space-y-0.5 text-sm">
              <label className="flex items-center justify-between gap-0.5 text-slate-200">
                <span>Transport</span>
                <select
                  value={connectionTransport}
                  onChange={handleTransportChange}
                  className="field-input text-sm"
                >
                  <option value="websocket">WebSocket</option>
                  <option value="polling">Polling</option>
                </select>
              </label>
              <p className="text-xs text-slate-500">Switching reconnects your session.</p>
            </CardFrame>
          </div>
        </TabPanel>
        <TabPanel id="admin">
          <div className="space-y-0.5">
            <CardFrame title="Manual OI commands" bodyClassName="space-y-0.5 text-sm">
              <div className="flex flex-wrap gap-0.5">
                {manualTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => sendOiCommand(tab.key)}
                    disabled={!canControl}
                    className="button-dark text-xs disabled:opacity-30"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </CardFrame>
            <CardFrame title="Sensor stream" bodyClassName="space-y-0.5 text-sm">
              <div className="flex gap-0.5">
                {sensorButtons.map((btn) => (
                  <button
                    key={btn.key}
                    type="button"
                    onClick={() => handleSensorToggle(btn.enable)}
                    disabled={!canControl}
                    className="flex-1 button-dark text-xs disabled:opacity-30"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              {!canControl && <p className="text-xs text-slate-500">Assign a rover to toggle streams.</p>}
            </CardFrame>
            <AuthPanel />
            <OvercurrentLimiterPanel />
            <AdminPanel />
            <SessionSnapshot />
            <SocketLogPanel />
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
