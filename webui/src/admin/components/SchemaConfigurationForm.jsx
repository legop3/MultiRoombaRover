// Schema-Generated Configuration Form
// Purpose: Renders the server-provided JSON Schema as an ordered, indented tree resembling the configuration's YAML structure.
// Scope: Defines one generic RJSF presentation; it never names or special-cases an individual service or setting.
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
    <div className="configuration-secret space-y-0.5">
      {/* Secret actions stay beside their status. A wide configuration card
          must not turn related controls into a trip across the screen. */}
      <div className="flex flex-wrap items-center gap-0.5">
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

function ConfigurationFieldTemplate({
  children,
  classNames,
  description,
  errors,
  help,
  hidden,
  id,
  label,
  required,
  schema,
  style,
}) {
  if (hidden) return <div className="hidden">{children}</div>;

  const containerField = schema?.type === 'object' || schema?.type === 'array';
  if (containerField) {
    // Objects and arrays own their visible boundaries and headings in the
    // templates below. Keeping this wrapper structural avoids duplicated
    // titles while retaining RJSF's useful field-type classes for layout.
    return <div className={classNames} style={style}>{children}{errors}{help}</div>;
  }

  return (
    <div className={`${classNames || ''} configuration-line`} style={style}>
      <div className="configuration-key">
        {/* Boolean widgets deliberately hide their internal duplicate label, so
            every scalar can use this same key column and preserve YAML order. */}
        <label htmlFor={id} className="text-xs font-semibold text-slate-100">
          {label}{required ? <span className="ml-0.25 text-sky-300">*</span> : null}
        </label>
        {description ? <div>{description}</div> : null}
      </div>
      <div className="configuration-value">
        {children}
        {errors}
        {help}
      </div>
    </div>
  );
}

function ConfigurationObjectTemplate({ description, fieldPathId, properties, title }) {
  const visibleProperties = properties.filter((property) => !property.hidden);
  const propertyLines = visibleProperties.map((property) => property.content);

  if (fieldPathId.path.length === 0) {
    // The outer configuration card already names the root document. Rendering
    // its properties directly makes their schema order read like YAML lines.
    return <div className="configuration-tree">{propertyLines}</div>;
  }

  if (typeof fieldPathId.path.at(-1) === 'number') {
    // Array items receive their numbered heading and action row from the array
    // item template. Rendering only their ordered property lines prevents redundant
    // nested boxes such as "Item 1" followed by another anonymous object box.
    return <div>{propertyLines}</div>;
  }

  return (
    <section className="configuration-branch">
      <header className="configuration-branch-heading">
        <h3>{title}</h3>
        {description ? <div>{description}</div> : null}
      </header>
      <div className="configuration-children">{propertyLines}</div>
    </section>
  );
}

function ConfigurationArrayItemTemplate({ buttonsProps, children, hasToolbar, index }) {
  const unavailable = buttonsProps.disabled || buttonsProps.readonly;

  return (
    <article className="configuration-branch configuration-array-item">
      {hasToolbar ? (
        // Text controls are intentionally kept immediately after the item
        // number. RJSF's default Bootstrap toolbox pushes empty glyphicon
        // buttons to the far edge, which is both unclear and hard to reach.
        <header className="configuration-item-heading">
          <span className="configuration-item-title">Item {index + 1}</span>
          {(buttonsProps.hasMoveUp || buttonsProps.hasMoveDown) ? (
            <button type="button" className="button-dark text-xs" disabled={unavailable || !buttonsProps.hasMoveUp} onClick={buttonsProps.onMoveUpItem}>Move up</button>
          ) : null}
          {(buttonsProps.hasMoveUp || buttonsProps.hasMoveDown) ? (
            <button type="button" className="button-dark text-xs" disabled={unavailable || !buttonsProps.hasMoveDown} onClick={buttonsProps.onMoveDownItem}>Move down</button>
          ) : null}
          {buttonsProps.hasCopy ? (
            <button type="button" className="button-dark text-xs" disabled={unavailable} onClick={buttonsProps.onCopyItem}>Duplicate</button>
          ) : null}
          {buttonsProps.hasRemove ? (
            <button type="button" className="button-danger text-xs" disabled={unavailable} onClick={buttonsProps.onRemoveItem}>Remove</button>
          ) : null}
        </header>
      ) : null}
      <div className="configuration-children">{children}</div>
    </article>
  );
}

function ConfigurationArrayTemplate({ canAdd, disabled, items, onAddClick, readonly, schema, title }) {
  return (
    <section className="configuration-branch configuration-array">
      <header className="configuration-branch-heading configuration-array-heading">
        <h3>{title}</h3>
        <span className="text-[0.7rem] text-slate-400">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
      </header>
      {schema.description ? <div className="configuration-branch-description">{schema.description}</div> : null}
      <div className="configuration-children">
        {items.length ? <div className="space-y-0.5">{items}</div> : <p className="text-xs text-slate-500">No items configured.</p>}
        {canAdd ? (
          <button type="button" className="button-dark mt-0.5 text-xs" disabled={disabled || readonly} onClick={onAddClick}>Add item</button>
        ) : null}
      </div>
    </section>
  );
}

export default function SchemaConfigurationForm({ schema, value, onChange, configuredSecrets, secretOperations, setSecretOperation }) {
  const uiSchema = useMemo(() => buildUiSchema(schema), [schema]);
  const widgets = useMemo(() => ({ SecretWidget }), []);
  const templates = useMemo(() => ({
    ArrayFieldItemTemplate: ConfigurationArrayItemTemplate,
    ArrayFieldTemplate: ConfigurationArrayTemplate,
    FieldTemplate: ConfigurationFieldTemplate,
    ObjectFieldTemplate: ConfigurationObjectTemplate,
  }), []);
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
        templates={templates}
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
