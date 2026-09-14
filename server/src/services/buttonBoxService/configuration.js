// Button-Box Configuration
// Purpose: Defines whether the optional physical button box is active.
// Scope: Contains configuration metadata only and never initializes hardware.
const { strictObject, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'buttonBox',
  feature: true,
  defaultValue: { enabled: false },
  schema: strictObject({
    enabled: boolean({ description: 'Immediately enables the physical button-box input route and its persistent button rewards and effects.' }),
  }, {
    title: 'Button box',
    description: 'Optional physical button-box input and reward system.',
    required: ['enabled'],
  }),
};
