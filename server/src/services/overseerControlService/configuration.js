// Overseer Control Configuration
// Purpose: Defines optional Overseer behavior and its model connection.
// Scope: Contains declarative configuration only and never starts an Overseer loop.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'overseerControl',
  defaultValue: {
    enabled: false,
    mode: 'autonomous',
    observeOnly: true,
    postToolsOnlyMessages: false,
    tiebreakerEnable: false,
    runWhileNoPeopleOnline: false,
    name: 'The Overseer',
    model: 'qwen2.5:7b-instruct',
    ollamaServer: 'http://127.0.0.1:11434',
    profileImageUrl: '',
    gateIntervalMs: 2000,
  },
  schema: strictObject({
    enabled: boolean(),
    mode: string({ enum: ['autonomous', 'directAddress'] }),
    observeOnly: boolean(),
    postToolsOnlyMessages: boolean(),
    tiebreakerEnable: boolean(),
    runWhileNoPeopleOnline: boolean(),
    name: string({ minLength: 1, maxLength: 80 }),
    model: string({ minLength: 1, maxLength: 200 }),
    ollamaServer: string({ title: 'Ollama server', format: 'uri', maxLength: 2048 }),
    profileImageUrl: string({ title: 'Profile image URL', maxLength: 2048 }),
    gateIntervalMs: integer({ minimum: 250, maximum: 3600000 }),
  }, { title: 'Overseer Control', required: ['enabled', 'mode', 'observeOnly', 'postToolsOnlyMessages', 'tiebreakerEnable', 'runWhileNoPeopleOnline', 'name', 'model', 'ollamaServer', 'profileImageUrl', 'gateIntervalMs'] }),
};
