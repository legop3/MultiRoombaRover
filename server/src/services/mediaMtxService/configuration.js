// Media Transport Configuration
// Purpose: Defines browser WHEP addressing and additional MediaMTX ICE hosts.
// Scope: Contains configuration metadata only and never starts MediaMTX.
const { strictObject, string, stringArray } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'media',
  defaultValue: { whepBaseUrl: 'http://127.0.0.1:8889/video', additionalHosts: [] },
  schema: strictObject({
    whepBaseUrl: string({ title: 'WHEP base URL', description: 'Base HTTP URL used to build browser WHEP playback and WHIP audio-publishing endpoints.', format: 'uri', maxLength: 2048 }),
    additionalHosts: stringArray({
      title: 'Additional ICE hosts',
      item: { description: 'Hostname or IP address MediaMTX advertises as a WebRTC ICE candidate.', minLength: 1, maxLength: 255 },
      array: { description: 'Additional public or LAN hostnames and addresses browsers may use to reach MediaMTX WebRTC transport.', uniqueItems: true },
    }),
  }, { title: 'Media', description: 'Controls browser signaling addresses and WebRTC network candidates generated for the managed MediaMTX process.', required: ['whepBaseUrl', 'additionalHosts'] }),
};
