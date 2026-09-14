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
    enabled: boolean(),
    directoryUrls: stringArray({ item: { format: 'uri' } }),
    pollIntervalMs: integer({ minimum: 1000, maximum: 86400000 }),
    requestTimeoutMs: integer({ minimum: 250, maximum: 120000 }),
    profile: strictObject({
      publicUrl: string({ maxLength: 2048 }),
      name: string({ minLength: 1, maxLength: 120 }),
      description: string({ maxLength: 500 }),
      color: string({ pattern: '^#[0-9a-fA-F]{6}$' }),
    }, { required: ['publicUrl', 'name', 'description', 'color'] }),
  }, { title: 'Inter-instance directory', required: ['enabled', 'directoryUrls', 'pollIntervalMs', 'requestTimeoutMs', 'profile'] }),
};
