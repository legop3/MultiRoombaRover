// Discord Bot Configuration
// Purpose: Defines the optional bot connection and its guild channel and role mappings.
// Scope: Contains configuration metadata only and never logs in to Discord.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'discord',
  feature: true,
  defaultValue: {
    enabled: false,
    token: '',
    guildId: '',
    siteUrl: '',
    channels: { general: '', announcements: '', adminAlerts: '', replay: '', humanAlerts: '' },
    roles: { stalkerPing: '', announcementPing: '', adminPing: '', humanAlertPing: '' },
  },
  schema: strictObject({
    enabled: boolean({ description: 'Logs the Discord bot in and enables commands, chat bridges, replay delivery, and configured announcements after restart.' }),
    token: string({ title: 'Bot token', description: 'Discord bot token used to log in. The saved value is never returned to the browser.', writeOnly: true, maxLength: 10000 }),
    guildId: string({ title: 'Guild id', description: 'Reserved Discord server identifier. The current bot runtime does not restrict commands or events using this value.', maxLength: 100 }),
    siteUrl: string({ title: 'Public site URL', description: 'Public base URL appended to announcement embeds and server-hosted replay links.', maxLength: 2048 }),
    channels: strictObject({
      general: string({ description: 'Channel ID used by the button-box stalker-role and everyone-ping rewards.', maxLength: 100 }),
      announcements: string({ description: 'Channel ID used for public-mode openings, objective changes, and all-rovers-unlocked announcements.', maxLength: 100 }),
      adminAlerts: string({ description: 'Channel ID used for rover health, battery, dock, help, and daily fleet-report notifications.', maxLength: 100 }),
      replay: string({ description: 'Channel ID used to upload generated replay videos when Discord replay delivery is available.', maxLength: 100 }),
      humanAlerts: string({ description: 'Channel ID used for physical human-alert button notifications and captured images.', maxLength: 100 }),
    }, {
      title: 'Channels',
      description: 'Discord channel IDs that route each category of bot output.',
      required: ['general', 'announcements', 'adminAlerts', 'replay', 'humanAlerts'],
    }),
    roles: strictObject({
      stalkerPing: string({ description: 'Role ID mentioned by the button-box stalker-ping reward in the general channel.', maxLength: 100 }),
      announcementPing: string({ description: 'Role ID mentioned by configured user announcements.', maxLength: 100 }),
      adminPing: string({ description: 'Role ID mentioned for important administrative rover, battery, and help alerts.', maxLength: 100 }),
      humanAlertPing: string({ description: 'Role ID mentioned when the physical human-alert button is pressed.', maxLength: 100 }),
    }, {
      title: 'Roles',
      description: 'Discord role IDs mentioned for specific notification categories.',
      required: ['stalkerPing', 'announcementPing', 'adminPing', 'humanAlertPing'],
    }),
  }, {
    title: 'Discord',
    description: 'Optional Discord bot credentials, public URL, and notification routing.',
    required: ['enabled', 'token', 'guildId', 'siteUrl', 'channels', 'roles'],
  }),
};
