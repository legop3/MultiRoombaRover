// Identity Database Panel
// Purpose: Implements the lockdown-admin identity database editor UI for the /database route.
// Scope: Keeps list, detail, signal, status, feature-state, and raw JSON editing local to this feature.
import { useCallback, useEffect, useMemo, useState } from 'react';
import CardFrame from '../components/CardFrame/index.jsx';
import Tabs, { Tab, TabList, TabPanel, TabPanels } from '../components/Tabs/index.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import {
  addSignal,
  deleteFeatureState,
  getUser,
  listUsers,
  removeSignal,
  setDeterrence,
  setVerified,
  updateFeatureState,
} from './identityDatabaseApi.js';
import {
  SIGNAL_FIELDS,
  SIGNAL_LABELS,
  formatDateTime,
  maskValue,
  parseEditableJson,
  stringifyJson,
  userMatchesFilter,
  userMatchesQuery,
} from './identityDatabaseUtils.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'verified', label: 'Verified' },
  { key: 'deterred', label: 'Deterred' },
  { key: 'unverified', label: 'Unverified' },
];

function StatusPill({ active, children }) {
  return (
    <span className={`rounded px-1 py-0.25 text-[0.68rem] font-semibold ${active ? 'bg-emerald-700 text-emerald-50' : 'bg-neutral-800 text-neutral-300'}`}>
      {children}
    </span>
  );
}

function UserListCard({ users, selectedUserId, query, filter, loading, onQuery, onFilter, onRefresh, onSelect }) {
  const filtered = useMemo(
    () => users.filter((user) => userMatchesFilter(user, filter) && userMatchesQuery(user, query)),
    [filter, query, users],
  );

  const actions = (
    <button type="button" className="button-dark text-xs" onClick={onRefresh} disabled={loading}>
      {loading ? 'Loading' : 'Refresh'}
    </button>
  );

  return (
    <CardFrame title="Identity database" meta={filtered.length} actions={actions} bodyClassName="flex min-h-0 flex-col gap-0.5 p-0.5 text-sm">
      <div className="grid gap-0.5 md:grid-cols-[minmax(0,1fr)_10rem]">
        <input
          className="field-input text-sm"
          type="search"
          placeholder="Search users, keys, fingerprints, IPs"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <select className="field-input text-sm" value={filter} onChange={(event) => onFilter(event.target.value)}>
          {FILTERS.map((entry) => (
            <option key={entry.key} value={entry.key}>{entry.label}</option>
          ))}
        </select>
      </div>
      <div className="min-h-[18rem] flex-1 overflow-y-auto">
        {filtered.length ? filtered.map((user) => (
          <button
            key={user.id}
            type="button"
            className={`surface mb-0.5 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-0.5 px-1 py-0.75 text-left text-xs ${selectedUserId === user.id ? 'border border-sky-400/70' : ''}`}
            onClick={() => onSelect(user.id)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-100">{user.nickname || 'unknown user'}</span>
              <span className="block truncate font-mono text-[0.68rem] text-slate-400">{user.id}</span>
              <span className="block truncate text-[0.68rem] text-slate-400">{maskValue(user.cookieUserIds?.[0])} / {maskValue(user.fingerprintIds?.[0])}</span>
            </span>
            <span className="flex flex-col items-end gap-0.25">
              <StatusPill active={user.verified?.enabled}>verified</StatusPill>
              <StatusPill active={user.deterrence?.enabled}>deterred</StatusPill>
            </span>
          </button>
        )) : (
          <p className="surface p-1 text-center text-xs text-slate-400">No users match this view.</p>
        )}
      </div>
    </CardFrame>
  );
}

function UserDetailsCard({ user }) {
  return (
    <CardFrame title="User details" bodyClassName="grid gap-0.5 p-0.5 text-sm md:grid-cols-2">
      <div className="surface px-1 py-0.75">
        <p className="text-xs text-slate-400">Canonical user id</p>
        <p className="break-all font-mono text-xs text-lime-300">{user.id}</p>
      </div>
      <div className="surface px-1 py-0.75">
        <p className="text-xs text-slate-400">Primary nickname</p>
        <p className="font-semibold text-slate-100">{user.nickname || 'unknown user'}</p>
      </div>
      <div className="surface px-1 py-0.75">
        <p className="text-xs text-slate-400">Created</p>
        <p>{formatDateTime(user.createdAt)}</p>
      </div>
      <div className="surface px-1 py-0.75">
        <p className="text-xs text-slate-400">Last seen</p>
        <p>{formatDateTime(user.lastSeenAt)}</p>
      </div>
    </CardFrame>
  );
}

function SignalEditor({ user, type, onAdd, onRemove }) {
  const [draft, setDraft] = useState('');
  const values = user?.[SIGNAL_FIELDS[type]] || [];

  const submit = async (event) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    await onAdd(type, value);
    setDraft('');
  };

  return (
    <div className="surface space-y-0.5 px-1 py-0.75">
      <p className="text-xs font-semibold text-slate-200">{SIGNAL_LABELS[type]}</p>
      <div className="space-y-0.5">
        {values.length ? values.map((value) => (
          <div key={value} className="surface-muted grid grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 px-1 py-0.5">
            <span className="min-w-0 break-all font-mono text-[0.7rem] text-slate-200">{value}</span>
            <button type="button" className="button-dark text-xs" onClick={() => onRemove(type, value)}>Remove</button>
          </div>
        )) : <p className="text-xs text-slate-500">No values.</p>}
      </div>
      <form className="grid gap-0.5 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submit}>
        <input
          className="field-input text-xs"
          value={draft}
          placeholder={`Add ${SIGNAL_LABELS[type].toLowerCase()}`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="button-dark text-xs" disabled={!draft.trim()}>Add</button>
      </form>
    </div>
  );
}

function SignalsCard({ user, onAddSignal, onRemoveSignal }) {
  return (
    <CardFrame title="Identity signals" bodyClassName="grid gap-0.5 p-0.5 text-sm xl:grid-cols-2">
      {Object.keys(SIGNAL_LABELS).map((type) => (
        <SignalEditor key={type} user={user} type={type} onAdd={onAddSignal} onRemove={onRemoveSignal} />
      ))}
    </CardFrame>
  );
}

function StatusCard({ user, onVerified, onDeterrence }) {
  const [reason, setReason] = useState(user?.deterrence?.reason || '');

  useEffect(() => {
    setReason(user?.deterrence?.reason || '');
  }, [user?.deterrence?.reason, user?.id]);

  return (
    <CardFrame title="Status" bodyClassName="grid gap-0.5 p-0.5 text-sm md:grid-cols-2">
      <div className="surface space-y-0.5 px-1 py-0.75">
        <p className="text-xs text-slate-400">Verification</p>
        <label className="flex items-center gap-0.5 text-slate-100">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-emerald-500"
            checked={Boolean(user?.verified?.enabled)}
            onChange={(event) => onVerified(event.target.checked)}
          />
          <span>Verified</span>
        </label>
        <p className="text-xs text-slate-500">Updated {formatDateTime(user?.verified?.at)}</p>
      </div>
      <div className="surface space-y-0.5 px-1 py-0.75">
        <p className="text-xs text-slate-400">Deterrence</p>
        <label className="flex items-center gap-0.5 text-slate-100">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-red-500"
            checked={Boolean(user?.deterrence?.enabled)}
            onChange={(event) => onDeterrence(event.target.checked, reason)}
          />
          <span>Deterred</span>
        </label>
        <textarea
          className="field-input min-h-[4rem] w-full text-xs"
          value={reason}
          placeholder="Deterrence reason"
          onChange={(event) => setReason(event.target.value)}
        />
        <button type="button" className="button-dark text-xs" onClick={() => onDeterrence(Boolean(user?.deterrence?.enabled), reason)}>
          Save Reason
        </button>
      </div>
    </CardFrame>
  );
}

function FeatureStateCard({ user, onSaveFeature, onDeleteFeature }) {
  const namespaces = useMemo(() => Object.keys(user?.features || {}).sort(), [user?.features]);
  const [namespace, setNamespace] = useState('');
  const [text, setText] = useState('{}');
  const [error, setError] = useState('');

  useEffect(() => {
    const nextNamespace = namespaces.includes(namespace) ? namespace : namespaces[0] || '';
    setNamespace(nextNamespace);
    setText(stringifyJson(nextNamespace ? user.features[nextNamespace] : {}));
    setError('');
  }, [namespace, namespaces, user]);

  const save = async () => {
    const ns = namespace.trim();
    if (!ns) {
      setError('Namespace required.');
      return;
    }
    try {
      const parsed = parseEditableJson(text);
      await onSaveFeature(ns, parsed);
      setError('');
    } catch (err) {
      setError(err.message || 'Invalid JSON.');
    }
  };

  const remove = async () => {
    const ns = namespace.trim();
    if (!ns) return;
    if (!window.confirm(`Delete feature state "${ns}" from ${user.id}?`)) return;
    await onDeleteFeature(ns);
  };

  return (
    <CardFrame title="Feature state" bodyClassName="space-y-0.5 p-0.5 text-sm">
      <div className="grid gap-0.5 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <input
          className="field-input text-sm"
          value={namespace}
          placeholder="Namespace"
          list="identity-feature-namespaces"
          onChange={(event) => {
            const next = event.target.value;
            setNamespace(next);
            setText(stringifyJson(user.features?.[next] || {}));
          }}
        />
        <datalist id="identity-feature-namespaces">
          {namespaces.map((entry) => <option key={entry} value={entry} />)}
        </datalist>
        <button type="button" className="button-dark text-xs" onClick={save}>Save</button>
        <button type="button" className="button-dark text-xs" onClick={remove} disabled={!namespace.trim()}>Delete</button>
      </div>
      <textarea
        className="field-input min-h-[18rem] w-full font-mono text-xs"
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? <p className="surface text-xs text-red-300">{error}</p> : null}
    </CardFrame>
  );
}

function RawRecordCard({ user }) {
  return (
    <CardFrame title="Raw record" bodyClassName="p-0.5 text-xs">
      <pre className="surface max-h-[36rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[0.7rem] text-lime-300">
        {stringifyJson(user)}
      </pre>
    </CardFrame>
  );
}

export default function IdentityDatabasePanel() {
  const socket = useSocket();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const refreshUsers = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listUsers(socket);
      setUsers(resp.users || []);
      if (selectedUser?.id) {
        const updated = await getUser(socket, selectedUser.id);
        setSelectedUser(updated.user || null);
      }
      setMessage('');
    } catch (err) {
      setMessage(err.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [selectedUser?.id, socket]);

  const selectUser = useCallback(async (userId) => {
    setLoading(true);
    try {
      const resp = await getUser(socket, userId);
      setSelectedUser(resp.user || null);
      setMessage('');
    } catch (err) {
      setMessage(err.message || 'Failed to load user.');
    } finally {
      setLoading(false);
    }
  }, [socket]);

  const applyUserUpdate = useCallback((user) => {
    setSelectedUser(user || null);
    if (!user?.id) return;
    setUsers((prev) => prev.map((entry) => (entry.id === user.id ? { ...entry, ...user } : entry)));
  }, []);

  const runMutation = useCallback(async (operation, successMessage) => {
    if (!selectedUser?.id) return;
    setLoading(true);
    try {
      const resp = await operation(selectedUser.id);
      applyUserUpdate(resp.user);
      setMessage(successMessage || 'Saved.');
    } catch (err) {
      setMessage(err.message || 'Save failed.');
    } finally {
      setLoading(false);
    }
  }, [applyUserUpdate, selectedUser?.id]);

  useEffect(() => {
    refreshUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddSignal = (type, value) =>
    runMutation((userId) => addSignal(socket, userId, type, value), 'Signal added.');
  const handleRemoveSignal = (type, value) =>
    runMutation((userId) => removeSignal(socket, userId, type, value), 'Signal removed.');
  const handleVerified = (enabled) =>
    runMutation((userId) => setVerified(socket, userId, enabled), 'Verification updated.');
  const handleDeterrence = (enabled, reason) =>
    runMutation((userId) => setDeterrence(socket, userId, enabled, reason), 'Deterrence updated.');
  const handleSaveFeature = (namespace, value) =>
    runMutation((userId) => updateFeatureState(socket, userId, namespace, value), 'Feature state saved.');
  const handleDeleteFeature = (namespace) =>
    runMutation((userId) => deleteFeatureState(socket, userId, namespace), 'Feature state deleted.');

  return (
    <div className="grid min-h-0 flex-1 gap-0.5 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <UserListCard
        users={users}
        selectedUserId={selectedUser?.id || null}
        query={query}
        filter={filter}
        loading={loading}
        onQuery={setQuery}
        onFilter={setFilter}
        onRefresh={refreshUsers}
        onSelect={selectUser}
      />
      <div className="min-h-0 space-y-0.5 overflow-y-auto">
        {message ? <CardFrame title="Status" bodyClassName="p-0.5 text-sm text-slate-200"><p>{message}</p></CardFrame> : null}
        {selectedUser ? (
          <>
            <UserDetailsCard user={selectedUser} />
            <Tabs defaultTab="signals">
              <TabList>
                <Tab id="signals">Signals</Tab>
                <Tab id="status">Status</Tab>
                <Tab id="features">Feature state</Tab>
                <Tab id="raw">Raw JSON</Tab>
              </TabList>
              <TabPanels>
                <TabPanel id="signals">
                  <SignalsCard user={selectedUser} onAddSignal={handleAddSignal} onRemoveSignal={handleRemoveSignal} />
                </TabPanel>
                <TabPanel id="status">
                  <StatusCard user={selectedUser} onVerified={handleVerified} onDeterrence={handleDeterrence} />
                </TabPanel>
                <TabPanel id="features">
                  <FeatureStateCard user={selectedUser} onSaveFeature={handleSaveFeature} onDeleteFeature={handleDeleteFeature} />
                </TabPanel>
                <TabPanel id="raw">
                  <RawRecordCard user={selectedUser} />
                </TabPanel>
              </TabPanels>
            </Tabs>
          </>
        ) : (
          <CardFrame title="User details" bodyClassName="p-1 text-center text-sm text-slate-400">
            Select a user to inspect and edit the identity record.
          </CardFrame>
        )}
      </div>
    </div>
  );
}
