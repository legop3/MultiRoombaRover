import AuthPanel from './AuthPanel.jsx';
import { useSession } from '../context/SessionContext.jsx';

const PRIVILEGED_ROLES = new Set(['admin', 'lockdown', 'lockdown-admin']);
const RESTRICTED_MODES = new Set(['admin', 'lockdown']);

function getModeDetails(mode = 'admin') {
  if (mode === 'lockdown') {
    return {
      title: 'Lockdown in effect',
      description:
        'Only the lockdown admin can remain connected right now. If you have credentials, log in below. Otherwise please stand by until the server re-opens.',
    };
  }
  return {
    title: 'Admin mode active',
    description:
      'The server is temporarily restricted to administrators. Log in below if you are authorized, or wait for admin mode to end.',
  };
}

export default function ModeGateOverlay() {
  const { session } = useSession();
  const mode = session?.mode;
  const role = session?.role;
  const restricted = RESTRICTED_MODES.has(mode);
  const privileged = PRIVILEGED_ROLES.has(role);

  if (!restricted || privileged) {
    return null;
  }

  const details = getModeDetails(mode);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-2 py-2">
      <div className="w-full max-w-md space-y-2 rounded-lg bg-[#141821] p-2 text-slate-100 shadow-2xl">
        <div className="space-y-1">
          <p className="text-lg font-semibold">{details.title}</p>
          <p className="text-sm text-slate-300">{details.description}</p>
        </div>
        <div className="rounded-md bg-black/40 p-1">
          <AuthPanel />
        </div>
        <p className="text-xs text-slate-500">
          Your controls are paused until access is granted. You will automatically regain the interface once the mode
          changes or after a successful login.
        </p>
      </div>
    </div>
  );
}
