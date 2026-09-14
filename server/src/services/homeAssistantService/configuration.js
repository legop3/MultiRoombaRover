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
    enabled: boolean(),
    url: string({ title: 'Server URL', format: 'uri', maxLength: 2048 }),
    token: string({ title: 'Long-lived access token', writeOnly: true, maxLength: 20000 }),
    [neato.key]: neato.schema,
    [lift.key]: lift.schema,
    entities: {
      type: 'array',
      title: 'Room entities',
      items: strictObject({
        id: string({ title: 'Entity id', minLength: 1, maxLength: 255 }),
        name: string({ minLength: 1, maxLength: 120 }),
        type: string({ enum: ['light', 'switch'] }),
      }, { required: ['id', 'name'] }),
    },
    buttons: {
      type: 'array',
      title: 'Physical button mappings',
      items: strictObject({
        entityId: string({ title: 'Entity id', minLength: 1, maxLength: 255 }),
        stateEquals: string({ minLength: 1, maxLength: 255 }),
        cooldownMs: integer({ minimum: 0, maximum: 86400000 }),
        action: string({ enum: ['humanAlert', 'modeTurns', 'modeAdmin', 'lightsLockToggle'] }),
      }, { required: ['entityId', 'stateEquals', 'cooldownMs', 'action'] }),
    },
  }, { title: 'Home Assistant', required: ['enabled', 'url', 'token', 'neato', 'lift', 'entities', 'buttons'] }),
};
