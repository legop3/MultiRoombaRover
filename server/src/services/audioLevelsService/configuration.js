// Audio-Level Configuration
// Purpose: Defines server base gains and the permitted personal adjustment range.
// Scope: Exports only defaults and validation metadata.
const { strictObject, number, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'audioLevels',
  defaultValue: { hornGain: 1, ttsGain: 1, forwardGain: 1, maxPersonalAdjustmentPercent: 50 },
  schema: strictObject({
    hornGain: number({ minimum: 0, maximum: 4 }),
    ttsGain: number({ title: 'TTS gain', minimum: 0, maximum: 4 }),
    forwardGain: number({ minimum: 0, maximum: 4 }),
    maxPersonalAdjustmentPercent: integer({ minimum: 0, maximum: 100 }),
  }, { title: 'Audio levels', required: ['hornGain', 'ttsGain', 'forwardGain', 'maxPersonalAdjustmentPercent'] }),
};
