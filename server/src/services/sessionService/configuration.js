// Session and Public Presentation Configuration
// Purpose: Defines the global timezone and browser-facing metadata assembled into session payloads.
// Scope: Contains configuration metadata only so the database can import it without initializing the session service.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

const publicUrl = {
  key: 'publicUrl',
  defaultValue: 'https://rover.example.com',
  schema: string({
    title: 'Public URL',
    description: 'Canonical public base URL used for links, peer identity, page metadata, and the public WebRTC hostname.',
    examples: ['https://rover.example.com'],
    format: 'uri',
    pattern: '^https?://',
    minLength: 1,
    maxLength: 2048,
  }),
};

const timezone = {
  key: 'timezone',
  defaultValue: 'America/New_York',
  schema: string({ title: 'Timezone', description: 'IANA timezone used for server-facing dates and times.', minLength: 1, maxLength: 100 }),
};

const socials = {
  key: 'socials',
  feature: true,
  // A complete starter list matches the former YAML template without exposing
  // it to users until the service-owned enabled switch is deliberately set.
  defaultValue: {
    enabled: false,
    links: [
      {
        id: 'discord',
        label: 'Discord',
        url: 'https://discord.gg/your-invite',
        icon: 'FaDiscord',
        color: '#5865F2',
      },
      {
        id: 'kofi',
        label: 'Ko-fi',
        url: 'https://ko-fi.com/your-handle',
        icon: 'FaCoffee',
        color: '#29ABE0',
      },
    ],
  },
  schema: strictObject({
    enabled: boolean({ title: 'Enabled', description: 'Shows the configured social-link buttons in driver and inter-instance views.' }),
    links: {
      type: 'array',
      title: 'Links',
      description: 'Ordered social or community links presented to users when this feature is enabled.',
      items: strictObject({
        id: string({ description: 'Stable identifier used by the UI to distinguish this link from the others.', examples: ['discord'], minLength: 1, maxLength: 60, pattern: '^[a-zA-Z0-9_-]+$' }),
        label: string({ description: 'User-facing text displayed on the link button.', examples: ['Discord'], minLength: 1, maxLength: 80 }),
        url: string({ description: 'Absolute destination opened when a user selects this link.', examples: ['https://discord.gg/your-invite'], format: 'uri', maxLength: 2048 }),
        icon: string({ description: 'Icon name interpreted by the social-button UI; leave blank to use its fallback presentation.', examples: ['FaDiscord'], maxLength: 80 }),
        color: string({ description: 'Six-digit hexadecimal accent color used for this link button.', examples: ['#5865F2'], pattern: '^#[0-9a-fA-F]{6}$' }),
      }, { description: 'One social-link button shown to users.', required: ['id', 'label', 'url', 'icon', 'color'] }),
    },
  }, { title: 'Social links', description: 'Controls the optional social and community buttons published to local users and peer instances.', required: ['enabled', 'links'] }),
};

const driverAd = {
  key: 'driverAd',
  // The title is harmless presentation metadata, while the HTML stays empty so
  // a new installation never displays active sample content to drivers.
  defaultValue: { title: 'Advertisement', html: '' },
  schema: strictObject({
    title: string({ description: 'Heading displayed above the operator-provided content on the driver page; leave blank to use the card fallback.', examples: ['Advertisement'], maxLength: 120 }),
    html: string({ title: 'HTML', description: 'Trusted operator HTML shown to drivers.', examples: ['<a href="https://example.com" target="_blank" rel="noopener noreferrer"><img src="https://example.com/ad.png" alt="Advertisement"></a>'], maxLength: 100000 }),
  }, { title: 'Driver content', description: 'Operator-managed informational or promotional content displayed in the driver application.', required: ['title', 'html'] }),
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

module.exports = { publicUrl, timezone, socials, driverAd, getConfiguredSocials };
