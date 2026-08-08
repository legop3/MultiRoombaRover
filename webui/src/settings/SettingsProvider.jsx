// Settings Provider
// Purpose: Supplies app-wide settings state and namespace-scoped update APIs. Scope: Bridges persistence helpers with React context for consistent settings access.
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
      const baseData = prev.status === 'ready' ? prev.data : loadSettings() ?? {};
      const current = baseData[namespace] || {};
      const nextValue = typeof updater === 'function' ? updater(current) : { ...current, ...(updater ?? {}) };
      const nextData = { ...baseData, [namespace]: nextValue };
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
  /*
    Defaults describe the initial shape of a namespace; they are not live state.
    Keep the first supplied value in lazy hook state because callers naturally pass object
    literals. Returning each newly-created literal while the namespace is absent
    would make an unchanged setting appear to change on every parent render and
    could retrigger effects that synchronize settings to the server.
  */
  const [initialDefaults] = useState(() => defaults ?? {});
  const value = data[namespace] ?? initialDefaults;

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
    /*
      Reset uses the same stable initial defaults exposed above. This keeps the
      namespace contract consistent even if a caller recreates its defaults
      object during later renders.
    */
    const base = typeof initialDefaults === 'object' ? { ...initialDefaults } : initialDefaults;
    setNamespace(namespace, () => base ?? {});
  }, [initialDefaults, namespace, setNamespace]);

  return { value, status, save, replace, reset };
}
