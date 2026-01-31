import { useMemo } from 'react';
import { useControlSystem } from '../controls/index.js';
import AuthPanel from './AuthPanel.jsx';
import AdminPanel from './AdminPanel.jsx';
import KeymapSettings from './KeymapSettings.jsx';
import GamepadMappingSettings from './GamepadMappingSettings.jsx';
import OvercurrentLimiterPanel from './OvercurrentLimiterPanel.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './Tabs.jsx';
import SessionSnapshot from './SessionSnapshot.jsx';
import SocketLogPanel from './SocketLogPanel.jsx';
import { useHudMapSetting } from '../hooks/useHudMapSetting.js';
import { useSettingsNamespace } from '../settings/index.js';
import { useSocket } from '../context/SocketContext.jsx';

const manualTabs = [
  { key: 'start', label: 'Start OI' },
  { key: 'safe', label: 'Safe' },
  { key: 'full', label: 'Full' },
  { key: 'passive', label: 'Passive' },
  { key: 'dock', label: 'Dock' },
];

export default function SettingsPanel() {
  const {
    state: { roverId },
    actions: { sendOiCommand, setSensorStream },
  } = useControlSystem();
  const canControl = Boolean(roverId);
  const [hudMapDesktop, setHudMapDesktop] = useHudMapSetting();
  const socket = useSocket();
  const { value: pageSettings, save: savePageSettings } = useSettingsNamespace('page', {
    hudMapDesktop: false,
    connectionTransport: 'websocket',
  });
  const connectionTransport = pageSettings?.connectionTransport || 'websocket';

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
            <section className="panel-section space-y-0.5 text-sm">
              <p className="text-slate-400">HUD</p>
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
            </section>
            <section className="panel-section space-y-0.5 text-sm">
              <p className="text-slate-400">Connection</p>
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
            </section>
          </div>
        </TabPanel>
        <TabPanel id="admin">
          <div className="space-y-0.5">
            <section className="panel-section space-y-0.5 text-sm">
              <p className="text-slate-400">Manual OI commands</p>
              <div className="surface flex flex-wrap gap-0.5">
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
            </section>
            <section className="panel-section space-y-0.5 text-sm">
              <p className="text-slate-400">Sensor stream</p>
              <div className="surface flex gap-0.5">
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
            </section>
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
