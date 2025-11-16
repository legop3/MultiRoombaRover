import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';

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
    <section className="rounded-sm bg-[#242a32] p-2 text-base text-slate-100">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>Admin controls</span>
        <select
          value={currentMode}
          onChange={handleModeChange}
          className="rounded-sm bg-black/40 px-2 py-1 text-sm text-slate-100"
        >
          {MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 space-y-2 text-sm">
        {roster.map((rover) => (
          <div key={rover.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-black/30 px-2 py-2">
            <div>
              <p className="text-slate-100">{rover.name}</p>
              <p className="text-xs text-slate-400">{lockMap[rover.id] ? 'locked' : 'unlocked'}</p>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                onClick={() => handleLockToggle(rover.id, !lockMap[rover.id])}
                className="rounded-sm bg-black/50 px-2 py-1 text-slate-100"
              >
                {lockMap[rover.id] ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                onClick={() => handleForceControl(rover.id)}
                className="rounded-sm bg-black/50 px-2 py-1 text-slate-100"
              >
                Force
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
