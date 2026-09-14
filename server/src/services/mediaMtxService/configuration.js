// Media Transport Configuration
// Purpose: Defines browser WHEP addressing and additional MediaMTX ICE hosts.
// Scope: Contains configuration metadata only and never starts MediaMTX.
const { strictObject, string, stringArray } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'media',
  defaultValue: { whepBaseUrl: 'http://127.0.0.1:8889/video', additionalHosts: [] },
  schema: strictObject({
    whepBaseUrl: string({ title: 'WHEP base URL', format: 'uri', maxLength: 2048 }),
    additionalHosts: stringArray({ title: 'Additional ICE hosts', item: { minLength: 1, maxLength: 255 }, array: { uniqueItems: true } }),
  }, { title: 'Media', required: ['whepBaseUrl', 'additionalHosts'] }),
};
