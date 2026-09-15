// Complete Configuration Editor
// Purpose: Connects the one hierarchical configuration form to revision, secret, validation, and save behavior.
// Scope: Edits and saves one complete configuration document as one immutable revision.
import { useEffect, useMemo, useRef, useState } from 'react';
import CardFrame from '../../components/CardFrame/index.jsx';
import { importAdminConfigurationFile, updateConfiguration } from '../api.js';
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
  const [importing, setImporting] = useState(false);
  const [configurationFile, setConfigurationFile] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const editorRef = useRef(null);
  const toolbarRef = useRef(null);

  useEffect(() => {
    setDraft(clone(serverValue));
    setSecretOperations({});
    setError('');
    setConfigurationFile(null);
    setValidationErrors([]);
  }, [revision, serverValue]);

  useEffect(() => {
    const editor = editorRef.current;
    const toolbar = toolbarRef.current;
    if (!editor || !toolbar) return undefined;

    /*
      The action toolbar can wrap differently at each viewport width, so a
      fixed CSS offset would eventually let section headings overlap it. Feed
      its real rendered height into one local CSS variable instead; every
      sticky configuration CardFrame can then meet the toolbar exactly.
    */
    const updateStickyOffset = () => {
      editor.style.setProperty('--configuration-sticky-top', `${toolbar.offsetHeight}px`);
    };
    updateStickyOffset();

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateStickyOffset)
      : null;
    observer?.observe(toolbar);
    window.addEventListener('resize', updateStickyOffset);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateStickyOffset);
      editor.style.removeProperty('--configuration-sticky-top');
    };
  }, [serverValue, schema]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(serverValue) || Object.keys(secretOperations).length > 0,
    [draft, secretOperations, serverValue],
  );
  const busy = saving || importing;

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

  async function importSelectedConfiguration() {
    if (!configurationFile) return;
    /*
      Import replaces the complete draft and applies it immediately, so the
      confirmation names both consequences before reading or transmitting the
      operator-selected file. Administrator accounts remain owned by the
      initialized database and are never imported from this screen.
    */
    const confirmed = window.confirm(
      'Replace the current configuration with this YAML file and apply it now? Any unsaved edits will be discarded. Administrator accounts in the file will be ignored.',
    );
    if (!confirmed) return;

    setImporting(true);
    setError('');
    setNotice('');
    setValidationErrors([]);
    try {
      const yamlText = await configurationFile.text();
      const response = await runSensitive(() => importAdminConfigurationFile(socket, {
        fileName: configurationFile.name,
        yaml: yamlText,
        expectedRevision: revision,
      }));
      onSnapshot(response.snapshot);
      setNotice(response.ignoredAdministratorCount > 0
        ? `Configuration imported and applied. ${response.ignoredAdministratorCount} administrator entr${response.ignoredAdministratorCount === 1 ? 'y was' : 'ies were'} ignored.`
        : 'Configuration imported and applied.');
    } catch (importError) {
      setError(importError.message);
      setValidationErrors(importError.validationErrors || []);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div ref={editorRef} className="configuration-editor">
      <CardFrame title="Configuration" meta={`revision ${revision}`} clipOverflow={false} bodyClassName="p-0.5">
        <div ref={toolbarRef} className="configuration-toolbar sticky top-0 z-20 mb-0.5 space-y-0.5 border border-neutral-500/60 bg-neutral-900/95 p-0.5 backdrop-blur">
          <p className="text-xs text-slate-400">Saving applies the complete revision immediately and reloads each affected service.</p>
          {/* All document actions stay together at the start of the toolbar. The
              editor may use a wide canvas, but width is never used to separate a
              control from the content that explains it. */}
          <div className="flex flex-wrap gap-0.5">
            <button type="button" className="button-dark" disabled={busy} onClick={onReload}>Reload</button>
            <button type="button" className="button-dark" disabled={!dirty || busy} onClick={() => {
              setDraft(clone(serverValue));
              setSecretOperations({});
            }}>Reset</button>
            <button type="button" className="button-dark" disabled={!dirty || busy} onClick={save}>{saving ? 'Applying…' : 'Save configuration'}</button>
          </div>
        </div>
      <CardFrame title="Import legacy YAML" bodyClassName="space-y-0.5 p-1 text-sm" clipOverflow={false}>
        <p className="text-sm text-slate-300">Replace this configuration from an explicitly selected legacy file. Unknown old settings and administrator accounts are ignored; current settings are validated and applied immediately.</p>
        {/* Keep the picker and its action beside each other at the start of the
            card. The configuration canvas can be wide, but this local action
            should never be separated from the file it operates on. */}
        <div className="flex max-w-3xl flex-col gap-0.5 md:flex-row">
          <input
            key={revision}
            className="field-input min-w-0 flex-1"
            type="file"
            accept=".yaml,.yml,text/yaml"
            disabled={busy}
            onChange={(event) => setConfigurationFile(event.target.files?.[0] || null)}
          />
          <button type="button" className="button-dark" disabled={busy || !configurationFile} onClick={importSelectedConfiguration}>
            {importing ? 'Importing…' : 'Import selected YAML'}
          </button>
        </div>
      </CardFrame>
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
      {notice ? <p className="border border-emerald-500/60 bg-emerald-950/40 p-1 text-sm text-emerald-100">{notice}</p> : null}
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
    </div>
  );
}
