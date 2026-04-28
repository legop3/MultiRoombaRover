// Secondary panel row showing room cameras.
import RoomCameraPanel from '../../../components/RoomCameraPanel.jsx';

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
