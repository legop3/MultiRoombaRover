// Rover Accessory Controls
// Purpose: Renders every generic control advertised by a selected rover as one ordered control surface.
// Scope: Reusable content only; mobile and desktop parents own placement, expansion, and visibility.
import { useCallback } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import useCanControlRover from '../../hooks/useCanControlRover.js';
import AccessoryControlField from './AccessoryControlField.jsx';
import useRoverAccessories from './useRoverAccessories.js';

const EMPTY_ACCESSORY_VALUES = Object.freeze({});

export default function RoverAccessoryControls({ roverId, className = '' }) {
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
      className={`mobile-touch-control min-h-0 overflow-y-auto overscroll-contain p-1.5 text-slate-100 ${className}`.trim()}
      aria-label="Rover accessories"
    >
      {peripherals.map((peripheral) => (
        <section key={peripheral.id} className="mb-2 last:mb-0">
          {/* The firmware's array order is authoritative. Mapping directly over
              it keeps physical authoring order intact across every UI host. */}
          <h3 className="mb-1.5 border-b border-cyan-300/40 px-1 pr-8 pb-1 text-sm font-semibold text-cyan-100">
            {peripheral.name}
          </h3>
          <div className="flex flex-col gap-1.5">
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
      ))}
    </div>
  );
}
