// Audio-Level Configuration
// Purpose: Defines server base gains and the permitted personal adjustment range.
// Scope: Exports only defaults and validation metadata.
const { strictObject, number, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'audioLevels',
  defaultValue: { hornGain: 1, ttsGain: 1, forwardGain: 1, maxPersonalAdjustmentPercent: 50 },
  schema: strictObject({
    hornGain: number({ description: 'Server base multiplier for external horn playback, from silent at 0 through four times gain at 4.', minimum: 0, maximum: 4 }),
    ttsGain: number({ title: 'TTS gain', description: 'Server base multiplier for text-to-speech playback, from silent at 0 through four times gain at 4.', minimum: 0, maximum: 4 }),
    forwardGain: number({ description: 'Server base multiplier for browser-forwarded and uploaded audio, from silent at 0 through four times gain at 4.', minimum: 0, maximum: 4 }),
    maxPersonalAdjustmentPercent: integer({ description: 'Largest positive or negative percentage adjustment permitted for users granted personal audio controls; zero disables personal variation.', minimum: 0, maximum: 100 }),
  }, { title: 'Audio levels', description: 'Sets the initial server-owned playback gains and the allowed range for per-user adjustments.', required: ['hornGain', 'ttsGain', 'forwardGain', 'maxPersonalAdjustmentPercent'] }),
};
