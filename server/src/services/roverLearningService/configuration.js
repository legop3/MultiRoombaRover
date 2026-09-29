// Metadata only: loading the configuration must never start the learning runtime.
const { strictObject, boolean, integer, number, string } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'roverLearning',
  feature: true,
  defaultValue: {
    enabled: false,
    recording: { maxGiB: 20, minimumFreeGiB: 2, sessionSeconds: 300 },
    driving: { threads: 4, actionThreshold: 0.7, staleMs: 2000 },
    training: {
      enabled: true, python: '/opt/rover-learning/bin/python', threads: 8,
      batchSize: 16, maxSamples: 1024, minimumSamples: 128, passesPerJob: 2,
      maxStepsPerJob: 200, checkpointEverySteps: 1000,
      minimumDrivingMinutes: 30, newDrivingMinutesPerModel: 10,
      intervalSeconds: 60, maxJobSeconds: 600,
    },
  },
  schema: strictObject({
    enabled: boolean({ description: 'Enable human-session recording, background learning, and verified-user model control. Disabled starts no workers or storage.' }),
    driving: strictObject({
      threads: integer({ minimum: 1, maximum: 16, description: 'CPU threads per active model controller.' }),
      actionThreshold: number({ minimum: 0.5, maximum: 0.99, description: 'Minimum model score for issuing a command, including drive and stop commands.' }),
      staleMs: integer({ minimum: 1000, maximum: 5000, description: 'Stop when video, sensors, or model predictions are older than this many milliseconds.' }),
    }, { description: 'Live model execution. Manual inputs do not stop or pause the model.', required: ['threads', 'actionThreshold', 'staleMs'] }),
    recording: strictObject({
      maxGiB: number({ minimum: 0.1, maximum: 100000, description: 'Rolling recording budget in GiB. Checked every 15 seconds; active files can temporarily exceed it. Published models are never pruned.' }),
      minimumFreeGiB: number({ minimum: 0.1, maximum: 100000, description: 'Pause recording below this amount of available filesystem space, in GiB.' }),
      sessionSeconds: integer({ minimum: 30, maximum: 3600, description: 'Rotate video and telemetry sessions after this many seconds so completed sessions can be pruned.' }),
    }, { description: 'Bounded recording storage. Limits never delete published models.', required: ['maxGiB', 'minimumFreeGiB', 'sessionSeconds'] }),
    training: strictObject({
      enabled: boolean({ description: 'Train periodically from completed usable human recordings while the service is enabled.' }),
      python: string({ minLength: 1, description: 'Python executable with the service requirements installed. The container supplies /opt/rover-learning/bin/python.' }),
      threads: integer({ minimum: 1, maximum: 32, description: 'CPU threads for the lower-priority training process.' }),
      batchSize: integer({ minimum: 1, maximum: 64, description: 'Training windows per optimizer step.' }),
      maxSamples: integer({ minimum: 128, maximum: 2048, description: 'Maximum decoded windows retained in RAM per job. Each contains four 160x120 RGB frames.' }),
      minimumSamples: integer({ minimum: 1, maximum: 128, description: 'Usable sampled windows required before training.' }),
      passesPerJob: integer({ minimum: 1, maximum: 10, description: 'Shuffled passes over the sampled windows per job.' }),
      minimumDrivingMinutes: number({ minimum: 1, maximum: 100000, description: 'Minimum distinct usable training footage in minutes before promoting Latest; repeated passes do not count.' }),
      newDrivingMinutesPerModel: number({ minimum: 1, maximum: 100000, description: 'Additional distinct usable footage required between Latest promotions.' }),
      maxStepsPerJob: integer({ minimum: 1, maximum: 10000, description: 'Optimizer step cap per finite training job.' }),
      checkpointEverySteps: integer({ minimum: 1, maximum: 100000, description: 'Accumulated training steps between gated Latest promotions. Permanent named snapshots are created by administrators.' }),
      intervalSeconds: integer({ minimum: 30, maximum: 86400, description: 'Minimum seconds between completed training jobs.' }),
      maxJobSeconds: integer({ minimum: 30, maximum: 3600, description: 'Wall-clock budget including video decoding; slow/stuck workers are stopped.' }),
    }, { description: 'Ongoing CPU learning, sampling, and gated Latest checkpoint updates.', required: ['enabled', 'python', 'threads', 'batchSize', 'maxSamples', 'minimumSamples', 'passesPerJob', 'minimumDrivingMinutes', 'newDrivingMinutesPerModel', 'maxStepsPerJob', 'checkpointEverySteps', 'intervalSeconds', 'maxJobSeconds'] }),
  }, { description: 'Optional rover recording and learning service.', required: ['enabled', 'recording', 'training', 'driving'] }),
};
