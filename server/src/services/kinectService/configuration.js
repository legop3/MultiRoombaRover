// Kinect Configuration
// Purpose: Defines optional Kinect capture and cooldown behavior.
// Scope: Contains configuration metadata only and never opens the native worker.
const { strictObject, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'kinect',
  feature: true,
  defaultValue: { enabled: false, captureCooldownMs: 10000 },
  schema: strictObject({
    enabled: boolean(),
    captureCooldownMs: integer({ minimum: 0, maximum: 3600000 }),
  }, { title: 'Kinect', required: ['enabled', 'captureCooldownMs'] }),
};
