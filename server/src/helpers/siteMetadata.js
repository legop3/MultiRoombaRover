// Site Metadata Helper
// Purpose: Resolves the public name, description, and colors used before the web UI starts.
// Scope: Keeps document/PWA branding server-rendered and independent of Socket.IO session state.
const { loadConfig } = require('./configLoader');

const DEFAULT_SITE_METADATA = Object.freeze({
  name: 'Multi Roomba Rover',
  shortName: 'Multi Roomba Rover',
  description: 'Drive and watch remote rovers from your browser.',
  accentColor: '#38bdf8',
  backgroundColor: '#020617',
  publicUrl: null,
});

const BACKGROUND_BLEND_AMOUNT = 0.15;

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHexColor(value) {
  const color = asTrimmedString(value).toLowerCase();

  /*
    Supporting both common CSS hex forms keeps the operator-facing setting
    forgiving while still preventing arbitrary CSS from being injected into
    generated HTML and SVG attributes.
  */
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color.slice(1).split('').map((character) => character.repeat(2)).join('')}`;
  }
  return null;
}

function blendHexColors(baseColor, accentColor, accentAmount) {
  const base = baseColor.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16));
  const accent = accentColor.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16));

  /*
    The profile color is deliberately only a tint. A full-strength profile
    color could produce a glaring PWA launch screen, while this blend preserves
    the application's established dark appearance and still makes each server
    visually recognizable.
  */
  const channels = base.map((channel, index) =>
    Math.round(channel * (1 - accentAmount) + accent[index] * accentAmount),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function normalizePublicUrl(value) {
  const candidate = asTrimmedString(value);
  if (!candidate) return null;

  /*
    URL() helpfully repairs strings such as `http:192.168.0.1`, but preserving
    that typo in public metadata would conceal a configuration mistake. Require
    the conventional absolute URL form so the published address is explicit.
  */
  if (!/^https?:\/\//i.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    /*
      Removing a trailing slash gives callers one stable base URL to combine
      with paths. Invalid values are ignored instead of producing broken
      canonical and social metadata on every page.
    */
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function getReadableAccentText(accentColor) {
  const channels = accentColor.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16));
  const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;

  // A simple luminance split keeps the generated preview badge legible for both dark and light profile colors.
  return luminance > 150 ? '#020617' : '#ffffff';
}

function resolveSiteMetadata(config = loadConfig()) {
  const interInstance = config?.interInstance;
  const profile = interInstance?.profile;
  const profileName = asTrimmedString(profile?.name);

  /*
    A partially filled profile must not unexpectedly rename the site. The
    inter-instance feature must be explicitly enabled and have a usable name
    before any profile branding is applied; otherwise every value comes from
    the coherent default set above.
  */
  if (interInstance?.enabled !== true || !profileName) {
    return { ...DEFAULT_SITE_METADATA, accentTextColor: getReadableAccentText(DEFAULT_SITE_METADATA.accentColor) };
  }

  const accentColor = normalizeHexColor(profile.color) || DEFAULT_SITE_METADATA.accentColor;
  return {
    name: profileName,
    shortName: profileName,
    description: asTrimmedString(profile.description) || DEFAULT_SITE_METADATA.description,
    accentColor,
    backgroundColor: blendHexColors(
      DEFAULT_SITE_METADATA.backgroundColor,
      accentColor,
      BACKGROUND_BLEND_AMOUNT,
    ),
    accentTextColor: getReadableAccentText(accentColor),
    publicUrl: normalizePublicUrl(profile.publicUrl),
  };
}

module.exports = {
  DEFAULT_SITE_METADATA,
  resolveSiteMetadata,
};
