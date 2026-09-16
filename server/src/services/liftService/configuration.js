// Lift Configuration
// Purpose: Defines lift switch mappings and command timing nested beneath Home Assistant.
// Scope: Exports a nested configuration fragment without initializing either service.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'lift',
  feature: true,
  // These inert example entity IDs preserve the complete former YAML shape;
  // the explicit feature switch remains the only activation signal.
  defaultValue: {
    enabled: false,
    upSwitch: 'switch.lift_up',
    downSwitch: 'switch.lift_down',
    interlockMs: 2000,
    commandCooldownMs: 3000,
  },
  schema: strictObject({
    enabled: boolean({ description: 'Immediately enables lift status and commands through the two configured Home Assistant switches.' }),
    upSwitch: string({ description: 'Home Assistant switch entity that powers upward lift movement.', examples: ['switch.lift_up'], maxLength: 255 }),
    downSwitch: string({ description: 'Home Assistant switch entity that powers downward lift movement.', examples: ['switch.lift_down'], maxLength: 255 }),
    interlockMs: integer({ description: 'Milliseconds to wait after turning off the opposing direction before energizing the requested direction. Runtime always enforces at least 250 ms.', minimum: 0, maximum: 600000 }),
    commandCooldownMs: integer({ description: 'Minimum milliseconds between lift commands. Runtime never allows this to be shorter than the interlock delay.', minimum: 0, maximum: 600000 }),
  }, {
    title: 'Lift',
    description: 'Bidirectional lift control using interlocked Home Assistant switch entities.',
    required: ['enabled', 'upSwitch', 'downSwitch', 'interlockMs', 'commandCooldownMs'],
  }),
};
