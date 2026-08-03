// Driver Layout Context
// Purpose: Exposes the existing global Help-overlay action to deeply placed tab content.
// Scope: Avoids threading a layout callback through otherwise concrete composition files.
import { createContext, useContext } from 'react';

const DriverLayoutContext = createContext(null);

export function DriverLayoutProvider({ layout, openHelp, children }) {
  /*
    Layout mode is classified once at the driver-route boundary. Concrete
    layouts and tabs read it here instead of each installing a resize listener
    or receiving chains of layout/configuration props.
  */
  return <DriverLayoutContext.Provider value={{ layout, openHelp }}>{children}</DriverLayoutContext.Provider>;
}

/*
  This hook intentionally lives beside its tiny route-local provider so the
  driver layout contract remains discoverable in one file. It is not a React
  component export, so the Fast Refresh rule needs this narrow exception.
*/
// eslint-disable-next-line react-refresh/only-export-components
export function useOpenDriverHelp() {
  const context = useContext(DriverLayoutContext);
  if (!context) {
    throw new Error('useOpenDriverHelp must be used within DriverLayoutProvider.');
  }
  return context.openHelp;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDriverLayout() {
  const context = useContext(DriverLayoutContext);
  if (!context) {
    throw new Error('useDriverLayout must be used within DriverLayoutProvider.');
  }
  return context.layout;
}
