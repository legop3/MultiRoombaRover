// Room-Camera Configuration
// Purpose: Defines the optional named snapshot and stream camera catalog.
// Scope: Contains configuration metadata only and never contacts a camera.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'roomCameras',
  feature: true,
  // The example catalog documents the complete repeated-item shape as actual
  // initial configuration while the feature switch prevents network requests.
  defaultValue: {
    enabled: false,
    cameras: [
      {
        id: 'lobby',
        name: 'Lobby Camera',
        description: 'Wide shot of the staging area.',
        url: 'http://192.168.0.50/snapshot.jpg',
        streamUrl: 'http://192.168.0.50/stream.mjpg',
      },
      {
        id: 'workshop',
        name: 'Workshop Bench',
        description: 'Shows the workbench and charging docks.',
        url: 'http://192.168.0.51/snapshot.jpg',
        streamUrl: 'http://192.168.0.51/stream.mjpg',
      },
    ],
  },
  schema: strictObject({
    enabled: boolean({ description: 'Immediately publishes the configured room-camera catalog and enables camera snapshots and streams.' }),
    cameras: {
      type: 'array',
      description: 'Room cameras available to the web UI and replay system.',
      items: strictObject({
        id: string({ description: 'Stable camera identifier used in socket requests, selections, and replay source names.', examples: ['lobby'], minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' }),
        name: string({ description: 'Human-readable camera name shown in the UI.', examples: ['Lobby Camera'], minLength: 1, maxLength: 120 }),
        description: string({ description: 'Optional explanation of the camera location or view shown in the UI.', examples: ['Wide shot of the staging area.'], maxLength: 500 }),
        url: string({ title: 'Snapshot URL', description: 'Optional HTTP URL fetched when the server needs a still image from this camera.', examples: ['http://192.168.0.50/snapshot.jpg'], format: 'uri', maxLength: 2048 }),
        streamUrl: string({ title: 'Stream URL', description: 'Optional live stream URL consumed by the server snapshot engine and replay capture path.', examples: ['http://192.168.0.50/stream.mjpg'], maxLength: 2048 }),
      }, {
        // The runtime has always accepted snapshot-only and stream-only camera
        // entries, and treats descriptions as presentation metadata. Requiring
        // all three optional values made working YAML impossible to import.
        description: 'One named room camera with an optional description and any snapshot or live-stream sources it provides.',
        required: ['id', 'name'],
      }),
    },
  }, {
    title: 'Room cameras',
    description: 'Optional catalog of fixed cameras used for room views, server-produced snapshots, and replay sources.',
    required: ['enabled', 'cameras'],
  }),
};
