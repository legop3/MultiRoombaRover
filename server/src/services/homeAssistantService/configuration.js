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
  // Example entities and triggers are real initial document values, as they
  // were in the YAML template. Home Assistant stays inert until enabled and a
  // real secret is deliberately installed by the operator.
  defaultValue: {
    enabled: false,
    url: 'http://127.0.0.1:8123',
    token: '',
    [neato.key]: neato.defaultValue,
    [lift.key]: lift.defaultValue,
    entities: [
      { id: 'light.lab_main', name: 'Lab Lights' },
      { id: 'switch.dock_power', name: 'Dock Power' },
    ],
    buttons: [
      {
        entityId: 'sensor.basement_rover_buttons_action',
        stateEquals: 'on',
        cooldownMs: 15000,
        action: 'humanAlert',
      },
      {
        entityId: 'sensor.basement_rover_buttons_action',
        stateEquals: 'double',
        cooldownMs: 2000,
        action: 'modeTurns',
      },
      {
        entityId: 'sensor.basement_rover_buttons_action',
        stateEquals: 'hold',
        cooldownMs: 2000,
        action: 'modeAdmin',
      },
      {
        entityId: 'sensor.basement_rover_buttons_action',
        stateEquals: 'toggle',
        cooldownMs: 1000,
        action: 'lightsLockToggle',
      },
    ],
  },
  schema: strictObject({
    enabled: boolean({ description: 'Immediately connects to Home Assistant and enables configured room entities, physical-button triggers, Neato controls, and lift controls.' }),
    url: string({ title: 'Server URL', description: 'Base URL of the Home Assistant server used for its REST and WebSocket APIs.', format: 'uri', maxLength: 2048 }),
    token: string({ title: 'Long-lived access token', description: 'Home Assistant long-lived access token used to authenticate every API request. The saved value is never returned to the browser.', examples: ['REPLACE_WITH_LONG_LIVED_TOKEN'], writeOnly: true, maxLength: 20000 }),
    [neato.key]: neato.schema,
    [lift.key]: lift.schema,
    entities: {
      type: 'array',
      title: 'Room entities',
      description: 'Home Assistant lights and switches exposed to the room-light controls and button-box actions.',
      items: strictObject({
        id: string({ title: 'Entity id', description: 'Exact Home Assistant entity ID, such as light.rover_room or switch.floor_lamp.', examples: ['light.lab_main'], minLength: 1, maxLength: 255 }),
        name: string({ description: 'Human-readable name shown for this entity in the rover UI.', examples: ['Lab Lights'], minLength: 1, maxLength: 120 }),
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
        entityId: string({ title: 'Entity id', description: 'Home Assistant entity whose state changes are watched as button presses.', examples: ['sensor.basement_rover_buttons_action'], minLength: 1, maxLength: 255 }),
        stateEquals: string({ description: 'Exact Home Assistant state that must be reached before the action fires.', examples: ['on'], minLength: 1, maxLength: 255 }),
        cooldownMs: integer({ description: 'Minimum milliseconds between accepted activations of this mapping.', examples: [15000], minimum: 0, maximum: 86400000 }),
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
