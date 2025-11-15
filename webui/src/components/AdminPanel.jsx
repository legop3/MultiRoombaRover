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
  const roster = session?.roster ?? [];
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
    <section className="rounded-2xl border border-amber-600/40 bg-amber-500/5 p-4 text-sm text-amber-100">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Admin Controls</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-[0.3em] text-amber-300">Server mode</label>
          <select
            value={currentMode}
            onChange={handleModeChange}
            className="rounded-md border border-amber-600/40 bg-slate-950/60 px-2 py-1 text-sm text-white"
          >
            {MODES.map((mode) => (
              <option key={mode.key} value={mode.key}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="space-y-3">
        {roster.map((rover) => (
          <div
            key={rover.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-600/30 bg-slate-950/30 px-3 py-2"
          >
            <div>
              <p className="text-white">{rover.name}</p>
              <p className="text-xs text-amber-200">Locked: {lockMap[rover.id] ? 'yes' : 'no'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleLockToggle(rover.id, !lockMap[rover.id])}
                className="rounded-md border border-amber-500 px-3 py-1 text-xs font-semibold text-amber-100"
              >
                {lockMap[rover.id] ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                onClick={() => handleForceControl(rover.id)}
                className="rounded-md border border-amber-500 px-3 py-1 text-xs font-semibold text-amber-100"
              >
                Force Control
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
