// Schema-Generated Configuration Form
// Purpose: Renders the server-provided JSON Schema as an ordered, indented tree resembling the configuration's YAML structure.
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
  const firstExample = Array.isArray(schema.examples) ? schema.examples[0] : undefined;
  const placeholder = firstExample === undefined ? {} : { 'ui:placeholder': String(firstExample) };

  if (schema.writeOnly === true) {
    return {
      'ui:widget': 'SecretWidget',
      'ui:options': { secretPath: path },
      ...placeholder,
    };
  }

  if (schema.type === 'boolean') {
    /*
      RJSF's checkbox is unusual: unless it is explicitly selected, it renders
      the schema description and field name inside the widget as well as
      passing them to FieldTemplate. This generic option makes the surrounding
      YAML-like row the sole owner of that text, eliminating duplicates without
      maintaining a list of boolean setting names.
    */
    return {
      'ui:widget': 'checkbox',
      'ui:options': { label: false },
    };
  }

  if (schema.type === 'array' && schema.items) {
    /*
      Array item schemas need the same generic metadata walk as ordinary object
      properties. Otherwise fields created by Add item would lose their
      schema-owned placeholders even though the backend described them.
    */
    return {
      items: buildUiSchema(schema.items, path ? `${path}[]` : '[]'),
    };
  }

  if (schema.type !== 'object' || !schema.properties) return placeholder;
  return Object.fromEntries(Object.entries(schema.properties).map(([key, childSchema]) => [
    key,
    buildUiSchema(childSchema, path ? `${path}.${key}` : key),
  ]));
}

function SecretWidget({ id, disabled, readonly, options, placeholder, registry }) {
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
          placeholder={placeholder || 'Enter replacement value'}
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
      </div>
      <div className="configuration-value">
        {/* Descriptions belong with the editable value rather than inside the
            narrow key column. This keeps long operational guidance readable
            without weakening the YAML-like key/value alignment. */}
        {description ? <div className="configuration-value-description">{description}</div> : null}
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
  const topLevel = fieldPathId.path.length === 1;

  if (fieldPathId.path.length === 0) {
    // The outer configuration card already names the root document. Rendering
    // its properties directly makes their schema order read like YAML lines.
    // The root description remains outside that stack so its introductory
    // text does not accidentally become another configuration section.
    return (
      <div>
        {description ? <div className="configuration-root-description">{description}</div> : null}
        <div className="configuration-tree">{propertyLines}</div>
      </div>
    );
  }

  if (typeof fieldPathId.path.at(-1) === 'number') {
    // Array items receive their numbered heading and action row from the array
    // item CardFrame. Rendering only their description and ordered properties
    // prevents a redundant anonymous card inside that visible item boundary.
    return (
      <div>
        {description ? <div className="configuration-item-description">{description}</div> : null}
        {propertyLines}
      </div>
    );
  }

  return (
    <CardFrame
      title={title}
      clipOverflow={false}
      className={`configuration-card${topLevel ? ' configuration-top-level-card' : ''}`}
      headerClassName={topLevel ? '!bg-sky-950' : ''}
      bodyClassName="configuration-card-body"
    >
      {description ? <div className="configuration-branch-description">{description}</div> : null}
      <div className="configuration-children">{propertyLines}</div>
    </CardFrame>
  );
}

function ConfigurationArrayItemTemplate({ buttonsProps, children, hasToolbar, index }) {
  const unavailable = buttonsProps.disabled || buttonsProps.readonly;

  return (
    <CardFrame
      title={`Item ${index + 1}`}
      clipOverflow={false}
      className="configuration-card configuration-array-item"
      bodyClassName="configuration-card-body"
    >
      {hasToolbar ? (
        // Actions remain at the beginning of the card body instead of using
        // CardFrame's right-aligned action slot. Even on a wide editor, item
        // controls therefore stay next to the content they affect.
        <div className="configuration-item-actions">
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
        </div>
      ) : null}
      <div className="configuration-children">{children}</div>
    </CardFrame>
  );
}

function ConfigurationArrayTemplate({ canAdd, disabled, fieldPathId, items, onAddClick, readonly, schema, title }) {
  const topLevel = fieldPathId.path.length === 1;

  return (
    <CardFrame
      title={title}
      meta={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      clipOverflow={false}
      className={`configuration-card configuration-array${topLevel ? ' configuration-top-level-card' : ''}`}
      headerClassName={topLevel ? '!bg-sky-950' : ''}
      bodyClassName="configuration-card-body"
    >
      {schema.description ? <div className="configuration-branch-description">{schema.description}</div> : null}
      {canAdd ? (
        // Adding belongs to the collection as a whole, but stays left-aligned
        // with that collection's contents rather than at the viewport edge.
        <div className="configuration-array-actions">
          <button type="button" className="button-dark text-xs" disabled={disabled || readonly} onClick={onAddClick}>Add item</button>
        </div>
      ) : null}
      <div className="configuration-children">
        {items.length ? items : <p className="text-xs text-slate-500">No items configured.</p>}
      </div>
    </CardFrame>
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
