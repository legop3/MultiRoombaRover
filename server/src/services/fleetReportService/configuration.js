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
    enabled: boolean({ description: 'Starts persistent fleet metric collection, reports, retention cleanup, and configured daily delivery after restart.' }),
    retention: strictObject({
      detailedDays: integer({ description: 'Days to retain detailed events, command observations, sessions, and other non-minute fleet records. Zero retains them indefinitely.', minimum: 0, maximum: 36500 }),
      minuteSamplesDays: integer({ description: 'Days to retain per-minute rover metric aggregates. Zero retains them indefinitely.', minimum: 0, maximum: 36500 }),
    }, {
      title: 'Retention',
      description: 'Automatic cleanup windows for the two classes of fleet-report records.',
      required: ['detailedDays', 'minuteSamplesDays'],
    }),
    battery: strictObject({
      enabled: boolean({ description: 'Collects high-frequency battery sensor readings and derives charging, discharge, energy, and capacity metrics.' }),
      maximumIntegrationGapSeconds: number({ description: 'Largest allowed gap in seconds between battery readings before energy integration treats the telemetry as discontinuous.', minimum: 0.1, maximum: 3600 }),
      minimumCapacityTestDepthPercent: number({ description: 'Minimum observed full-to-low discharge depth required before a continuous session qualifies as a high-confidence capacity test. Runtime enforces at least 10 percent.', minimum: 0, maximum: 100 }),
    }, {
      title: 'Battery',
      description: 'Battery telemetry collection and quality thresholds used by fleet reports.',
      required: ['enabled', 'maximumIntegrationGapSeconds', 'minimumCapacityTestDepthPercent'],
    }),
    discord: strictObject({
      enabled: boolean({ description: 'Sends one completed daily fleet report to the configured Discord administrative-alert channel.' }),
      sendAt: string({ description: 'Local time of day to send the daily report, written as 24-hour HH:mm.', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
      timezone: string({ description: 'IANA timezone used to interpret the delivery time and determine each completed report day.', minLength: 1, maxLength: 100 }),
    }, {
      title: 'Discord delivery',
      description: 'Schedule for sending completed daily fleet summaries through the Discord bot.',
      required: ['enabled', 'sendAt', 'timezone'],
    }),
    privacy: strictObject({
      retainChatBodies: boolean({ description: 'Reserved privacy preference. The current collector does not read this setting and preserves complete event payloads, including chat content, regardless of its value.' }),
    }, {
      title: 'Privacy',
      description: 'Privacy controls reserved for any future fleet-report collection of message content.',
      required: ['retainChatBodies'],
    }),
  }, {
    title: 'Fleet reports',
    description: 'Persistent fleet operations reporting, retention, battery analysis, delivery, and privacy preferences.',
    required: ['enabled', 'retention', 'battery', 'discord', 'privacy'],
  }),
};
