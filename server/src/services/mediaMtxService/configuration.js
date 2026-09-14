// Media Transport Configuration
// Purpose: Defines additional MediaMTX ICE hosts not already derived from the server's public URL.
// Scope: Contains configuration metadata only and never starts MediaMTX.
const { strictObject, stringArray } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'media',
  defaultValue: {
    additionalHosts: [],
  },
  schema: strictObject({
    additionalHosts: stringArray({
      title: 'Additional ICE hosts',
      item: { description: 'Hostname or IP address MediaMTX advertises as a WebRTC ICE candidate.', examples: ['rover.example.com', 'media-server.local'], minLength: 1, maxLength: 255 },
      array: { description: 'Extra public or LAN hostnames and addresses browsers may use in addition to the hostname derived from the top-level public URL.', uniqueItems: true },
    }),
  }, { title: 'Media', description: 'Adds optional WebRTC network candidates to the public hostname and local interfaces generated automatically for MediaMTX.', required: ['additionalHosts'] }),
};
