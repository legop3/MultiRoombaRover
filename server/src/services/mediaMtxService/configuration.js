// Media Transport Configuration
// Purpose: Defines browser WHEP addressing and additional MediaMTX ICE hosts.
// Scope: Contains configuration metadata only and never starts MediaMTX.
const { strictObject, string, stringArray } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'media',
  defaultValue: {
    // Signaling remains server-local because the internal `/video` proxy owns
    // browser access; only ICE transport addresses come from the legacy sample.
    whepBaseUrl: 'http://127.0.0.1:8889/video',
    additionalHosts: ['rover.example.com', 'media-server.local'],
  },
  schema: strictObject({
    whepBaseUrl: string({ title: 'WHEP base URL', description: 'Base HTTP URL used to build browser WHEP playback and WHIP audio-publishing endpoints.', format: 'uri', maxLength: 2048 }),
    additionalHosts: stringArray({
      title: 'Additional ICE hosts',
      item: { description: 'Hostname or IP address MediaMTX advertises as a WebRTC ICE candidate.', examples: ['rover.example.com', 'media-server.local'], minLength: 1, maxLength: 255 },
      array: { description: 'Additional public or LAN hostnames and addresses browsers may use to reach MediaMTX WebRTC transport.', uniqueItems: true },
    }),
  }, { title: 'Media', description: 'Controls browser signaling addresses and WebRTC network candidates generated for the managed MediaMTX process.', required: ['whepBaseUrl', 'additionalHosts'] }),
};
