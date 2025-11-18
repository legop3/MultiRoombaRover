import { useState } from 'react';
import TelemetryPanel from './TelemetryPanel.jsx';
import DrivePanel from './DrivePanel.jsx';
import CameraServoPanel from './CameraServoPanel.jsx';
import RoomCameraPanel from './RoomCameraPanel.jsx';
import AdvancedSettings from './AdvancedSettings.jsx';
import HelpPanel from './HelpPanel.jsx';

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-sm px-1 py-1 text-xs font-semibold ${
        active ? 'bg-slate-100 text-slate-900' : 'bg-black/30 text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function RoomControlsPlaceholder() {
  return (
    <div className="rounded-sm bg-[#242a32] p-1 text-sm text-slate-100">
      <p className="text-xs text-slate-400">Room controls</p>
      <p className="text-sm text-slate-200">Coming soon: lighting, docks, and environmental toggles.</p>
    </div>
  );
}

export default function RightPaneTabs({ layout }) {
  const [active, setActive] = useState('telemetry');

  return (
    <section className="rounded-sm bg-[#1a1d23] p-1 text-base text-slate-100">
      <div className="flex gap-1">
        <TabButton active={active === 'telemetry'} onClick={() => setActive('telemetry')}>
          Rover Controls
        </TabButton>
        <TabButton active={active === 'room'} onClick={() => setActive('room')}>
          Room Controls
        </TabButton>
        <TabButton active={active === 'advanced'} onClick={() => setActive('advanced')}>
          Settings
        </TabButton>
        <TabButton active={active === 'help'} onClick={() => setActive('help')}>
          Help
        </TabButton>
      </div>
      <div className="mt-1 space-y-1">
        {active === 'telemetry' && (
          <div className="space-y-1">
            <DrivePanel />
            <CameraServoPanel />
            <TelemetryPanel />
          </div>
        )}
        {active === 'room' && (
          <div className="space-y-1">
            <RoomCameraPanel />
            <RoomControlsPlaceholder />
          </div>
        )}
        {active === 'advanced' && <AdvancedSettings />}
        {active === 'help' && <HelpPanel layout={layout} />}
      </div>
    </section>
  );
}
