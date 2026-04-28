// Tabs
// Purpose: Defines the Tabs module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';

const TabsContext = createContext(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a <Tabs> provider.');
  }
  return context;
}

const TAB_VARIANTS = {
  primary: {
    base: 'flex-1 px-0.5 py-0.5 text-sm font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-slate-500 rounded-md border border-slate-800',
    active: 'bg-sky-600 text-white border-white',
    inactive: 'bg-zinc-900 text-slate-300 hover:bg-sky-500 hover:text-white',
  },
};

const TAB_HIGHLIGHTS = {
  none: '',
  pink: 'bg-pink-500 text-white border-pink-200 hover:bg-pink-400',
  green: 'bg-emerald-500 text-white border-emerald-200 hover:bg-emerald-400',
};

const DEFAULT_VARIANT = 'primary';

function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function Tabs({ children, defaultTab, currentTab, onTabChange, variant = DEFAULT_VARIANT }) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? null);
  const [tabOrder, setTabOrder] = useState([]);

  const registerTab = useCallback((id) => {
    if (!id) {
      return () => {};
    }

    setTabOrder((prev) => {
      if (prev.includes(id)) {
        return prev;
      }
      return [...prev, id];
    });

    return () =>
      setTabOrder((prev) => {
        if (!prev.includes(id)) {
          return prev;
        }
        return prev.filter((existing) => existing !== id);
      });
  }, []);

  const activeTab = currentTab ?? internalTab ?? tabOrder[0] ?? null;

  useEffect(() => {
    if (defaultTab && currentTab === undefined) {
      setInternalTab(defaultTab);
    }
  }, [defaultTab, currentTab]);

  const setActiveTab = useCallback(
    (id) => {
      if (!id) {
        return;
      }
      if (currentTab === undefined) {
        setInternalTab(id);
      }
      if (onTabChange) {
        onTabChange(id);
      }
    },
    [currentTab, onTabChange]
  );

  const value = useMemo(
    () => ({
      activeTab,
      setActiveTab,
      registerTab,
      variant,
    }),
    [activeTab, setActiveTab, registerTab, variant]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function TabList({ children, className = '' }) {
  return <div className={classNames('flex gap-0.5', className)}>{children}</div>;
}

export function Tab({ id, children, className = '', disabled = false, highlight = 'none' }) {
  const { activeTab, setActiveTab, registerTab, variant } = useTabsContext();

  useEffect(() => registerTab(id), [id, registerTab]);

  const variantStyles = TAB_VARIANTS[variant] ?? TAB_VARIANTS[DEFAULT_VARIANT];
  const isActive = activeTab === id;
  const highlightClass = TAB_HIGHLIGHTS[highlight] || TAB_HIGHLIGHTS.none;

  const buttonClassName = classNames(
    variantStyles.base,
    highlightClass || (isActive ? variantStyles.active : variantStyles.inactive),
    disabled ? 'cursor-not-allowed opacity-50' : '',
    className
  );

  return (
    <button
      type="button"
      className={buttonClassName}
      onClick={() => !disabled && setActiveTab(id)}
      aria-pressed={isActive}
      aria-disabled={disabled}
    >
      {children}
    </button>
  );
}

export function TabPanels({ children, className = '' }) {
  return <div className={classNames('mt-0 space-y-0.5', className)}>{children}</div>;
}

export function TabPanel({ id, children, keepMounted = false }) {
  const { activeTab } = useTabsContext();
  const isActive = activeTab === id;

  if (!isActive && !keepMounted) {
    return null;
  }

  if (!isActive && keepMounted) {
    return (
      <div hidden aria-hidden="true">
        {children}
      </div>
    );
  }

  return <>{children}</>;
}
