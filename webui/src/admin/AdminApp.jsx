// Central Administration Application
// Purpose: Composes authentication, operational controls, users, and one complete configuration editor under /admin.
// Scope: Reuses existing admin/identity components while shared infrastructure owns revisions and sensitive-action behavior.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AuthPanel from '../components/AuthPanel/index.jsx';
import AdminPanelContent from '../components/AdminPanel/AdminPanelContent.jsx';
import CardFrame from '../components/CardFrame/index.jsx';
import SocketConnectionPill from '../components/SocketConnectionPill/index.jsx';
import Tabs, { Tab, TabList, TabPanels } from '../components/Tabs/index.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import IdentityDatabasePanel from '../database/IdentityDatabasePanel.jsx';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';
import { useSettingsNamespace } from '../settings/index.js';
import { DEFAULT_PAGE_THEME_KEY, usePageThemeClass } from '../themes/index.js';
import { confirmAdminPassword, getAdminSnapshot } from './api.js';
import AdministratorAccounts from './components/AdministratorAccounts.jsx';
import AdminOverview from './components/AdminOverview.jsx';
import ConfigurationEditor from './components/ConfigurationEditor.jsx';
import PasswordConfirmationDialog from './components/PasswordConfirmationDialog.jsx';

const TOP_LEVEL_SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'fleet', label: 'Fleet operations' },
  { key: 'users', label: 'Users and administrators', lockdownOnly: true },
  { key: 'configuration', label: 'Configuration', lockdownOnly: true },
];

export default function AdminApp() {
  useUserIdentitySync({ identitySurface: 'passive' });
  const socket = useSocket();
  const role = useSessionSelector((state) => state.session?.role || 'user');
  const connected = useSessionSelector((state) => state.connected);
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get('section') || 'overview';
  const [snapshot, setSnapshot] = useState(null);
  const [loadingError, setLoadingError] = useState('');
  const pendingSensitiveAction = useRef(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  const { value: pageSettings } = useSettingsNamespace('page', { backgroundTheme: DEFAULT_PAGE_THEME_KEY });
  const pageBackgroundClass = usePageThemeClass(pageSettings?.backgroundTheme);
  const isAdmin = role === 'admin' || role === 'lockdown';
  const isLockdown = role === 'lockdown';

  const loadSnapshot = useCallback(async () => {
    if (!isLockdown) {
      setSnapshot(null);
      return;
    }
    setLoadingError('');
    try {
      setSnapshot(await getAdminSnapshot(socket));
    } catch (error) {
      setLoadingError(error.message);
    }
  }, [isLockdown, socket]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot, connected]);

  const runSensitive = useCallback(async (operation) => {
    try {
      return await operation();
    } catch (error) {
      if (error.code !== 'PASSWORD_CONFIRMATION_REQUIRED') throw error;
      /*
        Suspend exactly the rejected operation. After password confirmation the
        same closure reruns with its original revision and payload, so normal
        conflict detection still protects against changes made while waiting.
      */
      return new Promise((resolve, reject) => {
        pendingSensitiveAction.current = { operation, resolve, reject };
        setConfirmationError('');
        setConfirmationOpen(true);
      });
    }
  }, []);

  async function submitPasswordConfirmation(password) {
    setConfirmationBusy(true);
    setConfirmationError('');
    try {
      await confirmAdminPassword(socket, password);
      const pending = pendingSensitiveAction.current;
      pendingSensitiveAction.current = null;
      setConfirmationOpen(false);
      if (pending) {
        try {
          pending.resolve(await pending.operation());
        } catch (error) {
          pending.reject(error);
        }
      }
    } catch (error) {
      setConfirmationError(error.message);
    } finally {
      setConfirmationBusy(false);
    }
  }

  function cancelPasswordConfirmation() {
    const pending = pendingSensitiveAction.current;
    pendingSensitiveAction.current = null;
    setConfirmationOpen(false);
    if (pending) pending.reject(new Error('Sensitive action cancelled.'));
  }

  function selectSection(key) {
    setSearchParams(key === 'overview' ? {} : { section: key });
  }

  const navigationOptions = TOP_LEVEL_SECTIONS.filter((entry) => !entry.lockdownOnly || isLockdown);
  const activeSection = navigationOptions.some((entry) => entry.key === selected) ? selected : 'overview';

  let content;
  if (!isAdmin) {
    content = <div className="mx-auto w-full max-w-md"><AuthPanel /></div>;
  } else if (activeSection === 'fleet') {
    content = <AdminPanelContent />;
  } else if (!isLockdown) {
    content = (
      <CardFrame title="Administrator access" bodyClassName="p-1 text-sm text-slate-300">
        <p>Routine fleet operations are available. Configuration, users, secrets, and system administration require a lockdown administrator.</p>
      </CardFrame>
    );
  } else if (!snapshot) {
    content = <CardFrame title="Loading administration" bodyClassName="p-1 text-sm text-slate-300"><p>{loadingError || 'Loading configuration and audit state…'}</p></CardFrame>;
  } else if (activeSection === 'users') {
    content = (
      <div className="space-y-0.5">
        <AdministratorAccounts administrators={snapshot.administrators} socket={socket} runSensitive={runSensitive} onSnapshot={setSnapshot} />
        <IdentityDatabasePanel />
      </div>
    );
  } else if (activeSection === 'configuration') {
    content = <ConfigurationEditor snapshot={snapshot} socket={socket} runSensitive={runSensitive} onSnapshot={setSnapshot} onReload={loadSnapshot} />;
  } else {
    content = <AdminOverview snapshot={snapshot} socket={socket} runSensitive={runSensitive} onSnapshot={setSnapshot} />;
  }

  return (
    <div className={`${pageBackgroundClass} min-h-screen text-slate-100`}>
      <SocketConnectionPill />
      <PasswordConfirmationDialog open={confirmationOpen} busy={confirmationBusy} error={confirmationError} onCancel={cancelPasswordConfirmation} onConfirm={submitPasswordConfirmation} />
      <main className="mx-auto min-h-screen w-full max-w-[100rem] p-1">
        <CardFrame title="MultiRover administration" meta={connected ? role : 'offline'} bodyClassName="p-0.5 text-xs text-slate-400">
          <p>{snapshot ? `Active configuration revision ${snapshot.configuration.revision}.${snapshot.restartRequired ? ' An application restart is required to apply saved changes.' : ' The running application has loaded this revision.'}` : 'Central server administration and configuration.'}</p>
        </CardFrame>
        {isAdmin ? (
          <Tabs currentTab={activeSection} onTabChange={selectSection}>
            {/* Reusing the same responsive tab surface as the driver page makes
                administration feel like another MultiRover workspace instead
                of a separate desktop-oriented application. */}
            <nav aria-label="Administration sections">
              <TabList className="my-0.5">
                {navigationOptions.map((entry) => <Tab key={entry.key} id={entry.key}>{entry.label}</Tab>)}
              </TabList>
            </nav>
            <TabPanels><section className="min-w-0">{content}</section></TabPanels>
          </Tabs>
        ) : <section className="mt-0.5 min-w-0">{content}</section>}
      </main>
    </div>
  );
}
