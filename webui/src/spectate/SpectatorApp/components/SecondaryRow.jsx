// Secondary Row
// Purpose: Defines the Secondary Row module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoomCameraPanel from '../../../components/RoomCameraPanel/index.jsx';

export default function SecondaryRow() {
  return (
    <section className="min-h-0">
      <div className="surface min-h-[14rem] overflow-hidden">
        <RoomCameraPanel
          defaultOrientation="horizontal"
          hideLayoutToggle
          hideHeader
          panelId="spectator-secondary"
        />
      </div>
    </section>
  );
}
