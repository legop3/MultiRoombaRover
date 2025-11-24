import AuthPanel from './AuthPanel.jsx';
import { useSession } from '../context/SessionContext.jsx';
import DiscordInviteButton from './DiscordInviteButton.jsx';
import ChatPanel from './ChatPanel.jsx';
import NicknameForm from './NicknameForm.jsx';

const PRIVILEGED_ROLES = new Set(['admin', 'lockdown', 'lockdown-admin']);
const RESTRICTED_MODES = new Set(['admin', 'lockdown']);

function getModeDetails(mode = 'admin') {
  if (mode === 'lockdown') {
    return {
      title: 'Lockdown mode active',
      description:
        'Only the server owners can access the interface at this time.',
    };
  }
  return {
    title: 'Admin mode active',
    description:
      'The server is currently in admin mode. Only admins can access the interface.',
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
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-0.5 py-0.5">
      <div className="surface w-full max-w-md space-y-0.5 text-slate-100 shadow-2xl">
        <div className="space-y-0.5">
          <p className="text-lg font-semibold">{details.title}</p>
          <p className="text-sm text-slate-300">{details.description}</p>
        </div>
        <div className="surface-muted">
          <AuthPanel />
        </div>
        <div className='w-full justify-center items-center'>
          <DiscordInviteButton text='Join our Discord server for updates!'/>
        </div>
        You can use the chat from here though :3
        {/* set max height of this box */}
        <div className='max-h-80 overflow-y-auto'>
          <ChatPanel />
          <NicknameForm />
        </div>
        
        {/* <p className="text-xs text-slate-500">
          Your controls are paused until access is granted. You will automatically regain the interface once the mode
          changes or after a successful login.
        </p> */}
      </div>
    </div>
  );
}
