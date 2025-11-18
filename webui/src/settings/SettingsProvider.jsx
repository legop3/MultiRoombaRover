import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadSettings, saveSettings } from './persistence.js';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [state, setState] = useState(() => ({ status: 'loading', data: {} }));

  useEffect(() => {
    const loaded = loadSettings();
    setState({ status: 'ready', data: loaded ?? {} });
  }, []);

  const reload = useCallback(() => {
    const loaded = loadSettings();
    setState({ status: 'ready', data: loaded ?? {} });
  }, []);

  const saveAll = useCallback((nextData) => {
    const success = saveSettings(nextData ?? {});
    if (success) {
      setState({ status: 'ready', data: nextData ?? {} });
    } else {
      setState((prev) => ({ ...prev, status: 'error' }));
    }
    return success;
  }, []);

  const setNamespace = useCallback((namespace, updater) => {
    setState((prev) => {
      const current = prev.data[namespace] || {};
      const nextValue = typeof updater === 'function' ? updater(current) : { ...current, ...(updater ?? {}) };
      const nextData = { ...prev.data, [namespace]: nextValue };
      const success = saveSettings(nextData);
      if (!success) {
        return { ...prev, status: 'error' };
      }
      return { status: 'ready', data: nextData };
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      data: state.data,
      status: state.status,
      reload,
      saveAll,
      setNamespace,
    }),
    [state, reload, saveAll, setNamespace],
  );

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return ctx;
}

export function useSettingsNamespace(namespace, defaults = {}) {
  const { data, status, setNamespace } = useSettings();
  const value = data[namespace] ?? defaults ?? {};

  const save = useCallback(
    (update) => {
      setNamespace(namespace, (current) => {
        const base = current ?? {};
        if (typeof update === 'function') {
          return update(base);
        }
        return { ...base, ...(update ?? {}) };
      });
    },
    [namespace, setNamespace],
  );

  const replace = useCallback(
    (nextValue) => {
      setNamespace(namespace, () => nextValue ?? {});
    },
    [namespace, setNamespace],
  );

  const reset = useCallback(() => {
    const base = typeof defaults === 'object' ? { ...defaults } : defaults;
    setNamespace(namespace, () => base ?? {});
  }, [defaults, namespace, setNamespace]);

  return { value, status, save, replace, reset };
}
