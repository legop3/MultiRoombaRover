// Schema-Generated Configuration Form
// Purpose: Renders the server-provided JSON Schema as one hierarchical form without feature-specific React components.
// Scope: Adds only the generic secret interaction that ordinary JSON Schema form controls cannot safely infer.
import { useMemo } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';

function buildUiSchema(schema, path = '') {
  /*
    `writeOnly` is standard JSON Schema metadata and is the sole reason a field
    needs a special widget. The walk records its dotted path for the existing
    server secret-operation protocol; it contains no service or field names.
  */
  if (!schema || typeof schema !== 'object') return {};
  if (schema.writeOnly === true) {
    return {
      'ui:widget': 'SecretWidget',
      'ui:options': { secretPath: path },
    };
  }

  if (schema.type !== 'object' || !schema.properties) return {};
  return Object.fromEntries(Object.entries(schema.properties).map(([key, childSchema]) => [
    key,
    buildUiSchema(childSchema, path ? `${path}.${key}` : key),
  ]));
}

function SecretWidget({ id, disabled, readonly, options, registry }) {
  const secretPath = options.secretPath;
  const context = registry.formContext || {};
  const operation = context.secretOperations?.[secretPath];
  const configured = Boolean(context.configuredSecrets?.[secretPath]);
  const replacing = operation?.action === 'replace';
  const clearing = operation?.action === 'clear';
  const unavailable = disabled || readonly;

  function setOperation(nextOperation) {
    if (!unavailable) context.setSecretOperation?.(secretPath, nextOperation);
  }

  return (
    <div className="surface space-y-0.5 p-0.5">
      <div className="flex flex-wrap items-center justify-between gap-0.5">
        <span className="text-[0.7rem] text-slate-500">
          {clearing ? 'Will be cleared when saved' : replacing ? 'Replacement pending' : configured ? 'Configured' : 'Not configured'}
        </span>
        <div className="flex gap-0.5">
          <button type="button" className="button-dark text-xs" disabled={unavailable} onClick={() => setOperation(replacing ? null : { action: 'replace', value: '' })}>
            {replacing ? 'Cancel replace' : 'Replace'}
          </button>
          <button type="button" className={clearing ? 'button-dark text-xs' : 'button-danger text-xs'} disabled={unavailable} onClick={() => setOperation(clearing ? null : { action: 'clear' })}>
            {clearing ? 'Undo clear' : 'Clear'}
          </button>
        </div>
      </div>
      {replacing ? (
        <input
          id={id}
          className="field-input w-full"
          type="password"
          autoComplete="new-password"
          value={operation.value}
          placeholder="Enter replacement value"
          disabled={unavailable}
          onChange={(event) => setOperation({ action: 'replace', value: event.target.value })}
        />
      ) : null}
    </div>
  );
}

export default function SchemaConfigurationForm({ schema, value, onChange, configuredSecrets, secretOperations, setSecretOperation }) {
  const uiSchema = useMemo(() => buildUiSchema(schema), [schema]);
  const widgets = useMemo(() => ({ SecretWidget }), []);
  const formContext = useMemo(() => ({
    configuredSecrets,
    secretOperations,
    setSecretOperation,
  }), [configuredSecrets, secretOperations, setSecretOperation]);

  return (
    <div className="configuration-schema-form">
      <Form
        schema={schema}
        uiSchema={uiSchema}
        formData={value}
        validator={validator}
        widgets={widgets}
        formContext={formContext}
        noHtml5Validate
        showErrorList={false}
        onChange={({ formData }) => onChange(formData)}
      >
        {/* Saving is owned by the sticky revision-aware toolbar above the form. */}
        <></>
      </Form>
    </div>
  );
}
