import { useEffect, useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';

function request(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Server disconnected'));
    socket.timeout(35000).emit(event, payload, (error, response) => {
      if (error || response?.error) reject(new Error(response?.error || 'Request timed out; reconnect and check the rover configuration.'));
      else resolve(response);
    });
  });
}

function fields(schema, prefix = []) {
  return Object.entries(schema?.properties || {}).flatMap(([key, child]) => {
    const path = [...prefix, key];
    return child.type === 'object' ? fields(child, path) : [{ path, label: path.join(' / ') }];
  });
}

function RoverForm({ socket, record, online }) {
  const [draft, setDraft] = useState(() => structuredClone(record.config));
  const [field, setField] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState([]);
  const options = fields(record.schema);
  async function save(all) {
    setBusy(true);
    setMessage('');
    setResults([]);
    try {
      if (all) {
        const path = JSON.parse(field);
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
    <p role="status">{message}</p>
    {results.length > 0 && <ul>{results.map((result) => <li key={result.roverId}>{result.roverId}: {result.success ? 'Saved' : result.error}</li>)}</ul>}
    <fieldset disabled={busy || !online} className="space-y-2">
      <Form schema={record.schema} formData={draft} validator={validator}
        onChange={({ formData }) => setDraft(formData)} onSubmit={() => save(false)}>
        <button type="submit" className="button-dark">Save to this rover</button>
      </Form>
      <label className="block">Field to apply to all connected rovers
        <select className="block bg-slate-900 text-slate-100" value={field} onChange={(event) => setField(event.target.value)}>
          <option value="">Select a field</option>
          {options.map(({ path, label }) => <option key={JSON.stringify(path)} value={JSON.stringify(path)}>{label}</option>)}
        </select>
      </label>
      <button type="button" className="button-dark" disabled={!field} onClick={() => save(true)}>Apply this field to all rovers</button>
    </fieldset>
  </div>;
}

export default function RoverConfigurationEditor({ socket }) {
  const [records, setRecords] = useState({});
  const [selected, setSelected] = useState('');
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
    socket.on('roverManagement:changed', changed);
    socket.on('roverManagement:offline', offline);
    socket.on('connect', refresh);
    socket.on('disconnect', disconnected);
    refresh();
    return () => {
      active = false;
      socket.off('roverManagement:changed', changed);
      socket.off('roverManagement:offline', offline);
      socket.off('connect', refresh);
      socket.off('disconnect', disconnected);
    };
  }, [socket]);
  const id = selected || Object.keys(records)[0] || '';
  const record = records[id];
  return <div className="p-2 space-y-3">
    <h2 className="text-lg">Rover configuration</h2>
    {error && <p role="alert">{error}</p>}
    <label>Rover <select className="bg-slate-900 text-slate-100" value={id} onChange={(event) => setSelected(event.target.value)}>
      {!id && <option value="">No management connections</option>}
      {Object.values(records).map((entry) => <option key={entry.roverId} value={entry.roverId}>{entry.roverId}{entry.online ? '' : ' (offline)'}</option>)}
    </select></label>
    {record && <RoverForm key={`${id}:${JSON.stringify(record.config)}`} socket={socket} record={record} online={record.online} />}
  </div>;
}
