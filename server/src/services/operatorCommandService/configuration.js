// Operator Command Configuration
// Purpose: Defines the shared command prefix and optional bare time-status command.
// Scope: Contains configuration metadata only and never builds command handlers.
const { strictObject, string, nullableString } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'commands',
  defaultValue: { prefix: 'rs', timeStatusCommand: 'ts' },
  schema: strictObject({
    prefix: string({ minLength: 1, maxLength: 20 }),
    timeStatusCommand: nullableString({ description: 'Leave empty to disable the bare shortcut.', maxLength: 20 }),
  }, { title: 'Commands', required: ['prefix', 'timeStatusCommand'] }),
};
