// Mode Gate Overlay
// Purpose: Defines the Mode Gate Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo } from 'react';
import '../InterInstancePanel/styles.css';
import AuthPanel from '../AuthPanel/index.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSharedClock } from '../../hooks/useSharedClock.js';
import SocialButton from '../SocialButton/index.jsx';
import ChatPanel from '../ChatPanel/index.jsx';
import { InterInstanceBrowserFrame } from '../InterInstancePanel/index.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import DriverAdCard from '../DriverAdCard/index.jsx';

const PRIVILEGED_ROLES = new Set(['admin', 'lockdown']);
const LOCKDOWN_ROLES = new Set(['lockdown']);
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

function ServerTime({ timezone }) {
  /*
    Keep the one-second clock subscription in this leaf component. If the mode
    gate itself owns the changing timestamp, React rerenders the authentication
    card, chat, external-instance browser, and raw ad iframe every second even
    though only this short label changed.

    ServerTime is only mounted while the gate is visible, so useSharedClock
    automatically removes its listener when access is restored and no hidden
    overlay interval remains active.
  */
  const nowMs = useSharedClock(1000);
  const formattedTime = useMemo(() => {
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

  return <p className="text-center text-sm text-slate-300">Server time: {formattedTime}</p>;
}

export default function ModeGateOverlay() {
  const mode = useSessionSelector((state) => state.session?.mode || null);
  const role = useSessionSelector((state) => state.session?.role || null);
  const reason = useSessionSelector((state) => state.session?.adminReason?.text || '');
  const timezone = useSessionSelector((state) => state.session?.timezone || 'UTC');
  const interInstanceEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'interInstance'));
  const restricted = RESTRICTED_MODES.has(mode);
  const privileged = mode === 'lockdown' ? LOCKDOWN_ROLES.has(role) : PRIVILEGED_ROLES.has(role);

  if (!restricted || privileged) {
    return null;
  }

  const details = getModeDetails(mode);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 overflow-y-auto bg-black px-0.5 py-0.5">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-0.5">
        {/*
          The access and external-instance cards live in a flexible center
          region. The ad remains a separate final row, so it stays centered at
          the bottom of the overlay rather than becoming a third column or
          shifting the access controls away from the visual center.
        */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex w-full min-w-0 flex-col items-center justify-center gap-0.5 lg:flex-row lg:items-center">
            <div className="surface w-full max-w-md shrink-0 space-y-0.5 text-slate-100 shadow-2xl">
              <div className="space-y-0.5">
                <p className="text-lg font-semibold">{details.title}</p>
                <p className="text-sm text-slate-300">{details.description}</p>
              </div>
              <div className="surface-muted space-y-0.5">
                <p className="text-[0.7rem] tracking-wide text-slate-400">Reason for locking:</p>
                <p className="text-lg font-semibold text-slate-100">
                  {reason ? reason : 'No reason set.'}
                </p>
                <ServerTime timezone={timezone} />
              </div>
              <div className="surface-muted">
                <AuthPanel />
              </div>
              <SocialButton id="discord" label="Join our Discord server for updates!" />
              You can still use the chat while the server is locked:
              {/* set max height of this box */}
              <div className='max-h-80 overflow-y-auto'>
                <ChatPanel nicknameLayout="stacked" />
              </div>
            </div>
            {interInstanceEnabled ? (
              /*
                Give the mode-gate copy of the shared browser a stable width
                and allow it to shrink below that width. Scrollable queue
                descendants must not expand this flex item to their intrinsic
                content width when the body gains a vertical scrollbar.
              */
              <InterInstanceBrowserFrame
                hideWhenEmpty
                scaledOverlay
                singleColumn
                className="inter-instance-overlay-frame w-[20.5rem] min-w-0 max-w-full"
                bodyClassName="inter-instance-overlay-body min-w-0 overflow-x-hidden overflow-y-auto p-0.5"
              />
            ) : null}
          </div>
        </div>
        {/*
          DriverAdCard self-gates on configured HTML. When disabled it returns
          null and consumes no footer space; when enabled this responsive width
          keeps the card centered without tying the overlay to one provider's
          creative dimensions.
        */}
        <DriverAdCard className="mx-auto max-w-3xl" />
      </div>
    </div>
  );
}
