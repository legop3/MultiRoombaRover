// Schema-Generated Configuration Form
// Purpose: Renders the server-provided JSON Schema in the same cards, surfaces, fields, and buttons as the rest of MultiRover.
// Scope: Defines one generic RJSF presentation; it never names or special-cases an individual service or setting.
import { useMemo } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import CardFrame from '../../components/CardFrame/index.jsx';

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
  displayLabel,
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
    <div className={`${classNames || ''} configuration-field surface p-1`} style={style}>
      {displayLabel ? (
        <label htmlFor={id} className="block text-xs font-semibold text-slate-100">
          {label}{required ? <span className="ml-0.25 text-sky-300">*</span> : null}
        </label>
      ) : null}
      {displayLabel && description ? <div className="mt-0.25">{description}</div> : null}
      <div className={displayLabel ? 'mt-0.5' : ''}>{children}</div>
      {errors}
      {help}
    </div>
  );
}

function ConfigurationObjectTemplate({ description, fieldPathId, properties, title }) {
  const visibleProperties = properties.filter((property) => !property.hidden);
  const propertyGrid = (
    <div className="configuration-property-grid grid gap-0.5 md:grid-cols-2 xl:grid-cols-3">
      {/* RJSF gives each property content its own keyed field wrapper. Rendering
          it directly preserves field-object and field-array on the grid child,
          allowing containers to span the row without another frontend schema. */}
      {visibleProperties.map((property) => property.content)}
    </div>
  );

  if (fieldPathId.path.length === 0) {
    // The editor toolbar already identifies the root document. The root is a
    // simple ordered stack so every service-owned top-level object receives
    // the full page width before arranging its own fields responsively.
    return <div className="space-y-1">{visibleProperties.map((property) => property.content)}</div>;
  }

  if (typeof fieldPathId.path.at(-1) === 'number') {
    // Array items receive their numbered heading and action row from the array
    // item template. Rendering only their property grid prevents redundant
    // nested boxes such as "Item 1" followed by another anonymous object box.
    return propertyGrid;
  }

  if (fieldPathId.path.length === 1) {
    return (
      <CardFrame title={title} clipOverflow={false} bodyClassName="space-y-0.5 p-0.5">
        {description ? <div className="px-0.5 text-xs text-slate-400">{description}</div> : null}
        {propertyGrid}
      </CardFrame>
    );
  }

  return (
    <section className="configuration-object surface border border-neutral-500/60 p-0.5">
      <h3 className="mb-0.5 text-sm font-semibold text-slate-100">{title}</h3>
      {description ? <div className="mb-0.5 text-xs text-slate-400">{description}</div> : null}
      {propertyGrid}
    </section>
  );
}

function ConfigurationArrayItemTemplate({ buttonsProps, children, hasToolbar, index }) {
  const unavailable = buttonsProps.disabled || buttonsProps.readonly;

  return (
    <article className="surface-muted space-y-0.5 border border-neutral-500/60 p-0.5">
      {hasToolbar ? (
        // Text controls are intentionally kept immediately after the item
        // number. RJSF's default Bootstrap toolbox pushes empty glyphicon
        // buttons to the far edge, which is both unclear and hard to reach.
        <header className="flex flex-wrap items-center gap-0.5">
          <span className="mr-0.5 text-xs font-semibold text-slate-100">Item {index + 1}</span>
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
      {children}
    </article>
  );
}

function ConfigurationArrayTemplate({ canAdd, disabled, items, onAddClick, readonly, schema, title }) {
  return (
    <section className="configuration-array surface space-y-0.5 border border-neutral-500/60 p-0.5">
      <header className="flex flex-wrap items-center gap-0.5">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <span className="text-[0.7rem] text-slate-400">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
      </header>
      {schema.description ? <div className="text-xs text-slate-400">{schema.description}</div> : null}
      {items.length ? <div className="space-y-0.5">{items}</div> : <p className="text-xs text-slate-500">No items configured.</p>}
      {canAdd ? (
        <button type="button" className="button-dark text-xs" disabled={disabled || readonly} onClick={onAddClick}>Add item</button>
      ) : null}
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
