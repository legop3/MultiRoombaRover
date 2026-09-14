// Bandwidth-Savings Configuration
// Purpose: Defines the server-owned live-video and snapshot policy interpreted by this helper.
// Scope: Exports configuration metadata without reading sessions or calculating policy.
const { strictObject, string, boolean, integer } = require('../configuration/schemaHelpers');

module.exports = {
  key: 'bandwidthSavings',
  defaultValue: {
    multiTabProtection: 'verifiedOnly',
    pauseHiddenRoverVideo: false,
    nonTurnVideo: { mode: 'snapshots', userThreshold: 0 },
    externalSpectatorVideo: 'snapshots',
    externalSpectatorAccess: 'on',
  },
  schema: strictObject({
    multiTabProtection: string({ enum: ['allowed', 'verifiedOnly', 'notAllowed'] }),
    pauseHiddenRoverVideo: boolean(),
    nonTurnVideo: strictObject({
      mode: string({ enum: ['snapshots', 'live'] }),
      userThreshold: integer({ minimum: 0, maximum: 100000 }),
    }, { required: ['mode', 'userThreshold'] }),
    externalSpectatorVideo: string({ enum: ['snapshots', 'live'] }),
    externalSpectatorAccess: string({ enum: ['off', 'on', 'verifiedOnly', 'admin'] }),
  }, { title: 'Bandwidth savings', required: ['multiTabProtection', 'pauseHiddenRoverVideo', 'nonTurnVideo', 'externalSpectatorVideo', 'externalSpectatorAccess'] }),
};
