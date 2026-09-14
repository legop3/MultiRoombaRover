// Complete Configuration Editor
// Purpose: Connects the one hierarchical configuration form to revision, secret, validation, and save behavior.
// Scope: Edits and saves one complete configuration document as one immutable revision.
import { useEffect, useMemo, useState } from 'react';
import CardFrame from '../../components/CardFrame/index.jsx';
import { updateConfiguration } from '../api.js';
import SchemaConfigurationForm from './SchemaConfigurationForm.jsx';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export default function ConfigurationEditor({ snapshot, socket, runSensitive, onSnapshot, onReload }) {
  const serverValue = snapshot?.configuration?.config;
  const schema = snapshot?.configuration?.schema;
  const revision = snapshot?.configuration?.revision;
  const [draft, setDraft] = useState(() => clone(serverValue));
  const [secretOperations, setSecretOperations] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);

  useEffect(() => {
    setDraft(clone(serverValue));
    setSecretOperations({});
    setError('');
    setValidationErrors([]);
  }, [revision, serverValue]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(serverValue) || Object.keys(secretOperations).length > 0,
    [draft, secretOperations, serverValue],
  );

  if (!serverValue || !schema) {
    return <p className="surface p-1 text-sm text-red-200">The configuration document is unavailable.</p>;
  }

  const setSecretOperation = (path, operation) => setSecretOperations((current) => {
    const next = { ...current };
    if (operation) next[path] = operation;
    else delete next[path];
    return next;
  });

  async function save() {
    setSaving(true);
    setError('');
    setValidationErrors([]);
    try {
      const response = await runSensitive(() => updateConfiguration(socket, {
        value: draft,
        expectedRevision: revision,
        secretOperations,
      }));
      onSnapshot(response.snapshot);
    } catch (saveError) {
      setError(saveError.message);
      setValidationErrors(saveError.validationErrors || []);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardFrame title="Configuration" meta={`revision ${revision}`} clipOverflow={false} bodyClassName="p-0.5">
      <div className="configuration-toolbar sticky top-0 z-20 mb-0.5 space-y-0.5 border border-neutral-500/60 bg-neutral-900/95 p-0.5 backdrop-blur">
        <p className="text-xs text-slate-400">Saving applies the complete revision immediately and reloads each affected service.</p>
        {/* All document actions stay together at the start of the toolbar. The
            editor may use a wide canvas, but width is never used to separate a
            control from the content that explains it. */}
        <div className="flex flex-wrap gap-0.5">
          <button type="button" className="button-dark" disabled={saving} onClick={onReload}>Reload</button>
          <button type="button" className="button-dark" disabled={!dirty || saving} onClick={() => {
            setDraft(clone(serverValue));
            setSecretOperations({});
          }}>Reset</button>
          <button type="button" className="button-dark" disabled={!dirty || saving} onClick={save}>{saving ? 'Applying…' : 'Save configuration'}</button>
        </div>
      </div>
      {snapshot.configurationApplication?.services?.some((service) => service.status === 'failed') ? (
        <div className="mb-0.5 border border-amber-500/60 bg-amber-950/40 p-1 text-xs text-amber-100">
          <p className="font-semibold">Configuration was saved, but some services could not reload</p>
          <ul className="mt-0.5 list-disc space-y-0.25 pl-4">
            {snapshot.configurationApplication.services
              .filter((service) => service.status === 'failed')
              .map((service, index) => <li key={`${service.section}-${index}`}>{service.section}: {service.error}</li>)}
          </ul>
        </div>
      ) : null}
      {error ? <p className="border border-red-500/60 bg-red-950/40 p-1 text-xs text-red-100">{error}</p> : null}
      {validationErrors.length ? (
        <div className="border border-red-500/60 bg-red-950/40 p-1 text-xs text-red-100">
          <p className="font-semibold">Configuration could not be saved</p>
          <ul className="mt-0.5 list-disc space-y-0.25 pl-4">
            {validationErrors.map((validationError, index) => (
              <li key={`${validationError.path}-${index}`}>{validationError.path}: {validationError.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <SchemaConfigurationForm
        schema={schema}
        value={draft}
        onChange={setDraft}
        configuredSecrets={snapshot.configuration.configuredSecrets}
        secretOperations={secretOperations}
        setSecretOperation={setSecretOperation}
      />
    </CardFrame>
  );
}
