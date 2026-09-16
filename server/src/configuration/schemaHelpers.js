// Configuration Schema Helpers
// Purpose: Keeps repetitive declarations in the complete strict JSON Schema readable.
// Scope: Defines schema-building helpers only; validation and default application remain separate responsibilities.

function strictObject(properties, options = {}) {
  /*
    Configuration objects reject unknown keys at every level. A misspelled
    operator setting must fail loudly instead of looking saved while the server
    silently falls back to another value.
  */
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(options.title ? { title: options.title } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(Array.isArray(options.required) ? { required: options.required } : {}),
  };
}

function string(options = {}) {
  return { type: 'string', ...options };
}

function nullableString(options = {}) {
  return { type: ['string', 'null'], ...options };
}

function boolean(options = {}) {
  return { type: 'boolean', ...options };
}

function integer(options = {}) {
  return { type: 'integer', ...options };
}

function number(options = {}) {
  return { type: 'number', ...options };
}

function stringArray(options = {}) {
  return {
    type: 'array',
    items: string(options.item || {}),
    ...options.array,
  };
}

module.exports = {
  strictObject,
  string,
  nullableString,
  boolean,
  integer,
  number,
  stringArray,
};
