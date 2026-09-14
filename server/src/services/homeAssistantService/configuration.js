// Home Assistant Configuration
// Purpose: Defines the shared Home Assistant connection and the Neato, lift, entity, and button mappings that use it.
// Scope: Keeps this connected configuration tree together without initializing any integration service.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');
const neato = require('../neatoService/configuration');
const lift = require('../liftService/configuration');

module.exports = {
  key: 'homeAssistant',
  feature: true,
  // Retain the actual child definitions so generic configuration metadata can
  // discover their feature switches without repeating nested paths centrally.
  nestedDefinitions: [neato, lift],
  defaultValue: {
    enabled: false,
    url: 'http://127.0.0.1:8123',
    token: '',
    [neato.key]: neato.defaultValue,
    [lift.key]: lift.defaultValue,
    entities: [],
    buttons: [],
  },
  schema: strictObject({
    enabled: boolean({ description: 'Connects to Home Assistant and enables configured room entities, physical-button triggers, Neato controls, and lift controls after restart.' }),
    url: string({ title: 'Server URL', description: 'Base URL of the Home Assistant server used for its REST and WebSocket APIs.', format: 'uri', maxLength: 2048 }),
    token: string({ title: 'Long-lived access token', description: 'Home Assistant long-lived access token used to authenticate every API request. The saved value is never returned to the browser.', writeOnly: true, maxLength: 20000 }),
    [neato.key]: neato.schema,
    [lift.key]: lift.schema,
    entities: {
      type: 'array',
      title: 'Room entities',
      description: 'Home Assistant lights and switches exposed to the room-light controls and button-box actions.',
      items: strictObject({
        id: string({ title: 'Entity id', description: 'Exact Home Assistant entity ID, such as light.rover_room or switch.floor_lamp.', minLength: 1, maxLength: 255 }),
        name: string({ description: 'Human-readable name shown for this entity in the rover UI.', minLength: 1, maxLength: 120 }),
        type: string({ description: 'Control behavior to expose: lights receive brightness-aware commands, while switches receive simple on and off commands.', enum: ['light', 'switch'] }),
      }, {
        description: 'One Home Assistant entity that the rover server can display and control.',
        required: ['id', 'name'],
      }),
    },
    buttons: {
      type: 'array',
      title: 'Physical button mappings',
      description: 'Maps Home Assistant entity state changes to built-in rover-server actions.',
      items: strictObject({
        entityId: string({ title: 'Entity id', description: 'Home Assistant entity whose state changes are watched as button presses.', minLength: 1, maxLength: 255 }),
        stateEquals: string({ description: 'Exact Home Assistant state that must be reached before the action fires.', minLength: 1, maxLength: 255 }),
        cooldownMs: integer({ description: 'Minimum milliseconds between accepted activations of this mapping.', minimum: 0, maximum: 86400000 }),
        action: string({ description: 'Built-in action to run: raise a human alert, switch to turns mode, switch to admin mode, or toggle the room-light lock.', enum: ['humanAlert', 'modeTurns', 'modeAdmin', 'lightsLockToggle'] }),
      }, {
        description: 'One watched Home Assistant state transition and the server action it triggers.',
        required: ['entityId', 'stateEquals', 'cooldownMs', 'action'],
      }),
    },
  }, {
    title: 'Home Assistant',
    description: 'Connection, controllable entity catalog, and hardware-trigger mappings for the shared Home Assistant integration.',
    required: ['enabled', 'url', 'token', 'neato', 'lift', 'entities', 'buttons'],
  }),
};
