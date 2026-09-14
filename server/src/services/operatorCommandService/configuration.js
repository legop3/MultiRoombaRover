// Operator Command Configuration
// Purpose: Defines the shared command prefix and optional bare time-status command.
// Scope: Contains configuration metadata only and never builds command handlers.
const { strictObject, string, nullableString } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'commands',
  defaultValue: { prefix: 'rs', timeStatusCommand: 'ts' },
  schema: strictObject({
    prefix: string({ description: 'Text placed before operator commands in web chat and Discord, such as rs help.', minLength: 1, maxLength: 20 }),
    timeStatusCommand: nullableString({ description: 'Optional command accepted without the normal prefix for the current time and rover status. Leave empty to disable the shortcut.', maxLength: 20 }),
  }, {
    title: 'Commands',
    description: 'Shared text syntax used by operator commands across web chat and Discord.',
    required: ['prefix', 'timeStatusCommand'],
  }),
};
