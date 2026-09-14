// Balance Board Configuration
// Purpose: Defines optional hardware enablement and development simulation.
// Scope: Contains configuration metadata only and never opens Bluetooth.
const { strictObject, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'balanceBoard',
  feature: true,
  defaultValue: { enabled: false, simulate: false },
  schema: strictObject({
    enabled: boolean({ description: 'Starts the Wii Balance Board service and exposes its readings and controls after restart.' }),
    simulate: boolean({ description: 'Runs the native worker with generated cyclic sensor data instead of connecting to Bluetooth hardware.' }),
  }, {
    title: 'Balance Board',
    description: 'Optional Wii Balance Board input service with a development simulation mode.',
    required: ['enabled', 'simulate'],
  }),
};
