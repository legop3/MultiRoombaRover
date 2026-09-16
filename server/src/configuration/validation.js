// Configuration Validation
// Purpose: Validates and normalizes the one hierarchical configuration document.
// Scope: Owns reusable validation behavior for the complete schema assembled from service definitions.
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { defaultConfig, rootSchema, secretPaths } = require('./definition');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(defaultValue, suppliedValue) {
  /*
    Arrays are complete ordered values and must never be merged item-by-item.
    Plain objects recurse so a stored document can omit a newly introduced
    field and receive its safe default without discarding neighboring values.
    Unknown supplied keys are retained here so strict schema validation can
    report them instead of silently deleting operator input.
  */
  if (Array.isArray(suppliedValue)) return clone(suppliedValue);
  if (!suppliedValue || typeof suppliedValue !== 'object' || Array.isArray(defaultValue)) {
    return suppliedValue === undefined ? clone(defaultValue) : suppliedValue;
  }

  const result = clone(defaultValue);
  for (const [key, value] of Object.entries(suppliedValue)) {
    const fallback = defaultValue && typeof defaultValue === 'object' ? defaultValue[key] : undefined;
    result[key] = mergeDefaults(fallback, value);
  }
  return result;
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(rootSchema);

function formatValidationErrors(errors = []) {
  return errors.map((error) => ({
    /*
      Ajv uses JSON Pointer instance paths. Prefixing an additional-property
      name makes the error point at the actual rejected field rather than only
      its containing object, which is more useful in the hierarchical form.
    */
    path: error.keyword === 'additionalProperties'
      ? `${error.instancePath}/${error.params.additionalProperty}`
      : error.instancePath || '/',
    message: error.message || 'Invalid value',
    keyword: error.keyword,
  }));
}

function normalizeConfig(input = {}) {
  return mergeDefaults(defaultConfig, input);
}

function assertValidConfig(input) {
  if (validate(input)) return input;
  const error = new Error('Configuration validation failed.');
  error.code = 'CONFIG_VALIDATION_FAILED';
  error.validationErrors = formatValidationErrors(validate.errors);
  throw error;
}

/*
  Defaults are executable configuration, not documentation. Validate them at
  module load so a definition edit cannot make first boot fail later in an
  unrelated service require chain.
*/
assertValidConfig(defaultConfig);

module.exports = {
  defaultConfig,
  secretPaths,
  rootSchema,
  clone,
  normalizeConfig,
  assertValidConfig,
};
