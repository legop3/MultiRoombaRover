// Activity Controls have their own catalog so room-light bulk actions
// never acquire unrelated devices simply because they share a connection.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

// All triggers use the same inputs so the admin form and execution contract agree.
function automation(title, description) {
  return strictObject({
    action: string({ title: 'Action', enum: ['unchanged', 'set', 'press'], default: 'unchanged' }),
    value: string({ title: 'Value', description: 'For set: on/off, a number, exact selection, or text. Empty text clears it. Ignored for press.', maxLength: 255 }),
  }, { title, description });
}

module.exports = {
  key: 'homeAssistantActivities',
  feature: true,
  defaultValue: { enabled: false, items: [] },
  schema: strictObject({
    enabled: boolean({ description: 'Shows the Activity Controls card in Activities using the enabled Home Assistant connection.' }),
    items: {
      type: 'array',
      title: 'Activity control items',
      description: 'Ordered public entities. Control types and limits come from Home Assistant; unsupported domains are read-only.',
      items: strictObject({
        id: string({ title: 'Entity id', description: 'Exact Home Assistant entity ID to expose in Activity Controls.', pattern: '^[a-z0-9_]+\\.[a-z0-9_]+$', maxLength: 255, examples: ['input_number.fan_speed'] }),
        name: string({ title: 'Display name', description: 'Optional override; otherwise uses the Home Assistant friendly name.', maxLength: 120, examples: ['Fan speed'] }),
        icon: string({ description: 'Font Awesome name, as used by social links. Blank or invalid names use a fallback.', maxLength: 80, examples: ['FaFan'] }),
        // Match social-link colors so admins can customize tiles through the existing config form.
        color: string({ description: 'Optional six-digit hexadecimal tile color, like social links.', examples: ['#3B82F6'], pattern: '^#[0-9a-fA-F]{6}$' }),
        readOnly: boolean({ title: 'Read only for users', default: false, description: 'Ordinary users can only view this item. Admins and automations can still change supported controls.' }),
        automations: strictObject({
          idle: automation('When idle', 'Runs after the idle timeout with no users or admins online.'),
          locked: automation('When server locked', 'Runs on entering admin or lockdown mode.'),
          online: automation('When users online', 'Runs when a user or admin comes online, or the server reopens with one online. Suppressed in admin and lockdown modes. Spectators do not count.'),
        }, { title: 'Automations', description: 'One-time actions that bypass item locks and read-only permissions.' }),
      }, { description: 'One independently controlled or read-only activity control item.', required: ['id'] }),
    },
  }, { title: 'Activity Controls', description: 'Generic activity controls and idle behavior, separate from room lighting.', required: ['enabled', 'items'] }),
};
