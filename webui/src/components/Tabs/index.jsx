// Tabs
// Purpose: Defines the Tabs module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';

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

function hexToRgb(hex) {
  const raw = String(hex || '').trim();
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
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
  const ownRoverColor = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    if (!roverId) return null;
    const roster = Array.isArray(state.session?.roster) ? state.session.roster : [];
    const rover = roster.find((entry) => String(entry?.id) === roverId);
    return rover?.color || null;
  });
  const accentRgb = hexToRgb(ownRoverColor);
  const frameStyle = accentRgb ? { borderColor: rgba(accentRgb, 0.35) } : undefined;
  const headerStyle = accentRgb
    ? {
        backgroundImage: `linear-gradient(90deg, rgba(23,23,23,0.96) 0%, rgba(38,38,38,0.94) 58%, ${rgba(accentRgb, 0.18)} 100%)`,
      }
    : undefined;

  return (
    <div
      className={classNames(
        'panel-section overflow-hidden border border-neutral-500/60 bg-neutral-900/95 p-0.5 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_10px_24px_rgba(0,0,0,0.28)]',
        className
      )}
      style={frameStyle}
    >
      <div className="flex gap-0.5" style={headerStyle}>{children}</div>
    </div>
  );
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
