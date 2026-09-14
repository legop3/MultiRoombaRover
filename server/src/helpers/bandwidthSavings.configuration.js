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
    multiTabProtection: string({ description: 'Controls multiple active driver tabs: allowed permits everyone, verifiedOnly limits ordinary unverified users, and notAllowed limits all non-admin users.', enum: ['allowed', 'verifiedOnly', 'notAllowed'] }),
    pauseHiddenRoverVideo: boolean({ description: 'Stops a rover video player while its browser surface is hidden, reducing unnecessary client and server bandwidth.' }),
    nonTurnVideo: strictObject({
      mode: string({ description: 'snapshots replaces non-turn live rover video after the threshold is exceeded; live always permits live video.', enum: ['snapshots', 'live'] }),
      userThreshold: integer({ description: 'Maximum controllable-user count allowed before snapshot mode activates for non-turn viewers; zero activates it whenever any controllable user exists.', minimum: 0, maximum: 100000 }),
    }, { description: 'Controls whether users who are not currently driving receive live rover video or periodic snapshots.', required: ['mode', 'userThreshold'] }),
    externalSpectatorVideo: string({ description: 'Video delivered to non-local spectator pages: snapshots conserves upload bandwidth, while live permits continuous playback.', enum: ['snapshots', 'live'] }),
    externalSpectatorAccess: string({ description: 'Access for ordinary non-local spectators: off denies them, on permits them, verifiedOnly requires verification, and admin requires the spectator access grant. Local users and administrators remain allowed.', enum: ['off', 'on', 'verifiedOnly', 'admin'] }),
  }, { title: 'Bandwidth savings', description: 'Defines server-owned policies for duplicate driver tabs and when live video is replaced with snapshots.', required: ['multiTabProtection', 'pauseHiddenRoverVideo', 'nonTurnVideo', 'externalSpectatorVideo', 'externalSpectatorAccess'] }),
};
