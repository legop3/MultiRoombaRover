import AuthPanel from './AuthPanel.jsx';
import { useSession } from '../context/SessionContext.jsx';

function formatExpiry(expiresAt) {
  if (!expiresAt) return 'permanent';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expiring soon';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export default function BannedOverlay() {
  const { banStatus } = useSession();
  if (!banStatus?.banned) return null;
  const expiresAt = banStatus.expiresAt || null;
  const reason = banStatus.reason || null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-0.5 py-0.5">
      <div className="surface w-full max-w-xl space-y-0.5 text-slate-100 shadow-2xl">
        <div className="space-y-0.5">
          <p className="text-lg font-semibold text-red-300">Access blocked</p>
          <p className="text-sm text-slate-300">
            Your access has been {expiresAt ? 'temporarily restricted' : 'banned'}.
          </p>
          <div className="text-xs text-slate-400">
            {expiresAt ? `Timeout ends in ${formatExpiry(expiresAt)}.` : 'This ban has no expiration.'}
          </div>
          {reason && <div className="text-xs text-slate-400">Reason: {reason}</div>}
        </div>
        <div className="surface-muted">
          <AuthPanel />
        </div>
        <p className="text-xs text-slate-500">
          Admins can log in above to regain access.
        </p>
      </div>
    </div>
  );
}
