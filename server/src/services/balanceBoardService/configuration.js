// Balance Board Configuration
// Purpose: Defines optional hardware enablement and development simulation.
// Scope: Contains configuration metadata only and never opens Bluetooth.
const { strictObject, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'balanceBoard',
  feature: true,
  defaultValue: { enabled: false, simulate: false },
  schema: strictObject({ enabled: boolean(), simulate: boolean() }, { title: 'Balance Board', required: ['enabled', 'simulate'] }),
};
