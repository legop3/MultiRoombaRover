import { createContext, useContext } from 'react';

const LayoutContext = createContext(null);

export function LayoutProvider({ layout, children }) {
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLayout() {
  const layout = useContext(LayoutContext);
  if (!layout) throw new Error('useLayout must be used within LayoutProvider.');
  return layout;
}
