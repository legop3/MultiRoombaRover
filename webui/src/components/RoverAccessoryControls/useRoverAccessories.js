// Rover Accessories Selector
// Purpose: Provides the ordered generic-control inventory advertised by one rover.
// Scope: Selects public roster metadata only; placement and visibility remain parent-UI decisions.
import { useMemo } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';

export default function useRoverAccessories(roverId) {
  const rosterEntry = useSessionSelector((state) => {
    if (!roverId) return null;
    const roster = Array.isArray(state.session?.roster) ? state.session.roster : [];
    return roster.find((entry) => String(entry.id) === String(roverId)) || null;
  });
  const advertisedPeripherals = rosterEntry?.peripherals;

  const peripherals = useMemo(() => {
    if (!Array.isArray(advertisedPeripherals)) return [];
    // A peripheral with no generic controls may still provide a standardized
    // camera, headlight, or laser backend. Those roles use their established
    // HUD controls and must not create an empty Accessories surface.
    return advertisedPeripherals.filter(
      (peripheral) => Array.isArray(peripheral?.controls) && peripheral.controls.length > 0,
    );
  }, [advertisedPeripherals]);

  return {
    peripherals,
    hasAccessories: peripherals.length > 0,
  };
}
