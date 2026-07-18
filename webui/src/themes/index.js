// Theme Public API
// Purpose: Gives UI consumers one stable import path for catalog resolution and layout constants.
// Scope: Re-exports theme behavior while CSS remains independently loaded by the app entrypoint.

export {
  DEFAULT_PAGE_THEME_KEY,
  PAGE_THEME_OPTIONS,
  getPageTheme,
  getPageThemeClass,
  normalizePageThemeKey,
} from './catalog.js';
export { themeGapClass, themeStackClass } from './layout.js';
