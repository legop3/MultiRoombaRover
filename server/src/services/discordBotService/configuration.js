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
    enabled: boolean(),
    token: string({ title: 'Bot token', writeOnly: true, maxLength: 10000 }),
    guildId: string({ title: 'Guild id', maxLength: 100 }),
    siteUrl: string({ title: 'Public site URL', maxLength: 2048 }),
    channels: strictObject({
      general: string({ maxLength: 100 }),
      announcements: string({ maxLength: 100 }),
      adminAlerts: string({ maxLength: 100 }),
      replay: string({ maxLength: 100 }),
      humanAlerts: string({ maxLength: 100 }),
    }, { required: ['general', 'announcements', 'adminAlerts', 'replay', 'humanAlerts'] }),
    roles: strictObject({
      stalkerPing: string({ maxLength: 100 }),
      announcementPing: string({ maxLength: 100 }),
      adminPing: string({ maxLength: 100 }),
      humanAlertPing: string({ maxLength: 100 }),
    }, { required: ['stalkerPing', 'announcementPing', 'adminPing', 'humanAlertPing'] }),
  }, { title: 'Discord', required: ['enabled', 'token', 'guildId', 'siteUrl', 'channels', 'roles'] }),
};
