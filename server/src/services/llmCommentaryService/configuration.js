// LLM Commentary Configuration
// Purpose: Defines the optional commentary model, endpoint, and cadence.
// Scope: Contains configuration metadata only and never connects to Ollama.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'llmCommentary',
  defaultValue: { enabled: false, model: 'qwen2.5:7b-instruct', ollamaServer: 'http://127.0.0.1:11434', frequency: 120000 },
  schema: strictObject({
    enabled: boolean({ description: 'Starts periodic AI commentary generation from current rover, user, and chat activity.' }),
    model: string({ description: 'Ollama model name used to generate commentary.', minLength: 1, maxLength: 200 }),
    ollamaServer: string({ title: 'Ollama server', description: 'Base URL of the Ollama API used for commentary generation.', format: 'uri', maxLength: 2048 }),
    frequency: integer({ description: 'Commentary interval in milliseconds.', minimum: 1000, maximum: 86400000 }),
  }, { title: 'LLM commentary', description: 'Generates periodic AI-authored chat commentary from recent server activity through Ollama.', required: ['enabled', 'model', 'ollamaServer', 'frequency'] }),
};
