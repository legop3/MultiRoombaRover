// Kinect Configuration
// Purpose: Defines optional Kinect capture and cooldown behavior.
// Scope: Contains configuration metadata only and never opens the native worker.
const { strictObject, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'kinect',
  feature: true,
  defaultValue: { enabled: false, captureCooldownMs: 10000 },
  schema: strictObject({
    enabled: boolean({ description: 'Starts the Kinect worker and exposes authorized frame capture after restart.' }),
    captureCooldownMs: integer({ description: 'Minimum milliseconds between accepted Kinect frame-capture requests across all clients.', minimum: 0, maximum: 3600000 }),
  }, {
    title: 'Kinect',
    description: 'Optional Kinect frame capture and its server-wide request cooldown.',
    required: ['enabled', 'captureCooldownMs'],
  }),
};
