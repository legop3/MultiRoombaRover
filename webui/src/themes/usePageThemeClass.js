// Active Page Theme Hook
// Purpose: Resolves personal theme settings together with temporary server-owned theme overrides.
// Scope: Keeps page shells unaware of individual modes while preserving the pure catalog helpers.
import { useSessionSelector } from '../context/SessionContext.jsx';
import { getPageThemeClass } from './catalog.js';

export default function usePageThemeClass(backgroundTheme) {
  const greenMode = useSessionSelector((state) => Boolean(state.session?.greenMode));

  /*
    Green mode is a temporary server-wide theme, so it wins at resolution time
    without modifying the user's persisted theme selection. Every page consumes
    this hook and therefore receives future server theme overrides consistently.
  */
  if (greenMode) return 'page-theme page-theme-green-mode';
  return getPageThemeClass(backgroundTheme);
}
