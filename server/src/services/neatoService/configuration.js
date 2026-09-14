// Neato Configuration
// Purpose: Defines the Neato device mapping nested beneath the shared Home Assistant connection.
// Scope: Exports a nested configuration fragment without initializing either service.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'neato',
  feature: true,
  defaultValue: { enabled: false, device: '' },
  schema: strictObject({
    enabled: boolean(),
    device: string({ description: 'ESPHome device name.', maxLength: 255 }),
  }, { title: 'Neato', required: ['enabled', 'device'] }),
};
