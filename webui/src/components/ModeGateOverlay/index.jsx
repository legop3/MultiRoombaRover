// Mode Gate Overlay
// Purpose: Defines the Mode Gate Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo } from 'react';
import AuthPanel from '../AuthPanel/index.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSharedClock } from '../../hooks/useSharedClock.js';
import SocialButton from '../SocialButton/index.jsx';
import ChatPanel from '../ChatPanel/index.jsx';
import { InterInstanceBrowserFrame } from '../InterInstancePanel/index.jsx';
import { isFeatureEnabled } from '../../lib/features.js';

const PRIVILEGED_ROLES = new Set(['admin', 'lockdown']);
const LOCKDOWN_ROLES = new Set(['lockdown']);
const RESTRICTED_MODES = new Set(['admin', 'lockdown']);

function getModeDetails({ mode = 'admin', spectatorAccessBlocked = false, spectatorAccessMode = 'on' } = {}) {
  if (spectatorAccessBlocked) {
    /*
      External spectator access is not a server mode like admin/lockdown; it is
      a route-specific bandwidth/access gate. It still needs the same overlay
      because the AuthPanel is the only browser-side way for an admin to prove
      they should bypass that gate from /spectate.
    */
    return {
      title: 'Spectate access required',
      description: spectatorAccessMode === 'admin'
        ? 'External spectators need admin approval or an admin login before viewing this page.'
        : 'External spectator access is disabled. Admins can log in to continue.',
      reasonLabel: 'Access state:',
      reason: spectatorAccessMode === 'admin' ? 'Waiting for approved spectator identity or admin login.' : 'External spectating is off.',
      chatIntro: 'You can still use the chat while access is blocked:',
    };
  }
  if (mode === 'lockdown') {
    return {
      title: 'Lockdown mode active',
      description:
        'Only the server owners can access the interface at this time.',
      reasonLabel: 'Reason for locking:',
      chatIntro: 'You can still use the chat while the server is locked:',
    };
  }
  return {
    title: 'Admin mode active',
    // description:
    //   'The server is currently in admin mode. Only admins can access the interface.',
    reasonLabel: 'Reason for locking:',
    chatIntro: 'You can still use the chat while the server is locked:',
  };
}

export default function ModeGateOverlay({ includeSpectatorAccessGate = false }) {
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const role = useSessionSelector((state) => state.session?.role || null);
  const reason = useSessionSelector((state) => state.session?.adminReason?.text || '');
  const timezone = useSessionSelector((state) => state.session?.timezone || 'UTC');
  const interInstanceEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'interInstance'));
  const spectatorAccessAllowed = useSessionSelector(
    (state) => state.session?.bandwidthSavings?.canUseExternalSpectatorAccess,
  );
  const spectatorAccessMode = useSessionSelector(
    (state) => state.session?.bandwidthSavings?.externalSpectatorAccess || 'on',
  );
  const restricted = RESTRICTED_MODES.has(mode);
  const privileged = mode === 'lockdown' ? LOCKDOWN_ROLES.has(role) : PRIVILEGED_ROLES.has(role);
  const spectatorAccessBlocked = Boolean(includeSpectatorAccessGate && spectatorAccessAllowed === false);
  const blocked = (restricted && !privileged) || spectatorAccessBlocked;
  /*
    The overlay is mounted for the whole app, but the server-time display is
    only visible while access is actually blocked. Gating the shared clock here
    prevents the hidden overlay from registering a permanent interval.
  */
  const nowMs = useSharedClock(1000, blocked);

  const serverTime = useMemo(() => {
    const now = new Date(nowMs);
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(now);
    } catch {
      return now.toLocaleTimeString();
    }
  }, [nowMs, timezone]);

  if (!blocked) {
    return null;
  }

  const details = getModeDetails({ mode, spectatorAccessBlocked, spectatorAccessMode });
  const displayedReason = spectatorAccessBlocked ? details.reason : reason || 'No reason set.';

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 overflow-y-auto bg-black px-0.5 py-0.5">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col items-center justify-center gap-0.5 lg:flex-row lg:items-center">
        <div className="surface w-full max-w-md shrink-0 space-y-0.5 text-slate-100 shadow-2xl">
          <div className="space-y-0.5">
            <p className="text-lg font-semibold">{details.title}</p>
            <p className="text-sm text-slate-300">{details.description}</p>
          </div>
          <div className="surface-muted space-y-0.5">
            <p className="text-[0.7rem] tracking-wide text-slate-400">{details.reasonLabel}</p>
            <p className="text-lg font-semibold text-slate-100">
              {displayedReason}
            </p>
            <p className="text-center text-sm text-slate-300">Server time: {serverTime}</p>
          </div>
          <div className="surface-muted">
            <AuthPanel />
          </div>
          <SocialButton id="discord" label="Join our Discord server for updates!" />
          {details.chatIntro}
          {/* set max height of this box */}
          <div className='max-h-80 overflow-y-auto'>
            <ChatPanel nicknameLayout="stacked" />
          </div>
          
          {/* <p className="text-xs text-slate-500">
            Your controls are paused until access is granted. You will automatically regain the interface once the mode
            changes or after a successful login.
          </p> */}
        </div>
        {interInstanceEnabled ? (
          /*
            The external browser is a sibling of the login card, not content
            inside it. hideWhenEmpty lets the login card remain centered when
            the directory has no other servers to offer.
          */
          <InterInstanceBrowserFrame
            hideWhenEmpty
            className="max-w-[calc(100vw-0.5rem)]"
            bodyClassName="max-h-[86vh] overflow-y-auto p-0.5"
          />
        ) : null}
      </div>
    </div>
  );
}
