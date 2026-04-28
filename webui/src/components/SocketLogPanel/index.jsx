// Socket Log Panel
// Purpose: Defines the Socket Log Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';

const MAX_ENTRIES = 300;
const MAX_PAYLOAD_LENGTH = 240;

function formatValue(value, seen) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof Date) return value.toISOString();

  if (!seen) {
    seen = new WeakSet();
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
  }

  try {
    return JSON.stringify(
      value,
      (key, nested) => {
        if (typeof nested === 'function') return '[Function]';
        if (nested instanceof Error) return `${nested.name}: ${nested.message}`;
        return nested;
      },
      0,
    );
  } catch (err) {
    return String(value);
  }
}

function formatArgs(args) {
  const parts = args.map((arg) => formatValue(arg));
  const payload = parts.join(' ');
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    return `${payload.slice(0, MAX_PAYLOAD_LENGTH)}…`;
  }
  return payload;
}

export default function SocketLogPanel() {
  const socket = useSocket();
  const [entries, setEntries] = useState([]);

  const counters = useMemo(() => {
    return entries.reduce(
      (acc, entry) => {
        if (entry.direction === 'in') acc.in += 1;
        if (entry.direction === 'out') acc.out += 1;
        return acc;
      },
      { in: 0, out: 0 },
    );
  }, [entries]);

  useEffect(() => {
    const pushEntry = (direction, event, args) => {
      setEntries((prev) => {
        const next = [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            direction,
            event,
            payload: formatArgs(args),
            timestamp: new Date().toLocaleTimeString(),
          },
        ];
        if (next.length > MAX_ENTRIES) {
          return next.slice(-MAX_ENTRIES);
        }
        return next;
      });
    };

    const handleIncoming = (event, ...args) => pushEntry('in', event, args);
    const handleOutgoing = (event, ...args) => pushEntry('out', event, args);

    socket.onAny(handleIncoming);

    let restoreEmit = null;
    if (typeof socket.onAnyOutgoing === 'function') {
      socket.onAnyOutgoing(handleOutgoing);
      restoreEmit = () => socket.offAnyOutgoing(handleOutgoing);
    } else {
      const originalEmit = socket.emit.bind(socket);
      socket.emit = (event, ...args) => {
        handleOutgoing(event, ...args);
        return originalEmit(event, ...args);
      };
      restoreEmit = () => {
        socket.emit = originalEmit;
      };
    }

    return () => {
      socket.offAny(handleIncoming);
      if (restoreEmit) {
        restoreEmit();
      }
    };
  }, [socket]);

  return (
    <section className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Socket activity</span>
        <div className="flex items-center gap-0.5 text-xs text-slate-400">
          <span className="surface-muted">in {counters.in}</span>
          <span className="surface-muted">out {counters.out}</span>
          <button type="button" className="button-dark text-xs" onClick={() => setEntries([])}>
            Clear
          </button>
        </div>
      </div>
      <div className="surface h-64 overflow-y-auto font-mono text-xs">
        {entries.length === 0 ? (
          <p>No socket activity yet.</p>
        ) : (
          entries
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="surface">
                <span className="text-slate-400">{entry.timestamp}</span>{' '}
                <span className={entry.direction === 'in' ? 'text-emerald-400' : 'text-amber-400'}>
                  [{entry.direction.toUpperCase()}]
                </span>{' '}
                <span className="text-cyan-300">{entry.event}</span>{' '}
                <span className="text-slate-200">{entry.payload}</span>
              </div>
            ))
        )}
      </div>
      <p className="text-xs text-slate-500">Logs are collected only while this panel is open.</p>
    </section>
  );
}
