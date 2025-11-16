import { useMemo } from 'react';
import { useDriveControl } from '../context/DriveControlContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import AuthPanel from './AuthPanel.jsx';

const manualTabs = [
  { key: 'start', label: 'Start OI' },
  { key: 'safe', label: 'Safe' },
  { key: 'full', label: 'Full' },
  { key: 'passive', label: 'Passive' },
  { key: 'dock', label: 'Dock' },
];

export default function AdvancedSettings() {
  const { roverId, sendOiCommand } = useDriveControl();
  const socket = useSocket();
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
    socket.emit('command', {
      roverId,
      type: 'sensorStream',
      data: { sensorStream: { enable } },
    });
  };

  return (
    <div className="space-y-1">
      <section className="rounded-sm bg-[#242a32] p-1 text-sm text-slate-100">
        <p className="text-xs text-slate-400">Manual OI commands</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {manualTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => sendOiCommand(tab.key)}
              disabled={!canControl}
              className="rounded-sm bg-black/40 px-1 py-0.5 text-xs text-slate-200 disabled:opacity-30"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-sm bg-[#242a32] p-1 text-sm text-slate-100">
        <p className="text-xs text-slate-400">Sensor stream</p>
        <div className="mt-1 flex gap-1">
          {sensorButtons.map((btn) => (
            <button
              key={btn.key}
              type="button"
              onClick={() => handleSensorToggle(btn.enable)}
              disabled={!canControl}
              className="flex-1 rounded-sm bg-black/40 px-1 py-1 text-xs text-slate-200 disabled:opacity-30"
            >
              {btn.label}
            </button>
          ))}
        </div>
        {!canControl && <p className="mt-1 text-xs text-slate-500">Assign a rover to toggle streams.</p>}
      </section>
      <AuthPanel />
    </div>
  );
}
