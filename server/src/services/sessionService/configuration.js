// Session and Public Presentation Configuration
// Purpose: Defines the global timezone and browser-facing metadata assembled into session payloads.
// Scope: Contains configuration metadata only so the database can import it without initializing the session service.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

const timezone = {
  key: 'timezone',
  defaultValue: 'America/New_York',
  schema: string({ title: 'Timezone', description: 'IANA timezone used for server-facing dates and times.', minLength: 1, maxLength: 100 }),
};

const socials = {
  key: 'socials',
  feature: true,
  defaultValue: { enabled: false, links: [] },
  schema: strictObject({
    enabled: boolean({ title: 'Enabled' }),
    links: {
      type: 'array',
      title: 'Links',
      items: strictObject({
        id: string({ minLength: 1, maxLength: 60, pattern: '^[a-zA-Z0-9_-]+$' }),
        label: string({ minLength: 1, maxLength: 80 }),
        url: string({ format: 'uri', maxLength: 2048 }),
        icon: string({ maxLength: 80 }),
        color: string({ pattern: '^#[0-9a-fA-F]{6}$' }),
      }, { required: ['id', 'label', 'url', 'icon', 'color'] }),
    },
  }, { title: 'Social links', required: ['enabled', 'links'] }),
};

const driverAd = {
  key: 'driverAd',
  defaultValue: { title: '', html: '' },
  schema: strictObject({
    title: string({ maxLength: 120 }),
    html: string({ title: 'HTML', description: 'Trusted operator HTML shown to drivers.', maxLength: 100000 }),
  }, { title: 'Driver content', required: ['title', 'html'] }),
};

function getConfiguredSocials(config) {
  /*
    Link normalization belongs with the session-owned social configuration,
    not feature enablement. The explicit `socials.enabled` switch independently
    decides whether browsers should expose the resulting list.
  */
  const links = config?.socials?.links;
  return Array.isArray(links)
    ? links.filter((entry) => typeof entry?.url === 'string' && entry.url.trim())
    : [];
}

module.exports = { timezone, socials, driverAd, getConfiguredSocials };
