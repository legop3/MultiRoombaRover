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

function label(key) { return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()); }

function fieldUI(schema, path = []) {
  const ui = { 'ui:title': path.length ? label(path.at(-1)) : '', 'ui:options': { path } };
  if (schema.type === 'string') ui['ui:emptyValue'] = '';
  for (const [key, child] of Object.entries(schema.properties || {})) ui[key] = fieldUI(child, [...path, key]);
  return ui;
}

function FieldLayout({ id, label: title, children, errors, help, description, schema, uiSchema, registry }) {
  const path = uiSchema?.['ui:options']?.path || [];
  const object = schema.type === 'object';
  return <div className={object ? 'min-w-0' : 'space-y-2 py-3 border-b border-slate-700/50'}>
    {!object && <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="font-medium text-sm">{title}</label>
      <button type="button" className="text-xs text-sky-300 hover:underline disabled:opacity-40"
        disabled={registry.formContext.busy || !registry.formContext.online}
        onClick={() => registry.formContext.applyField(path)}>Apply to all rovers</button>
    </div>}
    {description}{children}{errors}{help}
  </div>;
}

function ObjectLayout({ title, properties, uiSchema, registry }) {
  const path = uiSchema?.['ui:options']?.path || [];
  const content = <div className="space-y-3">{properties.map((property) => <div key={property.name}>{property.content}</div>)}
    {path.length === 2 && path[0] === 'media' && path[1] !== 'rtspPort'
      && <MediaProfiles {...registry.formContext} category={path[1]} />}
  </div>;
  if (!path.length) return content;
  return <details className="rounded-lg border border-slate-700 bg-slate-900/40 p-4" open={path[0] === 'media'}>
    <summary className="cursor-pointer font-semibold mb-3">{title}</summary>{content}
  </details>;
}

// Required boolean properties may be false; HTML required checkboxes may not.
function BooleanInput({ id, value, disabled, readonly, onChange }) {
  return <input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled || readonly}
    onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-sky-500" />;
}
const widgets = { CheckboxWidget: BooleanInput };

const templates = { FieldTemplate: FieldLayout, ObjectFieldTemplate: ObjectLayout };

function RoverForm({ socket, record, online }) {
  const [draft, setDraft] = useState(() => structuredClone(record.config));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState([]);
  const schema = structuredClone(record.schema);
  const uiSchema = fieldUI(schema);
  for (const category of ['video', 'audioCapture', 'audioPlayback']) {
    const property = schema.properties?.media?.properties?.[category]?.properties?.profile;
    const profiles = record.profiles?.[category] || [];
    if (property) {
      // Explicit enum/select avoids rendering profile identifiers as free text.
      const choices = profiles.map((profile) => ({ id: profile.id, name: profile.name }));
      const current = draft.media?.[category]?.profile;
      if (current && !choices.some((entry) => entry.id === current)) choices.push({ id: current, name: `${current} (unavailable)` });
      property.enum = choices.map((entry) => entry.id);
      uiSchema.media[category].profile['ui:widget'] = 'select';
      uiSchema.media[category].profile['ui:enumNames'] = choices.map((entry) => entry.name);
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
    <fieldset disabled={busy || !online} className="space-y-2">
      <Form schema={schema} uiSchema={uiSchema} templates={templates} widgets={widgets} noHtml5Validate
        formContext={{ socket, record, online, busy, configDirty: JSON.stringify(draft) !== JSON.stringify(record.config), applyField: save }}
        className="rover-config-form" formData={draft} validator={validator}
        onChange={({ formData }) => setDraft(formData)} onSubmit={() => save()}>
        <div className="sticky bottom-0 bg-slate-900 border-t border-slate-700 p-3 mt-4">
          <button type="submit" className="button-dark">Save configuration to this rover</button>
        </div>
      </Form>
    </fieldset>
  </div>;
}

function MediaProfiles({ socket, record, online, category, configDirty }) {
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
  return <div className="space-y-3 pt-3">
    {(record.profiles?.[category] || []).map((entry) => <p key={entry.id}>{entry.name}: {entry.description}</p>)}
    <p>Status: {record.mediaStatus?.[category] || (online ? 'Waiting for status' : 'Offline')}</p>
    <details className="rounded border border-slate-600 p-3">
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
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{(record.notices || [])
      .filter((event) => event.event?.startsWith('media.') && event.data?.category === category)
      .map((event) => `${event.event === 'media.status' ? '[status] ' : ''}${event.data?.message || ''}`).join('\n')}</pre></details>
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
        ...previous[roverId], mediaStatus: event.event === 'media.status'
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
  return <div id="fleet-configuration" className="space-y-4 scroll-mt-4">
    <h2 className="text-lg font-semibold">Configure rover</h2>
    {error && <p role="alert">{error}</p>}
    <label>Rover <select className="bg-slate-900 text-slate-100" value={id} onChange={(event) => onSelect(event.target.value)}>
      {!id && <option value="">No management connections</option>}
      {Object.values(records).map((entry) => <option key={entry.roverId} value={entry.roverId}>{entry.roverId}{entry.online ? '' : ' (offline)'}</option>)}
    </select></label>
    {record && <RoverForm key={`${id}:${JSON.stringify(record.config)}`} socket={socket} record={record} online={record.online} />}
  </div>;
}
