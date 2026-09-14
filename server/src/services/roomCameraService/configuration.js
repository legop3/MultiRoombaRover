// Room-Camera Configuration
// Purpose: Defines the optional named snapshot and stream camera catalog.
// Scope: Contains configuration metadata only and never contacts a camera.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'roomCameras',
  feature: true,
  defaultValue: { enabled: false, cameras: [] },
  schema: strictObject({
    enabled: boolean({ description: 'Publishes the configured room-camera catalog and enables camera snapshots and streams after restart.' }),
    cameras: {
      type: 'array',
      description: 'Room cameras available to the web UI and replay system.',
      items: strictObject({
        id: string({ description: 'Stable camera identifier used in socket requests, selections, and replay source names.', minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' }),
        name: string({ description: 'Human-readable camera name shown in the UI.', minLength: 1, maxLength: 120 }),
        description: string({ description: 'Short explanation of the camera location or view shown in the UI.', maxLength: 500 }),
        url: string({ title: 'Snapshot URL', description: 'HTTP URL fetched when the server needs a still image from this camera.', format: 'uri', maxLength: 2048 }),
        streamUrl: string({ title: 'Stream URL', description: 'Live stream URL consumed by the server snapshot engine and replay capture path.', maxLength: 2048 }),
      }, {
        description: 'One named room camera with its still-image and live-stream sources.',
        required: ['id', 'name', 'description', 'url', 'streamUrl'],
      }),
    },
  }, {
    title: 'Room cameras',
    description: 'Optional catalog of fixed cameras used for room views, server-produced snapshots, and replay sources.',
    required: ['enabled', 'cameras'],
  }),
};
