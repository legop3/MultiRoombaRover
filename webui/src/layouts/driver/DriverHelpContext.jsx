// Driver Help is independent of responsive layout and only exists on this route.
import { createContext, useContext } from 'react';

const DriverHelpContext = createContext(null);

export function DriverHelpProvider({ openHelp, children }) {
  return <DriverHelpContext.Provider value={openHelp}>{children}</DriverHelpContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOpenDriverHelp() {
  const openHelp = useContext(DriverHelpContext);
  if (!openHelp) throw new Error('useOpenDriverHelp must be used within DriverHelpProvider.');
  return openHelp;
}
