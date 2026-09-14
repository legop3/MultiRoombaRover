// Room-Camera Configuration
// Purpose: Defines the optional named snapshot and stream camera catalog.
// Scope: Contains configuration metadata only and never contacts a camera.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'roomCameras',
  feature: true,
  defaultValue: { enabled: false, cameras: [] },
  schema: strictObject({
    enabled: boolean(),
    cameras: {
      type: 'array',
      items: strictObject({
        id: string({ minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' }),
        name: string({ minLength: 1, maxLength: 120 }),
        description: string({ maxLength: 500 }),
        url: string({ title: 'Snapshot URL', format: 'uri', maxLength: 2048 }),
        streamUrl: string({ title: 'Stream URL', maxLength: 2048 }),
      }, { required: ['id', 'name', 'description', 'url', 'streamUrl'] }),
    },
  }, { title: 'Room cameras', required: ['enabled', 'cameras'] }),
};
