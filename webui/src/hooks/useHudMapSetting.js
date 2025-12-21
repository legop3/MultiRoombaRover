import { useSettingsNamespace } from '../settings/index.js';

export function useHudMapSetting() {
  const { value, save } = useSettingsNamespace('page', { hudMapDesktop: false });
  const enabled = Boolean(value?.hudMapDesktop);
  const setEnabled = (next) => {
    save({ hudMapDesktop: Boolean(next) });
  };
  return [enabled, setEnabled];
}
