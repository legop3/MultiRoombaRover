// Corner Pod Visibility
// Purpose: Persists each independent pod or expansion without coupling unrelated corner controls.
import { useCallback } from 'react';
import { useSettingsNamespace } from '../../../../settings/index.js';

export default function usePodVisibility(key, defaultOpen = true) {
  const { value, save } = useSettingsNamespace('newdrivePods', {});
  const open = value?.[key] == null ? defaultOpen : value[key] !== false;
  const setOpen = useCallback(
    (nextOpen) => save((current) => ({ ...(current || {}), [key]: Boolean(nextOpen) })),
    [key, save],
  );
  return [open, setOpen];
}
