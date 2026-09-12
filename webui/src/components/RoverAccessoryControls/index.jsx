// Rover Accessory Controls
// Purpose: Renders every generic control advertised by a selected rover as one ordered control surface.
// Scope: Reusable content only; mobile and desktop parents own placement, expansion, and visibility.
import { useCallback } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import useCanControlRover from '../../hooks/useCanControlRover.js';
import AccessoryControlField from './AccessoryControlField.jsx';
import useRoverAccessories from './useRoverAccessories.js';

const EMPTY_ACCESSORY_VALUES = Object.freeze({});

export default function RoverAccessoryControls({
  roverId,
  headerAction = null,
  plainCenteredHeadings = false,
  className = '',
}) {
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
        return (
          <section key={peripheral.id} className="mb-0.5 flex flex-col gap-0.5 last:mb-0">
            {/* The firmware's array order is authoritative. Mapping directly over
                it keeps physical authoring order intact across every UI host.
                Every peripheral keeps its heading even when it is the only
                device, because its firmware-provided name identifies which
                physical accessory owns the controls below it. */}
            <div
              className={`flex min-h-8 items-center gap-1 px-1 text-xs font-semibold text-white ${plainCenteredHeadings ? '' : 'bg-black/60'}`.trim()}
            >
              {/* Desktop already supplies one continuous HUD background, so
                  its title needs neither a second tone nor left alignment.
                  Mobile keeps the ordinary heading because it also carries
                  the Back action on the opposite side. */}
              <h3 className={`min-w-0 flex-1 truncate ${plainCenteredHeadings ? 'text-center' : ''}`.trim()}>
                {peripheral.name}
              </h3>
              {peripheralIndex === 0 ? headerAction : null}
            </div>
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
