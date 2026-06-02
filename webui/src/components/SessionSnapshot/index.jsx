// Session Snapshot
// Purpose: Defines the Session Snapshot module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo } from 'react';
import { useSession } from '../../context/SessionContext.jsx';
import CardFrame from '../CardFrame/index.jsx';

export default function SessionSnapshot() {
  const { session } = useSession();
  const payload = useMemo(() => JSON.stringify(session ?? {}, null, 2), [session]);
  return (
    <CardFrame title="Session snapshot" className="min-h-0" bodyClassName="flex min-h-0 flex-col gap-0.5 text-xs">
      <pre className="min-h-0 flex-1 overflow-y-auto font-mono text-[0.7rem] text-lime-300">
        {payload}
      </pre>
    </CardFrame>
  );
}
