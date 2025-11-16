import { createContext, useContext } from 'react';
import { useDriveControls as useDriveControlsHook } from '../hooks/useDriveControls.js';

/* eslint-disable react-refresh/only-export-components */

const DriveControlContext = createContext(null);

export function DriveControlProvider({ children }) {
  const controls = useDriveControlsHook();
  return <DriveControlContext.Provider value={controls}>{children}</DriveControlContext.Provider>;
}

export function useDriveControl() {
  const context = useContext(DriveControlContext);
  if (!context) {
    throw new Error('useDriveControl must be used within DriveControlProvider');
  }
  return context;
}
