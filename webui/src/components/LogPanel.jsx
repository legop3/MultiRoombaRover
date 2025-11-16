import { useSession } from '../context/SessionContext.jsx';

export default function LogPanel() {
  const { logs } = useSession();
  return (
    <div className="rounded-sm bg-[#242a32] p-2 text-base text-slate-100">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Server logs</span>
        <span>{logs.length}</span>
      </div>
      <div className="mt-2 h-48 overflow-y-auto rounded-sm bg-black/40 p-2 font-mono text-sm text-slate-300">
        {logs.length === 0 ? (
          <p>No logs yet.</p>
        ) : (
          logs
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="mb-1">
                <span className="text-slate-500">{entry.timestamp}</span>{' '}
                <span className="text-slate-300">[{entry.level}]</span>{' '}
                {entry.label && <span className="text-slate-400">[{entry.label}]</span>}{' '}
                <span>{entry.message}</span>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
