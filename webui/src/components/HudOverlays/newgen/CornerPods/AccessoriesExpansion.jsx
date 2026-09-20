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
      {/* The tab remains attached to the video's left wall. When open, this
          single shell grows around both the unchanged tab position and the
          controls to its right, so the controls are not rendered as a second
          disconnected panel. Its height follows content until the shared
          renderer reaches the scrolling boundary. */}
      <div className="pointer-events-auto flex max-h-[70vh] items-center overflow-hidden rounded-r-xl bg-black/60">
        <AccessoriesToggle
          label="Accessories"
          ariaLabel={open ? 'Hide accessory controls' : 'Show accessory controls'}
          onClick={() => setOpen(!open)}
          hud
          className="h-28!"
        />
        {open ? (
          <RoverAccessoryControls
            roverId={roverId}
            plainCenteredHeadings
            className="w-64 max-h-[70vh]"
          />
        ) : null}
      </div>
    </div>
  );
}
