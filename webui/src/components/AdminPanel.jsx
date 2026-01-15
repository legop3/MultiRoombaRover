import { useEffect, useMemo, useState } from 'react';
import { useCommandPipeline } from '../controls/commandPipeline.js';
import { useSession } from '../context/SessionContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import RoverRoster from './RoverRoster.jsx';

const MODES = [
  { key: 'open', label: 'Open' },
  { key: 'turns', label: 'Turns' },
  { key: 'admin', label: 'Admin' },
  { key: 'lockdown', label: 'Lockdown' },
];

const IR_SHOT_CODE = 200;

export default function AdminPanel() {
  const { session, lockRover, setMode, requestControl } = useSession();
  const socket = useSocket();
  const pipeline = useCommandPipeline();
  const roster = useMemo(() => session?.roster ?? [], [session?.roster]);
  const [lockStates, setLockStates] = useState({});
  const health = session?.health || null;
  const [transport, setTransport] = useState(null);

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

  const handleIrShot = (roverId) => {
    pipeline.emitCommand(
      {
        type: 'ir',
        data: { ir: { code: IR_SHOT_CODE } },
      },
      null,
      roverId,
    );
  };

  const lockMap = useMemo(() => {
    const map = {};
    roster.forEach((rover) => {
      map[rover.id] = lockStates[rover.id] ?? rover.locked;
    });
    return map;
  }, [roster, lockStates]);

  useEffect(() => {
    if (!socket) return undefined;
    const updateTransport = () => {
      const name = socket.io?.engine?.transport?.name || null;
      setTransport(name);
    };
    updateTransport();
    socket.on('connect', updateTransport);
    socket.on('disconnect', () => setTransport(null));
    socket.io?.engine?.on('upgrade', updateTransport);
    return () => {
      socket.off('connect', updateTransport);
      socket.off('disconnect');
      socket.io?.engine?.off('upgrade', updateTransport);
    };
  }, [socket]);

  return (
    <section className="panel-section space-y-0.5 text-base">
      {isAdmin ? (
        <div className="flex items-center justify-between gap-0.5 text-sm">
          <span>Admin controls</span>
          <div className="flex items-center gap-0.5">
            <span className="panel-muted text-xs">{transport ? `Conn: ${transport}` : 'Conn: —'}</span>
            <select value={currentMode} onChange={handleModeChange} className="field-input text-sm">
              {MODES.map((mode) => (
                <option key={mode.key} value={mode.key}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-0.5 text-sm">
          <span>Rover controls</span>
          <span className="panel-muted text-xs">Limited access</span>
        </div>
      )}

      <RoverRoster
        roster={roster}
        renderActions={(rover) => (
          <div className="flex flex-wrap gap-0.5 text-xs">
            {isAdmin ? (
              <>
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
              </>
            ) : null}
            <button type="button" onClick={() => handleIrShot(rover.id)} className="button-dark">
              IR Shot
            </button>
          </div>
        )}
      />
      {isAdmin ? <ReplaySnapshotHealth health={health} /> : null}
    </section>
  );
}

function ReplaySnapshotHealth({ health }) {
  if (!health) return null;
  const replay = health.replay || { sources: [], readyCount: 0, totalCount: 0 };
  const snapshots = health.snapshots || { rovers: [], rooms: [] };
  const replaySummary = `${replay.readyCount}/${replay.totalCount} sources ready`;
  const roverStale = snapshots.rovers.filter((entry) => entry.stale).length;
  const roomStale = snapshots.rooms.filter((entry) => entry.stale).length;
  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs uppercase">Health</div>
      <div className="surface space-y-0.5 text-xs text-slate-200">
        <div className="flex items-center justify-between">
          <span>Replay segments</span>
          <span className="text-slate-400">{replaySummary}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Rover snapshots</span>
          <span className={roverStale ? 'text-amber-300' : 'text-emerald-300'}>
            {snapshots.rovers.length - roverStale}/{snapshots.rovers.length} ok
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Room cameras</span>
          <span className={roomStale ? 'text-amber-300' : 'text-emerald-300'}>
            {snapshots.rooms.length - roomStale}/{snapshots.rooms.length} ok
          </span>
        </div>
      </div>
      <div className="space-y-0.25 text-xs text-slate-300">
        {replay.sources.map((source) => (
          <div key={`${source.type}:${source.id}`} className="flex items-center justify-between">
            <span>{source.label}</span>
            <span className={source.ready ? 'text-emerald-300' : 'text-amber-300'}>
              {source.recentCount}/{source.neededCount}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.25 text-xs text-slate-300">
        {snapshots.rovers.map((entry) => (
          <div key={`rover:${entry.id}`} className="flex items-center justify-between">
            <span>{entry.name}</span>
            <span className={entry.stale ? 'text-amber-300' : 'text-emerald-300'}>
              {entry.stale ? 'stale' : 'ok'}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.25 text-xs text-slate-300">
        {snapshots.rooms.map((entry) => (
          <div key={`room:${entry.id}`} className="flex items-center justify-between">
            <span>{entry.name}</span>
            <span className={entry.stale ? 'text-amber-300' : 'text-emerald-300'}>
              {entry.error ? 'error' : entry.stale ? 'stale' : 'ok'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
