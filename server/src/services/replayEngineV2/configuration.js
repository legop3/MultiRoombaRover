// Replay Configuration
// Purpose: Defines operator-adjustable replay settings shown in the admin configuration panel.
// Scope: Contains configuration metadata only; the replay engine reads the live value at build time.
const { strictObject, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'replay',
  defaultValue: {
    durationSeconds: 45,
  },
  schema: strictObject({
    durationSeconds: integer({
      title: 'Replay length (seconds)',
      description: 'Length of each generated replay clip, counted back from the moment it is requested. Applies to rover, room-camera, and PTZ replays and takes effect on the next replay without a restart. The server automatically keeps enough recent footage buffered for the chosen length. Longer clips take longer to render and are encoded at a lower bitrate to stay under the upload size limit.',
      minimum: 5,
      maximum: 120,
    }),
  }, {
    title: 'Replays',
    description: 'Settings for the replay clips that users, Discord, and the web UI can request.',
    required: ['durationSeconds'],
  }),
};
