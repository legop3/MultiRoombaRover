// Mobile Landscape Driver Layout
// Purpose: Owns the concrete landscape video, controls, and secondary-card placement.
import AuxColumn from '../../../components/MobileControls/AuxColumn.jsx';
import MovementColumn from '../../../components/MobileControls/MovementColumn.jsx';
import NewDriveVideo from '../../../components/NewDriveVideo/index.jsx';
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
      <section className={`mobile-landscape-driver-grid grid ${themeGapClass}`}>
        {firstColumn}
        <div className="min-w-0 self-start">
          {/* The grid owns the 4:3 height constraint so its center track always
              matches the video. Any width the video cannot use is reassigned to
              the control columns instead of becoming empty gutters around it. */}
          <NewDriveVideo />
        </div>
        {secondColumn}
      </section>
        <MobileSecondaryContent />
      </div>
    </MobileLayoutFrame>
  );
}
