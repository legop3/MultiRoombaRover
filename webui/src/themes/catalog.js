// Page Theme Catalog
// Purpose: Defines persisted theme identities and their presentation order.
// Scope: Shared by the settings picker and every route that resolves a saved page theme.

export const DEFAULT_PAGE_THEME_KEY = 'progress-pride';

export const PAGE_THEME_OPTIONS = [
  // Stable keys are stored in the browser settings cookie. Keeping presentation labels separate
  // lets the UI wording improve later without invalidating anybody's saved preference.
  { key: 'progress-pride', label: 'Progress pride', className: 'page-theme-progress-pride' },
  // Keep the high-contrast caution-stripe option near the default so it is reachable with one
  // Next click as well as directly through the dropdown.
  { key: 'hazard-stripes', label: 'Hazard stripes', className: 'page-theme-hazard-stripes' },
  { key: 'pride-mix', label: 'Pride mix', className: 'page-theme-pride-mix' },
  { key: 'rainbow', label: 'Rainbow', className: 'page-theme-rainbow' },
  { key: 'transgender', label: 'Transgender', className: 'page-theme-transgender' },
  { key: 'bisexual', label: 'Bisexual', className: 'page-theme-bisexual' },
  { key: 'lesbian', label: 'Lesbian', className: 'page-theme-lesbian' },
  { key: 'nonbinary', label: 'Nonbinary', className: 'page-theme-nonbinary' },
  { key: 'pansexual', label: 'Pansexual', className: 'page-theme-pansexual' },
  { key: 'asexual', label: 'Asexual', className: 'page-theme-asexual' },
  { key: 'aurora', label: 'Aurora', className: 'page-theme-aurora' },
  { key: 'synthwave-grid', label: 'Synthwave grid', className: 'page-theme-synthwave-grid' },
  { key: 'neon-checker', label: 'Neon checker', className: 'page-theme-neon-checker' },
  { key: 'ocean-current', label: 'Ocean current', className: 'page-theme-ocean-current' },
  { key: 'ember-lattice', label: 'Ember lattice', className: 'page-theme-ember-lattice' },
  { key: 'starfield', label: 'Starfield', className: 'page-theme-starfield' },
  { key: 'vaporwave-sunset', label: 'Vaporwave sunset', className: 'page-theme-vaporwave-sunset' },
  { key: 'electric-circuit', label: 'Electric circuit', className: 'page-theme-electric-circuit' },
  { key: 'lava-flow', label: 'Lava flow', className: 'page-theme-lava-flow' },
  { key: 'deep-space-nebula', label: 'Deep-space nebula', className: 'page-theme-deep-space-nebula' },
  { key: 'holographic-waves', label: 'Holographic waves', className: 'page-theme-holographic-waves' },
  { key: 'mint-mosaic', label: 'Mint mosaic', className: 'page-theme-mint-mosaic' },
  { key: 'candy-swirl', label: 'Candy swirl', className: 'page-theme-candy-swirl' },
  { key: 'black', label: 'Black', className: 'page-theme-black' },
];

export function normalizePageThemeKey(value) {
  // Cookie contents can outlive catalog changes or be edited by hand. Always resolve them to a
  // known entry so the page, preview, and dropdown cannot disagree about the active selection.
  return PAGE_THEME_OPTIONS.some((theme) => theme.key === value)
    ? value
    : DEFAULT_PAGE_THEME_KEY;
}

export function getPageTheme(value) {
  const normalizedKey = normalizePageThemeKey(value);
  return PAGE_THEME_OPTIONS.find((theme) => theme.key === normalizedKey) || PAGE_THEME_OPTIONS[0];
}

export function getPageThemeClass(value) {
  // The shared base class owns page-level behavior such as fixed positioning. The modifier only
  // supplies artwork, which also lets the settings demonstration reuse the exact same theme.
  return `page-theme ${getPageTheme(value).className}`;
}
