// Hook: useHudMapSetting
// Purpose: Reads and persists HUD map visibility/preferences via settings namespaces. Scope: Exposes a small stateful API for map toggle interactions.
import { useSettingsNamespace } from '../settings/index.js';

export function useHudMapSetting() {
  const { value, save } = useSettingsNamespace('page', { hudMapDesktop: false });
  const enabled = Boolean(value?.hudMapDesktop);
  const setEnabled = (next) => {
    save({ hudMapDesktop: Boolean(next) });
  };
  return [enabled, setEnabled];
}
