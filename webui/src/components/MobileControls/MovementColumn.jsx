// Movement Column
// Purpose: Assembles the mobile movement column, which is the right column by default.
// Scope: Integrates drive/dock actions with the mobile control pad without hiding that dependency inside the pad.
import { useControlSelector } from '../../controls/index.js';
import DriveDockAction, { useDriveDockState } from '../DriveDockAction/index.jsx';
import ControlPadPanel from './ControlPadPanel.jsx';

function MovementColumnContent({ layout }) {
  const roverId = useControlSelector((control) => control.state.roverId);
  const driveDockState = useDriveDockState(roverId);
  const dockedNotDriving = driveDockState.docked && !driveDockState.driving;
  const expandAction = dockedNotDriving || driveDockState.dockingInProgress;
  const disabled = !roverId;

  /*
    DriveDockAction owns whether the rover is ready to accept movement, while
    ControlPadPanel owns only movement intent. Keeping the integration here makes
    the column layout explicit and prevents the pad component from knowing about
    docking state.
  */
  const fillClass = dockedNotDriving ? 'max-h-screen self-start' : '';
  const containerClass = `mobile-touch-control flex h-full flex-col gap-0.5 text-slate-100 ${fillClass}`;

  return (
    <div className={containerClass} data-mobile-layout={layout}>
      <DriveDockAction
        layout="mobile"
        expand={expandAction}
        driveDockState={driveDockState}
        compactHeightClass="min-h-[5rem]"
      />
      {!expandAction ? <ControlPadPanel disabled={disabled} /> : null}
    </div>
  );
}

export default function MovementColumn({ layout, className = '' }) {
  return (
    <div className={`mobile-touch-control flex flex-col gap-0.5 ${className}`.trim()} data-mobile-layout={layout}>
      <MovementColumnContent layout={layout === 'landscape' ? 'landscape' : 'portrait'} />
    </div>
  );
}
