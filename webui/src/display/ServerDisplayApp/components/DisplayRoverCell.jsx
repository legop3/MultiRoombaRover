// Display Rover Cell
// Purpose: Shows one rover's room-readable driver and battery status.
// Scope: Reuses shared rover/battery presentation primitives while avoiding controls, queues, and video.
import { useTelemetryFrame } from '../../../context/TelemetryContext.jsx';
import BatteryBar from '../../../components/BatteryBar/index.jsx';
import RoverLabel from '../../../components/RoverLabel/index.jsx';
import AutoFitText from '../../../mini/MiniSummaryApp/components/AutoFitText.jsx';
import {
  buildRoverStateText,
  findDriverForRover,
  formatBatteryText,
  getDisplayBatteryVisual,
} from '../utils.js';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export default function DisplayRoverCell({ rover, session }) {
  const frame = useTelemetryFrame(rover?.id);
  const visual = getDisplayBatteryVisual({ rover, frame });
  const driver = findDriverForRover({ roverId: rover?.id, session });
  const stateText = buildRoverStateText(rover, visual);
  const batteryText = formatBatteryText(visual);
  const active = Boolean(driver);
  const urgent = Boolean(visual?.urgentActive);
  const warn = Boolean(visual?.warnActive);
  const locked = Boolean(rover?.locked);

  return (
    <article
      className={classNames(
        'relative min-h-0 overflow-hidden border border-slate-800 bg-black',
        locked ? 'border-red-400 ring-4 ring-red-500/80' : '',
        !locked && active ? 'ring-2 ring-sky-400/80' : '',
        !locked && urgent ? 'ring-4 ring-red-500/90' : !locked && warn ? 'ring-2 ring-amber-300/80' : '',
      )}
    >
      <BatteryBar visual={visual} variant="background" orientation="vertical" />
      <div className="relative z-10 grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-[0.55vh] p-[0.85vw] text-center">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-[0.8vw]">
          <div className="min-w-0">
            <RoverLabel
              rover={rover}
              fallback={rover?.id}
              as={AutoFitText}
              className="leading-none"
              maxSize={76}
              minSize={20}
            />
          </div>
          {locked ? (
            // Keep the lock warning adjacent to the rover identity so the cell
            // remains readable while still making the locked state impossible
            // to miss at a glance.
            <div className="max-w-[36vw] border-4 border-red-100 bg-red-700 px-[0.9vw] py-[0.45vh] text-center text-[clamp(1.6rem,4.2vh,4.4rem)] font-black leading-none text-white">
              <div>LOCKED</div>
              {rover?.lockReason ? (
                <div className="mt-[0.3vh] text-[clamp(1rem,2.4vh,2.5rem)] leading-none text-red-50">
                  {rover.lockReason}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)] items-center gap-[1vw]">
          <div className="min-w-0">
            <AutoFitText
              className={classNames(
                'font-black leading-none',
                active ? 'text-white' : 'text-slate-400',
              )}
              maxSize={128}
              minSize={28}
            >
              {driver?.label || 'Idle'}
            </AutoFitText>
          </div>
          <div className="min-w-0">
            <AutoFitText
              className={classNames(
                'font-black leading-none',
                urgent ? 'text-red-100' : warn ? 'text-amber-100' : 'text-slate-100',
              )}
              maxSize={100}
              minSize={24}
            >
              {batteryText}
            </AutoFitText>
          </div>
        </div>
        {stateText ? (
          <div className="min-w-0 text-[clamp(0.95rem,1.8vh,1.8rem)] font-black leading-none text-amber-100">
            {stateText}
          </div>
        ) : (
          // This empty line keeps cells with and without exceptional states the
          // same height. The grid should not jump just because one rover becomes
          // locked or low battery while people are reading the board.
          <div aria-hidden="true" />
        )}
      </div>
    </article>
  );
}
