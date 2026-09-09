// Desktop Accessories Expansion
// Purpose: Places generic rover controls on a collapsible surface centered along the video's left wall.
// Scope: Owns desktop positioning and persisted visibility while reusing the layout-independent control renderer.
import RoverAccessoryControls from '../../../RoverAccessoryControls/index.jsx';
import AccessoriesToggle from '../../../RoverAccessoryControls/AccessoriesToggle.jsx';
import useRoverAccessories from '../../../RoverAccessoryControls/useRoverAccessories.js';
import usePodVisibility from './usePodVisibility.js';

export default function AccessoriesExpansion({ roverId }) {
  const { hasAccessories } = useRoverAccessories(roverId);
  const [open, setOpen] = usePodVisibility('accessories', false);

  // Do not leave an invisible anchor or reserved HUD area on rovers whose
  // peripherals provide only standardized controls or no controls at all.
  if (!hasAccessories) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 z-20 flex items-center">
      <AccessoriesToggle
        label="Accessories"
        ariaLabel={open ? 'Hide accessory controls' : 'Show accessory controls'}
        onClick={() => setOpen(!open)}
        className={`pointer-events-auto !h-28 rounded-l-none ${open ? 'rounded-r-none' : ''}`}
      />
      {open ? (
        <div className="pointer-events-auto h-[70%] min-h-48 max-h-[32rem] w-72 overflow-hidden rounded-r-xl border-2 border-l-0 border-cyan-300/70 bg-slate-950/95 shadow-2xl">
          {/* This is exactly the renderer mounted by AuxColumn. The desktop
              wrapper changes available dimensions, never control behavior. */}
          <RoverAccessoryControls roverId={roverId} className="h-full" />
        </div>
      ) : null}
    </div>
  );
}
