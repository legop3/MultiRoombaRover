// Neato Configuration
// Purpose: Defines the Neato device mapping nested beneath the shared Home Assistant connection.
// Scope: Exports a nested configuration fragment without initializing either service.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'neato',
  feature: true,
  // Keeping the example device in the saved template explains the required
  // ESPHome naming shape while `enabled: false` prevents accidental control.
  defaultValue: { enabled: false, device: 'neato_vacuum' },
  schema: strictObject({
    enabled: boolean({ description: 'Exposes Neato status and commands through the configured Home Assistant ESPHome device after restart.' }),
    device: string({ description: 'ESPHome device name used to derive the Neato entity IDs in Home Assistant; punctuation is normalized to underscores.', examples: ['neato_vacuum'], maxLength: 255 }),
  }, {
    title: 'Neato',
    description: 'Optional Neato robot controls backed by entities published from one ESPHome device through Home Assistant.',
    required: ['enabled', 'device'],
  }),
};
