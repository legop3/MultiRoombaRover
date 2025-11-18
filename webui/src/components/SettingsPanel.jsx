import { useMemo } from 'react';
import { useControlSystem } from '../controls/index.js';
import AuthPanel from './AuthPanel.jsx';
import AdminPanel from './AdminPanel.jsx';
import KeymapSettings from './KeymapSettings.jsx';
import GamepadMappingSettings from './GamepadMappingSettings.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from './Tabs.jsx';

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
  return (
    <Tabs defaultTab="keybindings">
      <TabList>
        <Tab id="keybindings">Keybindings</Tab>
        <Tab id="controller">Controller</Tab>
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
            <AdminPanel />
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
