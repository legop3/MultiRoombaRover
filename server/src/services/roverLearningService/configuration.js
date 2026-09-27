// Metadata only: loading the configuration must never start the learning runtime.
const { strictObject, boolean, integer, number } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'roverLearning',
  feature: true,
  defaultValue: {
    enabled: false,
    recording: { maxGiB: 20, minimumFreeGiB: 2, sessionSeconds: 300 },
  },
  schema: strictObject({
    enabled: boolean({ description: 'Enable rover learning recording. Disabled starts no recording workers or storage. Training and autonomous control are not implemented yet.' }),
    recording: strictObject({
      maxGiB: number({ minimum: 0.1, maximum: 100000, description: 'Rolling recording budget in GiB. Checked every 15 seconds; active files can temporarily exceed it. Published models are never pruned.' }),
      minimumFreeGiB: number({ minimum: 0.1, maximum: 100000, description: 'Pause recording below this amount of available filesystem space, in GiB.' }),
      sessionSeconds: integer({ minimum: 30, maximum: 3600, description: 'Rotate video and telemetry sessions after this many seconds so completed sessions can be pruned.' }),
    }, { description: 'Bounded recording storage. Limits never delete published models.', required: ['maxGiB', 'minimumFreeGiB', 'sessionSeconds'] }),
  }, { description: 'Optional rover learning service. Currently provides passive recording only.', required: ['enabled', 'recording'] }),
};
