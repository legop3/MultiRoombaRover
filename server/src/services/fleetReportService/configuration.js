// Fleet-Report Configuration
// Purpose: Defines collection, retention, battery integration, delivery, and privacy behavior.
// Scope: Contains configuration metadata only and never opens the reporting database.
const { strictObject, string, boolean, integer, number } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'fleetReports',
  feature: true,
  defaultValue: {
    enabled: false,
    retention: { detailedDays: 0, minuteSamplesDays: 0 },
    battery: { enabled: true, maximumIntegrationGapSeconds: 5, minimumCapacityTestDepthPercent: 60 },
    discord: { enabled: true, sendAt: '08:00', timezone: 'America/New_York' },
    privacy: { retainChatBodies: true },
  },
  schema: strictObject({
    enabled: boolean(),
    retention: strictObject({
      detailedDays: integer({ description: 'Zero retains indefinitely.', minimum: 0, maximum: 36500 }),
      minuteSamplesDays: integer({ description: 'Zero retains indefinitely.', minimum: 0, maximum: 36500 }),
    }, { required: ['detailedDays', 'minuteSamplesDays'] }),
    battery: strictObject({
      enabled: boolean(),
      maximumIntegrationGapSeconds: number({ minimum: 0.1, maximum: 3600 }),
      minimumCapacityTestDepthPercent: number({ minimum: 0, maximum: 100 }),
    }, { required: ['enabled', 'maximumIntegrationGapSeconds', 'minimumCapacityTestDepthPercent'] }),
    discord: strictObject({
      enabled: boolean(),
      sendAt: string({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
      timezone: string({ minLength: 1, maxLength: 100 }),
    }, { required: ['enabled', 'sendAt', 'timezone'] }),
    privacy: strictObject({ retainChatBodies: boolean() }, { required: ['retainChatBodies'] }),
  }, { title: 'Fleet reports', required: ['enabled', 'retention', 'battery', 'discord', 'privacy'] }),
};
