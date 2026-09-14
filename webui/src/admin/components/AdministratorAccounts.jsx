// Administrator Accounts
// Purpose: Provides lockdown administrators with explicit account creation, editing, password replacement, and deletion controls.
// Scope: Never receives or displays password hashes; final-lockdown safety is enforced by the server.
import { useEffect, useState } from 'react';
import CardFrame from '../../components/CardFrame/index.jsx';
import { createAdministrator, deleteAdministrator, updateAdministrator } from '../api.js';

function AdministratorRow({ administrator, socket, runSensitive, onSnapshot }) {
  const [draft, setDraft] = useState({
    username: administrator.username,
    discordId: administrator.discordId,
    role: administrator.role,
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft({ username: administrator.username, discordId: administrator.discordId, role: administrator.role, password: '' });
  }, [administrator]);

  async function perform(work) {
    setBusy(true);
    setError('');
    try {
      const response = await runSensitive(work);
      onSnapshot(response.snapshot);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface space-y-0.5 p-0.5">
      <div className="grid gap-0.5 md:grid-cols-4">
        <input className="field-input" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
        <input className="field-input" placeholder="Discord id" value={draft.discordId} onChange={(event) => setDraft({ ...draft, discordId: event.target.value })} />
        <select className="field-input" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>
          <option value="admin">Administrator</option>
          <option value="lockdown">Lockdown administrator</option>
        </select>
        <input className="field-input" type="password" autoComplete="new-password" placeholder="New password (optional)" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
      </div>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex justify-end gap-0.5">
        <button type="button" className="button-danger text-xs" disabled={busy} onClick={() => perform(() => deleteAdministrator(socket, administrator.id))}>Delete</button>
        <button type="button" className="button-dark text-xs" disabled={busy} onClick={() => perform(() => updateAdministrator(socket, { id: administrator.id, ...draft }))}>Save account</button>
      </div>
    </div>
  );
}

export default function AdministratorAccounts({ administrators, socket, runSensitive, onSnapshot }) {
  const [draft, setDraft] = useState({ username: '', discordId: '', role: 'admin', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await runSensitive(() => createAdministrator(socket, draft));
      onSnapshot(response.snapshot);
      setDraft({ username: '', discordId: '', role: 'admin', password: '' });
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardFrame title="Administrator accounts" meta={administrators.length} bodyClassName="space-y-0.5 p-0.5 text-sm">
      <form className="surface grid gap-0.5 p-0.5 md:grid-cols-4" onSubmit={create}>
        <input className="field-input" placeholder="Username" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
        <input className="field-input" placeholder="Discord id (optional)" value={draft.discordId} onChange={(event) => setDraft({ ...draft, discordId: event.target.value })} />
        <select className="field-input" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>
          <option value="admin">Administrator</option>
          <option value="lockdown">Lockdown administrator</option>
        </select>
        <input className="field-input" type="password" autoComplete="new-password" placeholder="Password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
        {error ? <p className="text-xs text-red-300 md:col-span-3">{error}</p> : <span className="md:col-span-3" />}
        <button className="button-dark" type="submit" disabled={busy || !draft.username || !draft.password}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      {(administrators || []).map((administrator) => (
        <AdministratorRow key={administrator.id} administrator={administrator} socket={socket} runSensitive={runSensitive} onSnapshot={onSnapshot} />
      ))}
    </CardFrame>
  );
}
