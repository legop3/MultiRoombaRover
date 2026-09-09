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
        hud
        className="pointer-events-auto !h-28"
      />
      {open ? (
        <div className="pointer-events-auto w-64 overflow-hidden rounded-r-xl bg-black/60 p-0.5">
          {/* This is exactly the renderer mounted by AuxColumn. The desktop
              wrapper changes available dimensions, never control behavior.
              Content determines the normal panel height; max-height becomes a
              scrolling boundary only for genuinely long accessory lists. */}
          <RoverAccessoryControls roverId={roverId} className="max-h-[70vh]" />
        </div>
      ) : null}
    </div>
  );
}
