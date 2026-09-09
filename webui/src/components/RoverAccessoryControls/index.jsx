// Rover Accessory Controls
// Purpose: Renders every generic control advertised by a selected rover as one ordered control surface.
// Scope: Reusable content only; mobile and desktop parents own placement, expansion, and visibility.
import { useCallback } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import useCanControlRover from '../../hooks/useCanControlRover.js';
import AccessoryControlField from './AccessoryControlField.jsx';
import useRoverAccessories from './useRoverAccessories.js';

const EMPTY_ACCESSORY_VALUES = Object.freeze({});

export default function RoverAccessoryControls({ roverId, headerAction = null, className = '' }) {
  const { peripherals } = useRoverAccessories(roverId);
  const canControl = useCanControlRover(roverId);
  const { setPeripheralControl } = useControlActions();
  const values = useControlSelector(
    (control) => control.state.peripheralValues?.[String(roverId)] || EMPTY_ACCESSORY_VALUES,
  );
  const send = useCallback(
    (peripheralId, controlId, value) => setPeripheralControl(peripheralId, controlId, value),
    [setPeripheralControl],
  );

  if (peripherals.length === 0) return null;

  return (
    <div
      className={`mobile-touch-control min-h-0 overflow-y-auto overscroll-contain text-slate-100 ${className}`.trim()}
      aria-label="Rover accessories"
    >
      {peripherals.map((peripheral, peripheralIndex) => {
        const showHeading = peripherals.length > 1 || (peripheralIndex === 0 && headerAction);
        return (
          <section key={peripheral.id} className="mb-0.5 last:mb-0">
            {/* The firmware's array order is authoritative. Mapping directly over
                it keeps physical authoring order intact across every UI host. */}
            {showHeading ? (
              <div className="mb-0.5 flex min-h-7 items-center gap-1 bg-black/60 px-1 text-xs font-semibold text-cyan-100">
                <h3 className="min-w-0 flex-1 truncate">{peripheral.name}</h3>
                {peripheralIndex === 0 ? headerAction : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5">
              {peripheral.controls.map((control) => (
                <AccessoryControlField
                  key={control.id}
                  peripheralId={peripheral.id}
                  control={control}
                  value={values[peripheral.id]?.[control.id]}
                  disabled={!roverId || !canControl}
                  send={send}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
