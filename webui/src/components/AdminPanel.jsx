import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import RoverRoster from './RoverRoster.jsx';

const MODES = [
  { key: 'open', label: 'Open' },
  { key: 'turns', label: 'Turns' },
  { key: 'admin', label: 'Admin' },
  { key: 'lockdown', label: 'Lockdown' },
];

export default function AdminPanel() {
  const { session, lockRover, setMode, requestControl } = useSession();
  const roster = useMemo(() => session?.roster ?? [], [session?.roster]);
  const [lockStates, setLockStates] = useState({});

  const isAdmin =
    session?.role === 'admin' ||
    session?.role === 'lockdown' ||
    session?.role === 'lockdown-admin';

  const currentMode = session?.mode ?? 'open';

  const handleLockToggle = async (roverId, locked) => {
    try {
      await lockRover(roverId, locked);
      setLockStates((prev) => ({ ...prev, [roverId]: locked }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleModeChange = async (event) => {
    const mode = event.target.value;
    try {
      await setMode(mode);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleForceControl = async (roverId) => {
    try {
      await requestControl(roverId, { force: true });
    } catch (err) {
      alert(err.message);
    }
  };

  const lockMap = useMemo(() => {
    const map = {};
    roster.forEach((rover) => {
      map[rover.id] = lockStates[rover.id] ?? rover.locked;
    });
    return map;
  }, [roster, lockStates]);

  if (!isAdmin) return null;

  return (
    <section className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between gap-0.5 text-sm">
        <span>Admin controls</span>
        <select value={currentMode} onChange={handleModeChange} className="field-input text-sm">
          {MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <RoverRoster
        roster={roster}
        renderActions={(rover) => (
          <div className="flex flex-wrap gap-0.5 text-xs">
            <button
              type="button"
              onClick={() => handleLockToggle(rover.id, !lockMap[rover.id])}
              className="button-dark"
            >
              {lockMap[rover.id] ? 'Unlock' : 'Lock'}
            </button>
            <button type="button" onClick={() => handleForceControl(rover.id)} className="button-dark">
              Force
            </button>
          </div>
        )}
      />
    </section>
  );
}
