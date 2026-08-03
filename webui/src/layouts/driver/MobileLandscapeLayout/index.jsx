// Mobile Landscape Driver Layout
// Purpose: Owns the concrete landscape video, controls, and secondary-card placement.
import AuxColumn from '../../../components/MobileControls/AuxColumn.jsx';
import MovementColumn from '../../../components/MobileControls/MovementColumn.jsx';
import DriverVideo from '../../../components/DriverVideo/index.jsx';
import { useSettingsNamespace } from '../../../settings/index.js';
import { themeGapClass } from '../../../themes/index.js';
import MobileLayoutFrame from '../MobileLayoutFrame/index.jsx';
import MobileSecondaryContent from '../MobileSecondaryContent/index.jsx';

export default function MobileLandscapeLayout() {
  const { value: pageSettings } = useSettingsNamespace('page', { swapMobileControlColumns: false });
  const swap = Boolean(pageSettings?.swapMobileControlColumns);
  const columnClass = 'self-start h-[min(100svh,32rem)]';
  const firstColumn = swap
    ? <MovementColumn layout="landscape" className={columnClass} />
    : <AuxColumn layout="landscape" className={columnClass} />;
  const secondColumn = swap
    ? <AuxColumn layout="landscape" className={columnClass} />
    : <MovementColumn layout="landscape" className={columnClass} />;

  return (
    <MobileLayoutFrame>
      <div className={`flex flex-col ${themeGapClass}`}>
      {/* The center column deliberately contains only the driver video. */}
      <section className={`grid grid-cols-[minmax(0,0.7fr)_minmax(0,2.1fr)_minmax(0,0.7fr)] ${themeGapClass}`}>
        {firstColumn}
        <div className="min-w-0 self-start">
          <DriverVideo layoutFormat="mobile-landscape" />
        </div>
        {secondColumn}
      </section>
        <MobileSecondaryContent />
      </div>
    </MobileLayoutFrame>
  );
}
