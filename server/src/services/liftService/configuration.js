// Lift Configuration
// Purpose: Defines lift switch mappings and command timing nested beneath Home Assistant.
// Scope: Exports a nested configuration fragment without initializing either service.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'lift',
  feature: true,
  defaultValue: { enabled: false, upSwitch: '', downSwitch: '', interlockMs: 2000, commandCooldownMs: 3000 },
  schema: strictObject({
    enabled: boolean(),
    upSwitch: string({ maxLength: 255 }),
    downSwitch: string({ maxLength: 255 }),
    interlockMs: integer({ minimum: 0, maximum: 600000 }),
    commandCooldownMs: integer({ minimum: 0, maximum: 600000 }),
  }, { title: 'Lift', required: ['enabled', 'upSwitch', 'downSwitch', 'interlockMs', 'commandCooldownMs'] }),
};
