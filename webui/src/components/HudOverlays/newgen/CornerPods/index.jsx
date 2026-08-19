// New Drive Corner Pods
// Purpose: Composes the four independently owned corner controls around the shared video stage.
import TopLeftPod from './TopLeftPod.jsx';
import TopRightPod from './TopRightPod.jsx';
import BottomLeftPod from './BottomLeftPod.jsx';
import BottomRightPod from './BottomRightPod.jsx';
import { useDriverLayout } from '../../../../layouts/driver/DriverLayoutContext.jsx';

export default function CornerPods({ roverId }) {
  const layout = useDriverLayout();
  const showPhysicalControlPods = layout === 'desktop';

  return (
    <>
      <TopLeftPod roverId={roverId} />
      <TopRightPod roverId={roverId} />
      {/* The mobile layouts already provide large touch controls around the video.
          Omitting this pod avoids presenting duplicate horn, light, and laser actions. */}
      {showPhysicalControlPods ? <BottomLeftPod roverId={roverId} /> : null}
      {/* BottomRightPod also owns the independent chat expansion, so it remains mounted
          on mobile and determines its own camera-control visibility from layout context. */}
      <BottomRightPod roverId={roverId} />
    </>
  );
}
