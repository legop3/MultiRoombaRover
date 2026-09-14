// PTZ Camera Configuration
// Purpose: Defines the optional ONVIF camera connection and replay behavior.
// Scope: Contains data-only metadata so validation never initializes camera hardware.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'ptzCamera',
  feature: true,
  // Non-secret commissioning values mirror the legacy template. The password
  // remains empty and `enabled: false` prevents an accidental camera login.
  defaultValue: {
    enabled: false,
    name: 'PTZ Camera',
    color: '#38bdf8',
    host: '192.168.0.8',
    onvifPort: 8000,
    username: 'admin',
    password: '',
    profileToken: '003',
    turnDurationMs: 300000,
    replayEnabled: false,
  },
  schema: strictObject({
    enabled: boolean({ description: 'Connects to the configured ONVIF camera and exposes its controls after restart.' }),
    name: string({ description: 'Human-readable camera name shown in the control interface.', minLength: 1, maxLength: 120 }),
    color: string({ description: 'Six-digit hexadecimal accent color used to identify this camera in the UI.', pattern: '^#[0-9a-fA-F]{6}$' }),
    host: string({ description: 'Hostname or IP address of the ONVIF camera.', examples: ['192.168.0.8'], maxLength: 255 }),
    onvifPort: integer({ title: 'ONVIF port', description: 'TCP port used for ONVIF control requests.', minimum: 1, maximum: 65535 }),
    username: string({ description: 'Camera account username used for ONVIF authentication.', examples: ['admin'], maxLength: 255 }),
    password: string({ description: 'Camera account password used for ONVIF authentication. The saved value is never returned to the browser.', examples: ['REPLACE_WITH_CAMERA_PASSWORD'], writeOnly: true, maxLength: 10000 }),
    profileToken: string({ description: 'ONVIF media profile token used for stream discovery, presets, status, and movement commands.', maxLength: 255 }),
    turnDurationMs: integer({ description: 'Milliseconds assigned to each queued user turn controlling the PTZ camera.', minimum: 1000, maximum: 86400000 }),
    replayEnabled: boolean({ description: 'Allows this camera to appear as an available replay source.' }),
  }, {
    title: 'PTZ camera',
    description: 'Optional ONVIF pan-tilt-zoom camera connection, presentation, turn timing, and replay availability.',
    required: ['enabled', 'name', 'color', 'host', 'onvifPort', 'username', 'password', 'profileToken', 'turnDurationMs', 'replayEnabled'],
  }),
};
