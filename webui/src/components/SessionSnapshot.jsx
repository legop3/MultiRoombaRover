import { useMemo } from 'react';
import { useSession } from '../context/SessionContext.jsx';

export default function SessionSnapshot() {
  const { session } = useSession();
  const payload = useMemo(() => JSON.stringify(session ?? {}, null, 2), [session]);
  return (
    <div className="rounded-sm bg-[#242a32] p-1 text-xs text-slate-100">
      <p className="text-sm text-slate-400">Session snapshot</p>
      <pre className="mt-1 max-h-64 overflow-y-auto bg-black/40 p-1 text-[0.7rem] text-lime-300">{payload}</pre>
    </div>
  );
}
