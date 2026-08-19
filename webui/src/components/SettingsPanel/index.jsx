// Settings Panel
// Purpose: Defines the Settings Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useState } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import AuthPanel from '../AuthPanel/index.jsx';
import AdminPanel from '../AdminPanel/index.jsx';
import KeymapSettings from '../KeymapSettings/index.jsx';
import GamepadMappingSettings from '../GamepadMappingSettings/index.jsx';
import OvercurrentLimiterPanel from '../OvercurrentLimiterPanel/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from '../Tabs/index.jsx';
import SessionSnapshot from '../SessionSnapshot/index.jsx';
import SocketLogPanel from '../SocketLogPanel/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import VolumeSettingsCard from '../VolumeSettingsCard/index.jsx';
import KeyPill from '../vip/VipAudioUploadCard/KeyPill.jsx';
import { useHudMapSetting } from '../../hooks/useHudMapSetting.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { useSocket } from '../../context/SocketContext.jsx';
import { AUDIO_SETTINGS_DEFAULTS, VIDEO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import {
  DEFAULT_PAGE_THEME_KEY,
  PAGE_THEME_OPTIONS,
  getPageTheme,
  getPageThemeClass,
  normalizePageThemeKey,
} from '../../themes/index.js';

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

function SettingRow({ children, inline = false, className = '' }) {
  // Page settings are changed one row at a time, so each row gets a subtle container and a
  // max width. This keeps the label and control together instead of stretching them across
  // the full settings pane.
  return (
    <label
      className={`mx-auto flex w-full max-w-lg items-center gap-1.5 rounded bg-neutral-800/80 px-1.5 py-1 text-sm text-white ${inline ? 'flex-row' : 'flex-col items-stretch @lg:flex-row @lg:items-center'} ${className}`}
    >
      {children}
    </label>
  );
}

function SettingHelp({ children }) {
  // Helper text is still secondary, but it no longer uses the very small microcopy scale that
  // made the settings panel difficult to read from a normal driving distance.
  return <p className="mx-auto w-full max-w-lg text-xs leading-snug text-white">{children}</p>;
}

function ThemePreviewCard({ title, className = '' }) {
  // Use the production CardFrame rather than a lookalike rectangle. This makes the demonstration
  // honest about borders, opaque card surfaces, and the exact amount of theme visible in a gap.
  return (
    <CardFrame
      title={title}
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col justify-center gap-1 p-1"
      fillHeight
    >
      {/* Neutral placeholder lines suggest real panel content without making the preview look like
          an interactive control surface or tying it to any one driver/PTZ layout. */}
      <div className="h-1.5 w-4/5 rounded-full bg-neutral-600/80" />
      <div className="h-1.5 w-3/5 rounded-full bg-neutral-700/90" />
    </CardFrame>
  );
}

function RangeSetting({ label, value, disabled = false, onChange }) {
  // Range settings need enough horizontal room for accurate pointer input, so the slider spans
  // the row while the percentage value stays beside the label for quick feedback.
  return (
    <label className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1 text-sm text-white">
      <div className="flex items-center justify-between gap-1.5">
        <span className="min-w-0 font-semibold text-white">{label}</span>
        <span className="rounded bg-neutral-900 px-1 py-0.5 text-xs text-white">
          {Math.round(value * 100)}%
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={onChange}
        className="mt-1 w-full accent-emerald-500 disabled:opacity-50"
        disabled={disabled}
      />
    </label>
  );
}

function reconnectSocketWithTransport(socket, transport) {
  if (!socket?.io?.opts) return;
  /*
    Socket.IO reads its manager options when reconnecting. Keep this mutation in
    one helper instead of inside the component body so the settings handler only
    expresses the user-facing action: save preference, then reconnect.
  */
  socket.io.opts.transports = transport === 'polling' ? ['polling'] : ['websocket', 'polling'];
  socket.disconnect();
  socket.connect();
}

export default function SettingsPanel() {
  const keymap = useControlSelector((control) => control.state.keymap);
  const roverId = useControlSelector((control) => control.state.roverId);
  const { sendOiCommand, setSensorStream } = useControlActions();
  const canControl = Boolean(roverId);
  const [hudMapDesktop, setHudMapDesktop] = useHudMapSetting();
  const socket = useSocket();
  const { value: pageSettings, save: savePageSettings } = useSettingsNamespace('page', {
    hudMapDesktop: false,
    connectionTransport: 'websocket',
    swapMobileControlColumns: false,
    driveMacroBackoffEnabled: true,
    interInstanceTransferSettings: true,
    backgroundTheme: DEFAULT_PAGE_THEME_KEY,
  });
  const { value: audioSettings, save: saveAudioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const { value: videoSettings, save: saveVideoSettings } = useSettingsNamespace('video', VIDEO_SETTINGS_DEFAULTS);
  const connectionTransport = pageSettings?.connectionTransport || 'websocket';
  const swapMobileControlColumns = Boolean(pageSettings?.swapMobileControlColumns);
  const driveMacroBackoffEnabled =
    typeof pageSettings?.driveMacroBackoffEnabled === 'boolean'
      ? pageSettings.driveMacroBackoffEnabled
      : true;
  const interInstanceTransferSettings = pageSettings?.interInstanceTransferSettings !== false;
  const savedPageThemeKey = normalizePageThemeKey(pageSettings?.backgroundTheme);
  const [previewPageThemeKey, setPreviewPageThemeKey] = useState(savedPageThemeKey);
  const previewPageTheme = getPageTheme(previewPageThemeKey);
  const savedPageTheme = getPageTheme(savedPageThemeKey);
  const hasUnsavedPageTheme = previewPageThemeKey !== savedPageThemeKey;
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

  useEffect(() => {
    // Settings load after the provider mounts and can also be replaced by an incoming inter-instance
    // transfer. Resynchronize only when the persisted key changes; browsing the local preview does
    // not touch pageSettings, so Previous/Next choices are not accidentally reset.
    setPreviewPageThemeKey(savedPageThemeKey);
  }, [savedPageThemeKey]);

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
    reconnectSocketWithTransport(socket, next);
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

  const handleInterInstanceTransferSettings = (event) => {
    const checked = Boolean(event.target.checked);
    /*
      This replaces the old per-click transfer confirmation. Keeping the choice
      in Page settings makes external-server navigation immediate while still
      letting users opt out of sending their current settings cookie.
    */
    savePageSettings((current) => ({ ...(current ?? {}), interInstanceTransferSettings: checked }));
  };

  const movePageThemePreview = (direction) => {
    const currentIndex = PAGE_THEME_OPTIONS.findIndex((theme) => theme.key === previewPageThemeKey);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    // Theme browsing wraps in both directions so the Back and Next buttons remain useful at the
    // ends of the catalog instead of forcing the user to reverse through every previous option.
    const nextIndex = (safeIndex + direction + PAGE_THEME_OPTIONS.length) % PAGE_THEME_OPTIONS.length;
    setPreviewPageThemeKey(PAGE_THEME_OPTIONS[nextIndex].key);
  };

  const handlePageThemeSelect = (event) => {
    setPreviewPageThemeKey(normalizePageThemeKey(event.target.value));
  };

  const handlePageThemeSave = () => {
    // Browsing is intentionally local. Persist only this explicit choice so opening Page settings
    // and experimenting with patterns cannot unexpectedly alter the driver or PTZ page background.
    savePageSettings((current) => ({
      ...(current ?? {}),
      backgroundTheme: previewPageThemeKey,
    }));
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

  // Settings owns grids outside its individual CardFrames. This boundary makes
  // those grids react to the panel's allocated width in any desktop column.
  return (
    <div className="@container">
      <Tabs defaultTab="keybindings">
      <TabList>
        {/* Four long labels cannot remain readable in one narrow sidebar row.
            Each tab claims half the row until this Settings container is wide,
            where the minimum is removed and the original single row returns. */}
        <Tab id="keybindings" className="min-w-[calc(50%_-_0.125rem)] @[28rem]:min-w-0">Keybindings</Tab>
        <Tab id="controller" className="min-w-[calc(50%_-_0.125rem)] @[28rem]:min-w-0">Controller</Tab>
        <Tab id="page" className="min-w-[calc(50%_-_0.125rem)] @[28rem]:min-w-0">Page settings</Tab>
        <Tab id="admin" className="min-w-[calc(50%_-_0.125rem)] @[28rem]:min-w-0">Admin</Tab>
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
          {/* The normal two-column settings page returns at the width where two
              useful cards actually fit. The former 48rem threshold was unreachable
              in the old driver pane and incorrectly made its fallback permanent. */}
          <div className="flex flex-col gap-1.5 @[28rem]:grid @[28rem]:grid-cols-2">
            <CardFrame
              title="Background theme"
              className="col-span-full"
              bodyClassName="space-y-1.5 p-1 text-sm"
            >
              {/* The selector owns a full row at narrow widths. Navigation is a
                  separate flex row so neither button can squeeze the select text. */}
              <div className="flex flex-col gap-1.5">
                <select
                  aria-label="Preview background theme"
                  value={previewPageThemeKey}
                  onChange={handlePageThemeSelect}
                  className="field-input w-full min-w-0 px-1 py-0.5 text-sm"
                >
                  {PAGE_THEME_OPTIONS.map((theme) => (
                    <option key={theme.key} value={theme.key}>
                      {theme.label}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className="button-dark min-w-0 flex-1 text-sm"
                    onClick={() => movePageThemePreview(-1)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="button-dark min-w-0 flex-1 text-sm"
                    onClick={() => movePageThemePreview(1)}
                  >
                    Next
                  </button>
                </div>
              </div>

              {/* This miniature layout contains both a full-height vertical seam and horizontal
                  seams between stacked cards. It exercises the exact gap directions the artwork
                  must serve on the driver and PTZ pages. */}
              <div
                className={`page-theme-preview flex h-48 flex-col gap-0.5 overflow-hidden rounded border border-neutral-500/70 p-0.5 @[28rem]:grid @[28rem]:h-32 @[28rem]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,0.85fr)] @[28rem]:grid-rows-2 ${getPageThemeClass(previewPageThemeKey)}`}
              >
                <ThemePreviewCard title="Video" className="row-span-2" />
                <ThemePreviewCard title="Controls" />
                <ThemePreviewCard title="Queue" />
                <ThemePreviewCard title="Chat" className="col-span-2" />
              </div>

              <div className="flex flex-col items-stretch gap-1.5 @lg:flex-row @lg:items-center @lg:justify-between">
                <p className="min-w-0 text-xs text-white">
                  Previewing <span className="font-semibold">{previewPageTheme.label}</span>
                  {hasUnsavedPageTheme ? (
                    <span className="text-slate-300">; saved theme is {savedPageTheme.label}.</span>
                  ) : (
                    <span className="text-slate-300">; this is your saved theme.</span>
                  )}
                </p>
                <button
                  type="button"
                  className="button-dark w-full text-sm disabled:cursor-default disabled:opacity-45 @lg:w-auto @lg:min-w-24"
                  disabled={!hasUnsavedPageTheme}
                  onClick={handlePageThemeSave}
                >
                  Save theme
                </button>
              </div>
            </CardFrame>
            <CardFrame title="HUD" bodyClassName="space-y-1 p-1 text-sm">
              <SettingRow inline>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-emerald-500"
                  checked={hudMapDesktop}
                  onChange={(e) => setHudMapDesktop(e.target.checked)}
                />
                <span className="font-semibold text-white">Show top-down map in HUD (desktop)</span>
              </SettingRow>
              <SettingHelp>Mobile HUD keeps the map on by default.</SettingHelp>
            </CardFrame>
            <CardFrame title="Video" bodyClassName="space-y-1 p-1 text-sm">
              {/* The dropdown mirrors the other Page settings controls and writes through the
                  existing cookie-backed settings provider, so the choice survives reloads without
                  adding rover-side state. */}
              <SettingRow>
                <span className="font-semibold text-white">Rover video filter</span>
                <select
                  value={videoColorFilter}
                  onChange={handleVideoFilterChange}
                  className="field-input min-w-28 px-1 py-0.5 text-sm"
                >
                  {VIDEO_FILTER_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </SettingRow>
              <SettingHelp>
                {/* Use the live keymap value here instead of hardcoding the default key because
                    this shortcut is user-configurable in the Keybindings tab. */}
                <span className="inline-flex flex-wrap items-center gap-1">
                  <span>Use</span>
                  {videoFilterCycleKeyLabel ? <KeyPill label={videoFilterCycleKeyLabel} /> : null}
                  <span>to cycle filters. Applies only to rover camera pixels; HUD overlays stay full color.</span>
                </span>
              </SettingHelp>
            </CardFrame>
            <CardFrame title="Mobile controls" bodyClassName="space-y-1 p-1 text-sm">
              <SettingRow inline>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-emerald-500"
                  checked={swapMobileControlColumns}
                  onChange={handleSwapMobileControlColumns}
                />
                <span className="font-semibold text-white">Swap control columns (put joystick on the left)</span>
              </SettingRow>
            </CardFrame>
            <CardFrame title="Macros" bodyClassName="space-y-1 p-1 text-sm">
              <SettingRow inline>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-emerald-500"
                  checked={driveMacroBackoffEnabled}
                  onChange={handleDriveMacroBackoffEnabled}
                />
                <span className="font-semibold text-white">Enable backward bump in drive macro</span>
              </SettingRow>
            </CardFrame>
            <CardFrame title="Audio" className="col-span-full" bodyClassName="space-y-1 p-1 text-sm">
              {/* Audio sliders are stacked inside the wider card so the value chip, label, and
                  slider remain easy to compare while preserving enough drag distance. */}
              <RangeSetting
                label="Master volume"
                value={masterVolume}
                onChange={handleAudioRange('masterVolume')}
              />
              <RangeSetting
                label="Alert/page sounds"
                value={alertVolume}
                onChange={handleAudioRange('alertVolume')}
              />
              <RangeSetting
                label="Rover audio"
                value={roverVolume}
                onChange={handleAudioRange('roverVolume')}
              />
              <SettingRow>
                <span className="font-semibold text-white">Main brush ducking</span>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-emerald-500"
                  checked={mainBrushDuckEnabled}
                  onChange={handleMainBrushDuckEnabled}
                />
              </SettingRow>
              <RangeSetting
                label="Main brush duck amount"
                value={mainBrushDuckAmount}
                onChange={handleAudioRange('mainBrushDuckAmount')}
                disabled={!mainBrushDuckEnabled}
              />
              <SettingHelp>
                Lowers rover audio only while the main brush is running.
              </SettingHelp>
            </CardFrame>
            {/* Volume is server-backed rather than cookie-backed: it changes what the
                rover plays for everyone in the room, so the server owns the limits. */}
            <VolumeSettingsCard />
            <CardFrame title="Connection" bodyClassName="space-y-1 p-1 text-sm">
              <SettingRow>
                <span className="font-semibold text-white">Transport</span>
                <select
                  value={connectionTransport}
                  onChange={handleTransportChange}
                  className="field-input min-w-28 px-1 py-0.5 text-sm"
                >
                  <option value="websocket">WebSocket</option>
                  <option value="polling">Polling</option>
                </select>
              </SettingRow>
              <SettingHelp>Switching reconnects your session.</SettingHelp>
            </CardFrame>
            <CardFrame title="Inter-instance" bodyClassName="space-y-1 p-1 text-sm">
              <SettingRow inline>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-emerald-500"
                  checked={interInstanceTransferSettings}
                  onChange={handleInterInstanceTransferSettings}
                />
                <span className="font-semibold text-white">Transfer settings when opening external servers</span>
              </SettingRow>
              <SettingHelp>
                Sends this browser's saved identity and page settings to the destination server automatically.
              </SettingHelp>
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
    </div>
  );
}
