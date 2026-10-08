const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');
module.exports = {
  key: 'roomAudio', feature: true,
  defaultValue: { enabled: false, sources: [] },
  schema: strictObject({
    enabled: boolean({ description: 'Enable room audio and local browser microphone publishing.' }),
    sources: { type: 'array', items: strictObject({
      id: string({ minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' }),
      name: string({ minLength: 1, maxLength: 120 }),
      type: { type: 'string', enum: ['device', 'stream'] },
      input: string({ minLength: 1, maxLength: 2048, description: 'ALSA device (for example default or plughw:CARD=USB,DEV=0), or a network stream URL.' }),
    }, { required: ['id', 'name', 'type', 'input'] }) },
  }, { title: 'Room audio', required: ['enabled', 'sources'] }),
};
