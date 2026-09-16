// First-Run Setup Application
// Purpose: Initializes a fresh server or imports an explicitly selected YAML configuration file through the restricted setup channel.
// Scope: Exists only while the server reports setup required; ordinary administration belongs to /admin.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CardFrame from '../components/CardFrame/index.jsx';
import SocketConnectionPill from '../components/SocketConnectionPill/index.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { createFirstAdministrator, getSetupStatus, importConfigurationFile } from './api.js';

export default function SetupApp() {
  const socket = useSocket();
  const [required, setRequired] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const [username, setUsername] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [configurationFile, setConfigurationFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getSetupStatus(socket).then((response) => setRequired(response.required)).catch((error) => setMessage(error.message));
  }, [socket]);

  async function run(work) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      setRequired(false);
      setMessage('Setup completed. You can now open the administration application and log in.');
    } catch (error) {
      const details = Array.isArray(error.validationErrors)
        ? ` ${error.validationErrors.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`
        : '';
      setMessage(`${error.message}${details}`);
    } finally {
      setBusy(false);
    }
  }

  function createAdministrator(event) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }
    run(() => createFirstAdministrator(socket, { setupCode, username, discordId, password }));
  }

  function importSelectedConfiguration(event) {
    event.preventDefault();
    if (!configurationFile) return;
    run(async () => importConfigurationFile(socket, {
      setupCode,
      fileName: configurationFile.name,
      yaml: await configurationFile.text(),
    }));
  }

  return (
    <div className="min-h-screen bg-neutral-950 p-1 text-slate-100">
      <SocketConnectionPill />
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-0.5">
        <CardFrame title="MultiRover setup" meta={required === null ? 'checking' : required ? 'required' : 'complete'} bodyClassName="space-y-0.5 p-1 text-sm">
          {required ? <p>Enter the one-time code from setup-code.txt in the server data folder, then create the first lockdown administrator or import an existing configuration.</p> : null}
          {required === false ? <Link className="button-dark inline-block" to="/admin">Open administration</Link> : null}
          {message ? <p className="surface p-1 text-sm text-slate-200">{message}</p> : null}
        </CardFrame>

        {required ? (
          <>
            <CardFrame title="Setup authorization" bodyClassName="p-1">
              <label className="block text-xs font-semibold text-slate-200">One-time setup code</label>
              <input className="field-input mt-0.5 w-full font-mono" value={setupCode} onChange={(event) => setSetupCode(event.target.value)} />
            </CardFrame>
            <CardFrame title="Create first administrator" bodyClassName="p-1">
              <form className="grid gap-0.5 md:grid-cols-2" onSubmit={createAdministrator}>
                <input className="field-input" placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} />
                <input className="field-input" placeholder="Discord id (optional)" value={discordId} onChange={(event) => setDiscordId(event.target.value)} />
                <input className="field-input" type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
                <input className="field-input" type="password" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                <button className="button-dark md:col-span-2" type="submit" disabled={busy || !setupCode || !username || !password}>Create lockdown administrator</button>
              </form>
            </CardFrame>
            <CardFrame title="Import configuration file" bodyClassName="space-y-0.5 p-1 text-sm">
              <p className="text-xs text-slate-400">Choose an existing YAML configuration explicitly. The server validates and imports it once, and its secrets are never displayed back in the browser.</p>
              <form className="flex flex-col gap-0.5 md:flex-row" onSubmit={importSelectedConfiguration}>
                <input className="field-input flex-1" type="file" accept=".yaml,.yml,text/yaml" onChange={(event) => setConfigurationFile(event.target.files?.[0] || null)} />
                <button className="button-dark" type="submit" disabled={busy || !setupCode || !configurationFile}>Import selected YAML</button>
              </form>
            </CardFrame>
          </>
        ) : null}
      </main>
    </div>
  );
}
