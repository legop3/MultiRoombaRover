// PTZ Camera Configuration
// Purpose: Defines the optional ONVIF camera connection and replay behavior.
// Scope: Contains data-only metadata so validation never initializes camera hardware.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'ptzCamera',
  feature: true,
  defaultValue: {
    enabled: false,
    name: 'PTZ Camera',
    color: '#38bdf8',
    host: '',
    onvifPort: 8000,
    username: '',
    password: '',
    profileToken: '003',
    turnDurationMs: 300000,
    replayEnabled: false,
  },
  schema: strictObject({
    enabled: boolean(),
    name: string({ minLength: 1, maxLength: 120 }),
    color: string({ pattern: '^#[0-9a-fA-F]{6}$' }),
    host: string({ maxLength: 255 }),
    onvifPort: integer({ title: 'ONVIF port', minimum: 1, maximum: 65535 }),
    username: string({ maxLength: 255 }),
    password: string({ writeOnly: true, maxLength: 10000 }),
    profileToken: string({ maxLength: 255 }),
    turnDurationMs: integer({ minimum: 1000, maximum: 86400000 }),
    replayEnabled: boolean(),
  }, { title: 'PTZ camera', required: ['enabled', 'name', 'color', 'host', 'onvifPort', 'username', 'password', 'profileToken', 'turnDurationMs', 'replayEnabled'] }),
};
