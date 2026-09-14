// Audio-Forwarding Configuration
// Purpose: Defines upload bounds and the ffmpeg publishing command inputs.
// Scope: Contains configuration metadata only and never creates runtime FIFOs.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'audioForward',
  defaultValue: { enabled: true, ffmpegBin: 'ffmpeg', streamSuffix: '-fwd', maxUploadBytes: 8388608 },
  schema: strictObject({
    enabled: boolean(),
    ffmpegBin: string({ title: 'ffmpeg executable', minLength: 1, maxLength: 500 }),
    streamSuffix: string({ minLength: 1, maxLength: 80 }),
    maxUploadBytes: integer({ minimum: 262144, maximum: 1073741824 }),
  }, { title: 'Audio forwarding', required: ['enabled', 'ffmpegBin', 'streamSuffix', 'maxUploadBytes'] }),
};
