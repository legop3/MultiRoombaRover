// Database Admin App
// Purpose: Provides the dedicated /database route for lockdown-admin identity database management.
// Scope: Handles route-level identity sync, access gating, and composition of the self-contained database panel.
import AuthPanel from '../components/AuthPanel/index.jsx';
import CardFrame from '../components/CardFrame/index.jsx';
import SocketConnectionPill from '../components/SocketConnectionPill/index.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';
import { pageBackgroundClass } from '../themeFlags.js';
import IdentityDatabasePanel from './IdentityDatabasePanel.jsx';

function isLockdownAdminRole(role) {
  return role === 'lockdown' || role === 'lockdown-admin';
}

export default function DatabaseAdminApp() {
  useUserIdentitySync({ identitySurface: 'passive' });
  const role = useSessionSelector((state) => state.session?.role || null);
  const connected = useSessionSelector((state) => state.connected);

  const isLockdownAdmin = isLockdownAdminRole(role);
  const isLoggedInAdmin = role === 'admin' || isLockdownAdmin;

  let content = null;
  if (isLockdownAdmin) {
    content = <IdentityDatabasePanel />;
  } else if (isLoggedInAdmin) {
    content = (
      <CardFrame title="Lockdown admin required" bodyClassName="space-y-0.5 p-1 text-sm text-slate-300">
        <p>This page can edit the canonical identity database, so it is limited to lockdown admins.</p>
        <p>Log in with a lockdown admin account to continue.</p>
      </CardFrame>
    );
  } else {
    content = (
      <div className="mx-auto w-full max-w-md">
        <AuthPanel />
      </div>
    );
  }

  return (
    <div className={`${pageBackgroundClass} min-h-screen text-slate-100`}>
      <SocketConnectionPill />
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-0.5 p-1">
        <CardFrame title="Identity database" meta={connected ? role || 'connected' : 'offline'} bodyClassName="p-0.5 text-sm text-slate-300">
          <p>Canonical users, identity signals, verification, deterrence, and per-user feature state.</p>
        </CardFrame>
        {content}
      </main>
    </div>
  );
}
