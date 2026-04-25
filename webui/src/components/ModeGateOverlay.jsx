import { useEffect, useMemo, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import SocialButton from './SocialButton.jsx';
import ChatPanel from './ChatPanel.jsx';
import NicknameForm from './NicknameForm.jsx';

const PRIVILEGED_ROLES = new Set(['admin', 'lockdown', 'lockdown-admin']);
const LOCKDOWN_ROLES = new Set(['lockdown', 'lockdown-admin']);
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
    // description:
    //   'The server is currently in admin mode. Only admins can access the interface.',
  };
}

export default function ModeGateOverlay() {
  const session = useSessionSelector((state) => state.session);
  const mode = session?.mode;
  const role = session?.role;
  const reason = session?.adminReason?.text || '';
  const reasonUpdatedAt = session?.adminReason?.updatedAt || null;
  const timezone = session?.timezone || 'UTC';
  const discordUrl =
    session?.socials?.find((entry) => {
      const key = String(entry?.id || entry?.label || '').toLowerCase();
      return key === 'discord';
    })?.url ||
    session?.discord?.invite ||
    null;
  const restricted = RESTRICTED_MODES.has(mode);
  const privileged = mode === 'lockdown' ? LOCKDOWN_ROLES.has(role) : PRIVILEGED_ROLES.has(role);
  const [now, setNow] = useState(() => new Date());

  const serverTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(now);
    } catch (err) {
      return now.toLocaleTimeString();
    }
  }, [now, timezone]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
        <div className="surface-muted space-y-0.5">
          <p className="text-[0.7rem] tracking-wide text-slate-400">Reason for locking:</p>
          <p className="text-lg font-semibold text-slate-100">
            {reason ? reason : 'No reason set.'}
          </p>
          <p className="text-center text-sm text-slate-300">Server time: {serverTime}</p>
          {/* {reasonUpdatedAt ? (
            <p className="text-[0.7rem] text-slate-500">
              Updated {new Date(reasonUpdatedAt).toLocaleString()}
            </p>
          ) : null} */}
        </div>
        <div className="surface-muted">
          <AuthPanel />
        </div>
        <div className="w-full justify-center items-center">
          <SocialButton
            id="discord"
            label="Join our Discord server for updates!"
            url={discordUrl}
          />
        </div>
        You can still use the chat while the server is locked:
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
