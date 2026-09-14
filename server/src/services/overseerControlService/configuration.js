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
    enabled: boolean({ description: 'Enables the AI Overseer and its configured autonomous or direct-address execution path.' }),
    mode: string({ description: 'autonomous runs repeatedly when the user vote permits it; directAddress runs only when chat begins with the configured Overseer name.', enum: ['autonomous', 'directAddress'] }),
    observeOnly: boolean({ description: 'Lets the model evaluate state without executing tools or posting its generated chat response.' }),
    postToolsOnlyMessages: boolean({ description: 'Posts a chat feed entry for executed tool calls even when the model did not also produce chat text.' }),
    tiebreakerEnable: boolean({ description: 'Allows autonomous execution when eligible users are evenly split between enabling and disabling the Overseer.' }),
    runWhileNoPeopleOnline: boolean({ description: 'Allows autonomous execution when no eligible users are online to vote.' }),
    name: string({ description: 'Chat identity for Overseer messages and the phrase that triggers direct-address mode.', minLength: 1, maxLength: 80 }),
    model: string({ description: 'Ollama model name used for Overseer decisions.', minLength: 1, maxLength: 200 }),
    ollamaServer: string({ title: 'Ollama server', description: 'Base URL of the Ollama API used for Overseer decisions.', format: 'uri', maxLength: 2048 }),
    profileImageUrl: string({ title: 'Profile image URL', description: 'Optional image URL displayed beside Overseer chat messages; leave blank for no custom image.', maxLength: 2048 }),
    gateIntervalMs: integer({ description: 'Milliseconds waited after a completed autonomous decision before evaluating the next one.', minimum: 250, maximum: 3600000 }),
  }, { title: 'Overseer Control', description: 'Controls the AI agent that observes server state, optionally executes approved tools, and can speak in chat.', required: ['enabled', 'mode', 'observeOnly', 'postToolsOnlyMessages', 'tiebreakerEnable', 'runWhileNoPeopleOnline', 'name', 'model', 'ollamaServer', 'profileImageUrl', 'gateIntervalMs'] }),
};
