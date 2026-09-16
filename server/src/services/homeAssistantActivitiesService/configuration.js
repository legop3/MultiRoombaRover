// Home Assistant activities have their own catalog so room-light bulk actions
// never acquire unrelated devices simply because they share a connection.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'homeAssistantActivities',
  feature: true,
  defaultValue: { enabled: false, items: [] },
  schema: strictObject({
    enabled: boolean({ description: 'Shows the separate Activities card using the enabled Home Assistant connection.' }),
    items: {
      type: 'array',
      title: 'Activity items',
      description: 'Ordered public entities. Control types and limits come from Home Assistant; unsupported domains are read-only.',
      items: strictObject({
        id: string({ title: 'Entity id', description: 'Exact Home Assistant entity ID to expose in Activities.', pattern: '^[a-z0-9_]+\\.[a-z0-9_]+$', maxLength: 255, examples: ['input_number.fan_speed'] }),
        name: string({ title: 'Display name', description: 'Optional override; otherwise uses the Home Assistant friendly name.', maxLength: 120, examples: ['Fan speed'] }),
        icon: string({ description: 'Font Awesome name, as used by social links. Blank or invalid names use a fallback.', maxLength: 80, examples: ['FaFan'] }),
        // Match social-link colors so admins can customize tiles through the existing config form.
        color: string({ description: 'Optional six-digit hexadecimal tile color, like social links.', examples: ['#3B82F6'], pattern: '^#[0-9a-fA-F]{6}$' }),
        readOnly: boolean({ title: 'Read only', default: false, description: 'Display the value without allowing user or idle commands.' }),
        idleAction: string({ title: 'When idle', enum: ['unchanged', 'set', 'press'], default: 'unchanged', description: 'Leave unchanged, set the idle value, or press a button once. Runs independently of user locks.' }),
        idleValue: string({ title: 'Idle value', description: 'For set: on/off, a number, exact selection, or text (empty text clears it). Checked against live entity limits when idle runs.', examples: ['0'], maxLength: 255 }),
      }, { description: 'One independently controlled or read-only activity item.', required: ['id'] }),
    },
  }, { title: 'Home Assistant activities', description: 'Generic activity controls and idle behavior, separate from room lighting.', required: ['enabled', 'items'] }),
};
