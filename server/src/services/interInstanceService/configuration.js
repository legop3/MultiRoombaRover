// Inter-Instance Configuration
// Purpose: Defines directory participation and the public profile published to other instances.
// Scope: Exports data-only defaults and schema without starting polling or networking.
const { strictObject, string, boolean, integer, stringArray } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'interInstance',
  feature: true,
  defaultValue: {
    enabled: false,
    directoryUrls: [],
    pollIntervalMs: 30000,
    requestTimeoutMs: 5000,
    profile: { publicUrl: '', name: 'MultiRover', description: '', color: '#38bdf8' },
  },
  schema: strictObject({
    enabled: boolean({ description: 'Publishes this server\'s public instance information and polls the configured directories for peer servers.' }),
    directoryUrls: stringArray({
      item: { description: 'Absolute URL returning an array of peer MultiRover instance entries.', format: 'uri' },
      array: { description: 'Directory endpoints polled to discover other public MultiRover servers.' },
    }),
    pollIntervalMs: integer({ description: 'Milliseconds between peer-directory refreshes.', minimum: 1000, maximum: 86400000 }),
    requestTimeoutMs: integer({ description: 'Maximum milliseconds allowed for each directory or peer information request before it is aborted.', minimum: 250, maximum: 120000 }),
    profile: strictObject({
      publicUrl: string({ description: 'Public base URL peers and users use to reach this server; it also identifies and filters this instance from directory results.', maxLength: 2048 }),
      name: string({ description: 'Public instance name advertised to peer servers.', minLength: 1, maxLength: 120 }),
      description: string({ description: 'Short public summary advertised with this instance.', maxLength: 500 }),
      color: string({ description: 'Six-digit hexadecimal accent color advertised for this instance.', pattern: '^#[0-9a-fA-F]{6}$' }),
    }, { description: 'Public identity this server publishes through the inter-instance information endpoint.', required: ['publicUrl', 'name', 'description', 'color'] }),
  }, { title: 'Inter-instance directory', description: 'Controls discovery and public information exchange between independent MultiRover servers.', required: ['enabled', 'directoryUrls', 'pollIntervalMs', 'requestTimeoutMs', 'profile'] }),
};
