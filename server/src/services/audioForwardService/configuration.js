// Audio-Forwarding Configuration
// Purpose: Defines upload bounds and the ffmpeg publishing command inputs.
// Scope: Contains configuration metadata only and never creates runtime FIFOs.
const { strictObject, string, boolean, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'audioForward',
  defaultValue: { enabled: true, ffmpegBin: 'ffmpeg', streamSuffix: '-fwd', maxUploadBytes: 8388608 },
  schema: strictObject({
    enabled: boolean({ description: 'Enables verified current drivers to publish microphone or uploaded audio to their assigned rover.' }),
    ffmpegBin: string({ title: 'ffmpeg executable', description: 'Executable name or path used to run the long-lived audio publishing and playback workers.', minLength: 1, maxLength: 500 }),
    streamSuffix: string({ description: 'Suffix appended to each rover ID to form its internal MediaMTX forwarded-audio stream path.', minLength: 1, maxLength: 80 }),
    maxUploadBytes: integer({ description: 'Maximum accepted size in bytes for one uploaded audio clip.', minimum: 262144, maximum: 1073741824 }),
  }, { title: 'Audio forwarding', description: 'Controls browser-to-rover audio publishing, temporary uploaded clips, and the ffmpeg workers that feed MediaMTX.', required: ['enabled', 'ffmpegBin', 'streamSuffix', 'maxUploadBytes'] }),
};
