import { useMemo } from 'react';
import { useSession } from '../../context/SessionContext.jsx';

export default function SessionSnapshot() {
  const { session } = useSession();
  const payload = useMemo(() => JSON.stringify(session ?? {}, null, 2), [session]);
  return (
    <div className="panel-section flex min-h-0 flex-col gap-0.5 text-xs">
      <p className="text-sm text-slate-400">Session snapshot</p>
      <pre className="surface min-h-0 flex-1 overflow-y-auto font-mono text-[0.7rem] text-lime-300">
        {payload}
      </pre>
    </div>
  );
}
