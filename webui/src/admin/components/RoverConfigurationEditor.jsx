import { useEffect, useRef, useState } from 'react';
import SchemaConfigurationForm from './SchemaConfigurationForm.jsx';

function request(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Server disconnected'));
    socket.timeout(35000).emit(event, payload, (error, response) => {
      if (error || response?.error) reject(new Error(response?.error || 'Request timed out; reconnect and check the rover configuration.'));
      else resolve(response);
    });
  });
}

function RoverForm({ socket, record, online }) {
  const [draft, setDraft] = useState(() => structuredClone(record.config));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState([]);
  const schema = structuredClone(record.schema);
  for (const category of ['video', 'audioCapture', 'audioPlayback']) {
    const property = schema.properties?.media?.properties?.[category]?.properties?.profile;
    const profiles = record.profiles?.[category] || [];
    if (property) {
      // Explicit enum/select avoids rendering profile identifiers as free text.
      const choices = profiles.map((profile) => ({ id: profile.id, name: profile.name }));
      const current = draft.media?.[category]?.profile;
      if (current && !choices.some((entry) => entry.id === current)) choices.push({ id: current, name: `${current} (unavailable)` });
      property.oneOf = choices.map((entry) => ({ const: entry.id, title: entry.name }));
    }
  }
  async function save(path) {
    setBusy(true);
    setMessage('');
    setResults([]);
    try {
      if (path) {
        const value = path.reduce((object, key) => object?.[key], draft);
        if (value === undefined) throw new Error('Selected field has no value');
        const response = await request(socket, 'roverManagement:applyField', { path, value });
        setResults(response.results);
        setMessage(response.results.length ? 'Fleet save finished. Successful rovers restart to apply their settings.' : 'No rovers are connected.');
      } else {
        await request(socket, 'roverManagement:save', { roverId: record.roverId, config: draft });
        setMessage('Saved. Rover is restarting; its next connection reports the loaded configuration.');
      }
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <p className="text-sm">{online ? 'Management connected' : 'Management offline — edits are retained locally.'}</p>
    {record.updateStatus && <p role="status">Update: {record.updateStatus.state} — {record.updateStatus.message}</p>}
    <p role="status">{message}</p>
    {results.length > 0 && <ul>{results.map((result) => <li key={result.roverId}>{result.roverId}: {result.success ? 'Saved' : result.error}</li>)}</ul>}
    <SchemaConfigurationForm schema={schema} value={draft} onChange={setDraft} disabled={busy || !online}
      renderFieldAction={(path) => <button type="button" className="button-dark text-xs" disabled={busy || !online}
        onClick={() => save(path)}>Apply to all</button>}
      renderObjectFooter={(path) => path.length === 2 && path[0] === 'media' && record.profiles?.[path[1]]
        ? <MediaProfiles socket={socket} record={record} online={online && !busy} category={path[1]}
            configDirty={JSON.stringify(draft) !== JSON.stringify(record.config)} /> : null} />
    <button type="button" className="button-dark text-xs" disabled={busy || !online} onClick={() => save()}>Save to this rover</button>
  </div>;
}

function MediaProfiles({ socket, record, online, category, configDirty }) {
  const outputRef = useRef(null);
  const output = record.mediaOutput?.[category] || '';
  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [output]);
  const [profile, setProfile] = useState({ id: 'custom', name: '', description: '', setup: '', run: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setProfile(record.profiles?.[category]?.find((entry) => entry.id === 'custom')
      || { id: 'custom', name: '', description: '', setup: '', run: '' });
  }, [category, record.profiles]);
  async function save() {
    setBusy(true);
    try {
      await request(socket, 'roverManagement:saveProfile', { roverId: record.roverId, category, profile });
      setMessage('Custom profile saved. Rover is restarting. Select custom in the media settings to use it.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-0.5 text-xs">
    {(record.profiles?.[category] || []).map((entry) => <p key={entry.id}>{entry.name}: {entry.description}</p>)}
    <p>Status: {record.mediaStatus?.[category] || (online ? 'Waiting for status' : 'Offline')}</p>
    <details className="space-y-0.5">
    <summary className="cursor-pointer">Create or edit custom profile</summary>
    {configDirty && <p className="text-sm text-amber-300">Save configuration changes before saving a custom profile, which restarts the rover.</p>}
    <fieldset disabled={!online || busy || configDirty}>
      {['name', 'description', 'setup', 'run'].map((key) => <label key={key} className="block">{key}
        <textarea className="field-input block w-full" rows={['setup', 'run'].includes(key) ? 4 : 1}
          value={profile[key]} onChange={(event) => setProfile((previous) => ({ ...previous, [key]: event.target.value }))} />
      </label>)}
      <button type="button" className="button-dark" onClick={save}>Save custom profile</button>
    </fieldset>
    <p role="status">{message}</p>
    </details>
    <details><summary className="cursor-pointer">Streamer output</summary>
    <pre ref={outputRef} className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{output || 'Waiting for command stdout/stderr…'}</pre></details>
  </div>;
}

export default function RoverConfigurationEditor({ socket, selected, onSelect }) {
  const [records, setRecords] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    // Keep drafts mounted on disconnect. Only an authoritative new hello
    // replaces the form, including when configuration changes the rover name.
    const changed = (record) => setRecords((previous) => ({ ...previous, [record.roverId]: { ...record, online: true } }));
    const offline = ({ roverId }) => setRecords((previous) => previous[roverId]
      ? { ...previous, [roverId]: { ...previous[roverId], online: false } } : previous);
    const disconnected = () => setRecords((previous) => Object.fromEntries(Object.entries(previous).map(([id, record]) => [id, { ...record, online: false }])));
    const refresh = async () => {
      try {
        const response = await request(socket, 'roverManagement:list');
        if (!active) return;
        setError('');
        setRecords((previous) => ({
          ...Object.fromEntries(Object.entries(previous).map(([id, record]) => [id, { ...record, online: false }])),
          ...Object.fromEntries(response.rovers.map((record) => [record.roverId, { ...record, online: true }])),
        }));
      } catch (failure) { if (active) setError(failure.message); }
    };
    const mediaEvent = ({ roverId, ...event }) => {
      if (!event.event?.startsWith('media.')) return;
      setRecords((previous) => previous[roverId] ? { ...previous, [roverId]: {
        ...previous[roverId], mediaOutput: event.event === 'media.output'
          ? { ...previous[roverId].mediaOutput, [event.data.category]: ((previous[roverId].mediaOutput?.[event.data.category] || '') + (event.data.message || '')).slice(-65536) }
          : previous[roverId].mediaOutput, mediaStatus: event.event === 'media.status'
          ? { ...previous[roverId].mediaStatus, [event.data.category]: event.data.message } : previous[roverId].mediaStatus, notices: [...(previous[roverId].notices || []), event].slice(-100),
      } } : previous);
    };
    socket.on('roverManagement:event', mediaEvent);
    socket.on('roverManagement:changed', changed);
    socket.on('roverManagement:offline', offline);
    socket.on('connect', refresh);
    const updateStatus = ({ roverId, status }) => setRecords((previous) => previous[roverId]
      ? { ...previous, [roverId]: { ...previous[roverId], updateStatus: status } } : previous);
    socket.on('roverManagement:updateStatus', updateStatus);
    socket.on('disconnect', disconnected);
    refresh();
    return () => {
      active = false;
      socket.off('roverManagement:event', mediaEvent);
      socket.off('roverManagement:changed', changed);
      socket.off('roverManagement:offline', offline);
      socket.off('connect', refresh);
      socket.off('disconnect', disconnected);
      socket.off('roverManagement:updateStatus', updateStatus);
    };
  }, [socket]);
  const id = selected || Object.keys(records)[0] || '';
  const record = records[id];
  return <div id="fleet-configuration" className="space-y-0.5 scroll-mt-4">
    <h2 className="text-sm font-semibold">Configure rover</h2>
    {error && <p role="alert">{error}</p>}
    <label>Rover <select className="bg-slate-900 text-slate-100" value={id} onChange={(event) => onSelect(event.target.value)}>
      {!id && <option value="">No management connections</option>}
      {Object.values(records).map((entry) => <option key={entry.roverId} value={entry.roverId}>{entry.roverId}{entry.online ? '' : ' (offline)'}</option>)}
    </select></label>
    {record && <RoverForm key={`${id}:${JSON.stringify(record.config)}`} socket={socket} record={record} online={record.online} />}
  </div>;
}
