// Media Transport Configuration
// Purpose: Defines the WebRTC media port and additional ICE hosts.
// Scope: Contains configuration metadata only and never starts MediaMTX.
const { strictObject, stringArray, integer } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'media',
  defaultValue: {
    webrtcPort: 8189,
    additionalHosts: [],
  },
  schema: strictObject({
    webrtcPort: integer({
      title: 'WebRTC port',
      description: 'UDP and TCP port for live media. Forward the same external port to this server; HTTPS signaling continues through the web UI.',
      minimum: 1, maximum: 65535,
    }),
    additionalHosts: stringArray({
      title: 'Additional ICE hosts',
      item: { description: 'Hostname or IP address MediaMTX advertises as a WebRTC ICE candidate.', examples: ['rover.example.com', 'media-server.local'], minLength: 1, maxLength: 255 },
      array: { description: 'Extra public or LAN hostnames and addresses browsers may use in addition to the hostname derived from the top-level public URL.', uniqueItems: true },
    }),
  }, { title: 'Media', description: 'Configures the WebRTC media port and additional network candidates.', required: ['webrtcPort', 'additionalHosts'] }),
};
