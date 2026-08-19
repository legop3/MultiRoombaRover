// Mobile Portrait Driver Layout
// Purpose: Owns the concrete portrait video, controls, and secondary-card placement.
import AuxColumn from '../../../components/MobileControls/AuxColumn.jsx';
import MovementColumn from '../../../components/MobileControls/MovementColumn.jsx';
import NewDriveVideo from '../../../components/NewDriveVideo/index.jsx';
import { useSettingsNamespace } from '../../../settings/index.js';
import { themeGapClass } from '../../../themes/index.js';
import MobileLayoutFrame from '../MobileLayoutFrame/index.jsx';
import MobileSecondaryContent from '../MobileSecondaryContent/index.jsx';

export default function MobilePortraitLayout() {
  const { value: pageSettings } = useSettingsNamespace('page', { swapMobileControlColumns: false });
  const swap = Boolean(pageSettings?.swapMobileControlColumns);
  const columnHeight = 'h-[min(60svh,24rem)]';
  const firstColumn = swap
    ? <MovementColumn layout="portrait" className={columnHeight} />
    : <AuxColumn layout="portrait" className={columnHeight} />;
  const secondColumn = swap
    ? <AuxColumn layout="portrait" className={columnHeight} />
    : <MovementColumn layout="portrait" className={columnHeight} />;

  return (
    <MobileLayoutFrame>
      <div className={`flex flex-col ${themeGapClass}`}>
      {/* NewDriveVideo reads the shared layout context and removes only its redundant
          physical-control pods; the established portrait controls below remain unchanged. */}
      <NewDriveVideo />
      {/* Preserve the existing two-column portrait control surface exactly. */}
      <section className="mobile-touch-control text-white">
        <div className="mobile-touch-control grid grid-cols-2 gap-0.5 items-stretch">
          {firstColumn}
          {secondColumn}
        </div>
      </section>
        <MobileSecondaryContent />
      </div>
    </MobileLayoutFrame>
  );
}
