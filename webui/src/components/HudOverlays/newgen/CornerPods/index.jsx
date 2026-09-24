// New Drive Corner Pods
// Purpose: Composes the four independently owned corner controls around the shared video stage.
import TopLeftPod from './TopLeftPod.jsx';
import { useSessionSelector } from '../../../../context/SessionContext.jsx';
import TopRightPod from './TopRightPod.jsx';
import BottomLeftPod from './BottomLeftPod.jsx';
import BottomRightPod from './BottomRightPod.jsx';
import AccessoriesExpansion from './AccessoriesExpansion.jsx';
import { useDriverLayout } from '../../../../layouts/driver/DriverLayoutContext.jsx';

export default function CornerPods({ roverId }) {
  const layout = useDriverLayout();
  const turns = useSessionSelector((state) => state.session?.roster
    ?.find((rover) => String(rover.id) === String(roverId))?.turn);
  const showPhysicalControlPods = layout === 'desktop';

  return (
    <>
      {turns ? <TopLeftPod turns={turns} /> : null}
      <TopRightPod roverId={roverId} />
      {/* The mobile layouts already provide large touch controls around the video.
          Omitting this pod avoids presenting duplicate horn, light, and laser actions. */}
      {showPhysicalControlPods ? <BottomLeftPod roverId={roverId} /> : null}
      {/* Generic accessory controls stay on the same left side at every
          breakpoint, but mobile owns their placement inside AuxColumn. */}
      {showPhysicalControlPods ? <AccessoriesExpansion roverId={roverId} /> : null}
      {/* BottomRightPod also owns the independent chat expansion, so it remains mounted
          on mobile and determines its own camera-control visibility from layout context. */}
      <BottomRightPod roverId={roverId} />
    </>
  );
}
